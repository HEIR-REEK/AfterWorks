/**
 * GET  /api/admin/kyc — KYC review queue: all kyc_records joined with user
 *                       names/emails (admin only).
 * POST /api/admin/kyc — manual KYC decision (admin only).
 *
 * Body: { uid, action: 'approve' | 'reject' | 'hold' | 'resubmission', reason? }
 *
 * The decision mirrors the Didit webhook logic: kyc_records/{uid} is updated
 * and the user's profile flips to active / kyc_rejected / kyc_on_hold /
 * kyc_resubmission accordingly.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import * as admin from 'firebase-admin'
import { requireAdmin } from '@/lib/admin-auth'
import { getAdminFirestore } from '@/lib/firestore-admin'
import {
  COLLECTIONS,
  type AdminKycItem,
  type AdminKycStatus,
} from '@/lib/admin-data'

type KycAction = 'approve' | 'reject' | 'hold' | 'resubmission'

const ACTION_TO_STATUS: Record<KycAction, AdminKycStatus> = {
  approve: 'Approved',
  reject: 'Declined',
  hold: 'OnHold',
  resubmission: 'Resubmission',
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, configured: auth.configured },
      { status: auth.configured ? auth.status : 501 },
    )
  }

  try {
    const db = getAdminFirestore()
    if (!db) throw new Error('Firestore unavailable')

    const [recordsSnap, usersSnap] = await Promise.all([
      db.collection(COLLECTIONS.kycRecords).get(),
      db.collection(COLLECTIONS.users).get(),
    ])
    const usersById = new Map<string, { name?: string; email?: string }>()
    for (const doc of usersSnap.docs) {
      const d = doc.data()
      usersById.set(doc.id, { name: d.name, email: d.email })
    }

    const items: AdminKycItem[] = recordsSnap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>
      const user = usersById.get(doc.id)
      return {
        uid: doc.id,
        userName: user?.name || 'Unnamed worker',
        userEmail: user?.email || '',
        sessionId: (d.sessionId as string) || '',
        status: ((d.status as AdminKycStatus) || 'Pending'),
        rawStatus: d.rawStatus as string | undefined,
        rejectionReason: (d.rejectionReason as string) ?? null,
        failedChecks: Array.isArray(d.failedChecks) ? (d.failedChecks as string[]) : null,
        attemptCount: typeof d.attemptCount === 'number' ? d.attemptCount : 1,
        firstAttemptAt:
          (d.firstAttemptAt as string) ??
          (d.firstAttemptAt as { toDate?: () => Date })?.toDate?.()?.toISOString(),
        updatedAt:
          (d.updatedAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? undefined,
      }
    })

    return NextResponse.json({ configured: true, items })
  } catch (err) {
    console.error('[Admin KYC] GET failed:', err)
    return NextResponse.json({ configured: true, items: [], error: 'Failed to load KYC records.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, configured: auth.configured },
      { status: auth.configured ? auth.status : 501 },
    )
  }

  let body: { uid?: string; action?: KycAction; reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { uid, action } = body
  if (!uid || !action || !ACTION_TO_STATUS[action]) {
    return NextResponse.json(
      { error: '`uid` and a valid `action` (approve | reject | hold | resubmission) are required.' },
      { status: 400 },
    )
  }
  if (action === 'reject' && !body.reason?.trim()) {
    return NextResponse.json({ error: 'A reason is required when rejecting.' }, { status: 400 })
  }

  const db = getAdminFirestore()
  if (!db) {
    return NextResponse.json({ error: 'Firestore unavailable.', configured: false }, { status: 501 })
  }

  const nowIso = new Date().toISOString()
  const status = ACTION_TO_STATUS[action]
  const reason = body.reason?.trim()

  try {
    // 1. KYC record
    const recordUpdate: Record<string, unknown> = {
      status,
      rawStatus: `admin:${action}`,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: auth.caller.email ?? auth.caller.uid,
      reviewedAt: nowIso,
    }
    if (reason) recordUpdate.rejectionReason = reason
    if (action === 'approve') recordUpdate.failedChecks = []

    await db.collection(COLLECTIONS.kycRecords).doc(uid).set(recordUpdate, { merge: true })

    // 2. User profile — mirror the webhook behaviour
    const userUpdate: Record<string, unknown> = {
      kycStatus: status,
      kycProvider: 'Didit',
      kycLevel: 'Identity',
      [`kycReview.lastDecisionBy`]: auth.caller.email ?? auth.caller.uid,
      [`kycReview.lastDecisionAt`]: nowIso,
    }
    if (action === 'approve') {
      userUpdate.kycVerified = true
      userUpdate.accountState = 'active'
      userUpdate.kycVerifiedAt = nowIso
      userUpdate.kycRejectionReason = null
      userUpdate.kycFailedChecks = null
    } else if (action === 'reject') {
      userUpdate.kycVerified = false
      userUpdate.accountState = 'kyc_rejected'
      userUpdate.kycRejectedAt = nowIso
      userUpdate.kycRejectionReason = reason ?? null
    } else if (action === 'hold') {
      userUpdate.kycVerified = false
      userUpdate.accountState = 'kyc_on_hold'
      userUpdate.kycOnHoldAt = nowIso
      if (reason) userUpdate.kycRejectionReason = reason
    } else {
      userUpdate.kycVerified = false
      userUpdate.accountState = 'kyc_resubmission'
      if (reason) userUpdate.kycRejectionReason = reason
    }

    await db.collection(COLLECTIONS.users).doc(uid).set(userUpdate, { merge: true })

    console.log(`[Admin KYC] ${auth.caller.email} → ${action} for uid=${uid}`)
    return NextResponse.json({ ok: true, status })
  } catch (err) {
    console.error('[Admin KYC] POST failed:', err)
    return NextResponse.json({ error: 'Failed to record KYC decision.' }, { status: 500 })
  }
}
