import { NextRequest } from 'next/server'
import { consumeBucket, json, maintenanceBlockForApi, requireUser, routeError } from '@/lib/guards'
import { getExchangeRateUsdToKes } from '@/lib/afterworks-data'
import { site } from '@/lib/site'

/**
 * GET /api/wallet — the member's money, read the way the ledger wrote it.
 *
 * Two fixes in one:
 *  1. The route used to carry its own copy of the Admin-SDK bootstrap (a second, weaker parser
 *     than `lib/firestore-admin`), so a base64/escaped-newline service account that worked for KYC
 *     silently failed here. One initialiser now, one behaviour.
 *  2. Balances are server-derived, and the response includes *when* each pending amount clears and
 *     which training entitlements were paid for. The client no longer gets to decide either.
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
    const firestore = await import('@/lib/firestore-admin')
    const db = firestore.dbOrNull()
    if (!db) {
      return json({
        ok: true,
        pendingUsd: 0,
        availableUsd: 0,
        payoutNumber: '',
        unavailable: true,
        note: 'The datastore is not reachable from this server, so balances are shown as zero rather than cached values.',
      })
    }

    const uid = guard.value.uid
    const [userSnap, ledgerSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db
        .collection('wallet_ledger')
        .where('uid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get()
        .catch(() => null),
    ])

    const data = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>
    const wallet = (data.wallet ?? {}) as Record<string, unknown>

    const entries = ledgerSnap
      ? ledgerSnap.docs.map((d) => {
          const row = (d.data() ?? {}) as Record<string, unknown>
          return {
            id: d.id,
            kind: String(row.kind ?? 'earning'),
            amountUsd: Number(row.amountUsd ?? 0) || 0,
            status: String(row.status ?? 'pending'),
            createdAt: String(row.createdAt ?? ''),
            clearedAt: (row.clearedAt as string) ?? null,
            jobTitle: (row.jobTitle as string) ?? '',
            applicationId: (row.applicationId as string) ?? '',
          }
        })
      : []

    const nextClearing = entries
      .filter((e) => e.status === 'pending' && e.clearedAt)
      .map((e) => e.clearedAt as string)
      .sort()[0]

    const paidTrainings = Array.isArray(data.paidTrainings) ? (data.paidTrainings as string[]) : []
    const rate = getExchangeRateUsdToKes()
    const availableUsd = Number(wallet.availableUsd ?? 0) || 0
    const pendingUsd = Number(wallet.pendingUsd ?? 0) || 0

    return json({
      ok: true,
      pendingUsd,
      availableUsd,
      payoutNumber: String(wallet.payoutNumber ?? data.phone ?? ''),
      preferredPayoutMethod: String(data.preferredPayoutMethod ?? 'M-Pesa'),
      entries,
      paidTrainings,
      clearingHours: site.clearingWindowHours,
      nextClearingAt: nextClearing ?? null,
      minWithdrawalUsd: site.minWithdrawalUsd,
      fx: { usdToKes: rate, availableKes: Math.round(availableUsd * rate) },
      qualityScore: Number(data.qualityScore ?? 100) || 100,
      jobsCompleted: Number(data.jobsCompleted ?? 0) || 0,
      accountState: String(data.accountState ?? 'active'),
      asOf: new Date().toISOString(),
    })
  } catch (err) {
    return routeError('wallet:GET', err)
  }
}
