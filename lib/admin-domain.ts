/**
 * Admin domain rules — shared by the moderation API and the console UI.
 *
 * Keeping the legal state machine in one place is what stops the UI offering a transition that the
 * API then rejects (the usual symptom of duplicated rules), and gives the buttons real tooltips
 * explaining *why* something is disabled.
 */

export const ADMIN_MUTABLE_STATES = [
  'active',
  'kyc_rejected',
  'kyc_resubmission',
  'kyc_on_hold',
  'kyc_abandoned',
  'kyc_expired',
  'suspended',
  'banned',
] as const

export type AdminMutableState = (typeof ADMIN_MUTABLE_STATES)[number]

export const STATE_LABELS: Record<AdminMutableState, string> = {
  active: 'Active',
  kyc_rejected: 'KYC rejected',
  kyc_resubmission: 'Awaiting resubmission',
  kyc_on_hold: 'On hold',
  kyc_abandoned: 'Verification abandoned',
  kyc_expired: 'Verification expired',
  suspended: 'Suspended',
  banned: 'Banned',
}

export const STATE_HINTS: Record<AdminMutableState, string> = {
  active: 'Full platform access: apply, submit work, withdraw.',
  kyc_rejected: 'Cannot apply until identity verification passes.',
  kyc_resubmission: 'May retry verification from the profile page.',
  kyc_on_hold: 'Manual review in progress; no new applications.',
  kyc_abandoned: 'Verification started but never finished.',
  kyc_expired: 'Verification lapsed; must re-verify.',
  suspended: 'Reversible restriction. Earnings stay locked but safe.',
  banned: 'Permanent restriction. Only support can reverse this.',
}

const ALLOWED: Record<AdminMutableState, AdminMutableState[]> = {
  active: ['suspended', 'banned', 'kyc_on_hold', 'kyc_rejected'],
  kyc_rejected: ['kyc_resubmission', 'active', 'banned'],
  kyc_resubmission: ['kyc_on_hold', 'active', 'kyc_rejected'],
  kyc_on_hold: ['active', 'kyc_rejected', 'suspended'],
  kyc_abandoned: ['kyc_resubmission', 'active'],
  kyc_expired: ['kyc_resubmission', 'active'],
  suspended: ['active', 'banned'],
  banned: ['active'],
}

export function isStateTransitionAllowed(from: string, to: string): boolean {
  if (from === to) return true
  const list = ALLOWED[from as AdminMutableState]
  return list ? list.includes(to as AdminMutableState) : false
}

// ─── Role capabilities ───────────────────────────────────────────────────────
//
// One table for "what may a staff account do", read by the API guards *and* the console UI, so
// a button is never shown that the server then refuses (and vice versa). Owners may do everything.
//
// Staff run the support desk: KYC verdicts, unlocking members who cannot get back in (temporary
// password, restore a suspended account, re-enable a disabled credential, clear a sign-in
// lockout) and audit notes. Anything that *takes* access away, moves money, changes roles,
// or deletes data stays with the main administrator.

export type AdminRoleName = 'owner' | 'staff'

/** `PATCH /api/admin/users` actions a staff session may call (with the payload limits below). */
export const STAFF_USER_ACTIONS = ['kyc', 'temp-password', 'moderate', 'account'] as const

/** `PATCH /api/admin` operator actions a staff session may call. */
export const STAFF_OPERATOR_ACTIONS = ['note', 'unlock'] as const

export type StaffDenial = { allowed: true } | { allowed: false; reason: string }

/**
 * Staff may *restore* but never *restrict*: the only moderation state they can set is `active`,
 * and the only credential change they can make is re-enabling.
 */
export function staffUserActionVerdict(action: string, payload: Record<string, unknown>): StaffDenial {
  if (!(STAFF_USER_ACTIONS as readonly string[]).includes(action)) {
    return { allowed: false, reason: 'Staff accounts can review KYC, reset passwords and restore access. This action is restricted to the main administrator.' }
  }
  if (action === 'moderate' && String(payload.accountState ?? '') !== 'active') {
    return { allowed: false, reason: 'Staff accounts can restore an account to active, but only the main administrator can suspend, ban or hold one.' }
  }
  if (action === 'account' && payload.enable !== true) {
    return { allowed: false, reason: 'Staff accounts can re-enable a sign-in credential, but only the main administrator can disable one.' }
  }
  return { allowed: true }
}

export function staffOperatorActionVerdict(action: string): StaffDenial {
  if (!(STAFF_OPERATOR_ACTIONS as readonly string[]).includes(action)) {
    return { allowed: false, reason: 'This operator action is restricted to the main administrator.' }
  }
  return { allowed: true }
}

/** Human summary shown on the Staff page and in the users drawer footnote. */
export const STAFF_CAPABILITY_SUMMARY = [
  'Review the QA desk and approve or reject KYC',
  'Issue a temporary password to a locked-out member',
  'Restore a suspended account and re-enable a disabled sign-in',
  'Clear a sign-in lockout (console or password-reset)',
  'Pause or reopen job cards and leave audit notes',
] as const

