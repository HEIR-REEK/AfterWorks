// Admin panel shared types, labels, demo seed data and helpers.
//
// The admin panel works in two modes, mirroring the rest of the app:
//  - Firestore mode — real data via /api/admin/* routes (Firebase Admin SDK)
//  - Demo mode     — Firebase not configured; seeded data persisted to
//                    localStorage so the whole panel is fully explorable.

import type { AccountState } from '@/lib/firestore'
import type { ApplicationStatus } from '@/lib/afterworks-data'
import { APPLICATION_LABELS, formatUsd } from '@/lib/afterworks-data'

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdminUser = {
  uid: string
  name: string
  email: string
  accountState: AccountState | string
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

export const APPLICATION_ACTION_LABELS: Record<string, string> = {
  approve: 'Approve',
  reject: 'Reject',
  start_work: 'Mark in progress',
  submit_review: 'Submit for QA',
  complete: 'Approve QA & pay',
  fail_qa: 'Fail QA',
  request_revision: 'Request revision',
}

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

export function formatWalletUsd(amount: number | undefined): string {
  return formatUsd(amount ?? 0)
}

// ─── Demo mode persistence ───────────────────────────────────────────────────

const LS = {
  users: 'afterworks_admin_users_v1',
  kyc: 'afterworks_admin_kyc_v1',
  jobs: 'afterworks_jobs_v1',
  demoRole: 'afterworks_demo_role',
  maintenance: 'afterworks_maintenance_v1',
} as const

function readLS<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeLS(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota errors
  }
}

/** Custom event fired whenever admin-managed demo data changes. */
export const DEMO_DATA_EVENT = 'aw-demo-data-changed'

function notifyDemoChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DEMO_DATA_EVENT))
  }
}

// ─── Demo seed data ──────────────────────────────────────────────────────────

export function seedAdminUsers(): AdminUser[] {
  const now = new Date()
  const daysAgo = (n: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() - n)
    return d.toISOString()
  }
  return [
    {
      uid: 'demo-admin',
      name: 'AfterWorks Admin',
      email: 'admin@afterworks.io',
      accountState: 'active',
      kycVerified: true,
      qualityScore: 100,
      jobsCompleted: 0,
      memberSince: 'Jan 2025',
      phone: '+254 700 000 001',
      location: 'Nairobi, Kenya',
      isAdmin: true,
      createdAt: daysAgo(230),
      wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '' },
    },
    {
      uid: 'usr-01',
      name: 'Amara Okoro',
      email: 'amara.okoro@afterworks.io',
      accountState: 'active',
      kycVerified: true,
      qualityScore: 98,
      jobsCompleted: 14,
      memberSince: 'Mar 2025',
      phone: '+254 712 345 678',
      location: 'Nairobi, Kenya',
      createdAt: daysAgo(170),
      wallet: { pendingUsd: 22, availableUsd: 46, payoutNumber: '+254 712 345 678' },
      paidTrainings: ['job-medical-transcription', 'job-image-label'],
    },
    {
      uid: 'usr-02',
      name: 'Kwame Mensah',
      email: 'kwame.mensah@gmail.com',
      accountState: 'active',
      kycVerified: true,
      qualityScore: 91,
      jobsCompleted: 8,
      memberSince: 'Apr 2025',
      phone: '+233 544 112 334',
      location: 'Accra, Ghana',
      createdAt: daysAgo(140),
      wallet: { pendingUsd: 0, availableUsd: 18, payoutNumber: '+233 544 112 334' },
    },
    {
      uid: 'usr-03',
      name: 'Zawadi Njeri',
      email: 'zawadi.njeri@gmail.com',
      accountState: 'kyc_on_hold',
      kycVerified: false,
      qualityScore: 100,
      jobsCompleted: 0,
      memberSince: 'Aug 2026',
      phone: '+254 733 882 110',
      location: 'Nakuru, Kenya',
      createdAt: daysAgo(2),
      wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '' },
    },
    {
      uid: 'usr-04',
      name: 'Tendai Moyo',
      email: 'tendai.moyo@outlook.com',
      accountState: 'kyc_resubmission',
      kycVerified: false,
      qualityScore: 100,
      jobsCompleted: 0,
      memberSince: 'Aug 2026',
      phone: '+263 772 445 901',
      location: 'Harare, Zimbabwe',
      createdAt: daysAgo(4),
      wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '' },
    },
    {
      uid: 'usr-05',
      name: 'Fatuma Hassan',
      email: 'fatuma.hassan@gmail.com',
      accountState: 'active',
      kycVerified: true,
      qualityScore: 95,
      jobsCompleted: 11,
      memberSince: 'Jun 2025',
      phone: '+254 726 553 129',
      location: 'Mombasa, Kenya',
      createdAt: daysAgo(90),
      wallet: { pendingUsd: 35, availableUsd: 52, payoutNumber: '+254 726 553 129' },
      paidTrainings: ['job-sentiment-research'],
    },
    {
      uid: 'usr-06',
      name: 'Brian Otieno',
      email: 'brian.otieno@gmail.com',
      accountState: 'kyc_rejected',
      kycVerified: false,
      qualityScore: 100,
      jobsCompleted: 0,
      memberSince: 'Aug 2026',
      phone: '+254 711 908 776',
      location: 'Kisumu, Kenya',
      createdAt: daysAgo(6),
      wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '' },
    },
    {
      uid: 'usr-07',
      name: 'Neema Kilonzo',
      email: 'neema.kilonzo@gmail.com',
      accountState: 'kyc_abandoned',
      kycVerified: false,
      qualityScore: 100,
      jobsCompleted: 0,
      memberSince: 'Aug 2026',
      phone: '',
      location: 'Arusha, Tanzania',
      createdAt: daysAgo(9),
      wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '' },
    },
    {
      uid: 'usr-08',
      name: 'Samuel Kariuki',
      email: 'sam.kariuki@yahoo.com',
      accountState: 'active',
      kycVerified: true,
      qualityScore: 62,
      jobsCompleted: 5,
      memberSince: 'May 2025',
      phone: '+254 798 220 465',
      location: 'Thika, Kenya',
      createdAt: daysAgo(110),
      wallet: { pendingUsd: 12, availableUsd: 9, payoutNumber: '+254 798 220 465' },
    },
    {
      uid: 'usr-09',
      name: 'Aisha Wanjiru',
      email: 'aisha.wanjiru@gmail.com',
      accountState: 'kyc_expired',
      kycVerified: false,
      qualityScore: 100,
      jobsCompleted: 0,
      memberSince: 'Aug 2026',
      phone: '+254 745 667 221',
      location: 'Nairobi, Kenya',
      createdAt: daysAgo(1),
      wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '' },
    },
  ]
}

