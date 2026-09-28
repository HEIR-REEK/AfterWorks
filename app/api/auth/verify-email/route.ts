/**
 * POST /api/auth/verify-email
 *
 * Consumes a Resend verification token. Public on purpose: the worker often opens the link on a
 * different device than the one that signed up, so we cannot require a session. The token itself
 * is the credential (HMAC + expiry + single-use jti).
 *
 * GET is intentionally not served — putting the token on a GET would log it in proxies and
 * Referer headers of every asset the success page then loads. The page POSTs it in a JSON body.
 *
 * A *signed-in* caller is not what authorises the verification, and the two are reported
 * separately on purpose. Someone verifies their inbox on their phone; the same browser may still
 * be holding a different account's session (a shared device, a second profile, a colleague's
 * tablet). If the response said only "verified: true", the page would paint whichever address
 * that stale session carried and tell the member the wrong inbox is confirmed. So the response
 * always names the address the token was actually issued for, plus whether it is the address of
 * the session that happened to make the request.
 */

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, maintenanceBlockForApi, requestContext, routeError } from '@/lib/guards'
import { consumeVerificationToken } from '@/lib/email-verification'
import { readJsonBody } from '@/lib/security-core'

/**
 * Best-effort: who is this request from, if anyone?
 *
 * Never fails the verification. The token is the credential; a missing, expired or unverifiable
 * session just means the page must ask the member to sign in as the address it just confirmed,
 * which is the safe default anyway.
 */
async function signedInIdentity(req: NextRequest): Promise<{ uid: string; email: string } | null> {
  const header = req.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  try {
    const { verifyIdToken } = await import('@/lib/firestore-admin')
    const decoded = await verifyIdToken(header.slice(7).trim())
    if (!decoded?.uid) return null
    return { uid: decoded.uid, email: (decoded.email || '').toLowerCase() }
  } catch {
    return null
  }
}

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

    // Read the session *after* consuming, so a member who verified in another tab still gets an
    // accurate "sign in as this address" instruction rather than a page claiming the account they
    // happen to be holding is the one that was just verified.
    const session = await signedInIdentity(req)

    return json({
      ok: true,
      verified: true,
      alreadyVerified: Boolean(result.alreadyVerified),
      /** The address the link was issued for. Never the session's address. */
      email: result.email,
      /** True when this browser is signed in as the account that was just verified. */
      sessionMatches: session ? session.uid === result.uid : null,
      /** The address this browser is signed in as, when it is a *different* account. */
      signedInEmail: session && session.uid !== result.uid ? session.email : null,
      message: result.alreadyVerified
        ? 'This address was already verified. You can continue.'
        : 'Your email is verified. You can now complete your profile.',
    })
  } catch (err) {
    return routeError('auth/verify-email', err)
  }
}
