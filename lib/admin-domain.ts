/**
 * Admin domain rules — shared by the moderation API and the console UI.
 *
 * Keeping the legal state machine in one place is what stops the UI offering a transition that the
 * API then rejects (the usual symptom of duplicated rules), and gives the buttons real tooltips
 * explaining *why* something is disabled.
 */

import { profileCompletion } from '@/lib/profile-completion'

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
// directory with the error boundary. So the projection lives here, and both sides run it:
//   • the server — `toRow()` and `getUserDetail()` in `lib/firestore-admin.ts`;
//   • the client — `adminUserRowsFromPayload()` and `adminUserDetailFromDoc()` in `lib/admin.ts`,
//     so a stale or partial response cannot hand the table a row it has to defend itself against.
// Every value it returns is present and typed. Nothing downstream has to guess, and a half-written
// record is a blank row with a label — not an outage.

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
  /**
   * When the member last asked for a review, or undefined if they never have. The console's
   * verification queue is "unverified members with a kycRequestedAt", newest first.
   */
  kycRequestedAt?: string
  /**
   * When a verification request was held because the profile was incomplete (not recorded as
   * `kycRequestedAt`, so it never enters the review queue until the profile is finished).
   */
  kycRequestHeldAt?: string
  /** Labels of the required profile fields still empty when the request was held. */
  kycHoldMissing?: string[]
  role: string
  /** True when the member's email is on the ADMIN_EMAILS roster — the main administrator, shown as Admin rather than Staff. */
  isOwner?: boolean
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
  /**
   * Real profile completeness from `profileCompletion()` (name, phone, location, bio, skills,
   * languages all answered) — what gates a verification request. Shown in the directory and the
   * KYC drawer so staff can see whether a request can be accepted.
   */
  profileComplete: boolean
  profilePercent: number
  /** Labels of the required fields still empty. */
  profileMissing: string[]
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
 *
 * The projection is also *idempotent*: run it over a row it already produced and nothing is lost.
 * That matters because the row is projected on the server and again in the browser
 * (`adminUserRowsFromPayload`), and a few columns only exist in projected form — the masked payout
 * handle, the masked phone, the training count. Recomputing those from a projected row would blank
 * them, which is the same class of bug as the crash this file exists to prevent: the console showing
 * a wrong number because it trusted the shape in front of it.
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
    kycRequestedAt: coerceIsoTimestamp(doc.kycRequestedAt) ?? undefined,
    role: doc.isAdmin === true ? 'admin' : asText(doc.role).trim() || 'user',
    // Set by the users API for emails on the ADMIN_EMAILS roster — shown as Admin, not Staff.
    isOwner: doc.isOwner === true ? true : undefined,
    qualityScore: asCount(doc.qualityScore, 100),
    jobsCompleted: asCount(doc.jobsCompleted, 0),
    memberSince: asText(doc.memberSince).trim(),
    createdAt: coerceIsoTimestamp(doc.createdAt),
    lastActiveAt: coerceIsoTimestamp(doc.updatedAt ?? doc.lastActiveAt),
    wallet: {
      pendingUsd: asMoney(wallet.pendingUsd),
      availableUsd: asMoney(wallet.availableUsd),
      // The raw handle is never sent to the browser, so an already-projected row only carries the
      // masked form — keep it instead of re-masking an empty string into nothing.
      payoutNumberMasked:
        maskPayoutHandle(payoutHandle) || asText(wallet.payoutNumberMasked) || asText(doc.payoutNumberMasked),
    },
    country: asText(doc.country).trim() || undefined,
    phoneMasked: phoneMasked || asText(doc.phoneMasked) || undefined,
    paidTrainingsCount: Array.isArray(doc.paidTrainings)
      ? doc.paidTrainings.length
      : asCount(doc.paidTrainingsCount, 0),
    profileIncomplete: !name && !email,
    // Idempotent projection: the server scores this from the FULL document. When the input is an
    // already-projected wire row — which carries no raw bio/skills/languages/location and only a
    // masked phone — re-scoring it would read as 1/6 (17%) for everyone and overwrite the correct
    // server values, so keep the carried values instead.
    ...(() => {
      if (typeof doc.profileComplete === 'boolean' && typeof doc.profilePercent === 'number') {
        return {
          profileComplete: doc.profileComplete === true,
          profilePercent: asCount(doc.profilePercent, 0),
          profileMissing: Array.isArray(doc.profileMissing)
            ? doc.profileMissing.map((entry) => asText(entry)).filter(Boolean)
            : [],
        }
      }
      const completion = profileCompletion(doc)
      return {
        profileComplete: completion.complete,
        profilePercent: completion.percent,
        profileMissing: completion.missingLabels,
      }
    })(),
    kycRequestHeldAt: coerceIsoTimestamp(doc.kycRequestHeldAt) ?? undefined,
    kycHoldMissing: Array.isArray(doc.kycHoldMissing)
      ? doc.kycHoldMissing.map((entry) => asText(entry)).filter(Boolean).slice(0, 12)
      : undefined,
  }
}

