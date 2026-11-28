import { NextRequest } from 'next/server'
import { fail, json, requireAdmin, routeError } from '@/lib/guards'
import { parseMarkReadRequest } from '@/lib/admin-notifications-shared'

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

  let body: unknown
  try {
    body = JSON.parse((await req.text()).slice(0, 8_000) || '{}')
  } catch {
    return fail(400, 'Invalid body.', { code: 'bad_request' })
  }

  // The request shape used to be ambiguous: `ids: []` meant "all", but reached the helper as an
  // empty array and became `where(documentId(), 'in', [])`, which Firestore rejects. Parsing it
  // into an explicit `{ kind: 'all' } | { kind: 'ids' }` is what makes that unrepresentable.
  const parsed = parseMarkReadRequest(body)
  if (!parsed.ok) return fail(400, parsed.reason, { code: 'bad_request' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Notifications unavailable (storage not configured).', { code: 'storage_unavailable' })
    const outcome = await firestore.markAdminNotificationsRead(parsed.request)
    const unread = await firestore.countUnreadAdminNotifications()
    return json({ ok: true, marked: outcome.marked, truncated: outcome.truncated, unread })
  } catch (err) {
    return routeError('admin-notifications:PATCH', err)
  }
}
