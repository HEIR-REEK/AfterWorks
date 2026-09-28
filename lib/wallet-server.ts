/**
 * Wallet, profile-save and payout (withdrawal) server domain.
 *
 * Everything that moves money or decides whether money *may* move lives here, is called only from
 * route handlers, and re-derives its numbers from Firestore on every call. The browser contributes
 * two things to a withdrawal: how much and which saved destination — never a balance.
 *
 * Three problems this module exists to fix:
 *  1. **Clearing was copy, not code.** A completed job was credited to `pending` with a
 *     `clearedAt` timestamp 72h out, and nothing ever moved it. `getMemberWallet` settles every
 *     matured credit it sees (transactionally, idempotently) before it answers, so "available"
 *     means available even on a deployment with no scheduler.
 *  2. **There was no way to ask for money.** `submitPayoutRequest` holds the amount against the
 *     balance and queues it for a human to pay, which is how the ledger's `withdrawal` kind is
 *     supposed to come into existence.
 *  3. **Profile saves could vanish.** `/api/profile` writes the patch, re-scores completion and
 *     releases the welcome reward in the same transaction, so "I filled it in and got nothing" is
 *     no longer possible.
 */

import { FieldValue, type Query } from 'firebase-admin/firestore'
import { adminDb, dbOrNull, createAuditEntry, notifyUser } from '@/lib/firestore-admin'
import { getExchangeRateUsdToKes, formatUsd } from '@/lib/afterworks-data'
import { site } from '@/lib/site'
import { sanitizeLine } from '@/lib/security-core'
import {
  MEMBER_PROFILE_FIELDS,
  WELCOME_BONUS_USD,
  profileCompletion,
  sanitiseProfilePatch,
  type ProfileCompletion,
} from '@/lib/profile-completion'
import {
  describeDestination,
  isCancellablePayoutStatus,
  isOpenPayoutStatus,
  mapPayoutRequest,
  roundUsd,
  validatePayoutDestination,
  validateWithdrawalAmount,
  canTransitionPayout,
  requiresPayoutReference,
  PAYOUT_REASON_REQUIRED,
  type PayoutDestination,
  type PayoutDestinationState,
  type PayoutMethod,
  type PayoutQueueSummary,
  type PayoutRequestRow,
  type PayoutRequestStatus,
  type WalletEntry,
  type WalletSnapshot,
} from '@/lib/payouts'

export { WELCOME_BONUS_USD, MEMBER_PROFILE_FIELDS }

/** Thrown for conditions the member (or operator) can act on; routes map it onto a 4xx. */
export class WalletError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'wallet_error',
  ) {
    super(message)
    this.name = 'WalletError'
  }
}

const LEDGER_PAGE = 25
const PAYOUT_HISTORY_LIMIT = 12
const PAYOUT_BONUS_LEDGER = (uid: string) => `signup_bonus_${uid}`

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function toEntry(id: string, data: Record<string, unknown>): WalletEntry {
  return {
    id,
    kind: String(data.kind ?? 'earning'),
    amountUsd: roundUsd(Number(data.amountUsd ?? 0) || 0),
    status: String(data.status ?? 'pending'),
    createdAt: String(data.createdAt ?? ''),
    clearedAt: typeof data.clearedAt === 'string' ? data.clearedAt : null,
    description: String(data.description ?? ''),
    jobTitle: String(data.jobTitle ?? ''),
    applicationId: String(data.applicationId ?? ''),
    reference: String(data.reference ?? data.payoutReference ?? ''),
  }
}

/** Payout details currently on file, with the member-facing reason when they are incomplete. */
export function payoutDestinationState(data: Record<string, unknown>): PayoutDestinationState {
  const method: PayoutMethod = String(data.preferredPayoutMethod ?? 'M-Pesa') === 'Bank Transfer' ? 'Bank Transfer' : 'M-Pesa'
  const wallet = asRecord(data.wallet)
  const accountName = String(data.name ?? '').trim()
  const phone = String(data.phone ?? wallet.payoutNumber ?? '').trim()
  const bankName = String(data.bankName ?? '').trim()
  const bankBranch = String(data.bankBranch ?? '').trim()
  const bankAccountNumber = String(data.bankAccountNumber ?? '').trim()

  const check = validatePayoutDestination({
    method,
    accountName,
    phone,
    accountNumber: phone,
    bankName,
    bankBranch,
    bankAccountNumber,
  })

  if (check.ok) {
    return { ready: true, method, label: describeDestination(check.destination), accountName, problem: null }
  }

  const label =
    method === 'Bank Transfer'
      ? `Bank transfer · ${bankName || 'bank not set'}`
      : phone
        ? `M-Pesa · ${phone}`
        : 'No payout details saved'
  return { ready: false, method, label, accountName, problem: check.error }
}

// ─── Wallet snapshot ─────────────────────────────────────────────────────────

/**
 * Settles every matured `pending` credit for one member, then answers with the true numbers.
 *
 * The write is idempotent by construction: it only touches ledger rows that are still `pending`,
 * caps the amount moved at whatever the wallet still shows as pending (so a replay cannot mint
 * money), and marks those rows `cleared` in the same transaction.
 */
