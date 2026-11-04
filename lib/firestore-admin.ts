import { initializeApp, getApps, getApp, cert, applicationDefault, type App, type ServiceAccount } from 'firebase-admin/app'
import {
  getFirestore,
  FieldValue,
  FieldPath,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type DocumentSnapshot,
  type WriteBatch,
  type CollectionReference,
  type DocumentReference,
  type Transaction,
} from 'firebase-admin/firestore'
import { getAuth, type DecodedIdToken, type Auth, type UserInfo } from 'firebase-admin/auth'
import * as fs from 'fs'
import * as path from 'path'
import { isEmailLike, normalizeEmail, sanitizeLine } from '@/lib/security-core'
import {
  PHONE_CLAIMS_COLLECTION,
  UniquenessError,
  assertEmailAvailable,
  assertPhoneAvailable,
  phoneTakenError,
} from '@/lib/account-uniqueness'
import { normalisePhone } from '@/lib/countries'
import {
  adminUserDetailFromDoc,
  adminUserRowFromDoc,
  type AdminUserDetailModel,
  type AdminUserRowModel,
} from '@/lib/admin-domain'
import {
  ADMIN_SEARCH_SCAN_LIMIT,
  applicationMatchesSearch,
  jobMatchesSearch,
  ledgerMatchesSearch,
  normaliseSearch,
  normaliseUserStateFilter,
  paginateSearchResults,
  userMatchesSearch,
  userMatchesState,
  type AdminUserSearchRecord,
} from '@/lib/admin-search'
import { jobHasTraining, assessmentPassMark, type AssessmentQuestion, type TrainingSection, TRAINING_LESSON_KINDS } from '@/lib/afterworks-data'
import { safeImageSrc } from '@/lib/afterworks-data'
import { normaliseAssessmentQuestions, normaliseTrainingSections } from '@/lib/job-catalogue'

// ─── Admin SDK initialisation (singleton) ────────────────────────────────────


