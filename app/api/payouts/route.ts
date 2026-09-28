import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, maintenanceBlockForApi, requireUser, requireVerifiedUser, routeError } from '@/lib/guards'
import { isCancellablePayoutStatus } from '@/lib/payouts'
import {
  WalletError,
  cancelPayoutRequest,
  getMemberWallet,
  listPayoutRequests,
  submitPayoutRequest,
} from '@/lib/wallet-server'

/**
 * The member's withdrawal panel.
 *
 * GET   /api/payouts            — payout history (newest first) plus what can be withdrawn now.
 * POST  /api/payouts            — request a withdrawal; the server holds the amount and queues it.
 * PATCH /api/payouts            — cancel a request that has not been sent yet.
 *
 * The browser sends exactly two things: `amountUsd` and (for a cancel) the request id. Balances,
 * destination details, KYC state and the minimum are all re-derived here from Firestore, so a
 * tampered bundle can ask for money it does not have and be refused.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('payouts-read', 120, 60_000, guard.value.uid)
  if (!bucket.ok) return fail(429, 'Payout lookups are rate limited. Please wait a moment.', { code: 'rate_limited' })

  try {
    const wallet = await getMemberWallet(guard.value.uid)
    if (!wallet) {
      return json({
        ok: true,
        rows: [],
        wallet: null,
        unavailable: true,
        note: 'The datastore is not reachable from this server, so no payout history was read.',
      })
    }
    const history = await listPayoutRequests({ uid: guard.value.uid, pageSize: 25, withSummary: false })
    return json({
      ok: true,
      rows: history.rows,
      hasMore: history.hasMore,
      nextCursor: history.nextCursor,
      degraded: history.degraded ?? null,
      wallet,
      /** Convenience flags so the panel does not have to re-derive eligibility. */
      eligibility: {
        kycVerified: wallet.kycVerified,
        accountState: wallet.accountState,
        destinationReady: wallet.destination.ready,
        destinationProblem: wallet.destination.problem,
        minWithdrawalUsd: wallet.minWithdrawalUsd,
        withdrawableUsd: wallet.withdrawableUsd,
        heldUsd: wallet.heldUsd,
        openPayoutId: wallet.openPayout?.id ?? null,
        openPayoutStatus: wallet.openPayout?.status ?? null,
        canRequest: wallet.kycVerified && wallet.accountState === 'active' && wallet.destination.ready && !wallet.openPayout && wallet.withdrawableUsd >= wallet.minWithdrawalUsd,
      },
    })
  } catch (err) {
    return routeError('payouts:GET', err)
  }
}

export async function POST(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireVerifiedUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('payout-request', 6, 60_000, guard.value.uid)
  if (!bucket.ok) {
    return fail(429, 'Too many withdrawal attempts. Please wait a minute and try again.', {
      code: 'rate_limited',
      headers: { 'Retry-After': String(bucket.retryAfterSec) },
    })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail(400, 'Send the amount you want to withdraw.', { code: 'bad_request' })
  }
  const amountUsd = Number(body.amountUsd ?? body.amount ?? 0)

  try {
    const result = await submitPayoutRequest({ uid: guard.value.uid, amountUsd, actorEmail: guard.value.email })
    return json({
      ok: true,
      request: result.request,
      wallet: result.wallet,
      message: 'Withdrawal requested. The amount is held until it is paid out.',
    })
  } catch (err) {
    if (err instanceof WalletError) {
      return fail(err.status, err.message, { code: err.code })
    }
    return routeError('payouts:POST', err)
  }
}

export async function PATCH(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireVerifiedUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('payout-cancel', 10, 60_000, guard.value.uid)
  if (!bucket.ok) return fail(429, 'Too many attempts. Please wait a moment.', { code: 'rate_limited' })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail(400, 'Send the payout request id.', { code: 'bad_request' })
  }
  const requestId = String(body.requestId ?? body.id ?? '').trim()
  if (!requestId || !/^[A-Za-z0-9_-]{4,120}$/.test(requestId)) {
    return fail(400, 'Send a valid payout request id.', { code: 'bad_request' })
  }

  try {
    const wallet = await getMemberWallet(guard.value.uid)
    const mine = wallet?.payoutRequests.find((row) => row.id === requestId)
    if (!mine) return fail(404, 'That payout request is not on your account.', { code: 'payout_not_found' })
    if (!isCancellablePayoutStatus(mine.status)) {
      return fail(409, 'This payout is already on its way and can no longer be cancelled.', { code: 'payout_not_cancellable' })
    }

    const result = await cancelPayoutRequest({ uid: guard.value.uid, requestId })
    await audit({
      action: 'PAYOUT_CANCELLED_BY_MEMBER',
      actorEmail: guard.value.email,
      details: { requestId, amountUsd: result.request.amountUsd, releasedUsd: result.releasedUsd },
      req,
    })
    return json({ ok: true, request: result.request, releasedUsd: result.releasedUsd })
  } catch (err) {
    if (err instanceof WalletError) return fail(err.status, err.message, { code: err.code })
    return routeError('payouts:PATCH', err)
  }
}
