export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server';
import { getKycSessionStatus } from '@/lib/didit';
import { updateUserProfile, saveKycRecord } from '@/lib/firestore-admin'; // Use server-side admin SDK

export async function GET(req: NextRequest) {
  try {
    const sessionId =
      req.nextUrl.searchParams.get('sessionId') ||
      req.nextUrl.searchParams.get('session_id') ||
      req.nextUrl.searchParams.get('sessionToken') ||
      req.nextUrl.searchParams.get('session_token')
    const userId =
      req.nextUrl.searchParams.get('userId') ||
      req.nextUrl.searchParams.get('vendor_data')

    if (!sessionId || !userId) {
      return NextResponse.json(
        { error: 'Session ID and User ID are required.' },
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
