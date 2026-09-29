import { NextRequest } from 'next/server'
import { consumeBucket, json, maintenanceBlockForApi, requireUser, routeError } from '@/lib/guards'
import { getReferralDashboard } from '@/lib/referral-server'
import { publicAppOrigin } from '@/lib/email-verification'
import { REFERRAL_BONUS_USD, REFERRAL_TERMS } from '@/lib/referrals'

/**
 * GET /api/referrals — the referral panel, in one response.
 *
 * Answers with the member's own code, the shareable link, the lifetime totals, and the list of
 * people who signed up with it. The referred person's email is never included: a referrer gets a
 * name, a status and a date, which is all anybody needs and none of it is somebody else's
 * personal data.
 *
 * The terms ride along with the payload so the panel renders from the same object the server
 * enforces, rather than from copy that can drift.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('referral-read', 60, 60_000, guard.value.uid)
  if (!bucket.ok) {
    return json({ ok: false, error: 'Referral lookups are rate limited. Please wait a moment.' }, { status: 429 })
  }

  try {
    // The share link carries the origin this request actually arrived on (with the configured
    // public URL preferred when one exists), never a localhost fallback — a link the member
    // cannot share is a referral program that records nothing.
    const dashboard = await getReferralDashboard(guard.value.uid, publicAppOrigin(req))
    if (!dashboard) {
      return json({
        ok: false,
        error: 'The referral service is temporarily unavailable. Please try again in a moment.',
        code: 'referrals_unavailable',
      })
    }

    return json({ ok: true, ...dashboard, bonusUsd: REFERRAL_BONUS_USD, terms: REFERRAL_TERMS })
  } catch (err) {
    return routeError('referrals:GET', err)
  }
}
