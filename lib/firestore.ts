/**
 * Firestore client helpers — user profile, wallet, maintenance mode, and admin persistence.
 *
 * Every user document lives at: users/{uid}
 * System config lives at: system/settings
 * Admin logs live at: admin_logs/{logId}
 */

import { getApps, getApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  collection,
  query,
  orderBy,
  limit,
  serverTimestamp,
  arrayUnion,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore'
import type { Job, Application, ApplicationStatus } from '@/lib/afterworks-data'

/**
 * All possible values for a user's accountState field.
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
  memberSince: string // e.g. "Jul 2026"
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

export type MaintenanceConfig = {
  enabled: boolean
  title: string
  message: string
  estimatedEnd: string | null
  allowedEmails: string[]
  updatedAt: string
  updatedBy?: string
}

export type AdminAuditLog = {
  id: string
  action: string
  details?: Record<string, unknown>
  actorEmail?: string
  timestamp: string
}

export type PaymentTransaction = {
  id: string
  reference: string
  userId?: string
  email: string
  amountKes: number
  amountUsd?: number
  currency: string
  status: 'pending' | 'success' | 'failed'
  jobId?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  enabled: false,
  title: 'Under Scheduled Maintenance',
  message: 'We are currently optimizing the AfterWorks platform for improved performance and reliability. We will be back shortly.',
  estimatedEnd: null,
  allowedEmails: [],
  updatedAt: new Date().toISOString(),
  updatedBy: 'System',
}

/**
 * Safely initialise (or reuse) the Firestore instance.
 */
function getDB(): Firestore | null {
  if (!getApps().length) {
    console.warn('[Firestore] Firebase app not initialized — skipping DB call.')
    return null
  }
  try {
    return getFirestore(getApp())
  } catch (err) {
    console.error('[Firestore] Failed to get Firestore instance:', err)
    return null
  }
}

/** Format the current date as "Mon YYYY" for memberSince */
function currentMonthYear(): string {
  return new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

/**
 * Called once on sign-up.
 * Creates the user document in Firestore with a blank wallet.
 */
export async function createUserDocument(
  uid: string,
  name: string,
  email: string,
): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const userRef = doc(db, 'users', uid)
    const existing = await getDoc(userRef)
    if (existing.exists()) {
      console.log('[Firestore] User document already exists for uid:', uid)
      return
    }

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
        wallet: {
          pendingUsd: 0,
          availableUsd: 0,
          payoutNumber: '',
        },
        createdAt: serverTimestamp(),
      },
      { merge: true },
    )
    console.log('[Firestore] User document created for uid:', uid)
  } catch (err) {
    console.error('[Firestore] createUserDocument failed:', err)
  }
}

/**
 * Fetches the full user document (profile + wallet) from Firestore.
 */
export async function getUserDocument(uid: string): Promise<UserDocument | null> {
  const db = getDB()
  if (!db) return null

  try {
    const snap = await getDoc(doc(db, 'users', uid))
    if (!snap.exists()) return null
    const data = snap.data() as Omit<UserDocument, 'uid'>
    return { uid, ...data }
  } catch (err) {
    console.error('[Firestore] getUserDocument failed for uid:', uid, err)
    return null
  }
}

/**
 * Subscribes to the user document in real-time.
 */
export function subscribeToUserDocument(
  uid: string,
  onUpdate: (data: UserDocument | null) => void,
): () => void {
  const db = getDB()
  if (!db) {
    onUpdate(null)
    return () => {}
  }

  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null)
      } else {
        const data = snap.data() as Omit<UserDocument, 'uid'>
        onUpdate({ uid, ...data })
      }
    },
    (err) => {
      console.error('[Firestore] subscribeToUserDocument failed for uid:', uid, err)
      onUpdate(null)
    },
  )
}

/**
 * Updates only the wallet sub-object for a user.
 */
