/**
 * Firestore client helpers — the browser-facing half of the data layer.
 *
 * Scope rules for this file (enforced by firestore.rules, not by convention):
 *  • A member may read and edit **their own** profile, and read the public job catalogue.
 *  • Nothing else is writable from the browser. Roles, KYC verdicts, wallet balances, job slots,
 *    the maintenance switch and the audit ledger moved to server routes (`/api/admin/*`,
 *    `/api/applications`), because a browser-supplied `isAdmin: true` is not a security model.
 *  • Maintenance state is *polled* from `/api/maintenance` rather than subscribed to: it must work
 *    for signed-out visitors, crawlers and blocked-websocket networks, and one ETag'd request every
 *    20s is cheaper than a live listener per tab.
 */

import { getApps, getApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  limit as fsLimit,
  serverTimestamp,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore'
import type { Job } from '@/lib/afterworks-data'
import { apiFetch, authedFetch } from '@/lib/client-api'
import {
  DEFAULT_MAINTENANCE_CONFIG,
  INERT_MAINTENANCE_VIEW,
  resolveMaintenance,
  toMaintenanceView,
  type MaintenanceConfig,
  type MaintenanceMode,
  type MaintenanceReason,
  type MaintenanceService,
  type MaintenanceView,
} from '@/lib/maintenance-shared'

// Re-exported so existing importers (app shell, maintenance screen) keep working while the model
// itself lives in the runtime-agnostic module that the middleware shares.
export type { MaintenanceConfig, MaintenanceMode, MaintenanceReason, MaintenanceService, MaintenanceView }
export { DEFAULT_MAINTENANCE_CONFIG, INERT_MAINTENANCE_VIEW, resolveMaintenance, toMaintenanceView }

/**
 * All possible values for a member's accountState field.
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

export type UserProfile = {
  uid: string
  name: string
  email: string
  location: string
  memberSince: string
  qualityScore: number
  jobsCompleted: number
  kycVerified: boolean
  accountState: AccountState
  role?: 'admin' | 'user'
  isAdmin?: boolean
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
  paidTrainings?: string[]
  kycVerifiedAt?: string
  kycRejectedAt?: string
  kycOnHoldAt?: string
  kycProvider?: string
  kycLevel?: string
  kycStatus?: string
  kycRejectionReason?: string | null
  kycFailedChecks?: string[] | null
  createdAt?: unknown
  updatedAt?: unknown
}

export type WalletData = {
  pendingUsd: number
  availableUsd: number
  payoutNumber: string
}

export type UserDocument = UserProfile & {
  wallet: WalletData
}

/** Kept as an alias so existing admin imports keep compiling while they move to the API. */
export type AdminAuditLog = {
  id: string
  action: string
  details?: Record<string, unknown>
  actorEmail?: string
  timestamp: string
}

/** Fields the browser may write about itself. Anything else is dropped (and rejected server-side). */
const MEMBER_EDITABLE_FIELDS = new Set([
  'name',
  'location',
  'bio',
  'skills',
  'languages',
  'preferredPayoutMethod',
  'country',
  'zipCode',
  'bankName',
  'bankBranch',
  'bankAccountNumber',
  'school',
  'course',
  'jobExperience',
  'career',
  'phone',
])

// ─── Firestore handle ────────────────────────────────────────────────────────

function getDB(): Firestore | null {
  if (typeof window === 'undefined') return null
  if (!getApps().length) return null
  try {
    return getFirestore(getApp())
  } catch (err) {
    console.warn('[Firestore] instance unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

export function isFirestoreReady(): boolean {
  return getDB() !== null
}

function currentMonthYear(): string {
  return new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

// ─── Profile ─────────────────────────────────────────────────────────────────

/**
 * Called once on sign-up. Creates the member document in its inert initial state; privileges are
 * deliberately absent (see firestore.rules `create` clause, which rejects otherwise).
 */
export async function createUserDocument(uid: string, name: string, email: string): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const userRef = doc(db, 'users', uid)
    if ((await getDoc(userRef)).exists()) return

    await setDoc(
      userRef,
      {
        name,
        email,
        location: '',
        memberSince: currentMonthYear(),
        qualityScore: 100,
        jobsCompleted: 0,
        kycVerified: false,
        accountState: 'active',
        role: 'user',
        isAdmin: false,
        phone: '',
        bio: '',
        skills: [],
        languages: [],
        preferredPayoutMethod: 'M-Pesa',
        paidTrainings: [],
        wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '' },
        createdAt: serverTimestamp(),
      },
      { merge: true },
    )
  } catch (err) {
    console.warn('[Firestore] createUserDocument skipped:', err instanceof Error ? err.message : err)
  }
}

export async function getUserDocument(uid: string): Promise<UserDocument | null> {
  const db = getDB()
  if (!db) return null
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    if (!snap.exists()) return null
    return { uid, ...(snap.data() as Omit<UserDocument, 'uid'>) }
  } catch (err) {
    console.warn('[Firestore] getUserDocument failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export function subscribeToUserDocument(uid: string, onUpdate: (data: UserDocument | null) => void): () => void {
  const db = getDB()
  if (!db) {
    onUpdate(null)
    return () => {}
  }
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => onUpdate(snap.exists() ? { uid, ...(snap.data() as Omit<UserDocument, 'uid'>) } : null),
    (err) => {
      console.warn('[Firestore] subscribeToUserDocument error:', err instanceof Error ? err.message : err)
      onUpdate(null)
    },
  )
}

/**
 * Profile edits. Unknown or privileged keys are filtered here *and* rejected by the server and the
 * rules, so a tampered client bundle cannot smuggle `kycVerified: true` through a profile save.
 */
export async function updateUserProfile(uid: string, fields: Partial<Omit<UserProfile, 'uid'>>): Promise<{ ok: boolean; dropped: string[] }> {
  const db = getDB()
  if (!db) return { ok: false, dropped: Object.keys(fields) }

  const clean: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (!MEMBER_EDITABLE_FIELDS.has(key)) {
      dropped.push(key)
      continue
    }
    clean[key] = value
  }
  if (Object.keys(clean).length === 0) return { ok: true, dropped }

  try {
    await setDoc(doc(db, 'users', uid), { ...clean, updatedAt: new Date().toISOString() }, { merge: true })
    return { ok: true, dropped }
  } catch (err) {
    console.error('[Firestore] updateUserProfile failed:', err)
    return { ok: false, dropped }
  }
}

/** Payout handle only. Balances themselves are server-owned (wallet ledger + admin actions). */
export async function updateUserWallet(uid: string, wallet: { payoutNumber?: string }): Promise<void> {
  const db = getDB()
  if (!db) return
  try {
    const updates: Record<string, string> = {}
    if (wallet.payoutNumber !== undefined) updates['wallet.payoutNumber'] = wallet.payoutNumber
    if (Object.keys(updates).length === 0) return
    await setDoc(doc(db, 'users', uid), updates, { merge: true })
  } catch (err) {
    console.error('[Firestore] updateUserWallet failed:', err)
  }
}

/**
 * Wallet snapshot for the signed-in member. Route returns the same numbers the ledger produced, so
 * "pending clears at 09:14 tomorrow" is a real timestamp and not copy.
 */
export async function fetchWallet(): Promise<WalletData & { entries?: unknown[]; clearingLabel?: string } | null> {
  return authedFetch<WalletData & { entries?: unknown[]; clearingLabel?: string }>('/api/wallet')
}

// ─── Jobs (public catalogue, bounded read) ───────────────────────────────────

export async function loadJobsOnce(max = 60): Promise<Job[]> {
  const db = getDB()
  if (!db) return []
  try {
    const snap = await getDocs(query(collection(db, 'jobs'), fsLimit(max)))
    const jobs: Job[] = []
    snap.forEach((d) => jobs.push(d.data() as Job))
    return jobs
  } catch (err) {
    console.warn('[Firestore] loadJobsOnce failed:', err instanceof Error ? err.message : err)
    return []
  }
}

export function subscribeToJobs(onUpdate: (jobs: Job[]) => void): () => void {
  const db = getDB()
  if (!db) {
    onUpdate([])
    return () => {}
  }
  return onSnapshot(
    query(collection(db, 'jobs'), fsLimit(60)),
    (snap) => {
      const jobs: Job[] = []
      snap.forEach((d) => jobs.push(d.data() as Job))
      onUpdate(jobs)
    },
    (err) => {
      console.warn('[Firestore] subscribeToJobs error:', err instanceof Error ? err.message : err)
      onUpdate([])
    },
  )
}

/** Jobs the member has open slots for, without their own applications leaking into the query. */
export async function getJobSnapshot(jobId: string): Promise<Job | null> {
  const db = getDB()
  if (!db) return null
  try {
    const snap = await getDoc(doc(db, 'jobs', jobId))
    return snap.exists() ? (snap.data() as Job) : null
  } catch {
    return null
  }
}

/** Slot count straight from the catalogue (used to render "37 of 80 slots left" honestly). */
export async function getJobAvailability(jobIds: string[]): Promise<Record<string, { slotsRemaining: number; status: string }>> {
  const db = getDB()
  const out: Record<string, { slotsRemaining: number; status: string }> = {}
  if (!db || jobIds.length === 0) return out
  try {
    const chunks: string[][] = []
    for (let i = 0; i < jobIds.length; i += 10) chunks.push(jobIds.slice(i, i + 10))
    await Promise.all(
      chunks.map(async (chunk) => {
        const snap = await getDocs(query(collection(db, 'jobs'), where('__name__', 'in', chunk)))
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>
          out[d.id] = {
            slotsRemaining: Number(data.slotsRemaining ?? 0),
            status: String(data.status ?? 'open'),
          }
        })
      }),
    )
  } catch (err) {
    console.warn('[Firestore] getJobAvailability failed:', err instanceof Error ? err.message : err)
  }
  return out
}

