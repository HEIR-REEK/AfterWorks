export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server';
import { createKycSession } from '@/lib/didit';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required.' },
        { status: 400 },
      );
    }

    const session = await createKycSession(userId);

    return NextResponse.json({
      sessionToken: session.session_token,
      verificationUrl: session.verification_url,
    });
  } catch (err) {
    console.error('KYC submit error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
