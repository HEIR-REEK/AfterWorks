/**
 * POST /api/auth/send-verification
 *
 * Sends (or re-sends) the Resend verification email for the signed-in member. The address is
 * taken from the ID token, never from the body, so a tab cannot redirect someone else's mail.
 *
 * Auth: Firebase ID token. Unverified members are the intended callers — this is the one
 * privileged-adjacent route that must work *before* `email_verified` is true.
 */

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, maintenanceBlockForApi, requestContext, requireUser, routeError } from '@/lib/guards'
import { sendVerificationForUser, publicAppOrigin, EMAIL_VERIFY_TTL_HOURS } from '@/lib/email-verification'
import { envInt } from '@/lib/security-core'

export async function POST(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response
  const { uid, email, emailVerified } = guard.value

  if (emailVerified) {
    return json({ ok: true, alreadyVerified: true, message: 'This address is already verified.' })
  }
  if (!email) {
    return fail(400, 'This account has no email address to verify.', { code: 'email_required' })
  }

  const perUser = consumeBucket('email-verify-user', envInt('EMAIL_VERIFY_PER_USER', 3), 15 * 60_000, uid)
  if (!perUser.ok) {
    return fail(429, 'We already sent several verification emails. Check your inbox (and spam), then retry in a few minutes.', {
      code: 'rate_limited',
      headers: { 'Retry-After': String(perUser.retryAfterSec) },
    })
  }
  const { identity } = requestContext(req)
  const perIp = consumeBucket('email-verify-ip', envInt('EMAIL_VERIFY_PER_IP', 10), 15 * 60_000, identity.ipHash)
  if (!perIp.ok) {
    return fail(429, 'Too many verification emails from this network. Please wait a few minutes.', {
      code: 'rate_limited',
      headers: { 'Retry-After': String(perIp.retryAfterSec) },
    })
  }

  try {
    const origin = publicAppOrigin(req)
    let name = ''
    try {
      const { getUserProfile } = await import('@/lib/firestore-admin')
      const profile = await getUserProfile(uid)
      if (typeof profile?.name === 'string') name = profile.name
    } catch {
      /* first-name fallback inside the template is the email local-part */
    }
    const result = await sendVerificationForUser({
      uid,
      email,
      name,
      origin,
      ipHash: identity.ipHash,
    })
    if (!result.ok) {
      const status = result.code === 'email_unconfigured' || result.code === 'signing_unconfigured' ? 503 : 400
      return fail(status, result.error, { code: result.code })
    }
    if (result.alreadyVerified) {
      return json({ ok: true, alreadyVerified: true, message: 'This address is already verified.' })
    }

    await audit({
      action: 'EMAIL_VERIFICATION_SENT',
      actorEmail: email,
      details: { uid, expiresAt: result.expiresAt },
      req,
    })

    return json({
      ok: true,
      sent: true,
      expiresInHours: EMAIL_VERIFY_TTL_HOURS,
      message: `We sent a verification link to ${email}. It expires in ${EMAIL_VERIFY_TTL_HOURS} hours.`,
    })
  } catch (err) {
    return routeError('auth/send-verification', err)
  }
}
