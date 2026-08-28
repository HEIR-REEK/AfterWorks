import { NextRequest } from 'next/server'
import { fail, json, requireAdmin, routeError } from '@/lib/guards'
import { sanitizeLine } from '@/lib/security-core'

/**
 * /api/admin/audit — read side of the immutable ledger.
 *
 * The old rules let any signed-in user *write* `admin_logs` documents from the browser, which
 * turns an audit trail into a message board (and lets an offender rewrite their own trail). Client
 * writes are now denied by firestore.rules; this route is server-only, admin-gated, redacts on the
 * way in, and supports CSV export for the compliance folks who will never open a Firestore console.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const limit = Math.min(200, Math.max(10, Number(req.nextUrl.searchParams.get('limit') ?? 60)))
  const action = req.nextUrl.searchParams.get('action') ?? 'all'
  const search = req.nextUrl.searchParams.get('search') ?? ''
  const format = req.nextUrl.searchParams.get('format') ?? 'json'

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) {
      return fail(503, 'Audit ledger unavailable (storage not configured).', { code: 'storage_unavailable' })
    }

    const logs = await firestore.listAuditLogs({ limit, action, search })

    if (format === 'csv') {
      const header = 'timestamp,action,actor,details'
      const rows = logs.map((log) =>
        [
          JSON.stringify(log.timestamp ?? ''),
          JSON.stringify(log.action ?? ''),
          JSON.stringify(log.actorEmail ?? ''),
          JSON.stringify(JSON.stringify(log.details ?? {})),
        ].join(','),
      )
      const csv = [header, ...rows].join('\n')
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="afterworks-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
          'X-Audit-Rows': String(logs.length),
        },
      })
    }

    return json({
      ok: true,
      logs,
      count: logs.length,
      actions: Array.from(new Set(logs.map((l) => l.action).filter(Boolean))).sort(),
      exportUrl: `/api/admin/audit?format=csv&limit=${limit}${action !== 'all' ? `&action=${encodeURIComponent(action)}` : ''}`,
    })
  } catch (err) {
    return routeError('admin/audit:GET', err)
  }
}

/** Lets console-side actions append a legitimate audit line (server-redacted, actor forced). */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  let body: Record<string, unknown>
  try {
    body = JSON.parse((await req.text()).slice(0, 16_000) || '{}')
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }

  const action = sanitizeLine(body.action, 80)
  if (!/^[A-Z0-9_]{3,80}$/.test(action)) {
    return fail(400, 'Audit actions must be UPPER_SNAKE_CASE identifiers.', { code: 'invalid_action' })
  }

  const details =
    body.details && typeof body.details === 'object' && !Array.isArray(body.details)
      ? (body.details as Record<string, unknown>)
      : {}

  try {
    const { redact } = await import('@/lib/security')
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Audit ledger unavailable.', { code: 'storage_unavailable' })
    await firestore.createAuditEntry(action, redact(details) as Record<string, unknown>, guard.value.email)
    return json({ ok: true })
  } catch (err) {
    return routeError('admin/audit:POST', err)
  }
}
