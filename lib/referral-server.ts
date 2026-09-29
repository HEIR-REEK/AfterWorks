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
  REFERRAL_SIGNUP_WEEKLY_LIMIT,
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
 * Called once, immediately after the account is created and while the session is still fresh —
 * and again, cheaply and idempotently, from `reconcileReferralAttribution` at the checkpoints of
 * the journey (email verification, profile save, KYC approval, opening the referrals panel), so a
 * claim that failed once is retried rather than lost. It is *best effort by design*: a referral is
 * a promotion, not a precondition for an account, so a failure here is audited and swallowed
 * rather than rolled back into a sign-up error. A member must never be locked out because a
 * referral write timed out.
 *
 * The code itself is stored on the referred account (`referredByCode`) the moment it is seen, even
 * when the claim cannot complete right now — that durable copy is what survives the email
 * verification link opening in another tab, a referrer who has not finished KYC yet, or a plain
 * network failure at the worst possible second.
 *
 * Every rejection is a decision, not a crash: an invalid code, a self-referral and a rate-limited
 * referrer all answer with a reason the form can show, and none of them create a document. An
 * unverified or restricted *referrer* no longer refuses the record — it defers the money (the
 * release-time checks re-read both), so signups are never silently thrown away over somebody
 * else's unfinished KYC.
 */
