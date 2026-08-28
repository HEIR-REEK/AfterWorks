/**
 * GET /api/kyc/status?sessionId=<id>
 *
 * Polling / manual status-check endpoint for KYC session state.
 *
 * This endpoint is the client-side polling fallback for when the Didit
 * webhook has not yet fired (or cannot reach the server). It:
 *   1. Authenticates the caller.
 *   2. Fetches the live status from Didit's API (server-side, trusted).
 *   3. Updates the `kyc_records` collection with the latest status.
 *   4. Reads the user's Firestore profile to determine if the webhook has
 *      already finalised the verification (Firestore is always source of truth).
 *   5. Returns a structured response the client can act on directly.
 *
 * Auth: requires Firebase ID token in Authorization: Bearer <token> header.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getKycSessionStatus } from '@/lib/didit'
import { consumeBucket } from '@/lib/guards'
import { saveKycRecord, verifyIdToken, getUserProfile, updateUserProfile } from '@/lib/firestore-admin'

export async function GET(req: NextRequest) {
  try {
    // ── Authentication ──────────────────────────────────────────────────────
    const authHeader = req.headers.get('authorization')
    const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!idToken) {
      return NextResponse.json(
        { error: 'Authorization header with Bearer token is required.' },
        { status: 401 },
      )
    }
    const decoded = await verifyIdToken(idToken)
    if (!decoded) {
      return NextResponse.json(
        { error: 'Invalid or expired authentication token.' },
        { status: 401 },
      )
    }

    // Each poll is a call to Didit, so cap it per member.
    const bucket = consumeBucket('kyc-status', 40, 60_000, decoded.uid)
    if (!bucket.ok) {
      return NextResponse.json(
        { error: 'Status checks are rate limited. Please wait a moment.', retryAfterSec: bucket.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(bucket.retryAfterSec) } },
      )
    }

    // Use the authenticated UID — prevent spoofing via query param
    const userId = decoded.uid

    // ── Resolve session ID ──────────────────────────────────────────────────
    const { searchParams } = req.nextUrl
    const sessionId =
      searchParams.get('sessionId') ||
      searchParams.get('session_id') ||
      searchParams.get('sessionToken') ||
      searchParams.get('session_token')

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId query parameter is required.' }, { status: 400 })
    }

    // ── Live status from Didit (server-side, signed) ─────────────────────────
    const didit = await getKycSessionStatus(sessionId)

    // Persist the latest status to kyc_records so Firestore stays in sync
    // even when the webhook is delayed or missed.
    await saveKycRecord(userId, didit.session_id, '', didit.status, {
      rawStatus: didit.raw_status,
      rejectionReason: didit.rejection_reason,
      failedChecks: didit.failed_checks,
    })

    const userProfile = await getUserProfile(userId)
    const firestoreVerified = userProfile?.kycVerified === true
    const firestoreAccountState = (userProfile?.accountState as string | undefined) ?? 'active'
    const firestoreRejected = firestoreAccountState === 'kyc_rejected'
    const firestoreOnHold = firestoreAccountState === 'kyc_on_hold'
    const firestoreResubmission = firestoreAccountState === 'kyc_resubmission'

    // ── Self-healing: Sync Didit status to Profile if Webhook was missed ──
    const nowIso = new Date().toISOString()
    let awaitingWebhook = false

    if (didit.is_approved && !firestoreVerified) {
      console.log(`[KYC status] Auto-syncing Approved state for uid=${userId} (webhook missed or delayed)`)
      await updateUserProfile(userId, {
        kycVerified: true,
        accountState: 'active',
        kycStatus: didit.raw_status,
        kycVerifiedAt: nowIso,
        kycProvider: 'Didit',
        kycLevel: 'Identity',
        kycRejectionReason: null,
        kycFailedChecks: null,
      })
    } else if (didit.is_rejected && !firestoreRejected) {
      console.log(`[KYC status] Auto-syncing Declined state for uid=${userId}`)
      await updateUserProfile(userId, {
        kycVerified: false,
        accountState: 'kyc_rejected',
        kycStatus: didit.raw_status,
        kycRejectedAt: nowIso,
        kycRejectionReason: didit.rejection_reason ?? null,
        kycFailedChecks: didit.failed_checks ?? null,
      })
    } else if (didit.needs_resubmission && !firestoreResubmission) {
      console.log(`[KYC status] Auto-syncing Resubmission state for uid=${userId}`)
      await updateUserProfile(userId, {
        kycVerified: false,
        accountState: 'kyc_resubmission',
        kycStatus: didit.raw_status,
        kycRejectionReason: didit.rejection_reason ?? null,
        kycFailedChecks: didit.failed_checks ?? null,
      })
    } else if (didit.is_on_hold && !firestoreOnHold) {
      console.log(`[KYC status] Auto-syncing OnHold state for uid=${userId}`)
      await updateUserProfile(userId, {
        kycVerified: false,
        accountState: 'kyc_on_hold',
        kycStatus: didit.raw_status,
        kycOnHoldAt: nowIso,
      })
    } else if (didit.status === 'Pending' || didit.status === 'InProgress') {
      // If we are still processing, we wait.
      awaitingWebhook = didit.is_approved && !firestoreVerified
    }

    // Re-evaluate what we just synced so the client gets accurate boolean flags
    const finalIsApproved = didit.is_approved || firestoreVerified
    const finalIsRejected = didit.is_rejected || firestoreRejected
    const finalIsOnHold = didit.is_on_hold || firestoreOnHold
    const finalNeedsResubmission = didit.needs_resubmission || firestoreResubmission

    // ── Structured log ───────────────────────────────────────────────────────
    console.log(
      `[KYC status] uid=${userId} session=${sessionId} ` +
        `didit=${didit.status} finalVerified=${finalIsApproved}`,
    )

    return NextResponse.json({
      // Didit-reported status (normalised)
      status: didit.status,
      rawStatus: didit.raw_status,

      // Granular boolean flags — client picks whichever fits its UI
      isApproved: finalIsApproved,
      isRejected: finalIsRejected,
      isOnHold: finalIsOnHold,
      needsResubmission: finalNeedsResubmission,

      // Didit's live read
      diditApproved: didit.is_approved,
      diditRejected: didit.is_rejected,
      diditExpired: didit.is_expired,
      diditAbandoned: didit.is_abandoned,
      diditOnHold: didit.is_on_hold,
      diditNeedsResubmission: didit.needs_resubmission,

      // Useful for "still processing" spinner
      awaitingWebhook,

      // Human-readable details for the client to display
      rejectionReason: didit.rejection_reason ?? null,
      failedChecks: didit.failed_checks ?? null,
    })
  } catch (err) {
    console.error('[KYC status]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
