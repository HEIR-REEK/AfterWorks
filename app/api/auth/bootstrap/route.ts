/**
 * POST /api/auth/bootstrap — make sure this account has a complete profile document.
 *
 * Why this exists
 * ---------------
 * The profile is written by the member's own browser (`createUserDocument` in `lib/firestore.ts`),
 * which means it is a write the Firestore *rules* have to permit. For an email/password sign-up
 * that is easy: the document is created with `emailVerified: false`, and the create rule accepts
 * that without consulting the token.
 *
 * A Google sign-up arrives with the address already proven, so the document is created with
 * `emailVerified: true` — and the create rule then requires `request.auth.token.email_verified` to
 * be true as well. That is one more thing that has to line up, and when it does not the write is
 * refused. Nothing else fails: the member is signed in, the terms acceptance and the referral claim
 * both go through the Admin SDK and ignore the rules, and the account works. The only casualty is
 * the profile document, which never appears.
 *
 * The result is a `users/{uid}` with no `email`, no `name`, no `role` and no `accountState` — a stub.
 * The console lists it, shows a blank email, and labels it "Incomplete record". It cannot be repaired
 * from the browser either: the update rule reads `resource.data.email`, which does not exist on a
 * stub, so a client backfill is refused for the same reason the create was.
 *
 * This route closes that gap with the one writer the rules cannot refuse. It runs after sign-up,
 * takes the uid and the address from the verified token rather than the request body, and fills in
 * only what is missing — it never overwrites a value the member already has, and in particular never
 * moves an email address, because that field is the account's identity.
 *
 * It is safe to call on every sign-in, not just the first: an account that is already complete is
 * left untouched and the route says so.
 */

import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, requireUser, routeError } from '@/lib/guards'
import { adminDb } from '@/lib/firestore-admin'

export const dynamic = 'force-dynamic'

/** The inert state a brand-new account is created in. Mirrors `createUserDocument`. */
const BLANK_PROFILE = {
  location: '',
  memberSince: '',
  qualityScore: 100,
  jobsCompleted: 0,
  kycVerified: false,
  accountState: 'active',
  role: 'user',
  isAdmin: false,
  phone: '',
  bio: '',
  skills: [] as string[],
  languages: [] as string[],
  preferredPayoutMethod: 'M-Pesa',
  paidTrainings: [] as string[],
  wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '' },
} as const

export async function POST(req: NextRequest) {
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response
  const { uid, email, emailVerified } = guard.value

  if (!email) {
    // Without an address there is nothing to bootstrap with, and inventing one would be worse than
    // leaving the profile alone. The console can still show the account from Auth.
    return fail(400, 'This account has no email address on record.', { code: 'email_required' })
  }

  const bucket = consumeBucket('auth-bootstrap', 6, 60_000, uid)
  if (!bucket.ok) {
    return fail(429, 'Too many attempts. Please wait a moment.', { code: 'rate_limited', headers: { 'Retry-After': String(bucket.retryAfterSec) } })
  }

  try {
    const ref = adminDb().collection('users').doc(uid)
    const snap = await ref.get()
    const data = (snap.data() ?? {}) as Record<string, unknown>

    // Only what is missing. An existing value is the member's, including their email: a bootstrap
    // must never become a way to move an address.
    const patch: Record<string, unknown> = {}

    const currentEmail = typeof data.email === 'string' ? data.email.trim() : ''
    if (!currentEmail) patch.email = email

    const currentName = typeof data.name === 'string' ? data.name.trim() : ''
    if (!currentName) patch.name = email.split('@')[0] ?? 'Worker'

    // A stub has none of the inert defaults, so the account reads as "no state, no role" everywhere
    // downstream — the members table, the state filters, the dashboard counts.
    for (const [key, value] of Object.entries(BLANK_PROFILE)) {
      if (data[key] === undefined) patch[key] = value
    }

    // A proven inbox is recorded as proven. Never the reverse: an unverified address must not be
    // marked verified because this route ran.
    if (emailVerified && data.emailVerified !== true) {
      patch.emailVerified = true
      if (typeof data.emailVerifiedAt !== 'string') patch.emailVerifiedAt = new Date().toISOString()
    }

    if (Object.keys(patch).length === 0) {
      return json({ ok: true, alreadyComplete: true, patched: [] })
    }

    patch.updatedAt = new Date().toISOString()
    await ref.set(patch, { merge: true })
    return json({ ok: true, alreadyComplete: false, patched: Object.keys(patch) })
  } catch (err) {
    return routeError('auth/bootstrap:POST', err)
  }
}
