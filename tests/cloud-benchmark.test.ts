import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync } from 'node:crypto'
import {
  parseServiceAccountJson,
  percentile,
  resolveCredentials,
  summarise,
  verdict,
  formatMs,
} from '@/lib/cloud-benchmark'

/**
 * The benchmark script is not runnable in CI (it needs a real project), so the two things that
 * could silently make it measure the WRONG thing are pinned here:
 *
 *  1. Credential parsing. The value an operator pastes has been mangled by a dashboard before it
 *     reaches us — wrapped in quotes, base64-encoded, `\n` escaped. If this parser disagrees with
 *     the Admin SDK's parser, the script measures a different project than the app runs against
 *     and the verdict is worthless.
 *  2. The verdict rule. It is the output that drives a decision, so its boundaries are asserted
 *     rather than left to interpretation.
 */

/** A realistic-enough PKCS#8 PEM: the parser validates shape, not key material. */
function fakePem(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 512 })
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
}

/** Re-labels a PKCS#8 PEM as PKCS#1, which is what a re-exported key looks like. */
function fakePkcs1Pem(): string {
  return fakePem().replace(/BEGIN PRIVATE KEY/g, 'BEGIN RSA PRIVATE KEY').replace(/END PRIVATE KEY/g, 'END RSA PRIVATE KEY')
}

function serviceAccountJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'afterworks-online',
    private_key_id: 'abc123',
    private_key: fakePem(),
    client_email: 'bench@afterworks-online.iam.gserviceaccount.com',
    client_id: '1234567890',
    token_uri: 'https://oauth2.googleapis.com/token',
    ...overrides,
  })
}

// ─── Credential parsing ─────────────────────────────────────────────────────

test('raw JSON is parsed as-is', () => {
  const result = parseServiceAccountJson(serviceAccountJson())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.account.project_id, 'afterworks-online')
  assert.equal(result.base64, false)
  assert.match(result.account.private_key, /BEGIN PRIVATE KEY/)
})

test('base64-encoded JSON is detected and decoded (the paste that survives newlines)', () => {
  const encoded = Buffer.from(serviceAccountJson(), 'utf8').toString('base64')
  const result = parseServiceAccountJson(encoded)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.base64, true)
  assert.equal(result.account.project_id, 'afterworks-online')
})

test('a value wrapped in stray quotes is unwrapped — a real dashboard artefact', () => {
  const quoted = `"${serviceAccountJson()}"`
  const result = parseServiceAccountJson(quoted)
  assert.equal(result.ok, true, result.ok ? '' : result.reason)
})

test('escaped \\n inside private_key is repaired rather than failing JSON.parse', () => {
  const escaped = serviceAccountJson().replace(/\n/g, '\\n')
  const result = parseServiceAccountJson(escaped)
  assert.equal(result.ok, true, result.ok ? '' : result.reason)
  if (!result.ok) return
  // The repaired key must contain REAL newlines, or importKey would reject it later.
  assert.ok(result.account.private_key.includes('\n'))
  assert.ok(!result.account.private_key.includes('\\n'))
})

test('a PKCS#1 key is named as such instead of failing deep inside crypto', () => {
  const result = parseServiceAccountJson(serviceAccountJson({ private_key: fakePkcs1Pem() }))
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /PKCS#1 .*convert it to PKCS#8/)
})

test('missing required fields are reported specifically', () => {
  const noProject = parseServiceAccountJson(serviceAccountJson({ project_id: undefined }))
  assert.equal(noProject.ok, false)
  if (!noProject.ok) assert.match(noProject.reason, /project_id/)

  const noEmail = parseServiceAccountJson(serviceAccountJson({ client_email: '' }))
  assert.equal(noEmail.ok, false)
  if (!noEmail.ok) assert.match(noEmail.reason, /client_email/)

  const noKey = parseServiceAccountJson(serviceAccountJson({ private_key: '' }))
  assert.equal(noKey.ok, false)
  if (!noKey.ok) assert.match(noKey.reason, /private_key/)
})

test('garbage that is neither JSON nor base64 gives an actionable message', () => {
  const result = parseServiceAccountJson('this is not a service account')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /not valid JSON|base64/)
})

test('resolveCredentials prefers the inline JSON, and falls back to the file path', () => {
  const inline = resolveCredentials({ FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccountJson() }, () => {
    throw new Error('should not read a file when inline JSON is present')
  })
  assert.equal(inline.ok, true)
  if (inline.ok) assert.equal(inline.source, 'FIREBASE_SERVICE_ACCOUNT_JSON')

  const fromFile = resolveCredentials({ FIREBASE_SERVICE_ACCOUNT_PATH: './key.json' }, (p) => {
    assert.equal(p, './key.json')
    return serviceAccountJson({ project_id: 'from-file' })
  })
  assert.equal(fromFile.ok, true)
  if (fromFile.ok) {
    assert.equal(fromFile.source, 'FIREBASE_SERVICE_ACCOUNT_PATH')
    assert.equal(fromFile.account.project_id, 'from-file')
  }
})

test('resolveCredentials explains an unreadable path instead of throwing', () => {
  const result = resolveCredentials({ FIREBASE_SERVICE_ACCOUNT_PATH: './missing.json' }, () => {
    throw new Error('ENOENT')
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /Could not read the file at \.\/missing\.json/)
})

test('resolveCredentials with nothing set names both variables', () => {
  const result = resolveCredentials({}, () => '')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /Neither FIREBASE_SERVICE_ACCOUNT_JSON nor FIREBASE_SERVICE_ACCOUNT_PATH/)
})

// ─── Statistics ─────────────────────────────────────────────────────────────

test('percentiles use nearest-rank, so they report an observed sample', () => {
  const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  assert.equal(percentile(samples, 50), 50)
  assert.equal(percentile(samples, 95), 100)
  assert.equal(percentile(samples, 100), 100)
  // Unsorted input must not change the answer.
  assert.equal(percentile([100, 10, 50, 20], 50), 20)
})

test('summarise reports the shape the operator needs, and survives one sample', () => {
  const many = summarise([10, 20, 30, 40, 50])
  assert.deepEqual(many, { count: 5, min: 10, p50: 30, p95: 50, max: 50, mean: 30 })

  const one = summarise([42])
  assert.equal(one.count, 1)
  assert.equal(one.p50, 42)
  assert.equal(one.p95, 42)
})

test('an empty sample set does not produce NaN in the report', () => {
  assert.deepEqual(summarise([]), { count: 0, min: 0, p50: 0, p95: 0, max: 0, mean: 0 })
  assert.equal(percentile([], 50), 0)
})

test('formatMs stays readable from sub-millisecond to seconds', () => {
  assert.equal(formatMs(0.5), '500µs')
  assert.equal(formatMs(37.4), '37ms')
  assert.equal(formatMs(1500), '1.50s')
})

// ─── The verdict rule ───────────────────────────────────────────────────────

test('the verdict boundaries are where the documentation says they are', () => {
  assert.equal(verdict(20).label, 'favourable')
  assert.equal(verdict(80).label, 'favourable')
  assert.equal(verdict(81).label, 'marginal')
  assert.equal(verdict(160).label, 'marginal')
  assert.equal(verdict(161).label, 'unfavourable')
  assert.equal(verdict(400).label, 'unfavourable')
})

test('an unfavourable verdict recommends the cheap option, not the migration', () => {
  const result = verdict(250)
  assert.match(result.headline, /eats the edge win/i)
  assert.match(result.detail, /Cloudflare in front of the existing Render service/i)
  // The point of the script: it must be willing to say "do not do this".
  assert.doesNotMatch(result.detail, /finish the port/i)
})
