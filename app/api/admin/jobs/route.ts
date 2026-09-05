import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, requireAdmin, routeError } from '@/lib/guards'
import { sanitizeLine } from '@/lib/security-core'

/**
 * /api/admin/jobs — the catalogue desk.
 *
 * Slots, pay and status are business-critical fields. Writing them from the browser meant the
 * same rules that let a worker read `jobs` also had to be *trusted* not to let them write jobs;
 * now the only writer is this route, which normalises every field (pay clamped, capacity ≥ 1,
 * slots never above capacity, categories whitelisted) and audits each change.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response
  try {
    const firestore = await import('@/lib/firestore-admin')
    const jobs = await firestore.listJobsServer({
      status: req.nextUrl.searchParams.get('status') ?? 'all',
      pageSize: Number(req.nextUrl.searchParams.get('pageSize') ?? 100),
    })
    return json({ ok: true, jobs, count: jobs.length })
  } catch (err) {
    return routeError('admin/jobs:GET', err)
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const raw = await req.text()
    // A job now carries authored training sections and quiz questions, so the old 64 KB cap would
    // silently reject a legitimately long course. 512 KB still leaves generous headroom below
    // Firestore's 1 MiB document limit after sanitising.
    if (raw.length > 512_000) return null
    return JSON.parse(raw || '{}')
  } catch {
    return null
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('admin-jobs', 30, 60_000, String(guard.value.jti).slice(0, 12))
  if (!bucket.ok) return fail(429, 'Job editing is rate limited. Please wait.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })

  const body = await readBody(req)
  if (!body) return fail(400, 'Expected a JSON body.', { code: 'bad_request' })

  const title = sanitizeLine(body.title, 120)
  if (title.length < 4) return fail(400, 'Give the job a title of at least 4 characters.', { code: 'invalid_title' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Storage unavailable — nothing was saved.', { code: 'storage_unavailable' })

    const result = await firestore.upsertJob(
      {
        id: typeof body.id === 'string' ? sanitizeLine(body.id, 80) : undefined,
        title,
        category: String(body.category ?? 'Data Entry'),
        description: typeof body.description === 'string' ? body.description.slice(0, 4000) : '',
        responsibilities: Array.isArray(body.responsibilities)
          ? (body.responsibilities as unknown[]).map((line) => String(line))
          : [],
        payAmountUsd: Number(body.payAmountUsd ?? 0),
        estimatedMinutes: Number(body.estimatedMinutes ?? 60),
        capacity: Number(body.capacity ?? 10),
        slotsRemaining: body.slotsRemaining === undefined ? undefined : Number(body.slotsRemaining),
        trainingRequired: body.trainingRequired === true,
        // Per-job training price + authored content. Shape-checked here, depth-limited and
        // normalised by sanitizeJob() — the browser never gets to decide the real bounds.
        trainingFeeUsd: body.trainingFeeUsd === undefined ? undefined : Number(body.trainingFeeUsd),
        trainingNotes: Array.isArray(body.trainingNotes)
          ? (body.trainingNotes as { title?: unknown; content?: unknown }[]).map((section) => ({
              title: String(section?.title ?? ''),
              content: String(section?.content ?? ''),
            }))
          : [],
        assessmentQuestions: Array.isArray(body.assessmentQuestions)
          ? (body.assessmentQuestions as { question?: unknown; options?: unknown; correctIndex?: unknown }[]).map((question) => ({
              question: String(question?.question ?? ''),
              options: Array.isArray(question?.options) ? (question.options as unknown[]).map(String) : [],
              correctIndex: Number(question?.correctIndex ?? 0),
            }))
          : [],
        requiresVerified: body.requiresVerified !== false,
        status: String(body.status ?? 'open'),
        closesAt: typeof body.closesAt === 'string' ? body.closesAt : undefined,
      },
      guard.value.email,
    )

    await audit({ action: 'JOB_SAVED', actorEmail: guard.value.email, details: { jobId: result.id, title }, req })
    return json({ ok: true, ...result })
  } catch (err) {
    return routeError('admin/jobs:PUT', err)
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response
  const body = await readBody(req)
  if (!body) return fail(400, 'Expected a JSON body.', { code: 'bad_request' })

  const jobId = sanitizeLine(body.jobId, 80)
  const status = String(body.status ?? '')
  if (!jobId) return fail(400, 'A job id is required.', { code: 'missing_id' })
  if (!['open', 'paused', 'closed'].includes(status)) return fail(400, 'Unknown job status.', { code: 'invalid_status' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    await firestore.setJobStatus(jobId, status, guard.value.email)
    return json({ ok: true, jobId, status })
  } catch (err) {
    return routeError('admin/jobs:PATCH', err)
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response
  const jobId = sanitizeLine(req.nextUrl.searchParams.get('jobId'), 80)
  if (!jobId) return fail(400, 'A job id is required.', { code: 'missing_id' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    await firestore.deleteJob(jobId, guard.value.email)
    await audit({ action: 'JOB_DELETED', actorEmail: guard.value.email, details: { jobId }, req })
    return json({ ok: true, jobId })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/active applications/i.test(message)) return fail(409, message, { code: 'job_busy' })
    return routeError('admin/jobs:DELETE', err)
  }
}
