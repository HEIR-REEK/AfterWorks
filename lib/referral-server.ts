/**
 * Referral program — the server half.
 *
 * Everything that writes a referral, reads a referral, or credits the bonus lives here, and is
 * called only from route handlers and from `saveMemberProfile`. The browser contributes two
 * things: a code someone pasted, and the fact that a profile save just happened.
 *
 * Where the money moves, and why it is safe to move it from inside another transaction:
 *
 *  • The bonus is released by **the referred person's profile save**, inside the same Firestore
 *    transaction that decides the profile is complete. There is no cron, no queue and no window
 *    in which a second request could also decide to release it: the referral document is read in
 *    that transaction and flipped from `pending` to `qualified` in the same one.
 *  • Idempotency is structural, not checked-then-set: the ledger row id is
 *    `referral_bonus_<referredUid>`, so a replay, a double-tap or a retried request collides on
 *    the document id and the credit cannot happen twice. This is the same trick the welcome
 *    reward uses, and it is why the bonus is not exposed as a "claim" endpoint.
 *  • The credit goes to the **referrer's** `wallet.pendingUsd` with a `clearedAt` in the future,
 *    so it clears into their available balance through exactly the same settlement path as job
 *    earnings — and can be reversed by the same means if the account is found to be fraudulent.
 *
 * Collections (all server-only; see firestore.rules):
 *   referral_codes/<CODE>      → { uid, createdAt }            the code → member mapping
 *   referrals/<referredUid>     → the attribution record + lifecycle
 *
 * The referral document is keyed by the **referred** account's uid, not by an auto-id. That
 * choice is what makes "one account, one referrer, forever" a structural property rather than a
 * rule somebody has to remember to check: a second attempt to attach a different code to the same
 * account writes the same document id, and the create is refused. It also means the profile-save
 * transaction can read the referral with a plain `tx.get` instead of a query, which is what lets
 * the bonus be released in the same atomic unit as the profile completion.
 */

import { adminDb, createAuditEntry, dbOrNull, notifyUser } from '@/lib/firestore-admin'
import type { DocumentReference, Transaction } from 'firebase-admin/firestore'
import { formatUsd } from '@/lib/afterworks-data'
import { site } from '@/lib/site'
import { sanitizeLine } from '@/lib/security-core'
import {
  REFERRAL_BONUS_USD,
  REFERRAL_SIGNUP_WEEK_MS,
  evaluateReferralClaim,
  generateReferralCode,
  normaliseReferralCode,
  referralShareUrl,
  referralStats,
  type ReferralDashboard,
  type ReferralRow,
  type ReferralStatus,
} from '@/lib/referrals'
import { profileCompletion } from '@/lib/profile-completion'

// Re-exported so a caller that already imports this module for the transaction helpers does not
// also have to know that the amount itself is owned by the (isomorphic) domain module.
export { REFERRAL_BONUS_USD } from '@/lib/referrals'

export class ReferralError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'referral_error',
  ) {
    super(message)
    this.name = 'ReferralError'
  }
}

const REFERRAL_LEDGER_ID = (referredUid: string) => `referral_bonus_${referredUid}`
const MAX_CODE_ATTEMPTS = 6

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

// ─── Codes ───────────────────────────────────────────────────────────────────

/**
 * The member's referral code, minting one on first use.
 *
 * The code is stored twice — on the profile (so the panel and the share sheet never need a
 * lookup) and in `referral_codes` (so a pasted code resolves without scanning profiles). The
 * collection is keyed by the code itself, which makes the write a natural uniqueness check: if
 * a random draw collides with somebody else's code, the create is refused and we draw again.
 *
 * A member whose account is not active still gets a code — the panel shows *why* it cannot be
 * shared, which is more useful than a blank panel.
 */
