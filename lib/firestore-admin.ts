import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'

// Initialise the Firebase Admin SDK once (singleton pattern for Next.js)
function getAdminApp(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0] as admin.app.App
  }

  const projectId = process.env.FIREBASE_PROJECT_ID

  // 1. Prefer inline JSON (for Render / cloud deployments — set via env var)
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson) as admin.ServiceAccount
      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: (serviceAccount as unknown as { project_id: string }).project_id || projectId,
      })
    } catch (err) {
      console.warn('[Admin] Could not parse FIREBASE_SERVICE_ACCOUNT_JSON:', err)
    }
  }

  // 2. Fall back to file path (for local development)
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
        projectId: (serviceAccount as unknown as { project_id: string }).project_id || projectId,
      })
    } catch (err) {
      console.warn('[Admin] Could not load service account file:', err)
    }
  }

  // 3. Fall back to Application Default Credentials (GCP / Cloud Run)
  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  })
}

/**
 * Updates profile fields on the user's Firestore document using Firebase Admin SDK.
 * Strips undefined values to avoid Firestore errors.
 */
export async function updateUserProfile(
  uid: string,
  fields: Record<string, any>
): Promise<void> {
  try {
    const app = getAdminApp()
    const db = admin.firestore(app)

    // Strip undefined values — Firestore does not accept undefined
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined)
    )

    if (Object.keys(clean).length === 0) return

    const userRef = db.collection('users').doc(uid)
    await userRef.set(clean, { merge: true })
    console.log(`[FirestoreAdmin] Successfully updated user ${uid} profile:`, clean)
  } catch (err) {
    console.error('[FirestoreAdmin] updateUserProfile failed for uid:', uid, err)
  }
}

/**
 * Creates or updates a KYC record in firestore with the session details.
 */
export async function saveKycRecord(
  uid: string,
  sessionId: string,
  sessionToken: string,
  status: string
): Promise<void> {
  try {
    const app = getAdminApp()
    const db = admin.firestore(app)

    const recordRef = db.collection('kyc_records').doc(uid)
    await recordRef.set({
      userId: uid,
      sessionId,
      sessionToken,
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
    console.log(`[FirestoreAdmin] Saved kyc record for uid=${uid}:`, { sessionId, sessionToken, status })
  } catch (err) {
    console.error('[FirestoreAdmin] saveKycRecord failed for uid:', uid, err)
  }
}
