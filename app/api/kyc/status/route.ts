export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server';
import { getKycSessionStatus } from '@/lib/didit';
import { updateUserProfile, saveKycRecord, verifyIdToken } from '@/lib/firestore-admin';

export async function GET(req: NextRequest) {
  try {
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

    const sessionId =
      req.nextUrl.searchParams.get('sessionId') ||
      req.nextUrl.searchParams.get('session_id') ||
      req.nextUrl.searchParams.get('sessionToken') ||
      req.nextUrl.searchParams.get('session_token')

    // Use authenticated UID — prevent spoofing
    const userId = decoded.uid

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required.' },
        { status: 400 },
      )
    }

    // Polling fallback strategy: manually check Didit session status
    const statusData = await getKycSessionStatus(sessionId)

    // Save status update to kyc_records
    await saveKycRecord(
      userId,
      statusData.session_id || statusData.id || sessionId,
      statusData.session_token || '',
      statusData.status || statusData.state || 'Pending'
    )
    
    const rawStatus = (statusData.status || statusData.state || '').toString()
    const statusLower = rawStatus.toLowerCase()
    const isApproved = statusLower === 'approved' || statusLower === 'verified' || statusLower === 'completed'
    const isRejected = statusLower === 'declined' || statusLower === 'rejected' || statusLower === 'failed'

    if (isApproved) {
      await updateUserProfile(userId, { 
        kycVerified: true, 
        accountState: 'active' 
      })
    } else if (isRejected) {
      await updateUserProfile(userId, { 
        kycVerified: false, 
        accountState: 'kyc_rejected' 
      })
    }

    return NextResponse.json({
      status: rawStatus,
      isApproved,
      isRejected,
      data: statusData
    })
  } catch (err) {
    console.error('KYC status check error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
