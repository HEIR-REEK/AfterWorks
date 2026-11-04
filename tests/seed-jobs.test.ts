import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILT_IN_QUESTION_COUNT,
  EXPANDED_CATALOGUE_JOB_IDS,
  JOB_CATEGORY_LIST,
  assessmentPassMark,
  paystackSubunitsFor,
  seedJobs,
  trainingFeeKesFor,
  trainingFeeUsdFor,
} from '@/lib/afterworks-data'
import { builtInQuestions, publicAssessmentQuestions } from '@/lib/assessment-bank'
import { getJobTrainingCourse, trainingCourseMinutes } from '@/lib/training-curriculum'
import { toPublicJob } from '@/lib/public-jobs-server'

test('the sample catalogue has a deep bench in every work category', () => {
  const jobs = seedJobs()
  assert.ok(jobs.length >= 35, `expected at least 35 sample cards, got ${jobs.length}`)
  assert.equal(new Set(jobs.map((job) => job.id)).size, jobs.length, 'job ids must be unique')
  assert.equal(new Set(jobs.map((job) => job.title)).size, jobs.length, 'job titles must be unique')

  for (const category of JOB_CATEGORY_LIST) {
    const count = jobs.filter((job) => job.category === category).length
    assert.ok(count >= 5, `${category} should offer at least five sample cards, got ${count}`)
  }
})

test('every sample card is complete enough to publish', () => {
  for (const job of seedJobs()) {
    assert.match(job.id, /^job-[a-z0-9-]+$/, `bad id: ${job.id}`)
    assert.ok(job.title.trim().length >= 12, `${job.id} needs a clear title`)
    assert.ok(job.description.trim().length >= 100, `${job.id} description is too thin`)
    assert.ok(job.responsibilities.length >= 3, `${job.id} needs at least three responsibilities`)
    for (const line of job.responsibilities) {
      assert.ok(line.trim().length >= 10, `${job.id} has a thin responsibility`)
    }
    assert.ok(job.payAmountUsd >= 1 && job.payAmountUsd <= 10_000, `${job.id} has an implausible pay`)
    assert.ok(job.estimatedMinutes >= 5 && job.estimatedMinutes <= 10_080, `${job.id} has a bad duration`)
    assert.ok(job.capacity >= 1, `${job.id} needs capacity`)
    assert.ok(job.slotsRemaining >= 0 && job.slotsRemaining <= job.capacity, `${job.id} has invalid slots`)
    assert.ok(['open', 'paused', 'closed'].includes(job.status), `${job.id} has an unknown status`)

    if (job.status === 'open') {
      assert.ok(job.slotsRemaining > 0, `${job.id} is open with no slots`)
      assert.ok(Date.parse(job.closesAt) > Date.now(), `${job.id} is open but already past its close date`)
    }

    if (job.trainingFeeUsd !== undefined) {
      assert.ok(
        job.trainingFeeUsd >= 0.0001 && job.trainingFeeUsd <= 1_000,
        `${job.id} has an out-of-range training fee`,
      )
    }

    for (const section of job.trainingNotes ?? []) {
      assert.ok(section.title.trim().length >= 5, `${job.id} has a training section without a title`)
      assert.ok(section.content.trim().length >= 80, `${job.id} / ${section.title} is too thin`)
    }
  }
})

test('the 2026 expansion adds two cards per category and carries real training detail', () => {
  const jobs = seedJobs()
  assert.equal(EXPANDED_CATALOGUE_JOB_IDS.length, 12)
  assert.equal(new Set(EXPANDED_CATALOGUE_JOB_IDS).size, 12, 'expanded ids must be unique')

  const expanded = jobs.filter((job) => (EXPANDED_CATALOGUE_JOB_IDS as readonly string[]).includes(job.id))
  assert.equal(expanded.length, 12, 'every expanded id must exist in the sample catalogue')

  for (const category of JOB_CATEGORY_LIST) {
    const count = expanded.filter((job) => job.category === category).length
    assert.equal(count, 2, `${category} should gain exactly two cards in this batch`)
  }

  for (const job of expanded) {
    if (job.trainingRequired) {
      assert.ok(
        typeof job.trainingFeeUsd === 'number' && job.trainingFeeUsd > 0,
        `${job.id} gates on training but has no per-card fee`,
      )
    }
    if (job.trainingNotes && job.trainingNotes.length > 0) {
      assert.ok(
        job.trainingNotes.length < 5,
        `${job.id} should be a job-specific briefing, not a replacement course`,
      )
    }
  }

  const withBriefing = expanded.filter((job) => (job.trainingNotes?.length ?? 0) >= 2)
  assert.ok(withBriefing.length >= 3, 'the batch should include job-specific briefings where the client rules matter')
})

test('every card resolves a complete course, assessment, public card and checkout', () => {
  const jobs = seedJobs()

  for (const job of jobs) {
    // The module a worker studies: authored briefings are prepended to the category coursebook,
    // so a card can never fall back to two paragraphs and an empty assessment.
    const course = getJobTrainingCourse(job)
    assert.ok(course.modules.length >= 12, `${job.id} renders only ${course.modules.length} lessons`)
    assert.ok(trainingCourseMinutes(course) >= 90, `${job.id} course is too short to be a real briefing`)

    // The assessment behind the application gate: the full 20-question applied category bank, an 80% pass
    // mark and an answer key stripped from the public projection. This holds for free cards too —
    // every card gates the application on the assessment, only the payment step differs.
    const bank = builtInQuestions(job.category)
    assert.equal(bank.length, BUILT_IN_QUESTION_COUNT, `${job.id} / ${job.category} needs the full built-in bank`)
    assert.equal(bank.length, 20)
    assert.equal(assessmentPassMark(bank.length), 16)
    const passMark = assessmentPassMark(bank.length)
    assert.ok(passMark > 0 && passMark <= bank.length)
    const publicQuestions = publicAssessmentQuestions(bank)
    assert.equal(publicQuestions.length, bank.length)
    assert.equal('correctIndex' in publicQuestions[0]!, false, 'the browser must not receive the key')

    // Payments: a gated card carries a positive per-card USD fee, a KES amount and matching
    // Paystack subunits. A free card carries no fee, but still runs the full course and assessment.
    if (job.trainingRequired) {
      assert.ok((job.trainingNotes?.length ?? 0) >= 2, `${job.id} gates on training without a specific brief`)
      assert.ok(typeof job.trainingFeeUsd === 'number' && job.trainingFeeUsd > 0)
      const usd = trainingFeeUsdFor(job.trainingFeeUsd)
      assert.equal(usd, job.trainingFeeUsd, `${job.id} fee changes on the way to checkout`)
      const kes = trainingFeeKesFor(job.trainingFeeUsd)
      assert.ok(kes > 0, `${job.id} has no KES price`)
      assert.equal(paystackSubunitsFor(job.trainingFeeUsd), kes * 100)
    } else {
      assert.equal(job.trainingFeeUsd, undefined, `${job.id} is free but carries a training price`)
      assert.ok(job.trainingRequired === false, `${job.id} free card should not claim a paid gate`)
    }

    // An open card must survive the public projection; a closed card is intentionally absent.
    if (job.status === 'open') {
      assert.ok(toPublicJob(job.id, job, Date.now()), `${job.id} would be dropped from the public board`)
    }
  }
})