export async function updateUserWallet(uid: string, wallet: Partial<WalletData>): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const userRef = doc(db, 'users', uid)
    const updates: Record<string, number | string> = {}
    if (wallet.pendingUsd !== undefined) updates['wallet.pendingUsd'] = wallet.pendingUsd
    if (wallet.availableUsd !== undefined) updates['wallet.availableUsd'] = wallet.availableUsd
    if (wallet.payoutNumber !== undefined) updates['wallet.payoutNumber'] = wallet.payoutNumber

    await setDoc(userRef, updates, { merge: true })
  } catch (err) {
    console.error('[Firestore] updateUserWallet failed for uid:', uid, err)
  }
}

/**
 * Updates profile fields on the user's Firestore document.
 */
export async function updateUserProfile(
  uid: string,
  fields: Partial<Omit<UserProfile, 'uid'>>,
): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    ) as Record<string, unknown>

    if (Object.keys(clean).length === 0) return

    const userRef = doc(db, 'users', uid)
    await setDoc(userRef, clean, { merge: true })
  } catch (err) {
    console.error('[Firestore] updateUserProfile failed for uid:', uid, err)
  }
}

/**
 * Records a paid training module for a user in Firestore.
 */
export async function recordPaidTrainingInFirestore(uid: string, jobId: string): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const userRef = doc(db, 'users', uid)
    await updateDoc(userRef, {
      paidTrainings: arrayUnion(jobId),
    })
  } catch (err) {
    console.warn('[Firestore] updateDoc arrayUnion failed, attempting setDoc merge:', err)
    try {
      const userRef = doc(db, 'users', uid)
      const userDoc = await getUserDocument(uid)
      const existing = userDoc?.paidTrainings || []
      await setDoc(
        userRef,
        { paidTrainings: Array.from(new Set([...existing, jobId])) },
        { merge: true },
      )
    } catch (fallbackErr) {
      console.error('[Firestore] fallback recordPaidTraining failed:', fallbackErr)
    }
  }
}

// ─── Maintenance Mode Operations ─────────────────────────────────────────────

/**
 * Fetches the system maintenance mode configuration.
 */
export async function getMaintenanceConfig(): Promise<MaintenanceConfig> {
  const db = getDB()
  if (!db) return DEFAULT_MAINTENANCE_CONFIG

  try {
    const snap = await getDoc(doc(db, 'system', 'maintenance'))
    if (!snap.exists()) {
      return DEFAULT_MAINTENANCE_CONFIG
    }
    return { ...DEFAULT_MAINTENANCE_CONFIG, ...snap.data() } as MaintenanceConfig
  } catch (err) {
    console.error('[Firestore] getMaintenanceConfig failed:', err)
    return DEFAULT_MAINTENANCE_CONFIG
  }
}

/**
 * Subscribes to maintenance mode changes in real-time.
 */
export function subscribeToMaintenanceConfig(
  onUpdate: (config: MaintenanceConfig) => void,
): () => void {
  const db = getDB()
  if (!db) {
    onUpdate(DEFAULT_MAINTENANCE_CONFIG)
    return () => {}
  }

  return onSnapshot(
    doc(db, 'system', 'maintenance'),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(DEFAULT_MAINTENANCE_CONFIG)
      } else {
        onUpdate({ ...DEFAULT_MAINTENANCE_CONFIG, ...snap.data() } as MaintenanceConfig)
      }
    },
    (err) => {
      console.error('[Firestore] subscribeToMaintenanceConfig error:', err)
      onUpdate(DEFAULT_MAINTENANCE_CONFIG)
    },
  )
}

/**
 * Updates maintenance mode configuration in Firestore.
 */
export async function updateMaintenanceConfig(
  config: Partial<MaintenanceConfig>,
): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const clean = Object.fromEntries(
      Object.entries({
        ...config,
        updatedAt: new Date().toISOString(),
      }).filter(([, v]) => v !== undefined),
    )
    await setDoc(doc(db, 'system', 'maintenance'), clean, { merge: true })
  } catch (err) {
    console.error('[Firestore] updateMaintenanceConfig failed:', err)
  }
}

