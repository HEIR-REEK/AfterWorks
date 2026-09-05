/**
 * Self-service password reset via a one-time code emailed through Resend.
 *
 * Why not Firebase's `sendPasswordResetEmail()`: it mails from a Firebase domain with a template
 * we cannot brand, lands in spam for most Kenyan inboxes, and its link opens a Firebase-hosted
 * page. The member never leaves our domain here, and the transactional mail comes from EMAIL_FROM
 * like signup verification does.
 *
 * Flow (three routes under /api/auth/password-reset):
 *
 *   1. request  { email }                    → email a 6-digit code (same answer whether or not the
 *                                              address exists — no account enumeration).
 *   2. verify   { email, code }              → check the code, hand back a short-lived signed
 *                                              *reset ticket*.
 *   3. complete { ticket, password }         → set the new password, revoke refresh tokens.
 *
 * Storage: one document per address in `password_resets` (doc id = HMAC of the email, so the
 * collection is not a plaintext list of who forgot their password). The document holds an HMAC
 * of the code, never the code itself; the mail is the only copy. Requesting again replaces the
 * previous challenge, so at most one code is live per address.
 *
 * Guessing budget: `PASSWORD_RESET_MAX_ATTEMPTS` (default 5) wrong codes burns the challenge and
 * the member must request a fresh one; the request itself is throttled per address and per IP.
 * A 6-digit code with five guesses is a 1-in-200 000 chance per challenge, and each challenge
 * costs an email the attacker cannot read.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { env, envInt, isEmailLike, sanitizeLine } from '@/lib/security-core'
import { attemptKey, clearAttemptBudget, getSecurityConfig, registerFailedAttempt, checkAttemptBudget } from '@/lib/security'
import { randomId } from '@/lib/session-token'
import {
  emailFromAddress,
  isResendConfigured,
  passwordResetEmailHtml,
  passwordResetEmailSubject,
  passwordResetEmailText,
  sendEmail,
} from '@/lib/email'

export const PASSWORD_RESET_CODE_TTL_MS = Math.max(3, envInt('PASSWORD_RESET_CODE_TTL_MINUTES', 15)) * 60_000
export const PASSWORD_RESET_CODE_TTL_MINUTES = Math.round(PASSWORD_RESET_CODE_TTL_MS / 60_000)
export const PASSWORD_RESET_TICKET_TTL_MS = Math.max(2, envInt('PASSWORD_RESET_TICKET_TTL_MINUTES', 10)) * 60_000
export const PASSWORD_RESET_MAX_ATTEMPTS = Math.max(3, Math.min(10, envInt('PASSWORD_RESET_MAX_ATTEMPTS', 5)))
/** Minimum seconds between two codes for the same address (stops the "resend" button being a mail cannon). */
export const PASSWORD_RESET_RESEND_COOLDOWN_SEC = Math.max(20, envInt('PASSWORD_RESET_RESEND_COOLDOWN_SECONDS', 60))
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 200

const COLLECTION = 'password_resets'
const TICKET_VERSION = 'pr1'
const CODE_LENGTH = 6
const CLOCK_SKEW_MS = 30_000

// ─── Secrets ─────────────────────────────────────────────────────────────────

function secretOrNull(purpose: 'code' | 'ticket' | 'docid'): string | null {
  const dedicated = env('PASSWORD_RESET_SECRET').trim()
  if (dedicated.length >= 32) return `password-reset:${purpose}:${dedicated}`
  const cfg = getSecurityConfig()
  if (!cfg.secretReady) return null
  return `password-reset:${purpose}:${cfg.sessionSecret}`
}

function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex')
}

function equalHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ba.length !== bb.length || ba.length === 0) return false
  return timingSafeEqual(ba, bb)
}

/** Doc id for an address: stable, non-reversible, so the collection is not a list of emails. */
function docIdFor(email: string): string | null {
  const secret = secretOrNull('docid')
  if (!secret) return null
  return hmacHex(secret, email).slice(0, 40)
}

function codeDigest(email: string, jti: string, code: string): string | null {
  const secret = secretOrNull('code')
  if (!secret) return null
  return hmacHex(secret, `${email}\n${jti}\n${code}`)
}

export function normaliseCode(input: unknown): string {
  return String(input ?? '').replace(/\D+/g, '').slice(0, CODE_LENGTH)
}

