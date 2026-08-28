import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, requireAdmin, routeError } from '@/lib/guards'
import { sanitizeLine } from '@/lib/security-core'
import { ACTION_TO_STATUS, REQUIRED_REASON, type ApplicationAction } from '@/lib/admin-domain'
import type { ApplicationStatusValue } from '@/lib/firestore-admin'

/**
 * /api/admin/applications — the QA desk.
 *
 * Previously the admin UI edited an `applications/{id}` document directly, and `firestore.rules`
 * let *any* signed-in worker write *any* application document. A worker could therefore set
 * `status: 'completed'` on their own submission and then rely on whatever paid them out; the
 * "approve → reserve slot → credit wallet" chain existed only in documentation. Here the whole
 * chain runs server-side: legal transitions are enforced, slot counters move with the decision,
 * payment is written to a ledger keyed by the application (so a replay cannot double-pay), and the
 * worker receives a notification they can read.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response
  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Applications feed unavailable.', { code: 'storage_unavailable' })
    const page = await firestore.listApplicationsPage({
      pageSize: Number(req.nextUrl.searchParams.get('pageSize') ?? 25),
      cursor: req.nextUrl.searchParams.get('cursor'),
      status: req.nextUrl.searchParams.get('status') ?? 'all',
      search: req.nextUrl.searchParams.get('search') ?? '',
    })
    return json({ ok: true, ...page })
  } catch (err) {
    return routeError('admin/applications:GET', err)
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('admin-qa', 60, 60_000, String(guard.value.jti).slice(0, 12))
  if (!bucket.ok) return fail(429, 'QA actions are limited to 60 per minute.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 32_000) return fail(413, 'Payload is too large.', { code: 'payload_too_large' })
    body = JSON.parse(raw || '{}')
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }

  const applicationId = sanitizeLine(body.applicationId, 128)
  const action = String(body.action ?? '') as ApplicationAction
  const note = typeof body.note === 'string' ? sanitizeLine(body.note, 500) : undefined
  const reason = typeof body.reason === 'string' ? sanitizeLine(body.reason, 500) : undefined

  if (!applicationId) return fail(400, 'An application id is required.', { code: 'missing_id' })
  const to = ACTION_TO_STATUS[action]
  if (!to) return fail(400, `Unsupported QA action "${action || '(blank)'}".`, { code: 'unknown_action' })
  if (REQUIRED_REASON.includes(action) && !note && !reason) {
    return fail(400, 'Tell the worker what to change — a short written reason is required.', { code: 'reason_required' })
  }

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Storage unavailable — no change was written.', { code: 'storage_unavailable' })

    const result = await firestore.transitionApplicationAdmin({
      applicationId,
      to: to as ApplicationStatusValue,
      actorEmail: guard.value.email,
      note,
      reason,
    })

    return json({
      ok: true,
      status: result.status,
      creditedUsd: result.creditedUsd,
      message:
        result.creditedUsd > 0
          ? `Approved and ${result.creditedUsd.toFixed(2)} USD moved to the worker's pending balance.`
          : `Application is now ${result.status.replace(/_/g, ' ')}.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/cannot move|reason is required|not found|already/i.test(message)) {
      return fail(409, message, { code: 'transition_denied' })
    }
    return routeError('admin/applications:PATCH', err)
  }
}

/** Bulk triage: approve/reject a bounded batch, reporting each failure instead of aborting the set. */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('admin-qa-bulk', 6, 60_000, String(guard.value.jti).slice(0, 12))
  if (!bucket.ok) return fail(429, 'Bulk actions are limited to 6 per minute.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })

  let body: Record<string, unknown>
  try {
    body = JSON.parse((await req.text()).slice(0, 32_000) || '{}')
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }

  const ids = Array.isArray(body.applicationIds) ? (body.applicationIds as unknown[]).map((v) => sanitizeLine(v, 128)).filter(Boolean).slice(0, 25) : []
  const action = String(body.action ?? '') as ApplicationAction
  const to = ACTION_TO_STATUS[action]
  if (!ids.length) return fail(400, 'Select at least one application.', { code: 'missing_ids' })
  if (!to) return fail(400, 'Unsupported bulk action.', { code: 'unknown_action' })
  if (REQUIRED_REASON.includes(action) && !body.reason && !body.note) {
    return fail(400, 'A reason is required for rejection or revision requests.', { code: 'reason_required' })
  }

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Storage unavailable.', { code: 'storage_unavailable' })

    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of ids) {
      try {
        await firestore.transitionApplicationAdmin({
          applicationId: id,
          to: to as ApplicationStatusValue,
          actorEmail: guard.value.email,
          reason: typeof body.reason === 'string' ? sanitizeLine(body.reason, 500) : undefined,
          note: typeof body.note === 'string' ? sanitizeLine(body.note, 500) : undefined,
        })
        results.push({ id, ok: true })
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Rejected by the transition rules.' })
      }
    }

    await audit({
      action: 'APPLICATIONS_BULK_TRANSITION',
      actorEmail: guard.value.email,
      details: { action, attempted: ids.length, applied: results.filter((r) => r.ok).length },
      req,
    })

    return json({ ok: true, applied: results.filter((r) => r.ok).length, results })
  } catch (err) {
    return routeError('admin/applications:POST', err)
  }
}
