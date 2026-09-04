/**
 * Email-verification tokens and the send/consume orchestration.
 *
 * Tokens are HMAC-signed (not encrypted), single-use, time-limited, and bound to both the
 * Firebase uid *and* the address that was on the account when we sent the mail. A stolen
 * link cannot verify a different inbox, and rotating the address after signup invalidates
 * outstanding mail. The jti is recorded in `email_verifications` so a replay after success
 * is a no-op rather than a second write.
 *
 * Signing secret is `EMAIL_VERIFY_SECRET` when set, otherwise the admin session secret with
 * an `email-verify:` purpose prefix so an admin cookie can never be confused for a verify link.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { env, envInt, isEmailLike, isHostAllowed, sanitizeLine } from '@/lib/security-core'
import { getSecurityConfig } from '@/lib/security'
import { randomId } from '@/lib/session-token'
import { isEmailAllowed } from '@/lib/email-validation'
import {
  emailFromAddress,
  isResendConfigured,
  sendEmail,
  verificationEmailHtml,
  verificationEmailSubject,
  verificationEmailText,
} from '@/lib/email'

export const EMAIL_VERIFY_TTL_MS = Math.max(1, envInt('EMAIL_VERIFY_TTL_HOURS', 24)) * 3_600_000
export const EMAIL_VERIFY_TTL_HOURS = Math.round(EMAIL_VERIFY_TTL_MS / 3_600_000)
const TOKEN_VERSION = 'ev1'
const CLOCK_SKEW_MS = 30_000

export type EmailVerifyClaims = {
  uid: string
  email: string
  iat: number
  exp: number
  jti: string
}

export type SendVerificationResult =
  | { ok: true; expiresAt: number; alreadyVerified?: boolean }
  | { ok: false; error: string; code: string; retryAfterSec?: number }

export type ConsumeVerificationResult =
  | { ok: true; uid: string; email: string; alreadyVerified?: boolean }
  | { ok: false; error: string; code: 'malformed' | 'signature' | 'expired' | 'used' | 'mismatch' | 'missing' | 'internal' }

function signingSecret(): string | null {
  const dedicated = env('EMAIL_VERIFY_SECRET').trim()
  if (dedicated.length >= 32) return `email-verify:${dedicated}`
  const cfg = getSecurityConfig()
  if (!cfg.secretReady) return null
  return `email-verify:${cfg.sessionSecret}`
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest()
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function equal(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

export function issueEmailVerifyToken(uid: string, email: string, now = Date.now()): { token: string; claims: EmailVerifyClaims } | null {
  const secret = signingSecret()
  if (!secret) return null
  const claims: EmailVerifyClaims = {
    uid,
    email: email.trim().toLowerCase(),
    iat: now,
    exp: now + EMAIL_VERIFY_TTL_MS,
    jti: randomId(16),
  }
  const payload = b64urlJson(claims)
  const sig = hmac(secret, `${TOKEN_VERSION}.${payload}`).toString('base64url')
  return { token: `${TOKEN_VERSION}.${payload}.${sig}`, claims }
}

export function readEmailVerifyToken(token: string | null | undefined, now = Date.now()): ConsumeVerificationResult & { claims?: EmailVerifyClaims } {
  if (!token || typeof token !== 'string') return { ok: false, error: 'Missing verification token.', code: 'malformed' }
  const secret = signingSecret()
  if (!secret) return { ok: false, error: 'Verification is not configured on this server.', code: 'internal' }

  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, error: 'That verification link is not valid.', code: 'malformed' }
  }
  const [, payloadB64, sigB64] = parts
  if (!payloadB64 || !sigB64 || payloadB64.length > 1024) {
    return { ok: false, error: 'That verification link is not valid.', code: 'malformed' }
  }

  let given: Buffer
  try {
    given = Buffer.from(sigB64, 'base64url')
  } catch {
    return { ok: false, error: 'That verification link is not valid.', code: 'malformed' }
  }
  const expected = hmac(secret, `${TOKEN_VERSION}.${payloadB64}`)
  if (!equal(expected, given)) {
    return { ok: false, error: 'That verification link is not valid.', code: 'signature' }
  }

  let claims: EmailVerifyClaims
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Partial<EmailVerifyClaims>
    if (
      typeof parsed.uid !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.jti !== 'string'
    ) {
      return { ok: false, error: 'That verification link is not valid.', code: 'malformed' }
    }
    claims = {
      uid: parsed.uid,
      email: parsed.email.trim().toLowerCase(),
      iat: parsed.iat,
      exp: parsed.exp,
      jti: parsed.jti,
    }
  } catch {
    return { ok: false, error: 'That verification link is not valid.', code: 'malformed' }
  }

  if (claims.exp + CLOCK_SKEW_MS <= now) {
    return { ok: false, error: 'That verification link has expired. Request a new one.', code: 'expired' }
  }
  if (claims.iat - CLOCK_SKEW_MS > now) {
    return { ok: false, error: 'That verification link is not valid yet.', code: 'malformed' }
  }
  return { ok: true, uid: claims.uid, email: claims.email, claims }
}

/**
 * Public origin used in the verification link. Honouring an untrusted Host would let an attacker
 * mint a mail whose button points at their own site, with our token on the query string.
 */
