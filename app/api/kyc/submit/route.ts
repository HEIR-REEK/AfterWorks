/**
 * POST /api/kyc/submit
 *
 * Creates a Didit KYC session for the authenticated user and returns
 * the verification URL. The client opens this URL (redirect) and the
 * user completes ID scan, facial match, and liveness on Didit's hosted page.
 *
 * Auth: expects { userId } in the JSON body (client is already Firebase-authed).
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createKycSession } from '@/lib/didit'
import { saveKycRecord } from '@/lib/firestore-admin'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const userId: string = body?.userId?.trim()
    const isMobile: boolean = !!body?.isMobile

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required.' },
        { status: 400 },
      )
    }

    // Create the Didit KYC session for this user using the request's origin
    const origin = req.nextUrl.origin
    const session = await createKycSession(userId, isMobile, origin)

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
