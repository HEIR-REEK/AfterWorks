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

      const serviceAccount = parsedJson as admin.ServiceAccount
      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
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
export function dbOrNull(): admin.firestore.Firestore | null {
  try {
    return admin.firestore(getAdminApp())
  } catch (err) {
    console.warn('[FirestoreAdmin] Firestore handle unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

export function adminDb(): admin.firestore.Firestore {
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

/**
 * Records a completed Paystack training payment in Firestore using Admin SDK.
 */
export async function recordPaidTrainingAdmin(
  uid: string,
  jobId: string,
): Promise<void> {
  try {
    const app = getAdminApp()
    const db = admin.firestore(app)
    const userRef = db.collection('users').doc(uid)
    await userRef.set(
      {
        paidTrainings: admin.firestore.FieldValue.arrayUnion(jobId),
      },
      { merge: true },
    )
    console.log(`[FirestoreAdmin] Recorded paid training for uid=${uid}, jobId=${jobId}`)
  } catch (err) {
    console.error('[FirestoreAdmin] recordPaidTrainingAdmin failed for uid:', uid, err)
  }
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
    const db = admin.firestore(app)
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
export async function checkUserAdminRoleAdmin(email: string): Promise<boolean> {
  try {
    const app = getAdminApp()
    const db = admin.firestore(app)
    const cleanEmail = email.trim().toLowerCase()
    
    const snap = await db
      .collection('users')
      .where('email', '==', cleanEmail)
      .limit(1)
      .get()

    if (snap.empty) return false
    const userData = snap.docs[0].data()
    return Boolean(userData.isAdmin === true || userData.role === 'admin')
  } catch (err) {
    console.error('[FirestoreAdmin] checkUserAdminRoleAdmin failed for email:', email, err)
    return false
  }
}
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

function sessionDoc(db: admin.firestore.Firestore, jti: string) {
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
    const snap = await db.collection('system').doc('maintenance').get()
    if (!snap.exists) return DEFAULT_MAINTENANCE_CONFIG
    const config = normaliseMaintenanceConfig(snap.data())
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

  const next = normaliseMaintenanceConfig({
    ...current,
    ...merged,
    version: (current.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmail,
  })

  await db.collection('system').doc('maintenance').set(next as unknown as Record<string, unknown>)
  primeMaintenanceCache(next)

  await createAuditEntry(
    next.enabled ? 'MAINTENANCE_ENABLED' : 'MAINTENANCE_DISABLED',
    {
      mode: next.mode,
      scope: next.scope,
      blockedPaths: next.scope === 'sections' ? next.blockedPaths : undefined,
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

export type AdminUserRow = {
  uid: string
  name: string
  email: string
  accountState: string
  kycVerified: boolean
  kycStatus?: string
  role: string
  qualityScore: number
  jobsCompleted: number
  memberSince: string
  createdAt: string | null
  lastActiveAt: string | null
  wallet: { pendingUsd: number; availableUsd: number; payoutNumberMasked: string }
  country?: string
  phoneMasked?: string
  paidTrainingsCount: number
  /**
   * The account as Firebase Auth sees it. A Firestore profile is what the operator edits; Auth is what
   * actually lets somebody sign in, so the two must be compared, not assumed equal. Absent when the
   * Admin SDK is unusable or the profile has no matching account.
   */
  auth?: AuthAccountState
}

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

function maskPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length < 4) return ''
  return `${'•'.repeat(Math.max(2, digits.length - 6))}${digits.slice(-4)}`
}

function toRow(uid: string, data: Record<string, unknown>): AdminUserRow {
  const wallet = (data.wallet ?? {}) as Record<string, unknown>
  return {
    uid,
    name: String(data.name ?? ''),
    email: String(data.email ?? ''),
    accountState: String(data.accountState ?? 'active'),
    kycVerified: data.kycVerified === true,
    kycStatus: data.kycStatus ? String(data.kycStatus) : undefined,
    role: data.isAdmin === true ? 'admin' : String(data.role ?? 'user'),
    qualityScore: Number(data.qualityScore ?? 100) || 0,
    jobsCompleted: Number(data.jobsCompleted ?? 0) || 0,
    memberSince: String(data.memberSince ?? ''),
    createdAt: (data.createdAt as string) ?? null,
    lastActiveAt: (data.updatedAt as string) ?? null,
    wallet: {
      pendingUsd: Number(wallet.pendingUsd ?? 0) || 0,
      availableUsd: Number(wallet.availableUsd ?? 0) || 0,
      payoutNumberMasked: maskPhone(wallet.payoutNumber ?? data.phone),
    },
    country: data.country ? String(data.country) : undefined,
    phoneMasked: maskPhone(data.phone),
    paidTrainingsCount: Array.isArray(data.paidTrainings) ? (data.paidTrainings as unknown[]).length : 0,
  }
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
export async function listUsersPage(opts: {
  pageSize?: number
  cursor?: string | null
  search?: string
  state?: string
}): Promise<UserPage> {
  const db = dbOrNull()
  if (!db) return { rows: [], nextCursor: null, hasMore: false, pageSize: opts.pageSize ?? 25, degraded: 'Admin SDK unavailable' }

  const pageSize = Math.min(50, Math.max(5, opts.pageSize ?? 25))
  const search = (opts.search ?? '').trim().toLowerCase()
  const state = (opts.state ?? 'all').trim()

  try {
    let ref: admin.firestore.Query = db.collection('users')
    if (search) {
      ref = ref.orderBy('email').startAt(search).endAt(`${search}\uf8ff`)
    } else if (state && state !== 'all') {
      ref = ref.where('accountState', '==', state).orderBy(admin.firestore.FieldPath.documentId(), 'asc')
    } else {
      ref = ref.orderBy(admin.firestore.FieldPath.documentId(), 'asc')
    }
    if (opts.cursor) ref = ref.startAfter(opts.cursor)
    ref = ref.limit(pageSize + 1)

    const snap = await (ref as admin.firestore.Query).get()
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
      if (opts.cursor) ref = ref.startAfter(opts.cursor)
      const snap = await ref.get()
      const docs = snap.docs.slice(0, pageSize)
      return {
        rows: docs
          .map((d) => toRow(d.id, (d.data() ?? {}) as Record<string, unknown>))
          .filter((row) => (!search ? true : row.email.toLowerCase().includes(search))),
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

/** Full (unmasked) profile for the admin detail drawer — still server-gated, never streamed. */
export async function getUserDetail(uid: string): Promise<Record<string, unknown> | null> {
  const db = dbOrNull()
  if (!db) return null
  const snap = await db.collection('users').doc(uid).get()
  if (!snap.exists) return null
  return { uid: snap.id, ...(snap.data() ?? {}) }
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

  if ('role' in clean || 'isAdmin' in clean) {
    await syncAdminClaimForUid(db, uid, clean.isAdmin === true || clean.role === 'admin')
  }

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

/**
 * Keeps the `admin` custom claim in sync with the Firestore role so the middleware, the guards
 * and firestore.rules can all trust the token instead of paying a document read per request.
 */
async function syncAdminClaimForUid(db: admin.firestore.Firestore, uid: string, isAdmin: boolean): Promise<void> {
  try {
    await admin.auth(getAdminApp()).setCustomUserClaims(uid, { admin: isAdmin })
  } catch (err) {
    console.warn('[FirestoreAdmin] setCustomUserClaims skipped:', err instanceof Error ? err.message : err)
  }
  try {
    invalidateGuardCaches(uid)
  } catch {
    /* guard module optional */
  }
  void db
}

export async function setUserAdminFlagByEmail(email: string, isAdmin: boolean, actorEmail: string): Promise<boolean> {
  const db = adminDb()
  const clean = email.trim().toLowerCase()
  const snap = await db.collection('users').where('email', '==', clean).limit(1).get()
  if (snap.empty) return false
  const doc = snap.docs[0]
  await doc.ref.set({ isAdmin, role: isAdmin ? 'admin' : 'user', updatedAt: new Date().toISOString() }, { merge: true })
  await syncAdminClaimForUid(db, doc.id, isAdmin)
  await createAuditEntry(isAdmin ? 'ADMIN_ROLE_GRANTED' : 'ADMIN_ROLE_REVOKED', { email: clean }, actorEmail)
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

function authOrNull(): admin.auth.Auth | null {
  try {
    if (!isFirebaseAdminUsable()) return null
    return admin.auth(getAdminApp())
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
        const providers = (rec.providerData ?? []).map((p: admin.auth.UserInfo) => p.providerId)
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
      providers: (rec.providerData ?? []).map((p: admin.auth.UserInfo) => p.providerId),
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
            createdAt: rec.metadata?.creationTime ?? null,
            lastSignInAt: rec.metadata?.lastSignInTime ?? null,
            providers: (rec.providerData ?? []).map((p: admin.auth.UserInfo) => p.providerId),
          }
        : { exists: false, disabled: false, emailVerified: false, createdAt: null, lastSignInAt: null, providers: [], orphaned: true }
    }
  } catch (err) {
    console.warn('[FirestoreAdmin] Auth enrichment skipped:', err instanceof Error ? err.message : err)
  }
}

export type AccountActionResult = { ok: boolean; error?: string; code?: string; note?: string; secret?: string; link?: string }

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
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (/uid-not-found|USER_NOT_FOUND|no such user/i.test(message)) {
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
  } catch (err) {
    void err
    return { ok: false, error: 'The password could not be reset.', code: 'auth_write_failed' }
  }
  await createAuditEntry('ACCOUNT_PASSWORD_RESET', { uid, actor: actorEmail }, actorEmail)
  return {
    ok: true,
    secret,
    note: 'Show this once, then have the member change it — it is not stored anywhere on the server.',
  }
}

/**
 * Auth has no email transport of its own, so this mints the link the provider would have emailed and
 * hands it to the operator. Deliberately not a "sent ✓" claim: nothing was sent.
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

/**
 * Hard deletion: the profile, the credential and — importantly — the ability to sign in again with the
 * same account. Financial rows are kept by default because a payout record without a counterparty is
 * worse for everybody than a tombstone; pass `eraseLedger` to remove the earnings entries too.
 */
export async function hardDeleteAccount(
  uid: string,
  opts: { actorEmail: string; reason: string; eraseLedger?: boolean },
): Promise<AccountActionResult & { removed?: Record<string, number> }> {
  const db = dbOrNull()
  const auth = authOrNull()
  if (!db) return { ok: false, error: 'The datastore is unreachable, so nothing was deleted.', code: 'storage_unavailable' }

  const removed: Record<string, number> = { profile: 0, applications: 0, ledger: 0, notifications: 0, auth: 0 }
  try {
    const [profile, apps, ledger, notes] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('applications').where('workerUid', '==', uid).limit(400).get().catch(() => null),
      db.collection('wallet_ledger').where('uid', '==', uid).limit(400).get().catch(() => null),
      db.collection('notifications').where('uid', '==', uid).limit(400).get().catch(() => null),
    ])
    if (profile.exists) {
      await profile.ref.delete()
      removed.profile = 1
    }
    const batch = db.batch()
    apps?.docs.forEach((d) => batch.delete(d.ref))
    notes?.docs.forEach((d) => batch.delete(d.ref))
    if (opts.eraseLedger) ledger?.docs.forEach((d) => batch.delete(d.ref))
    else
      ledger?.docs.forEach((d) =>
        batch.set(d.ref, { redactedAt: new Date().toISOString(), redactedBy: opts.actorEmail, jobTitle: '[redacted]', note: '[redacted]' }, { merge: true }),
      )
    await batch.commit()
    removed.applications = apps?.size ?? 0
    removed.ledger = ledger?.size ?? 0
    removed.notifications = notes?.size ?? 0

    if (auth) {
      await auth.deleteUser(uid)
      removed.auth = 1
    }
    invalidateGuardCaches?.(uid)
    await createAuditEntry(
      'ACCOUNT_HARD_DELETED',
      { uid, removed, eraseLedger: opts.eraseLedger === true, reason: opts.reason.slice(0, 400) },
      opts.actorEmail,
    )
    return { ok: true, removed, note: opts.eraseLedger ? 'Ledger rows deleted.' : 'Ledger amounts kept with the personal fields redacted.' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[FirestoreAdmin] hardDeleteAccount failed:', err)
    return { ok: false, error: `Deletion stopped part-way: ${message.slice(0, 160)}. Retry or finish it by hand.`, code: 'partial_delete', removed }
  }
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
  const search = (opts.search ?? '').trim().toLowerCase()
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
    let ref: admin.firestore.Query = col.orderBy('createdAt', 'desc')
    if (opts.cursor && src !== 'payment') ref = ref.startAfter(opts.cursor)
    if (opts.status) ref = ref.where('status', '==', opts.status)
    if (opts.kind) ref = ref.where(src === 'wallet' ? 'kind' : 'type', '==', opts.kind)
    try {
      const snap = await ref.limit(pageSize + 1).get()
      return snap.docs.slice(0, pageSize).map((d) => mapRow(d.id, (d.data() ?? {}) as Record<string, unknown>, src))
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

  if (search) {
    rows = rows.filter(
      (row) =>
        row.email.toLowerCase().includes(search) ||
        row.uid.toLowerCase().includes(search) ||
        row.reference.toLowerCase().includes(search) ||
        row.label.toLowerCase().includes(search),
    )
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
    rows: rows.slice(0, pageSize),
    nextCursor: rows.length > pageSize && rows[pageSize - 1]?.createdAt ? rows[pageSize - 1].createdAt as string : null,
    hasMore: rows.length > pageSize,
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
  await db.collection('users').doc(uid).set(
    approve
      ? {
          kycVerified: true,
          kycStatus: 'approved',
          accountState: 'active',
          kycVerifiedAt: now,
          kycRejectionReason: null,
          kycProvider: 'admin-review',
          updatedAt: now,
        }
      : {
          kycVerified: false,
          kycStatus: 'declined',
          accountState: 'kyc_rejected',
          kycRejectedAt: now,
          kycRejectionReason: reason.slice(0, 300),
          updatedAt: now,
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
}

// ─── Platform statistics (one cached server read instead of six live listeners) ─

export type PlatformStats = {
  totals: {
    users: number
    kycVerified: number
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

async function safeCount(build: () => admin.firestore.Query, fallbackLimit = 500): Promise<number> {
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
  requiresVerified: boolean
  status: string
  closesAt?: string
}

function sanitizeJob(input: AdminJobInput, existing?: Record<string, unknown> | null) {
  const title = String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!title) throw new Error('Job title is required.')
  const capacity = Math.max(1, Math.min(100_000, Math.round(Number(input.capacity) || 0)))
  const requested = Math.round(Number(input.slotsRemaining ?? capacity))
  const slots = Math.max(0, Math.min(capacity, Number.isFinite(requested) ? requested : capacity))

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
    trainingRequired: input.trainingRequired === true,
    requiresVerified: input.requiresVerified !== false,
    status: (JOB_STATUSES as readonly string[]).includes(input.status) ? input.status : 'open',
    closesAt: input.closesAt || (existing?.closesAt as string) || new Date(Date.now() + 7 * 86400_000).toISOString(),
    postedAgo: (existing?.postedAgo as string) || 'just now',
    updatedAt: new Date().toISOString(),
  }
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
export async function createApplicationServer(uid: string, jobId: string): Promise<{ applicationId: string }> {
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
  if (job.trainingRequired === true) {
    const paid = Array.isArray(user.paidTrainings) ? (user.paidTrainings as string[]) : []
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

  return { applicationId }
}

export async function withdrawApplicationServer(uid: string, applicationId: string): Promise<void> {
  const db = adminDb()
  const ref = db.collection('applications').doc(applicationId)
  const snap = await ref.get()
  if (!snap.exists) throw new TransitionError('Application not found.', 404)
  const data = (snap.data() ?? {}) as Record<string, unknown>
  if (data.workerUid !== uid) throw new TransitionError('You can only withdraw your own applications.', 403)
  const status = String(data.status)
  if (status !== 'under_review' && status !== 'approved') {
    throw new TransitionError(`Work already ${status.replace(/_/g, ' ')} cannot be withdrawn. Contact support.`, 409)
  }
  await ref.set({ status: 'withdrawn', history: admin.firestore.FieldValue.arrayUnion({ status: 'withdrawn', at: new Date().toISOString() }), updatedAt: new Date().toISOString() }, { merge: true })
  await createAuditEntry('APPLICATION_WITHDRAWN', { applicationId, uid }, String(data.workerEmail ?? uid))
}

/**
 * Admin QA transition. Writes the status, the ledger side-effects (pending earnings on
 * completion, slot release on rejection after approval) and a worker notification atomically
 * enough for a prototype, and is idempotent: re-running the same transition is a no-op.
 */
export async function transitionApplicationAdmin(input: {
  applicationId: string
  to: ApplicationStatusValue
  actorEmail: string
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

  const update: Record<string, unknown> = {
    status: to,
    updatedAt: now,
    handledBy: input.actorEmail,
    history: admin.firestore.FieldValue.arrayUnion({ status: to, at: now, by: input.actorEmail }),
  }
  if (input.note) update.revisionNote = String(input.note).slice(0, 500)
  if (input.reason) update.rejectionReason = String(input.reason).slice(0, 500)

  await ref.set(update, { merge: true })

  if (to === 'completed' && uid && payUsd > 0) {
    creditedUsd = payUsd
    const ledgerId = `wd_${input.applicationId}`
    const ledgerRef = db.collection('wallet_ledger').doc(ledgerId)
    const already = await ledgerRef.get()
    if (already.exists) {
      creditedUsd = 0 // idempotent replay — never double-pay
    } else {
      const userRef = db.collection('users').doc(uid)
      await db.runTransaction(async (tx) => {
        const userSnapTx = await tx.get(userRef)
        const userData = (userSnapTx.data() ?? {}) as Record<string, unknown>
        const wallet = (userData.wallet ?? {}) as Record<string, unknown>
        const nextPending = Math.round(((Number(wallet.pendingUsd ?? 0) || 0) + payUsd) * 100) / 100
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
        tx.set(ledgerRef, {
          id: ledgerId,
          uid,
          kind: 'earning',
          amountUsd: payUsd,
          currency: 'USD',
          applicationId: input.applicationId,
          jobId,
          status: 'pending',
          clearedAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
          createdAt: now,
          createdBy: input.actorEmail,
        })
      })
    }
  }

  if ((to === 'rejected' || to === 'failed_qa') && jobId && (from === 'approved' || from === 'in_progress' || from === 'submitted_for_review')) {
    await db.collection('jobs').doc(jobId).set({ slotsRemaining: admin.firestore.FieldValue.increment(1) }, { merge: true })
  }

  if (to === 'approved' && jobId) {
    await db
      .collection('jobs')
      .doc(jobId)
      .set({ slotsRemaining: admin.firestore.FieldValue.increment(-1), applicationsApproved: admin.firestore.FieldValue.increment(1) }, { merge: true })
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
    { applicationId: input.applicationId, from, to, jobId, creditedUsd, reason: input.reason?.slice(0, 200) },
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

export async function listAuditLogs(opts: { limit?: number; action?: string; search?: string } = {}): Promise<AdminAuditRow[]> {
  const db = dbOrNull()
  if (!db) return []
  const size = Math.min(200, Math.max(10, opts.limit ?? 60))
  try {
    let q: admin.firestore.Query = db.collection('admin_logs')
    if (opts.action && opts.action !== 'all') q = q.where('action', '==', opts.action)
    q = q.orderBy('timestamp', 'desc').limit(size)
    const snap = await q.get()
    let rows = snap.docs.map((d) => d.data() as AdminAuditRow)
    if (opts.search) {
      const needle = opts.search.toLowerCase()
      rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle))
    }
    return rows
  } catch (err) {
    console.warn('[FirestoreAdmin] listAuditLogs fell back to unordered read:', err)
    const snap = await db.collection('admin_logs').limit(size).get()
    const rows = snap.docs.map((d) => d.data() as AdminAuditRow)
    rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    return opts.search ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(opts.search!.toLowerCase())) : rows
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
  const mapDoc = (d: admin.firestore.QueryDocumentSnapshot): ApplicationRow => {
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
    let q: admin.firestore.Query = db.collection('applications')
    const status = (opts.status ?? 'all').trim()
    if (status && status !== 'all') q = q.where('status', '==', status)
    q = q.orderBy(admin.firestore.FieldPath.documentId(), 'desc').limit(pageSize + 1)
    if (opts.cursor) q = q.startAfter(opts.cursor)
    const snap = await q.get()
    let rows = snap.docs.slice(0, pageSize).map(mapDoc)
    if (opts.search) {
      const needle = opts.search.toLowerCase()
      rows = rows.filter((r) => `${r.jobTitle} ${r.workerEmail} ${r.id}`.toLowerCase().includes(needle))
    }
    return {
      rows,
      nextCursor: snap.size > pageSize ? snap.docs[Math.min(pageSize, snap.size - 1)].id : null,
      hasMore: snap.size > pageSize,
      pageSize,
    }
  } catch (err) {
    console.warn('[FirestoreAdmin] listApplicationsPage degraded:', err)
    try {
      const snap = await db.collection('applications').limit(pageSize + 1).get()
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
export async function listJobsServer(opts: { status?: string; pageSize?: number } = {}): Promise<JobRow[]> {
  const db = dbOrNull()
  if (!db) return []
  try {
    let q: admin.firestore.Query = db.collection('jobs')
    if (opts.status && opts.status !== 'all') q = q.where('status', '==', opts.status)
    const snap = await q.limit(Math.min(200, Math.max(10, opts.pageSize ?? 100))).get()
    return snap.docs.map((d) => {
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
        trainingRequired: data.trainingRequired === true,
        requiresVerified: data.requiresVerified !== false,
        status: String(data.status ?? 'open'),
        closesAt: String(data.closesAt ?? ''),
        postedAgo: String(data.postedAgo ?? ''),
        updatedAt: (data.updatedAt as string) ?? undefined,
      }
    })
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
        history: admin.firestore.FieldValue.arrayUnion({ status: 'submitted_for_review', at: now, by: 'worker' }),
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
      q = db.collection('notifications').where('uid', '==', uid).where(admin.firestore.FieldPath.documentId(), 'in', ids.slice(0, 20))
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