export function publicAppOrigin(req: { headers: { get(name: string): string | null }; nextUrl: { origin: string } }): string {
  const configured = env('NEXT_PUBLIC_APP_URL') || env('APP_URL') || env('RENDER_EXTERNAL_URL') || env('VERCEL_URL')
  if (configured) {
    const withProto = configured.startsWith('http') ? configured : `https://${configured}`
    return withProto.replace(/\/+$/, '')
  }
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  if (host && isHostAllowed(host)) return `${proto}://${host}`.replace(/\/+$/, '')
  return req.nextUrl.origin.replace(/\/+$/, '')
}

export async function sendVerificationForUser(input: {
  uid: string
  email: string
  name?: string
  origin: string
  ipHash?: string
}): Promise<SendVerificationResult> {
  const email = input.email.trim().toLowerCase()
  if (!isEmailLike(email)) {
    return { ok: false, error: 'Add a real email address to your account first.', code: 'invalid_email' }
  }
  if (!isEmailAllowed(email)) {
    return {
      ok: false,
      error: 'Temporary or disposable email addresses are not allowed. Use a real inbox you control.',
      code: 'disposable_email',
    }
  }
  if (!isResendConfigured()) {
    return {
      ok: false,
      error: 'Email delivery is not configured on this deployment. Set RESEND_API_KEY (and a verified EMAIL_FROM) to send verification mail.',
      code: 'email_unconfigured',
    }
  }

  try {
    const { getAuthAccountStateForUid } = await import('@/lib/firestore-admin')
    const state = await getAuthAccountStateForUid(input.uid)
    if (state?.emailVerified) {
      return { ok: true, expiresAt: Date.now(), alreadyVerified: true }
    }
  } catch (err) {
    console.warn('[email-verification] Auth lookup skipped:', err instanceof Error ? err.message : err)
  }

  const issued = issueEmailVerifyToken(input.uid, email)
  if (!issued) {
    return {
      ok: false,
      error: 'Verification tokens cannot be signed on this server (missing session secret).',
      code: 'signing_unconfigured',
    }
  }

  const verifyUrl = `${input.origin.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(issued.token)}`
  const name = sanitizeLine(input.name, 80)
  const sent = await sendEmail({
    to: email,
    subject: verificationEmailSubject(),
    html: verificationEmailHtml({ name, email, verifyUrl, expiresHours: EMAIL_VERIFY_TTL_HOURS }),
    text: verificationEmailText({ name, email, verifyUrl, expiresHours: EMAIL_VERIFY_TTL_HOURS }),
    tag: 'email-verification',
  })
  if (!sent.ok) {
    return { ok: false, error: sent.error, code: sent.code }
  }

  await persistIssuedToken({
    jti: issued.claims.jti,
    uid: input.uid,
    email,
    expiresAt: issued.claims.exp,
    ipHash: input.ipHash,
    resendId: sent.id,
    from: emailFromAddress(),
  }).catch((err) => {
    // The mail is already on the wire; losing the jti row means we cannot prove single-use, but
    // HMAC + expiry still hold. Do not fail the worker for a ledger write.
    console.warn('[email-verification] jti persist skipped:', err instanceof Error ? err.message : err)
  })

  return { ok: true, expiresAt: issued.claims.exp }
}

