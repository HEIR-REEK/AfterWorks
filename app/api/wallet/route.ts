import { NextRequest } from 'next/server'
import { consumeBucket, json, maintenanceBlockForApi, requireUser, routeError } from '@/lib/guards'
import { getMemberWallet } from '@/lib/wallet-server'

/**
 * GET /api/wallet — the member's money, read the way the ledger wrote it.
 *
 * Answers with the full snapshot from `lib/wallet-server`: pending, cleared (any matured credit is
 * settled on the way past — this deployment has no scheduler), the amount held by an open payout
 * request, what is therefore withdrawable, where a payout would be sent, and the payout history.
 *
 * The response keeps its historical keys (`pendingUsd`, `availableUsd`, `payoutNumber`, `entries`,
 * `paidTrainings`, `clearingHours`, `nextClearingAt`, `minWithdrawalUsd`, `fx`, `asOf`) so older
 * callers keep working, and adds `heldUsd` / `withdrawableUsd` / `destination` / `openPayout` /
 * `welcomeBonus` for the wallet panel and the payout form.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('wallet-read', 120, 60_000, guard.value.uid)
  if (!bucket.ok) {
    return json({ ok: false, error: 'Wallet lookups are rate limited. Please wait a moment.' }, { status: 429 })
  }

  try {
    const wallet = await getMemberWallet(guard.value.uid)
    if (!wallet) {
      return json({
        ok: true,
        pendingUsd: 0,
        availableUsd: 0,
        heldUsd: 0,
        withdrawableUsd: 0,
        payoutNumber: '',
        payoutHoldUsd: 0,
        entries: [],
        paidTrainings: [],
        clearingHours: 0,
        nextClearingAt: null,
        minWithdrawalUsd: 0,
        fx: { usdToKes: 0, availableKes: 0, withdrawableKes: 0 },
        unavailable: true,
        note: 'The datastore is not reachable from this server, so balances are shown as zero rather than cached values.',
      })
    }

    return json({
      ok: true,
      ...wallet,
      /** Legacy key kept for callers written before the hold existed. */
      payoutHoldUsd: wallet.heldUsd,
      fx: {
        usdToKes: wallet.usdToKes,
        availableKes: wallet.availableKes,
        withdrawableKes: wallet.withdrawableKes,
        pendingKes: wallet.pendingKes,
      },
    })
  } catch (err) {
    return routeError('wallet:GET', err)
  }
}
