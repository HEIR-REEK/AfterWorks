// Shared domain types, money/fee helpers and labels used across the worker app, the console and
// the payment/KYC routes. Server-owned configuration (training fees, exchange rate) lives here so
// the figure a member is quoted and the figure the server charges come from one place.

export type JobCategory =
  | 'Data Entry'
  | 'Transcription'
  | 'Image Labeling'
  | 'Content Review'
  | 'Translation'
  | 'Research'

export type JobStatus = 'open' | 'paused' | 'closed'

/** One authored training section. Workers step through these one at a time on the training page. */
export type TrainingSection = {
  title: string
  content: string
}

/** One authored assessment question. Options are 2–4 strings; `correctIndex` points at the right one. */
export type AssessmentQuestion = {
  question: string
  options: string[]
  correctIndex: number
}

/** Canonical category list — client forms and the server validator both read this. */
export const JOB_CATEGORY_LIST: readonly JobCategory[] = [
  'Data Entry',
  'Transcription',
  'Image Labeling',
  'Content Review',
  'Translation',
  'Research',
]

export type Job = {
  id: string
  title: string
  category: JobCategory
  description: string
  responsibilities: string[]
  payAmountUsd: number
  estimatedMinutes: number
  capacity: number
  slotsRemaining: number
  trainingRequired: boolean
  /**
   * Per-job training price in USD, decided by the admin when publishing the card. Only meaningful
   * when `trainingRequired` is true; falls back to the globally configured fee when absent.
   */
  trainingFeeUsd?: number
  /** Admin-authored training sections. Empty/absent → the built-in category modules are used. */
  trainingNotes?: TrainingSection[]
  /** Admin-authored assessment questions. Empty/absent → the built-in category bank is used. */
  assessmentQuestions?: AssessmentQuestion[]
  requiresVerified: boolean
  status: JobStatus
  // ISO date string for the closing condition
  closesAt: string
  postedAgo: string
}

// The full application lifecycle from the spec:
// submitted -> under_review -> approved | rejected
//   (if approved) -> in_progress -> submitted_for_review
//     -> completed | revision_requested | failed_qa
export type ApplicationStatus =
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'in_progress'
  | 'submitted_for_review'
  | 'revision_requested'
  | 'completed'
  | 'failed_qa'

export type Application = {
  id: string
  jobId: string
  status: ApplicationStatus
  appliedAt: string // ISO
  // When under_review, applications auto-expire after this window (48h in spec).
  reviewExpiresAt: string // ISO
  rejectionReason?: string
  revisionNote?: string
  history: { status: ApplicationStatus; at: string }[]
}

/**
 * All possible values for a user's accountState.
 * Mirrors AccountState from lib/firestore.ts — kept in sync manually.
 */
export type AccountState =
  | 'active'
  | 'kyc_rejected'
  | 'kyc_resubmission'
  | 'kyc_on_hold'
  | 'kyc_abandoned'
  | 'kyc_expired'
  | 'suspended'
  | 'banned'

export type WorkerProfile = {
  name: string
  email: string
  location: string
  accountState: AccountState
  role?: 'admin' | 'user'
  isAdmin?: boolean
  kycVerified: boolean
  qualityScore: number // 0-100
  jobsCompleted: number
  memberSince: string
  phone?: string
  /** ISO-3166 code the phone number was entered against (drives the flag + dialling code). */
  phoneCountry?: string
  bio?: string
  skills?: string[]
  languages?: string[]
  preferredPayoutMethod?: string
  country?: string
  zipCode?: string
  bankName?: string
  bankBranch?: string
  bankAccountNumber?: string
  school?: string
  course?: string
  jobExperience?: string
  career?: string
  kycVerifiedAt?: string
  kycRejectedAt?: string
  kycOnHoldAt?: string
  kycProvider?: string
  kycLevel?: string
  kycStatus?: string
  /** Human-readable reason if KYC was declined or flagged. */
  kycRejectionReason?: string | null
  /** Names of sub-checks that failed, e.g. ['liveness', 'document']. */
  kycFailedChecks?: string[] | null
}

export type Wallet = {
  pendingUsd: number
  availableUsd: number
  payoutNumber: string
}

// Approx display rate; spec says KES shown at payment-time rate.
export const USD_TO_KES = 129

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    // Up to 4 places so sub-dollar training fees (e.g. 0.0077) display as set.
    maximumFractionDigits: 4,
  }).format(amount)
}

export function getExchangeRateUsdToKes(): number {
  const envRate =
    (typeof process !== 'undefined' &&
      (process.env.NEXT_PUBLIC_USD_TO_KES_RATE || process.env.USD_TO_KES_RATE)) ||
    ''
  if (envRate) {
    const num = Number(envRate)
    if (!isNaN(num) && num > 0) return num
  }
  return USD_TO_KES
}

/**
 * Dynamic helper to get configured Paystack training fee in USD dollars.
 * Configurable via NEXT_PUBLIC_PAYSTACK_TRAINING_AMOUNT or PAYSTACK_TRAINING_AMOUNT.
 * Default fallback: 10 ($10 USD).
 */