async function settleMaturedCredits(uid: string, entries: WalletEntry[]): Promise<{ creditedUsd: number; settledIds: string[] }> {
  const db = dbOrNull()
  if (!db) return { creditedUsd: 0, settledIds: [] }
  const now = Date.now()
  const matured = entries.filter((entry) => entry.status === 'pending' && entry.clearedAt && Date.parse(entry.clearedAt) <= now)
  const gross = roundUsd(matured.reduce((sum, entry) => sum + entry.amountUsd, 0))
  if (gross <= 0) return { creditedUsd: 0, settledIds: [] }

  const userRef = db.collection('users').doc(uid)
  let creditedUsd = 0
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef)
      if (!snap.exists) return
      const data = (snap.data() ?? {}) as Record<string, unknown>
      const wallet = asRecord(data.wallet)
      const pending = Number(wallet.pendingUsd ?? 0) || 0
      const apply = roundUsd(Math.min(pending, gross))
      if (apply <= 0) return
      creditedUsd = apply
      tx.set(
        userRef,
        {
          'wallet.pendingUsd': roundUsd(pending - apply),
          'wallet.availableUsd': roundUsd((Number(wallet.availableUsd ?? 0) || 0) + apply),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      for (const entry of matured) {
        tx.set(db.collection('wallet_ledger').doc(entry.id), { status: 'cleared', settledAt: new Date().toISOString() }, { merge: true })
      }
    })
  } catch (err) {
    console.warn('[wallet] clearing settlement skipped:', err instanceof Error ? err.message : err)
    return { creditedUsd: 0, settledIds: [] }
  }
  return { creditedUsd, settledIds: matured.map((entry) => entry.id) }
}

