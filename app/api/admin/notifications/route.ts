import { NextRequest } from 'next/server'
import { fail, json, requireAdmin, routeError } from '@/lib/guards'
import { sanitizeLine } from '@/lib/security-core'

/**
 * /api/admin/notifications — console-wide in-app notifications (owner + staff).
 *
 * Lets the team see events like "a member requested verification" directly on the site —
 * no email, no SMS. Written server-only (firestore.rules default-denies client writes to
 * admin_notifications); GET returns the feed plus the unread badge count, PATCH marks read.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) {
      return json({ ok: true, notifications: [], unread: 0, available: false })
    }
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 40)))
    const [rows, unread] = await Promise.all([
      firestore.listAdminNotifications(limit),
      firestore.countUnreadAdminNotifications(),
    ])
    return json({
      ok: true,
      available: true,
      unread,
      notifications: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        tone: row.tone ?? 'info',
        link: row.link ?? '',
        actorEmail: row.actorEmail ?? '',
        read: row.read === true,
        createdAt: row.createdAt,
      })),
    })
  } catch (err) {
    return routeError('admin-notifications:GET', err)
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  let body: Record<string, unknown>
  try {
    body = JSON.parse((await req.text()).slice(0, 8_000) || '{}')
  } catch {
    return fail(400, 'Invalid body.', { code: 'bad_request' })
  }
  const ids = Array.isArray(body.ids) ? body.ids.map((v) => sanitizeLine(String(v), 64)).filter(Boolean).slice(0, 100) : undefined

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Notifications unavailable (storage not configured).', { code: 'storage_unavailable' })
    const marked = await firestore.markAdminNotificationsRead(ids)
    const unread = await firestore.countUnreadAdminNotifications()
    return json({ ok: true, marked, unread })
  } catch (err) {
    return routeError('admin-notifications:PATCH', err)
  }
}