// ─── Maintenance mode ────────────────────────────────────────────────────────

export async function fetchMaintenanceStatus(): Promise<MaintenanceView> {
  try {
    const data = await apiFetch<Record<string, unknown>>('/api/maintenance', { timeoutMs: 8_000 })
    const config = { ...DEFAULT_MAINTENANCE_CONFIG, ...(data as object) } as MaintenanceConfig
    const status = resolveMaintenance(config)
    return {
      enabled: data.enabled === true,
      blocking: data.blocking === true || status.active,
      bannerOnly: data.bannerOnly === true || status.bannerOnly,
      mode: (data.mode as MaintenanceMode) ?? config.mode,
      title: String(data.title || '') || config.title,
      message: String(data.message || '') || config.message,
      banner: String(data.banner || '') || config.banner,
      estimatedEnd: (data.estimatedEnd as string | null) ?? config.estimatedEnd,
      remainingMs: typeof data.remainingMs === 'number' ? data.remainingMs : status.remainingMs,
      contactEmail: String(data.contactEmail || '') || config.contactEmail,
      services: (Array.isArray(data.services) ? (data.services as MaintenanceService[]) : config.affectedServices),
      version: Number(data.version ?? config.version) || 0,
      unknown: false,
      raw: config,
    }
  } catch {
    return INERT_MAINTENANCE_VIEW
  }
}