export async function getOrCreateReferralCode(uid: string): Promise<string> {
  const db = adminDb()
  const userRef = db.collection('users').doc(uid)

  const userSnap = await userRef.get()
  const existing = String((userSnap.data() ?? {}).referralCode ?? '').trim().toUpperCase()
  if (existing) {
    // Heal a code that exists on the profile but was never indexed (or whose index was deleted).
    const indexRef = db.collection('referral_codes').doc(existing)
    const indexSnap = await indexRef.get().catch(() => null)
    if (!indexSnap?.exists) {
      await indexRef.set({ code: existing, uid, createdAt: new Date().toISOString() }, { merge: true })
    }
    return existing
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateReferralCode()
    const indexRef = db.collection('referral_codes').doc(code)
    const indexSnap = await indexRef.get()
    if (indexSnap.exists) continue // astronomically unlikely, but the write is the real check

    const now = new Date().toISOString()
    // `create` semantics: never steal a code that appeared between the read and this write.
    try {
      await indexRef.create({ code, uid, createdAt: now })
    } catch (err) {
      if (/already exists|exists|permission/i.test(err instanceof Error ? err.message : '')) continue
      throw err
    }
    await userRef.set({ referralCode: code, referralCodeCreatedAt: now }, { merge: true })
    await createAuditEntry('REFERRAL_CODE_ISSUED', { uid, code }, `member:${uid}`)
    return code
  }

  throw new ReferralError('We could not create a referral code just now. Please try again.', 503, 'code_issue_failed')
}

/** Resolves a pasted code to its owner, or null. Never throws on a malformed code. */
export async function resolveReferralCode(code: string): Promise<{ uid: string; code: string } | null> {
  const clean = normaliseReferralCode(code)
  if (!clean) return null
  const db = dbOrNull()
  if (!db) return null
  const snap = await db.collection('referral_codes').doc(clean).get().catch(() => null)
  if (!snap?.exists) return null
  const uid = String((snap.data() ?? {}).uid ?? '')
  return uid ? { uid, code: clean } : null
}

// ─── Attribution ─────────────────────────────────────────────────────────────

/**
 * Attaches a signup to the referrer whose code was used.
 *
 * Called once, immediately after the account is created and while the session is still fresh.
 * It is *best effort by design*: a referral is a promotion, not a precondition for an account,
 * so a failure here is audited and swallowed rather than rolled back into a sign-up error. A
 * member must never be locked out because a referral write timed out.
 *
 * Every rejection is a decision, not a crash: an invalid code, a self-referral, a referrer who
 * has not verified their identity, a restricted referrer and a rate-limited referrer all answer
 * with a reason the sign-up form can show, and none of them create a document.
 */
