import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, maintenanceBlockForApi, requireUser, routeError } from '@/lib/guards'
import { sanitizeLine } from '@/lib/security-core'

/**
 * /api/applications — real job applications.
 *
 * This is the piece that turns the site from a prototype into a working product. Applications used
 * to live in `localStorage` only: a worker's "Applied" list was per-device, invisible to the ops
 * console except when someone happened to sync it, and *anything* about it was editable by the
 * worker (status, history, which jobs they had been paid for). The console then had to trust it.
 *
 * Now: the server owns the record, the eligibility rules (KYC, account state, training gate,
 * slot capacity, duplicate guard) run inside a transaction, and the console reads the same document
 * the worker sees.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  try {
    const { dbOrNull } = await import('@/lib/firestore-admin')
    const db = dbOrNull()
    if (!db) return json({ ok: true, applications: [], unavailable: true })

    const uid = guard.value.uid
    const cap = Math.min(100, Math.max(5, Number(req.nextUrl.searchParams.get('limit') ?? 40)))
    const [appsSnap, jobsSnap] = await Promise.all([
      db.collection('applications').where('workerUid', '==', uid).limit(cap).get(),
      db.collection('jobs').limit(200).get(),
    ])

    const titles = new Map<string, string>()
    jobsSnap.forEach((d) => {
      const data = (d.data() ?? {}) as Record<string, unknown>
      titles.set(d.id, String(data.title ?? ''))
    })

    const applications = appsSnap.docs
      .map((d) => {
        const data = (d.data() ?? {}) as Record<string, unknown>
        return {
          id: d.id,
          jobId: String(data.jobId ?? ''),
          jobTitle: titles.get(String(data.jobId ?? '')) || String(data.jobTitle ?? 'Job'),
          status: String(data.status ?? 'under_review'),
          appliedAt: String(data.appliedAt ?? ''),
          updatedAt: (data.updatedAt as string) ?? undefined,
          reviewExpiresAt: (data.reviewExpiresAt as string) ?? undefined,
          rejectionReason: (data.rejectionReason as string) ?? undefined,
          revisionNote: (data.revisionNote as string) ?? undefined,
          payAmountUsd: Number(data.payAmountUsd ?? 0) || 0,
          history: Array.isArray(data.history) ? (data.history as { status: string; at: string }[]) : [],
        }
      })
      .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)))

    return json({ ok: true, applications, count: applications.length })
  } catch (err) {
    return routeError('applications:GET', err)
  }
}

export async function POST(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('apply', 20, 60_000, guard.value.uid)
  if (!bucket.ok) {
    return fail(429, 'You are applying very quickly. Please wait a minute.', {
      headers: { 'Retry-After': String(bucket.retryAfterSec) },
    })
  }

  let jobId = ''
  try {
    const raw = await req.text()
    if (raw.length > 8_000) return fail(413, 'Payload is too large.', { code: 'payload_too_large' })
    const body = JSON.parse(raw || '{}')
    jobId = sanitizeLine(body.jobId, 90)
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }
  if (!jobId) return fail(400, 'Pick a job before applying.', { code: 'missing_job' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) {
      return fail(503, 'Applications cannot be accepted right now. Please try again in a few minutes.', { code: 'storage_unavailable' })
    }
    const { applicationId } = await firestore.createApplicationServer(guard.value.uid, jobId)
    return json({ ok: true, applicationId, status: 'under_review' }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not record your application.'
    // Worker-facing refusals are expected (slots, KYC, duplicates) → 409/403, not a 500.
    if (/verify|verification|suspended|eligible|closed|full|already|training|complete|no longer|not found/i.test(message)) {
      const status = /suspended|eligible|verify|verification|training|complete/i.test(message) ? 403 : 409
      return fail(status, message, { code: 'application_refused' })
    }
    return routeError('applications:POST', err)
  }
}

export async function PATCH(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('apply-patch', 30, 60_000, guard.value.uid)
  if (!bucket.ok) return fail(429, 'Too many updates. Please wait a minute.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })

  let body: Record<string, unknown>
  try {
    body = JSON.parse((await req.text()).slice(0, 16_000) || '{}')
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }

  const applicationId = sanitizeLine(body.applicationId, 128)
  const action = String(body.action ?? '')
  if (!applicationId) return fail(400, 'An application id is required.', { code: 'missing_id' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.dbOrNull()) return fail(503, 'Storage unavailable.', { code: 'storage_unavailable' })

    if (action === 'withdraw') {
      await firestore.withdrawApplicationServer(guard.value.uid, applicationId)
      return json({ ok: true, status: 'withdrawn' })
    }

    if (action === 'submit_work') {
      const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : ''
      await firestore.submitWorkServer(guard.value.uid, applicationId, note)
      await firestore.notifyUser(guard.value.uid, {
        title: 'Submission received',
        body: 'Your work is in the review queue. QA usually responds within 48 hours.',
        tone: 'info',
        link: '/applications',
      })
      return json({ ok: true, status: 'submitted_for_review' })
    }

    return fail(400, `Unsupported action "${action || '(blank)'}".`, { code: 'unknown_action' })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/own applications|not found|cannot be withdrawn|already/i.test(message)) return fail(409, message, { code: 'transition_denied' })
    return routeError('applications:PATCH', err)
  }
}
