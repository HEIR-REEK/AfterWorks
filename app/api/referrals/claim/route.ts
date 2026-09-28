import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, rateLimit, requireUser } from '@/lib/guards'
import { readJsonBody } from '@/lib/security-core'
import { claimReferralForSignup } from '@/lib/referral-server'
import { normaliseReferralCode } from '@/lib/referrals'

/**
 * POST /api/referrals/claim — attach a signup to the referrer whose code was used.
 *
 * Called once, immediately after the account exists, while the fresh ID token is still valid.
 * `requireUser` (not `requireVerifiedUser`) is the right gate: a referral is attributed at
 * signup, before the inbox is proven, because that is when the member has a code in hand and no
 * reason to keep it. Nothing about the bonus depends on it — the bonus waits for the profile.
 *
 * **This endpoint can never fail a sign-up.** A referral is a promotion, not a precondition for
 * an account, so every rejection is a 200 with `attached: false` and a reason the form can show
 * quietly. A member is never locked out of the platform because a referral write timed out.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 'referral-claim', 20, 60_000)
  if (limited) return limited

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const parsed = await readJsonBody<{ code?: unknown; name?: unknown; email?: unknown }>(req, 2_000)
  if (!parsed.ok) return fail(400, parsed.error, { code: 'bad_request' })

  const code = normaliseReferralCode(parsed.data.code)
  // No code at all is the overwhelmingly common case (an ordinary sign-up) and must be free.
  if (!code) {
    return json({ ok: true, attached: false, reason: 'no_referral_code' })
  }

  const bucket = consumeBucket('referral-claim-write', 5, 60_000, guard.value.uid)
  if (!bucket.ok) {
    return json({ ok: true, attached: false, reason: 'rate_limited' })
  }

  try {
    const result = await claimReferralForSignup({
      referredUid: guard.value.uid,
      referredEmail: guard.value.email,
      referredName: String(parsed.data.name ?? ''),
      rawCode: code,
      emailVerified: guard.value.emailVerified,
    })
    return json({ ok: true, ...result })
  } catch (err) {
    // Claimed as a promotion, so even an unexpected failure is reported as "not attached"
    // rather than an error the sign-up form would have to explain.
    console.warn('[referrals] claim route failed:', err instanceof Error ? err.message : err)
    return json({ ok: true, attached: false, reason: 'attribution_failed' })
  }
}