// ─── Admin Users & Management Operations ─────────────────────────────────────

/**
 * Retrieves all registered users from Firestore.
 */
export async function getAllUsers(): Promise<UserDocument[]> {
  const db = getDB()
  if (!db) return []

  try {
    const snap = await getDocs(collection(db, 'users'))
    const list: UserDocument[] = []
    snap.forEach((d) => {
      const data = d.data() as Omit<UserDocument, 'uid'>
      list.push({ uid: d.id, ...data })
    })
    return list
  } catch (err) {
    console.error('[Firestore] getAllUsers failed:', err)
    return []
  }
}

/**
 * Subscribes to all users in real-time.
 */
export function subscribeToAllUsers(
  onUpdate: (users: UserDocument[]) => void,
): () => void {
  const db = getDB()
  if (!db) {
    onUpdate([])
    return () => {}
  }

  return onSnapshot(
    collection(db, 'users'),
    (snap) => {
      const list: UserDocument[] = []
      snap.forEach((d) => {
        const data = d.data() as Omit<UserDocument, 'uid'>
        list.push({ uid: d.id, ...data })
      })
      onUpdate(list)
    },
    (err) => {
      console.error('[Firestore] subscribeToAllUsers failed:', err)
      onUpdate([])
    },
  )
}

/**
 * Updates a user's profile and wallet as an admin.
 */
export async function updateUserAdmin(
  uid: string,
  fields: Partial<UserDocument>,
): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    )
    const userRef = doc(db, 'users', uid)
    await setDoc(userRef, clean, { merge: true })
  } catch (err) {
    console.error('[Firestore] updateUserAdmin failed:', err)
  }
}

/**
 * Deletes a user document from Firestore.
 */
export async function deleteUserDocument(uid: string): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    await deleteDoc(doc(db, 'users', uid))
  } catch (err) {
    console.error('[Firestore] deleteUserDocument failed:', err)
  }
}

// ─── Admin Audit Logs ────────────────────────────────────────────────────────

/**
 * Creates an admin audit log entry.
 */
export async function createAdminAuditLog(
  action: string,
  details?: Record<string, unknown>,
  actorEmail?: string,
): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    const logRef = doc(db, 'admin_logs', logId)
    await setDoc(logRef, {
      id: logId,
      action,
      details: details ?? {},
      actorEmail: actorEmail || 'Admin',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[Firestore] createAdminAuditLog failed:', err)
  }
}

/**
 * Subscribes to the latest admin audit logs.
 */
export function subscribeToAdminAuditLogs(
  onUpdate: (logs: AdminAuditLog[]) => void,
): () => void {
  const db = getDB()
  if (!db) {
    onUpdate([])
    return () => {}
  }

  const q = query(collection(db, 'admin_logs'), orderBy('timestamp', 'desc'), limit(50))

  return onSnapshot(
    q,
    (snap) => {
      const list: AdminAuditLog[] = []
      snap.forEach((d) => {
        list.push(d.data() as AdminAuditLog)
      })
      onUpdate(list)
    },
    (err) => {
      console.warn('[Firestore] subscribeToAdminAuditLogs error (fallback without order):', err)
      onSnapshot(collection(db, 'admin_logs'), (snap) => {
        const list: AdminAuditLog[] = []
        snap.forEach((d) => {
          list.push(d.data() as AdminAuditLog)
        })
        list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        onUpdate(list.slice(0, 50))
      })
    },
  )
}

// ─── Job Persistence Helpers ─────────────────────────────────────────────────

/**
 * Saves or updates a Job in Firestore.
 */
export async function saveJobToFirestore(job: Job): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const jobRef = doc(db, 'jobs', job.id)
    await setDoc(jobRef, job, { merge: true })
  } catch (err) {
    console.error('[Firestore] saveJobToFirestore failed:', err)
  }
}

