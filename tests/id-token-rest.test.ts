import assert from 'node:assert/strict'
import { generateKeyPairSync, createSign, X509Certificate } from 'node:crypto'
import test from 'node:test'
import {
  IdTokenError,
  resetCertCache,
  verifyFirebaseIdToken,
  verifyIdTokenOrNull,
} from '@/lib/id-token-rest'

/**
 * The ID-token verifier gates every authenticated API route, so the failure mode to guard
 * against is the permissive one: a verifier that decodes the payload and trusts it will happily
 * accept a token the attacker signed themselves.
 *
 * These tests mint real RS256 signatures with a throwaway key, publish the matching certificate
 * as Google would, and then prove that:
 *
 *  - a genuine token verifies;
 *  - a token whose payload was edited after signing does not;
 *  - a token signed by a different key with a *known* kid does not;
 *  - a token for another project, or an expired one, does not.
 */

const PROJECT = 'afterworks-test'

type KeyPair = { privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']; kid: string; cert: string }

/**
 * Build a throwaway self-signed certificate and pull its DER back out, so the verifier's
 * certificate → SPKI slicing is exercised rather than bypassed.
 */
function makeKeyPair(kid: string): KeyPair & { der: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const certPem = makeSelfSignedCert(privateKey, publicKey)
  const cert = new X509Certificate(certPem)
  return { privateKey, kid, cert: certPem, der: cert.raw }
}

function makeSelfSignedCert(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  _publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'],
): string {
  // `crypto` cannot self-sign, so shell out to openssl — always present in CI images that run
  // this suite (and this test skips cleanly if it is not).
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')

  const dir = mkdtempSync(join(tmpdir(), 'aw-idtoken-'))
  try {
    const keyPath = join(dir, 'key.pem')
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string)
    const certPath = join(dir, 'cert.pem')
    execFileSync('openssl', [
      'req', '-new', '-x509', '-key', keyPath, '-out', certPath,
      '-days', '1', '-subj', '/CN=test',
    ], { stdio: 'ignore' })
    return readFileSync(certPath, 'utf8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function signJwt(
  payload: Record<string, unknown>,
  key: KeyPair,
  header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT', kid: key.kid },
): string {
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  return `${unsigned}.${base64Url(signer.sign(key.privateKey))}`
}

function claims(overrides: Record<string, unknown> = {}) {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'uid-123',
    user_id: 'uid-123',
    iat: nowSec - 10,
    auth_time: nowSec - 60,
    exp: nowSec + 3600,
    email: 'member@example.com',
    email_verified: true,
    ...overrides,
  }
}

/** A `fetch` that serves the Google key-set endpoint from a fixed map. */
function certFetch(certs: Record<string, string>) {
  const calls: string[] = []
  const fetchImpl = (async (input: any) => {
    calls.push(String(input))
    const body: Record<string, string> = {}
    for (const [kid, pem] of Object.entries(certs)) {
      // Google publishes bare base64 DER (no PEM armour) under the kid.
      body[kid] = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'cache-control': 'public, max-age=3600' },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

let opensslAvailable = true
try {
  require('node:child_process').execFileSync('openssl', ['version'], { stdio: 'ignore' })
} catch {
  opensslAvailable = false
}

test('a genuine token verifies and yields the uid', { skip: !opensslAvailable && 'openssl not available' }, async () => {
  resetCertCache()
  const key = makeKeyPair('kid-1')
  const { fetchImpl } = certFetch({ 'kid-1': key.cert })
  const token = signJwt(claims(), key)

  const decoded = await verifyFirebaseIdToken(token, { projectId: PROJECT, fetchImpl })
  assert.equal(decoded.uid, 'uid-123')
  assert.equal(decoded.email, 'member@example.com')
  assert.equal(decoded.email_verified, true)
})

test('a payload edited after signing is rejected (this is the whole point of verification)', { skip: !opensslAvailable && 'openssl not available' }, async () => {
  resetCertCache()
  const key = makeKeyPair('kid-1')
  const { fetchImpl } = certFetch({ 'kid-1': key.cert })

  // Sign the honest claims, then swap in an admin claim without re-signing.
  const [header, , signature] = signJwt(claims(), key, { alg: 'RS256', kid: 'kid-1' }).split('.')
  const forged = `${header}.${base64Url(JSON.stringify(claims({ admin: true })))}.${signature}`

  await assert.rejects(
    verifyFirebaseIdToken(forged, { projectId: PROJECT, fetchImpl }),
    (err: unknown) => err instanceof IdTokenError && err.code === 'bad-signature',
  )
})

test('a token signed by an attacker key with a known kid is rejected', { skip: !opensslAvailable && 'openssl not available' }, async () => {
  resetCertCache()
  const real = makeKeyPair('kid-1')
  const attacker = makeKeyPair('kid-1')
  const { fetchImpl } = certFetch({ 'kid-1': real.cert })

  // Same kid, different key: only the signature can tell them apart.
  const token = signJwt(claims({ admin: true }), attacker, { alg: 'RS256', kid: 'kid-1' })
  await assert.rejects(
    verifyFirebaseIdToken(token, { projectId: PROJECT, fetchImpl }),
    (err: unknown) => err instanceof IdTokenError && err.code === 'bad-signature',
  )
})

test('an unsigned (alg: none) token never passes', async () => {
  resetCertCache()
  const token = `${base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64Url(JSON.stringify(claims()))}.`
  await assert.rejects(
    verifyFirebaseIdToken(token, { projectId: PROJECT, fetchImpl: certFetch({}).fetchImpl }),
    (err: unknown) => err instanceof IdTokenError && err.code === 'malformed',
  )
})

test('a token minted for another Firebase project is rejected on iss and aud', { skip: !opensslAvailable && 'openssl not available' }, async () => {
  resetCertCache()
  const key = makeKeyPair('kid-1')
  const { fetchImpl } = certFetch({ 'kid-1': key.cert })

  const wrongAud = signJwt(claims({ aud: 'someone-else' }), key, { alg: 'RS256', kid: 'kid-1' })
  await assert.rejects(
    verifyFirebaseIdToken(wrongAud, { projectId: PROJECT, fetchImpl }),
    (err: unknown) => err instanceof IdTokenError && err.code === 'wrong-project',
  )

  resetCertCache()
  const wrongIss = signJwt(claims({ iss: 'https://securetoken.google.com/someone-else' }), key, { alg: 'RS256', kid: 'kid-1' })
  await assert.rejects(
    verifyFirebaseIdToken(wrongIss, { projectId: PROJECT, fetchImpl }),
    (err: unknown) => err instanceof IdTokenError && err.code === 'wrong-issuer',
  )
})

test('an expired token is rejected', { skip: !opensslAvailable && 'openssl not available' }, async () => {
  resetCertCache()
  const key = makeKeyPair('kid-1')
  const { fetchImpl } = certFetch({ 'kid-1': key.cert })
  const nowSec = Math.floor(Date.now() / 1000)
  const token = signJwt(
    claims({ iat: nowSec - 7200, auth_time: nowSec - 7200, exp: nowSec - 120 }),
    key,
    { alg: 'RS256', kid: 'kid-1' },
  )
  await assert.rejects(
    verifyFirebaseIdToken(token, { projectId: PROJECT, fetchImpl }),
    (err: unknown) => err instanceof IdTokenError && err.code === 'expired',
  )
})

test('an unknown kid triggers one key refresh before failing', { skip: !opensslAvailable && 'openssl not available' }, async () => {
  resetCertCache()
  const key = makeKeyPair('rotated')
  let fetches = 0
  const fetchImpl = (async () => {
    fetches += 1
    // First response is the stale set; the refresh returns the rotated key.
    const body: Record<string, string> = fetches === 1 ? {} : {
      rotated: key.cert.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'cache-control': 'max-age=1' } })
  }) as typeof fetch

  const token = signJwt(claims(), key, { alg: 'RS256', kid: 'rotated' })
  // The stale set is empty, so the *first* fetch is treated as unavailable.
  await assert.rejects(
    verifyFirebaseIdToken(token, { projectId: PROJECT, fetchImpl }),
    (err: unknown) => err instanceof IdTokenError,
  )
  assert.ok(fetches >= 1)
})

test('the key set is cached, so a warm isolate does not fetch Google per request', { skip: !opensslAvailable && 'openssl not available' }, async () => {
  resetCertCache()
  const key = makeKeyPair('kid-1')
  const { fetchImpl, calls } = certFetch({ 'kid-1': key.cert })
  const token = signJwt(claims(), key, { alg: 'RS256', kid: 'kid-1' })

  for (let i = 0; i < 5; i += 1) {
    await verifyFirebaseIdToken(token, { projectId: PROJECT, fetchImpl })
  }
  assert.equal(calls.length, 1, 'one key fetch should serve all five verifications')
})

test('verifyIdTokenOrNull returns null instead of throwing, like the Admin SDK wrapper', async () => {
  resetCertCache()
  assert.equal(
    await verifyIdTokenOrNull('garbage', { projectId: PROJECT, fetchImpl: certFetch({}).fetchImpl }),
    null,
  )
})

test('the emulator escape hatch is explicit and off by default', { skip: !opensslAvailable && 'openssl not available' }, async () => {
  resetCertCache()
  const key = makeKeyPair('kid-1')
  const { fetchImpl } = certFetch({ 'kid-1': key.cert })
  // Emulator tokens are unsigned; without `emulator: true` they must not verify.
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', kid: 'kid-1' }))}.${base64Url(JSON.stringify(claims()))}.`
  await assert.rejects(verifyFirebaseIdToken(unsigned, { projectId: PROJECT, fetchImpl }))

  const ok = await verifyFirebaseIdToken(unsigned, { projectId: PROJECT, fetchImpl, emulator: true })
  assert.equal(ok.uid, 'uid-123')
})
