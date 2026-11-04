/**
 * POST /api/kyc/request — a member asks for an identity review.
 *
 * There is no verification provider in this deployment any more. Identity is decided by a person:
 * an owner opens the member in the admin console, checks the document they were given, and approves
 * or rejects. That path (`PATCH /api/admin/users` → `kyc`) already existed and is unchanged — this
 * endpoint is the member's half of the same exchange, and it is deliberately the *only* thing a
 * member can do here.
 *
 * What it writes is one timestamp, `kycRequestedAt`, and that is the whole point: the member cannot
 * write `kycVerified`, `kycStatus` or anything else privileged (firestore.rules lists them, and this
 * route goes through the Admin SDK rather than trusting the client). The console's review queue is
 * just "every unverified member with a recent `kycRequestedAt`", so asking twice is idempotent and
 * re-asking after a rejection is what clears the stale verdict.
 */

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, rateLimit, requireUser } from '@/lib/guards'
import { requestKycReview, getUserProfile } from '@/lib/firestore-admin'

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 'kyc-request', 10, 60_000)
  if (limited) return limited

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  // A member who is already verified has nothing to ask for. Answering 200 with the current state
  // keeps the button harmless rather than making the profile surface an error it cannot fix.
  try {
    const profile = await getUserProfile(guard.value.uid)
    if (profile?.kycVerified === true) {
      return json({ ok: true, alreadyVerified: true, kycVerified: true })
    }
  } catch (err) {
    // A failed read must not block the request: the write is the thing the member asked for, and
    // the console re-checks state before approving anyway.
    console.warn('[kyc] request route could not read the profile:', err instanceof Error ? err.message : err)
  }

  // One write per member per minute. The queue is small and human-reviewed, so a member hammering
  // the button is a bug in the UI, not a member with urgent news.
  const bucket = consumeBucket('kyc-request-write', 3, 60_000, guard.value.uid)
  if (!bucket.ok) {
    return fail(429, 'You have already asked for a review. Please give the team a moment.', {
      code: 'rate_limited',
      details: { retryAfterSec: bucket.retryAfterSec },
    })
  }

  try {
    const result = await requestKycReview(guard.value.uid)
    return json({
      ok: true,
      alreadyVerified: false,
      kycVerified: false,
      requestedAt: result.requestedAt,
      alreadyRequested: result.alreadyRequested,
    })
  } catch (err) {
    console.error('[kyc] request route failed:', err)
    return fail(502, 'Your request could not be recorded. Please try again in a moment.', {
      code: 'kyc_request_failed',
    })
  }
}
