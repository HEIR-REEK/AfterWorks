/**
 * POST /api/kyc/webhook
 *
 * Didit calls this endpoint on every KYC session status transition.
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 * Register this URL in the Didit Business Console under "API & Webhooks":
 *   https://your-domain.com/api/kyc/webhook
 *
 * Set DIDIT_WEBHOOK_SECRET in your environment to the secret Didit provides.
 * Didit signs every request body with HMAC-SHA256; we verify that signature
 * before acting on the payload.
 *
 * ── Handled Status Transitions ───────────────────────────────────────────────
 *
 *  Didit Status   → accountState in Firestore   → kycVerified
 *  ─────────────────────────────────────────────────────────────
 *  Approved        active                         true
 *  Declined        kyc_rejected                   false
 *  Resubmission    kyc_resubmission               false
 *  OnHold          kyc_on_hold                    false
 *  Abandoned       kyc_abandoned                  false
 *  Expired         kyc_expired                    false
 *  InProgress      (no change — informational)    —
 *  Pending         (no change — informational)    —
 *
 * Didit guarantees at-least-once delivery, so this handler is idempotent:
 * processing the same webhook twice produces the same Firestore state.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  verifyWebhookSignature,
  normaliseStatus,
  type DiditSessionStatus,
} from '@/lib/didit'
import { updateUserProfile, saveKycRecord } from '@/lib/firestore-admin'

export async function POST(req: NextRequest) {
  let rawBody: string

  // ── Read raw body (required for HMAC verification) ────────────────────────
  try {
    rawBody = await req.text()
  } catch (err) {
    console.error('[KYC webhook] Failed to read request body:', err)
    return NextResponse.json({ error: 'Could not read request body.' }, { status: 400 })
  }

  // ── Signature verification ────────────────────────────────────────────────
  const signature =
    req.headers.get('x-signature-v2') ||
    req.headers.get('x-didit-signature') ||
    req.headers.get('x-hub-signature-256') // some Didit versions use this header

  const isValid = await verifyWebhookSignature(rawBody, signature)

  if (!isValid) {
    // If DIDIT_WEBHOOK_SECRET is not set (e.g. local dev), log a warning instead
    // of hard-rejecting so developers can still test the rest of the flow.
    const secretConfigured = !!process.env.DIDIT_WEBHOOK_SECRET
    if (secretConfigured) {
      console.warn('[KYC webhook] Invalid signature — rejecting request.')
      return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 })
    } else {
      console.warn(
        '[KYC webhook] DIDIT_WEBHOOK_SECRET not configured — skipping signature check (DEV only).',
      )
    }
  }

  // ── Parse payload ─────────────────────────────────────────────────────────
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const userId = payload.vendor_data as string | undefined
  const sessionId = (payload.session_id ?? payload.id ?? '') as string
  const sessionToken = (payload.session_token ?? '') as string
  const rawStatus = (payload.status ?? payload.state ?? '') as string
  const status: DiditSessionStatus = normaliseStatus(rawStatus)

  // ── Validation ────────────────────────────────────────────────────────────
  if (!userId) {
    console.warn('[KYC webhook] Missing vendor_data (userId) in payload:', payload)
    // Return 200 so Didit doesn't keep retrying an unfixable request
    return NextResponse.json({ received: true, warning: 'Missing vendor_data.' })
  }

  if (!sessionId) {
    console.warn('[KYC webhook] Missing session_id in payload:', payload)
    return NextResponse.json({ received: true, warning: 'Missing session_id.' })
  }

  console.log(
    `[KYC webhook] uid=${userId} session=${sessionId} ` +
      `rawStatus="${rawStatus}" → normalised="${status}"`,
  )

  // ── Extract optional detail fields ────────────────────────────────────────
  const rejectionReason = extractRejectionReason(payload)
  const failedChecks = extractFailedChecks(payload)
  const verificationLevel = (payload.verification_level ?? 'Identity') as string

  // ── Persist to kyc_records (always, for every status) ─────────────────────
  await saveKycRecord(userId, sessionId, sessionToken, status, {
    rawStatus,
    rejectionReason,
    failedChecks,
  })

  // ── Map Didit status → Firestore user profile ─────────────────────────────
  const nowIso = new Date().toISOString()

  switch (status) {
    case 'Approved': {
      await updateUserProfile(userId, {
        kycVerified: true,
        accountState: 'active',
        kycStatus: rawStatus,
        kycVerifiedAt: nowIso,
        kycProvider: 'Didit',
        kycLevel: verificationLevel,
        // Clear any previous rejection data
        kycRejectionReason: null,
        kycFailedChecks: null,
      })
      console.log(`[KYC webhook] ✅ uid=${userId} marked as KYC verified at ${nowIso}.`)
      break
    }

    case 'Declined': {
      await updateUserProfile(userId, {
        kycVerified: false,
        accountState: 'kyc_rejected',
        kycStatus: rawStatus,
        kycRejectedAt: nowIso,
        kycRejectionReason: rejectionReason ?? null,
        kycFailedChecks: failedChecks ?? null,
      })
      console.log(
        `[KYC webhook] ❌ uid=${userId} KYC declined. ` +
          `Reason: ${rejectionReason ?? 'N/A'} Checks: ${failedChecks?.join(', ') ?? 'N/A'}`,
      )
      break
    }

    case 'Resubmission': {
      // User must redo specific steps; they should be allowed to start a new session
      await updateUserProfile(userId, {
        kycVerified: false,
        accountState: 'kyc_resubmission',
        kycStatus: rawStatus,
        kycRejectionReason: rejectionReason ?? null,
        kycFailedChecks: failedChecks ?? null,
      })
      console.log(
        `[KYC webhook] 🔄 uid=${userId} must resubmit. ` +
          `Reason: ${rejectionReason ?? 'N/A'} Checks: ${failedChecks?.join(', ') ?? 'N/A'}`,
      )
      break
    }

    case 'OnHold': {
      // Flagged for manual compliance / fraud review — no action from the user needed
      await updateUserProfile(userId, {
        kycVerified: false,
        accountState: 'kyc_on_hold',
        kycStatus: rawStatus,
        kycOnHoldAt: nowIso,
      })
      console.log(`[KYC webhook] ⏸  uid=${userId} KYC session placed on hold (manual review).`)
      break
    }

    case 'Abandoned': {
      // User started but didn't finish — allow them to start a fresh session
      await updateUserProfile(userId, {
        kycVerified: false,
        accountState: 'kyc_abandoned',
        kycStatus: rawStatus,
      })
      console.log(`[KYC webhook] 🚶 uid=${userId} abandoned the KYC session.`)
      break
    }

    case 'Expired': {
      // Session TTL elapsed before the user completed verification
      await updateUserProfile(userId, {
        kycVerified: false,
        accountState: 'kyc_expired',
        kycStatus: rawStatus,
      })
      console.log(`[KYC webhook] ⌛ uid=${userId} KYC session expired.`)
      break
    }

    case 'InProgress':
    case 'Pending':
    default: {
      // Informational transitions — no Firestore profile update needed.
      console.log(
        `[KYC webhook] ℹ️  uid=${userId} status="${status}" — no profile update required.`,
      )
      break
    }
  }

  // Always return 200 so Didit does not retry unnecessarily
  return NextResponse.json({ received: true })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractRejectionReason(payload: Record<string, unknown>): string | undefined {
  const candidates = [
    payload.rejection_reason,
    payload.decline_reason,
    payload.resubmission_reason,
    payload.reason,
    (payload.decision as Record<string, unknown> | undefined)?.reason,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return undefined
}

function extractFailedChecks(payload: Record<string, unknown>): string[] | undefined {
  const checks = payload.verification_checks as Record<string, unknown> | undefined
  if (!checks) return undefined

  const failed: string[] = []
  for (const [key, value] of Object.entries(checks)) {
    const check = value as Record<string, unknown> | undefined
    const passed = check?.passed ?? check?.status
    if (passed === false || passed === 'failed' || passed === 'declined') {
      failed.push(key)
    }
  }
  return failed.length > 0 ? failed : undefined
}