async function readWalletEntries(uid: string): Promise<WalletEntry[]> {
  const db = dbOrNull()
  if (!db) return []
  const col = db.collection('wallet_ledger')
  try {
    const snap = await col.where('uid', '==', uid).orderBy('createdAt', 'desc').limit(LEDGER_PAGE).get()
    return snap.docs.map((doc) => toEntry(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
  } catch (err) {
    // Composite index not deployed yet (or a cold project): read a bounded page and sort here.
    console.warn('[wallet] ordered ledger read failed, falling back to a bounded scan:', err instanceof Error ? err.message : err)
    try {
      const snap = await col.where('uid', '==', uid).limit(LEDGER_PAGE * 2).get()
      return snap.docs
        .map((doc) => toEntry(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, LEDGER_PAGE)
    } catch {
      return []
    }
  }
}

async function readPayoutRequestsForUser(uid: string): Promise<PayoutRequestRow[]> {
  const db = dbOrNull()
  if (!db) return []
  const col = db.collection('payout_requests')
  try {
    const snap = await col.where('uid', '==', uid).orderBy('createdAt', 'desc').limit(PAYOUT_HISTORY_LIMIT).get()
    return snap.docs.map((doc) => mapPayoutRequest(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
  } catch (err) {
    console.warn('[wallet] payout history read fell back:', err instanceof Error ? err.message : err)
    try {
      const snap = await col.where('uid', '==', uid).limit(PAYOUT_HISTORY_LIMIT * 2).get()
      return snap.docs
        .map((doc) => mapPayoutRequest(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
        .slice(0, PAYOUT_HISTORY_LIMIT)
    } catch {
      return []
    }
  }
}

/**
 * The member's money, as the ledger sees it. One call answers: what is pending, what cleared, what
 * is held by a payout request, what can be withdrawn, where it would be sent, and the state of the
 * welcome reward.
 */
export async function getMemberWallet(uid: string): Promise<WalletSnapshot | null> {
  const db = dbOrNull()
  if (!db) return null

  const userRef = db.collection('users').doc(uid)
  const userSnap = await userRef.get()
  // A Firebase credential without a profile document (created by hand in the console, or a sign-up
  // that was interrupted before the profile write) is answered with zeros rather than a 500 — the
  // onboarding prompt then sends the member to the profile, where the first save creates it.
  const data = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>
  const wallet = asRecord(data.wallet)

  // 1. Move anything whose clearing window has passed before reading balances.
  let entries = await readWalletEntries(uid)
  const settlement = await settleMaturedCredits(uid, entries)
  if (settlement.creditedUsd > 0) {
    const settled = new Set(settlement.settledIds)
    entries = entries.map((entry) => (settled.has(entry.id) ? { ...entry, status: 'cleared' } : entry))
  }

  const pendingUsd = roundUsd(Math.max(0, (Number(wallet.pendingUsd ?? 0) || 0) - settlement.creditedUsd))
  const availableUsd = roundUsd((Number(wallet.availableUsd ?? 0) || 0) + settlement.creditedUsd)

  // 2. Reads a second pass would be cheaper as a batch, but the SETTLEMENT above may have changed
  //    the document; the payout hold is the only value that can still be stale, and it is written
  //    only by payout routes (which re-read inside their own transaction).
  let payoutRequests = await readPayoutRequestsForUser(uid)
  const openRows = payoutRequests.filter((row) => isOpenPayoutStatus(row.status))
  const openPayout = openRows[0] ?? null
  let heldUsd = roundUsd(openRows.reduce((sum, row) => sum + row.amountUsd, 0))
  const storedHold = Number(wallet.payoutHoldUsd ?? 0) || 0

  // Self-heal a drift between the stored hold and the rows that actually hold money: if the stored
  // value is larger than the open requests justify, the member's money would silently disappear
  // from the withdrawable figure. Fix it from the rows (the truth) and log it.
  if (heldUsd !== roundUsd(storedHold) && openRows.length > 0) {
    try {
      await userRef.set({ 'wallet.payoutHoldUsd': heldUsd, updatedAt: new Date().toISOString() }, { merge: true })
    } catch {
      /* best effort — the response below still reports the row-derived value */
    }
  }
  heldUsd = roundUsd(Math.min(heldUsd, availableUsd))

  const rate = getExchangeRateUsdToKes()
  const withdrawableUsd = roundUsd(Math.max(0, availableUsd - heldUsd))
  const bonusLedger = await db.collection('wallet_ledger').doc(PAYOUT_BONUS_LEDGER(uid)).get().catch(() => null)
  const granted = data.signupBonusGranted === true || Boolean(bonusLedger?.exists)

  const entriesWithWithdrawals = entries
  const nextClearingAt =
    entriesWithWithdrawals
      .filter((entry) => entry.status === 'pending' && entry.clearedAt)
      .map((entry) => entry.clearedAt as string)
      .sort()[0] ?? null

  return {
    pendingUsd,
    availableUsd,
    heldUsd,
    withdrawableUsd,
    payoutNumber: String(wallet.payoutNumber ?? data.phone ?? ''),
    preferredPayoutMethod: String(data.preferredPayoutMethod ?? 'M-Pesa') === 'Bank Transfer' ? 'Bank Transfer' : 'M-Pesa',
    clearingHours: site.clearingWindowHours,
    minWithdrawalUsd: site.minWithdrawalUsd,
    nextClearingAt,
    usdToKes: rate,
    availableKes: Math.round(availableUsd * rate),
    withdrawableKes: Math.round(withdrawableUsd * rate),
    pendingKes: Math.round(pendingUsd * rate),
    entries: entriesWithWithdrawals,
    paidTrainings: Array.isArray(data.paidTrainings) ? (data.paidTrainings as string[]).filter((v) => typeof v === 'string') : [],
    qualityScore: Number(data.qualityScore ?? 100) || 100,
    jobsCompleted: Number(data.jobsCompleted ?? 0) || 0,
    accountState: String(data.accountState ?? 'active'),
    kycVerified: data.kycVerified === true,
    destination: payoutDestinationState(data),
    openPayout,
    payoutRequests,
    welcomeBonus: {
      amountUsd: WELCOME_BONUS_USD,
      granted,
      grantedAt: granted && typeof data.signupBonusGrantedAt === 'string' ? data.signupBonusGrantedAt : null,
      pendingFromStaff: data.welcomeBonusPending === true && !granted,
    },
    asOf: new Date().toISOString(),
  }
}

// ─── Profile save (+ the welcome reward it can release) ──────────────────────

/** The inert profile document shared by public sign-up, console onboarding and first profile save. */
function blankProfileDocument(uid: string, patch: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    uid,
    name: typeof patch.name === 'string' ? patch.name : '',
    email: typeof patch.email === 'string' ? patch.email : '',
    location: '',
    country: 'Kenya',
    memberSince: new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' }),
    qualityScore: 100,
    jobsCompleted: 0,
    kycVerified: false,
    accountState: 'active',
    role: 'user',
    isAdmin: false,
    bio: '',
    skills: [],
    languages: [],
    preferredPayoutMethod: 'M-Pesa',
    paidTrainings: [],
    wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '', payoutHoldUsd: 0 },
    signupBonusGranted: false,
    createdAt: now,
  }
}

export type SaveProfileResult = {
  ok: true
  saved: string[]
  dropped: string[]
  completion: ProfileCompletion
  /** Present only when this save released the reward. */
  grantedBonus: { amountUsd: number } | null
  wallet: { pendingUsd: number; availableUsd: number }
  /** True when the member had already been paid the reward before this save. */
  bonusAlreadyGranted: boolean
}

/**
 * Saves the member's profile fields and, if the save takes the profile to 100%, credits the
 * welcome reward in the same transaction — so the congratulations popup can fire immediately and
 * truthfully (the client is told the money was already written, not asked to claim it).
 *
 * Idempotent: the reward is keyed by `signup_bonus_<uid>` in `wallet_ledger`, so a double-submit,
 * a retry, or the old claim endpoint cannot pay twice.
 */
export async function saveMemberProfile(
  uid: string,
  input: Record<string, unknown>,
  { actorEmail }: { actorEmail?: string } = {},
): Promise<SaveProfileResult> {
  const db = adminDb()
  const { patch, dropped } = sanitiseProfilePatch(input, { method: input.preferredPayoutMethod })
  if (Object.keys(patch).length === 0) {
    const existing = await db.collection('users').doc(uid).get()
    const completion = profileCompletion((existing.data() ?? {}) as Record<string, unknown>)
    throw new WalletError(
      dropped.length ? 'Those fields cannot be changed from the app.' : 'Nothing to save yet — fill in at least one field.',
      400,
      completion.complete ? 'nothing_to_save' : 'empty_patch',
    )
  }

  const userRef = db.collection('users').doc(uid)
  const ledgerRef = db.collection('wallet_ledger').doc(PAYOUT_BONUS_LEDGER(uid))

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, ledgerSnap] = await Promise.all([tx.get(userRef), tx.get(ledgerRef)])
    const current = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>
    const wallet = asRecord(current.wallet)
    const merged: Record<string, unknown> = { ...current, ...patch }
    const completion = profileCompletion(merged)

    const now = new Date().toISOString()
    const updates: Record<string, unknown> = { ...patch, updatedAt: now }
    if (actorEmail) updates.lastModifiedBy = actorEmail
    // The payout handle follows the phone number the member typed, so a first payout does not ask
    // for the same detail twice.
    if (typeof patch.phone === 'string' && patch.phone.trim()) updates['wallet.payoutNumber'] = patch.phone.trim()

    const alreadyGranted = current.signupBonusGranted === true || ledgerSnap.exists
    let grantedBonus: { amountUsd: number } | null = null
    let availableUsd = Number(wallet.availableUsd ?? 0) || 0

    if (completion.complete && !alreadyGranted) {
      grantedBonus = { amountUsd: WELCOME_BONUS_USD }
      availableUsd = roundUsd(availableUsd + WELCOME_BONUS_USD)
      updates['wallet.availableUsd'] = availableUsd
      updates.signupBonusGranted = true
      updates.signupBonusGrantedAt = now
      updates.welcomeBonusPending = false
      tx.set(ledgerRef, {
        id: PAYOUT_BONUS_LEDGER(uid),
        uid,
        kind: 'signup_bonus',
        status: 'cleared',
        amountUsd: WELCOME_BONUS_USD,
        currency: 'USD',
        description: 'Completed your profile',
        createdAt: now,
        clearedAt: now,
        createdBy: 'system:profile-completion',
      })
    }

    // First save against a credential that had no document: write the same inert shape public
    // sign-up writes, then the patch on top.
    if (!userSnap.exists) Object.assign(updates, blankProfileDocument(uid, patch))
    tx.set(userRef, updates, { merge: true })
    return {
      completion,
      grantedBonus,
      alreadyGranted,
      wallet: {
        pendingUsd: roundUsd(Number(wallet.pendingUsd ?? 0) || 0),
        availableUsd: roundUsd(availableUsd),
      },
    }
  })

  await createAuditEntry(
    result.grantedBonus ? 'PROFILE_COMPLETED_REWARD_GRANTED' : 'PROFILE_UPDATED',
    { uid, fields: Object.keys(patch), dropped, completion: result.completion.percent, rewardUsd: result.grantedBonus?.amountUsd },
    actorEmail || `member:${uid}`,
  )

  return {
    ok: true,
    saved: Object.keys(patch),
    dropped,
    completion: result.completion,
    grantedBonus: result.grantedBonus,
    wallet: result.wallet,
    bonusAlreadyGranted: result.alreadyGranted,
  }
}

// ─── Welcome reward ──────────────────────────────────────────────────────────

export type GrantBonusResult = {
  granted: boolean
  amountUsd: number
  completion: ProfileCompletion
  /** Why the reward was not paid — phrased for whoever asked. */
  reason: string | null
}

/**
 * Pays the welcome reward exactly once.
 *
 * `actor` describes who asked, and it decides the rule:
 *  • `member`  — requires a 100% profile (the member cannot self-grant);
 *  • `operator` — allows an operator to pay a member they onboarded even when a field is missing
 *    (the operator knows why), but never a second time.
 */
export async function grantWelcomeBonus(input: {
  uid: string
  actor: string
  actorKind: 'member' | 'operator'
  amountUsd?: number
  reason?: string
}): Promise<GrantBonusResult> {
  const db = adminDb()
  const amount = roundUsd(input.amountUsd ?? WELCOME_BONUS_USD)
  if (!(amount > 0) || amount > 500) throw new WalletError('That reward amount is not allowed.', 400, 'invalid_amount')

  const userRef = db.collection('users').doc(input.uid)
  const ledgerRef = db.collection('wallet_ledger').doc(PAYOUT_BONUS_LEDGER(input.uid))

  const outcome = await db.runTransaction(async (tx) => {
    const [userSnap, ledgerSnap] = await Promise.all([tx.get(userRef), tx.get(ledgerRef)])
    if (!userSnap.exists) throw new WalletError('No such member.', 404, 'member_missing')
    const data = (userSnap.data() ?? {}) as Record<string, unknown>
    const completion = profileCompletion(data)

    if (data.signupBonusGranted === true || ledgerSnap.exists) {
      return { granted: false, completion, reason: 'The welcome reward has already been paid to this account.' }
    }
    if (input.actorKind === 'member' && !completion.complete) {
      return {
        granted: false,
        completion,
        reason: `Finish your profile to claim the reward — still missing: ${completion.missingLabels.join(', ')}.`,
      }
    }

    const wallet = asRecord(data.wallet)
    const now = new Date().toISOString()
    tx.set(
      userRef,
      {
        'wallet.availableUsd': roundUsd((Number(wallet.availableUsd ?? 0) || 0) + amount),
        signupBonusGranted: true,
        signupBonusGrantedAt: now,
        welcomeBonusPending: false,
        updatedAt: now,
      },
      { merge: true },
    )
    tx.set(ledgerRef, {
      id: PAYOUT_BONUS_LEDGER(input.uid),
      uid: input.uid,
      kind: 'signup_bonus',
      status: 'cleared',
      amountUsd: amount,
      currency: 'USD',
      description: input.actorKind === 'operator' ? 'Welcome reward (added by support)' : 'Completed your profile',
      createdAt: now,
      clearedAt: now,
      createdBy: input.actor,
      reason: input.reason ? sanitizeLine(input.reason, 200) : undefined,
    })
    return { granted: true, completion, reason: null as string | null }
  })

  if (outcome.granted) {
    await createAuditEntry(
      'WELCOME_BONUS_GRANTED',
      { uid: input.uid, amountUsd: amount, by: input.actorKind, reason: input.reason?.slice(0, 200) },
      input.actor,
    )
    if (input.actorKind === 'operator') {
      await notifyUser(input.uid, {
        title: `Welcome reward added — ${formatUsd(amount)}`,
        body: 'Our team added your welcome reward to your available balance. Complete your profile if you have not already.',
        tone: 'success',
        link: '/wallet',
      })
    }
  }

  return { granted: outcome.granted, amountUsd: amount, completion: outcome.completion, reason: outcome.reason }
}

// ─── Payout requests (member side) ───────────────────────────────────────────

export type SubmitPayoutResult = {
  request: PayoutRequestRow
  wallet: { pendingUsd: number; availableUsd: number; heldUsd: number; withdrawableUsd: number }
}

/**
 * Places a hold on part of the member's available balance and queues a payout for review.
 *
 * The open-request guard document (`payout_open/{uid}`) is written in the same transaction as the
 * request, so two parallel taps — or a retry over a flaky connection — cannot open two payouts
 * against the same balance: the second transaction finds the guard row and refuses.
 */
export async function submitPayoutRequest(input: { uid: string; amountUsd: number; actorEmail: string }): Promise<SubmitPayoutResult> {
  const db = adminDb()
  const uid = input.uid

  // Settle anything matured first, so a member withdrawing the moment their clearing window ends is
  // not told "nothing is withdrawable yet".
  await getMemberWallet(uid).catch(() => null)

  const userRef = db.collection('users').doc(uid)
  const guardRef = db.collection('payout_open').doc(uid)
  const requestRef = db.collection('payout_requests').doc()

  const outcome = await db.runTransaction(async (tx) => {
    const [userSnap, guardSnap] = await Promise.all([tx.get(userRef), tx.get(guardRef)])
    if (!userSnap.exists) throw new WalletError('Your profile record could not be found. Contact support.', 404, 'profile_missing')
    const data = (userSnap.data() ?? {}) as Record<string, unknown>
    const wallet = asRecord(data.wallet)

    if (guardSnap.exists) {
      throw new WalletError(
        'You already have a payout request in progress. Cancel it or wait for it to be paid before requesting another.',
        409,
        'payout_already_open',
      )
    }
    if (data.kycVerified !== true) {
      throw new WalletError('Verify your identity (KYC) before withdrawing. It takes a few minutes from your profile page.', 403, 'kyc_required')
    }
    const accountState = String(data.accountState ?? 'active')
    if (accountState !== 'active') {
      throw new WalletError(
        `Withdrawals are paused on this account (${accountState.replace(/_/g, ' ')}). Contact support if this is unexpected.`,
        403,
        'account_restricted',
      )
    }

    const destinationCheck = validatePayoutDestination({
      method: data.preferredPayoutMethod,
      accountName: data.name,
      phone: data.phone ?? wallet.payoutNumber,
      accountNumber: data.phone ?? wallet.payoutNumber,
      bankName: data.bankName,
      bankBranch: data.bankBranch,
      bankAccountNumber: data.bankAccountNumber,
    })
    if (!destinationCheck.ok) {
      throw new WalletError(`${destinationCheck.error} Add your payout details on the profile page.`, 400, 'destination_incomplete')
    }

    const availableUsd = roundUsd(Number(wallet.availableUsd ?? 0) || 0)
    const heldUsd = roundUsd(Number(wallet.payoutHoldUsd ?? 0) || 0)
    const withdrawableUsd = roundUsd(Math.max(0, availableUsd - heldUsd))
    const amountCheck = validateWithdrawalAmount(Number(input.amountUsd), withdrawableUsd, site.minWithdrawalUsd)
    if (!amountCheck.ok) throw new WalletError(amountCheck.error, 400, 'invalid_amount')

    const amountUsd = amountCheck.amountUsd
    const rate = getExchangeRateUsdToKes()
    const now = new Date().toISOString()
    const payoutBy = new Date(Date.now() + 24 * 3600_000).toISOString()
    const row = {
      id: requestRef.id,
      uid,
      email: String(data.email ?? input.actorEmail ?? ''),
      name: String(data.name ?? ''),
      amountUsd,
      amountKes: Math.round(amountUsd * rate),
      usdToKes: rate,
      status: 'pending' as PayoutRequestStatus,
      method: destinationCheck.destination.method,
      accountName: destinationCheck.destination.accountName,
      accountNumber: destinationCheck.destination.accountNumber,
      bankName: destinationCheck.destination.bankName,
      bankBranch: destinationCheck.destination.bankBranch,
      bankAccountNumber: destinationCheck.destination.bankAccountNumber,
      destinationLabel: describeDestination(destinationCheck.destination),
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
      payoutBy,
      history: [{ status: 'pending', at: now, by: `member:${uid}` }],
      source: 'member-app',
    }

    tx.set(
      userRef,
      {
        'wallet.availableUsd': roundUsd(availableUsd - amountUsd),
        'wallet.payoutHoldUsd': roundUsd(heldUsd + amountUsd),
        updatedAt: now,
      },
      { merge: true },
    )
    tx.set(requestRef, row)
    tx.set(guardRef, { uid, requestId: requestRef.id, amountUsd, createdAt: now })
    return {
      row,
      // `pendingUsd` is untouched by a withdrawal (the hold comes out of *available*), but it is
      // returned too so a caller that renders the response cannot show the clearing balance as zero.
      wallet: {
        pendingUsd: roundUsd(Number(wallet.pendingUsd ?? 0) || 0),
        availableUsd: roundUsd(availableUsd - amountUsd),
        heldUsd: roundUsd(heldUsd + amountUsd),
      },
    }
  })

  await createAuditEntry(
    'PAYOUT_REQUESTED',
    {
      uid,
      requestId: outcome.row.id,
      amountUsd: outcome.row.amountUsd,
      amountKes: outcome.row.amountKes,
      method: outcome.row.method,
      destination: outcome.row.destinationLabel,
    },
    input.actorEmail,
  )

  await notifyUser(uid, {
    title: `Withdrawal requested — ${formatUsd(outcome.row.amountUsd)}`,
    body: `${site.payoutSla} You will see it move to "Paid" once the transfer is sent.`,
    tone: 'info',
    link: '/wallet',
  })

  return {
    request: mapPayoutRequest(outcome.row.id, outcome.row as unknown as Record<string, unknown>),
    wallet: {
      pendingUsd: outcome.wallet.pendingUsd,
      availableUsd: outcome.wallet.availableUsd,
      heldUsd: outcome.wallet.heldUsd,
      withdrawableUsd: roundUsd(Math.max(0, outcome.wallet.availableUsd - outcome.wallet.heldUsd)),
    },
  }
}

/** Cancels a request the member no longer wants, releasing the hold back to their balance. */
export async function cancelPayoutRequest(input: { uid: string; requestId: string }): Promise<{ request: PayoutRequestRow; releasedUsd: number }> {
  return settlePayoutRequest({
    requestId: input.requestId,
    to: 'cancelled',
    actorEmail: `member:${input.uid}`,
    reason: 'Cancelled by the member',
    expectUid: input.uid,
  })
}

// ─── Payout requests (queue, admin side) ─────────────────────────────────────

export type PayoutListResult = {
  rows: PayoutRequestRow[]
  nextCursor: string | null
  hasMore: boolean
  pageSize: number
  summary: PayoutQueueSummary
  degraded?: string
}

function matchesSearch(row: PayoutRequestRow, search: string): boolean {
  if (!search) return true
  return (
    row.email.toLowerCase().includes(search) ||
    row.name.toLowerCase().includes(search) ||
    row.uid.toLowerCase().includes(search) ||
    row.requestedAt.toLowerCase().includes(search) ||
    row.destination.accountNumber.toLowerCase().includes(search) ||
    row.payoutReference.toLowerCase().includes(search)
  )
}

/** Backs the console queue and the member's own history (via `uid`). */
export async function listPayoutRequests(opts: {
  uid?: string
  status?: string
  search?: string
  pageSize?: number
  cursor?: string | null
  withSummary?: boolean
}): Promise<PayoutListResult> {
  const db = dbOrNull()
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25))
  if (!db) {
    return { rows: [], nextCursor: null, hasMore: false, pageSize, summary: emptySummary(), degraded: 'Admin SDK unavailable' }
  }
  const search = (opts.search ?? '').trim().toLowerCase()
  const col = db.collection('payout_requests')

  let rows: PayoutRequestRow[] = []
  let degraded: string | undefined
  try {
    let query = col.orderBy('createdAt', 'desc') as ReturnType<typeof col.orderBy>
    if (opts.uid) query = query.where('uid', '==', opts.uid) as typeof query
    if (opts.status && opts.status !== 'all') query = query.where('status', '==', opts.status) as typeof query
    if (opts.cursor) query = query.startAfter(opts.cursor) as typeof query
    const snap = await query.limit(pageSize + 1).get()
    rows = snap.docs.map((doc) => mapPayoutRequest(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
  } catch (err) {
    degraded = 'Ordered payout read failed (composite index missing?), so this page is a bounded scan.'
    console.warn('[payouts] ordered read failed:', err instanceof Error ? err.message : err)
    let query = col.limit(pageSize * 2) as ReturnType<typeof col.limit>
    if (opts.uid) query = query.where('uid', '==', opts.uid) as unknown as ReturnType<typeof col.limit>
    try {
      const snap = await query.get()
      rows = snap.docs
        .map((doc) => mapPayoutRequest(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    } catch (err2) {
      console.error('[payouts] fallback read failed:', err2)
      rows = []
    }
  }

  const hasMore = rows.length > pageSize
  if (hasMore) rows = rows.slice(0, pageSize)
  if (search) rows = rows.filter((row) => matchesSearch(row, search))

  return {
    rows,
    nextCursor: hasMore && rows.length ? rows[rows.length - 1]!.requestedAt : null,
    hasMore,
    pageSize,
    summary: opts.withSummary === false ? emptySummary() : await getPayoutQueueSummary(),
    ...(degraded ? { degraded } : {}),
  }
}

function emptySummary(): PayoutQueueSummary {
  return { pending: 0, approved: 0, processing: 0, paid: 0, rejected: 0, failed: 0, cancelled: 0, heldUsd: 0, paidUsd: 0, oldestPendingAt: null }
}

async function countOrFallback(build: () => Query, fallbackLimit = 400): Promise<number> {
  try {
    // Aggregation count: one query, not N document reads.
    const snap = await build().count().get()
    return snap.data().count
  } catch {
    try {
      const snap = await build().limit(fallbackLimit).get()
      return snap.size
    } catch {
      return 0
    }
  }
}

/** Queue health for the console header: how much is waiting, and how much is being held. */
export async function getPayoutQueueSummary(): Promise<PayoutQueueSummary> {
  const db = dbOrNull()
  if (!db) return emptySummary()
  const col = db.collection('payout_requests')
  const statuses: PayoutRequestStatus[] = ['pending', 'approved', 'processing', 'paid', 'rejected', 'failed', 'cancelled']

  const counts = await Promise.all(statuses.map((status) => countOrFallback(() => col.where('status', '==', status))))
  const summary = emptySummary()
  statuses.forEach((status, index) => {
    summary[status] = counts[index] ?? 0
  })

  try {
    const openSnap = await col.where('status', 'in', ['pending', 'approved', 'processing']).select('amountUsd', 'createdAt').limit(400).get()
    openSnap.forEach((doc) => {
      const data = (doc.data() ?? {}) as Record<string, unknown>
      summary.heldUsd = roundUsd(summary.heldUsd + (Number(data.amountUsd ?? 0) || 0))
      const at = String(data.createdAt ?? '')
      if (at && (!summary.oldestPendingAt || at < summary.oldestPendingAt)) summary.oldestPendingAt = at
    })
  } catch {
    /* counts still stand */
  }

  try {
    const paidSnap = await col.where('status', '==', 'paid').select('amountUsd').limit(400).get()
    paidSnap.forEach((doc) => {
      const data = (doc.data() ?? {}) as Record<string, unknown>
      summary.paidUsd = roundUsd(summary.paidUsd + (Number(data.amountUsd ?? 0) || 0))
    })
  } catch {
    /* counts still stand */
  }

  return summary
}

export type PayoutTransitionInput = {
  requestId: string
  to: PayoutRequestStatus
  actorEmail: string
  reason?: string
  payoutReference?: string
  /** When set, the caller must own the request (member-initiated cancellations). */
  expectUid?: string
}

/**
 * The single money-moving transition for a payout request, used by the console buttons and by the
 * member's own cancel.
 *
 * Guarantees:
 *  • the state machine in `lib/payouts.ts` is enforced (no "paid" after "rejected");
 *  • `paid` debits the held amount and writes the provider reference into the ledger;
 *  • `rejected` / `failed` / `cancelled` release the hold back to the member's available balance;
 *  • the open-request guard is removed exactly once, on the move out of the open states, so the
 *    member can request again immediately;
 *  • every move is audited with the actor and (for money leaving) the reference.
 */
export async function settlePayoutRequest(input: PayoutTransitionInput): Promise<{ request: PayoutRequestRow; releasedUsd: number; debitedUsd: number }> {
  const db = adminDb()
  const requestRef = db.collection('payout_requests').doc(input.requestId)

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef)
    if (!snap.exists) throw new WalletError('That payout request no longer exists.', 404, 'payout_missing')
    const row = mapPayoutRequest(snap.id, (snap.data() ?? {}) as Record<string, unknown>)
    if (input.expectUid && row.uid !== input.expectUid) {
      throw new WalletError('That payout request belongs to another account.', 403, 'payout_not_yours')
    }
    if (row.status === input.to) return { row, releasedUsd: 0, debitedUsd: 0, noop: true }
    if (!canTransitionPayout(row.status, input.to)) {
      throw new WalletError(
        `A ${row.status.replace(/_/g, ' ')} request cannot be moved to ${input.to.replace(/_/g, ' ')}.`,
        409,
        'invalid_transition',
      )
    }
    if (input.expectUid && !isCancellablePayoutStatus(row.status)) {
      throw new WalletError('This payout is already being sent and can no longer be cancelled.', 409, 'payout_not_cancellable')
    }
    if ((PAYOUT_REASON_REQUIRED as readonly string[]).includes(input.to) && !(input.reason ?? '').trim()) {
      throw new WalletError('Add a short reason so the member knows what happened.', 400, 'reason_required')
    }
    if (requiresPayoutReference(input.to) && !(input.payoutReference ?? '').trim()) {
      throw new WalletError('Add the provider reference (M-Pesa code or bank reference) before marking it paid.', 400, 'reference_required')
    }

    const userRef = db.collection('users').doc(row.uid)
    const guardRef = db.collection('payout_open').doc(row.uid)
    const [userSnap, guardSnap] = await Promise.all([tx.get(userRef), tx.get(guardRef)])
    const data = (userSnap.data() ?? {}) as Record<string, unknown>
    const wallet = asRecord(data.wallet)
    const availableUsd = roundUsd(Number(wallet.availableUsd ?? 0) || 0)
    const heldUsd = roundUsd(Number(wallet.payoutHoldUsd ?? 0) || 0)

    const now = new Date().toISOString()
    const note = sanitizeLine(input.reason ?? '', 200)
    const reference = sanitizeLine(input.payoutReference ?? '', 60)
    const updates: Record<string, unknown> = {
      status: input.to,
      updatedAt: now,
      history: FieldValue.arrayUnion({ status: input.to, at: now, by: input.actorEmail, note: note || undefined }),
    }

    let releasedUsd = 0
    let debitedUsd = 0

    if (input.to === 'approved' || input.to === 'processing') {
      updates.reviewedBy = input.actorEmail
      updates.reviewedAt = now
    }

    if (input.to === 'paid') {
      debitedUsd = roundUsd(Math.min(row.amountUsd, heldUsd || row.amountUsd))
      updates.paidAt = now
      updates.payoutReference = reference
      updates.reviewedBy = input.actorEmail
      updates.reviewedAt = now
      tx.set(
        userRef,
        { 'wallet.payoutHoldUsd': roundUsd(Math.max(0, heldUsd - row.amountUsd)), updatedAt: now },
        { merge: true },
      )
      // The member's statement line. `pending` balances and cleared credits keep their own rows;
      // this is the money leaving, written once per request id.
      tx.set(db.collection('wallet_ledger').doc(`payout_${row.id}`), {
        id: `payout_${row.id}`,
        uid: row.uid,
        kind: 'withdrawal',
        status: 'cleared',
        amountUsd: row.amountUsd,
        amountKes: row.amountKes,
        currency: 'USD',
        payoutRequestId: row.id,
        method: row.method,
        destinationLabel: row.destinationLabel,
        reference,
        description: `Withdrawal to ${row.destinationLabel}`,
        createdAt: now,
        clearedAt: now,
        createdBy: input.actorEmail,
      })
    }

    if ((['rejected', 'failed', 'cancelled'] as string[]).includes(input.to)) {
      releasedUsd = roundUsd(Math.min(row.amountUsd, Math.max(0, heldUsd)))
      if (releasedUsd > 0) {
        tx.set(
          userRef,
          {
            'wallet.availableUsd': roundUsd(availableUsd + releasedUsd),
            'wallet.payoutHoldUsd': roundUsd(Math.max(0, heldUsd - releasedUsd)),
            updatedAt: now,
          },
          { merge: true },
        )
      }
      if (input.to === 'rejected') updates.reason = note
      if (input.to === 'failed') updates.failureReason = note
      if (input.to === 'cancelled') updates.cancelledAt = now
    }

    tx.set(requestRef, updates, { merge: true })

    // Release the "one open request" guard only when the request leaves the open states *and* the
    // guard still points at this request (an older request settling must not unlock a newer one).
    const openAfter = isOpenPayoutStatus(input.to)
    const guardRequestId = guardSnap.exists ? String(((guardSnap.data() ?? {}) as Record<string, unknown>).requestId ?? '') : ''
    if (!openAfter && guardSnap.exists && (!guardRequestId || guardRequestId === row.id)) {
      tx.delete(guardRef)
    }

    return {
      row: mapPayoutRequest(row.id, { ...(snap.data() ?? {}), ...updates, history: [...row.history, { status: input.to, at: now, by: input.actorEmail, note: note || undefined }] }),
      releasedUsd,
      debitedUsd,
      noop: false,
    }
  })

  if (outcome.noop) return { request: outcome.row, releasedUsd: 0, debitedUsd: 0 }

  await createAuditEntry(
    `PAYOUT_${input.to.toUpperCase()}`,
    {
      requestId: input.requestId,
      uid: outcome.row.uid,
      amountUsd: outcome.row.amountUsd,
      releasedUsd: outcome.releasedUsd,
      debitedUsd: outcome.debitedUsd,
      reference: input.payoutReference ? sanitizeLine(input.payoutReference, 60) : undefined,
      reason: input.reason?.slice(0, 200),
      by: input.actorEmail,
    },
    input.actorEmail,
  )

  // Tell the member, in their own words.
  const amount = formatUsd(outcome.row.amountUsd)
  const messages: Partial<Record<PayoutRequestStatus, { title: string; body: string; tone: 'success' | 'info' | 'warning' | 'danger' }>> = {
    approved: { title: `Withdrawal ${amount} approved`, body: 'It is queued for the next payout run. No action needed.', tone: 'success' },
    processing: { title: `Withdrawal ${amount} is on its way`, body: 'The transfer is with the provider. Mobile money usually lands within minutes.', tone: 'info' },
    paid: {
      title: `Withdrawal ${amount} paid`,
      body: `Sent to ${outcome.row.destinationLabel}${input.payoutReference ? ` · ref ${sanitizeLine(input.payoutReference, 40)}` : ''}.`,
      tone: 'success',
    },
    rejected: {
      title: `Withdrawal ${amount} was not approved`,
      body: `${input.reason ? `${sanitizeLine(input.reason, 180)}. ` : ''}The money is back in your available balance.`,
      tone: 'warning',
    },
    failed: {
      title: `Withdrawal ${amount} could not be sent`,
      body: `${input.reason ? `${sanitizeLine(input.reason, 180)}. ` : ''}The provider rejected the transfer, so the money is back in your available balance.`,
      tone: 'danger',
    },
    cancelled: { title: `Withdrawal ${amount} cancelled`, body: 'The money is back in your available balance.', tone: 'info' },
  }
  const message = messages[input.to]
  if (message) await notifyUser(outcome.row.uid, { ...message, link: '/wallet' })

  return { request: outcome.row, releasedUsd: outcome.releasedUsd, debitedUsd: outcome.debitedUsd }
}
