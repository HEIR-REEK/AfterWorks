/**
 * POST /api/admin/jobs — job CRUD (admin only).
 *
 * Body: { action: 'create' | 'update' | 'delete' | 'set_status', job? }
 *   - create: job fields (id optional — generated when omitted)
 *   - update: job fields incl. required `id`
 *   - set_status: { id, status }
 *   - delete: { id }
 *
 * Approving applications decrementing slots is handled by the applications
 * route; this route is purely for authoring jobs.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getAdminFirestore } from '@/lib/firestore-admin'
import { COLLECTIONS } from '@/lib/admin-data'
import type { Job, JobStatus } from '@/lib/afterworks-data'

const JOB_STATUSES: JobStatus[] = ['open', 'paused', 'closed']

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'job'
  )
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, configured: auth.configured },
      { status: auth.configured ? auth.status : 501 },
    )
  }

  let body: { action?: string; id?: string; status?: JobStatus; job?: Partial<Job> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const db = getAdminFirestore()
  if (!db) {
    return NextResponse.json({ error: 'Firestore unavailable.', configured: false }, { status: 501 })
  }

  const jobs = db.collection(COLLECTIONS.jobs)

  try {
    switch (body.action) {
      case 'create': {
        const job = body.job
        if (!job?.title?.trim()) {
          return NextResponse.json({ error: 'Job title is required.' }, { status: 400 })
        }
        const capacity = Math.max(1, Math.round(Number(job.capacity ?? 1)))
        const doc = {
          title: job.title.trim(),
          category: job.category ?? 'Data Entry',
          description: job.description ?? '',
          responsibilities: Array.isArray(job.responsibilities) ? job.responsibilities : [],
          payAmountUsd: Math.max(0, Number(job.payAmountUsd ?? 0)),
          estimatedMinutes: Math.max(5, Math.round(Number(job.estimatedMinutes ?? 60))),
          capacity,
          slotsRemaining: Math.max(0, Math.round(Number(job.slotsRemaining ?? capacity))),
          trainingRequired: Boolean(job.trainingRequired),
          requiresVerified: job.requiresVerified !== false,
          status: (job.status ?? 'open') as JobStatus,
          closesAt: job.closesAt ?? new Date(Date.now() + 30 * 864e5).toISOString(),
          postedAgo: 'just now',
          createdAt: new Date().toISOString(),
          createdBy: auth.caller.email ?? auth.caller.uid,
        }
        const ref = body.id ? jobs.doc(body.id) : jobs.doc(`${slugify(doc.title)}-${Date.now().toString(36)}`)
        await ref.set(doc)
        console.log(`[Admin jobs] ${auth.caller.email} created job ${ref.id}`)
        return NextResponse.json({ ok: true, id: ref.id })
      }

      case 'update': {
        const job = body.job
        const id = body.id ?? job?.id
        if (!id || !job) {
          return NextResponse.json({ error: 'Job `id` and fields are required.' }, { status: 400 })
        }
        // Never allow the client to bump slotsRemaining above capacity via edit.
        const capacity = job.capacity !== undefined ? Math.max(1, Math.round(Number(job.capacity))) : undefined
        const patch: Record<string, unknown> = {
          ...(job.title !== undefined ? { title: job.title.trim() } : {}),
          ...(job.category !== undefined ? { category: job.category } : {}),
          ...(job.description !== undefined ? { description: job.description } : {}),
          ...(job.responsibilities !== undefined ? { responsibilities: job.responsibilities } : {}),
          ...(job.payAmountUsd !== undefined ? { payAmountUsd: Math.max(0, Number(job.payAmountUsd)) } : {}),
          ...(job.estimatedMinutes !== undefined
            ? { estimatedMinutes: Math.max(5, Math.round(Number(job.estimatedMinutes))) }
            : {}),
          ...(capacity !== undefined ? { capacity } : {}),
          ...(job.slotsRemaining !== undefined
            ? { slotsRemaining: Math.max(0, Math.round(Number(job.slotsRemaining))) }
            : {}),
          ...(job.trainingRequired !== undefined ? { trainingRequired: Boolean(job.trainingRequired) } : {}),
          ...(job.requiresVerified !== undefined ? { requiresVerified: Boolean(job.requiresVerified) } : {}),
          ...(job.status !== undefined ? { status: job.status } : {}),
          ...(job.closesAt !== undefined ? { closesAt: job.closesAt } : {}),
          updatedAt: new Date().toISOString(),
          updatedBy: auth.caller.email ?? auth.caller.uid,
        }
        await jobs.doc(id).set(patch, { merge: true })
        console.log(`[Admin jobs] ${auth.caller.email} updated job ${id}`)
        return NextResponse.json({ ok: true, id })
      }

      case 'set_status': {
        const id = body.id
        const status = body.status
        if (!id || !status || !JOB_STATUSES.includes(status)) {
          return NextResponse.json({ error: 'Job `id` and valid `status` are required.' }, { status: 400 })
        }
        await jobs.doc(id).set(
          { status, updatedAt: new Date().toISOString(), updatedBy: auth.caller.email ?? auth.caller.uid },
          { merge: true },
        )
        return NextResponse.json({ ok: true, id, status })
      }

      case 'delete': {
        const id = body.id
        if (!id) return NextResponse.json({ error: 'Job `id` is required.' }, { status: 400 })
        await jobs.doc(id).delete()
        console.log(`[Admin jobs] ${auth.caller.email} deleted job ${id}`)
        return NextResponse.json({ ok: true, id })
      }

      default:
        return NextResponse.json({ error: `Unknown action "${body.action}".` }, { status: 400 })
    }
  } catch (err) {
    console.error('[Admin jobs] POST failed:', err)
    return NextResponse.json({ error: 'Failed to save job.' }, { status: 500 })
  }
}
