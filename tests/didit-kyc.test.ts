import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Didit integration contract.
 *
 * These tests exist because three separate v2-era assumptions survived into a v3 integration and
 * none of them failed loudly:
 *
 *  1. `X-Signature-V2` is an HMAC over a *canonical* re-encoding of the JSON body (keys sorted,
 *     whole-valued floats shortened), not over the bytes Didit sent. Hashing the raw body only
 *     agreed when the payload happened to arrive in canonical order, so a decision containing a
 *     score like `96.0` was rejected as a forgery and the approval never landed.
 *  2. v3 returns per-feature results as *plural arrays* (`id_verifications[]`, `face_matches[]`)
 *     either at the root of a decision GET or under `decision` in a webhook. The v2
 *     `verification_checks` object no longer exists, so declines arrived with no reason at all.
 *  3. v3 renamed statuses: `Resubmitted`, `Not Finished`, `Awaiting User`, `Not Started`. Anything
 *     unrecognised normalises to "Pending", which left resubmission-required members watching a
 *     spinner forever.
 */

const SECRET = 'didit-webhook-secret-for-tests'
process.env.DIDIT_WEBHOOK_SECRET = SECRET
process.env.DIDIT_API_KEY = 'test-api-key'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

type DiditModule = typeof import('../lib/didit')

let loaded: DiditModule | null = null
/** `lib/didit` reads its credentials at import time, so the environment is set before it loads. */
async function didit(): Promise<DiditModule> {
  if (!loaded) loaded = await import('../lib/didit')
  return loaded
}

