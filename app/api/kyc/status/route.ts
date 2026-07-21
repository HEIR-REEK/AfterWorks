export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server';
import { getKycSessionStatus } from '@/lib/didit';
import { updateUserProfile, saveKycRecord } from '@/lib/firestore-admin'; // Use server-side admin SDK

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    const userId = req.nextUrl.searchParams.get('userId');

    if (!sessionId || !userId) {
      return NextResponse.json(
        { error: 'Session ID and User ID are required.' },
        { status: 400 },
      );
    }

    // Polling fallback strategy: manually check Didit session status
    const statusData = await getKycSessionStatus(sessionId);

    // Save status update to kyc_records
    await saveKycRecord(
      userId,
      statusData.session_id || statusData.id || sessionId,
      '', // Optional sessionToken can be empty here
      statusData.status
    );
    
    const isApproved = statusData.status === 'Approved' || statusData.status === 'Verified';
    const isRejected = statusData.status === 'Declined' || statusData.status === 'Rejected';

    if (isApproved) {
      // For the mock / prototype, update the firestore user profile
      await updateUserProfile(userId, { 
        kycVerified: true, 
        accountState: 'active' 
      });
    }

    return NextResponse.json({
      status: statusData.status,
      isApproved,
      isRejected,
      // Pass the raw data back for the client to handle
      data: statusData
    });
  } catch (err) {
    console.error('KYC status check error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
