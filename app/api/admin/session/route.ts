import { NextRequest } from 'next/server'
import { ADMIN_COOKIE, BYPASS_COOKIE, LEGACY_ADMIN_COOKIES, getSecurityConfig } from '@/lib/security'
import { NO_STORE_HEADERS, isProduction } from '@/lib/security-core'
import { audit, json, resolveAdmin } from '@/lib/guards'

/**
 * /api/admin/session — the single answer to "am I allowed in here?".
 *
 * The client used to answer that question itself by checking whether a string existed in
 * `sessionStorage`, which meant any tab that could run `sessionStorage.setItem(...)` owned the
 * console. Now the browser asks, the server decides, and everything the decision touches
 * (expiry, revocation, roster membership) is re-checked on every privileged call anyway.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const principal = await resolveAdmin(req)
  console.log('[DEBUG] GET /api/admin/session - principal:', principal)
  if (!principal) {
    return json({ ok: true, authenticated: false, reason: 'no_session', signInPath: '/admin/login' })
  }

  // Heartbeat: keep the session's "last seen" fresh so the Security Centre can tell an active
  // tab from an abandoned one. Only revocable cookie sessions are tracked (Firebase tooling
  // tokens are not in the admin_sessions collection).
  if (principal.via === 'session-cookie' && !principal.jti.startsWith('uid:')) {
    try {
      const { isFirebaseAdminUsable, touchAdminSession } = await import('@/lib/firestore-admin')
      if (isFirebaseAdminUsable()) void touchAdminSession(principal.jti)
    } catch {
      /* a missed heartbeat must not affect the probe */
    }
  }

  return json({
    ok: true,
    authenticated: true,
    email: principal.email,
    via: principal.via,
    // Resolved server-side on every probe: the console UI adapts (nav, owner-only areas), but
    // authority is enforced by the API guards, not by this field.
    role: principal.role,
    jti: principal.via === 'session-cookie' && !principal.jti.startsWith('uid:') ? principal.jti : undefined,
    expiresAt: new Date(principal.expiresAt).toISOString(),
    remainingSeconds: Math.max(0, Math.floor((principal.expiresAt - Date.now()) / 1000)),
    sessionMinutes: Math.round(getSecurityConfig().sessionTtlMs / 60_000),
  })
}

export async function POST(req: NextRequest) {
  return handleLogout(req)
}

export async function DELETE(req: NextRequest) {
  return handleLogout(req)
}

async function handleLogout(req: NextRequest) {
  const principal = await resolveAdmin(req)
  const secure = isProduction()

  if (principal?.jti && !principal.jti.startsWith('uid:')) {
    // Sign-out closes the live-session record immediately (the cookie is also deleted below).
    // We deliberately revoke the jti too: deleting a cookie only hides the key, while a copy
    // taken by malware, a proxy log or a devtools session would otherwise keep working until
    // natural expiry. Revocation is what makes "sign out" actually sign the token out.
    try {
      const { isFirebaseAdminUsable, revokeAdminSession } = await import('@/lib/firestore-admin')
      if (isFirebaseAdminUsable()) {
        await revokeAdminSession(principal.jti, principal.email)
      }
    } catch (err) {
      console.warn('[admin/session] revoke write failed:', err)
    }
  }

  if (principal) {
    await audit({
      action: 'ADMIN_LOGOUT',
      actorEmail: principal.email,
      details: { jti: principal.jti, via: principal.via },
      req,
    })
  }
  // Anonymous logout attempts (stale or missing cookie) are a no-op, not an error: the browser
  // clears the cookie and moves on.

  const cleared = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/', maxAge: 0 }
  const res = json({ ok: true, signedOut: true })
  res.cookies.set(ADMIN_COOKIE, '', cleared)
  res.cookies.set(BYPASS_COOKIE, '', cleared)
  for (const legacy of LEGACY_ADMIN_COOKIES) res.cookies.set(legacy, '', cleared)
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) res.headers.set(key, value)
  return res
}
