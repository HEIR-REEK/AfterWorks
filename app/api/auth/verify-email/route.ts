/**
 * POST /api/auth/verify-email
 *
 * Consumes a Resend verification token. Public on purpose: the worker often opens the link on a
 * different device than the one that signed up, so we cannot require a session. The token itself
 * is the credential (HMAC + expiry + single-use jti).
 *
 * GET is intentionally not served — putting the token on a GET would log it in proxies and
 * Referer headers of every asset the success page then loads. The page POSTs it in a JSON body.
 */

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, maintenanceBlockForApi, requestContext, routeError } from '@/lib/guards'
import { consumeVerificationToken } from '@/lib/email-verification'
import { readJsonBody } from '@/lib/security-core'

export async function POST(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const { identity } = requestContext(req)
  const bucket = consumeBucket('email-verify-consume', 20, 60_000, identity.ipHash)
  if (!bucket.ok) {
    return fail(429, 'Too many verification attempts. Please wait a moment.', {
      code: 'rate_limited',
      headers: { 'Retry-After': String(bucket.retryAfterSec) },
    })
  }

  const parsed = await readJsonBody<{ token?: string }>(req, 8_000)
  if (!parsed.ok) return fail(400, parsed.error, { code: 'bad_request' })
  const token = typeof parsed.data.token === 'string' ? parsed.data.token.trim() : ''
  if (!token) return fail(400, 'A verification token is required.', { code: 'missing_token' })

  try {
    const result = await consumeVerificationToken(token)
    if (!result.ok) {
      const status = result.code === 'expired' || result.code === 'used' ? 410 : result.code === 'internal' ? 503 : 400
      return fail(status, result.error, { code: result.code })
    }

    await audit({
      action: 'EMAIL_VERIFIED',
      actorEmail: result.email,
      details: { uid: result.uid, alreadyVerified: Boolean(result.alreadyVerified) },
      req,
    })

    return json({
      ok: true,
      verified: true,
      alreadyVerified: Boolean(result.alreadyVerified),
      email: result.email,
      message: result.alreadyVerified
        ? 'This address was already verified. You can continue.'
        : 'Your email is verified. You can now complete your profile.',
    })
  } catch (err) {
    return routeError('auth/verify-email', err)
  }
}
