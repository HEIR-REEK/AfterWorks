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
  type Firestore,
} from 'firebase/firestore'

export type UserProfile = {
  uid: string
  name: string
  email: string
  location: string
  memberSince: string // e.g. "Jul 2026"
  qualityScore: number
  jobsCompleted: number
  kycVerified: boolean
  accountState: 'active'
  phone?: string
  bio?: string
  skills?: string[]
  languages?: string[]
  preferredPayoutMethod?: string
  country?: string
  zipCode?: string
  bankName?: string
  bankBranch?: string
}

export type WalletData = {
  pendingUsd: number
  availableUsd: number
  payoutNumber: string
}

export type UserDocument = UserProfile & {
  wallet: WalletData
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
