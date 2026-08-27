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
): Promise<{ isNew: boolean }> {
  const defaultDoc: UserDocument = {
    uid,
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
  }

  const db = getDB()
  if (!db) {
    console.error('[Firestore] Firebase app not initialized — cannot create user document.')
    return { isNew: false }
  }

  try {
    const userRef = doc(db, 'users', uid)

    // Check if document already exists in Firestore to avoid overwriting
    const existing = await getDoc(userRef)
    if (existing.exists()) {
      console.log('[Firestore] User document already exists for uid:', uid)
      // If document exists but name or email were empty, populate them
      const data = existing.data()
      const updates: Record<string, string> = {}
      if (!data?.name && name) updates.name = name
      if (!data?.email && email) updates.email = email
      if (Object.keys(updates).length > 0) {
        await setDoc(userRef, updates, { merge: true })
      }
      return { isNew: false }
    }

    await setDoc(
      userRef,
      {
        ...defaultDoc,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    )
    console.log('[Firestore] User document created for uid:', uid)
    return { isNew: true }
  } catch (err) {
    console.error('[Firestore] createUserDocument failed:', err)
    return { isNew: false }
  }
}

/**
 * Fetches the full user document (profile + wallet) from Firestore.
 * Falls back to local storage if Firestore is unavailable.
 */
export async function getUserDocument(uid: string): Promise<UserDocument | null> {
  const db = getDB()
  if (!db) {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`afterworks_user_${uid}`)
        if (saved) return JSON.parse(saved)
      } catch {
        return null
      }
    }
    return null
  }

  try {
    const snap = await getDoc(doc(db, 'users', uid))
    if (!snap.exists()) {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(`afterworks_user_${uid}`)
        if (saved) return JSON.parse(saved)
      }
      return null
    }
    const data = snap.data() as Omit<UserDocument, 'uid'>
    return { uid, ...data }
  } catch (err) {
    console.error('[Firestore] getUserDocument failed for uid:', uid, err)
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`afterworks_user_${uid}`)
        if (saved) return JSON.parse(saved)
      } catch {
        // ignore
      }
    }
    return null
  }
}

/**
 * Subscribes to the user document in real-time.
 * Returns an unsubscribe function. Falls back to local storage if offline or DB unavailable.
 */
export function subscribeToUserDocument(
  uid: string,
  onUpdate: (data: UserDocument | null) => void
): () => void {
  const db = getDB()
  if (!db) {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`afterworks_user_${uid}`)
        onUpdate(saved ? JSON.parse(saved) : null)
      } catch {
        onUpdate(null)
      }
    } else {
      onUpdate(null)
    }
    return () => {}
  }

  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        // Check local storage fallback
        if (typeof window !== 'undefined') {
          const saved = localStorage.getItem(`afterworks_user_${uid}`)
          if (saved) {
            try {
              onUpdate(JSON.parse(saved))
              return
            } catch {
              // ignore
            }
          }
        }
        onUpdate(null)
      } else {
        const data = snap.data() as Omit<UserDocument, 'uid'>
        onUpdate({ uid, ...data })
      }
    },
    (err) => {
      console.error('[Firestore] subscribeToUserDocument failed for uid:', uid, err)
      // Fallback to local storage on Firestore error (e.g. rules or network)
      if (typeof window !== 'undefined') {
        try {
          const saved = localStorage.getItem(`afterworks_user_${uid}`)
          if (saved) {
            onUpdate(JSON.parse(saved))
            return
          }
        } catch {
          // ignore
        }
      }
      onUpdate(null)
    }
  )
}

/**
 * Updates only the wallet sub-object for a user.
 * Uses setDoc with merge so it works even if the doc doesn't exist yet.
 */
export async function updateUserWallet(uid: string, wallet: Partial<WalletData>): Promise<void> {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(`afterworks_user_${uid}`)
      const current = saved ? JSON.parse(saved) : {}
      const curWallet = current.wallet || {}
      localStorage.setItem(
        `afterworks_user_${uid}`,
        JSON.stringify({
          ...current,
          wallet: { ...curWallet, ...wallet },
        })
      )
    } catch {
      // ignore
    }
  }

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
 * Uses setDoc with merge so it works even if the document doesn't exist yet.
 * Strips undefined values to avoid Firestore errors.
 */
export async function updateUserProfile(
  uid: string,
  fields: Partial<Omit<UserProfile, 'uid'>>,
): Promise<void> {
  const clean = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>

  if (Object.keys(clean).length === 0) return

  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(`afterworks_user_${uid}`)
      const current = saved ? JSON.parse(saved) : {}
      localStorage.setItem(
        `afterworks_user_${uid}`,
        JSON.stringify({ ...current, ...clean })
      )
    } catch {
      // ignore
    }
  }

  const db = getDB()
  if (!db) return

  try {
    const userRef = doc(db, 'users', uid)
    await setDoc(userRef, clean, { merge: true })
  } catch (err) {
    console.error('[Firestore] updateUserProfile failed for uid:', uid, err)
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

