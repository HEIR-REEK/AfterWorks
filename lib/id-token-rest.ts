/**
 * Firebase ID token verification without `firebase-admin`.
 *
 * `verifyIdToken` is on the hot path of *every* authenticated API route, and in the Admin SDK it
 * drags a Node-only dependency tree (fs, net, grpc, …). But verifying a Firebase ID token does
 * not need the Admin SDK at all: an ID token is a plain RS256 JWT signed by Google, and the
 * public keys are published at a stable URL. WebCrypto can do the rest.
 *
 * This module is that verifier. It is stricter than "decode and trust the payload":
 *
 *  1. The signature is verified against the key named by the token's `kid`, so a forged payload
 *     signed with an unknown key is rejected (the classic ID-token mistake).
 *  2. `iss`, `aud` and `exp`/`iat` are checked, and the project id must match — a token minted
 *     for a *different* Firebase project must not unlock this one.
 *  3. Google's key set is cached in the isolate and refreshed on an unknown `kid`, with a
 *     bounded fetch so a cold Worker cannot hang a request on it.
 */

export type DecodedIdToken = {
  uid: string
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  /** Custom claims (e.g. `admin`) travel on the token. */
  [claim: string]: unknown
}

export class IdTokenError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'malformed'
      | 'bad-signature'
      | 'expired'
      | 'wrong-issuer'
      | 'wrong-audience'
      | 'wrong-project'
      | 'unknown-key'
      | 'keys-unavailable',
  ) {
    super(message)
    this.name = 'IdTokenError'
  }
}

const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
const VALID_ISSUER_PREFIX = 'https://securetoken.google.com/'
const MAX_CLOCK_SKEW_SEC = 60

type CertCache = { keys: Map<string, string>; expiresAt: number }
let certCache: CertCache | null = null
let certFlight: Promise<CertCache> | null = null

/** Test seam. */
export function resetCertCache(): void {
  certCache = null
  certFlight = null
}

/**
 * Returns a `Uint8Array` backed by a plain `ArrayBuffer` (not `ArrayBufferLike`), because
 * `crypto.subtle.*` in lib.dom requires a `BufferSource` over an `ArrayBuffer` and rejects a
 * view that might be backed by a `SharedArrayBuffer`.
 */
function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as Record<string, unknown>
  } catch {
    throw new IdTokenError('Token segment is not valid JSON.', 'malformed')
  }
}

/** `Cache-Control: max-age` from Google, so the key set is not re-fetched per request. */
function parseMaxAge(header: string | null, fallbackSeconds = 3600): number {
  const match = /max-age=(\d+)/.exec(header ?? '')
  const seconds = match ? Number(match[1]) : fallbackSeconds
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallbackSeconds
}

async function fetchCerts(fetchImpl: typeof fetch, now: () => number): Promise<CertCache> {
  const res = await fetchImpl(CERTS_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) {
    throw new IdTokenError(`Could not fetch Google signing keys (${res.status}).`, 'keys-unavailable')
  }
  const body = (await res.json()) as Record<string, string>
  const keys = new Map(Object.entries(body))
  if (!keys.size) throw new IdTokenError('Google returned an empty key set.', 'keys-unavailable')
  return { keys, expiresAt: now() + parseMaxAge(res.headers.get('cache-control')) * 1000 }
}

async function getCerts(
  fetchImpl: typeof fetch,
  now: () => number,
  opts?: { force?: boolean },
): Promise<CertCache> {
  if (!opts?.force && certCache && certCache.expiresAt > now()) return certCache
  if (certFlight) return certFlight
  certFlight = fetchCerts(fetchImpl, now)
    .then((value) => {
      certCache = value
      return value
    })
    .finally(() => {
      certFlight = null
    })
  return certFlight
}

/**
 * Converts an X.509 certificate (PEM) to a CryptoKey. WebCrypto cannot import a full
 * certificate, so the SubjectPublicKeyInfo is sliced out of the DER by walking the ASN.1 length.
 * Google's certs are single-certificate DER, which keeps this simple and safe.
 */