export const OWNER_ONLY_SUMMARY = [
  'Suspend, ban, hold or delete accounts',
  'Wallet adjustments and the money ledger',
  'Staff accounts, roles, maintenance mode, audit log and security settings',
] as const

export type ApplicationAction = 'approve' | 'reject' | 'start' | 'approve_qa' | 'request_revision' | 'fail_qa' | 'requeue'

export const APPLICATION_ACTION_LABELS: Record<ApplicationAction, string> = {
  approve: 'Approve application',
  reject: 'Reject application',
  start: 'Open work window',
  approve_qa: 'Approve work & pay',
  request_revision: 'Request revision',
  fail_qa: 'Fail QA',
  requeue: 'Return to review',
}

export const APPLICATION_ACTION_SIDE_EFFECTS: Partial<Record<ApplicationAction, string>> = {
  approve: 'Reserves one job slot and notifies the worker.',
  reject: 'Releases the slot if it was already reserved.',
  approve_qa: 'Credits the job amount to the worker pending balance (clears in 72h).',
  fail_qa: 'Flags the submission; two consecutive failures lower the quality score.',
}

/** Maps the console buttons onto the Firestore status machine. */
export const ACTION_TO_STATUS: Record<ApplicationAction, string> = {
  approve: 'approved',
  reject: 'rejected',
  start: 'in_progress',
  approve_qa: 'completed',
  request_revision: 'revision_requested',
  fail_qa: 'failed_qa',
  requeue: 'under_review',
}

export const REQUIRED_REASON: ApplicationAction[] = ['reject', 'request_revision', 'fail_qa']

// ─── Member rows: one projection, shared by the API and the console ──────────
//
// A `users/{uid}` document is not guaranteed to look like a profile. The phone-claim guard
// (`lib/account-uniqueness.ts`), the terms acceptance write and the referral index all use
// `set(..., { merge: true })`, so a stub document — no name, no email, no `wallet` — can exist
// before, or even instead of, a real profile. Older rows are worse: the schema grows and old
// documents simply lack the new fields.
//
// The console used to trust whatever the document said. One stub row was enough to take the whole
// page down: the detail drawer read `user.wallet.availableUsd` on a document with no `wallet` at
// all, which threw "Cannot read properties of undefined (reading 'availableUsd')" and replaced the
// directory with the error boundary. So the projection lives here, is applied to *both* the
// directory page and the detail payload by the server and again by the client, and every value it
// returns is present and typed. Nothing downstream has to guess, and a half-written record is a
// blank row with a label — not an outage.

export type AdminUserWalletRow = {
  pendingUsd: number
  availableUsd: number
  payoutNumberMasked: string
}

/** The directory columns, exactly as the console renders them. Never partially populated. */
export type AdminUserRowModel = {
  uid: string
  name: string
  email: string
  accountState: string
  kycVerified: boolean
  kycStatus?: string
  role: string
  qualityScore: number
  jobsCompleted: number
  memberSince: string
  createdAt: string | null
  lastActiveAt: string | null
  wallet: AdminUserWalletRow
  country?: string
  phoneMasked?: string
  paidTrainingsCount: number
  /**
   * No name *and* no email: a stub document (a phone claim, a terms acceptance, an interrupted
   * write) rather than a member we can describe. Worth flagging in the UI instead of rendering a
   * row that looks like a rendering bug.
   */
  profileIncomplete: boolean
}

