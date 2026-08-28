import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, requireAdmin, routeError } from '@/lib/guards'
import { sanitizeLine } from '@/lib/security-core'
import { ADMIN_MUTABLE_STATES, isStateTransitionAllowed } from '@/lib/admin-domain'

/**
 * /api/admin/users
 *
 * GET   ?pageSize&cursor&search&state        → one redacted, cursor-paginated page
 * GET   ?uid                                  → full profile for the detail drawer
 * PATCH { uid, action, payload, reason }      → moderation, KYC verdict, role change, wallet edit
 *
 * Why this exists: previously the users table wrote `users/{uid}` documents directly from the
 * browser, including an "isAdmin" toggle. The security rules in force at the time let the *owner*
 * write their own document, so any worker could have granted themselves `role: 'admin'` (and then
 * `lib/admin.ts` trusted it). Privilege now changes only here, only for a verified administrator,
 * with a mandatory reason, and it is always audited.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'User directory unavailable (storage not configured).', { code: 'storage_unavailable' })

    const uid = req.nextUrl.searchParams.get('uid')
    if (uid) {
      const detail = await firestore.getUserDetail(uid.slice(0, 128))
      if (!detail) return fail(404, 'No such user.', { code: 'user_not_found' })
      return json({ ok: true, user: redactSecrets(detail) })
    }

    const page = await firestore.listUsersPage({
      pageSize: Number(req.nextUrl.searchParams.get('pageSize') ?? 25),
      cursor: req.nextUrl.searchParams.get('cursor'),
      search: req.nextUrl.searchParams.get('search') ?? '',
      state: req.nextUrl.searchParams.get('state') ?? 'all',
    })
    return json({ ok: true, ...page })
  } catch (err) {
    return routeError('admin/users:GET', err)
  }
}

function redactSecrets(input: Record<string, unknown>): Record<string, unknown> {
  const out = { ...input }
  for (const key of Object.keys(out)) {
    if (/private|token|secret|password|session/i.test(key)) out[key] = '[redacted]'
  }
  if (out.bankAccountNumber) out.bankAccountNumberMasked = `••••${String(out.bankAccountNumber).slice(-4)}`
  return out
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('admin-users', 40, 60_000, String(guard.value.jti).slice(0, 12))
  if (!bucket.ok) return fail(429, 'Too many user actions in a short window. Please wait.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 32_000) return fail(413, 'Payload is too large.', { code: 'payload_too_large' })
    body = JSON.parse(raw || '{}')
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }

  const uid = sanitizeLine(body.uid, 128)
  const action = String(body.action ?? '')
  const payload = (body.payload ?? {}) as Record<string, unknown>
  const reason = sanitizeLine(body.reason ?? '', 300)

  if (!uid) return fail(400, 'A user id is required.', { code: 'missing_uid' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Storage unavailable — no changes were made.', { code: 'storage_unavailable' })

    switch (action) {
      case 'moderate': {
        const state = String(payload.accountState ?? '')
        if (!ADMIN_MUTABLE_STATES.includes(state as (typeof ADMIN_MUTABLE_STATES)[number])) {
          return fail(400, 'Unknown account state.', { code: 'invalid_state' })
        }
        if ((state === 'suspended' || state === 'banned') && reason.length < 4) {
          return fail(400, 'A short reason is required when restricting an account.', { code: 'reason_required' })
        }
        const detail = await firestore.getUserDetail(uid)
        if (!detail) return fail(404, 'No such user.', { code: 'user_not_found' })
        if (!isStateTransitionAllowed(String(detail.accountState ?? 'active'), state)) {
          return fail(409, `Cannot move an account from ${detail.accountState} to ${state}.`, { code: 'transition_denied' })
        }

        await firestore.adminUpdateUser(uid, { accountState: state, moderationReason: reason }, guard.value.email, 'USER_MODERATED')
        await firestore.notifyUser(uid, {
          title: state === 'active' ? 'Account restored' : `Account ${state.replace(/_/g, ' ')}`,
          body:
            state === 'active'
              ? 'Your account is back in good standing. Earnings and applications are unaffected.'
              : reason || 'Our team restricted this account. Contact support if you believe this is a mistake.',
          tone: state === 'active' ? 'success' : 'warning',
          link: '/profile',
        })
        await audit({
          action: `USER_${state.toUpperCase()}`,
          actorEmail: guard.value.email,
          details: { uid, reason, from: detail.accountState },
          req,
        })
        return json({ ok: true, accountState: state })
      }

      case 'kyc': {
        const approve = payload.approve === true
        if (!approve && reason.length < 4) return fail(400, 'Tell the worker what to fix.', { code: 'reason_required' })
        await firestore.verifyKycAdmin(uid, approve, reason, guard.value.email)
        await audit({ action: approve ? 'KYC_MANUAL_APPROVED' : 'KYC_MANUAL_REJECTED', actorEmail: guard.value.email, details: { uid, reason }, req })
        return json({ ok: true, kycVerified: approve })
      }

      case 'role': {
        const isAdmin = payload.isAdmin === true
        const targetEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
        if (!targetEmail) return fail(400, 'Provide the account email whose role is changing.', { code: 'missing_email' })
        if (guard.value.email === targetEmail && !isAdmin) {
          return fail(409, 'You cannot revoke your own admin role from this console.', { code: 'self_demotion' })
        }
        const ok = await firestore.setUserAdminFlagByEmail(targetEmail, isAdmin, guard.value.email)
        if (!ok) return fail(404, 'No user document matches that email.', { code: 'user_not_found' })
        const { invalidateAdminCache } = await import('@/lib/guards')
        invalidateAdminCache(targetEmail.toLowerCase())
        await audit({
          action: isAdmin ? 'ADMIN_ROLE_GRANTED' : 'ADMIN_ROLE_REVOKED',
          actorEmail: guard.value.email,
          details: { target: targetEmail, reason },
          req,
        })
        return json({ ok: true, isAdmin })
      }

      case 'wallet': {
        const pending = Number(payload.pendingUsd)
        const available = Number(payload.availableUsd)
        const payoutNumber = payload.payoutNumber === undefined ? undefined : sanitizeLine(payload.payoutNumber, 24)
        if (![pending, available].every((n) => Number.isFinite(n) && n >= 0 && n <= 1_000_000)) {
          return fail(400, 'Balances must be non-negative numbers under 1,000,000 USD.', { code: 'invalid_amount' })
        }
        if (reason.length < 4) return fail(400, 'Manual balance edits require a reason for the ledger.', { code: 'reason_required' })

        await firestore.adminUpdateUser(
          uid,
          { wallet: { pendingUsd: Math.round(pending * 100) / 100, availableUsd: Math.round(available * 100) / 100, ...(payoutNumber !== undefined ? { payoutNumber } : {}) } },
          guard.value.email,
          'WALLET_ADJUSTED',
        )
        await firestore.notifyUser(uid, {
          title: 'Wallet balance updated',
          body: `Our team adjusted your balance (${reason}). Contact support if this looks wrong.`,
          tone: 'info',
          link: '/profile',
        })
        await audit({ action: 'WALLET_ADJUSTED', actorEmail: guard.value.email, details: { uid, pending, available, reason }, req })
        return json({ ok: true })
      }

      case 'delete': {
        if (reason.length < 6) return fail(400, 'Deletion needs a written justification.', { code: 'reason_required' })
        await firestore.adminUpdateUser(uid, { accountState: 'banned', deletedAt: new Date().toISOString(), moderationReason: reason }, guard.value.email, 'USER_MARKED_DELETED')
        await audit({ action: 'USER_SOFT_DELETED', actorEmail: guard.value.email, details: { uid, reason }, req })
        return json({
          ok: true,
          softDelete: true,
          note: 'The account is banned and flagged for deletion. Hard deletion is a data-retention task run from the console export job, not a browser request.',
        })
      }

      case 'fields': {
        const detail = await firestore.getUserDetail(uid)
        if (!detail) return fail(404, 'No such user.', { code: 'user_not_found' })
        const allowed = ['name', 'location', 'qualityScore', 'jobsCompleted', 'preferredPayoutMethod'] as const
        const clean: Record<string, unknown> = {}
        for (const key of allowed) {
          if (payload[key] === undefined) continue
          clean[key] =
            key === 'qualityScore' || key === 'jobsCompleted'
              ? Math.max(0, Math.min(1000, Math.round(Number(payload[key]) || 0)))
              : sanitizeLine(payload[key], 120)
        }
        if (Object.keys(clean).length === 0) return fail(400, 'No editable fields were supplied.', { code: 'empty_patch' })
        const applied = await firestore.adminUpdateUser(uid, clean, guard.value.email, 'USER_FIELDS_UPDATED')
        return json({ ok: true, applied: applied.applied })
      }

      default:
        return fail(400, `Unsupported user action "${action || '(blank)'}".`, { code: 'unknown_action' })
    }
  } catch (err) {
    return routeError('admin/users:PATCH', err)
  }
}