/** An independent implementation of Didit's canonical form, so the test pins the contract. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortDeep((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}

function signCanonical(payload: unknown): string {
  return createHmac('sha256', SECRET).update(JSON.stringify(sortDeep(payload)), 'utf8').digest('hex')
}

function signRaw(body: string): string {
  return createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

// A realistic V2 delivery: keys are not in alphabetical order and the decision carries a
// whole-valued float, which is exactly the shape that used to fail.
const RAW_BODY = JSON.stringify({
  event_id: 'evt_1',
  status: 'Approved',
  session_id: 'ses_1',
  vendor_data: 'uid-1',
  decision: { score: 96.0, liveness_checks: [{ status: 'Approved', node_id: 'liveness_1' }] },
})

test('a V2 webhook signed over canonical JSON verifies', async () => {
  const { verifyWebhookSignature } = await didit()
  const signature = signCanonical(JSON.parse(RAW_BODY))

  assert.notEqual(signature, signRaw(RAW_BODY), 'fixture must exercise the canonical/raw difference')
  assert.equal(
    verifyWebhookSignature(RAW_BODY, signature, { timestamp: String(nowSeconds()), requireTimestamp: true }),
    true,
  )
})

test('a signature computed over the wire bytes still matches (deprecated X-Signature)', async () => {
  const { verifyWebhookSignature } = await didit()
  assert.equal(verifyWebhookSignature(RAW_BODY, signRaw(RAW_BODY)), true)
})

test('a tampered body, a stale timestamp and a missing timestamp are all refused', async () => {
  const { verifyWebhookSignature, WEBHOOK_TOLERANCE_SECONDS } = await didit()
  const signature = signCanonical(JSON.parse(RAW_BODY))
  const fresh = String(nowSeconds())

  assert.equal(verifyWebhookSignature(RAW_BODY, signature, { timestamp: fresh, requireTimestamp: true }), true)

  const tampered = RAW_BODY.replace('Approved', 'Declined')
  assert.equal(verifyWebhookSignature(tampered, signature, { timestamp: fresh, requireTimestamp: true }), false)

  const stale = String(nowSeconds() - WEBHOOK_TOLERANCE_SECONDS - 60)
  assert.equal(verifyWebhookSignature(RAW_BODY, signature, { timestamp: stale, requireTimestamp: true }), false)

  // Dropping X-Timestamp must not be a way to skip the replay window.
  assert.equal(verifyWebhookSignature(RAW_BODY, signature, { requireTimestamp: true }), false)
  assert.equal(verifyWebhookSignature(RAW_BODY, null, { timestamp: fresh }), false)
})

test('every v3 status string maps to a state the app acts on', async () => {
  const { normaliseStatus } = await didit()
  assert.equal(normaliseStatus('Not Started'), 'Pending')
  assert.equal(normaliseStatus('In Progress'), 'InProgress')
  assert.equal(normaliseStatus('Awaiting User'), 'InProgress')
  assert.equal(normaliseStatus('In Review'), 'OnHold')
  assert.equal(normaliseStatus('Approved'), 'Approved')
  assert.equal(normaliseStatus('Declined'), 'Declined')
  assert.equal(normaliseStatus('Resubmitted'), 'Resubmission')
  assert.equal(normaliseStatus('Not Finished'), 'Abandoned')
  assert.equal(normaliseStatus('Abandoned'), 'Abandoned')
  assert.equal(normaliseStatus('Expired'), 'Expired')
})

const DECLINED_DECISION = {
  session_id: 'ses_1',
  status: 'Declined',
  vendor_data: 'uid-1',
  id_verifications: [
    {
      node_id: 'feature_ocr_1',
      status: 'Declined',
      warnings: [{ risk: 'DOCUMENT_EXPIRED', short_description: 'The document expired on 3 March 2024' }],
    },
  ],
  liveness_checks: [{ node_id: 'liveness_1', status: 'Approved', score: 96.0, warnings: [] }],
  face_matches: [{ node_id: 'face_match_1', status: 'Declined', score: 41.0, warnings: [{ risk: 'FACE_MATCH_FAILED' }] }],
}

test('failed checks are read from the v3 plural arrays, with readable detail', async () => {
  const { extractFailedChecks, extractRejectionReason } = await didit()

  const checks = extractFailedChecks(DECLINED_DECISION)
  assert.ok(checks, 'a declined decision must report the checks that failed')
  assert.equal(checks.length, 2, 'only the failing nodes are reported')
  assert.match(checks[0]!, /^ID document: declined/)
  assert.match(checks[0]!, /expired on 3 March 2024/)
  assert.match(checks[1]!, /Face match: declined/)
  assert.match(checks[1]!, /face match failed/)

  // An explicit reason outranks a warning.
  assert.equal(
    extractRejectionReason({ ...DECLINED_DECISION, reason: 'Document could not be read' }),
    'Document could not be read',
  )
  // With none given, the first warning becomes the reason.
  assert.equal(extractRejectionReason(DECLINED_DECISION), 'The document expired on 3 March 2024')
})

test('a webhook envelope (arrays nested under `decision`) parses the same way', async () => {
  const { extractFailedChecks, extractRejectionReason } = await didit()
  const envelope = {
    event_id: 'evt_1',
    session_id: 'ses_1',
    vendor_data: 'uid-1',
    status: 'Declined',
    decision: DECLINED_DECISION,
  }
  const checks = extractFailedChecks(envelope)
  assert.ok(checks && checks.length === 2)
  assert.equal(extractRejectionReason(envelope), 'The document expired on 3 March 2024')
})

test('an approved decision reports no failures', async () => {
  const { extractFailedChecks, extractRejectionReason } = await didit()
  const approved = {
    status: 'Approved',
    vendor_data: 'uid-1',
    id_verifications: [{ node_id: 'feature_ocr_1', status: 'Approved', warnings: [] }],
    liveness_checks: [{ node_id: 'liveness_1', status: 'Approved', score: 99.0, warnings: [] }],
  }
  assert.equal(extractFailedChecks(approved), undefined)
  assert.equal(extractRejectionReason(approved), undefined)
})

test('a decision without vendor_data falls back to the session record for ownership', async () => {
  const { getKycSessionStatus } = await didit()
  const calls: string[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const body = url.endsWith('/decision/')
      ? { session_id: 'ses_1', status: 'Approved', id_verifications: [{ status: 'Approved', warnings: [] }] }
      : { session_id: 'ses_1', status: 'Approved', vendor_data: 'uid-1' }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  try {
    const result = await getKycSessionStatus('ses_1')
    assert.equal(result.status, 'Approved')
    assert.equal(result.vendor_data, 'uid-1', 'ownership must come from the session record when the decision omits it')
    assert.equal(calls.length, 2, 'the session endpoint is read once for the owner field')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the callback is sent to the device that finished the flow, not to both', () => {
  const source = read('lib/didit.ts')
  assert.doesNotMatch(source, /callback_method: 'both'/, 'both devices were redirected, killing the desktop poll')
  assert.match(source, /callback_method: isMobile \? 'initiator' : 'completer'/)
})

test('the webhook verifies the V2 signature with its timestamp and does not stall on a status read', () => {
  const webhook = read('app/api/kyc/webhook/route.ts')
  assert.match(webhook, /req\.headers\.get\('x-signature-v2'\)/)
  assert.match(webhook, /req\.headers\.get\('x-timestamp'\)/)
  assert.match(webhook, /requireTimestamp: Boolean\(signatureV2\)/)
  assert.match(webhook, /timeoutMs: 2_500/, 'a slow status read must not blow the 5s delivery budget')
  assert.match(webhook, /extractFailedChecks|live\?\.failed_checks/)
  assert.doesNotMatch(webhook, /verification_checks/, 'the v2 check shape no longer exists')

  const status = read('app/api/kyc/status/route.ts')
  assert.doesNotMatch(status, /awaitingWebhook/, 'the flag was unreachable')
})

test('the API base URL is the verification host, never the registration host', () => {
  const env = read('.env.example')
  assert.doesNotMatch(env, /^DIDIT_API_URL="https:\/\/apx\.didit\.me"/m, 'apx does not serve /v3/* — sessions would 404')
  assert.match(read('lib/didit.ts'), /https:\/\/verification\.didit\.me/)
})
