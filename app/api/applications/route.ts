import { after, NextRequest } from 'next/server'
import { consumeBucket, fail, json, maintenanceBlockForApi, requireUser, requireVerifiedUser, routeError } from '@/lib/guards'
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

/**
 * Refuse an application to a card that belongs to another region's board.
 *
 * Reads the card's `region` and compares it with the region this request's connection resolves to.
 * A card with no region is global — the pre-region behaviour — and is allowed everywhere, so this
 * cannot lock anybody out of work that already existed.
 *
 * Fails **open** when the region cannot be resolved: the point of the rule is to enforce the board,
 * not to make a member's application depend on a geo lookup being configured. A missing answer is
 * our problem, and blocking a legitimate application over it would be a worse outcome than allowing
 * a card the member could already see.
 */
async function checkJobRegionForRequest(
  req: NextRequest,
  jobId: string,
): Promise<{ ok: true } | { ok: false; message: string; jobRegion: string }> {
  try {
    const { dbOrNull } = await import('@/lib/firestore-admin')
    const db = dbOrNull()
    if (!db) return { ok: true }
    const snap = await db.collection('jobs').doc(jobId).get()
    if (!snap.exists) return { ok: true } // the application itself reports "no longer listed"

    const { jobAudienceOf, JOB_REGION_LABELS } = await import('@/lib/job-regions')
    const audience = jobAudienceOf((snap.data() ?? {}).region)
    if (audience.kind === 'global') return { ok: true }

    const { clientIdentity } = await import('@/lib/security-core')
    const { resolveRequestCountry } = await import('@/lib/geo-country')
    const { regionForCountry } = await import('@/lib/pay-regions')
    const identity = clientIdentity(req.headers)
    const resolved = await resolveRequestCountry(req.headers, identity.ip)
    if (!resolved.country) return { ok: true }
    if (regionForCountry(resolved.country) === audience.region) return { ok: true }

    return {
      ok: false,
      jobRegion: audience.region,
      message: `This job card is part of the ${JOB_REGION_LABELS[audience.region]} board, and you are connecting from ${JOB_REGION_LABELS[regionForCountry(resolved.country)]}. Connect from the ${JOB_REGION_LABELS[audience.region]} to apply.`,
    }
  } catch {
    // A failed lookup must not block an application.
    return { ok: true }
  }
}

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

  const guard = await requireVerifiedUser(req)
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
    // The board only *shows* a member their region's cards; this is what actually stops them
    // applying to another region's card by pasting its id from a previous session, a shared link or
    // a friend's screen. The region comes from this request's own connection, so a member who moves
    // to a VPN in the Americas can apply to Americas cards — by design, not by accident.
    const regionCheck = await checkJobRegionForRequest(req, jobId)
    if (!regionCheck.ok) {
      return fail(403, regionCheck.message, { code: 'region_locked', details: { jobRegion: regionCheck.jobRegion } })
    }

    const application = await firestore.createApplicationServer(guard.value.uid, jobId)

    // Send the receipt after the response so a slow or rejected email can never turn a recorded
    // application into an error. The application document is the source of truth; email is a courtesy.
    after(async () => {
      try {
        const { sendEmail, isResendConfigured, applicationReceiptEmailSubject, applicationReceiptEmailText, applicationReceiptEmailHtml } = await import('@/lib/email')
        if (!isResendConfigured() || !application.workerEmail) return
        const copy = {
          name: application.workerName,
          email: application.workerEmail,
          jobTitle: application.jobTitle,
          applicationId: application.applicationId,
        }
        const result = await sendEmail({
          to: application.workerEmail,
          subject: applicationReceiptEmailSubject(application.jobTitle),
          html: applicationReceiptEmailHtml(copy),
          text: applicationReceiptEmailText(copy),
          tag: 'application-receipt',
        })
        if (!result.ok) console.warn('[applications] receipt email not sent:', result.code)
      } catch (err) {
        console.warn('[applications] receipt email failed:', err instanceof Error ? err.message : err)
      }
    })

    return json({ ok: true, applicationId: application.applicationId, status: 'under_review' }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not record your application.'
    // Worker-facing refusals are expected (slots, KYC, duplicates) → 409/403, not a 500.
    if (/verify|verification|suspended|eligible|closed|full|already|training|assessment|complete|no longer|not found/i.test(message)) {
      const status = /suspended|eligible|verify|verification|training|assessment|complete/i.test(message) ? 403 : 409
      return fail(status, message, { code: 'application_refused' })
    }
    return routeError('applications:POST', err)
  }
}

export async function PATCH(req: NextRequest) {
  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireVerifiedUser(req)
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
