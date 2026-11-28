import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, requireVerifiedUser, routeError } from '@/lib/guards'
import { readJsonBody, sanitizeLine } from '@/lib/security-core'
import { publicAssessmentQuestions } from '@/lib/assessment-bank'
import { gateJobId } from '@/lib/job-region-gate'
import { taskPayUsd, taskRateUsd, taskTimerMinutes, taskTimerState, describeRemaining, type TaskCard } from '@/lib/task-pay'
import { resolveWorkerRegion, type RegionalPay } from '@/lib/pay-regions'

/**
 * /api/assessments — server-authoritative assessment.
 *
 * GET returns the questions without `correctIndex`/`explanation`. POST scores the submitted
 * answers against the copy of the answer key that never leaves the server, writes
 * `users.assessmentPasses/{jobId}` itself on a pass, and returns the review only after scoring.
 *
 * An assessment is a **paid task** now, and this route is where that happens. GET starts the task's
 * timer (server-side, one run per member per card, resuming rather than restarting) and reports how
 * long is left; POST refuses to score anything until that timer has run out, then credits the rate ×
 * the hours worked to the member's wallet. The platform's rule: "when time passes the submission is
 * never made" — until the timer is done there is no submission to make.
 *
 * The old flow shipped the answers in the public job catalogue and let the browser set its own
 * pass flag. Both are gone: `/api/applications` requires the server-written pass, and the money is
 * credited from `task_runs`, which the client cannot write.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireVerifiedUser(req)
  if (!guard.ok) return guard.response
  const jobId = sanitizeLine(req.nextUrl.searchParams.get('jobId'), 128)
  if (!jobId) return fail(400, 'A job id is required.', { code: 'missing_job' })
  try {
    // Region lock first: another board's card must not even yield its questions, or a member with an
    // unblurred grid could read and pass its assessment they are not entitled to take.
    const gated = await gateJobId(req, jobId, guard.value.uid)
    if (!gated.gate.ok) return fail(403, gated.gate.message, { code: 'region_locked', details: { jobRegion: gated.gate.jobRegion } })

    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Assessment is temporarily unavailable.', { code: 'storage_unavailable' })
    const source = await firestore.getAssessmentSource(jobId)
    if (!source) return fail(404, 'That job could not be found.', { code: 'job_not_found' })
    const timer = await startTaskTimer(firestore, guard.value.uid, jobId, gated.job, source.passMark)
    return json({
      ok: true,
      jobTitle: source.jobTitle,
      questions: publicAssessmentQuestions(source.questions),
      passMark: source.passMark,
      total: source.questions.length,
      authored: source.authored,
      // The task's clock and what finishing it is worth. Both are server-computed; the client only
      // counts down for display.
      timer,
    })
  } catch (err) {
    return routeError('assessments:GET', err)
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireVerifiedUser(req)
  if (!guard.ok) return guard.response
  const budget = consumeBucket('assessment-score', 20, 60_000, guard.value.uid)
  if (!budget.ok) return fail(429, 'Too many assessment submissions. Please wait a moment.', { headers: { 'Retry-After': String(budget.retryAfterSec) } })

  const parsed = await readJsonBody<{ jobId?: unknown; answers?: unknown; proctoring?: unknown }>(req, 16_000)
  if (!parsed.ok) return fail(parsed.error.includes('large') ? 413 : 400, parsed.error, { code: 'bad_request' })
  const jobId = sanitizeLine(parsed.data.jobId, 128)
  if (!jobId) return fail(400, 'A job id is required.', { code: 'missing_job' })
  const rawAnswers = parsed.data.answers
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
    return fail(400, 'Answers are required.', { code: 'missing_answers' })
  }

  try {
    // Gate the scoring path too, not just the questions: a pass is what unlocks applying, so a
    // forged submission for another region's card has to be refused here as well.
    const gated = await gateJobId(req, jobId, guard.value.uid)
    if (!gated.gate.ok) return fail(403, gated.gate.message, { code: 'region_locked', details: { jobRegion: gated.gate.jobRegion } })

    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Assessment is temporarily unavailable.', { code: 'storage_unavailable' })
    const source = await firestore.getAssessmentSource(jobId)
    if (!source) return fail(404, 'That job could not be found.', { code: 'job_not_found' })
    if (source.questions.length === 0) return fail(409, 'This job has no assessment.', { code: 'no_assessment' })

    // The timer is the gate on submitting at all. Checked before a single answer is scored, so a
    // task that has not run its course cannot be finished — however the request was formed.
    const run = await firestore.readTaskRun(guard.value.uid, jobId)
    if (!run) return fail(409, 'Open this task before submitting it — its timer starts when you do.', { code: 'task_not_started' })
    if (run.status === 'completed') {
      const amount = Number(run.payUsd ?? 0) || 0
      return json({
        ok: true,
        passed: true,
        alreadyCompleted: true,
        score: source.passMark,
        total: source.questions.length,
        passMark: source.passMark,
        review: [],
        task: { alreadyCredited: true, payUsd: amount, timerMinutes: run.timerMinutes },
      })
    }
    const clock = taskTimerState({ timerMinutes: run.timerMinutes, startedAtMs: run.startedAtMs })
    if (!clock.complete) {
      return fail(409, `This task still has ${describeRemaining(clock.remainingSeconds)} to run. A task can only be submitted once its timer has finished.`, {
        code: 'task_timer_running',
        remainingSeconds: clock.remainingSeconds,
        timerMinutes: clock.timerMinutes,
        elapsedSeconds: clock.elapsedSeconds,
      })
    }

    const answers = rawAnswers as Record<string, unknown>
    let score = 0
    const review = source.questions.map((question) => {
      const chosenRaw = answers[String(question.id)]
      const chosen = typeof chosenRaw === 'number' && Number.isInteger(chosenRaw) ? chosenRaw : -1
      const correct = chosen === question.correctIndex
      if (correct) score += 1
      return {
        id: question.id,
        chosen,
        correctIndex: question.correctIndex,
        correctOption: question.options[question.correctIndex] ?? '',
        ...(question.explanation ? { explanation: question.explanation } : {}),
      }
    })
    // Camera-proctoring outcome, reported by the client (counts/labels only, never images). A
    // proctor-terminated attempt can never record a pass, whatever its answers were.
    const proctoring = (parsed.data.proctoring ?? {}) as {
      terminated?: unknown
      reason?: unknown
      events?: unknown
    }
    const proctorTerminated = proctoring.terminated === true
    const proctorEvents = Array.isArray(proctoring.events)
      ? proctoring.events
          .slice(0, 200)
          .map((e) => {
            const rec = (e ?? {}) as Record<string, unknown>
            return { at: String(rec.at ?? '').slice(0, 40), kind: String(rec.kind ?? '').slice(0, 60) }
          })
      : []
    void firestore
      .recordProctorEvent(guard.value.uid, jobId, {
        terminated: proctorTerminated,
        reason: String(proctoring.reason ?? '').slice(0, 120),
        events: proctorEvents,
      })
      .catch((err) => console.warn('[assessments] proctor event write failed:', err))

    const passed = !proctorTerminated && score >= source.passMark
    let task: { payUsd: number; billedMinutes: number; alreadyCredited: boolean } | null = null
    if (passed) {
      // The marker is written server-side; the client never gets to assert its own pass.
      await firestore.recordAssessmentPass(guard.value.uid, jobId)
      // Finishing the task pays it. The amount comes from the run's own snapshotted rate and timer —
      // never from the card as it reads today, which could have been repriced while it ran.
      const amount = taskPayUsd({
        rateUsd: run.rateUsd,
        timerMinutes: run.timerMinutes,
        elapsedSeconds: clock.elapsedSeconds,
      })
      const credited = await firestore.completeTaskRun({
        uid: guard.value.uid,
        jobId,
        payUsd: amount.payUsd,
        billedMinutes: amount.billedMinutes,
        elapsedSeconds: clock.elapsedSeconds,
      })
      task = { payUsd: credited.creditedUsd || amount.payUsd, billedMinutes: amount.billedMinutes, alreadyCredited: credited.alreadyCredited }
    }
    return json({
      ok: true,
      passed,
      proctorTerminated,
      score,
      total: source.questions.length,
      passMark: source.passMark,
      // Do not hand back the answer key on a failed attempt: a client could submit blank answers,
      // harvest the review, then retake the assessment and pass every time. Answers are revealed
      // only after the server has recorded a pass.
      review: passed ? review : [],
      task,
    })
  } catch (err) {
    return routeError('assessments:POST', err)
  }
}

/**
 * Start (or resume) the timer for this task and describe it to the client.
 *
 * The rate and the timer are snapshotted from the server's own resolution of the card at start time:
 * the region comes from the member's verified country (the same `resolveWorkerRegion` the payout uses,
 * so the task pays what the board promised), and the timer from the card's estimate. A member who
 * reloads gets their original clock back — `startTaskRun` returns the existing run untouched.
 *
 * Storage trouble must not stop a member working, so a timer that cannot be written is reported as
 * `null` and the route behaves as it did before: the questions are still served. The *submission*
 * will then refuse for want of a run, which is the honest failure — better than inventing a clock.
 */

