import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, maintenanceBlockForApi, requireUser, routeError } from '@/lib/guards'
import { readJsonBody } from '@/lib/security-core'
import { profileCompletion } from '@/lib/profile-completion'
import { withdrawalQuote } from '@/lib/payouts'
import { WalletError, getMemberWallet, saveMemberProfile } from '@/lib/wallet-server'
import { UniquenessError } from '@/lib/account-uniqueness'

/**
 * GET   /api/profile — the member's own document, scored, plus what the wallet allows.
 * PATCH /api/profile — save profile fields (validated, whitelisted, server-written).
 *
 * Why the write moved server-side:
 *  • security rules only allow a profile write when the ID token carries `email_verified`, so a
 *    member who had not clicked the verification link could fill the form in and silently lose it;
 *  • the previous client write sent every field in the form, including empty ones, so an edit of
 *    one field could blank another;
 *  • the welcome reward was claimed by a separate call that could be skipped (or raced), which is
 *    how "I finished my profile and got nothing" happens.
 *
 * Now one request saves the patch and, when that patch takes the profile to 100%, credits the
 * reward in the same transaction and says so in the response — the popup that follows is reporting
 * a fact, not asking for one.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('profile-read', 120, 60_000, guard.value.uid)
  if (!bucket.ok) return fail(429, 'Profile lookups are rate limited. Please wait a moment.', { code: 'rate_limited' })

  try {
    const wallet = await getMemberWallet(guard.value.uid)
    if (!wallet) {
      return json({
        ok: true,
        profile: null,
        completion: profileCompletion(null),
        wallet: null,
        note: 'The datastore is not reachable from this server, so no profile was read.',
      })
    }

    const { dbOrNull } = await import('@/lib/firestore-admin')
    const db = dbOrNull()
    const snap = db ? await db.collection('users').doc(guard.value.uid).get() : null
    const data = (snap?.data() ?? null) as Record<string, unknown> | null

    return json({
      ok: true,
      profile: data,
      completion: profileCompletion(data),
      wallet: {
        ...wallet,
        quote: withdrawalQuote({
          availableUsd: wallet.availableUsd,
          heldUsd: wallet.heldUsd,
          minWithdrawalUsd: wallet.minWithdrawalUsd,
          usdToKes: wallet.usdToKes,
        }),
      },
    })
  } catch (err) {
    return routeError('profile:GET', err)
  }
}

export async function PATCH(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('profile-write', 30, 60_000, guard.value.uid)
  if (!bucket.ok) return fail(429, 'Too many profile saves. Please wait a moment.', { code: 'rate_limited' })

  const parsed = await readJsonBody<Record<string, unknown>>(req, 16_000)
  if (!parsed.ok) return fail(400, parsed.error, { code: 'bad_request' })
  // Accept either a flat patch `{ name: … }` or `{ fields: { name: … } }`.
  const patch =
    parsed.data.fields && typeof parsed.data.fields === 'object' && !Array.isArray(parsed.data.fields)
      ? (parsed.data.fields as Record<string, unknown>)
      : parsed.data
  if (Object.keys(patch).length === 0) return fail(400, 'Nothing to save — send at least one profile field.', { code: 'empty_patch' })

  try {
    // A profile save can be the moment a referred member's profile reaches 100% — and the bonus
    // release inside the transaction below needs the attribution record to already exist. If the
    // signup-time claim failed (another tab, a referrer mid-verification, a network blip), this
    // attaches it now, so "finished my profile" can never happen with the referral silently gone.
    try {
      const { reconcileReferralAttribution } = await import('@/lib/referral-server')
      await reconcileReferralAttribution(guard.value.uid)
    } catch (err) {
      console.warn('[referrals] pre-save attribution skipped:', err instanceof Error ? err.message : err)
    }
    const result = await saveMemberProfile(guard.value.uid, patch, { actorEmail: `member:${guard.value.uid}` })
    return json({
      ok: true,
      saved: result.saved,
      dropped: result.dropped,
      completion: result.completion,
      grantedBonus: result.grantedBonus,
      bonusAlreadyGranted: result.bonusAlreadyGranted,
      // Present only when this save is what completed a referred member's profile — the money
      // went to *their* referrer, and the UI says so rather than showing a balance that did not move.
      releasedReferral: result.releasedReferral,
      wallet: result.wallet,
    })
  } catch (err) {
    if (err instanceof WalletError) {
      return fail(err.status, err.message, { code: err.code })
    }
    // "One phone number, one account" is a rule, not a crash: the member gets a specific message
    // and a 409, and the other account's uid never leaves the server.
    if (err instanceof UniquenessError) {
      return fail(err.status, err.message, { code: err.code })
    }
    return routeError('profile:PATCH', err)
  }
}
