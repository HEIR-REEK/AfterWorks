/**
 * GET  /api/admin/users — list all user profiles (admin only).
 * POST /api/admin/users — moderation actions on a user (admin only).
 *
 * Actions:
 *   { action: 'set_state', uid, accountState, reason? }
 *   { action: 'set_quality', uid, qualityScore }
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import * as admin from 'firebase-admin'
import { requireAdmin } from '@/lib/admin-auth'
import { firebaseAdminConfigured, getAdminFirestore } from '@/lib/firestore-admin'
import { COLLECTIONS, type AdminUser } from '@/lib/admin-data'

const ALLOWED_STATES = new Set([
  'active',
  'kyc_rejected',
  'kyc_resubmission',
  'kyc_on_hold',
  'kyc_abandoned',
  'kyc_expired',
])

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

    const [usersSnap, adminsSnap] = await Promise.all([
      db.collection(COLLECTIONS.users).get(),
      db.collection(COLLECTIONS.admins).get(),
    ])
    const adminUids = new Set(adminsSnap.docs.map((d) => d.id))

    const users: AdminUser[] = usersSnap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>
      const wallet = d.wallet as Record<string, unknown> | undefined
      return {
        uid: doc.id,
        name: (d.name as string) || 'Unnamed worker',
        email: (d.email as string) || '',
        accountState: (d.accountState as string) || 'active',
        kycVerified: Boolean(d.kycVerified),
        qualityScore: typeof d.qualityScore === 'number' ? d.qualityScore : 100,
        jobsCompleted: typeof d.jobsCompleted === 'number' ? d.jobsCompleted : 0,
        memberSince: d.memberSince as string | undefined,
        phone: (d.phone as string) || undefined,
        location: (d.location as string) || undefined,
        bio: (d.bio as string) || undefined,
        createdAt: (d.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString(),
        isAdmin: adminUids.has(doc.id),
        wallet: wallet
          ? {
              pendingUsd: Number(wallet.pendingUsd ?? 0),
              availableUsd: Number(wallet.availableUsd ?? 0),
              payoutNumber: String(wallet.payoutNumber ?? ''),
            }
          : undefined,
        paidTrainings: Array.isArray(d.paidTrainings) ? (d.paidTrainings as string[]) : undefined,
      }
    })

    return NextResponse.json({ configured: true, users })
  } catch (err) {
    console.error('[Admin users] GET failed:', err)
    return NextResponse.json({ configured: true, users: [], error: 'Failed to load users.' }, { status: 500 })
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

  let body: {
    action?: string
    uid?: string
    accountState?: string
    reason?: string
    qualityScore?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body.uid || !body.action) {
    return NextResponse.json({ error: '`uid` and `action` are required.' }, { status: 400 })
  }

  const db = getAdminFirestore()
  if (!db) {
    return NextResponse.json({ error: 'Firestore unavailable.', configured: false }, { status: 501 })
  }

  const userRef = db.collection(COLLECTIONS.users).doc(body.uid)

  try {
    if (body.action === 'set_state') {
      if (!body.accountState || !ALLOWED_STATES.has(body.accountState)) {
        return NextResponse.json({ error: 'Invalid accountState.' }, { status: 400 })
      }

      const update: Record<string, unknown> = {
        accountState: body.accountState,
        [`moderation.lastStateChangeAt`]: admin.firestore.FieldValue.serverTimestamp(),
        [`moderation.lastStateChangeBy`]: auth.caller.email ?? auth.caller.uid,
      }

      if (body.accountState === 'active') {
        // Approving an account out of a KYC failure state verifies them.
        const snap = await userRef.get()
        if (snap.exists && snap.data()?.kycVerified !== true) {
          update.kycVerified = true
          update.kycVerifiedAt = new Date().toISOString()
        }
        update.kycRejectionReason = null
        update.kycFailedChecks = null
      } else {
        update.kycVerified = false
        if (body.reason) update.kycRejectionReason = body.reason.slice(0, 500)
      }

      await userRef.set(update, { merge: true })
      console.log(`[Admin users] ${auth.caller.email} set ${body.uid} → ${body.accountState}`)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'set_quality') {
      const score = Math.max(0, Math.min(100, Math.round(Number(body.qualityScore))))
      if (isNaN(score)) {
        return NextResponse.json({ error: 'qualityScore must be a number.' }, { status: 400 })
      }
      await userRef.set({ qualityScore: score }, { merge: true })
      return NextResponse.json({ ok: true, qualityScore: score })
    }

    return NextResponse.json({ error: `Unknown action "${body.action}".` }, { status: 400 })
  } catch (err) {
    console.error('[Admin users] POST failed:', err)
    return NextResponse.json({ error: 'Failed to update user.' }, { status: 500 })
  }
}
