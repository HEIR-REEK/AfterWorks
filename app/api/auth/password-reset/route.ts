/**
 * POST /api/auth/password-reset — self-service password reset with an emailed one-time code.
 *
 *   { step: 'request',  email }             → send a code (identical response for unknown addresses)
 *   { step: 'verify',   email, code }       → check the code, return a short-lived reset ticket
 *   { step: 'complete', ticket, password }  → set the new password, revoke other sessions
 *
 * Public by design — the whole point is that the caller cannot sign in. Every step is throttled
 * per IP, the request step is additionally throttled per address, and the verify step burns the
 * code after PASSWORD_RESET_MAX_ATTEMPTS wrong guesses. Nothing here reveals whether an address
 * has an account; only the audit log knows.
 *
 * Exempt from scoped maintenance windows together with the rest of /api/auth (see
 * `MAINTENANCE_SIGN_IN_PATHS`); a whole-site blackout still closes it.
 */

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, maintenanceBlockForApi, requestContext, routeError } from '@/lib/guards'
import { envInt, isEmailLike, readJsonBody } from '@/lib/security-core'
import {
  completePasswordResetWithTicket,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_CODE_TTL_MINUTES,
  PASSWORD_RESET_MAX_ATTEMPTS,
  PASSWORD_RESET_RESEND_COOLDOWN_SEC,
  requestPasswordReset,
  verifyPasswordResetCode,
} from '@/lib/password-reset'

type Body = { step?: string; email?: string; code?: string; ticket?: string; password?: string }

export async function POST(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const { identity } = requestContext(req)
  const perIp = consumeBucket('password-reset-ip', envInt('PASSWORD_RESET_PER_IP', 20), 15 * 60_000, identity.ipHash)
  if (!perIp.ok) {
    return fail(429, 'Too many password reset attempts from this network. Please wait a few minutes.', {
      code: 'rate_limited',
      headers: { 'Retry-After': String(perIp.retryAfterSec) },
    })
  }

  const parsed = await readJsonBody<Body>(req, 8_000)
  if (!parsed.ok) return fail(400, parsed.error, { code: 'bad_request' })
  const body = parsed.data
  const step = String(body.step ?? '')
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  try {
    switch (step) {
      case 'request': {
        if (!isEmailLike(email)) return fail(400, 'Enter the email address you signed up with.', { code: 'invalid_email' })
        const result = await requestPasswordReset({ email, ipHash: identity.ipHash })
        if (!result.ok) {
          const status = result.code === 'rate_limited' || result.code === 'cooldown' ? 429 : result.code === 'invalid_email' ? 400 : 503
          return fail(status, result.error, {
            code: result.code,
            retryAfterSec: result.retryAfterSec,
            headers: result.retryAfterSec ? { 'Retry-After': String(result.retryAfterSec) } : undefined,
          })
        }
        await audit({
          action: result.sent ? 'PASSWORD_RESET_REQUESTED' : 'PASSWORD_RESET_REQUESTED_UNKNOWN',
          actorEmail: email,
          details: { sent: result.sent, expiresAt: result.expiresAt, ip: identity.ipHash },
          req,
        })
        // Same body whether or not the address exists.
        return json({
          ok: true,
          step: 'verify',
          message: `If an account exists for ${email}, a ${PASSWORD_RESET_CODE_TTL_MINUTES}-minute code is on its way. Check spam too.`,
          expiresInMinutes: PASSWORD_RESET_CODE_TTL_MINUTES,
          resendAfterSec: result.cooldownSec ?? PASSWORD_RESET_RESEND_COOLDOWN_SEC,
          maxAttempts: PASSWORD_RESET_MAX_ATTEMPTS,
        })
      }

      case 'verify': {
        if (!isEmailLike(email)) return fail(400, 'Enter the email address you signed up with.', { code: 'invalid_email' })
        const result = await verifyPasswordResetCode({ email, code: String(body.code ?? ''), ipHash: identity.ipHash })
        if (!result.ok) {
          const status = result.code === 'rate_limited' ? 429 : result.code === 'internal' ? 503 : result.code === 'expired' || result.code === 'burned' ? 410 : 400
          if (result.code !== 'internal') {
            await audit({ action: 'PASSWORD_RESET_CODE_REJECTED', actorEmail: email, details: { reason: result.code, attemptsLeft: result.attemptsLeft, ip: identity.ipHash }, req })
          }
          return fail(status, result.error, {
            code: result.code,
            attemptsLeft: result.attemptsLeft,
            retryAfterSec: result.retryAfterSec,
            headers: result.retryAfterSec ? { 'Retry-After': String(result.retryAfterSec) } : undefined,
          })
        }
        await audit({ action: 'PASSWORD_RESET_CODE_VERIFIED', actorEmail: email, details: { uid: result.uid, ip: identity.ipHash }, req })
        return json({
          ok: true,
          step: 'complete',
          ticket: result.ticket,
          ticketExpiresAt: new Date(result.ticketExpiresAt).toISOString(),
          minPasswordLength: MIN_PASSWORD_LENGTH,
          message: 'Code accepted. Choose a new password.',
        })
      }

      case 'complete': {
        const result = await completePasswordResetWithTicket({ ticket: body.ticket, password: body.password })
        if (!result.ok) {
          const status =
            result.code === 'weak_password' ? 400 : result.code === 'expired' || result.code === 'used' || result.code === 'invalid_ticket' ? 410 : result.code === 'malformed' ? 400 : 503
          return fail(status, result.error, { code: result.code })
        }
        await audit({ action: 'PASSWORD_RESET_COMPLETED', actorEmail: result.email, details: { uid: result.uid, ip: identity.ipHash, selfService: true }, req })
        return json({
          ok: true,
          step: 'done',
          email: result.email,
          message: 'Your password is updated and other devices have been signed out. Sign in with the new password.',
        })
      }

      default:
        return fail(400, 'Unknown password reset step.', { code: 'bad_request' })
    }
  } catch (err) {
    return routeError('auth/password-reset', err)
  }
}