export function getTrainingFeeUsd(overrideAmount?: number | string | null): number {
  if (overrideAmount !== undefined && overrideAmount !== null && overrideAmount !== '') {
    const num = Number(overrideAmount)
    if (!isNaN(num) && num > 0) {
      return num >= 100 ? num / 100 : num
    }
  }

  const envVal =
    (typeof process !== 'undefined' &&
      (process.env.NEXT_PUBLIC_PAYSTACK_TRAINING_AMOUNT ||
        process.env.PAYSTACK_TRAINING_AMOUNT)) ||
    ''

  if (envVal) {
    const num = Number(envVal)
    if (!isNaN(num) && num > 0) {
      return num >= 100 ? num / 100 : num
    }
  }
  return 10
}

/**
 * Returns the exact KES amount to be charged by Paystack for training.
 * Configurable directly via PAYSTACK_AMOUNT_KES or NEXT_PUBLIC_PAYSTACK_AMOUNT_KES.
 * Defaults to: (Training Fee USD) * (USD to KES Exchange Rate).
 */
export function getTrainingFeeKes(overrideUsd?: number): number {
  const envKes =
    (typeof process !== 'undefined' &&
      (process.env.NEXT_PUBLIC_PAYSTACK_AMOUNT_KES || process.env.PAYSTACK_AMOUNT_KES)) ||
    ''
  if (envKes && !overrideUsd) {
    const num = Number(envKes)
    if (!isNaN(num) && num > 0) return num
  }
  const usd = getTrainingFeeUsd(overrideUsd)
  return Math.round(usd * getExchangeRateUsdToKes())
}

/**
 * Returns the amount in Paystack's required subunit for KES (cents, i.e. KES * 100).
 */
export function getPaystackAmountSubunits(overrideUsd?: number): number {
  return getTrainingFeeKes(overrideUsd) * 100
}

export function getTrainingFeeCents(overrideAmount?: number | string | null): number {
  return Math.round(getTrainingFeeUsd(overrideAmount) * 100)
}

/**
 * The USD price of training for one job card. Admins set this per job; when the job carries no
 * fee of its own (older documents) the globally configured fee applies.
 * Unlike `getTrainingFeeUsd`, a per-job fee is taken at face value — no cents heuristic.
 * Kept to 4 decimal places so sub-dollar fees (e.g. 0.0077) survive the round trip.
 */
export function trainingFeeUsdFor(jobFeeUsd?: number | string | null): number {
  const num = Number(jobFeeUsd)
  if (Number.isFinite(num) && num > 0) return Math.round(num * 10000) / 10000
  return getTrainingFeeUsd()
}

/** KES checkout price for one job card's training: the per-job fee first, global config as fallback. */
export function trainingFeeKesFor(jobFeeUsd?: number | string | null): number {
  const num = Number(jobFeeUsd)
  if (Number.isFinite(num) && num > 0) {
    return Math.round((Math.round(num * 10000) / 10000) * getExchangeRateUsdToKes())
  }
  return getTrainingFeeKes()
}

/** Paystack subunits (KES cents) for one job card's training fee. */
export function paystackSubunitsFor(jobFeeUsd?: number | string | null): number {
  return trainingFeeKesFor(jobFeeUsd) * 100
}

/**
 * Pass mark for an assessment of any length. Keeps the original 10-of-15 ratio (⅔, rounded up),
 * so a custom bank of 6 questions needs 4, and the built-in 15-question banks still need 10.
 */
export function assessmentPassMark(questionCount: number): number {
  const n = Math.max(1, Math.floor(questionCount) || 1)
  return Math.max(1, Math.ceil((n * 2) / 3))
}

export function formatKes(usd: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(usd * USD_TO_KES)
}

/** Format an amount that is already denominated in Kenyan Shillings (no FX conversion). */
export function formatKesValue(kes: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(kes)
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} hr${hours === 1 ? '' : 's'}`
}

/**
 * The blank member a signed-out (or not-yet-loaded) session shows. Deliberately inert: empty
 * strings and empty lists, so nothing on screen can be mistaken for somebody's real account.
 */
export function blankWorker(): WorkerProfile {
  return {
    name: '',
    email: '',
    location: '',
    accountState: 'active',
    kycVerified: false,
    qualityScore: 100,
    jobsCompleted: 0,
    memberSince: '',
    phone: '',
    bio: '',
    skills: [],
    languages: [],
    preferredPayoutMethod: 'M-Pesa',
  }
}

// --- Application lifecycle helpers ---

export const APPLICATION_LABELS: Record<ApplicationStatus, string> = {
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  in_progress: 'In progress',
  submitted_for_review: 'Submitted for QA',
  revision_requested: 'Revision requested',
  completed: 'Completed & paid',
  failed_qa: 'Failed QA',
}

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export const APPLICATION_TONE: Record<ApplicationStatus, StatusTone> = {
  under_review: 'info',
  approved: 'info',
  rejected: 'danger',
  in_progress: 'info',
  submitted_for_review: 'warning',
  revision_requested: 'warning',
  completed: 'success',
  failed_qa: 'danger',
}
