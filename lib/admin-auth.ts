/**
 * Server-side admin authorisation + platform settings helpers.
 *
 * A caller is an admin when ANY of the following holds:
 *   1. Their Firebase Auth user carries the custom claim  { admin: true }
 *   2. A Firestore document exists at admins/{uid}
 *   3. Their email is listed in the ADMIN_EMAILS env var (bootstrap allowlist —
 *      used to promote the first admins; the doc/claim is written on first sign-in)
 *
 * All admin API routes funnel through `requireAdmin`, which verifies the
 * caller's Firebase ID token before any of the checks above run.
 */

import * as admin from 'firebase-admin'
import {
  firebaseAdminConfigured,
  getAdminApp,
  verifyIdToken,
} from '@/lib/firestore-admin'
import { COLLECTIONS } from '@/lib/admin-data'

export type AdminCaller = {
  uid: string
  email: string | null
  /** How admin access was granted (useful for auditing / debugging). */
  via: 'claim' | 'firestore' | 'allowlist'
}

function allowlistEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Checks whether a uid (+ verified email) has admin access.
 * Best-effort: any Firestore/Auth error results in `false` rather than throwing.
 */
export async function isAdminUid(uid: string, email?: string | null): Promise<AdminCaller | null> {
  const allow = allowlistEmails()
  const normalisedEmail = email?.toLowerCase() ?? null

  if (normalisedEmail && allow.includes(normalisedEmail)) {
    return { uid, email: normalisedEmail, via: 'allowlist' }
  }

  try {
    const app = getAdminApp()

    // 1. Custom claim
    try {
      const user = await admin.auth(app).getUser(uid)
      if (user.customClaims?.admin === true) {
        return { uid, email: user.email ?? normalisedEmail, via: 'claim' }
      }
      if (!email && user.email) {
        // We only had a uid — still allow the allowlist to match by Auth email.
        if (allow.includes(user.email.toLowerCase())) {
          return { uid, email: user.email.toLowerCase(), via: 'allowlist' }
        }
      }
    } catch {
      // Auth user may not exist (e.g. imported users) — continue to Firestore check
    }

    // 2. admins/{uid} document
    const snap = await admin.firestore(app).collection(COLLECTIONS.admins).doc(uid).get()
    if (snap.exists) {
      return { uid, email: normalisedEmail ?? (snap.data()?.email as string | undefined) ?? null, via: 'firestore' }
    }
  } catch (err) {
    console.warn('[AdminAuth] isAdminUid check failed for uid:', uid, err)
  }

  return null
}

/**
 * Ensures the allowlist bootstrap artefacts exist for an allowlisted admin:
 * writes admins/{uid} and sets the { admin: true } custom claim.
 * Safe to call repeatedly — failures are logged, never thrown.
 */
export async function promoteToAdmin(uid: string, email: string | null): Promise<void> {
  try {
    const app = getAdminApp()
    await admin.auth(app).setCustomUserClaims(uid, { admin: true })
  } catch (err) {
    console.warn('[AdminAuth] setCustomUserClaims failed for uid:', uid, err)
  }
  try {
    const app = getAdminApp()
    await admin
      .firestore(app)
      .collection(COLLECTIONS.admins)
      .doc(uid)
      .set(
        {
          email: email ?? '',
          role: 'admin',
          addedAt: new Date().toISOString(),
          addedVia: 'allowlist',
        },
        { merge: true },
      )
  } catch (err) {
    console.warn('[AdminAuth] admins doc write failed for uid:', uid, err)
  }
}

/**
 * Verifies the Bearer ID token on an admin API request and checks admin access.
 * Returns a discriminated result — callers respond with the included status on failure.
 */
export async function requireAdmin(req: Request): Promise<
  | { ok: true; caller: AdminCaller }
  | { ok: false; status: number; error: string; configured: boolean }
> {
  if (!firebaseAdminConfigured()) {
    return { ok: false, status: 501, error: 'Admin APIs require Firebase Admin SDK credentials.', configured: false }
  }

  const authHeader = req.headers.get('authorization')
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    return { ok: false, status: 401, error: 'Authorization header with Bearer token is required.', configured: true }
  }

  const decoded = await verifyIdToken(idToken)
  if (!decoded) {
    return { ok: false, status: 401, error: 'Invalid or expired authentication token.', configured: true }
  }

  const caller = await isAdminUid(decoded.uid, decoded.email ?? null)
  if (!caller) {
    return { ok: false, status: 403, error: 'Admin access required.', configured: true }
  }

  // Self-service bootstrap: promote allowlisted admins on first sign-in so the
  // Firestore doc + custom claim exist for subsequent (faster) checks.
  if (caller.via === 'allowlist') {
    await promoteToAdmin(caller.uid, caller.email)
  }

  return { ok: true, caller }
}
