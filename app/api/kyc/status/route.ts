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
import { saveKycRecord, verifyIdToken, getUserProfile } from '@/lib/firestore-admin'

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

    // ── Firestore profile (always the authoritative source for business logic) –
    const userProfile = await getUserProfile(userId)
    const firestoreVerified = userProfile?.kycVerified === true
    const firestoreAccountState = (userProfile?.accountState as string | undefined) ?? 'active'
    const firestoreRejected = firestoreAccountState === 'kyc_rejected'
    const firestoreOnHold = firestoreAccountState === 'kyc_on_hold'
    const firestoreResubmission = firestoreAccountState === 'kyc_resubmission'

    // Didit says approved but webhook hasn't fired yet — tell the client to keep polling
    const awaitingWebhook = didit.is_approved && !firestoreVerified

    // ── Structured log ───────────────────────────────────────────────────────
    console.log(
      `[KYC status] uid=${userId} session=${sessionId} ` +
        `didit=${didit.status} firestoreVerified=${firestoreVerified} ` +
        `awaitingWebhook=${awaitingWebhook}`,
    )

    return NextResponse.json({
      // Didit-reported status (normalised)
      status: didit.status,
      rawStatus: didit.raw_status,

      // Granular boolean flags — client picks whichever fits its UI
      isApproved: firestoreVerified,             // ONLY true once Firestore confirms
      isRejected: firestoreRejected,
      isOnHold: firestoreOnHold,
      needsResubmission: firestoreResubmission,

      // Didit's live read (before webhook settles)
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
