/**
 * POST /api/kyc/submit
 *
 * Creates a Didit KYC session for the authenticated user and returns
 * the verification URL. The client opens this URL (redirect) and the
 * user completes ID scan, facial match, and liveness on Didit's hosted page.
 *
 * Auth: requires Firebase ID token in Authorization: Bearer header.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createKycSession } from '@/lib/didit'
import { saveKycRecord, verifyIdToken } from '@/lib/firestore-admin'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))

    // Authenticate via Firebase ID token
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

    // Use the authenticated UID — ignore any userId from body to prevent spoofing
    const userId = decoded.uid
    const isMobile: boolean = !!body?.isMobile

    // Determine the public origin for production / reverse-proxy deployments
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const publicOrigin =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      process.env.VERCEL_URL ||
      (host && !host.includes('localhost') && !host.includes('127.0.0.1') ? `${proto}://${host}` : req.nextUrl.origin)

    const session = await createKycSession(userId, isMobile, publicOrigin)

    // Store the Didit session ID together with the authenticated user's ID
    await saveKycRecord(
      userId,
      session.session_id || session.id || '',
      session.session_token || '',
      session.status || 'Pending'
    )

    return NextResponse.json({
      sessionToken: session.session_token,
      sessionId: session.session_id || session.id,
      verificationUrl: session.verification_url,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[KYC submit]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
