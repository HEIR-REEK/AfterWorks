/**
 * GET  /api/admin/applications — all applications (admin only).
 * POST /api/admin/applications — lifecycle actions (admin only).
 *
 * Body: { id, action, note? } where action ∈
 *   approve | reject | start_work | submit_review | complete |
 *   request_revision | fail_qa
 *
 * Side effects (mirroring the system spec):
 *   - approve decrements the job's slotsRemaining (transaction, never below 0)
 *   - reject refunds the slot when the application had already been approved
 *   - complete credits the worker's wallet.pendingUsd with the job pay amount
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import * as admin from 'firebase-admin'
import { requireAdmin } from '@/lib/admin-auth'
import { getAdminFirestore } from '@/lib/firestore-admin'
import { COLLECTIONS, type AdminApplication } from '@/lib/admin-data'
import type { ApplicationStatus } from '@/lib/afterworks-data'

const NEXT_STATUS: Record<string, ApplicationStatus> = {
  approve: 'approved',
  reject: 'rejected',
  start_work: 'in_progress',
  submit_review: 'submitted_for_review',
  complete: 'completed',
  request_revision: 'revision_requested',
  fail_qa: 'failed_qa',
}

/** Statuses that hold a reserved slot (slot must be refunded on reject). */
const SLOT_HOLDING: ApplicationStatus[] = ['approved', 'in_progress', 'submitted_for_review', 'revision_requested']

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

    const [appsSnap, usersSnap, jobsSnap] = await Promise.all([
      db.collection(COLLECTIONS.applications).get(),
      db.collection(COLLECTIONS.users).get(),
      db.collection(COLLECTIONS.jobs).get(),
    ])
    const namesById = new Map(usersSnap.docs.map((d) => [d.id, (d.data().name as string) || 'Worker']))

    const items: AdminApplication[] = appsSnap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>
      return {
        id: doc.id,
        userId: (d.userId as string) || '',
        userName: namesById.get((d.userId as string) || '') ?? 'Worker',
        jobId: (d.jobId as string) || '',
        status: (d.status as ApplicationStatus) || 'under_review',
        appliedAt: (d.appliedAt as string) || '',
        reviewExpiresAt: (d.reviewExpiresAt as string) || '',
        rejectionReason: d.rejectionReason as string | undefined,
        revisionNote: d.revisionNote as string | undefined,
        history: Array.isArray(d.history) ? (d.history as AdminApplication['history']) : [],
      }
    })

    void jobsSnap
    return NextResponse.json({ configured: true, items })
  } catch (err) {
    console.error('[Admin applications] GET failed:', err)
    return NextResponse.json(
      { configured: true, items: [], error: 'Failed to load applications.' },
      { status: 500 },
    )
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

  let body: { id?: string; action?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { id, action } = body
  const nextStatus = action ? NEXT_STATUS[action] : undefined
  if (!id || !action || !nextStatus) {
    return NextResponse.json({ error: 'Valid `id` and `action` are required.' }, { status: 400 })
  }
  if (action === 'reject' && !body.note?.trim()) {
    return NextResponse.json({ error: 'A reason is required when rejecting.' }, { status: 400 })
  }
  if (action === 'request_revision' && !body.note?.trim()) {
    return NextResponse.json({ error: 'Describe the required revision.' }, { status: 400 })
  }

  const db = getAdminFirestore()
  if (!db) {
    return NextResponse.json({ error: 'Firestore unavailable.', configured: false }, { status: 501 })
  }

  try {
    const appRef = db.collection(COLLECTIONS.applications).doc(id)
    const nowIso = new Date().toISOString()
    const reviewer = auth.caller.email ?? auth.caller.uid
    let payJobId: string | null = null
    let payUserId: string | null = null
    let payAmount = 0

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(appRef)
      if (!snap.exists) throw new Error('Application not found.')
      const d = snap.data() as {
        jobId: string
        userId: string
        status: ApplicationStatus
        history: { status: ApplicationStatus; at: string }[]
      }

      if (action === 'approve') {
        // Decrement slots atomically; refuse if the job is full.
        const jobRef = db.collection(COLLECTIONS.jobs).doc(d.jobId)
        const jobSnap = await tx.get(jobRef)
        const job = jobSnap.data() as { slotsRemaining?: number; payAmountUsd?: number } | undefined
        const slots = job?.slotsRemaining ?? 0
        if (slots <= 0) throw new Error('No slots remaining for this job.')
        tx.set(jobRef, { slotsRemaining: slots - 1 }, { merge: true })
      }

      if (action === 'reject' && SLOT_HOLDING.includes(d.status)) {
        // Refund the reserved slot back to the job.
        const jobRef = db.collection(COLLECTIONS.jobs).doc(d.jobId)
        const jobSnap = await tx.get(jobRef)
        const slots = jobSnap.data()?.slotsRemaining ?? 0
        tx.set(jobRef, { slotsRemaining: slots + 1 }, { merge: true })
      }

      if (action === 'complete') {
        payJobId = d.jobId
        payUserId = d.userId
        const jobSnap = await tx.get(db.collection(COLLECTIONS.jobs).doc(d.jobId))
        payAmount = Number(jobSnap.data()?.payAmountUsd ?? 0)
      }

      const history = [
        ...(Array.isArray(d.history) ? d.history : []),
        { status: nextStatus, at: nowIso },
      ]
      const update: Record<string, unknown> = {
        status: nextStatus,
        history,
        lastActionBy: reviewer,
        lastActionAt: nowIso,
      }
      if (action === 'reject') update.rejectionReason = body.note?.trim()
      if (action === 'request_revision') update.revisionNote = body.note?.trim()

      tx.set(appRef, update, { merge: true })
    })

    // Credit the worker's pending balance (48–72h clearing window) on QA pass.
    if (action === 'complete' && payUserId) {
      const userRef = db.collection(COLLECTIONS.users).doc(payUserId)
      await userRef.set(
        {
          wallet: {
            pendingUsd: admin.firestore.FieldValue.increment(payAmount),
          },
        },
        { merge: true },
      )
    }

    console.log(`[Admin applications] ${reviewer} → ${action} on ${id}`)
    return NextResponse.json({ ok: true, status: nextStatus })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update application.'
    console.error('[Admin applications] POST failed:', err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