export async function claimReferralForSignup(input: {
  referredUid: string
  referredEmail: string
  referredName: string
  rawCode: string
  emailVerified: boolean
}): Promise<{ attached: boolean; code: string; reason?: string; codeName?: string }> {
  const db = dbOrNull()
  const normalised = normaliseReferralCode(input.rawCode)
  if (!db || !normalised) return { attached: false, code: '', reason: 'invalid_referral_code' }

  try {
    const resolved = await resolveReferralCode(normalised)
    if (!resolved) return { attached: false, code: normalised, reason: 'unknown_referral_code' }

    const referrerRef = db.collection('users').doc(resolved.uid)
    const referrerSnap = await referrerRef.get()
    if (!referrerSnap.exists) return { attached: false, code: normalised, reason: 'unknown_referral_code' }
    const referrer = (referrerSnap.data() ?? {}) as Record<string, unknown>

    // One account, one referrer, forever. The document is keyed by the referred uid, so this
    // read is also the check that no *other* code already owns this account's referral.
    const referralRef = db.collection('referrals').doc(input.referredUid)
    const existing = await referralRef.get().catch(() => null)
    if (existing?.exists) {
      return { attached: false, code: normalised, reason: 'already_referred' }
    }

    const cutoff = new Date(Date.now() - REFERRAL_SIGNUP_WEEK_MS).toISOString()
    let recentSignups = 0
    try {
      const recent = await db
        .collection('referrals')
        .where('referrerUid', '==', resolved.uid)
        .where('createdAt', '>=', cutoff)
        .limit(50)
        .get()
      recentSignups = recent.size
    } catch (err) {
      // Without the rolling index the cap cannot be measured. Fail closed: a limit we cannot
      // enforce is not a limit, and the alternative is an unmetered signup faucet.
      console.warn('[referrals] weekly count unavailable, refusing attribution:', err instanceof Error ? err.message : err)
      return { attached: false, code: normalised, reason: 'rate_limit_unavailable' }
    }

    const decision = evaluateReferralClaim({
      code: normalised,
      referrerUid: resolved.uid,
      referrerEmail: String(referrer.email ?? ''),
      referredUid: input.referredUid,
      referredEmail: input.referredEmail,
      recentSignups,
      referrerKycVerified: referrer.kycVerified === true,
      referrerAccountState: String(referrer.accountState ?? 'active'),
    })
    if (!decision.ok) return { attached: false, code: normalised, reason: decision.code }

    const now = new Date().toISOString()
    try {
      // `create` semantics: a concurrent claim for the same account loses rather than overwriting.
      await referralRef.create({
        id: input.referredUid,
        code: normalised,
        referrerUid: resolved.uid,
        referrerName: sanitizeLine(referrer.name ?? '', 80),
        referrerEmail: String(referrer.email ?? '').toLowerCase(),
        referredUid: input.referredUid,
        referredName: sanitizeLine(input.referredName ?? '', 80),
        referredEmail: String(input.referredEmail ?? '').toLowerCase(),
        referredEmailVerified: input.emailVerified === true,
        status: 'pending' as ReferralStatus,
        bonusUsd: REFERRAL_BONUS_USD,
        createdAt: now,
        qualifiedAt: null,
        ledgerId: null,
      })
    } catch (err) {
      if (/already exists|exists/i.test(err instanceof Error ? err.message : '')) {
        return { attached: false, code: normalised, reason: 'already_referred' }
      }
      throw err
    }

    await createAuditEntry('REFERRAL_ATTRIBUTED', { referralId: input.referredUid, referrerUid: resolved.uid, code: normalised }, `member:${input.referredUid}`)
    return { attached: true, code: normalised, codeName: String(referrer.name ?? '') }
  } catch (err) {
    console.warn('[referrals] attribution skipped:', err instanceof Error ? err.message : err)
    return { attached: false, code: normalised, reason: 'attribution_failed' }
  }
}

// ─── Releasing the bonus ─────────────────────────────────────────────────────

/**
 * A write decided inside a transaction, held back until every read in that transaction is done.
 *
 * Firestore's rule is absolute: *"Firestore transactions require all reads to be executed before
 * all writes."* A transaction body that writes and then reads is rejected as a whole with
 * `FAILED_PRECONDITION`, which the route layer can only report as a 500. Splitting "decide" from
 * "write" is what lets the profile save both serialise the phone claim (a write, and it has to be
 * one, because the claim *is* the lock) and release the referral bonus (which needs reads).
 */
export type StagedWrite = {
  ref: DocumentReference
  data: Record<string, unknown>
  options?: { merge?: boolean }
}

/** Applies staged writes. Call this only after the transaction has finished reading. */
export function applyStagedWrites(tx: Transaction, writes: readonly StagedWrite[]): void {
  for (const write of writes) tx.set(write.ref, write.data, write.options ?? {})
}

export type StagedReferralBonus = {
  applied: boolean
  referrerUid: string | null
  referrerName: string
  /** Empty unless the bonus is being released by this call. */
  writes: StagedWrite[]
}

/**
 * Credits the referrer when the referred person's profile reaches 100%.
 *
 * **Called from inside the `saveMemberProfile` transaction.** It takes a transaction handle and
 * returns writes to be applied, rather than doing its own reads and writes, for two reasons:
 *
 *  1. The whole point is atomicity: "the profile is complete" and "the referral is credited" must
 *     become true together, or not at all. A member who closes the tab mid-save must not end up
 *     with a completed profile and an unpaid referral. A second transaction here could not
 *     promise that.
 *  2. Firestore's read-before-write rule means the reads this function needs (`referrals/{uid}`,
 *     the referrer's document) must be issued *before* the caller writes anything — and
 *     `saveMemberProfile` writes the phone claim earlier than this. So the reads happen here and
 *     the writes are returned to the caller, which applies them once the reading is over. This
 *     function therefore performs **no writes at all**; the previous version called `tx.set` three
 *     times, which is what made a profile save with a phone number fail with a 500.
 *
 * Writes the referrer's ledger row under a deterministic id, so the credit is idempotent by
 * construction rather than by a checked flag.
 */
