import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'
import type { DiditSessionStatus } from '@/lib/didit'

// ─── Admin SDK initialisation (singleton) ────────────────────────────────────

function getAdminApp(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0] as admin.app.App
  }

  const projectId = process.env.FIREBASE_PROJECT_ID

  // 1. Prefer inline JSON (Render / cloud deployments — set via env var)
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (serviceAccountJson) {
    try {
      // Handle potential Base64 encoding (very robust for Render/Vercel)
      const isBase64 = !serviceAccountJson.trim().startsWith('{')
      const rawString = isBase64
        ? Buffer.from(serviceAccountJson, 'base64').toString('utf8')
        : serviceAccountJson

      // Handle environment variable escaping quirks (e.g., \\n instead of \n)
      const parsedJson = JSON.parse(rawString)
      if (parsedJson.private_key) {
        parsedJson.private_key = parsedJson.private_key.replace(/\\n/g, '\n')
      }

      const serviceAccount = parsedJson as admin.ServiceAccount
      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId:
          (serviceAccount as unknown as { project_id: string }).project_id || projectId,
      })
    } catch (err) {
      console.warn('[Admin] Could not parse FIREBASE_SERVICE_ACCOUNT_JSON. Is it valid JSON or Base64? Error:', err)
    }
  }

  // 2. Fall back to file path (local development)
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  if (serviceAccountPath) {
    try {
      const resolvedPath = path.resolve(
        process.cwd(),
        serviceAccountPath.replace(/^\.\//, ''),
      )
      const raw = fs.readFileSync(resolvedPath, 'utf8')
      const serviceAccount = JSON.parse(raw) as admin.ServiceAccount
      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId:
          (serviceAccount as unknown as { project_id: string }).project_id || projectId,
      })
    } catch (err) {
      console.warn('[Admin] Could not load service account file:', err)
    }
  }

  // If we reach here, neither JSON nor PATH was successfully loaded.
  console.error(
    '[Admin] CRITICAL: FIREBASE_SERVICE_ACCOUNT_JSON is not set or failed to load. ' +
    'Falling back to Application Default Credentials, which will likely crash on Render.',
  )

  // 3. Application Default Credentials (GCP / Cloud Run)
  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  })
}

// ─── Token Verification ───────────────────────────────────────────────────────

/**
 * Verifies a Firebase ID token and returns the decoded claims.
 * Returns null if the token is invalid or expired.
 */
export async function verifyIdToken(
  idToken: string,
): Promise<admin.auth.DecodedIdToken | null> {
  try {
    const app = getAdminApp()
    return await admin.auth(app).verifyIdToken(idToken)
  } catch (err) {
    console.warn('[FirestoreAdmin] verifyIdToken failed:', err)
    return null
  }
}

// ─── User Profile ─────────────────────────────────────────────────────────────

/**
 * Updates profile fields on the user's Firestore document (merge).
 * Strips undefined values to avoid Firestore errors.
 */
export async function updateUserProfile(
  uid: string,
  fields: Record<string, unknown>,
): Promise<void> {
  try {
    const app = getAdminApp()
    const db = admin.firestore(app)

    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    )
    if (Object.keys(clean).length === 0) return

    const userRef = db.collection('users').doc(uid)
    await userRef.set(clean, { merge: true })
    console.log(`[FirestoreAdmin] Updated user ${uid}:`, clean)
  } catch (err) {
    console.error('[FirestoreAdmin] updateUserProfile failed for uid:', uid, err)
  }
}

/**
 * Retrieves a user's Firestore profile document.
 * Returns null if the document does not exist or an error occurs.
 */
export async function getUserProfile(uid: string): Promise<Record<string, unknown> | null> {
  try {
    const app = getAdminApp()
    const db = admin.firestore(app)

    const snap = await db.collection('users').doc(uid).get()
    if (!snap.exists) {
      console.warn(`[FirestoreAdmin] User profile not found for uid=${uid}`)
      return null
    }
    return { id: snap.id, ...snap.data() }
  } catch (err) {
    console.error('[FirestoreAdmin] getUserProfile failed for uid:', uid, err)
    return null
  }
}