/** The optional fields the detail drawer knows how to show, all normalised. */
export type AdminUserDetailModel = AdminUserRowModel & {
  phone?: string
  payoutNumberMasked?: string
  skills?: string[]
  languages?: string[]
  bio?: string
  rating?: number
  jobsApplied?: number
  walletNote?: string
  moderationReason?: string
  signupBonusGranted?: boolean
  welcomeBonusPending?: boolean
  signupBonusGrantedAt?: string | null
  kycProvider?: string
  kycLevel?: string
  kycRejectedAt?: string | null
  kycOnHoldAt?: string | null
  career?: string
  bank?: Record<string, unknown> | null
  updatedAt?: string | null
  deletedAt?: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Text as the UI can print it: numbers are welcome, objects/arrays are not (they crash React). */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asCount(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

/** Money as a finite number, or 0. `NaN` in a balance is a display bug, never a real balance. */
function asMoney(value: unknown): number {
  return asCount(value, 0)
}

/**
 * Payout handles (M-Pesa numbers, bank accounts) are shown as a bulleted tail only — the console
 * never needs the full value to do its job.
 */
export function maskPayoutHandle(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length < 4) return ''
  return `${'•'.repeat(Math.max(2, digits.length - 6))}${digits.slice(-4)}`
}

/**
 * Firestore has three ways of spelling the same timestamp depending on who wrote the document:
 * an ISO string (our server writes), a `Timestamp` from the Admin SDK, or the `{_seconds}` object
 * left behind when a `serverTimestamp()` value is JSON-serialised. All three become an ISO string
 * or `null`; `new Date(undefined)` rendered as "Invalid Date" is the symptom of skipping this.
 */
export function coerceIsoTimestamp(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value : null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const record = asRecord(value)
  const toDate = record.toDate
  if (typeof toDate === 'function') {
    const converted = (toDate as () => unknown).call(value)
    if (converted instanceof Date && !Number.isNaN(converted.getTime())) return converted.toISOString()
  }
  const seconds = Number(record._seconds ?? record.seconds)
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString()
  return null
}

/**
 * Project one `users/{uid}` document onto the directory row. Tolerates anything: a missing
 * document body, a `wallet` that is a string, a timestamp that is an object.
 */
export function adminUserRowFromDoc(
  uid: string,
  data: Record<string, unknown> | null | undefined,
): AdminUserRowModel {
  const doc = asRecord(data)
  const wallet = asRecord(doc.wallet)
  const name = asText(doc.name).trim()
  const email = asText(doc.email).trim()
  const phone = asText(doc.phone)
  const payoutHandle = asText(wallet.payoutNumber) || phone
  const phoneMasked = maskPayoutHandle(phone)

  return {
    uid: asText(uid).trim(),
    name,
    email,
    accountState: asText(doc.accountState).trim() || 'active',
    kycVerified: doc.kycVerified === true,
    kycStatus: asText(doc.kycStatus).trim() || undefined,
    role: doc.isAdmin === true ? 'admin' : asText(doc.role).trim() || 'user',
    qualityScore: asCount(doc.qualityScore, 100),
    jobsCompleted: asCount(doc.jobsCompleted, 0),
    memberSince: asText(doc.memberSince).trim(),
    createdAt: coerceIsoTimestamp(doc.createdAt),
    lastActiveAt: coerceIsoTimestamp(doc.updatedAt ?? doc.lastActiveAt),
    wallet: {
      pendingUsd: asMoney(wallet.pendingUsd),
      availableUsd: asMoney(wallet.availableUsd),
      payoutNumberMasked: maskPayoutHandle(payoutHandle),
    },
    country: asText(doc.country).trim() || undefined,
    phoneMasked: phoneMasked || undefined,
    paidTrainingsCount: Array.isArray(doc.paidTrainings) ? doc.paidTrainings.length : 0,
    profileIncomplete: !name && !email,
  }
}

/**
 * The detail drawer's payload: the row above (so every column is present) plus the extra profile
 * fields, each coerced to what JSX can actually render. Unknown keys are dropped rather than
 * spread through — the browser should never receive a document we have not described, and the
 * document holds a plaintext payout number next to the masked one.
 */
export function adminUserDetailFromDoc(raw: unknown): AdminUserDetailModel {
  const doc = asRecord(raw)
  const row = adminUserRowFromDoc(asText(doc.uid) || asText(doc.id), doc)
  const detail: AdminUserDetailModel = { ...row }

  const phone = asText(doc.phone).trim()
  if (phone) detail.phone = phone
  detail.payoutNumberMasked = row.wallet.payoutNumberMasked
  if (asText(doc.walletNote).trim()) detail.walletNote = asText(doc.walletNote).trim()
  if (asText(doc.moderationReason).trim()) detail.moderationReason = asText(doc.moderationReason).trim()
  if (asText(doc.bio)) detail.bio = asText(doc.bio)
  if (asText(doc.career)) detail.career = asText(doc.career)
  if (asText(doc.kycProvider)) detail.kycProvider = asText(doc.kycProvider)
  if (asText(doc.kycLevel)) detail.kycLevel = asText(doc.kycLevel)

  const skills = asTextList(doc.skills)
  if (skills.length) detail.skills = skills
  const languages = asTextList(doc.languages)
  if (languages.length) detail.languages = languages

  if (typeof doc.rating === 'number' && Number.isFinite(doc.rating)) detail.rating = doc.rating
  if (typeof doc.jobsApplied === 'number' && Number.isFinite(doc.jobsApplied)) detail.jobsApplied = doc.jobsApplied
  if (doc.signupBonusGranted === true) detail.signupBonusGranted = true
  if (doc.welcomeBonusPending === true) detail.welcomeBonusPending = true
  detail.signupBonusGrantedAt = coerceIsoTimestamp(doc.signupBonusGrantedAt)
  detail.kycRejectedAt = coerceIsoTimestamp(doc.kycRejectedAt)
  detail.kycOnHoldAt = coerceIsoTimestamp(doc.kycOnHoldAt)
  detail.updatedAt = coerceIsoTimestamp(doc.updatedAt)
  detail.deletedAt = coerceIsoTimestamp(doc.deletedAt)

  const bank = asRecord(doc.bank)
  if (Object.keys(bank).length) {
    const accountNumber = asText(bank.accountNumber) || asText(bank.bankAccountNumber)
    detail.bank = {
      ...bank,
      ...(accountNumber ? { accountNumber: maskPayoutHandle(accountNumber), accountNumberMasked: maskPayoutHandle(accountNumber) } : {}),
    }
  } else if (doc.bank === null) {
    detail.bank = null
  }

  return detail
}

function asTextList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => asText(entry)).filter(Boolean) : []
}
