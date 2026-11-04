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
import { env, envBool, envInt, isEmailLike, isProduction, parseEmailList, NO_STORE_HEADERS } from '@/lib/security-core'
import { audit, consumeBucket, fail, json, requestContext, resolveAdmin, type AdminRole } from '@/lib/guards'

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

  // 4+5. Identify the account, then verify *its own* credential (constant-time by construction:
  // hash the candidate, compare digests).
  //
  //   • owner  — email on the ADMIN_EMAILS roster; signs in with the shared master passcode.
  //   • staff  — an `admin_accounts` entry created by the owner on the Staff page, with an
  //              individual password the owner chose.
  //   • staff with an existing worker account — no `admin_accounts` entry needed: the owner taps
  //     "Make staff" in the Users drawer (which sets the rules-protected `users.isAdmin` label),
  //     and the member signs in here with the SAME email + password they use on the worker app.
  //     The password is verified against Firebase Auth server-side before any session exists.
  const roster = parseEmailList(env('ADMIN_EMAILS'))
  let role: AdminRole | null = null
  let credential: 'master' | 'staff-account' | 'firebase-account' = 'master'
  let passcodeOk = false

  if (roster.includes(email)) {
    role = 'owner'
    if (cfg.passcode.source === 'none') {
      return fail(503, 'No admin passcode is configured. Sign in with a staff Firebase account instead.', {
        code: 'passcode_unconfigured',
      })
    }
    passcodeOk = verifyPasscode(cfg.passcode.value, passcode)
  } else {
    try {
      const firestore = await import('@/lib/firestore-admin')
      const account = await firestore.getAdminAccount(email)
      if (account && account.status === 'disabled') {
        return reject('This staff account has been disabled by the main administrator.', 'staff_disabled')
      }
      if (account && account.passcodeHash) {
        role = account.role === 'owner' ? 'owner' : 'staff'
        credential = 'staff-account'
        passcodeOk = verifyPasscode(account.passcodeHash, passcode)
      } else {
        // No separate console account: try the worker-app credential (Firebase Auth password).
        // Only a profile the owner marked as staff gets a console session from it — the label
        // itself is never trusted as a credential, and firestore.rules keeps members from
        // setting it on their own document.
        const firebase = await signInWithFirebasePassword(email, passcode)
        if (firebase) {
          const labelRole = await firestore.getUserRoleByEmail(firebase.email)
          if (labelRole === 'staff') {
            role = 'staff'
            credential = 'firebase-account'
            passcodeOk = true
          }
        }
      }
    } catch (err) {
      console.warn('[admin/auth] account lookup failed:', err)
    }
  }

  if (!role) return reject('Invalid administrator credentials.', 'not_privileged')
  if (!passcodeOk) return reject('Invalid administrator credentials.', 'bad_passcode')

  // 6. Issue the session.
  const session = await createAdminSession(email)
  if (!session) return fail(500, 'Could not establish an administrator session.', { code: 'session_failed' })
  const bypass = await createBypassSession(email)

  clearAttemptBudget(ipKey, attemptKey('email', email))

  await audit({
    action: 'ADMIN_LOGIN_SUCCESS',
    actorEmail: email,
    details: { jti: session.jti, role, credential, ip: ctx.identity.ipHash, expiresAt: new Date(session.expiresAt).toISOString() },
    req,
  })

  // Staff-account heartbeat for the Staff page ("last sign-in"), fire-and-forget.
  if (credential === 'staff-account') {
    try {
      const { isFirebaseAdminUsable, touchAdminAccountSignIn } = await import('@/lib/firestore-admin')
      if (isFirebaseAdminUsable()) void touchAdminAccountSignIn(email)
    } catch {
      /* cosmetic field — never fail a sign-in over it */
    }
  }

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
    // Convenience for the UI only — every privileged request re-resolves the role server-side.
    role,
    session: {
      // Deliberately no token here: the HttpOnly cookie is the only carrier of privilege.
      mode: 'http-only-cookie',
      expiresAt: new Date(session.expiresAt).toISOString(),
      remainingSeconds: maxAge,
    },
  })

  // A browser-session cookie: closing the browser drops it, so reopening the console always means
  // signing in again. The server is unchanged and still the authority — `expiresAt` bounds the
  // session absolutely and the revocation list can end it at any moment — but a key the browser
  // throws away on close is what makes "I closed Chrome and it was still logged in" impossible.
  // `ADMIN_SESSION_PERSIST=true` restores a durable cookie for an operator who wants to stay signed
  // in on a machine they control.
  const persistCookie = envBool('ADMIN_SESSION_PERSIST', false)
  response.cookies.set(ADMIN_COOKIE, session.token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    ...(persistCookie ? { maxAge } : {}),
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

  // No custom-claim sync here. `admin` is not a Firestore credential any more: the rules do not
  // trust it, and minting it from a mutable profile email was a privilege-escalation path. Console
  // authority is the HttpOnly session cookie, re-resolved against ADMIN_EMAILS/admin_accounts on
  // every request.
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value)
  return response
}

/**
 * GET /api/admin/auth — capability probe. The sign-in screen asks this before it renders, so a
 * misconfigured deployment shows "console unavailable" instead of a form that can never work.
 */
export async function GET(req: NextRequest) {
  const cfg = getSecurityConfig()
  // The sign-in screen is anonymous, so it may only learn whether the door exists. Lockout
  // thresholds, session TTL and deployment mode are useful reconnaissance and are only returned
  // once the caller has a valid console session.
  const publicCapabilities = {
    ok: true,
    consoleEnabled: cfg.secretReady,
    passcodeEnabled: cfg.passcode.source !== 'none',
    rosterConfigured: cfg.adminEmails.length > 0,
  }
  const admin = await resolveAdmin(req)
  if (!admin) return json(publicCapabilities)
  return json({
    ...publicCapabilities,
    passcodeSource: cfg.passcode.source,
    lockoutThreshold: cfg.lockoutThreshold,
    lockoutMinutes: Math.round(cfg.lockoutMs / 60_000),
    sessionMinutes: Math.round(cfg.sessionTtlMs / 60_000),
    production: isProduction(),
  })
}

/**
 * Verify an email+password pair against Firebase Auth (Identity Toolkit REST) and, on success,
 * verify the returned ID token with the Admin SDK. Returns the canonical email + uid, or null.
 *
 * Used for the "staff who already has a worker account" door: the owner marks the member staff
 * in the Users drawer, and that member signs in to /admin/login with the same credentials they
 * use on the worker app. The profile label alone never grants anything — the password must be
 * valid AND the label must be set.
 */
async function signInWithFirebasePassword(
  email: string,
  password: string,
): Promise<{ email: string; uid: string } | null> {
  const apiKey = env('FIREBASE_WEB_API_KEY') || env('NEXT_PUBLIC_FIREBASE_API_KEY')
  if (!apiKey) return null
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
        cache: 'no-store',
      },
    )
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { idToken?: string } | null
    if (!data?.idToken) return null
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return null
    const decoded = await firestore.verifyIdToken(data.idToken)
    if (!decoded) return null
    const verifiedEmail = String(decoded.email ?? '').trim().toLowerCase()
    if (!verifiedEmail || verifiedEmail !== email.trim().toLowerCase()) return null
    return { email: verifiedEmail, uid: decoded.uid }
  } catch {
    return null
  }
}
