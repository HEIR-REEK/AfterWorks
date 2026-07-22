/**
 * POST /api/kyc/webhook
 *
 * Didit calls this endpoint when a KYC session status changes.
 * We verify the signature, then update the user's Firestore document.
 *
 * Configure this URL in the Didit Business Console under API & Webhooks.
 * URL to register: https://your-domain.com/api/kyc/webhook
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/didit'
import { updateUserProfile, saveKycRecord } from '@/lib/firestore-admin'

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const signature = req.headers.get('x-signature-v2') || req.headers.get('x-didit-signature')

    // Verify signature to ensure the request is from Didit
    const isValid = await verifyWebhookSignature(rawBody, signature)
    if (!isValid) {
      console.warn('[KYC webhook] Invalid signature — rejecting request.')
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody)
    const { vendor_data: userId, status, session_token } = payload

    console.log(`[KYC webhook] session=${session_token} status=${status} uid=${userId}`)

    if (!userId) {
      return NextResponse.json({ error: 'Missing vendor_data (userId).' }, { status: 400 })
    }

    // Save status update to kyc_records
    await saveKycRecord(
      userId,
      payload.session_id || payload.id || '',
      session_token || '',
      status
    )

    // Map Didit statuses → our Firestore field (case-insensitive)
    const statusLower = (status || '').toString().toLowerCase()
    const nowIso = new Date().toISOString()
    
    if (statusLower === 'approved' || statusLower === 'verified' || statusLower === 'completed') {
      await updateUserProfile(userId, { 
        kycVerified: true, 
        accountState: 'active',
        kycVerifiedAt: nowIso,
        kycProvider: 'Didit',
        kycLevel: payload.verification_level || 'Identity',
        kycStatus: status
      })
      console.log(`[KYC webhook] Marked uid=${userId} as KYC verified at ${nowIso}.`)
    } else if (statusLower === 'declined' || statusLower === 'rejected' || statusLower === 'failed') {
      await updateUserProfile(userId, { 
        kycVerified: false, 
        accountState: 'kyc_rejected',
        kycStatus: status
      })
      console.log(`[KYC webhook] KYC declined for uid=${userId}.`)
    }
    // Other statuses (Pending, InProgress, etc.) — do nothing

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[KYC webhook] Error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
