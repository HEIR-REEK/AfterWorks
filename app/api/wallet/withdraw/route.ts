import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, maintenanceBlockForApi, requireVerifiedUser, routeError } from '@/lib/guards'
import { sanitizeLine } from '@/lib/security-core'

/**
 * POST /api/wallet/withdraw — a worker requests a payout to the mobile money number on file.
 *
 * The amount leaves the available balance inside one transaction and becomes a `withdrawal`
 * ledger row in `processing`. Operators settle the row from the Money console (sent → closes the
 * transfer; failed → the amount is returned to the available balance). There is deliberately no
 * direct balance edit here: the ledger row is the only record that can move this money.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireVerifiedUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('wallet-withdraw', 10, 60_000, guard.value.uid)
  if (!bucket.ok) {
    return fail(429, 'Too many withdrawal attempts. Please wait a minute.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })
  }

  let amountUsd = NaN
  let method = 'M-Pesa'
  try {
    const raw = await req.text()
    if (raw.length > 2_000) return fail(413, 'Payload is too large.', { code: 'payload_too_large' })
    const body = JSON.parse(raw || '{}')
    amountUsd = Number(body.amountUsd)
    if (typeof body.method === 'string' && body.method.trim()) method = sanitizeLine(body.method, 30)
  } catch {
    return fail(400, 'Expected a JSON body with amountUsd.', { code: 'bad_request' })
  }
  if (!Number.isFinite(amountUsd)) return fail(400, 'Enter a valid amount.', { code: 'invalid_amount' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.dbOrNull()) return fail(503, 'Storage unavailable.', { code: 'storage_unavailable' })
    const result = await firestore.requestWithdrawalServer(guard.value.uid, amountUsd, {
      method,
      email: guard.value.email,
    })
    return json({ ok: true, ...result }, { status: 202 })
  } catch (err) {
    const firestore = await import('@/lib/firestore-admin').catch(() => null)
    if (firestore && err instanceof firestore.TransitionError) {
      return fail(err.status, err.message, { code: 'withdrawal_refused' })
    }
    return routeError('wallet/withdraw:POST', err)
  }
}
