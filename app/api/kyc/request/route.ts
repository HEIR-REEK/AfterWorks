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
 *
 * It also confirms by email. A manual review has no webhook and no redirect, so the email is the
 * only thing that tells the member their request actually landed somewhere — without it they are
 * left staring at a status that looks stuck.
 */

export const dynamic = 'force-dynamic'

import { after, NextRequest } from 'next/server'
import { consumeBucket, fail, json, rateLimit, requireUser } from '@/lib/guards'
import { requestKycReview, getUserProfile, recordAdminNotification } from '@/lib/firestore-admin'
import { profileCompletion, type ProfileCompletion } from '@/lib/profile-completion'

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 'kyc-request', 10, 60_000)
  if (limited) return limited

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  // A member who is already verified has nothing to ask for. Answering 200 with the current state
  // keeps the button harmless rather than making the profile surface an error it cannot fix.
  // The same read scores profile completion: a review can only be requested once every required
  // profile field is answered, so the console always has a complete profile to approve.
  let completion: ProfileCompletion | null = null
  try {
    const profile = await getUserProfile(guard.value.uid)
    if (profile?.kycVerified === true) {
      return json({ ok: true, alreadyVerified: true, kycVerified: true })
    }
    completion = profileCompletion(profile as Record<string, unknown> | null)
  } catch (err) {
    // A failed read must not block the request: the write is the thing the member asked for, and
    // the console re-checks state before approving anyway. The gate below only applies when the
    // read succeeded.
    console.warn('[kyc] request route could not read the profile:', err instanceof Error ? err.message : err)
  }

  // Profile incomplete → the request is HELD, not recorded: `kycRequestedAt` stays unset so it never
  // enters the review queue, a hold marker is written for the console, and the member is emailed
  // exactly which fields are missing until they finish the profile.
  if (completion && !completion.complete) {
    let heldAt: string | undefined
    try {
      const { holdKycRequest } = await import('@/lib/firestore-admin')
      heldAt = (await holdKycRequest(guard.value.uid, completion.missingLabels)).heldAt
      await recordAdminNotification({
        title: 'Verification request held — profile incomplete',
        body: `${guard.value.email ?? guard.value.uid} asked for review but is missing: ${completion.missingLabels.join(', ')}.`,
        link: '/admin/users',
        tone: 'warning',
        actorUid: guard.value.uid,
        actorEmail: guard.value.email ?? undefined,
      })
    } catch (err) {
      console.warn('[kyc] could not record the hold marker:', err instanceof Error ? err.message : err)
    }

    after(async () => {
      try {
        const {
          sendEmail,
          isResendConfigured,
          kycRequestHeldEmailSubject,
          kycRequestHeldEmailText,
          kycRequestHeldEmailHtml,
        } = await import('@/lib/email')
        if (!isResendConfigured() || !guard.value.email) return
        const profile = await getUserProfile(guard.value.uid)
        const sent = await sendEmail({
          to: guard.value.email,
          subject: kycRequestHeldEmailSubject(),
          html: kycRequestHeldEmailHtml({
            name: String(profile?.name ?? ''),
            email: guard.value.email,
            missingLabels: completion.missingLabels,
          }),
          text: kycRequestHeldEmailText({
            name: String(profile?.name ?? ''),
            email: guard.value.email,
            missingLabels: completion.missingLabels,
          }),
          tag: 'kyc-request-held',
        })
        if (!sent.ok) console.warn('[kyc] held-request email not sent:', sent.code)
      } catch (err) {
        console.warn('[kyc] held-request email failed:', err instanceof Error ? err.message : err)
      }
    })

    return fail(
      428,
      `Your verification request is on hold until your profile is complete — still missing: ${completion.missingLabels.join(', ')}. We emailed you the details.`,
      {
        code: 'profile_incomplete',
        details: {
          missing: completion.missing,
          missingLabels: completion.missingLabels,
          percent: completion.percent,
          heldAt,
        },
      },
    )
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

    // Sent after the response: the recorded request is the source of truth, so a slow or refused
    // email must never turn a successful request into an error the member has to act on.
    after(async () => {
      try {
        const profile = await getUserProfile(guard.value.uid)
        await recordAdminNotification({
          title: 'New verification request',
          body: `${profile?.name ? String(profile.name) + ' — ' : ''}${guard.value.email ?? guard.value.uid} requested an identity review.`,
          link: '/admin/users',
          tone: 'info',
          actorUid: guard.value.uid,
          actorEmail: guard.value.email ?? undefined,
        })
      } catch (err) {
        console.warn('[kyc] admin notification failed:', err instanceof Error ? err.message : err)
      }
      try {
        const { sendEmail, isResendConfigured, kycRequestReceivedEmailSubject, kycRequestReceivedEmailText, kycRequestReceivedEmailHtml } =
          await import('@/lib/email')
        if (!isResendConfigured() || !guard.value.email) return
        const profile = await getUserProfile(guard.value.uid)
        const copy = {
          name: String(profile?.name ?? ''),
          email: guard.value.email,
          requestedAt: result.requestedAt,
        }
        const sent = await sendEmail({
          to: guard.value.email,
          subject: kycRequestReceivedEmailSubject(),
          html: kycRequestReceivedEmailHtml(copy),
          text: kycRequestReceivedEmailText(copy),
          tag: 'kyc-request-received',
        })
        if (!sent.ok) console.warn('[kyc] request confirmation email not sent:', sent.code)
      } catch (err) {
        console.warn('[kyc] request confirmation email failed:', err instanceof Error ? err.message : err)
      }
    })

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
