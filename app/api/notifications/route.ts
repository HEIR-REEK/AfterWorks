import { NextRequest } from 'next/server'
import { consumeBucket, json, requireUser, routeError } from '@/lib/guards'

/**
 * /api/notifications — the member's own activity feed.
 *
 * "Realness" here is concrete: when QA approves work, when KYC passes, when a payout is queued, the
 * worker sees it in-app with the same timestamp the console recorded. Previously the only feedback a
 * worker got was whatever their own tab had optimistically written to localStorage, so a decision
 * made by an operator was literally invisible to the person it was about.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('notifications-read', 120, 60_000, guard.value.uid)
  if (!bucket.ok) return json({ ok: true, notifications: [], unread: 0, throttled: true })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.dbOrNull()) return json({ ok: true, notifications: [], unread: 0, available: false })

    const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 20)))
    const rows = await firestore.listNotifications(guard.value.uid, limit)
    const notifications = rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      tone: row.tone ?? 'info',
      link: row.link ?? '',
      read: row.read === true,
      createdAt: row.createdAt,
    }))

    return json({
      ok: true,
      notifications,
      unread: notifications.filter((n) => !n.read).length,
      available: true,
    })
  } catch (err) {
    return routeError('notifications:GET', err)
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  let body: Record<string, unknown>
  try {
    body = JSON.parse((await req.text()).slice(0, 8_000) || '{}')
  } catch {
    body = {}
  }

  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map((v) => String(v).slice(0, 64)).slice(0, 20) : []
  try {
    const firestore = await import('@/lib/firestore-admin')
    const updated = await firestore.markNotificationsRead(guard.value.uid, body.all === true || ids.length === 0, ids)
    return json({ ok: true, updated })
  } catch (err) {
    return routeError('notifications:PATCH', err)
  }
}
