import { NextRequest } from 'next/server'
import { json, fail, requireOwner, routeError } from '@/lib/guards'

/**
 * GET /api/admin/sessions — the live console sessions behind the Security Centre's
 * "Active sessions" panel.
 *
 * The signed HttpOnly cookie is what actually grants access; this endpoint only reports the
 * server-only `admin_sessions` records (one per issued cookie) so an operator can answer
 * "who is currently signed in and from where", and hand a jti to the revoke action. No token
 * and no secret is ever returned — just metadata that is already audited at sign-in.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  try {
    const { isFirebaseAdminUsable, listActiveAdminSessions } = await import('@/lib/firestore-admin')
    if (!isFirebaseAdminUsable()) {
      return fail(503, 'Firestore is not reachable from the server, so active sessions cannot be listed.', {
        code: 'storage_unavailable',
      })
    }

    const sessions = await listActiveAdminSessions()
    const now = Date.now()
    return json({
      ok: true,
      generatedAt: new Date(now).toISOString(),
      count: sessions.length,
      sessions: sessions.map((s) => ({
        jti: s.jti,
        email: s.email,
        issuedAt: new Date(s.issuedAt).toISOString(),
        expiresAt: new Date(s.expiresAt).toISOString(),
        lastSeenAt: new Date(s.lastSeenAt).toISOString(),
        // Seconds since the last heartbeat — the UI uses this to flag idle sessions.
        idleSeconds: Math.max(0, Math.round((now - s.lastSeenAt) / 1000)),
        remainingSeconds: Math.max(0, Math.round((s.expiresAt - now) / 1000)),
        ipHash: s.ipHash,
        userAgent: s.userAgent,
        current: guard.value.via === 'session-cookie' && s.jti === guard.value.jti,
      })),
    })
  } catch (err) {
    return routeError('admin/sessions:GET', err)
  }
}