export async function consumeVerificationToken(token: string): Promise<ConsumeVerificationResult> {
  const read = readEmailVerifyToken(token)
  if (!read.ok || !read.claims) return read
  const { claims } = read

  try {
    const firestore = await import('@/lib/firestore-admin')
    const authState = await firestore.getAuthAccountStateForUid(claims.uid)
    if (!authState || authState.exists === false) {
      return { ok: false, error: 'That account no longer exists.', code: 'missing' }
    }
    if (authState.emailVerified) {
      await markTokenUsed(claims.jti).catch(() => {})
      return { ok: true, uid: claims.uid, email: claims.email, alreadyVerified: true }
    }

    const profile = await firestore.getUserProfile(claims.uid)
    const profileEmail = typeof profile?.email === 'string' ? profile.email.trim().toLowerCase() : ''
    if (profileEmail && profileEmail !== claims.email) {
      return {
        ok: false,
        error: 'This link was issued for a different address. Request a new verification email.',
        code: 'mismatch',
      }
    }

    const used = await claimToken(claims.jti, claims.uid)
    if (used === 'used') {
      return { ok: false, error: 'That verification link has already been used.', code: 'used' }
    }

    await firestore.markEmailVerified(claims.uid, claims.email)
    return { ok: true, uid: claims.uid, email: claims.email }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[email-verification] consume failed:', message)
    if (/mismatch|EMAIL/i.test(message)) {
      return { ok: false, error: 'This link does not match the account it was issued for.', code: 'mismatch' }
    }
    return { ok: false, error: 'We could not finish verification just now. Please retry.', code: 'internal' }
  }
}

async function persistIssuedToken(row: {
  jti: string
  uid: string
  email: string
  expiresAt: number
  ipHash?: string
  resendId: string
  from: string
}): Promise<void> {
  const { dbOrNull } = await import('@/lib/firestore-admin')
  const db = dbOrNull()
  if (!db) return
  await db.collection('email_verifications').doc(row.jti).set({
    jti: row.jti,
    uid: row.uid,
    email: row.email,
    createdAt: new Date().toISOString(),
    expiresAt: row.expiresAt,
    usedAt: null,
    ipHash: row.ipHash ?? '',
    resendId: row.resendId,
    from: row.from,
  })
}

async function claimToken(jti: string, uid: string): Promise<'ok' | 'used' | 'missing'> {
  const { dbOrNull } = await import('@/lib/firestore-admin')
  const db = dbOrNull()
  if (!db) return 'ok' // HMAC still binds the token; single-use is best-effort without the ledger
  const ref = db.collection('email_verifications').doc(jti)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) {
      // Mail was sent before the persist landed, or Firestore was down. Accept HMAC-valid tokens.
      tx.set(ref, { jti, uid, usedAt: new Date().toISOString(), recovered: true }, { merge: true })
      return 'ok'
    }
    const data = (snap.data() ?? {}) as { usedAt?: string | null; uid?: string }
    if (data.usedAt) return 'used'
    if (data.uid && data.uid !== uid) return 'used'
    tx.set(ref, { usedAt: new Date().toISOString() }, { merge: true })
    return 'ok'
  })
}

async function markTokenUsed(jti: string): Promise<void> {
  const { dbOrNull } = await import('@/lib/firestore-admin')
  const db = dbOrNull()
  if (!db) return
  await db.collection('email_verifications').doc(jti).set({ usedAt: new Date().toISOString() }, { merge: true })
}