function generateCode(): string {
  // randomInt is CSPRNG-backed and unbiased; zero-pad so "004213" is a valid code.
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

export function formatCodeForDisplay(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`
}

// ─── Password policy (shared with the client via the same constants) ─────────

export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== 'string') return 'Enter a new password.'
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password.length > MAX_PASSWORD_LENGTH) return 'That password is too long.'
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Mix letters and numbers.'
  const lowered = password.toLowerCase()
  if (['password', 'afterworks', '12345678', 'qwerty', 'letmein'].some((weak) => lowered.includes(weak))) {
    return 'That password is too common. Pick something only you would guess.'
  }
  return null
}

// ─── Step 1: request ─────────────────────────────────────────────────────────

type ChallengeDoc = {
  jti: string
  emailHash: string
  uid: string
  codeHash: string
  createdAt: string
  expiresAt: number
  attempts: number
  burnedAt: string | null
  verifiedAt: string | null
  consumedAt: string | null
  ipHash: string
  resendId: string
  from: string
}

export type RequestResetResult =
  | { ok: true; sent: boolean; expiresAt: number; cooldownSec: number }
  | { ok: false; error: string; code: string; retryAfterSec?: number }

/**
 * Sends a code if — and only if — the address belongs to a live account. Callers must present
 * the same message either way; the boolean `sent` is for the audit log, not the response body.
 */
export async function requestPasswordReset(input: { email: string; ipHash: string }): Promise<RequestResetResult> {
  const email = input.email.trim().toLowerCase()
  if (!isEmailLike(email)) return { ok: false, error: 'Enter the email address you signed up with.', code: 'invalid_email' }
  if (!isResendConfigured()) {
    return {
      ok: false,
      error: 'Password reset email is not configured on this deployment. Contact support to regain access.',
      code: 'email_unconfigured',
    }
  }
  const docId = docIdFor(email)
  if (!docId) return { ok: false, error: 'Password reset is unavailable until the server signing secret is configured.', code: 'signing_unconfigured' }

  // Per-address budget for *requests*: a bounded number of mails per window, plus a cooldown
  // between two codes so the resend button cannot be hammered.
  const resetKey = attemptKey('reset', email)
  const budget = checkAttemptBudget(resetKey)
  if (!budget.allowed) {
    return { ok: false, error: 'Too many reset codes were requested for this address. Please wait before trying again.', code: 'rate_limited', retryAfterSec: budget.retryAfterSec }
  }

  const firestore = await import('@/lib/firestore-admin')
  const db = firestore.isFirebaseAdminUsable() ? firestore.dbOrNull() : null
  if (!db) return { ok: false, error: 'Password reset is unavailable right now. Please try again shortly.', code: 'storage_unavailable' }

  const now = Date.now()
  const ref = db.collection(COLLECTION).doc(docId)
  const existing = (await ref.get().catch(() => null))?.data() as ChallengeDoc | undefined
  if (existing && !existing.consumedAt) {
    const sinceLast = now - Date.parse(existing.createdAt)
    if (Number.isFinite(sinceLast) && sinceLast < PASSWORD_RESET_RESEND_COOLDOWN_SEC * 1000) {
      const wait = Math.ceil((PASSWORD_RESET_RESEND_COOLDOWN_SEC * 1000 - sinceLast) / 1000)
      return { ok: false, error: `A code was sent moments ago. Check your inbox and spam folder, or try again in ${wait}s.`, code: 'cooldown', retryAfterSec: wait }
    }
  }

  // Count the request against the address budget whether or not the account exists, so probing
  // unknown addresses costs the same as hammering a real one.
  registerFailedAttempt(resetKey)

  const target = await firestore.findPasswordResetTarget(email)
  if (!target || target.disabled) {
    // Do not reveal which. The audit row lets an operator see the miss.
    return { ok: true, sent: false, expiresAt: now + PASSWORD_RESET_CODE_TTL_MS, cooldownSec: PASSWORD_RESET_RESEND_COOLDOWN_SEC }
  }

  const code = generateCode()
  const jti = randomId(12)
  const codeHash = codeDigest(target.email, jti, code)
  if (!codeHash) return { ok: false, error: 'Password reset is unavailable until the server signing secret is configured.', code: 'signing_unconfigured' }

  const sent = await sendEmail({
    to: target.email,
    subject: passwordResetEmailSubject(code),
    html: passwordResetEmailHtml({ name: target.name, email: target.email, code: formatCodeForDisplay(code), expiresMinutes: PASSWORD_RESET_CODE_TTL_MINUTES }),
    text: passwordResetEmailText({ name: target.name, email: target.email, code: formatCodeForDisplay(code), expiresMinutes: PASSWORD_RESET_CODE_TTL_MINUTES }),
    tag: 'password-reset',
  })
  if (!sent.ok) return { ok: false, error: sent.error, code: sent.code }

  const doc: ChallengeDoc = {
    jti,
    emailHash: docId,
    uid: target.uid,
    codeHash,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + PASSWORD_RESET_CODE_TTL_MS,
    attempts: 0,
    burnedAt: null,
    verifiedAt: null,
    consumedAt: null,
    ipHash: sanitizeLine(input.ipHash, 64),
    resendId: sent.id,
    from: emailFromAddress(),
  }
  // Replacing (not merging) is the point: the previous code is dead the moment a new one is sent.
  await ref.set(doc)

  return { ok: true, sent: true, expiresAt: doc.expiresAt, cooldownSec: PASSWORD_RESET_RESEND_COOLDOWN_SEC }
}

// ─── Step 2: verify the code, mint a ticket ──────────────────────────────────

export type TicketClaims = { uid: string; email: string; jti: string; iat: number; exp: number }

function issueTicket(claims: Omit<TicketClaims, 'iat' | 'exp'>, now = Date.now()): string | null {
  const secret = secretOrNull('ticket')
  if (!secret) return null
  const full: TicketClaims = { ...claims, iat: now, exp: now + PASSWORD_RESET_TICKET_TTL_MS }
  const payload = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(`${TICKET_VERSION}.${payload}`).digest('base64url')
  return `${TICKET_VERSION}.${payload}.${sig}`
}

export function readTicket(ticket: unknown, now = Date.now()): { ok: true; claims: TicketClaims } | { ok: false; error: string; code: 'malformed' | 'expired' | 'internal' } {
  if (typeof ticket !== 'string' || ticket.length > 2048) return { ok: false, error: 'Start the reset again.', code: 'malformed' }
  const secret = secretOrNull('ticket')
  if (!secret) return { ok: false, error: 'Password reset is not configured on this server.', code: 'internal' }
  const parts = ticket.split('.')
  if (parts.length !== 3 || parts[0] !== TICKET_VERSION) return { ok: false, error: 'Start the reset again.', code: 'malformed' }
  const [, payload, sig] = parts
  const expected = createHmac('sha256', secret).update(`${TICKET_VERSION}.${payload}`).digest()
  let given: Buffer
  try {
    given = Buffer.from(sig, 'base64url')
  } catch {
    return { ok: false, error: 'Start the reset again.', code: 'malformed' }
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, error: 'Start the reset again.', code: 'malformed' }
  let claims: TicketClaims
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<TicketClaims>
    if (typeof parsed.uid !== 'string' || typeof parsed.email !== 'string' || typeof parsed.jti !== 'string' || typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number') {
      return { ok: false, error: 'Start the reset again.', code: 'malformed' }
    }
    claims = { uid: parsed.uid, email: parsed.email.toLowerCase(), jti: parsed.jti, iat: parsed.iat, exp: parsed.exp }
  } catch {
    return { ok: false, error: 'Start the reset again.', code: 'malformed' }
  }
  if (claims.exp + CLOCK_SKEW_MS <= now) return { ok: false, error: 'That reset session expired. Request a new code.', code: 'expired' }
  if (claims.iat - CLOCK_SKEW_MS > now) return { ok: false, error: 'Start the reset again.', code: 'malformed' }
  return { ok: true, claims }
}

export type VerifyCodeResult =
  | { ok: true; ticket: string; uid: string; email: string; ticketExpiresAt: number }
  | { ok: false; error: string; code: 'invalid_code' | 'expired' | 'burned' | 'missing' | 'rate_limited' | 'internal'; attemptsLeft?: number; retryAfterSec?: number }

export async function verifyPasswordResetCode(input: { email: string; code: string; ipHash: string }): Promise<VerifyCodeResult> {
  const email = input.email.trim().toLowerCase()
  const code = normaliseCode(input.code)
  const generic = 'That code is not right. Check the latest email we sent and try again.'
  if (!isEmailLike(email) || code.length !== CODE_LENGTH) return { ok: false, error: generic, code: 'invalid_code' }

  const docId = docIdFor(email)
  if (!docId) return { ok: false, error: 'Password reset is not configured on this server.', code: 'internal' }

  // Guess budget per address, independent of the document counter, so the lockout store (which
  // staff can clear from the console) also throttles code guessing across many challenges.
  const otpKey = attemptKey('otp', email)
  const budget = checkAttemptBudget(otpKey)
  if (!budget.allowed) return { ok: false, error: 'Too many wrong codes. Wait a while, then request a new code.', code: 'rate_limited', retryAfterSec: budget.retryAfterSec }

  const firestore = await import('@/lib/firestore-admin')
  const db = firestore.isFirebaseAdminUsable() ? firestore.dbOrNull() : null
  if (!db) return { ok: false, error: 'Password reset is unavailable right now. Please try again shortly.', code: 'internal' }

  const ref = db.collection(COLLECTION).doc(docId)
  const now = Date.now()

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { kind: 'missing' as const }
    const doc = snap.data() as ChallengeDoc
    if (doc.consumedAt) return { kind: 'missing' as const }
    if (doc.burnedAt) return { kind: 'burned' as const }
    if (doc.expiresAt + CLOCK_SKEW_MS <= now) return { kind: 'expired' as const }

    const expected = codeDigest(email, doc.jti, code)
    if (expected && equalHex(expected, doc.codeHash)) {
      tx.set(ref, { verifiedAt: new Date(now).toISOString() }, { merge: true })
      return { kind: 'ok' as const, doc }
    }
    const attempts = (doc.attempts ?? 0) + 1
    const burned = attempts >= PASSWORD_RESET_MAX_ATTEMPTS
    tx.set(ref, { attempts, burnedAt: burned ? new Date(now).toISOString() : null }, { merge: true })
    return { kind: 'wrong' as const, attemptsLeft: Math.max(0, PASSWORD_RESET_MAX_ATTEMPTS - attempts), burned }
  })

  switch (outcome.kind) {
    case 'missing':
      registerFailedAttempt(otpKey)
      return { ok: false, error: 'No active reset for this address. Request a new code.', code: 'missing' }
    case 'expired':
      return { ok: false, error: 'That code has expired. Request a new one.', code: 'expired' }
    case 'burned':
      return { ok: false, error: 'That code was locked after too many wrong attempts. Request a new one.', code: 'burned' }
    case 'wrong': {
      registerFailedAttempt(otpKey)
      if (outcome.burned) {
        return { ok: false, error: 'Too many wrong attempts — that code is now locked. Request a new one.', code: 'burned', attemptsLeft: 0 }
      }
      return { ok: false, error: generic, code: 'invalid_code', attemptsLeft: outcome.attemptsLeft }
    }
    case 'ok': {
      clearAttemptBudget(otpKey)
      const ticket = issueTicket({ uid: outcome.doc.uid, email, jti: outcome.doc.jti }, now)
      if (!ticket) return { ok: false, error: 'Password reset is not configured on this server.', code: 'internal' }
      return { ok: true, ticket, uid: outcome.doc.uid, email, ticketExpiresAt: now + PASSWORD_RESET_TICKET_TTL_MS }
    }
  }
}

// ─── Step 3: complete ────────────────────────────────────────────────────────

export type CompleteResetResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; error: string; code: string }

export async function completePasswordResetWithTicket(input: { ticket: unknown; password: unknown }): Promise<CompleteResetResult> {
  const read = readTicket(input.ticket)
  if (!read.ok) return { ok: false, error: read.error, code: read.code }
  const { claims } = read

  const policy = passwordPolicyError(input.password)
  if (policy) return { ok: false, error: policy, code: 'weak_password' }
  const password = input.password as string

  const docId = docIdFor(claims.email)
  if (!docId) return { ok: false, error: 'Password reset is not configured on this server.', code: 'internal' }

  const firestore = await import('@/lib/firestore-admin')
  const db = firestore.isFirebaseAdminUsable() ? firestore.dbOrNull() : null
  if (!db) return { ok: false, error: 'Password reset is unavailable right now. Please try again shortly.', code: 'storage_unavailable' }

  const ref = db.collection(COLLECTION).doc(docId)
  const now = new Date().toISOString()

  // Single use: the ticket is bound to the challenge jti, and the challenge is consumed here.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return 'missing' as const
    const doc = snap.data() as ChallengeDoc
    if (doc.jti !== claims.jti || doc.uid !== claims.uid) return 'missing' as const
    if (doc.consumedAt) return 'used' as const
    if (!doc.verifiedAt) return 'unverified' as const
    tx.set(ref, { consumedAt: now }, { merge: true })
    return 'ok' as const
  })
  if (claimed === 'used') return { ok: false, error: 'That reset was already completed. Sign in with your new password.', code: 'used' }
  if (claimed !== 'ok') return { ok: false, error: 'That reset session is no longer valid. Request a new code.', code: 'invalid_ticket' }

  const result = await firestore.completePasswordReset(claims.uid, password)
  if (!result.ok) {
    // Give the ticket back: the challenge was consumed but Auth did not change, so let them retry
    // the same ticket rather than forcing another email.
    await ref.set({ consumedAt: null }, { merge: true }).catch(() => {})
    return { ok: false, error: result.error ?? 'The password could not be updated.', code: result.code ?? 'auth_write_failed' }
  }

  // Password is new: clear every lockout keyed on this address so the first sign-in works.
  clearAttemptBudget(attemptKey('email', claims.email), attemptKey('reset', claims.email), attemptKey('otp', claims.email))
  return { ok: true, uid: claims.uid, email: claims.email }
}
