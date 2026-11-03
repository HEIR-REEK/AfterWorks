import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, requireVerifiedUser, routeError } from '@/lib/guards'
import { readJsonBody, sanitizeLine } from '@/lib/security-core'
import { publicAssessmentQuestions } from '@/lib/assessment-bank'

/**
 * /api/assessments — server-authoritative assessment.
 *
 * GET returns the questions without `correctIndex`/`explanation`. POST scores the submitted
 * answers against the copy of the answer key that never leaves the server, writes
 * `users.assessmentPasses/{jobId}` itself on a pass, and returns the review only after scoring.
 *
 * The old flow shipped the answers in the public job catalogue and let the browser set its own
 * pass flag. Both are gone: `/api/applications` requires the server-written pass.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireVerifiedUser(req)
  if (!guard.ok) return guard.response
  const jobId = sanitizeLine(req.nextUrl.searchParams.get('jobId'), 128)
  if (!jobId) return fail(400, 'A job id is required.', { code: 'missing_job' })
  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Assessment is temporarily unavailable.', { code: 'storage_unavailable' })
    const source = await firestore.getAssessmentSource(jobId)
    if (!source) return fail(404, 'That job could not be found.', { code: 'job_not_found' })
    return json({
      ok: true,
      jobTitle: source.jobTitle,
      questions: publicAssessmentQuestions(source.questions),
      passMark: source.passMark,
      total: source.questions.length,
      authored: source.authored,
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

  const parsed = await readJsonBody<{ jobId?: unknown; answers?: unknown }>(req, 16_000)
  if (!parsed.ok) return fail(parsed.error.includes('large') ? 413 : 400, parsed.error, { code: 'bad_request' })
  const jobId = sanitizeLine(parsed.data.jobId, 128)
  if (!jobId) return fail(400, 'A job id is required.', { code: 'missing_job' })
  const rawAnswers = parsed.data.answers
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
    return fail(400, 'Answers are required.', { code: 'missing_answers' })
  }

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Assessment is temporarily unavailable.', { code: 'storage_unavailable' })
    const source = await firestore.getAssessmentSource(jobId)
    if (!source) return fail(404, 'That job could not be found.', { code: 'job_not_found' })
    if (source.questions.length === 0) return fail(409, 'This job has no assessment.', { code: 'no_assessment' })

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
    const passed = score >= source.passMark
    if (passed) {
      // The marker is written server-side; the client never gets to assert its own pass.
      await firestore.recordAssessmentPass(guard.value.uid, jobId)
    }
    return json({
      ok: true,
      passed,
      score,
      total: source.questions.length,
      passMark: source.passMark,
      // Do not hand back the answer key on a failed attempt: a client could submit blank answers,
      // harvest the review, then retake the assessment and pass every time. Answers are revealed
      // only after the server has recorded a pass.
      review: passed ? review : [],
    })
  } catch (err) {
    return routeError('assessments:POST', err)
  }
}
