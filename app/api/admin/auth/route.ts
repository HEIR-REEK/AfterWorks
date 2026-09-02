import { NextRequest, NextResponse } from 'next/server'
import {
  ADMIN_COOKIE,
  attemptKey,
  BYPASS_COOKIE,
  checkAttemptBudget,
  clearAttemptBudget,
  createAdminSession,
  createBypassSession,
  getSecurityConfig,
  registerFailedAttempt,
  verifyPasscode,
} from '@/lib/security'
import { envBool, envInt, isEmailLike, isProduction, NO_STORE_HEADERS } from '@/lib/security-core'
import { audit, consumeBucket, fail, json, requestContext, isPrivilegedEmail } from '@/lib/guards'

/**
 * POST /api/admin/auth — the only door into the operations console.
 *
 * Hardening notes (each of these was a real defect in the previous version):
 *  • the passcode was reachable from the browser bundle via `NEXT_PUBLIC_ADMIN_PASSWORD`
 *  • `password.length === configured.length` short-circuited the comparison and leaked the
 *    passcode length; the raw compare was not constant time
 *  • the session token was signed with a *hardcoded fallback secret* and its expiry was never
 *    checked, so a token minted once stayed valid forever
 *  • failures were counted per IP from a spoofable `x-forwarded-for` on an unpruned Map, so an
 *    attacker could reset their budget and grow the heap at the same time
 *  • the minted token was handed to the browser, which stored it in `sessionStorage`, and the app
 *    treated "a token exists" as "is admin" — an XSS bug became a durable admin session
 *
 * Now: scrypt-verified passcode, dual lockout budget (IP **and** target email), signed session
 * with expiry + revocation, and an HttpOnly SameSite=strict cookie as the only carrier of
 * privilege. The response body deliberately contains no reusable credential.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = requestContext(req)
  const cfg = getSecurityConfig()
  const ipKey = attemptKey('ip', ctx.identity.ipHash)

  // 1. Lockout budget, checked before anything is parsed.
  const budget = checkAttemptBudget(ipKey)
  if (!budget.allowed) {
    return fail(429, 'Sign-in is temporarily locked after repeated failures. Please try again later.', {
      code: 'login_locked',
      retryAfterSec: budget.retryAfterSec,
      remainingAttempts: 0,
      headers: { 'Retry-After': String(budget.retryAfterSec || cfg.lockoutMs / 1000) },
    })
  }

  // 2. Independent request-rate bucket for this endpoint.
  const bucket = consumeBucket('admin-auth', envInt('ADMIN_LOGIN_RATE_PER_MINUTE', 8), 60_000, ctx.identity.ipHash)
  if (!bucket.ok) {
    return fail(429, 'Too many sign-in attempts. Please slow down.', {
      code: 'rate_limited',
      headers: { 'Retry-After': String(bucket.retryAfterSec) },
    })
  }

  // 3. Body: capped, typed, never echoed back.
  let email = ''
  let passcode = ''
  try {
    const raw = await req.text()
    if (raw.length > 8_000) return fail(413, 'Request payload is too large.', { code: 'payload_too_large' })
    const body = (raw.trim() ? JSON.parse(raw) : {}) as Record<string, unknown>
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    passcode = typeof body.password === 'string' ? body.password : typeof body.passcode === 'string' ? body.passcode : ''
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }

  const reject = async (message: string, code: string) => {
    const outcome = registerFailedAttempt(ipKey, attemptKey('email', email || 'blank'))
    await audit({
      action: 'ADMIN_LOGIN_FAILED',
      actorEmail: email || undefined,
      details: {
        reason: code,
        ip: ctx.identity.ipHash,
        remaining: outcome.remaining,
        locked: outcome.locked,
        ua: ctx.identity.userAgent.slice(0, 120),
      },
      req,
    })
    return fail(outcome.locked ? 429 : 401, message, {
      code,
      remainingAttempts: outcome.remaining,
      locked: outcome.locked,
      headers: outcome.locked ? { 'Retry-After': String(Math.ceil(cfg.lockoutMs / 1000)) } : undefined,
    })
  }

  if (!email || !passcode) return reject('Enter your administrator email and passcode.', 'missing_credentials')
  if (!isEmailLike(email)) return reject('Enter your administrator email and passcode.', 'invalid_email')
  if (passcode.length > 200) return reject('That passcode is too long.', 'passcode_too_long')

  if (!cfg.secretReady) {
    return fail(503, 'The admin console is disabled until ADMIN_SESSION_SECRET is configured on the server.', {
      code: 'console_unconfigured',
    })
  }

  // 4. Roster check first — the passcode alone is never sufficient.
  if (!(await isPrivilegedEmail(email))) return reject('Invalid administrator credentials.', 'not_privileged')

  // 5. Passcode (constant-time by construction: hash the candidate, compare digests).
  if (cfg.passcode.source === 'none') {
    return fail(503, 'No admin passcode is configured. Sign in with a staff Firebase account instead.', {
      code: 'passcode_unconfigured',
    })
  }
  if (!verifyPasscode(cfg.passcode.value, passcode)) return reject('Invalid administrator credentials.', 'bad_passcode')

  // 6. Issue the session.
  const session = await createAdminSession(email)
  if (!session) return fail(500, 'Could not establish an administrator session.', { code: 'session_failed' })
  const bypass = await createBypassSession(email)

  clearAttemptBudget(ipKey, attemptKey('email', email))

  await audit({
    action: 'ADMIN_LOGIN_SUCCESS',
    actorEmail: email,
    details: { jti: session.jti, ip: ctx.identity.ipHash, expiresAt: new Date(session.expiresAt).toISOString() },
    req,
  })

  // Record the live session (server-only collection) so the Security Centre can list active
  // operators and revoke a single device. Never contains the token or any secret.
  if (envBool('ADMIN_TRACK_SESSIONS', true)) {
    try {
      const { isFirebaseAdminUsable, recordAdminSession } = await import('@/lib/firestore-admin')
      if (isFirebaseAdminUsable()) {
        await recordAdminSession({
          jti: session.jti,
          email,
          issuedAt: session.issuedAt,
          expiresAt: session.expiresAt,
          ipHash: ctx.identity.ipHash,
          userAgent: ctx.identity.userAgent,
        })
      }
    } catch (err) {
      console.warn('[admin/auth] session tracking skipped:', err)
    }
  }

  const maxAge = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000))
  const secure = isProduction() || envBool('FORCE_SECURE_COOKIES', false)
  const response = NextResponse.json({
    ok: true,
    email,
    session: {
      // Deliberately no token here: the HttpOnly cookie is the only carrier of privilege.
      mode: 'http-only-cookie',
      expiresAt: new Date(session.expiresAt).toISOString(),
      remainingSeconds: maxAge,
    },
  })

  response.cookies.set(ADMIN_COOKIE, session.token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge,
  })
  if (bypass) {
    response.cookies.set(BYPASS_COOKIE, bypass, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: 12 * 60 * 60,
    })
  }
  // Clear the legacy cookie the previous client wrote (it was readable by JS).
  response.cookies.set('afterworks_admin_session', '', { httpOnly: true, secure, path: '/', maxAge: 0 })

  // Keep the `admin` custom claim in sync so firestore.rules can trust the token rather than
  // paying a document read on every request.
  if (envBool('ADMIN_SYNC_CUSTOM_CLAIM', true)) {
    try {
      const { isFirebaseAdminUsable } = await import('@/lib/firestore-admin')
      if (isFirebaseAdminUsable()) {
        const { setUserAdminFlagByEmail } = await import('@/lib/firestore-admin')
        await setUserAdminFlagByEmail(email, true, email)
      }
    } catch (err) {
      console.warn('[admin/auth] custom claim sync skipped:', err)
    }
  }

  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value)
  return response
}

/**
 * GET /api/admin/auth — capability probe. The sign-in screen asks this before it renders, so a
 * misconfigured deployment shows "console unavailable" instead of a form that can never work.
 */
export async function GET() {
  const cfg = getSecurityConfig()
  return json({
    ok: true,
    consoleEnabled: cfg.secretReady,
    passcodeEnabled: cfg.passcode.source !== 'none',
    passcodeSource: cfg.passcode.source,
    rosterConfigured: cfg.adminEmails.length > 0,
    lockoutThreshold: cfg.lockoutThreshold,
    lockoutMinutes: Math.round(cfg.lockoutMs / 60_000),
    sessionMinutes: Math.round(cfg.sessionTtlMs / 60_000),
    production: isProduction(),
  })
}
