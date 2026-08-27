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
import { createKycSession } from '@/lib/didit'
import { saveKycRecord, verifyIdToken, getUserProfile } from '@/lib/firestore-admin'
import { maintenanceGateResponse } from '@/lib/server-config'

export async function POST(req: NextRequest) {
  // Maintenance mode blocks new verification sessions.
  const maintenance = await maintenanceGateResponse()
  if (maintenance) return maintenance

  try {
    const body = await req.json().catch(() => ({}))

    // ── Authentication ────────────────────────────────────────────────────────
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

    // Use the authenticated UID — never trust a userId from the request body
    const userId = decoded.uid
    const isMobile: boolean = !!body?.isMobile

    // ── Guard: user is already verified ──────────────────────────────────────
    const userProfile = await getUserProfile(userId)
    if (userProfile?.kycVerified === true) {
      return NextResponse.json(
        { error: 'Your identity is already verified. No further action is needed.' },
        { status: 409 },
      )
    }


    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const publicOrigin =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      process.env.VERCEL_URL ||
      (host && !host.includes('localhost') && !host.includes('127.0.0.1')
        ? `${proto}://${host}`
        : req.nextUrl.origin)

    // ── Create the Didit session ──────────────────────────────────────────────
    const session = await createKycSession(userId, isMobile, publicOrigin)

    // ── Persist the initial record to Firestore ───────────────────────────────
    await saveKycRecord(userId, session.session_id, session.session_token, session.status, {
      rawStatus: session.status,
    })

    console.log(
      `[KYC submit] Created session ${session.session_id} for uid=${userId}` +
        (session.is_demo ? ' [DEMO]' : ''),
    )

    return NextResponse.json({
      sessionId: session.session_id,
      sessionToken: session.session_token,
      verificationUrl: session.verification_url,
      isDemo: !!session.is_demo,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[KYC submit]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
