/**
 * Firestore client helpers — user profile & wallet persistence.
 *
 * Every user document lives at: users/{uid}
 * Shape: { name, email, location, memberSince, qualityScore, jobsCompleted, kycVerified, accountState,
 *           wallet: { pendingUsd, availableUsd, payoutNumber } }
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
}

export type WalletData = {
  pendingUsd: number
  availableUsd: number
  payoutNumber: string
}

export type UserDocument = UserProfile & {
  wallet: WalletData
}

/** Initialise (or reuse) the Firestore instance. */
function getDB(): Firestore {
  // Firebase is always initialized by FirebaseAuthProvider before any call here.
  // getApp() retrieves the default app that was already initialized with real config.
  const app = getApps().length ? getApp() : (() => { throw new Error('Firebase not initialized') })()
  return getFirestore(app)
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
  const userRef = doc(db, 'users', uid)

  const userDoc: Omit<UserDocument, 'uid'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
    name,
    email,
    location: '',
    memberSince: currentMonthYear(),
    qualityScore: 100,
    jobsCompleted: 0,
    kycVerified: false,
    accountState: 'active',
    wallet: {
      pendingUsd: 0,
      availableUsd: 0,
      payoutNumber: '',
    },
    createdAt: serverTimestamp(),
  }

  await setDoc(userRef, userDoc, { merge: false })
}

/**
 * Fetches the full user document (profile + wallet) from Firestore.
 * Returns null if the document doesn't exist.
 */
export async function getUserDocument(uid: string): Promise<UserDocument | null> {
  const db = getDB()
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  const data = snap.data() as Omit<UserDocument, 'uid'>
  return { uid, ...data }
}

/**
 * Updates only the wallet sub-object for a user.
 */
export async function updateUserWallet(uid: string, wallet: Partial<WalletData>): Promise<void> {
  const db = getDB()
  const userRef = doc(db, 'users', uid)
  const updates: Record<string, number | string> = {}
  if (wallet.pendingUsd !== undefined) updates['wallet.pendingUsd'] = wallet.pendingUsd
  if (wallet.availableUsd !== undefined) updates['wallet.availableUsd'] = wallet.availableUsd
  if (wallet.payoutNumber !== undefined) updates['wallet.payoutNumber'] = wallet.payoutNumber
  await updateDoc(userRef, updates)
}

/**
 * Updates the user's profile fields.
 */
export async function updateUserProfile(uid: string, fields: Partial<Omit<UserProfile, 'uid'>>): Promise<void> {
  const db = getDB()
  await updateDoc(doc(db, 'users', uid), fields as Record<string, unknown>)
}