async function certToCryptoKey(pem: string): Promise<CryptoKey> {
  const der = base64UrlToBytes(pem.replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_'))

  const spki = extractSpki(der)
  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

/**
 * Locate the SubjectPublicKeyInfo inside a certificate.
 *
 * A certificate is `SEQUENCE { tbsCertificate, signatureAlgorithm, signature }`, and inside
 * `tbsCertificate` the SPKI is the element after `subject` — always in this order, with only
 * the leading `[0] version` optional:
 *
 *   [0] version · INTEGER serial · SEQUENCE sigAlg · SEQUENCE issuer ·
 *   SEQUENCE validity · SEQUENCE subject · SEQUENCE subjectPublicKeyInfo · …
 *
 * Walking the TLVs is the only reliable way: `importKey('spki')` wants the *whole* element
 * including its own header, and a 2048-bit key gives the outer SEQUENCE a long-form
 * (multi-byte) length, so a byte scan for `0x30` gets the boundaries wrong.
 */
type Tlv = { tag: number; start: number; contentStart: number; end: number }

/** Reads one DER TLV starting at `offset`. Returns the whole element's extent. */
function readTlv(der: Uint8Array, offset: number): Tlv {
  const tag = der[offset]
  if (tag === undefined) throw new Error('DER: truncated tag')
  let cursor = offset + 1
  let length = der[cursor]
  if (length === undefined) throw new Error('DER: truncated length')
  cursor += 1

  if (length & 0x80) {
    const byteCount = length & 0x7f
    if (byteCount === 0 || byteCount > 4) throw new Error('DER: unsupported length form')
    length = 0
    for (let i = 0; i < byteCount; i += 1) {
      const byte = der[cursor + i]
      if (byte === undefined) throw new Error('DER: truncated long length')
      length = (length << 8) | byte
    }
    cursor += byteCount
  }

  const contentStart = cursor
  const end = contentStart + length
  if (end > der.length) throw new Error('DER: element exceeds buffer')
  return { tag, start: offset, contentStart, end }
}

function extractSpki(der: Uint8Array): Uint8Array<ArrayBuffer> {
  // Certificate → tbsCertificate (first child).
  const certificate = readTlv(der, 0)
  if (certificate.tag !== 0x30) throw new Error('DER: certificate is not a SEQUENCE')
  const tbs = readTlv(der, certificate.contentStart)
  if (tbs.tag !== 0x30) throw new Error('DER: tbsCertificate is not a SEQUENCE')

  let offset = tbs.contentStart
  const first = readTlv(der, offset)
  // Optional `[0] version` (context-specific constructed, tag 0xa0).
  if (first.tag === 0xa0) offset = first.end

  // serial (INTEGER), sigAlg, issuer, validity, subject → five elements, then SPKI.
  for (let i = 0; i < 5; i += 1) offset = readTlv(der, offset).end

  const spki = readTlv(der, offset)
  if (spki.tag !== 0x30) throw new Error('DER: SPKI is not a SEQUENCE')
  // Copy into a fresh ArrayBuffer-backed view: a `subarray` keeps the parent's ArrayBuffer type,
  // which `importKey` will not accept under lib.dom's `BufferSource`.
  return new Uint8Array(der.subarray(spki.start, spki.end))
}

export type VerifyOptions = {
  /** The Firebase project the token must belong to. */
  projectId: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
  now?: () => number
  /** Verification bypass for the emulator, which mints unsigned tokens. */
  emulator?: boolean
}

/**
 * Verifies a Firebase ID token. Throws `IdTokenError` on failure — callers that prefer a
 * boolean/null should wrap it.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  opts: VerifyOptions,
): Promise<DecodedIdToken> {
  const now = opts.now ?? Date.now
  const fetchImpl = opts.fetchImpl ?? fetch

  if (typeof idToken !== 'string' || idToken.split('.').length !== 3) {
    throw new IdTokenError('Token is not a three-part JWT.', 'malformed')
  }
  const [headerSeg, payloadSeg, signatureSeg] = idToken.split('.') as [string, string, string]
  const header = decodeJsonSegment(headerSeg)
  const payload = decodeJsonSegment(payloadSeg)

  if (header.alg !== 'RS256') {
    throw new IdTokenError(`Unsupported alg "${String(header.alg)}"; only RS256 is accepted.`, 'malformed')
  }

  // ── Signature ──
  // The Auth emulator issues unsigned tokens; only honour that when explicitly enabled.
  if (!opts.emulator) {
    const kid = typeof header.kid === 'string' ? header.kid : ''
    if (!kid) throw new IdTokenError('Token has no kid header.', 'malformed')

    let certs = await getCerts(fetchImpl, now)
    if (!certs.keys.has(kid)) {
      // A rotation between cache fills: refresh once before rejecting.
      certs = await getCerts(fetchImpl, now, { force: true })
      if (!certs.keys.has(kid)) {
        throw new IdTokenError(`Unknown signing key "${kid}".`, 'unknown-key')
      }
    }

    const key = await certToCryptoKey(certs.keys.get(kid)!)
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(signatureSeg),
      new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
    )
    if (!valid) throw new IdTokenError('Token signature is invalid.', 'bad-signature')
  }

  // ── Claims ──
  const nowSec = Math.floor(now() / 1000)
  const exp = Number(payload.exp ?? 0)
  const iat = Number(payload.iat ?? 0)
  const authTime = Number(payload.auth_time ?? iat)

  if (!Number.isFinite(exp) || exp + MAX_CLOCK_SKEW_SEC < nowSec) {
    throw new IdTokenError('Token has expired.', 'expired')
  }
  if (!Number.isFinite(iat) || iat - MAX_CLOCK_SKEW_SEC > nowSec) {
    throw new IdTokenError('Token iat is in the future.', 'malformed')
  }
  if (!Number.isFinite(authTime) || authTime - MAX_CLOCK_SKEW_SEC > nowSec) {
    throw new IdTokenError('Token auth_time is in the future.', 'malformed')
  }
  if (payload.iss !== `${VALID_ISSUER_PREFIX}${opts.projectId}`) {
    throw new IdTokenError(
      `Token issuer "${String(payload.iss)}" does not match project "${opts.projectId}".`,
      'wrong-issuer',
    )
  }
  if (payload.aud !== opts.projectId) {
    throw new IdTokenError(
      `Token audience "${String(payload.aud)}" does not match project "${opts.projectId}".`,
      'wrong-project',
    )
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!sub || sub.length > 128) {
    throw new IdTokenError('Token sub is missing or too long.', 'malformed')
  }
  if (payload.user_id !== undefined && payload.user_id !== sub) {
    throw new IdTokenError('Token user_id does not match sub.', 'malformed')
  }

  return { ...payload, uid: sub, sub } as DecodedIdToken
}

/**
 * Graceful wrapper matching `verifyIdToken()` in `lib/firestore-admin.ts`: returns null instead
 * of throwing, and logs at warn. Kept separate so the strict version above stays testable.
 */
export async function verifyIdTokenOrNull(
  idToken: string,
  opts: VerifyOptions,
): Promise<DecodedIdToken | null> {
  try {
    return await verifyFirebaseIdToken(idToken, opts)
  } catch (err) {
    console.warn('[IdToken] verification failed:', err instanceof Error ? err.message : err)
    return null
  }
}