export function seedAdminKyc(): AdminKycItem[] {
  const now = new Date()
  const hoursAgo = (n: number) => {
    const d = new Date(now)
    d.setHours(d.getHours() - n)
    return d.toISOString()
  }
  return [
    {
      uid: 'usr-03',
      userName: 'Zawadi Njeri',
      userEmail: 'zawadi.njeri@gmail.com',
      sessionId: 'didit_zawadi_01',
      status: 'OnHold',
      attemptCount: 1,
      firstAttemptAt: hoursAgo(20),
      updatedAt: hoursAgo(19),
      rejectionReason: 'Document image slightly blurred — manual compliance review required.',
    },
    {
      uid: 'usr-04',
      userName: 'Tendai Moyo',
      userEmail: 'tendai.moyo@outlook.com',
      sessionId: 'didit_tendai_02',
      status: 'Resubmission',
      attemptCount: 2,
      firstAttemptAt: hoursAgo(50),
      updatedAt: hoursAgo(30),
      rejectionReason: 'Liveness check failed on first attempt.',
      failedChecks: ['liveness'],
    },
    {
      uid: 'usr-06',
      userName: 'Brian Otieno',
      userEmail: 'brian.otieno@gmail.com',
      sessionId: 'didit_brian_01',
      status: 'Declined',
      attemptCount: 1,
      firstAttemptAt: hoursAgo(80),
      updatedAt: hoursAgo(78),
      rejectionReason: 'Expired national ID document.',
      failedChecks: ['document'],
    },
    {
      uid: 'usr-05',
      userName: 'Fatuma Hassan',
      userEmail: 'fatuma.hassan@gmail.com',
      sessionId: 'didit_fatuma_01',
      status: 'Approved',
      attemptCount: 1,
      firstAttemptAt: hoursAgo(240),
      updatedAt: hoursAgo(238),
    },
    {
      uid: 'usr-09',
      userName: 'Aisha Wanjiru',
      userEmail: 'aisha.wanjiru@gmail.com',
      sessionId: 'didit_aisha_01',
      status: 'Expired',
      attemptCount: 1,
      firstAttemptAt: hoursAgo(26),
      updatedAt: hoursAgo(24),
      rejectionReason: 'Verification session expired before completion.',
    },
  ]
}

// ─── Demo-mode store helpers (localStorage backed) ───────────────────────────

export function loadDemoUsers(): AdminUser[] {
  return readLS<AdminUser[]>(LS.users) ?? seedAdminUsers()
}

export function saveDemoUsers(users: AdminUser[]) {
  writeLS(LS.users, users)
  notifyDemoChange()
}

export function loadDemoKyc(): AdminKycItem[] {
  return readLS<AdminKycItem[]>(LS.kyc) ?? seedAdminKyc()
}

export function saveDemoKyc(items: AdminKycItem[]) {
  writeLS(LS.kyc, items)
  notifyDemoChange()
}

// ─── Demo job overrides (shared with the worker app) ─────────────────────────

export type DemoJobsOverride = {
  updatedAt: string
  jobs: import('@/lib/afterworks-data').Job[]
}

export function loadDemoJobsOverride(): DemoJobsOverride | null {
  return readLS<DemoJobsOverride>(LS.jobs)
}

export function saveDemoJobsOverride(jobs: DemoJobsOverride['jobs']) {
  writeLS(LS.jobs, { updatedAt: new Date().toISOString(), jobs } satisfies DemoJobsOverride)
  notifyDemoChange()
}

export function clearDemoJobsOverride() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(LS.jobs)
  notifyDemoChange()
}

// ─── Demo auth role ──────────────────────────────────────────────────────────

export type DemoRole = 'admin' | 'worker'

export function getDemoRole(): DemoRole | null {
  return readLS<DemoRole>(LS.demoRole)
}

export function setDemoRole(role: DemoRole) {
  writeLS(LS.demoRole, role)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aw-demo-role-changed'))
  }
}

export function clearDemoRole() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LS.demoRole)
    window.dispatchEvent(new CustomEvent('aw-demo-role-changed'))
  }
}

// ─── Demo maintenance config ─────────────────────────────────────────────────

export function loadDemoMaintenance(): MaintenanceConfig {
  return (
    readLS<MaintenanceConfig>(LS.maintenance) ?? {
      enabled: false,
      message: DEFAULT_MAINTENANCE_MESSAGE,
    }
  )
}

export function saveDemoMaintenance(config: MaintenanceConfig) {
  writeLS(LS.maintenance, config)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aw-maintenance-changed'))
  }
}
