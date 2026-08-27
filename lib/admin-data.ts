// Admin panel shared types, labels and helpers.
//
// Everything here is production data-flow: the admin panel reads and writes
// through /api/admin/* routes (Firebase Admin SDK → Firestore). There is no
// demo/mock mode — when Firebase is not configured the APIs respond with
// `configured: false` and the UI surfaces the error.

import type { ApplicationStatus } from '@/lib/afterworks-data'
import { APPLICATION_LABELS } from '@/lib/afterworks-data'

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdminUser = {
  uid: string
  name: string
  email: string
  accountState: string
  kycVerified: boolean
  qualityScore: number
  jobsCompleted: number
  memberSince?: string
  phone?: string
  location?: string
  bio?: string
  createdAt?: string
  isAdmin?: boolean
  wallet?: {
    pendingUsd: number
    availableUsd: number
    payoutNumber: string
  }
  paidTrainings?: string[]
}

export type AdminKycStatus =
  | 'Pending'
  | 'InProgress'
  | 'Approved'
  | 'Declined'
  | 'Resubmission'
  | 'OnHold'
  | 'Abandoned'
  | 'Expired'

export type AdminKycItem = {
  uid: string
  userName: string
  userEmail: string
  sessionId: string
  status: AdminKycStatus
  rawStatus?: string
  rejectionReason?: string | null
  failedChecks?: string[] | null
  attemptCount: number
  firstAttemptAt?: string
  updatedAt?: string
}

export type AdminApplication = {
  id: string
  userId: string
  userName?: string
  jobId: string
  status: ApplicationStatus
  appliedAt: string
  reviewExpiresAt: string
  rejectionReason?: string
  revisionNote?: string
  history: { status: ApplicationStatus; at: string }[]
}

export type MaintenanceConfig = {
  enabled: boolean
  message: string
  /** Human readable estimate, e.g. "Today, 9 PM EAT". */
  estimatedUntil?: string
  updatedAt?: string
  updatedBy?: string
}

export const DEFAULT_MAINTENANCE_MESSAGE =
  'We are upgrading AfterWorks to serve you better. Jobs, applications and wallets are safe — please check back soon.'

// ─── Firestore collection names (single source of truth) ─────────────────────

export const COLLECTIONS = {
  users: 'users',
  admins: 'admins',
  kycRecords: 'kyc_records',
  jobs: 'jobs',
  applications: 'applications',
  siteConfig: 'site_config',
} as const

/** Document ID inside `site_config` holding the platform settings. */
export const SITE_CONFIG_DOC = 'settings'

// ─── Labels & tones ──────────────────────────────────────────────────────────

export const ACCOUNT_STATE_LABELS: Record<string, string> = {
  active: 'Active',
  kyc_rejected: 'KYC rejected',
  kyc_resubmission: 'KYC resubmission',
  kyc_on_hold: 'On hold',
  kyc_abandoned: 'KYC abandoned',
  kyc_expired: 'KYC expired',
  suspended: 'Suspended',
  banned: 'Banned',
}

export type AdminTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export const ACCOUNT_STATE_TONES: Record<string, AdminTone> = {
  active: 'success',
  kyc_rejected: 'danger',
  kyc_resubmission: 'warning',
  kyc_on_hold: 'warning',
  kyc_abandoned: 'neutral',
  kyc_expired: 'neutral',
  suspended: 'danger',
  banned: 'danger',
}

export const KYC_STATUS_LABELS: Record<AdminKycStatus, string> = {
  Pending: 'Pending review',
  InProgress: 'In progress',
  Approved: 'Approved',
  Declined: 'Declined',
  Resubmission: 'Resubmission requested',
  OnHold: 'On hold',
  Abandoned: 'Abandoned',
  Expired: 'Expired',
}

export const KYC_STATUS_TONES: Record<AdminKycStatus, AdminTone> = {
  Pending: 'warning',
  InProgress: 'info',
  Approved: 'success',
  Declined: 'danger',
  Resubmission: 'warning',
  OnHold: 'warning',
  Abandoned: 'neutral',
  Expired: 'neutral',
}

/** KYC records that still need an admin decision. */
export function kycNeedsAction(status: AdminKycStatus): boolean {
  return status === 'Pending' || status === 'OnHold' || status === 'Resubmission' || status === 'InProgress'
}

export { APPLICATION_LABELS }

/**
 * Which lifecycle actions are available for an application, keyed by its
 * current status. Mirrors the 8-state machine in the system documentation.
 */
export const APPLICATION_ACTIONS: Record<ApplicationStatus, string[]> = {
  under_review: ['approve', 'reject'],
  approved: ['start_work', 'reject'],
  rejected: [],
  in_progress: ['submit_review'],
  submitted_for_review: ['complete', 'request_revision', 'fail_qa'],
  revision_requested: ['submit_review', 'reject'],
  completed: [],
  failed_qa: [],
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function formatDateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeAgo(iso?: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms)) return '—'
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  return `${months}mo ago`
}
