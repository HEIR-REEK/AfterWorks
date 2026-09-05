import type { NextRequest } from 'next/server'
import { fail, json, requireOwner, routeError } from '@/lib/guards'
import { listLedgerPage } from '@/lib/firestore-admin'

/**
 * GET /api/admin/ledger — earnings, withdrawals and card payments in one feed.
 *
 * Read-only by design: money moves through the application lifecycle, the withdrawal flow and the
 * Paystack webhook, and every one of those writes its own audit entry. Letting an operator edit a ledger
 * row from here would create a second, unaudited path to a balance. Corrections go through
 * `/admin/users` (a wallet adjustment with a reason), which is what the audit trail expects.
 */

export const dynamic = 'force-dynamic'

const SOURCES = new Set(['wallet', 'payment', 'all'])

export async function GET(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  const params = req.nextUrl.searchParams
  const source = params.get('source') ?? 'all'
  if (!SOURCES.has(source)) return fail(400, 'source must be wallet, payment or all.', { code: 'bad_request' })

  const pageSize = Math.min(100, Math.max(10, Number(params.get('pageSize') ?? 25) || 25))

  try {
    const page = await listLedgerPage({
      source: source as 'wallet' | 'payment' | 'all',
      kind: params.get('kind')?.trim() || undefined,
      status: params.get('status')?.trim() || undefined,
      search: params.get('search')?.trim() || undefined,
      cursor: params.get('cursor') || null,
      pageSize,
    })
    return json({ ok: true, ...page })
  } catch (err) {
    return routeError('admin/ledger:GET', err)
  }
}
