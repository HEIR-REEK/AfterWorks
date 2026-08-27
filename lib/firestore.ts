/**
 * Firestore client helpers — user profile & wallet persistence.
 *
 * Every user document lives at: users/{uid}
 * Shape: { name, email, location, memberSince, qualityScore, jobsCompleted, kycVerified, accountState,
 *           phone, bio, skills, languages, preferredPayoutMethod,
 *           wallet: { pendingUsd, availableUsd, payoutNumber } }
 *
 * All functions are safe to call without crashing the app:
 *  - getDB() returns null if Firebase is not yet initialized (e.g. missing config)
 *  - Every exported function wraps its work in try/catch and returns null / void on error
 */

import { getApps, getApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore'

/**
 * All possible values for a user's accountState field.
 *
 *  active            – Normal operating state (includes KYC-verified users).
 *  kyc_rejected      – Verification failed; user must re-apply.
 *  kyc_resubmission  – Some checks failed; user must redo specific steps.
 *  kyc_on_hold       – Flagged for manual compliance review.
 *  kyc_abandoned     – User started KYC but didn't finish.
 *  kyc_expired       – The KYC session expired before completion.
 */
export type AccountState =
  | 'active'
  | 'kyc_rejected'
  | 'kyc_resubmission'
  | 'kyc_on_hold'
  | 'kyc_abandoned'
  | 'kyc_expired'

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
  /** Human-readable reason if KYC was declined, on-hold, or resubmission needed. */
  kycRejectionReason?: string | null
  /** Names of verification sub-checks that failed (e.g. ['liveness', 'document']). */
  kycFailedChecks?: string[] | null
}

export type WalletData = {
  pendingUsd: number
  availableUsd: number
  payoutNumber: string
}

export type UserDocument = UserProfile & {
  wallet: WalletData
  paidTrainings?: string[]
}

/**
 * Safely initialise (or reuse) the Firestore instance.
 * Returns null when Firebase has not been initialized yet so callers can
 * bail out gracefully instead of throwing.
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
 * Uses merge:true so a second sign-up attempt doesn't wipe existing data.
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

    // Check if document already exists to avoid overwriting
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
        phone: '',
        bio: '',
        skills: [],
        languages: [],
        preferredPayoutMethod: 'M-Pesa',
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
    // Don't re-throw — allow sign-up to succeed even if Firestore write fails
  }
}

/**
 * Fetches the full user document (profile + wallet) from Firestore.
 * Returns null if the document doesn't exist or if an error occurs.
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
 * Returns an unsubscribe function.
 */
export function subscribeToUserDocument(
  uid: string,
  onUpdate: (data: UserDocument | null) => void
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
    }
  )
}

/**
 * Updates only the wallet sub-object for a user.
 * Uses setDoc with merge so it works even if the doc doesn't exist yet.
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

    // Use setDoc with merge so this doesn't fail if document doesn't exist
    await setDoc(userRef, updates, { merge: true })
  } catch (err) {
    console.error('[Firestore] updateUserWallet failed for uid:', uid, err)
  }
}

/**
 * Updates profile fields on the user's Firestore document.
 * Uses setDoc with merge so it works even if the document doesn't exist yet.
 * Strips undefined values to avoid Firestore errors.
 */
export async function updateUserProfile(
  uid: string,
  fields: Partial<Omit<UserProfile, 'uid'>>,
): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    // Strip undefined values — Firestore does not accept undefined
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    ) as Record<string, unknown>

    if (Object.keys(clean).length === 0) return

    const userRef = doc(db, 'users', uid)
    // Use setDoc with merge so it creates the document if it doesn't exist
    await setDoc(userRef, clean, { merge: true })
  } catch (err) {
    console.error('[Firestore] updateUserProfile failed for uid:', uid, err)
  }
}

/**
 * Mirrors a job application into the top-level `applications` collection so
 * the admin panel can list and act on it. Best-effort: errors are logged and
 * swallowed — the worker's local tracker remains the source of truth in the
 * prototype.
 */
export async function mirrorApplicationToFirestore(
  uid: string,
  applicationId: string,
  app: {
    jobId: string
    status: string
    appliedAt: string
    reviewExpiresAt: string
    history: { status: string; at: string }[]
  },
): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const { doc: docFn, setDoc: setDocFn } = await import('firebase/firestore')
    await setDocFn(
      docFn(db, 'applications', applicationId),
      {
        userId: uid,
        jobId: app.jobId,
        status: app.status,
        appliedAt: app.appliedAt,
        reviewExpiresAt: app.reviewExpiresAt,
        history: app.history,
      },
      { merge: true },
    )
    console.log(`[Firestore] Mirrored application ${applicationId} for uid=${uid}`)
  } catch (err) {
    console.error('[Firestore] mirrorApplicationToFirestore failed:', err)
  }
}

/**
 * Records a completed Paystack training payment for a user in Firestore.
 */
export async function recordPaidTrainingInFirestore(
  uid: string,
  jobId: string,
): Promise<void> {
  const db = getDB()
  if (!db) return

  try {
    const { arrayUnion } = await import('firebase/firestore')
    const userRef = doc(db, 'users', uid)
    await setDoc(
      userRef,
      {
        paidTrainings: arrayUnion(jobId),
      },
      { merge: true },
    )
    console.log(`[Firestore] Recorded paid training for uid=${uid}, jobId=${jobId}`)
  } catch (err) {
    console.error('[Firestore] recordPaidTrainingInFirestore failed:', err)
  }
}