/**
 * One directory row as it arrived over the wire.
 *
 * The server projects rows through `adminUserRowFromDoc`, but the console does not bet a page on
 * that: during a rolling deploy the browser can be talking to an older server, a response can come
 * from a cache, and a partial payload leaves `row.wallet` undefined — which is precisely how
 * `row.wallet.availableUsd` in the members table threw "Cannot read properties of undefined
 * (reading 'availableUsd')" and replaced the directory with the error boundary. One bad row should
 * be one blank row.
 */
export function adminUserRowFromPayload(value: unknown, fallbackUid = ''): AdminUserRowModel {
  const record = asRecord(value)
  return adminUserRowFromDoc(asText(record.uid) || asText(record.id) || fallbackUid, record)
}

/** A whole directory page: a missing or non-array `rows` is an empty table, never an exception. */
export function adminUserRowsFromPayload(rows: unknown): AdminUserRowModel[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row, index) => adminUserRowFromPayload(row, `row-${index}`))
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
    const maskedBank: Record<string, unknown> = { ...bank }
    // Never return the raw account number even if an older document has it under a different key.
    delete maskedBank.bankAccountNumber
    delete maskedBank.accountNumber
    detail.bank = {
      ...maskedBank,
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

/** A count that is allowed to mean "not connected" — `null` is a real answer, `undefined` is not. */
function asNullableCount(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// ─── Console overview snapshot: one shape, every group present ───────────────
//
// The overview page renders nested groups all the way down (`stats.money.availableUsd`,
// `stats.security.lockouts.locked.length`). Optional chaining on `stats` alone does not protect it:
// a payload that is present but missing one group throws exactly the way the member table threw on
// a row with no `wallet`, and the console's front page is the worst place for that to happen.
//
// The shape is also not as guaranteed as it looks. `PlatformStats` in `lib/firestore-admin.ts`
// declares `security.lockouts` as a number, while `/api/admin` replaces it with a snapshot object —
// the page reads `.locked.length` on the latter. So the snapshot is normalised here, once, and the
// page reads the result without defending itself.

export type AdminStatsPostureCheck = {
  id: string
  label: string
  severity: 'pass' | 'warn' | 'fail'
  detail: string
  fix?: string
}

export type AdminStatsLockout = { key: string; until: number }

export type AdminPlatformStats = {
  totals: {
    users: number
    kycVerified: number
    kycRequested: number
    kycPending: number
    suspended: number
    activeLast7d: number
    activeLast24h: number
    /** `null` = the credential store is not connected to this deployment, which is shown as such. */
    accounts: number | null
    accountsDisabled: number | null
    accountsWithoutProfile: number | null
  }
  jobs: { open: number; paused: number; closed: number; totalSlots: number; filledSlots: number }
  applications: { total: number; underReview: number; active: number; completed: number; rejected: number }
  money: { liabilityUsd: number; pendingUsd: number; availableUsd: number; revenueKes: number; paidOutKes: number }
  payments: { successful: number; pending: number; failed: number; last7dVolumeKes: number }
  security: {
    failedLogins24h: number
    lockouts: { tracked: number; totalAttempts: number; totalBlocked: number; locked: AdminStatsLockout[] }
    posture: AdminStatsPostureCheck[]
  }
  activity: { id: string; label: string; at: string; tone: string }[]
  maintenance: {
    enabled: boolean
    title: string
    message: string
    estimatedEnd: string | null
    mode: string
    updatedBy?: string
    updatedAt: string | null
  }
  maintenanceStatus: { active: boolean; bannerOnly: boolean; retryAfterSec: number; remainingMs: number | null }
  generatedAt: string
}

function asSeverity(value: unknown): AdminStatsPostureCheck['severity'] {
  const text = asText(value).trim()
  return text === 'pass' || text === 'fail' ? text : 'warn'
}

function asPostureChecks(value: unknown): AdminStatsPostureCheck[] {
  if (!Array.isArray(value)) return []
  return value.map((entry, index) => {
    const check = asRecord(entry)
    const fix = asText(check.fix).trim()
    return {
      id: asText(check.id).trim() || `check-${index}`,
      label: asText(check.label).trim() || 'Configuration check',
      severity: asSeverity(check.severity),
      detail: asText(check.detail).trim(),
      ...(fix ? { fix } : {}),
    }
  })
}

/** The `/api/admin` snapshot, coerced. Anything the console reads is present after this. */
export function normalisePlatformStats(raw: unknown): AdminPlatformStats {
  const doc = asRecord(raw)
  const totals = asRecord(doc.totals)
  const jobs = asRecord(doc.jobs)
  const applications = asRecord(doc.applications)
  const money = asRecord(doc.money)
  const payments = asRecord(doc.payments)
  const security = asRecord(doc.security)
  const maintenance = asRecord(doc.maintenance)
  const maintenanceStatus = asRecord(doc.maintenanceStatus)
  // `security.lockouts` has been a number and an object in different revisions of the payload; only
  // the object form carries the addresses currently locked out.
  const lockouts = asRecord(security.lockouts)

  return {
    totals: {
      users: asCount(totals.users, 0),
      kycVerified: asCount(totals.kycVerified, 0),
      kycRequested: asCount(totals.kycRequested, 0),
      kycPending: asCount(totals.kycPending, 0),
      suspended: asCount(totals.suspended, 0),
      activeLast7d: asCount(totals.activeLast7d, 0),
      activeLast24h: asCount(totals.activeLast24h, 0),
      accounts: asNullableCount(totals.accounts),
      accountsDisabled: asNullableCount(totals.accountsDisabled),
      accountsWithoutProfile: asNullableCount(totals.accountsWithoutProfile),
    },
    jobs: {
      open: asCount(jobs.open, 0),
      paused: asCount(jobs.paused, 0),
      closed: asCount(jobs.closed, 0),
      totalSlots: asCount(jobs.totalSlots, 0),
      filledSlots: asCount(jobs.filledSlots, 0),
    },
    applications: {
      total: asCount(applications.total, 0),
      underReview: asCount(applications.underReview, 0),
      active: asCount(applications.active, 0),
      completed: asCount(applications.completed, 0),
      rejected: asCount(applications.rejected, 0),
    },
    money: {
      liabilityUsd: asMoney(money.liabilityUsd),
      pendingUsd: asMoney(money.pendingUsd),
      availableUsd: asMoney(money.availableUsd),
      revenueKes: asMoney(money.revenueKes),
      paidOutKes: asMoney(money.paidOutKes),
    },
    payments: {
      successful: asCount(payments.successful, 0),
      pending: asCount(payments.pending, 0),
      failed: asCount(payments.failed, 0),
      last7dVolumeKes: asCount(payments.last7dVolumeKes, 0),
    },
    security: {
      failedLogins24h: asCount(security.failedLogins24h, 0),
      lockouts: {
        tracked: asCount(lockouts.tracked, 0),
        totalAttempts: asCount(lockouts.totalAttempts, 0),
        totalBlocked: asCount(lockouts.totalBlocked, 0),
        locked: Array.isArray(lockouts.locked)
          ? lockouts.locked.map((entry) => {
              const row = asRecord(entry)
              return { key: asText(row.key), until: asCount(row.until, 0) }
            })
          : [],
      },
      posture: asPostureChecks(security.posture),
    },
    activity: Array.isArray(doc.activity)
      ? doc.activity.map((entry, index) => {
          const row = asRecord(entry)
          return {
            id: asText(row.id).trim() || `activity-${index}`,
            label: asText(row.label).trim() || 'Console action',
            at: coerceIsoTimestamp(row.at) ?? '',
            tone: asText(row.tone).trim() || 'neutral',
          }
        })
      : [],
    maintenance: {
      enabled: maintenance.enabled === true,
      title: asText(maintenance.title).trim() || 'Maintenance',
      message: asText(maintenance.message).trim(),
      estimatedEnd: coerceIsoTimestamp(maintenance.estimatedEnd),
      mode: asText(maintenance.mode).trim() || 'banner',
      ...(asText(maintenance.updatedBy).trim() ? { updatedBy: asText(maintenance.updatedBy).trim() } : {}),
      updatedAt: coerceIsoTimestamp(maintenance.updatedAt),
    },
    maintenanceStatus: {
      active: maintenanceStatus.active === true,
      bannerOnly: maintenanceStatus.bannerOnly === true,
      retryAfterSec: asCount(maintenanceStatus.retryAfterSec, 0),
      remainingMs: asNullableCount(maintenanceStatus.remainingMs),
    },
    generatedAt: coerceIsoTimestamp(doc.generatedAt) ?? new Date(0).toISOString(),
  }
}

// ─── Bearer sessions: what a verified ID token is allowed to become ──────────

/**
 * The administrator a *verified* Firebase ID token may act as — or `null` if it may not act as one.
 *
 * The decision is deliberately made from the server-owned role table (`ADMIN_EMAILS` or an active
 * `admin_accounts` entry) and **not** from the token's own `admin` claim or a mutable
 * `users.isAdmin` profile label.
 *
 * Why that matters enough to spell out: a claim or profile flag is not proof of anything. It used
 * to be minted from a member's editable profile email and trusted by `firestore.rules`; honouring
 * a bare claim here would turn any ordinary worker session into an administration credential that
 * never had to pass the sign-in screen. A claim without a resolvable role is drift, and drift is
 * denied.
 *
 * Tooling that presents a roster email still works: the roster resolves, so the role comes back.
 */
export function bearerAdminPrincipal(
  decoded: { email?: unknown; uid?: unknown; exp?: unknown; admin?: unknown },
  resolvedRole: AdminRoleName | null,
): { email: string; uid: string; expiresAt: number; role: AdminRoleName } | null {
  if (!resolvedRole) return null
  const email = typeof decoded?.email === 'string' ? decoded.email.trim().toLowerCase() : ''
  const uid = typeof decoded?.uid === 'string' ? decoded.uid.trim() : ''
  if (!email || !uid) return null
  const exp = typeof decoded?.exp === 'number' && Number.isFinite(decoded.exp) ? decoded.exp : 0
  return { email, uid, expiresAt: exp * 1000, role: resolvedRole }
}