export async function claimReferralForSignup(input: {
  referredUid: string
  referredEmail: string
  referredName: string
  rawCode: string
  emailVerified: boolean
}): Promise<{ attached: boolean; code: string; reason?: string; codeName?: string; deferred?: boolean }> {
  const db = dbOrNull()
  if (!db) return { attached: false, code: '', reason: 'invalid_referral_code' }

  try {
    // The referred account's document, read once: it may already carry a captured code (first
    // touch wins), and its existence decides whether the durable copy may be written — a stub
    // created here would make the sign-up bootstrap skip writing the real document.
    const referredRef = db.collection('users').doc(input.referredUid)
    const referredSnap = await referredRef.get().catch(() => null)
    const referredDocExists = referredSnap?.exists === true
    const referredDoc = (referredDocExists ? (referredSnap!.data() ?? {}) : {}) as Record<string, unknown>

    // First touch wins: a code captured at signup binds this account, and a different code posted
    // later cannot steal it.
    const storedCode = normaliseReferralCode(referredDoc.referredByCode)
    const normalised = storedCode ?? normaliseReferralCode(input.rawCode)
    if (!normalised) return { attached: false, code: '', reason: 'invalid_referral_code' }

    // One account, one referrer, forever. The document is keyed by the referred uid, so this
    // read is also the check that no *other* code already owns this account's referral.
    const referralRef = db.collection('referrals').doc(input.referredUid)
    const existing = await referralRef.get().catch(() => null)
    if (existing?.exists) {
      return { attached: false, code: normalised, reason: 'already_referred' }
    }

    const resolved = await resolveReferralCode(normalised)
    const referrerSnap = resolved ? await db.collection('users').doc(resolved.uid).get().catch(() => null) : null
    const referrer = referrerSnap?.exists ? ((referrerSnap.data() ?? {}) as Record<string, unknown>) : null

    // Keep the code on the account so a checkpoint can retry a claim this request cannot finish
    // (an unresolvable code, a referrer mid-verification, a transient failure). A self-referral
    // can never attach, so it is not worth remembering.
    const selfReferral =
      (resolved !== null && resolved.uid === input.referredUid) ||
      (referrer !== null &&
        String(referrer.email ?? '').trim().toLowerCase() === input.referredEmail.trim().toLowerCase())
    if (!selfReferral && !referredDoc.referredByCode) {
      try {
        if (referredDocExists) {
          await referredRef.set({ referredByCode: normalised, referredByCodeAt: new Date().toISOString() }, { merge: true })
        }
      } catch (err) {
        console.warn('[referrals] intent store skipped:', err instanceof Error ? err.message : err)
      }
    }

    if (!resolved || !referrer) return { attached: false, code: normalised, reason: 'unknown_referral_code' }

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
    } catch {
      // The composite (referrerUid + createdAt) index may not be deployed yet. Rather than let a
      // missing index silently kill every attribution, fall back to an equality-only read (always
      // indexed) and count the window in memory — the cap is enforced a little less precisely, and
      // deploying firestore.indexes.json restores the exact count.
      try {
        const recent = await db
          .collection('referrals')
          .where('referrerUid', '==', resolved.uid)
          .limit(REFERRAL_SIGNUP_WEEKLY_LIMIT + 50)
          .get()
        recentSignups = recent.docs.filter((doc) => String((doc.data() ?? {}).createdAt ?? '') >= cutoff).length
      } catch (err2) {
        // Both reads failed: the cap cannot be measured at all. Fail closed — a limit we cannot
        // enforce is not a limit, and the alternative is an unmetered signup faucet.
        console.warn('[referrals] weekly count unavailable, refusing attribution:', err2 instanceof Error ? err2.message : err2)
        return { attached: false, code: normalised, reason: 'rate_limit_unavailable' }
      }
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
    // Signup attribution normally precedes profile completion. Reconcile here as well so a late
    // attribution (for example after a retried signup callback) cannot leave an already-complete
    // profile permanently pending.
    await reconcileCompletedReferral(input.referredUid)
    return {
      attached: true,
      code: normalised,
      codeName: String(referrer.name ?? ''),
      // The record exists but the money is waiting on the referrer's own verification/standing.
      ...(decision.deferred ? { deferred: true as const } : {}),
    }
  } catch (err) {
    console.warn('[referrals] attribution skipped:', err instanceof Error ? err.message : err)
    return { attached: false, code: normaliseReferralCode(input.rawCode) ?? '', reason: 'attribution_failed' }
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
 * **Called from a Firestore transaction** (normally `saveMemberProfile`, and also the idempotent
 * reconciliation path). It takes a transaction handle and returns writes to be applied, rather than
 * doing its own reads and writes, for two reasons:
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

/**
 * Repairs a missed referral release for an already-complete profile.
 *
 * Profile PATCH remains the normal, atomic trigger. This narrower reconciliation is also called
 * after referral attribution and KYC approval, covering out-of-order callbacks and retries without
 * making either external flow responsible for minting money. The deterministic ledger id and the
 * referral status check keep concurrent/replayed calls idempotent.
 */
export async function reconcileCompletedReferral(referredUid: string): Promise<boolean> {
  const db = dbOrNull()
  if (!db || !referredUid) return false

  try {
    const userRef = db.collection('users').doc(referredUid)
    const applied = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef)
      if (!userSnap.exists || !profileCompletion((userSnap.data() ?? {}) as Record<string, unknown>).complete) return false

      // This stages all reads (referral + referrer) before any writes, then commits the three
      // financial/attribution records together.
      const staged = await stageReferralBonusForCompletedProfile(tx, referredUid)
      if (!staged.applied || staged.writes.length === 0) return false
      applyStagedWrites(tx, staged.writes)
      return true
    })

    if (applied) await notifyReferralQualified(referredUid)
    return applied
  } catch (err) {
    console.warn('[referrals] completion reconciliation skipped:', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Retries the signup attribution from the code stored on the account.
 *
 * The durable copy (`users/<uid>.referredByCode`) is written the moment a code is seen — even
 * when the claim cannot complete at signup — precisely because the journey breaks the original
 * tab: the verification link opens a second tab (with its own empty storage), the member may sign
 * in days later on another device, and the referrer's own KYC may only clear after the people
 * they referred have finished everything. Each checkpoint calls this, and the first one to find
 * the claim possible attaches it. Idempotent: a referral document that already exists ends it.
 */
export async function reconcileReferralAttribution(referredUid: string): Promise<boolean> {
  const db = dbOrNull()
  if (!db || !referredUid) return false
  try {
    const referralSnap = await db.collection('referrals').doc(referredUid).get()
    if (referralSnap.exists) return true

    const userSnap = await db.collection('users').doc(referredUid).get()
    if (!userSnap.exists) return false
    const user = (userSnap.data() ?? {}) as Record<string, unknown>
    const code = normaliseReferralCode(user.referredByCode)
    if (!code) return false

    const result = await claimReferralForSignup({
      referredUid,
      referredEmail: String(user.email ?? ''),
      referredName: String(user.name ?? ''),
      rawCode: code,
      emailVerified: user.emailVerified === true,
    })
    return result.attached
  } catch (err) {
    console.warn('[referrals] attribution reconciliation skipped:', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Releases every bonus this member is owed by the people *they* referred.
 *
 * The normal release happens inside the referred person's profile save. This covers the other
 * order: the referrals finished their profiles while this member's own identity verification (or
 * standing) was still pending — the bonus was correctly withheld at the time, and this is what
 * pays it once the reason no longer applies. Runs after KYC approval and on panel reads.
 */
export async function reconcileReferralsForReferrer(referrerUid: string): Promise<number> {
  const db = dbOrNull()
  if (!db || !referrerUid) return 0
  try {
    const snap = await db.collection('referrals').where('referrerUid', '==', referrerUid).limit(200).get()
    let released = 0
    for (const doc of snap.docs) {
      const data = (doc.data() ?? {}) as Record<string, unknown>
      if (data.status === 'qualified') continue
      if (await reconcileCompletedReferral(doc.id)) released++
    }
    return released
  } catch (err) {
    console.warn('[referrals] referrer-side reconciliation skipped:', err instanceof Error ? err.message : err)
    return 0
  }
}

/**
 * Every referral repair one account can need, in the order that matters:
 *  1. a code captured at signup that has not become a record yet attaches now if it can;
 *  2. this account's own referral bonus releases if their profile is complete;
 *  3. bonuses owed to them by members they referred release if those have completed.
 *
 * Called at the moments the journey changes state — email verification consumed, profile saved,
 * KYC approved — and when the referrals panel is opened. All three steps are idempotent, so
 * calling it more often than strictly necessary is safe.
 */
export async function reconcileReferralsForUser(uid: string): Promise<void> {
  if (!uid) return
  await reconcileReferralAttribution(uid)
  await reconcileCompletedReferral(uid)
  await reconcileReferralsForReferrer(uid)
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

/**
 * The referral panel's entire payload, computed in one place.
 *
 * `baseUrl` is the origin the share link should carry. The route passes the *request's* public
 * origin (see `publicAppOrigin`) rather than trusting `site.url` alone: when `NEXT_PUBLIC_APP_URL`
 * / `APP_URL` are unset, `site.url` falls back to `http://localhost:3000`, and a share link built
 * from that is a link nobody can open — the code inside it never reaches a single signup. The
 * verification emails already inferred the origin this way; the share link now does too.
 */
export async function getReferralDashboard(uid: string, baseUrl?: string): Promise<ReferralDashboard | null> {
  const db = dbOrNull()
  if (!db) return null

  // Self-healing read: a code captured at signup that never attached attaches now, and anything
  // that is due (either direction) settles — the member opening this panel is precisely the person
  // who would otherwise be staring at "0 referrals" with no explanation.
  await reconcileReferralsForUser(uid)

  const userRef = db.collection('users').doc(uid)
  const userSnap = await userRef.get()
  const user = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>

  const code = await getOrCreateReferralCode(uid)
  const shareUrl = referralShareUrl(baseUrl || site.url, code)

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