/**
 * Subscribes to jobs in Firestore.
 */
export function subscribeToJobs(
  onUpdate: (jobs: Job[]) => void,
): () => void {
  const db = getDB()
  if (!db) {
    onUpdate([])
    return () => {}
  }

  return onSnapshot(
    collection(db, 'jobs'),
    (snap) => {
      const list: Job[] = []
      snap.forEach((d) => {
        list.push(d.data() as Job)
      })
      onUpdate(list)
    },
    (err) => {
      console.error('[Firestore] subscribeToJobs failed:', err)
      onUpdate([])
    },
  )
}

/**
 * Deletes a Job from Firestore.
 */
export async function deleteJobFromFirestore(jobId: string): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    await deleteDoc(doc(db, 'jobs', jobId))
  } catch (err) {
    console.error('[Firestore] deleteJobFromFirestore failed:', err)
  }
}

// ─── Applications Persistence Helpers ────────────────────────────────────────

/**
 * Saves an Application to Firestore.
 */
export async function saveApplicationToFirestore(app: Application): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const appRef = doc(db, 'applications', app.id)
    await setDoc(appRef, app, { merge: true })
  } catch (err) {
    console.error('[Firestore] saveApplicationToFirestore failed:', err)
  }
}

/**
 * Subscribes to all applications in Firestore.
 */
export function subscribeToAllApplications(
  onUpdate: (apps: Application[]) => void,
): () => void {
  const db = getDB()
  if (!db) {
    onUpdate([])
    return () => {}
  }

  return onSnapshot(
    collection(db, 'applications'),
    (snap) => {
      const list: Application[] = []
      snap.forEach((d) => {
        list.push(d.data() as Application)
      })
      onUpdate(list)
    },
    (err) => {
      console.error('[Firestore] subscribeToAllApplications failed:', err)
      onUpdate([])
    },
  )
}

/**
 * Updates application status and history in Firestore.
 */
export async function updateApplicationInFirestore(
  appId: string,
  status: ApplicationStatus,
  extras?: { rejectionReason?: string; revisionNote?: string },
): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const appRef = doc(db, 'applications', appId)
    const snap = await getDoc(appRef)
    const now = new Date().toISOString()
    
    if (snap.exists()) {
      const existing = snap.data() as Application
      const history = [...(existing.history || []), { status, at: now }]
      const updateData: Partial<Application> = {
        status,
        history,
      }
      if (extras?.rejectionReason !== undefined) updateData.rejectionReason = extras.rejectionReason
      if (extras?.revisionNote !== undefined) updateData.revisionNote = extras.revisionNote
      await updateDoc(appRef, updateData)
    } else {
      await setDoc(
        appRef,
        {
          id: appId,
          status,
          history: [{ status, at: now }],
          ...extras,
        },
        { merge: true },
      )
    }
  } catch (err) {
    console.error('[Firestore] updateApplicationInFirestore failed:', err)
  }
}

// ─── Real Transactions Listener ───────────────────────────────────────────────

/**
 * Subscribes to real payment transactions in Firestore.
 */
export function subscribeToTransactions(
  onUpdate: (transactions: PaymentTransaction[]) => void,
): () => void {
  const db = getDB()
  if (!db) {
    onUpdate([])
    return () => {}
  }

  const q = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(50))

  return onSnapshot(
    q,
    (snap) => {
      const list: PaymentTransaction[] = []
      snap.forEach((d) => {
        list.push(d.data() as PaymentTransaction)
      })
      onUpdate(list)
    },
    (err) => {
      console.warn('[Firestore] subscribeToTransactions error (fallback without order):', err)
      onSnapshot(collection(db, 'transactions'), (snap) => {
        const list: PaymentTransaction[] = []
        snap.forEach((d) => {
          list.push(d.data() as PaymentTransaction)
        })
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        onUpdate(list.slice(0, 50))
      })
    },
  )
}