/**
 * Subscribe to the maintenance flag. Polls on a visibility-aware interval: 15s while the tab is
 * focused, 2 minutes in the background (a hidden tab does not need to be accurate to the second,
 * and this used to fire once per tab per second on the previous implementation).
 */
export function subscribeToMaintenanceConfig(onUpdate: (view: MaintenanceView) => void): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async () => {
    if (stopped) return
    const view = await fetchMaintenanceStatus()
    if (!stopped) onUpdate(view)
    const focused = typeof document !== 'undefined' && document.visibilityState === 'visible'
    timer = setTimeout(tick, focused ? 15_000 : 120_000)
  }

  const onVisible = () => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'visible') {
      if (timer) clearTimeout(timer)
      void tick()
    }
  }

  void tick()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  }
}

// ─── Worker notifications ────────────────────────────────────────────────────

export type NotificationRow = {
  id: string
  title: string
  body: string
  tone?: 'success' | 'info' | 'warning' | 'danger'
  link?: string
  read?: boolean
  createdAt: string
}

export async function fetchNotifications(limit = 20): Promise<{ notifications: NotificationRow[]; unread: number; available: boolean }> {
  try {
    const data = await apiFetch<{ ok: boolean; notifications: NotificationRow[]; unread: number; available?: boolean }>('/api/notifications', {
      query: { limit },
    })
    return { notifications: data.notifications ?? [], unread: data.unread ?? 0, available: data.available !== false }
  } catch {
    return { notifications: [], unread: 0, available: false }
  }
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  try {
    await apiFetch('/api/notifications', { method: 'PATCH', body: ids?.length ? { ids } : { all: true } })
  } catch (err) {
    console.warn('[notifications] mark-read failed:', err)
  }
}

// ─── Legacy shims ────────────────────────────────────────────────────────────

/**
 * Audit writes from the browser are gone on purpose: the ledger is append-only from server code.
 * Admin UI actions are audited by the routes they call. This shim exists so a stale tab does not
 * throw while the console is being used mid-deploy.
 */
export async function createAdminAuditLog(): Promise<void> {
  console.warn('[Firestore] client-side audit writes are disabled; the API records actions instead.')
}

/** @deprecated maintenance is now saved through PUT /api/admin/maintenance */
export async function updateMaintenanceConfig(patch: Partial<MaintenanceConfig>): Promise<void> {
  const { apiFetch: call } = await import('@/lib/client-api')
  await call('/api/admin/maintenance', { method: 'PUT', body: patch })
}

/** @deprecated read maintenance via fetchMaintenanceStatus() */
export async function getMaintenanceConfig(): Promise<MaintenanceConfig> {
  const view = await fetchMaintenanceStatus()
  return view.raw
}
