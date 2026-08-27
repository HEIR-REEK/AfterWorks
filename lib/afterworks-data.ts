// Shared domain types, labels and pricing helpers.

export type JobCategory =
  | 'Data Entry'
  | 'Transcription'
  | 'Image Labeling'
  | 'Content Review'
  | 'Translation'
  | 'Research'

export type JobStatus = 'open' | 'paused' | 'closed'

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

export type WorkerProfile = {
  name: string
  email: string
  location: string
  accountState: AccountState
  kycVerified: boolean
  qualityScore: number // 0-100
  jobsCompleted: number
  memberSince: string
  phone?: string
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

export function formatKes(usd: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(usd * USD_TO_KES)
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} hr${hours === 1 ? '' : 's'}`
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
