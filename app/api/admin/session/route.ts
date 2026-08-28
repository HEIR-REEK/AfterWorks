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
  if (!principal) {
    return json({ ok: true, authenticated: false, reason: 'no_session', signInPath: '/admin/login' })
  }

  return json({
    ok: true,
    authenticated: true,
    email: principal.email,
    via: principal.via,
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
    // Revoking the jti is what makes "sign out" actually sign out — deleting a cookie only hides
    // the key, and a copy taken by malware, a proxy log or a devtools session still works without it.
    try {
      const { isFirebaseAdminUsable, revokeAdminSession } = await import('@/lib/firestore-admin')
      if (isFirebaseAdminUsable()) await revokeAdminSession(principal.jti, principal.email)
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
