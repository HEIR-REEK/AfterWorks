import { NextRequest } from 'next/server'
import { fail, json, maintenanceBlockForApi, requireOwner, routeError } from '@/lib/guards'
import { sanitizeLine } from '@/lib/security-core'

/**
 * POST /api/admin/ledger/withdrawal — settle a worker's withdrawal row.
 *
 * The ledger page is read-only; the only writes into money are the audited lifecycle actions,
 * and this is one of them. `sent` closes a transfer that has actually gone out over M-Pesa;
 * `failed` returns the amount to the member's available balance (the transaction does that, not
 * a second manual adjustment). Both notify the worker and write an audit entry under the
 * operator's account.
 */

export const dynamic = 'force-dynamic'

const ACTIONS = new Set(['sent', 'failed'])

export async function POST(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  let withdrawalId = ''
  let action = ''
  try {
    const raw = await req.text()
    if (raw.length > 2_000) return fail(413, 'Payload is too large.', { code: 'payload_too_large' })
    const body = JSON.parse(raw || '{}')
    withdrawalId = sanitizeLine(body.withdrawalId, 128)
    action = sanitizeLine(body.action, 20)
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }
  if (!withdrawalId) return fail(400, 'withdrawalId is required.', { code: 'missing_id' })
  if (!ACTIONS.has(action)) return fail(400, 'action must be "sent" or "failed".', { code: 'bad_action' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.dbOrNull()) return fail(503, 'Storage unavailable.', { code: 'storage_unavailable' })
    const result = await firestore.settleWithdrawalServer(withdrawalId, action as 'sent' | 'failed', guard.value.email)
    return json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The withdrawal could not be settled.'
    if (/not found|not a withdrawal|cannot be re-settled|Unknown withdrawal/i.test(message)) {
      return fail(409, message, { code: 'withdrawal_settle_denied' })
    }
    return routeError('admin/ledger/withdrawal:POST', err)
  }
}