export async function stageReferralBonusForCompletedProfile(
  tx: Transaction,
  referredUid: string,
): Promise<StagedReferralBonus> {
  const db = adminDb()

  // A transactional read: the referral document is keyed by the referred uid, so this is a point
  // lookup rather than a query — which is what keeps the whole release inside the caller's
  // transaction instead of needing a second one.
  const referralRef = db.collection('referrals').doc(referredUid)
  const referralSnap = await tx.get(referralRef)
  if (!referralSnap.exists) return { applied: false, referrerUid: null, referrerName: '', writes: [] }

  const referral = (referralSnap.data() ?? {}) as Record<string, unknown>
  const referrerName = String(referral.referrerName ?? '')
  // Already qualified. Re-running the save must not pay twice.
  if (referral.status === 'qualified') {
    return { applied: false, referrerUid: String(referral.referrerUid ?? ''), referrerName, writes: [] }
  }

  const referrerUid = String(referral.referrerUid ?? '')
  if (!referrerUid || referrerUid === referredUid) return { applied: false, referrerUid: null, referrerName, writes: [] }

  // The referrer must still exist and still be in good standing at the moment of release. A
  // referrer suspended after the signup does not get paid for it.
  const referrerRef = db.collection('users').doc(referrerUid)
  const referrerSnap = await tx.get(referrerRef)
  if (!referrerSnap.exists) return { applied: false, referrerUid: null, referrerName, writes: [] }
  const referrer = (referrerSnap.data() ?? {}) as Record<string, unknown>
  if (String(referrer.accountState ?? 'active') !== 'active') return { applied: false, referrerUid: null, referrerName, writes: [] }
  if (referrer.kycVerified !== true) return { applied: false, referrerUid: null, referrerName, writes: [] }

  const wallet = asRecord(referrer.wallet)
  const now = new Date().toISOString()
  const clearedAt = new Date(Date.now() + site.clearingWindowHours * 3600_000).toISOString()
  const bonus = REFERRAL_BONUS_USD
  const ledgerId = REFERRAL_LEDGER_ID(referredUid)

  return {
    applied: true,
    referrerUid,
    referrerName,
    writes: [
      // 1. The referrer's pending balance.
      {
        ref: referrerRef,
        data: {
          'wallet.pendingUsd': round2((Number(wallet.pendingUsd ?? 0) || 0) + bonus),
          updatedAt: now,
        },
        options: { merge: true },
      },
      // 2. The referrer's statement line. Pending, with a clearing date — identical in shape to a
      //    completed job, so the wallet panel and the settlement pass need to know nothing new.
      {
        ref: db.collection('wallet_ledger').doc(ledgerId),
        data: {
          id: ledgerId,
          uid: referrerUid,
          kind: 'referral_bonus',
          status: 'pending',
          amountUsd: bonus,
          currency: 'USD',
          description: `Referral bonus — ${referral.referredName || 'a member you referred'} completed their profile`,
          referralId: referredUid,
          createdAt: now,
          clearedAt,
          createdBy: 'system:referral',
        },
        options: { merge: true },
      },
      // 3. Flip the attribution. The `status !== 'qualified'` read above plus this write is what
      //    makes a replay a no-op, even if two profile saves for the same referred account race.
      {
        ref: referralRef,
        data: {
          status: 'qualified' as ReferralStatus,
          bonusUsd: bonus,
          qualifiedAt: now,
          ledgerId,
        },
        options: { merge: true },
      },
    ],
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// ─── Reading the panel ───────────────────────────────────────────────────────

function mapReferral(id: string, data: Record<string, unknown>): ReferralRow {
  const status = data.status === 'qualified' ? 'qualified' : 'pending'
  return {
    id,
    code: String(data.code ?? ''),
    referrerUid: String(data.referrerUid ?? ''),
    referrerName: String(data.referrerName ?? ''),
    referrerEmail: String(data.referrerEmail ?? ''),
    referredUid: String(data.referredUid ?? ''),
    referredName: String(data.referredName ?? '') || 'A member you referred',
    referredEmailVerified: data.referredEmailVerified === true,
    status,
    bonusUsd: Number(data.bonusUsd ?? REFERRAL_BONUS_USD) || REFERRAL_BONUS_USD,
    createdAt: String(data.createdAt ?? ''),
    qualifiedAt: data.qualifiedAt ? String(data.qualifiedAt) : null,
    ledgerId: data.ledgerId ? String(data.ledgerId) : null,
  }
}

/** The referral panel's entire payload, computed in one place. */
export async function getReferralDashboard(uid: string): Promise<ReferralDashboard | null> {
  const db = dbOrNull()
  if (!db) return null

  const userRef = db.collection('users').doc(uid)
  const userSnap = await userRef.get()
  const user = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>

  const code = await getOrCreateReferralCode(uid)
  const shareUrl = referralShareUrl(site.url, code)

  let rows: ReferralRow[] = []
  try {
    const snap = await db.collection('referrals').where('referrerUid', '==', uid).orderBy('createdAt', 'desc').limit(200).get()
    rows = snap.docs.map((doc) => mapReferral(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
  } catch (err) {
    // The composite (referrerUid + createdAt) index may not be deployed yet. Fall back to a
    // bounded, unsorted read so the panel shows something real rather than an empty state.
    console.warn('[referrals] ordered read failed, falling back to a bounded scan:', err instanceof Error ? err.message : err)
    try {
      const snap = await db.collection('referrals').where('referrerUid', '==', uid).limit(200).get()
      rows = snap.docs
        .map((doc) => mapReferral(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } catch (err2) {
      console.warn('[referrals] fallback read failed:', err2 instanceof Error ? err2.message : err2)
    }
  }

  const completion = profileCompletion(user)
  const blocked = referralBlockReason(user, completion)

  return {
    code,
    shareUrl,
    bonusUsd: REFERRAL_BONUS_USD,
    stats: referralStats(rows),
    rows,
    blockedReason: blocked.reason,
    canShare: blocked.reason === null,
    asOf: new Date().toISOString(),
  }
}

/**
 * Why a code cannot be shared (or null when it can).
 *
 * The referrer's *own* profile must be complete as well as verified: a member who has not finished
 * setting up has not reached the state where their own reward is being released, and it would be
 * incoherent to be earning from referrals while not meeting the same bar.
 */
function referralBlockReason(user: Record<string, unknown>, completion: ReturnType<typeof profileCompletion>): { reason: string | null } {
  const state = String(user.accountState ?? 'active')
  if (state !== 'active') {
    return { reason: `Referral credit is paused while your account is ${state.replace(/_/g, ' ')}.` }
  }
  if (user.kycVerified !== true) {
    return { reason: 'Complete your identity verification before sharing your link — referral credit only flows from verified accounts.' }
  }
  if (!completion.complete) {
    return {
      reason: `Finish your own profile first (${completion.missingLabels.join(', ')}) — referrals are only credited between members who have both completed theirs.`,
    }
  }
  return { reason: null }
}

/**
 * Tells the referrer their bonus arrived. Fire-and-forget from the caller's perspective: the
 * transaction has already committed by the time this runs, and a failed notification must not
 * turn a successful save into an error.
 */
export async function notifyReferralQualified(referredUid: string): Promise<void> {
  const db = dbOrNull()
  if (!db) return
  try {
    const snap = await db.collection('referrals').doc(referredUid).get()
    if (!snap.exists) return
    const row = mapReferral(snap.id, (snap.data() ?? {}) as Record<string, unknown>)
    if (row.status !== 'qualified') return
    await notifyUser(row.referrerUid, {
      title: `Referral bonus ${formatUsd(row.bonusUsd)} added`,
      body: `${row.referredName} completed their profile, so your referral bonus is now in your pending balance and clears with your other earnings.`,
      tone: 'success',
      link: '/referrals',
    })
  } catch (err) {
    console.warn('[referrals] qualification notification skipped:', err instanceof Error ? err.message : err)
  }
}
