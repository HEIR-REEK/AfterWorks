import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, maintenanceBlockForApi, requireUser, routeError } from '@/lib/guards'
import { WELCOME_BONUS_USD, WalletError, getMemberWallet, grantWelcomeBonus } from '@/lib/wallet-server'

/**
 * POST /api/wallet/welcome-bonus — settle the $5 profile reward, exactly once.
 *
 * Two callers:
 *  • the member, from the popup or the wallet panel, with no body → the reward is paid only when the
 *    stored profile is 100% complete (the server re-scores; the client's opinion is not consulted);
 *  • `PATCH`/`POST` from `/admin/users` for a member an operator onboarded, which passes `uid` and
 *    requires an operator session — handled in the console route, not here.
 *
 * The response always reports the *current* completion, so the UI can say precisely what is still
 * missing instead of guessing why the reward did not arrive.
 *
 * Note for operators: the amount is a server constant. The previous version credited a fixed $5 too,
 * but it was awarded on any save that happened to look complete, which is how a member with an empty
 * skills list received it and a member with everything filled in did not.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('welcome-bonus', 10, 60_000, guard.value.uid)
  if (!bucket.ok) return fail(429, 'Too many attempts. Please wait a minute and try again.', { code: 'rate_limited' })

  try {
    const result = await grantWelcomeBonus({
      uid: guard.value.uid,
      actor: `member:${guard.value.uid}`,
      actorKind: 'member',
      amountUsd: WELCOME_BONUS_USD,
    })

    const wallet = await getMemberWallet(guard.value.uid)

    if (!result.granted) {
      // Not an error: either it was already paid, or the profile is not finished yet.
      const alreadyPaid = /already been paid/i.test(result.reason ?? '')
      return json(
        {
          ok: true,
          granted: false,
          alreadyGranted: alreadyPaid,
          amountUsd: result.amountUsd,
          completion: result.completion,
          reason: result.reason,
          wallet,
        },
        { status: alreadyPaid ? 200 : 409 },
      )
    }

    await audit({
      action: 'WELCOME_BONUS_CLAIMED',
      actorEmail: guard.value.email,
      details: { uid: guard.value.uid, amountUsd: result.amountUsd, completion: result.completion.percent },
      req,
    })

    return json({
      ok: true,
      granted: true,
      amountUsd: result.amountUsd,
      completion: result.completion,
      wallet,
    })
  } catch (err) {
    if (err instanceof WalletError) return fail(err.status, err.message, { code: err.code })
    return routeError('wallet:welcome-bonus', err)
  }
}
