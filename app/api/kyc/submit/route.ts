/**
 * POST /api/kyc/submit
 *
 * Creates a Didit KYC session for the authenticated user and returns
 * the session ID plus the verification URL. The client then either:
 *   • Redirects the user directly to the URL (mobile, same-device flow), or
 *   • Shows a QR code that the user scans from their phone (desktop flow).
 *
 * Auth: requires Firebase ID token in Authorization: Bearer <token> header.
 *
 * Idempotency: if the user already has an active (non-terminal, non-rejected)
 * KYC session recorded in Firestore, a new session is NOT created; the
 * existing session details are returned instead. This prevents duplicate
 * sessions from being opened if the user clicks "Verify Now" multiple times.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createKycSession, DiditApiError, DiditConfigError, diditConfigHint } from '@/lib/didit'
import { saveKycRecord, verifyIdToken, getUserProfile } from '@/lib/firestore-admin'
import { consumeBucket, audit } from '@/lib/guards'
import { publicOriginFor, readJsonBody } from '@/lib/security-core'

export async function POST(req: NextRequest) {
  try {
    // Authenticate before reading the body. This route previously parsed an unbounded JSON
    // payload before checking who was calling, which made it a cheap memory/CPU target.
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
    if (!decoded.email_verified) {
      return NextResponse.json(
        { error: 'Verify your email before starting identity verification.', code: 'email_not_verified' },
        { status: 403 },
      )
    }

    const parsed = await readJsonBody<{ isMobile?: unknown }>(req, 8_000)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    // Use the authenticated UID — never trust a userId from the request body
    const userId = decoded.uid
    const isMobile = parsed.data.isMobile === true

    // Didit sessions are metered and each one writes a record, so creation is throttled per member.
    const bucket = consumeBucket('kyc-submit', 4, 5 * 60_000, userId)
    if (!bucket.ok) {
      return NextResponse.json(
        { error: 'You have opened several verification sessions in a short time. Please wait before trying again.', retryAfterSec: bucket.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(bucket.retryAfterSec) } },
      )
    }

    // ── Guard: user is already verified ──────────────────────────────────────
    const userProfile = await getUserProfile(userId)
    if (userProfile?.kycVerified === true) {
      return NextResponse.json(
        { error: 'Your identity is already verified. No further action is needed.' },
        { status: 409 },
      )
    }
    // A restricted account cannot start another identity check. Without this, a banned member
    // could open a session and let a later KYC callback overwrite the ban with a KYC state.
    const accountState = String(userProfile?.accountState ?? 'active')
    if (accountState === 'suspended' || accountState === 'banned') {
      return NextResponse.json(
        { error: 'This account is restricted. Contact support to appeal before starting identity verification.' },
        { status: 403 },
      )
    }


    // Where Didit sends the worker back to. Honouring x-forwarded-host blindly lets an attacker
    // craft a request whose callback URL points at their own server — with the session token on it.
    const { origin: publicOrigin, source: originSource, isPublicHttps } = publicOriginFor(req)
    console.log(
      `[KYC submit] Callback origin ${publicOrigin} (from ${originSource})${isPublicHttps ? '' : ' — NOT a public https URL'}`,
    )

    // ── Create the Didit session ──────────────────────────────────────────────
    const session = await createKycSession(userId, isMobile, publicOrigin)

    // ── Persist the initial record to Firestore ───────────────────────────────
    await saveKycRecord(userId, session.session_id, session.session_token, session.status, {
      rawStatus: session.status,
    })

    console.log(`[KYC submit] Created session ${session.session_id} for uid=${userId}`)

    await audit({
      action: 'KYC_SESSION_CREATED',
      actorEmail: userId, // uid is the stable identifier; the token's email is re-checked by the webhook anyway
      details: { sessionId: session.session_id, isMobile },
      req,
    })

    return NextResponse.json({
      sessionId: session.session_id,
      sessionToken: session.session_token,
      verificationUrl: session.verification_url,
      isDemo: false,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    // ── Our misconfiguration, not a provider hiccup ──────────────────────────
    // Telling a member "try again in a few minutes" when DIDIT_API_KEY is missing is a lie that
    // hides a deployment fault: it will never succeed by waiting. Say that verification is not
    // switched on, log the exact variable, and let the console's connection test show the rest.
    if (err instanceof DiditConfigError) {
      console.error('[KYC submit] Didit is not configured:', message, '|', diditConfigHint() ?? '')
      return NextResponse.json(
        {
          code: 'kyc_not_configured',
          error:
            'Identity verification is not switched on for this site yet. Nothing is wrong with your account — please check back later or contact support.',
        },
        { status: 503 },
      )
    }

    if (err instanceof DiditApiError) {
      // 401/403 means the key or the host is wrong; 400 usually means no credits, an archived
      // workflow or an invalid callback. Both are fixable in the console in minutes — the member
      // cannot fix either, so they get a plain answer either way.
      const credentialsRejected = err.status === 401 || err.status === 403
      console.error(
        `[KYC submit] Didit rejected session creation (${err.status}):`,
        err.detail.slice(0, 400),
        '|',
        diditConfigHint() ?? '',
      )
      return NextResponse.json(
        {
          code: credentialsRejected ? 'kyc_provider_auth' : 'kyc_provider_error',
          error: credentialsRejected
            ? 'Identity verification is not available right now. Your account is fine — support has been notified.'
            : 'Identity verification could not be started right now. Please try again in a few minutes.',
        },
        { status: 502 },
      )
    }

    console.error('[KYC submit]', message)
    // Provider internals (rate limits, API keys in messages) never reach the browser.
    return NextResponse.json(
      {
        code: 'kyc_provider_error',
        error: 'Identity verification could not be started right now. Please try again in a few minutes.',
      },
      { status: 502 },
    )
  }
}
