/**
 * Session tokens — the single source of truth for AfterWorks admin authentication state.
 *
 * Design notes
 * ───────────
 * • Runtime-agnostic: uses only Web Crypto + TextEncoder, so the *exact same* code runs in
 *   Node route handlers AND in `middleware.ts` (Edge runtime). No duplicated verification
 *   logic means no "works in the API, bypassed in the middleware" class of bug.
 * • Format: `v1.<base64url(claims)>.<base64url(HMAC-SHA256)>` — signed, not encrypted.
 *   Never put secrets in the payload; it is readable by anyone who sees the cookie.
 * • Expiry is enforced *inside* the signature, so a stale cookie can never be "re-accepted"
 *   by forgetting to check a timestamp somewhere.
 * • `jti` lets us revoke a specific session without rotating the signing secret.
 * • Comparison is constant-time; HMAC over a public key is pointless otherwise.
 *
 * This module is deliberately free of `node:*` imports and of any Firebase import.
 */

export type SessionType = 'admin' | 'bypass'

export type SessionClaims = {
  /** Subject — the verified administrator email (lower-cased). */
  sub: string
  /** Token class. `bypass` only unlocks maintenance mode, it grants no console access. */
  typ: SessionType
  /** Issued-at, epoch ms. */
  iat: number
  /** Expiry, epoch ms. */
  exp: number
  /** Unique session id, used for revocation and for the audit trail. */
  jti: string
}

const TOKEN_VERSION = 'v1'
/** Tolerate up to 30s of clock drift between issuer and verifier. */
const CLOCK_SKEW_MS = 30_000

// ─── base64url (binary safe, no Buffer/btoa dependency) ──────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function bytesToB64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    if (b1 === undefined) break
    out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    if (b2 === undefined) break
    out += B64[b2 & 63]
  }
  return out
}

function b64UrlToBytes(input: string): Uint8Array | null {
  const lookup = new Int8Array(256).fill(-1)
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i

  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < input.length; i++) {
    const v = lookup[input.charCodeAt(i)]
    if (v < 0) return null
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 255)
    }
  }
  // Canonicality check for UNPADDED base64url. After consuming full bytes the leftover bit count
  // is (6 * input.length) mod 8:
  //   input length ≡ 0 (mod 4) → 0 leftover bits
  //   input length ≡ 3 (mod 4) → 2 leftover bits  (3 chars encode 2 bytes)
  //   input length ≡ 2 (mod 4) → 4 leftover bits  (2 chars encode 1 byte)
  //   input length ≡ 1 (mod 4) → 6 leftover bits  — never valid (a lone trailing char).
  // The previous `bits >= 4` test wrongly rejected the perfectly valid 4-bit case, which made
  // roughly a third of session tokens — those whose payload length is 1 (mod 3) — decode to
  // null and read as "malformed", silently logging those admins back out. We accept 0/2/4
  // leftover bits and additionally require those padding bits to be zero.
  if (bits >= 6) return null // input length ≡ 1 (mod 4): not a valid base64url group
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null // non-zero padding ⇒ malformed
  return new Uint8Array(bytes)
}

// ─── crypto primitives ───────────────────────────────────────────────────────

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (!c?.subtle) {
    throw new Error(
      'WebCrypto is unavailable in this runtime — AfterWorks session signing requires Node 20+ / Edge.',
    )
  }
  return c.subtle
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await subtle().importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign'],
  )
  const sig = await subtle().sign({ name: 'HMAC' }, key, enc.encode(data))
  return new Uint8Array(sig)
}

/** Length-checked, constant-time comparison of two byte arrays. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Constant-time comparison for two hex strings (webhook signatures, digests, …). */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (
    typeof a !== 'string' ||
    typeof b !== 'string' ||
    !/^[0-9a-fA-F]*$/.test(a) ||
    !/^[0-9a-fA-F]*$/.test(b)
  ) {
    return false
  }
  return constantTimeEqual(
    new TextEncoder().encode(a.toLowerCase()),
    new TextEncoder().encode(b.toLowerCase()),
  )
}

export function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes)
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.getRandomValues) {
    c.getRandomValues(buf)
  } else {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── sign / verify ───────────────────────────────────────────────────────────

export async function signClaims(claims: SessionClaims, secret: string): Promise<string> {
  const payload = bytesToB64Url(
    new TextEncoder().encode(
      JSON.stringify({
        sub: claims.sub,
        typ: claims.typ,
        iat: claims.iat,
        exp: claims.exp,
        jti: claims.jti,
      }),
    ),
  )
  const sig = await hmac(secret, `${TOKEN_VERSION}.${payload}`)
  return `${TOKEN_VERSION}.${payload}.${bytesToB64Url(sig)}`
}

export type VerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'not-yet-valid' | 'type' }

export async function verifyToken(
  token: string | null | undefined,
  secret: string,
  expectedType: SessionType,
  now: number = Date.now(),
): Promise<VerifyResult> {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: 'malformed' }

  const [, payloadB64, sigB64] = parts
  if (payloadB64.length > 1024) return { ok: false, reason: 'malformed' }

  const expectedSig = await hmac(secret, `${TOKEN_VERSION}.${payloadB64}`)
  const givenSig = b64UrlToBytes(sigB64)
  if (!givenSig || !constantTimeEqual(expectedSig, givenSig)) {
    return { ok: false, reason: 'signature' }
  }

  const raw = b64UrlToBytes(payloadB64)
  if (!raw) return { ok: false, reason: 'malformed' }

  let claims: SessionClaims
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<SessionClaims>
    if (
      typeof parsed.sub !== 'string' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.jti !== 'string' ||
      typeof parsed.typ !== 'string'
    ) {
      return { ok: false, reason: 'malformed' }
    }
    claims = {
      sub: parsed.sub,
      typ: parsed.typ as SessionType,
      iat: parsed.iat,
      exp: parsed.exp,
      jti: parsed.jti,
    }
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (claims.typ !== expectedType) return { ok: false, reason: 'type' }
  if (claims.exp + CLOCK_SKEW_MS <= now) return { ok: false, reason: 'expired' }
  if (claims.iat - CLOCK_SKEW_MS > now) return { ok: false, reason: 'not-yet-valid' }

  return { ok: true, claims }
}

// ─── convenience wrappers ────────────────────────────────────────────────────

export type IssuedSession = { token: string; jti: string; expiresAt: number }

export async function issueSession(
  email: string,
  secret: string,
  ttlMs: number,
  type: SessionType = 'admin',
): Promise<IssuedSession> {
  const iat = Date.now()
  const exp = iat + ttlMs
  const jti = randomId(12)
  const token = await signClaims({ sub: email.trim().toLowerCase(), typ: type, iat, exp, jti }, secret)
  return { token, jti, expiresAt: exp }
}

export async function readSession(
  token: string | null | undefined,
  secret: string,
  type: SessionType = 'admin',
): Promise<SessionClaims | null> {
  if (!secret) return null
  const res = await verifyToken(token, secret, type)
  return res.ok ? res.claims : null
}