function taskCardOf(job: Record<string, unknown> | null): TaskCard {
  return {
    payAmountUsd: Number(job?.payAmountUsd ?? 0) || 0,
    payByRegion: (job?.payByRegion ?? null) as RegionalPay | null,
    estimatedMinutes: Number(job?.estimatedMinutes ?? 0) || 0,
  }
}

async function startTaskTimer(
  firestore: typeof import('@/lib/firestore-admin'),
  uid: string,
  jobId: string,
  job: Record<string, unknown> | null,
  passMark: number,
): Promise<{
  timerMinutes: number
  remainingSeconds: number
  elapsedSeconds: number
  complete: boolean
  rateUsd: number
  payUsd: number
  billedMinutes: number
  passMark: number
} | null> {
  try {
    const profile = await firestore.getTaskProfileFields(uid)
    const resolved = resolveWorkerRegion({
      verifiedCountry: profile.verifiedCountry,
      payoutCountry: await firestore.resolveWorkerPayoutCountry(uid),
      declaredCountry: profile.country,
    })
    const card = taskCardOf(job)
    const rateUsd = taskRateUsd(card, resolved.region)
    const timerMinutes = taskTimerMinutes(card)
    const run = await firestore.startTaskRun({ uid, jobId, region: resolved.region, rateUsd, timerMinutes })
    const clock = taskTimerState({ timerMinutes: run.timerMinutes, startedAtMs: run.startedAtMs })
    // What finishing this task pays, quoted from the same function the credit uses.
    const quote = taskPayUsd({ rateUsd: run.rateUsd, timerMinutes: run.timerMinutes, elapsedSeconds: clock.elapsedSeconds })
    return {
      timerMinutes: clock.timerMinutes,
      remainingSeconds: clock.remainingSeconds,
      elapsedSeconds: clock.elapsedSeconds,
      complete: clock.complete,
      rateUsd: run.rateUsd,
      payUsd: quote.payUsd,
      billedMinutes: quote.billedMinutes,
      passMark,
    }
  } catch (err) {
    console.warn('[assessments] task timer not started:', err)
    return null
  }
}