function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApp()
  }

  const projectId = process.env.FIREBASE_PROJECT_ID

  const rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (rawEnv) {
    try {
      // 1. Aggressively clean up the string (Render users often accidentally include quotes)
      let cleanStr = rawEnv.trim()
      if ((cleanStr.startsWith("'") && cleanStr.endsWith("'")) || 
          (cleanStr.startsWith('"') && !cleanStr.endsWith('}'))) {
        cleanStr = cleanStr.substring(1, cleanStr.length - 1)
      }

      // 2. Detect Base64 (doesn't start with '{')
      const isBase64 = !cleanStr.trim().startsWith('{')
      
      // 3. Decode or use raw
      const rawJsonString = isBase64
        ? Buffer.from(cleanStr, 'base64').toString('utf8')
        : cleanStr

      // 4. Handle \n escaping quirks
      const parsedJson = JSON.parse(rawJsonString)
      if (parsedJson.private_key) {
        parsedJson.private_key = parsedJson.private_key.replace(/\\n/g, '\n')
      }

      const serviceAccount = parsedJson as ServiceAccount
      return initializeApp({
        credential: cert(serviceAccount),
        projectId: (serviceAccount as unknown as { project_id: string }).project_id || projectId,
      })
    } catch (err) {
      console.warn('[Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON. Error:', err)
      console.warn('[Admin] The value started with:', rawEnv.substring(0, 15) + '...')
    }
  }

  // 2. Fall back to file path (local development)
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  if (serviceAccountPath) {
    try {
      // Local-only fallback: the env var points at a service-account file on disk. Tell
      // Turbopack not to trace this dynamic filesystem access, otherwise it bundles the whole
      // project (including /public) into the server output.
      const resolvedPath = path.resolve(
        /* turbopackIgnore: true */ process.cwd(),
        serviceAccountPath.replace(/^\.\//, ''),
      )
      const raw = fs.readFileSync(resolvedPath, 'utf8')
      const serviceAccount = JSON.parse(raw) as ServiceAccount
      return initializeApp({
        credential: cert(serviceAccount),
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
  return initializeApp({
    credential: applicationDefault(),
    projectId,
  })
}

// ─── Shared accessors ─────────────────────────────────────────────────────────

let adminUsable: boolean | null = null

/**
 * True when the Admin SDK can actually serve reads/writes. Used by the security posture report
 * and by the health endpoint so an operator sees "privileged writes are dead" instead of
 * silently failing buttons.
 */
export function isFirebaseAdminUsable(): boolean {
  if (adminUsable !== null) return adminUsable
  const configured = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
  if (!configured) {
    adminUsable = false
    return adminUsable
  }
  try {
    getAdminApp()
    adminUsable = true
  } catch (err) {
    console.warn('[FirestoreAdmin] Admin SDK unavailable:', err instanceof Error ? err.message : err)
    adminUsable = false
  }
  return adminUsable
}

export function resetAdminUsabilityProbe(): void {
  adminUsable = null
}

/** Admin Firestore handle, or null when the SDK is unavailable (callers must degrade). */
export function getAuthAdmin(): Auth {
  return getAuth(getAdminApp())
}

export function dbOrNull(): Firestore | null {
  try {
    return getFirestore(getAdminApp())
  } catch (err) {
    console.warn('[FirestoreAdmin] Firestore handle unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

export function adminDb(): Firestore {
  const db = dbOrNull()
  if (!db) throw new Error('Firebase Admin SDK is not configured (FIREBASE_SERVICE_ACCOUNT_JSON / _PATH).')
  return db
}

const MAX_AUDIT_DETAIL_BYTES = 6_000

/** Keep audit payloads small and PII-free before they hit the ledger. */
function compactDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details) return {}
  let out = details
  try {
    const serialized = JSON.stringify(details)
    if (serialized.length > MAX_AUDIT_DETAIL_BYTES) {
      out = { truncated: true, preview: serialized.slice(0, MAX_AUDIT_DETAIL_BYTES) }
    }
  } catch {
    out = { unserializable: true }
  }
  return out
}

/**
 * Non-throwing audit write used by the server guard layer. Server-side only: the client can no
 * longer write to `admin_logs` at all (see firestore.rules), so the ledger cannot be poisoned.
 */
export async function createAuditEntry(
  action: string,
  details?: Record<string, unknown>,
  actorEmail?: string,
): Promise<void> {
  const db = dbOrNull()
  if (!db) {
    console.warn(`[audit] Dropped "${action}" — Admin SDK unavailable.`)
    return
  }
  try {
    const logId = `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await db.collection('admin_logs').doc(logId).set({
      id: logId,
      action: String(action).slice(0, 80),
      details: compactDetails(details),
      actorEmail: actorEmail || 'System',
      timestamp: new Date().toISOString(),
      serverWritten: true,
    })
  } catch (err) {
    console.error('[FirestoreAdmin] createAuditEntry failed:', err)
  }
}

// ─── Token Verification ───────────────────────────────────────────────────────

/**
 * Verifies a Firebase ID token and returns the decoded claims.
 * Returns null if the token is invalid or expired.
 */
export async function verifyIdToken(
  idToken: string,
): Promise<DecodedIdToken | null> {
  try {
    const app = getAdminApp()
    return await getAuth(app).verifyIdToken(idToken)
  } catch (err) {
    console.warn('[FirestoreAdmin] verifyIdToken failed:', err)
    return null
  }
}

// ─── User Profile ─────────────────────────────────────────────────────────────

/**
 * Marks the Firebase Auth credential as email-verified and mirrors that onto the profile.
 * Called only after a Resend verification token has been consumed — the client cannot set this.
 */
export async function markEmailVerified(uid: string, email: string): Promise<void> {
  const app = getAdminApp()
  const auth = getAuth(app)
  const rec = await auth.getUser(uid)
  const recEmail = (rec.email || '').trim().toLowerCase()
  const expected = email.trim().toLowerCase()
  if (recEmail && recEmail !== expected) {
    throw new Error('EMAIL_MISMATCH')
  }
  if (!rec.emailVerified) {
    await auth.updateUser(uid, { emailVerified: true })
  }
  const now = new Date().toISOString()
  await updateUserProfile(uid, {
    emailVerified: true,
    emailVerifiedAt: now,
    email: recEmail || expected,
    updatedAt: now,
  })
}

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
    const db = getFirestore(app)

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
    const db = getFirestore(app)

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

// ─── Identity verification requests ─────────────────────────────────────────

/**
 * Marks a member as waiting for a manual identity review.
 *
 * There is no verification provider any more: an owner reviews the member in the admin console and
 * calls `verifyKycAdmin` to approve or reject. This function is the member's half of that exchange,
 * so it only stamps the request — it must never write `kycVerified` or any other privileged field,
 * and the timestamp is what the console's queue is built on.
 *
 * `updateUserProfile` refuses privileged keys, so the write goes through the Admin SDK directly.
 */
export async function requestKycReview(uid: string): Promise<{ requestedAt: string; alreadyRequested: boolean }> {
  const db = adminDb()
  const now = new Date().toISOString()
  const ref = db.collection('users').doc(uid)
  const snap = await ref.get()
  const alreadyRequested = Boolean((snap.data() ?? {}).kycRequestedAt)
  await ref.set(
    {
      kycRequestedAt: now,
      // A member who asks again after a rejection is asking for a fresh look: clear the verdict so
      // the console shows "requested" rather than a stale "declined".
      ...(alreadyRequested ? {} : { kycStatus: 'requested', updatedAt: now }),
    },
    { merge: true },
  )
  // Asking for identity review is a state change like any other, and the audit log is the only
  // record of a member waiting. Without it a queue that nobody worked would look like nobody asked.
  await createAuditEntry('KYC_REVIEW_REQUESTED', { uid, alreadyRequested })
  return { requestedAt: now, alreadyRequested }
}

/**
 * Records a completed Paystack training payment in Firestore using Admin SDK.
 */
export async function recordPaidTrainingAdmin(
  uid: string,
  jobId: string,
): Promise<void> {
  const db = adminDb()
  const userRef = db.collection('users').doc(uid)
  await userRef.set(
    {
      paidTrainings: FieldValue.arrayUnion(jobId),
    },
    { merge: true },
  )
  console.log(`[FirestoreAdmin] Recorded paid training for uid=${uid}, jobId=${jobId}`)
}

// ─── Server Admin Audit Logs ──────────────────────────────────────────────────

/**
 * Creates an immutable admin audit log entry using Firebase Admin SDK.
 * (Server-side only — client writes to `admin_logs` are denied by firestore.rules.)
 */
export async function createAdminAuditLog(
  action: string,
  details?: Record<string, unknown>,
  actorEmail?: string,
): Promise<void> {
  await createAuditEntry(action, details, actorEmail)
}

// ─── Payment Transactions Logging ─────────────────────────────────────────────

export type PaymentTransactionRecord = {
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

/**
 * Records or updates a real Paystack payment transaction in Firestore.
 */
export async function recordPaymentTransactionAdmin(
  txData: Partial<PaymentTransactionRecord> & { reference: string; email: string },
): Promise<void> {
  try {
    const app = getAdminApp()
    const db = getFirestore(app)
    const txId = txData.id || `tx_${txData.reference}`
    const txRef = db.collection('transactions').doc(txId)

    const payload: PaymentTransactionRecord = {
      id: txId,
      reference: txData.reference,
      userId: txData.userId || '',
      email: txData.email,
      amountKes: txData.amountKes || 0,
      amountUsd: txData.amountUsd || Math.round((txData.amountKes || 0) / 130),
      currency: txData.currency || 'KES',
      status: txData.status || 'pending',
      jobId: txData.jobId || '',
      metadata: txData.metadata || {},
      createdAt: txData.createdAt || new Date().toISOString(),
    }

    await txRef.set(payload, { merge: true })
    console.log(`[FirestoreAdmin] Payment transaction recorded for ref=${txData.reference}, status=${txData.status}`)
  } catch (err) {
    console.error('[FirestoreAdmin] recordPaymentTransactionAdmin failed:', err)
  }
}

/**
 * Checks if a user has admin role in Firestore `users` collection.
 */
// `checkUserAdminRoleAdmin` was removed deliberately. It read `users.isAdmin`/`users.role`, a
// mutable profile label, and the sign-in route used it as a console credential. Roles are resolved
// from ADMIN_EMAILS and active admin_accounts entries only (see `resolveAdminRole`).

// ══════════════════════════════════════════════════════════════════════════════
// SERVER-SIDE OPERATIONS (privileged)
//
// Everything below is reachable only from server route handlers. The client SDK can no
// longer write system config, audit logs, roles, KYC verdicts or wallet balances at all —
// firestore.rules denies those collections to browsers, which is what makes "the API route is
// the only way in" a real guarantee rather than a convention.
// ══════════════════════════════════════════════════════════════════════════════

import { invalidateGuardCaches } from '@/lib/guard-cache'
import {
  DEFAULT_MAINTENANCE_CONFIG,
  normaliseMaintenanceConfig,
  primeMaintenanceCache,
  type MaintenanceConfig,
} from '@/lib/maintenance-shared'

// ─── Security settings (session revocation, blocklist) ────────────────────────

export type SecuritySettings = {
  revokedBefore: number
  revokedJtis: string[]
  updatedAt: string | null
  updatedBy: string | null
}

const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  revokedBefore: 0,
  revokedJtis: [],
  updatedAt: null,
  updatedBy: 'System',
}

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const db = dbOrNull()
  if (!db) return DEFAULT_SECURITY_SETTINGS
  try {
    const snap = await db.collection('system').doc('security').get()
    if (!snap.exists) return DEFAULT_SECURITY_SETTINGS
    const data = (snap.data() ?? {}) as Record<string, unknown>
    return {
      revokedBefore: Number(data.revokedBefore ?? 0) || 0,
      revokedJtis: Array.isArray(data.revokedJtis) ? (data.revokedJtis as string[]).slice(0, 100) : [],
      updatedAt: (data.updatedAt as string) ?? null,
      updatedBy: (data.updatedBy as string) ?? null,
    }
  } catch (err) {
    console.warn('[FirestoreAdmin] getSecuritySettings failed:', err)
    return DEFAULT_SECURITY_SETTINGS
  }
}

export async function revokeAllAdminSessions(actorEmail: string): Promise<number> {
  const db = dbOrNull()
  const now = Date.now()
  if (!db) throw new Error('Admin SDK unavailable')
  await db.collection('system').doc('security').set(
    {
      revokedBefore: now,
      revokedJtis: [],
      updatedAt: new Date(now).toISOString(),
      updatedBy: actorEmail,
    },
    { merge: true },
  )
  await createAuditEntry('ADMIN_SESSIONS_REVOKED', { scope: 'all', issuedAfter: new Date(now).toISOString() }, actorEmail)
  return now
}

export async function revokeAdminSession(jti: string, actorEmail: string): Promise<void> {
  const db = dbOrNull()
  if (!db) throw new Error('Admin SDK unavailable')
  const current = await getSecuritySettings()
  const revokedJtis = Array.from(new Set([...current.revokedJtis, jti])).slice(-100)
  await db
    .collection('system')
    .doc('security')
    .set({ revokedJtis, updatedAt: new Date().toISOString(), updatedBy: actorEmail }, { merge: true })
  await endAdminSession(jti, 'revoked', actorEmail).catch(() => {})
  await createAuditEntry('ADMIN_SESSION_REVOKED', { jti }, actorEmail)
}

/**
 * Revoke every console session issued before `now` (the "log out everywhere" lever) with the
 * operator's reason captured for the audit trail. Mirrors `revokeAllAdminSessions` but threads
 * the justification through instead of dropping it.
 */
export async function revokeAllAdminSessionsWithReason(actorEmail: string, reason: string): Promise<number> {
  const now = await revokeAllAdminSessions(actorEmail)
  if (reason) {
    await createAuditEntry(
      'ADMIN_SESSIONS_REVOKE_REASON',
      { scope: 'all', reason: String(reason).slice(0, 400) },
      actorEmail,
    ).catch(() => {})
  }
  return now
}

// ─── Active admin sessions (per-device audit + revocation) ────────────────────
//
// The signed cookie is the only carrier of privilege, but on its own it gives an operator no
// answer to "who is currently inside the console, and from where". We keep a server-only
// `admin_sessions/{jti}` document for every issued session — written exclusively by the Admin
// SDK (firestore.rules denies clients this collection), never containing a secret — so the
// Security Centre can list live sessions and revoke a single device without rotating the
// signing secret or kicking out every other operator.

export type AdminSessionRecord = {
  jti: string
  email: string
  /** Epoch ms — matches the signed token's `iat`/`exp`, so a doc can never outlive its cookie. */
  issuedAt: number
  expiresAt: number
  /** Bumped by the session heartbeat so an abandoned tab visibly goes stale. */
  lastSeenAt: number
  /** FNV digest of the originating IP, not the raw address. */
  ipHash: string
  userAgent: string
  active: boolean
  revoked: boolean
  endedAt: string | null
  endReason: 'logout' | 'revoked' | null
  revokedBy: string | null
}

const ADMIN_SESSIONS_COLLECTION = 'admin_sessions'
/** Drop docs older than this during the periodic sweep so the collection cannot grow forever. */
const SESSION_RETENTION_MS = 30 * 24 * 3600_000

function sessionDoc(db: Firestore, jti: string) {
  return db.collection(ADMIN_SESSIONS_COLLECTION).doc(jti.slice(0, 80))
}

export async function recordAdminSession(input: {
  jti: string
  email: string
  issuedAt: number
  expiresAt: number
  ipHash?: string
  userAgent?: string
}): Promise<void> {
  const db = dbOrNull()
  if (!db || !input.jti) return
  try {
    const now = Date.now()
    await sessionDoc(db, input.jti).set(
      {
        jti: input.jti.slice(0, 80),
        email: input.email.trim().toLowerCase().slice(0, 200),
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        lastSeenAt: now,
        ipHash: String(input.ipHash ?? '').slice(0, 32),
        userAgent: String(input.userAgent ?? '').slice(0, 240),
        active: true,
        revoked: false,
        endedAt: null,
        endReason: null,
        revokedBy: null,
      },
      { merge: true },
    )
    // Opportunistic housekeeping so stale docs never accumulate past the retention window.
    void sweepAdminSessions().catch(() => {})
  } catch (err) {
    console.warn('[FirestoreAdmin] recordAdminSession skipped:', err instanceof Error ? err.message : err)
  }
}

/** Heartbeat: the session probe (GET /api/admin/session) nudges lastSeenAt. Cheap, fire-and-forget. */
export async function touchAdminSession(jti: string): Promise<void> {
  const db = dbOrNull()
  if (!db || !jti) return
  try {
    await sessionDoc(db, jti).set({ lastSeenAt: Date.now(), active: true }, { merge: true })
  } catch {
    /* a missed heartbeat must never break a privileged request */
  }
}

// ─── Console staff accounts (admin_accounts) ─────────────────────────────────
/**
 * Staff credentials for the operations console, kept apart from worker accounts on purpose:
 *
 *  • The main administrator ("owner") is the env roster (ADMIN_EMAILS) and signs in with the
 *    shared master passcode. Owners are never stored here.
 *  • Staff members are documents in this server-only collection: an email, a role and an
 *    individual scrypt passcode hash that only the main admin can set or reset.
 *  • A worker account with the same email is untouched — its Firebase Auth password keeps
 *    working for the worker app. Console access and worker access are different doors with
 *    different keys.
 *
 * Clients can never read or write this collection (firestore.rules denies both); it exists only
 * for the Admin SDK inside /api/admin/* routes.
 */

const ADMIN_ACCOUNTS_COLLECTION = 'admin_accounts'

export type AdminAccountRow = {
  email: string
  role: 'owner' | 'staff'
  status: 'active' | 'disabled'
  /** True when a passcode hash is on file (the hash itself never leaves the server). */
  passcodeSet: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  lastSignInAt: string | null
}

type AdminAccountDoc = {
  email: string
  role: 'owner' | 'staff'
  status: 'active' | 'disabled'
  passcodeHash: string
  createdBy: string
  createdAt: string
  updatedAt: string
  lastSignInAt: string | null
}

function adminAccountRef(db: Firestore, email: string) {
  return db.collection(ADMIN_ACCOUNTS_COLLECTION).doc(email.trim().toLowerCase().slice(0, 200))
}

function mapAdminAccount(id: string, data: Record<string, unknown>): AdminAccountDoc {
  return {
    email: String(data.email ?? id).toLowerCase(),
    role: data.role === 'owner' ? 'owner' : 'staff',
    status: data.status === 'disabled' ? 'disabled' : 'active',
    passcodeHash: String(data.passcodeHash ?? ''),
    createdBy: String(data.createdBy ?? ''),
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    lastSignInAt: typeof data.lastSignInAt === 'string' ? data.lastSignInAt : null,
  }
}

/** Full account document including the hash — server-side login only. */
export async function getAdminAccount(email: string): Promise<AdminAccountDoc | null> {
  const db = dbOrNull()
  if (!db) return null
  try {
    const snap = await adminAccountRef(db, email).get()
    if (!snap.exists) return null
    return mapAdminAccount(snap.id, (snap.data() ?? {}) as Record<string, unknown>)
  } catch (err) {
    console.warn('[FirestoreAdmin] getAdminAccount failed:', err)
    return null
  }
}

/** Console role for an active account, or null when there is no usable staff account. */
export async function getAdminAccountRole(email: string): Promise<'owner' | 'staff' | null> {
  const account = await getAdminAccount(email)
  if (!account || account.status !== 'active' || !account.passcodeHash) return null
  return account.role === 'owner' ? 'owner' : 'staff'
}

export async function listAdminAccounts(): Promise<AdminAccountRow[]> {
  const db = dbOrNull()
  if (!db) return []
  try {
    const snap = await db.collection(ADMIN_ACCOUNTS_COLLECTION).orderBy('createdAt', 'desc').limit(500).get()
    return snap.docs.map((d) => {
      const row = mapAdminAccount(d.id, (d.data() ?? {}) as Record<string, unknown>)
      return {
        email: row.email,
        role: row.role,
        status: row.status,
        passcodeSet: row.passcodeHash.length > 0,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastSignInAt: row.lastSignInAt,
      }
    })
  } catch (err) {
    // No composite index on createdAt yet? Fall back to an unordered read rather than an empty page.
    console.warn('[FirestoreAdmin] listAdminAccounts ordered read failed, retrying unordered:', err)
    try {
      const snap = await db.collection(ADMIN_ACCOUNTS_COLLECTION).limit(500).get()
      return snap.docs.map((d) => {
        const row = mapAdminAccount(d.id, (d.data() ?? {}) as Record<string, unknown>)
        return {
          email: row.email,
          role: row.role,
          status: row.status,
          passcodeSet: row.passcodeHash.length > 0,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          lastSignInAt: row.lastSignInAt,
        }
      })
    } catch (fallbackErr) {
      console.error('[FirestoreAdmin] listAdminAccounts failed:', fallbackErr)
      return []
    }
  }
}

export async function createAdminAccount(input: {
  email: string
  passcodeHash: string
  role?: 'owner' | 'staff'
  createdBy: string
}): Promise<{ email: string }> {
  const db = adminDb()
  const email = input.email.trim().toLowerCase()
  const ref = adminAccountRef(db, email)
  const existing = await ref.get()
  if (existing.exists) throw new Error('That email already has a staff account. Reset its password instead.')
  const now = new Date().toISOString()
  await ref.set({
    email,
    role: input.role === 'owner' ? 'owner' : 'staff',
    status: 'active',
    passcodeHash: input.passcodeHash,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    lastSignInAt: null,
  })
  await createAuditEntry('STAFF_ACCOUNT_CREATED', { email, role: input.role ?? 'staff' }, input.createdBy)
  return { email }
}

/**
 * End every live console session for an address. Used when a credential is rotated or an operator
 * is disabled/removed; without it an already-issued cookie kept working until its TTL expired.
 */
async function revokeAdminSessionsForEmail(email: string, actorEmail: string): Promise<void> {
  const db = dbOrNull()
  if (!db) return
  const clean = email.trim().toLowerCase()
  try {
    const snap = await db.collection(ADMIN_SESSIONS_COLLECTION).where('email', '==', clean).limit(200).get()
    for (const doc of snap.docs) {
      const data = (doc.data() ?? {}) as Record<string, unknown>
      if (data.active === false || data.revoked === true) continue
      await endAdminSession(String(data.jti ?? doc.id), 'revoked', actorEmail)
    }
  } catch (err) {
    // A missing index must not let a disabled account keep working: the role re-resolution on the
    // next request already denies it, and refresh tokens/claims are cleared below.
    console.warn('[FirestoreAdmin] admin-session revocation fell back to role denial:', err instanceof Error ? err.message : err)
  }
}

/**
 * Remove every trace of console authority for an address:
 *  • demote any member profile that was flagged as an admin;
 *  • revoke active console sessions;
 *  • clear the Firebase `admin` claim and every refresh token.
 *
 * This is the offboarding path. `resolveAdminRole` no longer trusts `users.isAdmin`, but a stale
 * custom claim would still be a Firestore superuser if any future rule trusted it, and an existing
 * refresh token would outlive the account deletion.
 */
async function clearAdminAccessForEmail(email: string, actorEmail: string): Promise<void> {
  const clean = email.trim().toLowerCase()
  const db = dbOrNull()
  if (db) {
    try {
      const users = await db.collection('users').where('email', '==', clean).limit(50).get()
      await Promise.all(
        users.docs.map((doc) =>
          doc.ref.set({ isAdmin: false, role: 'user', updatedAt: new Date().toISOString() }, { merge: true }).catch(() => undefined),
        ),
      )
    } catch (err) {
      console.warn('[FirestoreAdmin] admin profile cleanup skipped:', err instanceof Error ? err.message : err)
    }
  }
  await revokeAdminSessionsForEmail(clean, actorEmail)
  const auth = authOrNull()
  if (auth) {
    try {
      const record = await auth.getUserByEmail(clean)
      await auth.setCustomUserClaims(record.uid, { admin: false })
      await auth.revokeRefreshTokens(record.uid)
    } catch (err) {
      // user-not-found is expected when a staff console identity has no Firebase account.
      const message = err instanceof Error ? err.message : ''
      if (!/user-not-found|USER_NOT_FOUND|no user record/i.test(message)) {
        console.warn('[FirestoreAdmin] admin credential cleanup failed:', message)
      }
    }
  }
}

export async function updateAdminAccountPasscode(email: string, passcodeHash: string, actorEmail: string): Promise<void> {
  const db = adminDb()
  const ref = adminAccountRef(db, email)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('No staff account exists for that email.')
  await ref.set({ passcodeHash, updatedAt: new Date().toISOString() }, { merge: true })
  await revokeAdminSessionsForEmail(email.trim().toLowerCase(), actorEmail)
  await createAuditEntry('STAFF_PASSWORD_RESET', { email: email.trim().toLowerCase() }, actorEmail)
}

export async function setAdminAccountStatus(email: string, status: 'active' | 'disabled', actorEmail: string): Promise<void> {
  const db = adminDb()
  const ref = adminAccountRef(db, email)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('No staff account exists for that email.')
  await ref.set({ status, updatedAt: new Date().toISOString() }, { merge: true })
  if (status === 'disabled') await clearAdminAccessForEmail(email.trim().toLowerCase(), actorEmail)
  await createAuditEntry(status === 'active' ? 'STAFF_ACCOUNT_ENABLED' : 'STAFF_ACCOUNT_DISABLED', { email: email.trim().toLowerCase() }, actorEmail)
}

export async function deleteAdminAccount(email: string, actorEmail: string): Promise<void> {
  const db = adminDb()
  const ref = adminAccountRef(db, email)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('No staff account exists for that email.')
  await ref.delete()
  await clearAdminAccessForEmail(email.trim().toLowerCase(), actorEmail)
  await createAuditEntry('STAFF_ACCOUNT_REMOVED', { email: email.trim().toLowerCase() }, actorEmail)
}

/** Login heartbeat for staff accounts — cheap, failure-tolerant. */
export async function touchAdminAccountSignIn(email: string): Promise<void> {
  const db = dbOrNull()
  if (!db) return
  try {
    await adminAccountRef(db, email).set({ lastSignInAt: new Date().toISOString() }, { merge: true })
  } catch {
    /* a missed heartbeat must never fail a sign-in */
  }
}

/** Mark a session ended (sign-out) or revoked. Does not touch the signing secret or other sessions. */
export async function endAdminSession(
  jti: string,
  reason: 'logout' | 'revoked',
  actorEmail?: string,
): Promise<void> {
  const db = dbOrNull()
  if (!db || !jti) return
  try {
    await sessionDoc(db, jti).set(
      {
        active: false,
        revoked: reason === 'revoked',
        endedAt: new Date().toISOString(),
        endReason: reason,
        revokedBy: reason === 'revoked' ? (actorEmail ?? 'operator').slice(0, 200) : null,
      },
      { merge: true },
    )
  } catch (err) {
    console.warn('[FirestoreAdmin] endAdminSession skipped:', err instanceof Error ? err.message : err)
  }
}

/**
 * Live console sessions for the Security Centre. Docs whose cookie has expired (or which were
 * revoked/signed out) are filtered out, because a document only matters while it can still open
 * a door. Stale docs are pruned in the same read.
 */
export async function listActiveAdminSessions(opts: { now?: number; limit?: number } = {}): Promise<AdminSessionRecord[]> {
  const db = dbOrNull()
  if (!db) return []
  const now = opts.now ?? Date.now()
  try {
    const snap = await db.collection(ADMIN_SESSIONS_COLLECTION).orderBy('lastSeenAt', 'desc').limit(Math.min(200, Math.max(10, opts.limit ?? 100))).get()
    const rows: AdminSessionRecord[] = []
    for (const d of snap.docs) {
      const data = (d.data() ?? {}) as Partial<AdminSessionRecord>
      const expiresAt = Number(data.expiresAt ?? 0) || 0
      if (!data.active || data.revoked || expiresAt < now) continue
      rows.push({
        jti: String(data.jti ?? d.id),
        email: String(data.email ?? ''),
        issuedAt: Number(data.issuedAt ?? 0) || 0,
        expiresAt,
        lastSeenAt: Number(data.lastSeenAt ?? 0) || 0,
        ipHash: String(data.ipHash ?? ''),
        userAgent: String(data.userAgent ?? ''),
        active: true,
        revoked: false,
        endedAt: null,
        endReason: null,
        revokedBy: null,
      })
    }
    return rows
  } catch (err) {
    console.warn('[FirestoreAdmin] listActiveAdminSessions fell back to unordered read:', err instanceof Error ? err.message : err)
    try {
      const snap = await db.collection(ADMIN_SESSIONS_COLLECTION).limit(100).get()
      const nowMs = now
      return snap.docs
        .map((d) => d.data() as Partial<AdminSessionRecord>)
        .filter((data) => data.active && !data.revoked && Number(data.expiresAt ?? 0) >= nowMs)
        .sort((a, b) => Number(b.lastSeenAt ?? 0) - Number(a.lastSeenAt ?? 0))
        .map((data) => ({
          jti: String(data.jti ?? ''),
          email: String(data.email ?? ''),
          issuedAt: Number(data.issuedAt ?? 0) || 0,
          expiresAt: Number(data.expiresAt ?? 0) || 0,
          lastSeenAt: Number(data.lastSeenAt ?? 0) || 0,
          ipHash: String(data.ipHash ?? ''),
          userAgent: String(data.userAgent ?? ''),
          active: true,
          revoked: false,
          endedAt: null,
          endReason: null,
          revokedBy: null,
        }))
    } catch (fallbackErr) {
      console.warn('[FirestoreAdmin] listActiveAdminSessions failed:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr)
      return []
    }
  }
}

/** Best-effort pruning of expired/ended docs past the retention window. */
async function sweepAdminSessions(): Promise<void> {
  const db = dbOrNull()
  if (!db) return
  const cutoff = Date.now() - SESSION_RETENTION_MS
  try {
    const snap = await db.collection(ADMIN_SESSIONS_COLLECTION).orderBy('lastSeenAt', 'asc').limit(50).get()
    const batch = db.batch()
    let marked = 0
    for (const d of snap.docs) {
      const data = (d.data() ?? {}) as Partial<AdminSessionRecord>
      const lastSeen = Number(data.lastSeenAt ?? 0) || 0
      const expired = Number(data.expiresAt ?? 0) < Date.now()
      if ((!data.active && lastSeen < cutoff) || (expired && lastSeen < cutoff)) {
        batch.delete(d.ref)
        marked += 1
      }
    }
    if (marked) await batch.commit()
  } catch {
    /* housekeeping is never allowed to surface to a user */
  }
}

// ─── Maintenance mode (authoritative write path) ──────────────────────────────

export async function getMaintenanceConfigServer(): Promise<MaintenanceConfig> {
  const db = dbOrNull()
  if (!db) return DEFAULT_MAINTENANCE_CONFIG
  try {
    const [snap, bypassSnap] = await Promise.all([
      db.collection('system').doc('maintenance').get(),
      db.collection('system').doc('maintenance_bypass').get().catch(() => null),
    ])
    if (!snap.exists) return DEFAULT_MAINTENANCE_CONFIG
    const data = (snap.data() ?? {}) as Record<string, unknown>
    // The bypass list is PII (staff/customer emails). It lives in a server-only document; the
    // public `system/maintenance` document is readable by the edge middleware and must not carry it.
    const privateData = bypassSnap?.exists ? (bypassSnap.data() ?? {}) : {}
    const privateList = privateData.allowedEmails ?? []
    const legacyList = Array.isArray(data.allowedEmails) ? data.allowedEmails : []
    const bypassList = [...new Set([...(Array.isArray(privateList) ? privateList : []), ...legacyList])]
    // One-time migration: older deployments stored the bypass roster in the public document.
    // Remove it from the public copy as soon as any server read sees it, so the migration does not
    // depend on an operator opening the maintenance page.
    if (legacyList.length > 0) {
      const batch = db.batch()
      batch.set(
        db.collection('system').doc('maintenance_bypass'),
        { allowedEmails: bypassList, updatedAt: new Date().toISOString(), updatedBy: 'system:migration' },
        { merge: true },
      )
      batch.set(
        db.collection('system').doc('maintenance'),
        { allowedEmails: FieldValue.delete(), updatedBy: FieldValue.delete() },
        { merge: true },
      )
      await batch.commit().catch((err) => console.warn('[FirestoreAdmin] maintenance bypass migration skipped:', err))
    }
    const config = normaliseMaintenanceConfig({
      ...data,
      allowedEmails: bypassList,
      // The operator email lives only in the private companion; keep it visible to the console
      // without putting it back into the world-readable document.
      ...(typeof privateData.updatedBy === 'string' && privateData.updatedBy
        ? { updatedBy: privateData.updatedBy }
        : {}),
    })
    primeMaintenanceCache(config)
    return config
  } catch (err) {
    console.warn('[FirestoreAdmin] getMaintenanceConfigServer failed:', err)
    return DEFAULT_MAINTENANCE_CONFIG
  }
}

export type MaintenanceWriteResult = {
  config: MaintenanceConfig
  changed: string[]
}

/**
 * Merges a partial operator update into the maintenance document. Field names are whitelisted,
 * values are normalised/clamped, and the middleware cache is primed so the change is visible on
 * the very next request instead of after the TTL — that "save and it's live" behaviour is the
 * whole point of an ops switch.
 */
export async function saveMaintenanceConfigServer(
  patch: Partial<MaintenanceConfig>,
  actorEmail: string,
): Promise<MaintenanceWriteResult> {
  const db = dbOrNull()
  if (!db) throw new Error('Admin SDK unavailable')

  const current = await getMaintenanceConfigServer()
  const allowed: Array<keyof MaintenanceConfig> = [
    'enabled',
    'mode',
    'scope',
    'blockedPaths',
    'title',
    'message',
    'banner',
    'reason',
    'scheduledStart',
    'estimatedEnd',
    'autoResolve',
    'contactEmail',
    'affectedServices',
    'allowedEmails',
    'allowSignIn',
  ]

  const merged: Record<string, unknown> = {}
  const changed: string[] = []
  for (const key of allowed) {
    if (patch[key] === undefined) continue
    merged[key] = patch[key]
    if (JSON.stringify(patch[key]) !== JSON.stringify(current[key])) changed.push(String(key))
  }

  let next = normaliseMaintenanceConfig({
    ...current,
    ...merged,
    version: (current.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmail,
  })

  // Whole-site blackout always takes sign-in down, even if an older saved config had allowSignIn.
  if (next.mode === 'blackout' && next.scope === 'full' && next.allowSignIn) {
    next = { ...next, allowSignIn: false }
    if (!changed.includes('allowSignIn')) changed.push('allowSignIn')
  }

  // Split the public operational document from the private bypass roster. The middleware reads the
  // public one with an unauthenticated REST call, which cannot carry an Admin credential or field
  // masking; anything that should not be public simply never lands in that document.
  // `updatedBy` is an operator email and `allowedEmails` is a roster of member/staff addresses.
  // Neither may land in the world-readable document; both live in the server-only companion.
  const { allowedEmails, updatedBy: _updatedBy, ...publicConfig } = next
  const batch = db.batch()
  batch.set(db.collection('system').doc('maintenance'), publicConfig as unknown as Record<string, unknown>)
  batch.set(db.collection('system').doc('maintenance_bypass'), {
    allowedEmails,
    updatedAt: next.updatedAt,
    updatedBy: actorEmail,
  })
  await batch.commit()
  primeMaintenanceCache(next)

  await createAuditEntry(
    next.enabled ? 'MAINTENANCE_ENABLED' : 'MAINTENANCE_DISABLED',
    {
      mode: next.mode,
      scope: next.scope,
      ...(next.scope === 'sections' ? { blockedPaths: next.blockedPaths } : {}),
      changed,
      title: next.title,
      estimatedEnd: next.estimatedEnd,
      reason: next.reason,
      version: next.version,
    },
    actorEmail,
  )

  return { config: next, changed }
}

// ─── Users: paginated, redacted reads + privileged writes ─────────────────────

/**
 * One directory row. The columns themselves come from `adminUserRowFromDoc` in
 * `lib/admin-domain.ts` — the same projection the console applies to the detail payload, so a
 * document that is missing half its fields (a stub, a legacy row) renders as a blank row instead
 * of throwing `Cannot read properties of undefined` inside the table.
 */
export type AdminUserRow = AdminUserRowModel & {
  /**
   * The account as Firebase Auth sees it. A Firestore profile is what the operator edits; Auth is what
   * actually lets somebody sign in, so the two must be compared, not assumed equal. Absent when the
   * Admin SDK is unusable or the profile has no matching account.
   */
  auth?: AuthAccountState
}

/** What `getUserDetail` hands the console: the row plus the drawer's extra profile fields. */
export type AdminUserDetail = AdminUserDetailModel & Record<string, unknown>

/** Everything the console needs from the Auth record; `null` values mean "Auth has no such account". */
export type AuthAccountState = {
  exists: boolean
  disabled: boolean
  emailVerified: boolean
  createdAt: string | null
  lastSignInAt: string | null
  providers: string[]
  /** Profile exists but the account is gone (or was created without one) — worth telling the operator. */
  orphaned?: boolean
}

/** Directory rows are projected by the shared helper so the table can never see a partial shape. */
function toRow(uid: string, data: Record<string, unknown>): AdminUserRow {
  return adminUserRowFromDoc(uid, data)
}

export type UserPage = {
  rows: AdminUserRow[]
  nextCursor: string | null
  hasMore: boolean
  pageSize: number
  degraded?: string
}

/**
 * Cursor-paginated user list. The admin console used to stream the entire `users` collection
 * into the browser through a live listener (every worker profile, bank field and wallet), which
 * is a privacy problem and a memory/latency problem on the device. This reads one page, projects
 * only what the table shows, and returns masked payout handles.
 */
function userSearchRecord(uid: string, data: Record<string, unknown>): AdminUserSearchRecord {
  const wallet = data.wallet && typeof data.wallet === 'object' ? (data.wallet as Record<string, unknown>) : {}
  return {
    uid,
    name: typeof data.name === 'string' ? data.name : '',
    email: typeof data.email === 'string' ? data.email : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    payoutNumber: typeof wallet.payoutNumber === 'string' ? wallet.payoutNumber : '',
    accountState: typeof data.accountState === 'string' ? data.accountState : '',
    kycVerified: data.kycVerified === true,
    role: typeof data.role === 'string' ? data.role : '',
    isAdmin: data.isAdmin === true,
  }
}

/**
 * Cursor-paginated user list. The admin console used to stream the entire `users` collection
 * into the browser through a live listener (every worker profile, bank field and wallet), which
 * is a privacy problem and a memory/latency problem on the device. This reads one page, projects
 * only what the table shows, and returns masked payout handles.
 *
 * Search and the "KYC pending / restricted / admins" views cannot be expressed as one Firestore
 * equality query (names are free text, and "pending" spans several account states), so those
 * modes scan a bounded window and filter it, then paginate the filtered rows. The cursor is an
 * offset fingerprinted against the query, not a document id from an unfiltered page — the old
 * cursor silently skipped matching members whenever the console was past page one.
 */
export async function listUsersPage(opts: {
  pageSize?: number
  cursor?: string | null
  search?: string
  state?: string
}): Promise<UserPage> {
  const db = dbOrNull()
  if (!db) return { rows: [], nextCursor: null, hasMore: false, pageSize: opts.pageSize ?? 25, degraded: 'Admin SDK unavailable' }

  const pageSize = Math.min(50, Math.max(5, opts.pageSize ?? 25))
  const search = normaliseSearch(opts.search)
  const state = normaliseUserStateFilter(opts.state)
  const scan = Boolean(search) || state === 'kyc_pending' || state === 'restricted' || state === 'admins'

  try {
    if (scan) {
      const snap = await db
        .collection('users')
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(ADMIN_SEARCH_SCAN_LIMIT)
        .get()

      // The scan is bounded. An exact email or uid must still find an account outside that
      // window, so ask Firestore for those directly and merge them into the candidate set.
      const extra = new Map<string, Record<string, unknown>>()
      if (search.includes('@')) {
        try {
          const emailSnap = await db
            .collection('users')
            .where('email', '>=', search)
            .where('email', '<=', `${search}${String.fromCharCode(0xf8ff)}`)
            .limit(25)
            .get()
          for (const doc of emailSnap.docs) extra.set(doc.id, (doc.data() ?? {}) as Record<string, unknown>)
        } catch {
          /* the bounded scan still runs; a missing email index should not fail the page */
        }
      }
      if (!search.includes('@') && search.length >= 2 && !search.includes(' ')) {
        try {
          const nameSnap = await db
            .collection('users')
            .where('name', '>=', search)
            .where('name', '<=', `${search}${String.fromCharCode(0xf8ff)}`)
            .limit(25)
            .get()
          for (const doc of nameSnap.docs) extra.set(doc.id, (doc.data() ?? {}) as Record<string, unknown>)
        } catch {
          /* names are free text; the bounded scan remains the fallback */
        }
      }
      if (/^[A-Za-z0-9_-]{8,128}$/.test(search)) {
        try {
          const byId = await db.collection('users').doc(search).get()
          if (byId.exists) extra.set(byId.id, (byId.data() ?? {}) as Record<string, unknown>)
        } catch {
          /* uid probe is an optimisation, not a requirement */
        }
      }

      const candidates = new Map<string, Record<string, unknown>>()
      for (const [uid, data] of extra) candidates.set(uid, data)
      for (const doc of snap.docs) candidates.set(doc.id, (doc.data() ?? {}) as Record<string, unknown>)
      const matches = [...candidates.entries()]
        .map(([uid, data]) => ({ uid, data }))
        .filter(({ uid, data }) => {
          const record = userSearchRecord(uid, data)
          return userMatchesState(record, state) && userMatchesSearch(record, search)
        })
        .sort((a, b) => a.uid.localeCompare(b.uid))
      const page = paginateSearchResults(matches, {
        scope: `users|${state}|${search}`,
        pageSize,
        cursor: opts.cursor,
      })
      const rows = page.rows.map(({ uid, data }) => toRow(uid, data))
      await attachAuthAccountState(rows)
      const truncated = snap.size >= ADMIN_SEARCH_SCAN_LIMIT
      return {
        rows,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        pageSize,
        ...(truncated
          ? {
              degraded: `Filtered the first ${ADMIN_SEARCH_SCAN_LIMIT.toLocaleString('en-US')} profiles. Refine the search if the member you need is not listed.`,
            }
          : {}),
      }
    }

    let ref: Query = db.collection('users')
    if (state && state !== 'all') {
      ref = ref.where('accountState', '==', state).orderBy(FieldPath.documentId(), 'asc')
    } else {
      ref = ref.orderBy(FieldPath.documentId(), 'asc')
    }
    if (opts.cursor) ref = ref.startAfter(opts.cursor)
    ref = ref.limit(pageSize + 1)

    const snap = await (ref as Query).get()
    const docs = snap.docs.slice(0, pageSize)
    const rows = docs.map((d) => toRow(d.id, (d.data() ?? {}) as Record<string, unknown>))
    await attachAuthAccountState(rows)
    const last = docs[docs.length - 1]

    return {
      rows,
      nextCursor: snap.size > pageSize && last ? last.id : null,
      hasMore: snap.size > pageSize,
      pageSize,
    }
  } catch (err) {
    console.warn('[FirestoreAdmin] listUsersPage degraded:', err)
    // Fallback: plain, index-free page read so the console still works during index roll-out.
    try {
      let ref = db.collection('users').limit(pageSize + 1)
      if (opts.cursor && !scan) ref = ref.startAfter(opts.cursor)
      const snap = await ref.get()
      const docs = snap.docs.slice(0, pageSize)
      const all = docs.map((d) => ({ uid: d.id, data: (d.data() ?? {}) as Record<string, unknown> }))
      if (scan) {
        const page = paginateSearchResults(
          all.filter(({ uid, data }) => {
            const record = userSearchRecord(uid, data)
            return userMatchesState(record, state) && userMatchesSearch(record, search)
          }),
          { scope: `users|${state}|${search}`, pageSize, cursor: opts.cursor },
        )
        return {
          rows: page.rows.map(({ uid, data }) => toRow(uid, data)),
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          pageSize,
          degraded: 'Ordered query fell back to an unindexed read — add the composite indexes in firestore.indexes.json.',
        }
      }
      return {
        rows: all.map(({ uid, data }) => toRow(uid, data)),
        nextCursor: docs.length === pageSize && snap.size > pageSize ? docs[docs.length - 1].id : null,
        hasMore: snap.size > pageSize,
        pageSize,
        degraded: 'Ordered query fell back to an unindexed read — add the composite indexes in firestore.indexes.json.',
      }
    } catch (fallbackErr) {
      console.error('[FirestoreAdmin] listUsersPage failed entirely:', fallbackErr)
      return { rows: [], nextCursor: null, hasMore: false, pageSize, degraded: 'User directory unavailable' }
    }
  }
}

/**
 * Full profile for the admin detail drawer — still server-gated, never streamed.
 *
 * Returned through the same projection as the directory page, then merged with the extra profile
 * fields the drawer shows. Two reasons this matters: the console must be able to open a *stub*
 * document (a `users/{uid}` created by a phone claim, a terms acceptance or an interrupted write,
 * with no name, email or `wallet`) without crashing on `user.wallet.availableUsd`, and the browser
 * must not receive raw document fields we have not described — the stored `wallet.payoutNumber` is
 * a plaintext handle whose masked form is the only thing the drawer needs.
 */
export async function getUserDetail(uid: string): Promise<AdminUserDetail | null> {
  const db = dbOrNull()
  if (!db) return null
  const snap = await db.collection('users').doc(uid).get()
  if (!snap.exists) return null
  // The document id is the identity the console acts on: if the body carries a stale `uid` field,
  // it must not become the uid the drawer's moderation actions are sent with.
  return adminUserDetailFromDoc({ ...(snap.data() ?? {}), uid: snap.id }) as AdminUserDetail
}

const ADMIN_MUTABLE_USER_FIELDS = new Set([
  'name',
  'location',
  'qualityScore',
  'jobsCompleted',
  'kycVerified',
  'accountState',
  'phone',
  'preferredPayoutMethod',
  'wallet',
  'role',
  'isAdmin',
  'kycStatus',
  'kycRejectionReason',
  // The console's "Flag for deletion" action writes these alongside the ban. They used to be
  // silently dropped by this allowlist, so the audit log said "marked deleted" while the profile
  // carried no deletion marker at all.
  'deletedAt',
  'moderationReason',
])

export async function adminUpdateUser(
  uid: string,
  fields: Record<string, unknown>,
  actorEmail: string,
  auditAction = 'ADMIN_USER_UPDATED',
): Promise<{ applied: string[] }> {
  const db = adminDb()
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!ADMIN_MUTABLE_USER_FIELDS.has(key)) continue
    if (value === undefined) continue
    clean[key] = value
  }
  if (Object.keys(clean).length === 0) return { applied: [] }

  clean.updatedAt = new Date().toISOString()
  clean.lastModifiedBy = actorEmail
  await db.collection('users').doc(uid).set(clean, { merge: true })

  await createAuditEntry(auditAction, { uid, fields: Object.keys(clean), values: redactAuditValues(clean) }, actorEmail)
  return { applied: Object.keys(clean) }
}

function redactAuditValues(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    out[k] = /wallet|phone|account|bank/i.test(k) ? '[set]' : v
  }
  return out
}

export async function setUserAdminFlagByUid(uid: string, isAdmin: boolean, actorEmail: string): Promise<boolean> {
  const db = adminDb()
  const userRef = db.collection('users').doc(uid)
  const snap = await userRef.get()
  if (!snap.exists) return false
  const email = String((snap.data() ?? {}).email ?? '').trim().toLowerCase()
  // This flag is a profile label (and a UI hint), not a console credential. Console authority is
  // resolved from ADMIN_EMAILS or an active admin_accounts entry; firestore.rules does not trust
  // any custom claim. Never mint a claim from a mutable profile email here.
  await userRef.set({ isAdmin, role: isAdmin ? 'admin' : 'user', updatedAt: new Date().toISOString() }, { merge: true })
  await createAuditEntry(isAdmin ? 'ADMIN_ROLE_GRANTED' : 'ADMIN_ROLE_REVOKED', { uid, email }, actorEmail)
  return true
}

// ─── Firebase Auth: the account side of the directory ────────────────────────
//
// Firestore holds the profile the operator edits; Firebase Auth holds the credential that actually
// grants access. Console numbers are only "accurate data" when both are consulted: a banned profile
// with a live Auth account can still sign in, a count of `users` documents is not a count of accounts,
// and "active this week" is only knowable from Auth's last-sign-in timestamp.
// Everything here degrades to `null`/`{ ok: false }` when the Admin SDK is not configured, and callers
// say so out loud instead of showing a zero.

function authOrNull(): Auth | null {
  try {
    if (!isFirebaseAdminUsable()) return null
    return getAuth(getAdminApp())
  } catch (err) {
    console.warn('[FirestoreAdmin] Firebase Auth unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

export type AuthAccountSummary = {
  accounts: number
  disabled: number
  emailUnverified: number
  signedIn24h: number
  signedIn7d: number
  /** Accounts whose credential exists but which have no Firestore profile. */
  withoutProfile: number
  passwordAccounts: number
  googleAccounts: number
  /** True when the scan stopped at the safety cap, so the totals are a floor, not the whole set. */
  capped: boolean
  scannedAt: string
}

let authSummaryCache: { at: number; value: AuthAccountSummary } | null = null

/**
 * Scans Auth (max 1 000 per page, capped by AUTH_SCAN_CAP) and cross-checks the profile collection in
 * one pass. Cached, because it is the only "expensive" read in the console and its staleness is measured
 * in minutes, not security decisions.
 */
export async function getAuthAccountSummary(opts: { fresh?: boolean } = {}): Promise<AuthAccountSummary | null> {
  const auth = authOrNull()
  const db = dbOrNull()
  if (!auth || !db) return null

  const ttlMs = Number(process.env.ADMIN_STATS_CACHE_MS ?? 90_000)
  if (!opts.fresh && authSummaryCache && Date.now() - authSummaryCache.at < ttlMs) return authSummaryCache.value

  const cap = Math.max(1_000, Number(process.env.AUTH_SCAN_CAP ?? 5_000) || 5_000)
  const dayMs = 86_400_000
  const since24h = Date.now() - dayMs
  const since7d = Date.now() - 7 * dayMs

  const summary: AuthAccountSummary = {
    accounts: 0,
    disabled: 0,
    emailUnverified: 0,
    signedIn24h: 0,
    signedIn7d: 0,
    withoutProfile: 0,
    passwordAccounts: 0,
    googleAccounts: 0,
    capped: false,
    scannedAt: new Date().toISOString(),
  }

  try {
    // Which uids have profiles? One projected read, not a read per account.
    const profileUids = new Set<string>()
    try {
      const profiles = await db.collection('users').select('uid').limit(cap).get()
      profiles.forEach((d) => profileUids.add(d.id))
    } catch (err) {
      console.warn('[FirestoreAdmin] profile uid projection skipped:', err)
    }

    let page = await auth.listUsers(1_000)
    for (;;) {
      for (const rec of page.users) {
        summary.accounts += 1
        if (rec.disabled) summary.disabled += 1
        if (!rec.emailVerified) summary.emailUnverified += 1
        const created = rec.metadata?.creationTime ? Date.parse(rec.metadata.creationTime) : Number.NaN
        // Auth only reports one timestamp, the most recent sign-in across providers.
        const last = rec.metadata?.lastSignInTime ? Date.parse(rec.metadata.lastSignInTime) : Number.NaN
        if (Number.isFinite(last) && last >= since24h) summary.signedIn24h += 1
        else if (Number.isFinite(last) && last >= since7d) summary.signedIn7d += 1
        const providers = (rec.providerData ?? []).map((p: UserInfo) => p.providerId)
        if (providers.includes('password')) summary.passwordAccounts += 1
        if (providers.includes('google.com')) summary.googleAccounts += 1
        if (!rec.uid || !profileUids.has(rec.uid)) summary.withoutProfile += 1
        void created
        if (summary.accounts >= cap) {
          summary.capped = true
          break
        }
      }
      if (summary.capped || !page.pageToken) break
      page = await auth.listUsers(1_000, page.pageToken)
    }
  } catch (err) {
    console.warn('[FirestoreAdmin] Auth summary failed:', err instanceof Error ? err.message : err)
    return authSummaryCache?.value ?? null
  }

  authSummaryCache = { at: Date.now(), value: summary }
  return summary
}

/** Auth state for a single account, for the detail drawer. */
export async function getAuthAccountStateForUid(uid: string): Promise<AuthAccountState | null> {
  const auth = authOrNull()
  if (!auth) return null
  try {
    const rec = await auth.getUser(uid)
    return {
      exists: true,
      disabled: rec.disabled === true,
      emailVerified: rec.emailVerified === true,
      createdAt: rec.metadata?.creationTime ?? null,
      lastSignInAt: rec.metadata?.lastSignInTime ?? null,
      providers: (rec.providerData ?? []).map((p: UserInfo) => p.providerId),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/USER_NOT_FOUND|no such user/i.test(message)) return { exists: false, disabled: false, emailVerified: false, createdAt: null, lastSignInAt: null, providers: [], orphaned: true }
    return null
  }
}

/** Batch-attaches Auth state to a page of profile rows. Never throws: the table must still render. */
export async function attachAuthAccountState(rows: AdminUserRow[]): Promise<void> {
  const auth = authOrNull()
  if (!auth || rows.length === 0) return
  try {
    const got = await auth.getUsers(rows.map((row) => ({ uid: row.uid })))
    const byUid = new Map<string, (typeof got.users)[number]>(got.users.map((rec) => [rec.uid, rec]))
    for (const row of rows) {
      const rec = byUid.get(row.uid)
      row.auth = rec
        ? {
            exists: true,
            disabled: rec.disabled === true,
            emailVerified: rec.emailVerified === true,
            // Auth holds the address even when the profile document never got one, so a stub
            // profile still shows an email in the console instead of a blank cell.
            ...(rec.email ? { email: rec.email } : {}),
            createdAt: rec.metadata?.creationTime ?? null,
            lastSignInAt: rec.metadata?.lastSignInTime ?? null,
            providers: (rec.providerData ?? []).map((p: UserInfo) => p.providerId),
          }
        : { exists: false, disabled: false, emailVerified: false, createdAt: null, lastSignInAt: null, providers: [], orphaned: true }
    }
  } catch (err) {
    console.warn('[FirestoreAdmin] Auth enrichment skipped:', err instanceof Error ? err.message : err)
  }
}

export type AccountActionResult = { ok: boolean; error?: string; code?: string; note?: string; secret?: string; link?: string }

function isMissingAuthUser(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /user-not-found|uid-not-found|USER_NOT_FOUND/i.test(`${code} ${message}`) || /no user record corresponding/i.test(message)
}

/**
 * Disables or enables the *credential*, not just the profile. `accountState: 'banned'` alone leaves a
 * worker able to sign in and read their data, which is the difference between a moderation and a note.
 */
export async function setAccountEnabled(uid: string, enabled: boolean, actorEmail: string): Promise<AccountActionResult> {
  const auth = authOrNull()
  if (!auth) return { ok: false, error: 'Firebase Auth is not reachable from this server.', code: 'auth_unavailable' }
  try {
    await auth.updateUser(uid, { disabled: !enabled })
  } catch (err) {
    if (isMissingAuthUser(err)) {
      return { ok: false, error: 'No Firebase Auth account for this profile.', code: 'account_missing' }
    }
    return { ok: false, error: 'The account state could not be changed.', code: 'auth_write_failed' }
  }
  await createAuditEntry(enabled ? 'ACCOUNT_ENABLED' : 'ACCOUNT_DISABLED', { uid }, actorEmail)
  invalidateGuardCaches?.(uid)
  return { ok: true, note: enabled ? 'Credential re-enabled; the member can sign in again.' : 'Credential disabled — existing sessions stop working at the next token refresh.' }
}

/**
 * Emergency credential reset. The temporary password is returned once for the operator to relay and is
 * never written to the audit log, the database or a response cache.
 */
export async function setTemporaryPassword(uid: string, actorEmail: string): Promise<AccountActionResult> {
  const auth = authOrNull()
  if (!auth) return { ok: false, error: 'Firebase Auth is not reachable from this server.', code: 'auth_unavailable' }
  const secret = await import('crypto').then((crypto) => crypto.randomBytes(9).toString('base64url'))
  try {
    await auth.updateUser(uid, { password: secret })
    await auth.revokeRefreshTokens(uid)
  } catch (err) {
    if (isMissingAuthUser(err)) {
      return { ok: false, error: 'No Firebase Auth account for this profile.', code: 'account_missing' }
    }
    return { ok: false, error: 'The password could not be reset.', code: 'auth_write_failed' }
  }
  await createAuditEntry('ACCOUNT_PASSWORD_RESET', { uid, actor: actorEmail }, actorEmail)
  return {
    ok: true,
    secret,
    note: 'Show this once, then have the member change it — it is not stored anywhere on the server.',
  }
}

export type PasswordResetTarget = {
  uid: string
  email: string
  name: string
  disabled: boolean
  /** True when the account can sign in with a password (vs. Google-only). */
  hasPassword: boolean
}

/**
 * Looks up the account behind a "Forgot password" request. Returns `null` for unknown addresses —
 * the route must answer identically either way so this never becomes an account-enumeration oracle.
 */
export async function findPasswordResetTarget(email: string): Promise<PasswordResetTarget | null> {
  const auth = authOrNull()
  if (!auth) return null
  const clean = email.trim().toLowerCase()
  try {
    const rec = await auth.getUserByEmail(clean)
    let name = rec.displayName ?? ''
    if (!name) {
      try {
        const profile = await getUserProfile(rec.uid)
        if (typeof profile?.name === 'string') name = profile.name
      } catch {
        /* cosmetic */
      }
    }
    return {
      uid: rec.uid,
      email: (rec.email ?? clean).toLowerCase(),
      name,
      disabled: rec.disabled === true,
      hasPassword: (rec.providerData ?? []).some((p: UserInfo) => p.providerId === 'password'),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/user-not-found|USER_NOT_FOUND|no user record/i.test(message)) return null
    console.warn('[FirestoreAdmin] password reset lookup failed:', message)
    return null
  }
}

/**
 * Sets the password the member chose after proving inbox ownership with the OTP, then revokes every
 * refresh token so a session on a stolen device dies with the old password. A Google-only account
 * gains a password provider as a side effect, which is the intended "I lost access to Google" path.
 */
export async function completePasswordReset(uid: string, newPassword: string): Promise<AccountActionResult> {
  const auth = authOrNull()
  if (!auth) return { ok: false, error: 'Firebase Auth is not reachable from this server.', code: 'auth_unavailable' }
  try {
    await auth.updateUser(uid, { password: newPassword })
    await auth.revokeRefreshTokens(uid)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (/uid-not-found|USER_NOT_FOUND|no such user/i.test(message)) {
      return { ok: false, error: 'That account no longer exists.', code: 'account_missing' }
    }
    if (/invalid-password|WEAK_PASSWORD|at least 6/i.test(message)) {
      return { ok: false, error: 'Firebase rejected that password as too weak.', code: 'weak_password' }
    }
    console.error('[FirestoreAdmin] password reset write failed:', message)
    return { ok: false, error: 'The password could not be updated.', code: 'auth_write_failed' }
  }
  await createAuditEntry('PASSWORD_RESET_COMPLETED', { uid }, 'self-service')
  invalidateGuardCaches?.(uid)
  return { ok: true, note: 'Password updated and every other session signed out.' }
}

/**
 * Operator fallback: mint a Firebase-hosted verification link and hand it to staff. Worker signup
 * does not use this — it sends a Resend email (`POST /api/auth/send-verification`) and this
 * function stays as the "send it from your own channel" lever on the Users page.
 */
export async function issueEmailVerificationLink(email: string, actorEmail: string): Promise<AccountActionResult> {
  const auth = authOrNull()
  if (!auth) return { ok: false, error: 'Firebase Auth is not reachable from this server.', code: 'auth_unavailable' }
  try {
    const link = await auth.generateEmailVerificationLink(email.trim().toLowerCase())
    await createAuditEntry('ACCOUNT_VERIFICATION_LINK_ISSUED', { email: email.trim().toLowerCase() }, actorEmail)
    return { ok: true, link, note: 'Link is valid for one hour. Send it from your own channel.' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (/EMAIL_NOT_FOUND/i.test(message)) return { ok: false, error: 'No account uses that address.', code: 'account_missing' }
    return { ok: false, error: 'A verification link could not be generated for this address.', code: 'auth_write_failed' }
  }
}

// ─── Member onboarding (created by an operator, not by the member) ───────────
//
// The console could moderate, suspend and delete accounts but had no way to *create* one, so
// onboarding somebody who phones support (or who is being migrated from a spreadsheet) meant
// asking them to sign up from a device they may not have — and then a member exists in name only
// until they finish their profile.

export type MemberAccountResult =
  | {
      ok: true
      uid: string
      email: string
      /** Firebase password-setup link — the member chooses their own credential; no password is ever stored. */
      setupLink: string
      /** True when the branded invite email was accepted by the mail transport. */
      inviteSent: boolean
      inviteNote: string
      /** True when the $5 welcome reward waits for either a completed profile or an operator grant. */
      welcomeBonusPending: boolean
    }
  | { ok: false; error: string; code: string }

/**
 * Creates a sign-in credential (email proven, no password yet) plus its profile document, and hands
 * back a one-time link the member uses to choose a password.
 *
 * Deliberate choices:
 *  • no password is generated, stored or emailed — the reset link is a credential the member sets;
 *  • the profile is created in the same inert shape the public sign-up writes (`role: 'user'`,
 *    `kycVerified: false`, empty wallet), because rules and routes both assume it;
 *  • `welcomeBonusPending` records that an operator onboarded this member. The reward is released
 *    either by the member completing their profile or by an operator grant, and only ever once.
 */
export async function createMemberAccount(input: {
  name: string
  email: string
  phone?: string
  location?: string
  country?: string
  /** `defer` keeps the welcome reward for after onboarding; `standard` lets the profile save pay it. */
  welcomeBonus?: 'standard' | 'defer'
  actorEmail: string
}): Promise<MemberAccountResult> {
  const auth = authOrNull()
  if (!auth) return { ok: false, error: 'Firebase Auth is not reachable from this server.', code: 'auth_unavailable' }
  const name = sanitizeLine(input.name, 80)
  const email = normalizeEmail(input.email)
  if (name.length < 3) return { ok: false, error: 'Enter the member’s full name.', code: 'invalid_name' }
  if (!isEmailLike(email)) return { ok: false, error: 'Enter a valid email address.', code: 'invalid_email' }
  // Resolve the number to E.164 *before* the credential exists, so the two checks below have a
  // canonical value to compare. The same helper the member's own profile save uses, which is what
  // makes an operator-created account and a self-registered one land on the same key.
  let phoneResolution: { e164: string; country: string; key: string } | null = null
  const rawPhone = sanitizeLine(input.phone ?? '', 24)
  if (rawPhone) {
    const countryHint = sanitizeLine(input.country ?? 'KE', 8).toUpperCase() || 'KE'
    const resolved = normalisePhone(rawPhone, countryHint)
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, code: 'invalid_phone' }
    }
    try {
      phoneResolution = await assertPhoneAvailable({ raw: rawPhone, country: resolved.country })
    } catch (err) {
      if (err instanceof UniquenessError) return { ok: false, error: err.message, code: err.code }
      throw err
    }
  }
  const phone = phoneResolution?.e164 ?? ''

  // "One email, one account" has two halves. Firebase Auth enforces the first and is the real
  // identity system, so `createUser` refusing with EMAIL_EXISTS below is the real guarantee. This
  // check covers the second: a profile document that exists for an email with no usable
  // credential — left by an interrupted earlier attempt or a data import. Without it, the Auth
  // call would *succeed* and quietly create the second account the rule forbids.
  const db = dbOrNull()
  if (db) {
    try {
      await assertEmailAvailable(email)
    } catch (err) {
      if (err instanceof UniquenessError) return { ok: false, error: err.message, code: err.code }
      return { ok: false, error: 'The datastore is unreachable, so the account was not created.', code: 'storage_unavailable' }
    }
  }

  let uid = ''
  try {
    const user = await auth.createUser({ email, displayName: name, emailVerified: true })
    uid = user.uid
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (/EMAIL_EXISTS/i.test(message)) {
      return { ok: false, error: 'An account already uses that email address.', code: 'email_in_use' }
    }
    return { ok: false, error: 'The sign-in credential could not be created.', code: 'auth_write_failed' }
  }

  if (!db) {
    // Do not leave a credential with no profile behind: the directory would show an orphan.
    await auth.deleteUser(uid).catch(() => {})
    return { ok: false, error: 'The datastore is unreachable, so the account was rolled back.', code: 'storage_unavailable' }
  }

  const now = new Date().toISOString()
  try {
    const profileRef = db.collection('users').doc(uid)
    await db.runTransaction(async (tx) => {
      if (phoneResolution) {
        // Same guard the member's own save uses: the lookup above can be passed by two operators
        // creating an account with one number at the same instant, this cannot.
        const claimRef = db.collection(PHONE_CLAIMS_COLLECTION).doc(phoneResolution.key)
        const claim = await tx.get(claimRef)
        const owner = claim.exists ? String((claim.data() ?? {}).uid ?? '') : ''
        if (owner && owner !== uid) throw phoneTakenError()
        tx.set(claimRef, { uid, key: phoneResolution.key, claimedAt: now }, { merge: true })
      }
      tx.set(
        profileRef,
        {
      uid,
      name,
      email,
      phone,
      ...(phoneResolution ? { phoneKey: phoneResolution.key, phoneCountry: phoneResolution.country } : {}),
      location: sanitizeLine(input.location ?? '', 80),
      country: sanitizeLine(input.country ?? 'Kenya', 60),
      memberSince: new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      qualityScore: 100,
      jobsCompleted: 0,
      kycVerified: false,
      emailVerified: true,
      emailVerifiedAt: now,
      accountState: 'active',
      role: 'user',
      isAdmin: false,
      bio: '',
      skills: [],
      languages: [],
      preferredPayoutMethod: 'M-Pesa',
      bankName: '',
      bankBranch: '',
      bankAccountNumber: '',
      paidTrainings: [],
      wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: phone, payoutHoldUsd: 0 },
      signupBonusGranted: false,
      welcomeBonusPending: input.welcomeBonus === 'defer',
      onboardedBy: input.actorEmail,
      createdAt: now,
      updatedAt: now,
        },
        { merge: false },
      )
    })
  } catch (err) {
    await auth.deleteUser(uid).catch(() => {})
    if (err instanceof UniquenessError) {
      return { ok: false, error: err.message, code: err.code }
    }
    console.error('[FirestoreAdmin] createMemberAccount profile write failed:', err)
    return { ok: false, error: 'The profile document could not be written, so the account was rolled back.', code: 'storage_write_failed' }
  }

  let setupLink = ''
  let inviteNote = 'Send the setup link from your own channel — it is shown once.'
  try {
    const { site } = await import('@/lib/site')
    setupLink = await auth.generatePasswordResetLink(email, {
      url: `${site.url.replace(/\/$/, '')}/sign-in?setup=1`,
      handleCodeInApp: false,
    })
  } catch (err) {
    console.warn('[FirestoreAdmin] setup link generation failed:', err instanceof Error ? err.message : err)
    inviteNote = 'A setup link could not be generated (check Firebase → Authentication → Settings → Authorized domains). The member can still use “Forgot password”.'
  }

  let inviteSent = false
  if (setupLink) {
    try {
      const { sendEmail, accountInviteEmailHtml, accountInviteEmailText } = await import('@/lib/email')
      const result = await sendEmail({
        to: email,
        subject: 'Your AfterWorks account is ready — set your password',
        html: accountInviteEmailHtml({ name, setupUrl: setupLink }),
        text: accountInviteEmailText({ name, setupUrl: setupLink }),
        tag: 'account-invite',
      })
      inviteSent = result.ok
      if (!result.ok) inviteNote = `The invite email was not accepted (${result.code}); share the setup link manually.`
      else inviteNote = 'Invite email sent.'
    } catch (err) {
      console.warn('[FirestoreAdmin] invite email skipped:', err instanceof Error ? err.message : err)
      inviteNote = 'Mail transport unavailable; share the setup link manually.'
    }
  }

  await createAuditEntry(
    'MEMBER_ACCOUNT_CREATED',
    {
      uid,
      email,
      welcomeBonusPending: input.welcomeBonus === 'defer',
      inviteSent,
    },
    input.actorEmail,
  )

  return {
    ok: true,
    uid,
    email,
    setupLink,
    inviteSent,
    inviteNote,
    welcomeBonusPending: input.welcomeBonus === 'defer',
  }
}

/**
 * Hard deletion: the profile, the credential and — importantly — the ability to sign in again with
 * the same account.
 *
 * The previous implementation deleted the profile first, then tried to delete three collections in
 * one unbounded batch. Anything it did not know about (KYC, payout guards, referral rows, payment
 * transactions, admin sessions) survived the "erase", and a single oversized document or missing
 * index aborted the whole batch *after* the profile was already gone. The operator saw a generic
 * note; the database could plausibly look untouched.
 *
 * This version:
 *  - deletes the Firebase Auth credential first, so a failed cleanup cannot leave a live login;
 *  - reads every related row before writing anything, so a query failure aborts with no changes;
 *  - chunks all writes to Firestore's batch limit;
 *  - keeps financial history by default but redacts the personal fields, including payouts and
 *    Paystack transactions (not just wallet ledger rows);
 *  - deletes the profile last, so a partial run is retryable from the console.
 */
export async function hardDeleteAccount(
  uid: string,
  opts: { actorEmail: string; reason: string; eraseLedger?: boolean },
): Promise<AccountActionResult & { removed?: Record<string, number> }> {
  const db = dbOrNull()
  const auth = authOrNull()
  if (!db) return { ok: false, error: 'The datastore is unreachable, so nothing was deleted.', code: 'storage_unavailable' }
  if (!auth) {
    return {
      ok: false,
      error: 'The sign-in service is unreachable, so nothing was deleted. Check the Firebase Admin credentials on this deployment and retry.',
      code: 'auth_unavailable',
    }
  }

  const removed: Record<string, number> = {
    profile: 0,
    applications: 0,
    ledger: 0,
    notifications: 0,
    auth: 0,
    phoneClaims: 0,
    kyc: 0,
    payoutOpen: 0,
    payoutRequests: 0,
    transactions: 0,
    referrals: 0,
    referralCodes: 0,
    emailVerifications: 0,
    adminSessions: 0,
  }

  try {
    const profileRef = db.collection('users').doc(uid)
    const profile = await profileRef.get()
    const profileData = (profile.data() ?? {}) as Record<string, unknown>
    const targetEmail = String(profileData.email ?? '').trim().toLowerCase()
    const phoneKey = String(profileData.phoneKey ?? '').trim()
    const profileReferralCode = String(profileData.referralCode ?? '').trim().toUpperCase()

    // 1. Kill the credential first. If this fails, no Firestore data has been touched and the
    //    operator can fix the credential problem and retry. "user-not-found" is not a failure:
    //    an account can legitimately have a profile and no Auth user (or a previous run may have
    //    removed the credential before failing on data).
    try {
      await auth.deleteUser(uid)
      removed.auth = 1
    } catch (err) {
      const code = String((err as { code?: string }).code ?? '')
      if (code !== 'auth/user-not-found') {
        return {
          ok: false,
          error: `The sign-in credential could not be deleted (${code || 'auth error'}). No profile or data was changed; retry once the sign-in service is healthy.`,
          code: 'auth_delete_failed',
          removed,
        }
      }
    }

    // 2. Read everything before the first write. A missing index or a transient read error must
    //    not leave the account half-erased.
    const [
      apps,
      ledger,
      notes,
      payouts,
      transactions,
      transactionsByEmail,
      verifications,
      referralCodes,
      referralsAsReferrer,
      referralsAsReferred,
      sessions,
      payoutOpenSnap,
      referralSelfSnap,
      referralCodeSelfSnap,
      phoneSnap,
      phoneClaims,
    ] = await Promise.all([
      db.collection('applications').where('workerUid', '==', uid).get(),
      db.collection('wallet_ledger').where('uid', '==', uid).get(),
      db.collection('notifications').where('uid', '==', uid).get(),
      db.collection('payout_requests').where('uid', '==', uid).get(),
      db.collection('transactions').where('userId', '==', uid).get(),
      // Older payment rows were written before `userId` was populated; the address is the
      // remaining stable link, and the account is being deleted, so catch both shapes.
      targetEmail ? db.collection('transactions').where('email', '==', targetEmail).get() : Promise.resolve(null),
      db.collection('email_verifications').where('uid', '==', uid).get(),
      db.collection('referral_codes').where('uid', '==', uid).get(),
      db.collection('referrals').where('referrerUid', '==', uid).get(),
      db.collection('referrals').where('referredUid', '==', uid).get(),
      targetEmail ? db.collection('admin_sessions').where('email', '==', targetEmail).get() : Promise.resolve(null),
      db.collection('payout_open').doc(uid).get(),
      db.collection('referrals').doc(uid).get(),
      profileReferralCode ? db.collection('referral_codes').doc(profileReferralCode).get() : Promise.resolve(null),
      phoneKey ? db.collection('phone_claims').doc(phoneKey).get() : Promise.resolve(null),
      db.collection('phone_claims').where('uid', '==', uid).get(),
    ])

    const redactedAt = new Date().toISOString()
    const financialRedactions = {
      email: '[redacted]',
      name: '[redacted]',
      accountName: '[redacted]',
      accountNumber: '[redacted]',
      bankAccountNumber: '[redacted]',
      bankName: '[redacted]',
      bankBranch: '[redacted]',
      destinationLabel: '[redacted]',
      redactedAt,
      redactedBy: opts.actorEmail,
    }

    // 3. Financial history is evidence, not personal data we need to keep. Delete it when the
    //    operator asked for that; otherwise keep amounts, statuses and references and remove the
    //    fields that identify the member.
    if (opts.eraseLedger) {
      removed.ledger = await deleteRefsInChunks(db, ledger.docs.map((d) => d.ref))
      removed.payoutRequests = await deleteRefsInChunks(db, payouts.docs.map((d) => d.ref))
      removed.transactions = await deleteRefsInChunks(db, [
        ...transactions.docs.map((d) => d.ref),
        ...(transactionsByEmail?.docs.map((d) => d.ref) ?? []),
      ])
    } else {
      removed.ledger = await redactRefsInChunks(db, ledger.docs.map((d) => d.ref), {
        redactedAt,
        redactedBy: opts.actorEmail,
        description: '[redacted]',
        jobTitle: '[redacted]',
        note: '[redacted]',
      })
      removed.payoutRequests = await redactRefsInChunks(db, payouts.docs.map((d) => d.ref), financialRedactions)
      removed.transactions = await redactRefsInChunks(db, [
        ...transactions.docs.map((d) => d.ref),
        ...(transactionsByEmail?.docs.map((d) => d.ref) ?? []),
      ], {
        email: '[redacted]',
        metadata: { redacted: true, redactedAt },
        redactedAt,
        redactedBy: opts.actorEmail,
      })
    }

    // 4. Non-financial rows carry no reconciliation value for a deleted account.
    removed.applications = await deleteRefsInChunks(db, apps.docs.map((d) => d.ref))
    removed.notifications = await deleteRefsInChunks(db, notes.docs.map((d) => d.ref))
    removed.emailVerifications = await deleteRefsInChunks(db, verifications.docs.map((d) => d.ref))
    removed.referralCodes = await deleteRefsInChunks(db, [
      ...referralCodes.docs.map((d) => d.ref),
      // Only remove the code index if it still points at this uid; a stale profile code must not
      // delete a code that now belongs to somebody else.
      ...(referralCodeSelfSnap?.exists && String((referralCodeSelfSnap.data() ?? {}).uid ?? '') === uid
        ? [referralCodeSelfSnap.ref]
        : []),
    ])
    removed.adminSessions = await deleteRefsInChunks(db, sessions?.docs.map((d) => d.ref) ?? [])
    removed.referrals = await deleteRefsInChunks(db, [
      ...referralsAsReferrer.docs.map((d) => d.ref),
      ...referralsAsReferred.docs.map((d) => d.ref),
      ...(referralSelfSnap.exists ? [referralSelfSnap.ref] : []),
    ])
    removed.payoutOpen = await deleteRefsInChunks(db, payoutOpenSnap.exists ? [payoutOpenSnap.ref] : [])
    // Release the phone claim only after the profile is about to go. Without this the number stays
    // owned by a uid that no longer exists and can never be registered again.
    removed.phoneClaims = await deleteRefsInChunks(db, [
      ...phoneClaims.docs.map((d) => d.ref),
      ...(phoneSnap?.exists ? [phoneSnap.ref] : []),
    ])

    // 5. Profile last: if anything above failed, the member still has a profile, so the console
    //    can retry the erase instead of reporting a 404 for a half-deleted account. recursiveDelete
    //    also removes any user subcollections the product adds later.
    if (profile.exists) {
      await db.recursiveDelete(profileRef)
      removed.profile = 1
    }

    invalidateGuardCaches(uid)
    await createAuditEntry(
      'ACCOUNT_HARD_DELETED',
      { uid, removed, eraseLedger: opts.eraseLedger === true, reason: opts.reason.slice(0, 400) },
      opts.actorEmail,
    )
    const note = opts.eraseLedger
      ? `Erased ${removed.profile} profile and ${removed.auth} sign-in credential; financial rows deleted.`
      : `Erased ${removed.profile} profile and ${removed.auth} sign-in credential; financial rows kept with personal fields redacted.`
    return { ok: true, removed, note }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[FirestoreAdmin] hardDeleteAccount failed:', err)
    return {
      ok: false,
      error: `Deletion stopped part-way: ${message.slice(0, 160)}. ${describeRemoved(removed)} Retry from the console or finish it by hand.`,
      code: 'partial_delete',
      removed,
    }
  }
}

/** Firestore's hard limit is 500 writes per batch; 400 leaves room for a retry-safe margin. */
const DELETE_BATCH_SIZE = 400

function uniqueRefs(refs: DocumentReference[]): DocumentReference[] {
  return [...new Map(refs.map((ref) => [ref.path, ref])).values()]
}

async function deleteRefsInChunks(db: Firestore, refs: DocumentReference[]): Promise<number> {
  const unique = uniqueRefs(refs)
  let deleted = 0
  for (let index = 0; index < unique.length; index += DELETE_BATCH_SIZE) {
    const slice = unique.slice(index, index + DELETE_BATCH_SIZE)
    const batch = db.batch()
    for (const ref of slice) batch.delete(ref)
    await batch.commit()
    deleted += slice.length
  }
  return deleted
}

async function redactRefsInChunks(
  db: Firestore,
  refs: DocumentReference[],
  patch: Record<string, unknown>,
): Promise<number> {
  const unique = uniqueRefs(refs)
  let redacted = 0
  for (let index = 0; index < unique.length; index += DELETE_BATCH_SIZE) {
    const slice = unique.slice(index, index + DELETE_BATCH_SIZE)
    const batch = db.batch()
    for (const ref of slice) batch.set(ref, patch, { merge: true })
    await batch.commit()
    redacted += slice.length
  }
  return redacted
}

function describeRemoved(removed: Record<string, number>): string {
  const parts = Object.entries(removed)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}=${count}`)
  return parts.length > 0 ? `Already removed: ${parts.join(', ')}.` : 'Nothing had been removed yet.'
}

// ─── Ledger: earnings, withdrawals and payments in one feed ────────────────────

export type LedgerRow = {
  id: string
  source: 'wallet' | 'payment'
  kind: string
  status: string
  amountUsd: number | null
  amountKes: number | null
  currency: string
  reference: string
  uid: string
  email: string
  label: string
  createdAt: string | null
  clearedAt: string | null
}

export type LedgerPage = {
  rows: LedgerRow[]
  nextCursor: string | null
  hasMore: boolean
  pageSize: number
  totals: { entries: number; paidOutUsd: number; pendingUsd: number; revenueKes: number }
  degraded?: string
}

function asNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * `wallet_ledger` (work credits + withdrawals) and `transactions` (Paystack) are separate collections by
 * design — different lifecycles — but an operator answering "where is my money?" needs them side by side,
 * so they are normalised into one newest-first feed with the same paging shape as the other tables.
 */
export async function listLedgerPage(opts: {
  source?: 'wallet' | 'payment' | 'all'
  kind?: string
  status?: string
  search?: string
  pageSize?: number
  cursor?: string | null
}): Promise<LedgerPage> {
  const db = dbOrNull()
  const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 25))
  if (!db) {
    return {
      rows: [],
      nextCursor: null,
      hasMore: false,
      pageSize,
      totals: { entries: 0, paidOutUsd: 0, pendingUsd: 0, revenueKes: 0 },
      degraded: 'Admin SDK unavailable',
    }
  }
  const search = normaliseSearch(opts.search)
  const source = opts.source ?? 'all'

  const mapRow = (id: string, data: Record<string, unknown>, src: 'wallet' | 'payment'): LedgerRow => ({
    id,
    source: src,
    kind: String(data.kind ?? data.type ?? (src === 'wallet' ? 'earning' : 'payment')),
    status: String(data.status ?? (src === 'payment' ? 'pending' : 'cleared')),
    amountUsd: asNumber(data.amountUsd),
    amountKes: asNumber(data.amountKes ?? data.amount),
    currency: String(data.currency ?? (data.amountKes ? 'KES' : 'USD')),
    reference: String(data.reference ?? data.id ?? id),
    uid: String(data.uid ?? data.userId ?? data.workerUid ?? ''),
    email: String(data.email ?? ''),
    label: String(data.jobTitle ?? data.description ?? data.title ?? (src === 'wallet' ? 'Wallet entry' : 'Paystack charge')),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
    clearedAt: typeof data.clearedAt === 'string' ? data.clearedAt : null,
  })

  const readOne = async (src: 'wallet' | 'payment'): Promise<LedgerRow[]> => {
    const col = db.collection(src === 'wallet' ? 'wallet_ledger' : 'transactions')
    let ref: Query = col.orderBy('createdAt', 'desc')
    if (opts.cursor && src !== 'payment' && !search) ref = ref.startAfter(opts.cursor)
    if (opts.status) ref = ref.where('status', '==', opts.status)
    if (opts.kind) ref = ref.where(src === 'wallet' ? 'kind' : 'type', '==', opts.kind)
    try {
      // A search reads a bounded window across both collections, then filters and pages it.
      // The old code filtered only the current page, so a match one page back disappeared.
      const snap = await ref.limit(search ? ADMIN_SEARCH_SCAN_LIMIT : pageSize + 1).get()
      const rows = snap.docs.map((d) => mapRow(d.id, (d.data() ?? {}) as Record<string, unknown>, src))
      return search ? rows : rows.slice(0, pageSize)
    } catch (err) {
      console.warn(`[FirestoreAdmin] ledger ${src} ordered read failed:`, err instanceof Error ? err.message : err)
      const snap = await col.limit(pageSize + 1).get()
      return snap.docs.map((d) => mapRow(d.id, (d.data() ?? {}) as Record<string, unknown>, src)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    }
  }

  const [wallet, payment] = await Promise.all([source === 'payment' ? Promise.resolve([] as LedgerRow[]) : readOne('wallet'), source === 'wallet' ? Promise.resolve([] as LedgerRow[]) : readOne('payment')])

  let rows = [...wallet, ...payment].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  let degraded: string | undefined
  if (wallet.length && payment.length && source === 'all') degraded = 'Merged feed is capped per collection, so the newest page can interleave out of order at the tail.'

  let nextCursor: string | null = null
  let hasMore = false
  if (search) {
    rows = rows.filter((row) => ledgerMatchesSearch(row, search))
    const page = paginateSearchResults(rows, {
      scope: `ledger|${source}|${opts.status ?? 'all'}|${opts.kind ?? 'all'}|${search}`,
      pageSize,
      cursor: opts.cursor,
    })
    rows = page.rows
    nextCursor = page.nextCursor
    hasMore = page.hasMore
    if (wallet.length >= ADMIN_SEARCH_SCAN_LIMIT || payment.length >= ADMIN_SEARCH_SCAN_LIMIT) {
      degraded = `Searched the most recent ${ADMIN_SEARCH_SCAN_LIMIT.toLocaleString('en-US')} rows per collection. Narrow the query if the movement is not listed.`
    }
  } else {
    nextCursor = rows.length > pageSize && rows[pageSize - 1]?.createdAt ? rows[pageSize - 1].createdAt as string : null
    hasMore = rows.length > pageSize
    rows = rows.slice(0, pageSize)
  }

  let paidOutUsd = 0
  let pendingUsd = 0
  let revenueKes = 0
  let entries = 0
  try {
    const [creditCount, payoutCount, txCount] = await Promise.all([
      safeCount(() => db.collection('wallet_ledger').where('kind', '==', 'earning')),
      safeCount(() => db.collection('wallet_ledger').where('kind', '==', 'withdrawal')),
      safeCount(() => db.collection('transactions').where('status', '==', 'success')),
    ])
    entries = creditCount + payoutCount + txCount
  } catch {
    /* totals stay zero and `degraded` already explains why the feed is short */
  }
  rows.forEach((row) => {
    if (row.source === 'wallet' && row.kind === 'earning' && row.status === 'cleared') paidOutUsd += row.amountUsd ?? 0
    if (row.source === 'wallet' && row.status === 'pending') pendingUsd += row.amountUsd ?? 0
    if (row.source === 'payment' && row.status === 'success') revenueKes += row.amountKes ?? 0
  })

  return {
    rows,
    nextCursor,
    hasMore,
    pageSize,
    totals: {
      entries,
      paidOutUsd: Math.round(paidOutUsd * 100) / 100,
      pendingUsd: Math.round(pendingUsd * 100) / 100,
      revenueKes: Math.round(revenueKes),
    },
    ...(degraded ? { degraded } : {}),
  }
}

export async function verifyKycAdmin(
  uid: string,
  approve: boolean,
  reason: string,
  actorEmail: string,
): Promise<void> {
  const db = adminDb()
  const now = new Date().toISOString()
  const existing = await db.collection('users').doc(uid).get()
  const profile = (existing.data() ?? {}) as Record<string, unknown>
  const currentState = String(profile.accountState ?? 'active')
  // The decision is about identity; the email is about the account. Both go to the address on the
  // profile, and neither is allowed to fail the other.
  const memberEmail = String(profile.email ?? '').trim()
  const memberName = String(profile.name ?? '').trim()
  // Manual KYC approval proves identity; it must not silently lift a suspension or ban that an
  // owner applied. Support can verify the document, but only an owner can restore the account.
  const restricted = currentState === 'suspended' || currentState === 'banned'
  // Deciding on a review retires the request that produced it, so the console's queue empties.
  const retire = { kycRequestedAt: null, updatedAt: now }
  await db.collection('users').doc(uid).set(
    approve
      ? {
          kycVerified: true,
          kycStatus: 'approved',
          ...(restricted ? {} : { accountState: 'active' }),
          kycVerifiedAt: now,
          kycRejectionReason: null,
          kycProvider: 'admin-review',
          ...retire,
        }
      : {
          kycVerified: false,
          kycStatus: 'declined',
          // A review decision about identity must not lift an account restriction. Clearing a
          // suspension/ban is a separate, owner-only moderation action.
          ...(restricted ? {} : { accountState: 'kyc_rejected' }),
          kycRejectedAt: now,
          kycRejectionReason: reason.slice(0, 300),
          ...retire,
        },
    { merge: true },
  )
  await createAuditEntry(approve ? 'KYC_APPROVED' : 'KYC_REJECTED', { uid, reason: approve ? undefined : reason.slice(0, 300) }, actorEmail)
  await notifyUser(uid, {
    title: approve ? 'Identity verified' : 'Verification needs another look',
    body: approve
      ? 'Your AfterWorks identity check is complete. You can now apply for paid jobs.'
      : `Our review team could not verify your document.${reason ? ` Reason: ${reason.slice(0, 200)}` : ''} You can retry from Profile → Verification.`,
    tone: approve ? 'success' : 'warning',
    link: approve ? '/jobs' : '/profile',
  })

  // The member-facing half of a decision that has no provider to deliver it. An approval is the
  // one that has to arrive: it is what tells them paid work, withdrawals and referrals are open,
  // and a member who is not told will assume nothing happened.
  if (approve && memberEmail) {
    try {
      const { sendEmail, isResendConfigured, kycApprovedEmailSubject, kycApprovedEmailText, kycApprovedEmailHtml } = await import('@/lib/email')
      if (isResendConfigured()) {
        const copy = { name: memberName, email: memberEmail, verifiedAt: now }
        const sent = await sendEmail({
          to: memberEmail,
          subject: kycApprovedEmailSubject(),
          html: kycApprovedEmailHtml(copy),
          text: kycApprovedEmailText(copy),
          tag: 'kyc-approved',
        })
        if (!sent.ok) console.warn('[kyc] approval email not sent:', sent.code)
      }
    } catch (err) {
      // The verdict is already written and audited. An email failure must not roll it back or
      // surface to the operator as a failed approval.
      console.warn('[kyc] approval email failed:', err instanceof Error ? err.message : err)
    }
  }
}

// ─── Platform statistics (one cached server read instead of six live listeners) ─

export type PlatformStats = {
  totals: {
    users: number
    kycVerified: number
    /**
     * Members waiting for a review: they asked (kycRequestedAt is set) and nobody has decided yet.
     * A decision clears the timestamp, so this is the live queue rather than a guess.
     */
    kycRequested: number
    /** Everyone who is neither verified nor suspended — not the same thing as the queue above. */
    kycPending: number
    suspended: number
    activeLast7d: number
    activeLast24h: number
    /** From Firebase Auth: the true account count. `null` when the Admin SDK is not configured. */
    accounts: number | null
    accountsDisabled: number | null
    /** Auth accounts with no `users/<uid>` profile — registration that never finished, or a hard delete. */
    accountsWithoutProfile: number | null
  }
  jobs: { open: number; paused: number; closed: number; totalSlots: number; filledSlots: number }
  applications: { total: number; underReview: number; active: number; completed: number; rejected: number }
  money: { liabilityUsd: number; pendingUsd: number; availableUsd: number; revenueKes: number; paidOutKes: number }
  payments: { successful: number; pending: number; failed: number; last7dVolumeKes: number }
  security: { failedLogins24h: number; lockouts: number }
  maintenance: MaintenanceConfig
  generatedAt: string
}

async function safeCount(build: () => Query, fallbackLimit = 500): Promise<number> {
  try {
    // Aggregation count costs one query, not N document reads.
    const snap = await build().count().get()
    return snap.data().count
  } catch {
    const snap = await build().limit(fallbackLimit).get()
    return snap.size
  }
}

async function getRate(): Promise<number> {
  const { getExchangeRateUsdToKes } = await import('./afterworks-data')
  return getExchangeRateUsdToKes()
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const db = dbOrNull()
  const maintenance = await getMaintenanceConfigServer()
  const authSummary = await getAuthAccountSummary()
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()

  if (!db) {
    return {
      totals: {
        users: 0,
        kycVerified: 0,
        kycRequested: 0,
        kycPending: 0,
        suspended: 0,
        activeLast7d: 0,
        // null = "the account directory is not connected", which the console shows instead of a 0.
        accounts: null,
        accountsDisabled: null,
        accountsWithoutProfile: null,
        activeLast24h: 0,
      },
      jobs: { open: 0, paused: 0, closed: 0, totalSlots: 0, filledSlots: 0 },
      applications: { total: 0, underReview: 0, active: 0, completed: 0, rejected: 0 },
      money: { liabilityUsd: 0, pendingUsd: 0, availableUsd: 0, revenueKes: 0, paidOutKes: 0 },
      payments: { successful: 0, pending: 0, failed: 0, last7dVolumeKes: 0 },
      security: { failedLogins24h: 0, lockouts: 0 },
      maintenance,
      generatedAt: new Date().toISOString(),
    }
  }

  const users = db.collection('users')
  const jobsCol = db.collection('jobs')
  const appsCol = db.collection('applications')
  const txCol = db.collection('transactions')
  const logsCol = db.collection('admin_logs')

  const [
    totalUsers,
    verified,
    kycRequested,
    suspended,
    jobsOpen,
    jobsPaused,
    jobsClosed,
    appsTotal,
    appsReview,
    appsCompleted,
    appsRejected,
    txSuccess,
    txPending,
    txFailed,
    failedLogins,
  ] = await Promise.all([
    safeCount(() => users),
    safeCount(() => users.where('kycVerified', '==', true)),
    // The review queue. Approving or rejecting clears kycRequestedAt, so what is left is exactly
    // the members who are waiting — a single-field inequality, so it needs no composite index.
    safeCount(() => users.where('kycRequestedAt', '!=', null)),
    safeCount(() => users.where('accountState', 'in', ['suspended', 'banned'])),
    safeCount(() => jobsCol.where('status', '==', 'open')),
    safeCount(() => jobsCol.where('status', '==', 'paused')),
    safeCount(() => jobsCol.where('status', '==', 'closed')),
    safeCount(() => appsCol),
    safeCount(() => appsCol.where('status', '==', 'under_review')),
    safeCount(() => appsCol.where('status', '==', 'completed')),
    safeCount(() => appsCol.where('status', 'in', ['rejected', 'failed_qa'])),
    safeCount(() => txCol.where('status', '==', 'success')),
    safeCount(() => txCol.where('status', '==', 'pending')),
    safeCount(() => txCol.where('status', '==', 'failed')),
    safeCount(() => logsCol.where('action', '==', 'ADMIN_LOGIN_FAILED')),
  ])

  // Liability needs the actual amounts; bounded + projected read (only two numeric fields).
  let pendingUsd = 0
  let availableUsd = 0
  let revenueKes = 0
  let last7dVolumeKes = 0
  let paidOutKes = 0
  let filledSlots = 0
  let totalSlots = 0
  try {
    const wallets = await users.select('wallet').limit(1000).get()
    wallets.forEach((d) => {
      const w = ((d.data() ?? {}).wallet ?? {}) as Record<string, unknown>
      pendingUsd += Number(w.pendingUsd ?? 0) || 0
      availableUsd += Number(w.availableUsd ?? 0) || 0
    })
  } catch (err) {
    console.warn('[FirestoreAdmin] wallet aggregation skipped:', err)
  }
  try {
    const jobsSnap = await jobsCol.select('status', 'capacity', 'slotsRemaining').limit(200).get()
    jobsSnap.forEach((d) => {
      const data = (d.data() ?? {}) as Record<string, unknown>
      const capacity = Number(data.capacity ?? 0) || 0
      const remaining = Number(data.slotsRemaining ?? 0) || 0
      totalSlots += capacity
      if (data.status === 'open') filledSlots += Math.max(0, capacity - remaining)
    })
  } catch (err) {
    console.warn('[FirestoreAdmin] job slot aggregation skipped:', err)
  }
  try {
    const txSnap = await txCol.where('status', '==', 'success').select('amountKes', 'createdAt', 'type').limit(500).get()
    txSnap.forEach((d) => {
      const data = (d.data() ?? {}) as Record<string, unknown>
      const amount = Number(data.amountKes ?? 0) || 0
      revenueKes += amount
      if (String(data.createdAt ?? '') >= sevenDaysAgo) last7dVolumeKes += amount
    })
  } catch (err) {
    console.warn('[FirestoreAdmin] revenue aggregation skipped:', err)
  }
  try {
    const rate = await getRate()
    const payouts = await db
      .collection('wallet_ledger')
      .where('kind', '==', 'earning')
      .select('amountUsd')
      .limit(1000)
      .get()
    payouts.forEach((d) => {
      // Same rate the wallet endpoint publishes, so the console and the worker never disagree.
      paidOutKes += (Number(((d.data() ?? {}).amountUsd as number) ?? 0) || 0) * rate
    })
  } catch (err) {
    console.warn('[FirestoreAdmin] payout aggregation skipped:', err)
  }

  return {
    totals: {
      users: totalUsers,
      kycVerified: verified,
      kycRequested,
      kycPending: Math.max(0, totalUsers - verified - suspended),
      suspended,
      // From Auth, because "active" means somebody signed in — a `users` document only proves they
      // registered once. Stays 0 (and `accounts` null) when the Admin SDK is not configured.
      activeLast7d: authSummary ? authSummary.signedIn7d + authSummary.signedIn24h : 0,
      accounts: authSummary?.accounts ?? null,
      accountsDisabled: authSummary?.disabled ?? null,
      accountsWithoutProfile: authSummary?.withoutProfile ?? null,
      activeLast24h: authSummary ? authSummary.signedIn24h : 0,
    },
    jobs: { open: jobsOpen, paused: jobsPaused, closed: jobsClosed, totalSlots, filledSlots },
    applications: {
      total: appsTotal,
      underReview: appsReview,
      active: Math.max(0, appsTotal - appsCompleted - appsRejected),
      completed: appsCompleted,
      rejected: appsRejected,
    },
    money: {
      pendingUsd: Math.round(pendingUsd * 100) / 100,
      availableUsd: Math.round(availableUsd * 100) / 100,
      liabilityUsd: Math.round((pendingUsd + availableUsd) * 100) / 100,
      revenueKes: Math.round(revenueKes),
      paidOutKes: Math.round(paidOutKes),
    },
    payments: { successful: txSuccess, pending: txPending, failed: txFailed, last7dVolumeKes: Math.round(last7dVolumeKes) },
    security: { failedLogins24h: failedLogins, lockouts: 0 },
    maintenance,
    generatedAt: new Date().toISOString(),
  }
}

// ─── Jobs catalogue ──────────────────────────────────────────────────────────

const JOB_CATEGORIES = ['Data Entry', 'Transcription', 'Image Labeling', 'Content Review', 'Translation', 'Research'] as const
const JOB_STATUSES = ['open', 'paused', 'closed'] as const

export type AdminJobInput = {
  id?: string
  title: string
  category: string
  description: string
  responsibilities: string[]
  payAmountUsd: number
  estimatedMinutes: number
  capacity: number
  slotsRemaining?: number
  trainingRequired: boolean
  /** Per-job training price in USD (admin-decided). Ignored when training is not required. */
  trainingFeeUsd?: number
  /** Admin-authored training sections workers step through. Empty list → built-in category modules. */
  trainingNotes?: TrainingSection[]
  /** Admin-authored assessment questions. Empty list → built-in category bank. */
  assessmentQuestions?: AssessmentQuestion[]
  requiresVerified: boolean
  status: string
  closesAt?: string
}

/**
 * The only way a job document is ever written, so the bounds here are the real ones — the console's
 * form validation is a convenience. Exported (it is pure and touches no Firestore) so the fee/pay
 * round trip an admin edit performs is covered by `tests/job-catalogue.test.ts`.
 */
export function sanitizeJob(input: AdminJobInput, existing?: Record<string, unknown> | null) {
  const title = String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!title) throw new Error('Job title is required.')
  const capacity = Math.max(1, Math.min(100_000, Math.round(Number(input.capacity) || 0)))
  const requested = Math.round(Number(input.slotsRemaining ?? capacity))
  const slots = Math.max(0, Math.min(capacity, Number.isFinite(requested) ? requested : capacity))

  // Which kind of card the admin is publishing. A training card has modules and a fee; an
  // assessment-only card has neither.
  const trainingRequired = input.trainingRequired === true
  const trainingNotes = Array.isArray(input.trainingNotes) ? input.trainingNotes : []

  // Per-job training price. Only paid-training jobs carry one; when the admin omits it we keep the
  // stored fee (edits that do not touch the fee) or default to the global $10-equivalent.
  // Sub-dollar fees are legal (min $0.0001) and kept at 4 decimal places — a 0.0077 fee is a
  // real price that maps to Paystack's 1 KES test minimum.
  const feeRaw = Number(input.trainingFeeUsd)
  const previousFee = Number(existing?.trainingFeeUsd ?? 0)
  const trainingFeeUsd = trainingRequired
    ? Math.max(0.0001, Math.min(1_000, Math.round(((Number.isFinite(feeRaw) && feeRaw > 0 ? feeRaw : previousFee) || 10) * 10000) / 10000))
    : 0

  // Admin-authored training sections, bounded so a paste cannot balloon the document past
  // Firestore's 1 MiB limit. Empty titles/contents are dropped. An empty list is fine on a training
  // card: the built-in category coursebook is used instead, so the card still has modules.
  const authoredTrainingNotes = trainingNotes
    .map((raw) => {
      const section = (raw ?? {}) as Record<string, unknown>
      const image = safeImageSrc(section.image)
      const imageAlt = String(section.imageAlt ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
      const imageCaption = String(section.imageCaption ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
      const duration = Math.round(Number(section.durationMinutes) || 0)
      // A lesson check is optional, but a half-authored one is dropped: the worker-facing reader
      // only renders a check when it has a question and at least two real options.
      const checkRaw =
        section.check && typeof section.check === 'object'
          ? (section.check as Record<string, unknown>)
          : null
      const checkOptions = (Array.isArray(checkRaw?.options) ? checkRaw.options : [])
        .map((option) => String(option).replace(/\s+/g, ' ').trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 4)
      const checkQuestion = String(checkRaw?.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
      const checkExplanation = String(checkRaw?.explanation ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
      const checkImage = safeImageSrc(checkRaw?.image)
      const checkImageAlt = String(checkRaw?.imageAlt ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
      const check =
        checkRaw && checkQuestion && checkOptions.length >= 2
          ? {
              question: checkQuestion,
              options: checkOptions,
              correctIndex: Math.max(0, Math.min(checkOptions.length - 1, Math.round(Number(checkRaw.correctIndex) || 0))),
              ...(checkExplanation ? { explanation: checkExplanation } : {}),
              ...(checkImage ? { image: checkImage } : {}),
              ...(checkImage && checkImageAlt ? { imageAlt: checkImageAlt } : {}),
            }
          : undefined
      const unit = String(section.unit ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
      const kind = String(section.kind ?? '')
      const objective = String(section.objective ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
      return {
        title: String(section.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
        content: String(section.content ?? '').trim().slice(0, 8_000),
        ...(unit ? { unit } : {}),
        ...(TRAINING_LESSON_KINDS.includes(kind as never) ? { kind: kind as TrainingSection['kind'] } : {}),
        ...(objective ? { objective } : {}),
        ...(image ? { image } : {}),
        ...(image && imageAlt ? { imageAlt } : {}),
        ...(image && imageCaption ? { imageCaption } : {}),
        ...(duration >= 1 && duration <= 120 ? { durationMinutes: duration } : {}),
        ...(check ? { check } : {}),
      }
    })
    .filter((section) => section.title || section.content)
    .slice(0, 40)

  // Admin-authored quiz. Incomplete questions (no text, or fewer than two usable options) are
  // dropped rather than rejected outright — a half-typed row must not brick the whole save.
  const assessmentQuestions = (Array.isArray(input.assessmentQuestions) ? input.assessmentQuestions : [])
    .map((raw) => {
      const question = (raw ?? {}) as Record<string, unknown>
      const options = (Array.isArray(question.options) ? question.options : [])
        .map((option) => String(option).replace(/\s+/g, ' ').trim().slice(0, 400))
        .filter(Boolean)
        .slice(0, 4)
      const correct = Math.max(0, Math.min(options.length - 1, Math.round(Number(question.correctIndex) || 0)))
      const image = safeImageSrc(question.image)
      const imageAlt = String(question.imageAlt ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
      const explanation = String(question.explanation ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)
      return {
        question: String(question.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
        options,
        correctIndex: correct,
        ...(image ? { image } : {}),
        ...(image && imageAlt ? { imageAlt } : {}),
        ...(explanation ? { explanation } : {}),
      }
    })
    .filter((question) => question.question && question.options.length >= 2)
    .slice(0, 50)

  return {
    title,
    category: (JOB_CATEGORIES as readonly string[]).includes(input.category) ? input.category : 'Data Entry',
    description: String(input.description ?? '').trim().slice(0, 4000),
    responsibilities: (Array.isArray(input.responsibilities) ? input.responsibilities : [])
      .map((line) => String(line).replace(/\s+/g, ' ').trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 12),
    payAmountUsd: Math.max(0.5, Math.min(10_000, Math.round(Number(input.payAmountUsd) * 100) / 100 || 0)),
    estimatedMinutes: Math.max(5, Math.min(10_080, Math.round(Number(input.estimatedMinutes) || 60))),
    capacity,
    slotsRemaining: slots,
    trainingRequired,
    trainingFeeUsd,
    trainingNotes: authoredTrainingNotes,
    assessmentQuestions,
    requiresVerified: input.requiresVerified !== false,
    status: (JOB_STATUSES as readonly string[]).includes(input.status) ? input.status : 'open',
    closesAt: input.closesAt || (existing?.closesAt as string) || new Date(Date.now() + 7 * 86400_000).toISOString(),
    // Keep the original publication timestamp across edits; older cards fall back to updatedAt
    // in the public projection, so a JobPosting still gets a truthful datePosted.
    postedAt: (existing?.postedAt as string) || new Date().toISOString(),
    postedAgo: (existing?.postedAgo as string) || 'just now',
    updatedAt: new Date().toISOString(),
  }
}

// ─── Assessments: the answer key never leaves the server ──────────────────────
//
// The catalogue projection deliberately drops `correctIndex` and `explanation`. The browser asks
// for the questions here, submits answers, and only receives the review *after* the server has
// scored them. A pass is written to `users.assessmentPasses` with the Admin SDK, and
// `createApplicationServer` requires that server-written marker.

export type AssessmentSource = {
  jobTitle: string
  category: string
  questions: { id: number; question: string; options: string[]; correctIndex: number; image?: string; imageAlt?: string; explanation?: string }[]
  passMark: number
  authored: boolean
}

export async function getAssessmentSource(jobId: string): Promise<AssessmentSource | null> {
  const db = dbOrNull()
  if (!db) return null
  const snap = await db.collection('jobs').doc(jobId).get()
  if (!snap.exists) return null
  const data = (snap.data() ?? {}) as Record<string, unknown>
  const category = String(data.category ?? 'Data Entry')
  const authoredQuestions = normaliseAssessmentQuestions(data.assessmentQuestions)
  const questions = authoredQuestions.length > 0
    ? authoredQuestions.map((question, index) => ({
        id: index + 1,
        question: question.question,
        options: question.options,
        correctIndex: question.correctIndex,
        ...(question.image ? { image: question.image } : {}),
        ...(question.imageAlt ? { imageAlt: question.imageAlt } : {}),
        ...(question.explanation ? { explanation: question.explanation } : {}),
      }))
    : (await import('@/lib/assessment-bank')).builtInQuestions(category as never)
  return {
    jobTitle: String(data.title ?? 'this job'),
    category,
    questions,
    passMark: assessmentPassMark(questions.length),
    authored: authoredQuestions.length > 0,
  }
}

/** Records a server-scored assessment pass. The client cannot write this field. */
export async function recordAssessmentPass(uid: string, jobId: string): Promise<void> {
  const db = adminDb()
  const ref = db.collection('users').doc(uid)
  const snap = await ref.get()
  if (!snap.exists) throw new TransitionError('Profile not found. Complete your profile before taking the assessment.', 409)
  await ref.set(
    {
      assessmentPasses: FieldValue.arrayUnion(jobId),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  )
}

export async function upsertJob(input: AdminJobInput, actorEmail: string): Promise<{ id: string }> {
  const db = adminDb()
  const slug =
    (input.id && input.id.trim()) ||
    `job-${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 42)}`
  const id = slug.slice(0, 80)

  const ref = db.collection('jobs').doc(id)
  const existingSnap = await ref.get()
  const payload = sanitizeJob(input, existingSnap.exists ? (existingSnap.data() ?? {}) : null)

  await ref.set({ id, ...payload, updatedBy: actorEmail }, { merge: true })
  await createAuditEntry(existingSnap.exists ? 'JOB_UPDATED' : 'JOB_CREATED', { jobId: id, title: payload.title, status: payload.status }, actorEmail)
  return { id }
}

export async function setJobStatus(jobId: string, status: string, actorEmail: string): Promise<void> {
  if (!(JOB_STATUSES as readonly string[]).includes(status)) throw new Error('Unknown job status.')
  const db = adminDb()
  await db.collection('jobs').doc(jobId).set({ status, updatedAt: new Date().toISOString(), updatedBy: actorEmail }, { merge: true })
  await createAuditEntry('JOB_STATUS_CHANGED', { jobId, status }, actorEmail)
}

export async function deleteJob(jobId: string, actorEmail: string): Promise<void> {
  const db = adminDb()
  const openApps = await db.collection('applications').where('jobId', '==', jobId).where('status', 'in', ['under_review', 'approved', 'in_progress']).limit(1).get()
  if (!openApps.empty) {
    throw new Error('This job still has active applications. Pause it instead of deleting.')
  }
  await db.collection('jobs').doc(jobId).delete()
  await createAuditEntry('JOB_DELETED', { jobId }, actorEmail)
}

// ─── Applications: authoritative lifecycle (replaces browser-side state edits) ─

export type ApplicationStatusValue =
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'in_progress'
  | 'submitted_for_review'
  | 'revision_requested'
  | 'completed'
  | 'failed_qa'

const TRANSITIONS: Record<ApplicationStatusValue, ApplicationStatusValue[]> = {
  under_review: ['approved', 'rejected'],
  approved: ['in_progress', 'revision_requested', 'rejected'],
  in_progress: ['submitted_for_review', 'revision_requested', 'rejected'],
  submitted_for_review: ['completed', 'revision_requested', 'failed_qa'],
  revision_requested: ['submitted_for_review', 'in_progress', 'failed_qa'],
  completed: [],
  rejected: [],
  failed_qa: ['revision_requested'],
}

export const APPLICATION_TRANSITIONS = TRANSITIONS

export class TransitionError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message)
    this.name = 'TransitionError'
  }
}

/**
 * Worker-side apply. Everything that gates an application (KYC, account state, slot capacity,
 * duplicate applications) is checked *inside a Firestore transaction* so two devices clicking
 * at once cannot oversubscribe a job or double-credit a worker.
 */
export type CreatedApplication = {
  applicationId: string
  jobTitle: string
  workerEmail: string
  workerName: string
}

export async function createApplicationServer(uid: string, jobId: string): Promise<CreatedApplication> {
  const db = adminDb()
  const [userSnap, jobSnap] = await Promise.all([db.collection('users').doc(uid).get(), db.collection('jobs').doc(jobId).get()])

  const user = (userSnap.data() ?? {}) as Record<string, unknown>
  if (!userSnap.exists) throw new TransitionError('Profile not found. Please complete sign-up first.', 409)
  const state = String(user.accountState ?? 'active')
  if (state === 'suspended') throw new TransitionError('Your account is suspended. Contact support to appeal.', 403)
  if (state === 'banned') throw new TransitionError('This account is not eligible for new applications.', 403)
  if (user.kycVerified !== true) throw new TransitionError('Complete identity verification before applying for paid work.', 403)

  if (!jobSnap.exists) throw new TransitionError('That job is no longer listed.', 404)
  const job = (jobSnap.data() ?? {}) as Record<string, unknown>
  if (job.status !== 'open') throw new TransitionError('This job is no longer open.', 409)
  if (job.requiresVerified !== false && user.kycVerified !== true) throw new TransitionError('This job requires a verified profile.', 403)

  // The assessment used to be a browser-only gate: anyone could POST /api/applications and skip
  // the quiz (or edit the local "passed" flag). Passes are now written by the scoring route and
  // checked here, inside the same authority that already checks KYC and payment.
  const assessmentPasses = Array.isArray(user.assessmentPasses) ? (user.assessmentPasses as string[]) : []
  if (!assessmentPasses.includes(jobId)) {
    throw new TransitionError('Pass the assessment for this job before applying.', 403)
  }

  if (jobHasTraining(job)) {
    let paid = Array.isArray(user.paidTrainings) ? (user.paidTrainings as string[]) : []
    if (!paid.includes(jobId)) {
      // Check if a successful payment transaction exists in Firestore for this user and job
      const txSnap = await db
        .collection('transactions')
        .where('userId', '==', uid)
        .where('jobId', '==', jobId)
        .where('status', '==', 'success')
        .limit(1)
        .get()
        .catch(() => null)

      if (txSnap && !txSnap.empty) {
        // Auto-repair paidTrainings on user profile document
        await db
          .collection('users')
          .doc(uid)
          .set({ paidTrainings: FieldValue.arrayUnion(jobId) }, { merge: true })
          .catch((err) => console.warn('[createApplicationServer] Auto-repair paidTrainings failed:', err))
        paid = [...paid, jobId]
      }
    }
    if (!paid.includes(jobId)) throw new TransitionError('Finish the required training for this job before applying.', 403)
  }
  const closesAt = job.closesAt as string | undefined
  if (closesAt && new Date(closesAt).getTime() < Date.now()) throw new TransitionError('The application window for this job has closed.', 409)

  const applicationId = `app-${uid.slice(-6)}-${Date.now().toString(36)}`
  const now = new Date().toISOString()
  const appRef = db.collection('applications').doc(applicationId)

  await db.runTransaction(async (tx) => {
    const [jobTx, dupTx] = await Promise.all([tx.get(jobSnap.ref), tx.get(appRef)])
    const jobData = (jobTx.data() ?? {}) as Record<string, unknown>
    const slots = Number(jobData.slotsRemaining ?? 0)
    if (jobData.status !== 'open') throw new TransitionError('This job closed while you were applying.', 409)
    if (slots <= 0) throw new TransitionError('All slots for this job are full.', 409)

    const duplicates = await tx.get(
      db.collection('applications').where('jobId', '==', jobId).where('workerUid', '==', uid).limit(1),
    )
    if (!duplicates.empty) throw new TransitionError('You have already applied to this job.', 409)
    void dupTx

    // Slots are reserved on approval (spec 4.3), so applying never blocks other workers.
    tx.set(appRef, {
      id: applicationId,
      jobId,
      jobTitle: jobData.title ?? '',
      workerUid: uid,
      workerEmail: user.email ?? '',
      payAmountUsd: jobData.payAmountUsd ?? 0,
      status: 'under_review',
      appliedAt: now,
      reviewExpiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      history: [{ status: 'under_review', at: now }],
      source: 'api',
    })
  })

  await notifyUser(uid, {
    title: 'Application received',
    body: `We are reviewing your application for “${String(job.title ?? 'this job')}”. Expect a decision within 48 hours.`,
    tone: 'info',
    link: '/applications',
  })

  return {
    applicationId,
    jobTitle: String(job.title ?? ''),
    workerEmail: String(user.email ?? ''),
    workerName: String(user.name ?? ''),
  }
}

export async function withdrawApplicationServer(uid: string, applicationId: string): Promise<void> {
  const db = adminDb()
  const ref = db.collection('applications').doc(applicationId)
  let workerEmail = uid
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new TransitionError('Application not found.', 404)
    const data = (snap.data() ?? {}) as Record<string, unknown>
    if (data.workerUid !== uid) throw new TransitionError('You can only withdraw your own applications.', 403)
    const status = String(data.status)
    if (status !== 'under_review' && status !== 'approved') {
      throw new TransitionError(`Work already ${status.replace(/_/g, ' ')} cannot be withdrawn. Contact support.`, 409)
    }
    workerEmail = String(data.workerEmail ?? uid)
    const jobId = String(data.jobId ?? '')
    // Withdrawing an approved application gives its reserved slot back. Doing that after the status
    // write (or not at all) left the job permanently one worker short.
    const jobRef = status === 'approved' && jobId ? db.collection('jobs').doc(jobId) : null
    const jobSnap = jobRef ? await tx.get(jobRef) : null
    tx.set(
      ref,
      {
        status: 'withdrawn',
        history: FieldValue.arrayUnion({ status: 'withdrawn', at: new Date().toISOString() }),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    )
    if (jobRef && jobSnap?.exists) {
      const job = (jobSnap.data() ?? {}) as Record<string, unknown>
      const capacity = Math.max(1, Number(job.capacity ?? 1) || 1)
      const slots = Math.min(capacity, (Number(job.slotsRemaining ?? 0) || 0) + 1)
      const approved = Math.max(0, (Number(job.applicationsApproved ?? 0) || 0) - 1)
      tx.set(jobRef, { slotsRemaining: slots, applicationsApproved: approved }, { merge: true })
    }
  })
  await createAuditEntry('APPLICATION_WITHDRAWN', { applicationId, uid }, workerEmail)
}

/**
 * Admin QA transition. Completion — the status flip, the pending earning, the worker counters and
 * the `wallet_ledger` entry — runs in one Firestore transaction with a deterministic ledger id, so
 * two operators or a retried request cannot pay twice or leave a completed application uncredited.
 * Non-completion transitions put the application state and the job's slot/approval counters in the
 * same transaction; notifications and the audit row are the only follow-up side effects.
 */
export async function transitionApplicationAdmin(input: {
  applicationId: string
  to: ApplicationStatusValue
  actorEmail: string
  actorUid?: string
  note?: string
  reason?: string
}): Promise<{ status: ApplicationStatusValue; creditedUsd: number }> {
  const db = adminDb()
  const ref = db.collection('applications').doc(input.applicationId)
  const snap = await ref.get()
  if (!snap.exists) throw new TransitionError('Application not found.', 404)

  const app = (snap.data() ?? {}) as Record<string, unknown>
  const from = String(app.status) as ApplicationStatusValue
  const to = input.to

  if (from === to) return { status: to, creditedUsd: 0 }
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new TransitionError(`Cannot move an application from ${from.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}.`, 409)
  }
  if ((to === 'rejected' || to === 'failed_qa' || to === 'revision_requested') && !input.reason && !input.note) {
    throw new TransitionError('A short reason is required so the worker knows what to fix.', 400)
  }

  const now = new Date().toISOString()
  const jobId = String(app.jobId ?? '')
  const uid = String(app.workerUid ?? '')
  const payUsd = Number(app.payAmountUsd ?? 0) || 0
  let creditedUsd = 0
  let appliedFrom = from

  // A console operator may never pay their own submission. The route already restricts the final
  // approval to the owner; this closes the same hole for any future caller of this function.
  const workerEmail = String(app.workerEmail ?? '').trim().toLowerCase()
  if (to === 'completed' && workerEmail && workerEmail === input.actorEmail.trim().toLowerCase()) {
    throw new TransitionError('You cannot approve and pay your own application.', 403)
  }

  const update: Record<string, unknown> = {
    status: to,
    updatedAt: now,
    handledBy: input.actorEmail,
    history: FieldValue.arrayUnion({ status: to, at: now, by: input.actorEmail }),
  }
  if (input.note) update.revisionNote = String(input.note).slice(0, 500)
  if (input.reason) update.rejectionReason = String(input.reason).slice(0, 500)

  if (to === 'completed') {
    const ledgerId = `wd_${input.applicationId}`
    const ledgerRef = db.collection('wallet_ledger').doc(ledgerId)
    const userRef = db.collection('users').doc(uid)
    await db.runTransaction(async (tx) => {
      // Reads first — Firestore transactions require every read before the first write.
      const fresh = await tx.get(ref)
      if (!fresh.exists) throw new TransitionError('Application not found.', 404)
      const freshData = (fresh.data() ?? {}) as Record<string, unknown>
      const current = String(freshData.status ?? '') as ApplicationStatusValue
      appliedFrom = current
      const wasCompleted = current === 'completed'
      if (!wasCompleted && !(TRANSITIONS[current] ?? []).includes('completed')) {
        throw new TransitionError(
          `Cannot move an application from ${current.replace(/_/g, ' ')} to completed.`,
          409,
        )
      }
      const freshUid = String(freshData.workerUid ?? uid)
      const freshPayUsd = Number(freshData.payAmountUsd ?? payUsd) || 0
      const creditsMoney = Boolean(freshUid) && freshPayUsd > 0
      const ledgerSnap = creditsMoney ? await tx.get(ledgerRef) : null
      const userSnap = creditsMoney && !ledgerSnap?.exists ? await tx.get(userRef) : null

      if (!wasCompleted) tx.set(ref, update, { merge: true })
      if (!creditsMoney || ledgerSnap?.exists) {
        creditedUsd = 0 // replay or a zero-value job — never double-pay
        return
      }
      if (!userSnap?.exists) {
        throw new TransitionError('The worker profile is missing, so the earning was not credited.', 409)
      }
      const userData = (userSnap.data() ?? {}) as Record<string, unknown>
      const wallet = (userData.wallet ?? {}) as Record<string, unknown>
      const nextPending = Math.round(((Number(wallet.pendingUsd ?? 0) || 0) + freshPayUsd) * 100) / 100
      tx.set(
        userRef,
        {
          'wallet.pendingUsd': nextPending,
          jobsCompleted: (Number(userData.jobsCompleted ?? 0) || 0) + 1,
          qualityScore: Math.min(100, (Number(userData.qualityScore ?? 100) || 100) + 1),
          updatedAt: now,
        },
        { merge: true },
      )
      // create() (not set) makes the ledger id a hard idempotency key: a concurrent retry that
      // somehow missed the existing read fails the transaction instead of paying twice.
      tx.create(ledgerRef, {
        id: ledgerId,
        uid: freshUid,
        kind: 'earning',
        amountUsd: freshPayUsd,
        currency: 'USD',
        applicationId: input.applicationId,
        jobId,
        status: 'pending',
        clearedAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
        createdAt: now,
        createdBy: input.actorEmail,
      })
      creditedUsd = freshPayUsd
    })
  } else {
    // One transaction for the application state *and* the job counters it changes. Previously the
    // slot increment/decrement happened after the status write, so two operators approving the last
    // slot could both pass the worker-side capacity check and oversubscribe the job, and a failed
    // counter write left the application and the job disagreeing until someone noticed.
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref)
      if (!fresh.exists) throw new TransitionError('Application not found.', 404)
      const freshData = (fresh.data() ?? {}) as Record<string, unknown>
      const current = String(freshData.status ?? '') as ApplicationStatusValue
      appliedFrom = current
      if (current === to) return
      if (!(TRANSITIONS[current] ?? []).includes(to)) {
        throw new TransitionError(
          `Cannot move an application from ${current.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}.`,
          409,
        )
      }
      const jobRef = jobId ? db.collection('jobs').doc(jobId) : null
      const jobSnap = jobRef ? await tx.get(jobRef) : null
      const jobData = (jobSnap?.data() ?? {}) as Record<string, unknown>
      if (to === 'approved' && jobSnap?.exists) {
        const slots = Number(jobData.slotsRemaining)
        if (Number.isFinite(slots) && slots <= 0) {
          throw new TransitionError('This job has no slots remaining, so the application cannot be approved.', 409)
        }
      }
      tx.set(ref, update, { merge: true })
      if (jobRef && jobSnap?.exists) {
        if (to === 'approved') {
          tx.set(
            jobRef,
            { slotsRemaining: FieldValue.increment(-1), applicationsApproved: FieldValue.increment(1) },
            { merge: true },
          )
        } else if (
          (to === 'rejected' || to === 'failed_qa') &&
          ['approved', 'in_progress', 'submitted_for_review', 'revision_requested'].includes(current)
        ) {
          // The slot was reserved when the application was approved; releasing it here and in the
          // same transaction means a failed QA can never leave the job permanently short a slot.
          tx.set(jobRef, { slotsRemaining: FieldValue.increment(1) }, { merge: true })
        }
      }
    })
  }

  if (uid) {
    const copy: Record<string, { title: string; body: string; tone: 'success' | 'info' | 'warning' | 'danger'; link: string }> = {
      approved: { title: 'Application approved', body: 'You have been accepted for this job. Start the work whenever you are ready — your slot is reserved.', tone: 'success', link: '/applications' },
      rejected: { title: 'Application not selected', body: `This time we went with other workers.${input.reason ? ` Note: ${String(input.reason).slice(0, 180)}` : ''}`, tone: 'warning', link: '/jobs' },
      completed: { title: 'Work approved — payment issued', body: `${payUsd.toFixed(2)} USD is now in your pending balance and clears within 72 hours.`, tone: 'success', link: '/profile' },
      revision_requested: { title: 'Revision requested', body: `${input.note ? String(input.note).slice(0, 180) : 'A few items need fixing.'} Resubmit from the Applications page.`, tone: 'warning', link: '/applications' },
      failed_qa: { title: 'Submission failed QA', body: input.reason ? String(input.reason).slice(0, 180) : 'The submission did not meet the quality bar.', tone: 'danger', link: '/applications' },
      in_progress: { title: 'Work window opened', body: 'Your submission window is open. Upload your work before the deadline.', tone: 'info', link: '/applications' },
    }
    const message = copy[to]
    if (message) await notifyUser(uid, message)
  }

  await createAuditEntry(
    'APPLICATION_STATUS_CHANGED',
    { applicationId: input.applicationId, from: appliedFrom, to, jobId, creditedUsd, reason: input.reason?.slice(0, 200) },
    input.actorEmail,
  )

  return { status: to, creditedUsd }
}

// ─── Worker notifications (real in-app inbox, owner-scoped) ────────────────────

export type NotificationInput = {
  title: string
  body: string
  tone?: 'success' | 'info' | 'warning' | 'danger'
  link?: string
}

export async function notifyUser(uid: string, input: NotificationInput): Promise<void> {
  const db = dbOrNull()
  if (!db) return
  try {
    const id = `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    await db.collection('notifications').doc(id).set({
      id,
      uid,
      title: String(input.title ?? '').slice(0, 90),
      body: String(input.body ?? '').slice(0, 500),
      tone: input.tone ?? 'info',
      link: input.link ? String(input.link).slice(0, 120) : '',
      read: false,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[FirestoreAdmin] notifyUser skipped:', err instanceof Error ? err.message : err)
  }
}

// ─── Audit log reads ───────────────────────────────────────────────────────────

/**
 * Reads the console's audit ledger, newest first.
 *
 * The filtered read (`action ==` + `orderBy timestamp desc`) needs the composite index declared in
 * `firestore.indexes.json` (admin_logs: action ASC, timestamp DESC). An index that is declared but
 * never deployed (`npm run deploy:indexes`) fails the whole query with FAILED_PRECONDITION, and the
 * old fallback then read `limit` documents with **no ordering at all** — an arbitrary, usually the
 * oldest, slice of the ledger, presented as if it were the log. An operator auditing an incident
 * reads the wrong rows and trusts them. The fallback now scans a bounded window, sorts it here, and
 * returns `degraded` so the console says the view is approximate instead of pretending it is not.
 */
export async function listAuditLogs(
  opts: { limit?: number; action?: string; search?: string } = {},
): Promise<{ rows: AdminAuditRow[]; degraded?: string }> {
  const db = dbOrNull()
  if (!db) return { rows: [] }
  const size = Math.min(200, Math.max(10, opts.limit ?? 60))
  const search = normaliseSearch(opts.search)
  try {
    let q: Query = db.collection('admin_logs')
    if (opts.action && opts.action !== 'all') q = q.where('action', '==', opts.action)
    // Search inspects a wider window than the table displays, otherwise a match older than the
    // current page reads as "no results".
    q = q.orderBy('timestamp', 'desc').limit(search ? ADMIN_SEARCH_SCAN_LIMIT : size)
    const snap = await q.get()
    let rows = snap.docs.map((d) => d.data() as AdminAuditRow)
    if (search) {
      rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search)).slice(0, size)
    }
    return { rows }
  } catch (err) {
    console.warn('[FirestoreAdmin] listAuditLogs fell back to a bounded scan (composite index missing?):', err)
    const scanLimit = Math.min(1_000, Math.max(ADMIN_SEARCH_SCAN_LIMIT, size * 5))
    const snap = await db.collection('admin_logs').limit(scanLimit).get()
    let rows = snap.docs.map((d) => d.data() as AdminAuditRow)
    // Firestore cannot merge single-field indexes, so the ordering has to happen here — and a
    // bounded scan can only see the window it read, which is why the caller is told it is
    // approximate rather than being handed a confident, wrong answer.
    rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    rows = search
      ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(search)).slice(0, size)
      : rows.slice(0, size)
    return {
      rows,
      degraded:
        'This view is an approximate scan: the admin_logs composite index (action + timestamp) is not deployed on this project, so the newest entries may be missing. Deploy it with `npm run deploy:indexes`.',
    }
  }
}

export type AdminAuditRow = {
  id: string
  action: string
  details?: Record<string, unknown>
  actorEmail?: string
  timestamp: string
  serverWritten?: boolean
}

// ─── Paged reads for the console ──────────────────────────────────────────────

export type ApplicationRow = {
  id: string
  jobId: string
  jobTitle: string
  workerUid: string
  workerEmail: string
  status: string
  payAmountUsd: number
  appliedAt: string
  updatedAt?: string
  reviewExpiresAt?: string
  rejectionReason?: string
  revisionNote?: string
  handledBy?: string
  history: { status: string; at: string; by?: string }[]
  overdue: boolean
}

export type ApplicationPage = {
  rows: ApplicationRow[]
  nextCursor: string | null
  hasMore: boolean
  pageSize: number
  degraded?: string
}

export async function listApplicationsPage(opts: {
  pageSize?: number
  cursor?: string | null
  status?: string
  search?: string
}): Promise<ApplicationPage> {
  const db = dbOrNull()
  const pageSize = Math.min(50, Math.max(5, opts.pageSize ?? 25))
  if (!db) return { rows: [], nextCursor: null, hasMore: false, pageSize, degraded: 'Admin SDK unavailable' }

  const nowIso = new Date().toISOString()
  const search = normaliseSearch(opts.search)
  const status = (opts.status ?? 'all').trim()
  const mapDoc = (d: QueryDocumentSnapshot): ApplicationRow => {
    const data = (d.data() ?? {}) as Record<string, unknown>
    const reviewExpiresAt = (data.reviewExpiresAt as string) ?? undefined
    return {
      id: d.id,
      jobId: String(data.jobId ?? ''),
      jobTitle: String(data.jobTitle ?? ''),
      workerUid: String(data.workerUid ?? ''),
      workerEmail: String(data.workerEmail ?? ''),
      status: String(data.status ?? 'under_review'),
      payAmountUsd: Number(data.payAmountUsd ?? 0) || 0,
      appliedAt: String(data.appliedAt ?? ''),
      updatedAt: (data.updatedAt as string) ?? undefined,
      reviewExpiresAt,
      rejectionReason: (data.rejectionReason as string) ?? undefined,
      revisionNote: (data.revisionNote as string) ?? undefined,
      handledBy: (data.handledBy as string) ?? undefined,
      history: Array.isArray(data.history) ? (data.history as ApplicationRow['history']) : [],
      overdue: Boolean(reviewExpiresAt && String(data.status) === 'under_review' && reviewExpiresAt < nowIso),
    }
  }

  try {
    // A free-text search cannot be asked of Firestore as one equality. Scan a bounded window of
    // the status queue, keep only real matches, then page the filtered rows with an offset cursor.
    // Filtering after `limit(pageSize)` — the old behaviour — made a match on page three invisible.
    if (search) {
      let scanQuery: Query = db.collection('applications')
      if (status && status !== 'all') scanQuery = scanQuery.where('status', '==', status)
      scanQuery = scanQuery.orderBy(FieldPath.documentId(), 'desc').limit(ADMIN_SEARCH_SCAN_LIMIT)
      const snap = await scanQuery.get()
      const matches = snap.docs.map(mapDoc).filter((row) => applicationMatchesSearch(row, search))
      const page = paginateSearchResults(matches, {
        scope: `applications|${status}|${search}`,
        pageSize,
        cursor: opts.cursor,
      })
      const truncated = snap.size >= ADMIN_SEARCH_SCAN_LIMIT
      return {
        rows: page.rows,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        pageSize,
        ...(truncated
          ? {
              degraded: `Searched the first ${ADMIN_SEARCH_SCAN_LIMIT.toLocaleString('en-US')} applications in this status. Narrow the query if the row is not listed.`,
            }
          : {}),
      }
    }

    let q: Query = db.collection('applications')
    if (status && status !== 'all') q = q.where('status', '==', status)
    q = q.orderBy(FieldPath.documentId(), 'desc').limit(pageSize + 1)
    if (opts.cursor) q = q.startAfter(opts.cursor)
    const snap = await q.get()
    return {
      rows: snap.docs.slice(0, pageSize).map(mapDoc),
      nextCursor: snap.size > pageSize ? snap.docs[Math.min(pageSize, snap.size - 1)].id : null,
      hasMore: snap.size > pageSize,
      pageSize,
    }
  } catch (err) {
    console.warn('[FirestoreAdmin] listApplicationsPage degraded:', err)
    try {
      const scanLimit = search ? ADMIN_SEARCH_SCAN_LIMIT : pageSize + 1
      const snap = await db.collection('applications').limit(scanLimit).get()
      if (search) {
        const page = paginateSearchResults(
          snap.docs.map(mapDoc).filter((row) => applicationMatchesSearch(row, search)),
          { scope: `applications|${status}|${search}`, pageSize, cursor: opts.cursor },
        )
        return {
          rows: page.rows,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          pageSize,
          degraded: 'Unordered fallback read.',
        }
      }
      const rows = snap.docs.slice(0, pageSize).map(mapDoc)
      return { rows, nextCursor: null, hasMore: snap.size > pageSize, pageSize, degraded: 'Unordered fallback read.' }
    } catch (fallbackErr) {
      console.error('[FirestoreAdmin] listApplicationsPage failed:', fallbackErr)
      return { rows: [], nextCursor: null, hasMore: false, pageSize, degraded: 'Applications feed unavailable.' }
    }
  }
}

export type JobRow = {
  id: string
  title: string
  category: string
  description: string
  responsibilities: string[]
  payAmountUsd: number
  estimatedMinutes: number
  capacity: number
  slotsRemaining: number
  trainingRequired: boolean
  trainingFeeUsd: number
  trainingNotes: TrainingSection[]
  assessmentQuestions: AssessmentQuestion[]
  requiresVerified: boolean
  status: string
  closesAt: string
  postedAgo: string
  updatedAt?: string
}

/**
 * Server-side jobs read for the console. Public job browsing keeps using the client listener
 * (it is genuinely public data); the console gets a bounded, projected page instead of streaming
 * the whole catalogue plus its internal counters.
 */
export async function listJobsServer(opts: { status?: string; pageSize?: number; search?: string } = {}): Promise<JobRow[]> {
  const db = dbOrNull()
  if (!db) return []
  try {
    let q: Query = db.collection('jobs')
    if (opts.status && opts.status !== 'all') q = q.where('status', '==', opts.status)
    const snap = await q.limit(Math.min(200, Math.max(10, opts.pageSize ?? 100))).get()
    const search = normaliseSearch(opts.search)
    const rows = snap.docs.map((d) => {
      const data = (d.data() ?? {}) as Record<string, unknown>
      return {
        id: d.id,
        title: String(data.title ?? ''),
        category: String(data.category ?? 'Data Entry'),
        description: String(data.description ?? ''),
        responsibilities: Array.isArray(data.responsibilities) ? (data.responsibilities as string[]).map(String) : [],
        payAmountUsd: Number(data.payAmountUsd ?? 0) || 0,
        estimatedMinutes: Number(data.estimatedMinutes ?? 0) || 0,
        capacity: Number(data.capacity ?? 0) || 0,
        slotsRemaining: Number(data.slotsRemaining ?? 0) || 0,
        trainingFeeUsd: Number(data.trainingFeeUsd ?? 0) || 0,
        // Reuse the worker-facing normalisers so the console edits exactly the lesson fields the
        // training reader renders — duration and the end-of-lesson check included.
        trainingNotes: normaliseTrainingSections(data.trainingNotes),
        // Derived from those sections, so the console never shows a stale "free" on a card that
        // actually carries a course.
        trainingRequired: normaliseTrainingSections(data.trainingNotes).some(
          (section) => section.title.trim() !== '' || section.content.trim() !== '',
        ),
        assessmentQuestions: normaliseAssessmentQuestions(data.assessmentQuestions),
        requiresVerified: data.requiresVerified !== false,
        status: String(data.status ?? 'open'),
        closesAt: String(data.closesAt ?? ''),
        postedAgo: String(data.postedAgo ?? ''),
        updatedAt: (data.updatedAt as string) ?? undefined,
      }
    })
    return search ? rows.filter((job) => jobMatchesSearch(job, search)) : rows
  } catch (err) {
    console.warn('[FirestoreAdmin] listJobsServer failed:', err)
    return []
  }
}

/** Recent worker activity for the console ticker (real data, not a decorative list). */
export async function recentActivity(limit = 12): Promise<{ id: string; label: string; at: string; tone: string }[]> {
  const db = dbOrNull()
  if (!db) return []
  try {
    const snap = await db.collection('admin_logs').orderBy('timestamp', 'desc').limit(limit).get()
    return snap.docs.map((d) => {
      const data = (d.data() ?? {}) as Record<string, unknown>
      const action = String(data.action ?? 'EVENT')
      const details = (data.details ?? {}) as Record<string, unknown>
      const hint = String(details.jobTitle ?? details.jobId ?? details.uid ?? details.email ?? '')
      return {
        id: d.id,
        label: `${action.replace(/_/g, ' ').toLowerCase()}${hint ? ` · ${hint}` : ''}`,
        at: String(data.timestamp ?? ''),
        tone: /FAIL|REJECT|BAN|SUSPEND/i.test(action) ? 'danger' : /APPROV|COMPLET|ENABLE/i.test(action) ? 'success' : 'info',
      }
    })
  } catch {
    return []
  }
}

/**
 * Worker-side work submission. Ownership and the legal source state are re-checked server-side:
 * the client cannot move its own application into `submitted_for_review` from a state where that
 * is not allowed, and cannot submit against someone else's application.
 */
export async function submitWorkServer(uid: string, applicationId: string, note: string): Promise<{ status: 'submitted_for_review' }> {
  const db = adminDb()
  const ref = db.collection('applications').doc(applicationId)

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new TransitionError('Application not found.', 404)
    const data = (snap.data() ?? {}) as Record<string, unknown>
    if (data.workerUid !== uid) throw new TransitionError('You can only submit work for your own applications.', 403)
    const status = String(data.status)
    if (status !== 'in_progress' && status !== 'revision_requested') {
      throw new TransitionError(`Work cannot be submitted from a "${status.replace(/_/g, ' ')}" application.`, 409)
    }
    const now = new Date().toISOString()
    tx.set(
      ref,
      {
        status: 'submitted_for_review',
        workSubmittedAt: now,
        workerNote: String(note ?? '').slice(0, 1000),
        updatedAt: now,
        history: FieldValue.arrayUnion({ status: 'submitted_for_review', at: now, by: 'worker' }),
      },
      { merge: true },
    )
    return { status: 'submitted_for_review' } as const
  })
}

/** Clears the "read" flag storm: mark one or all notifications read for their owner. */
export async function markNotificationsRead(uid: string, all = true, ids: string[] = []): Promise<number> {
  const db = dbOrNull()
  if (!db) return 0
  try {
    let q = db.collection('notifications').where('uid', '==', uid).where('read', '==', false)
    if (!all) {
      if (!ids.length) return 0
      q = db.collection('notifications').where('uid', '==', uid).where(FieldPath.documentId(), 'in', ids.slice(0, 20))
    }
    const snap = await q.limit(50).get()
    if (snap.empty) return 0
    const batch = db.batch()
    snap.docs.forEach((d) => batch.set(d.ref, { read: true, readAt: new Date().toISOString() }, { merge: true }))
    await batch.commit()
    return snap.size
  } catch (err) {
    console.warn('[FirestoreAdmin] markNotificationsRead skipped:', err instanceof Error ? err.message : err)
    return 0
  }
}

export async function listNotifications(uid: string, limit = 20): Promise<NotificationRow[]> {
  const db = dbOrNull()
  if (!db) return []
  try {
    const snap = await db.collection('notifications').where('uid', '==', uid).orderBy('createdAt', 'desc').limit(Math.min(50, Math.max(1, limit))).get()
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationRow, 'id'>) }))
  } catch (err) {
    console.warn('[FirestoreAdmin] listNotifications fell back to unordered read:', err)
    try {
      const snap = await db.collection('notifications').where('uid', '==', uid).limit(Math.min(50, limit)).get()
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationRow, 'id'>) }))
      return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    } catch {
      return []
    }
  }
}

export type NotificationRow = {
  id: string
  uid: string
  title: string
  body: string
  tone?: 'success' | 'info' | 'warning' | 'danger'
  link?: string
  read?: boolean
  createdAt: string
}