// ─── KYC Records ─────────────────────────────────────────────────────────────

/**
 * Shape of a KYC record stored in the `kyc_records` collection.
 *
 * One document per user (uid = doc ID). Tracks the full lifecycle of the most
 * recent KYC attempt plus a running counter of all-time attempts.
 */
export type KycRecord = {
  userId: string
  sessionId: string
  sessionToken: string
  /** Canonical DiditSessionStatus string. */
  status: DiditSessionStatus
  /** Raw status string from Didit (for debugging / auditing). */
  rawStatus?: string
  /** Human-readable reason if declined, on-hold, or resubmission needed. */
  rejectionReason?: string
  /** Which verification sub-checks failed, e.g. ['liveness', 'document']. */
  failedChecks?: string[]
  /** Total number of KYC attempts made by this user. */
  attemptCount?: number
  /** Timestamp of the very first attempt (ISO 8601). */
  firstAttemptAt?: string
  /** Timestamp of the most recent status update (ISO 8601). Set server-side. */
  updatedAt?: admin.firestore.FieldValue
}

/**
 * Creates or updates the KYC record for a user with the latest session details.
 *
 * The document is keyed by uid so there is at most one record per user.
 * `attemptCount` increments atomically only when a brand-new session ID is written.
 */
export async function saveKycRecord(
  uid: string,
  sessionId: string,
  sessionToken: string,
  status: DiditSessionStatus,
  extras?: {
    rawStatus?: string
    rejectionReason?: string
    failedChecks?: string[]
  },
): Promise<void> {
  try {
    const app = getAdminApp()
    const db = admin.firestore(app)
    const recordRef = db.collection('kyc_records').doc(uid)

    // Atomically increment attemptCount when a new session begins
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(recordRef)
      const existing = snap.data() as Partial<KycRecord> | undefined

      // Only bump the attempt counter when the session ID changes
      const isNewSession = !existing?.sessionId || existing.sessionId !== sessionId
      const currentCount = typeof existing?.attemptCount === 'number' ? existing.attemptCount : 0
      const newCount = isNewSession ? currentCount + 1 : currentCount

      const update: Partial<KycRecord> & { updatedAt: admin.firestore.FieldValue; attemptCount: number } = {
        userId: uid,
        sessionId,
        sessionToken,
        status,
        rawStatus: extras?.rawStatus ?? status,
        attemptCount: newCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }

      if (extras?.rejectionReason) update.rejectionReason = extras.rejectionReason
      if (extras?.failedChecks?.length) update.failedChecks = extras.failedChecks

      // Preserve firstAttemptAt across updates
      if (!existing?.firstAttemptAt) {
        (update as Record<string, unknown>).firstAttemptAt = new Date().toISOString()
      }

      // Strip undefined — Firestore doesn't accept it
      const clean = Object.fromEntries(
        Object.entries(update).filter(([, v]) => v !== undefined),
      )
      tx.set(recordRef, clean, { merge: true })
    })

    console.log(`[FirestoreAdmin] KYC record saved for uid=${uid}:`, { sessionId, status })
  } catch (err) {
    console.error('[FirestoreAdmin] saveKycRecord failed for uid:', uid, err)
  }
}

/**
 * Retrieves the KYC record for a user.
 * Returns null if no record exists or an error occurs.
 */
export async function getKycRecord(uid: string): Promise<KycRecord | null> {
  try {
    const app = getAdminApp()
    const db = admin.firestore(app)
    const snap = await db.collection('kyc_records').doc(uid).get()
    if (!snap.exists) return null
    return snap.data() as KycRecord
  } catch (err) {
    console.error('[FirestoreAdmin] getKycRecord failed for uid:', uid, err)
    return null
  }
}