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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const userId: string = body?.userId?.trim()

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required.' },
        { status: 400 },
      )
    }

    // Create the Didit KYC session for this user
    const session = await createKycSession(userId)

    return NextResponse.json({
      sessionToken: session.session_token,
      verificationUrl: session.verification_url,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[KYC submit]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
