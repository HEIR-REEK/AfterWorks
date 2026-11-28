/**
 * The board is two kinds of job card, and this file protects the distinction.
 *
 *   - a *training card* has modules and a training fee. The modules are the admin's authored
 *     sections when there are any, and the built-in category coursebook when there are not — so a
 *     training card always has something to work through. The worker pays, then trains, then is
 *     assessed, then applies.
 *   - an *assessment-only card* has neither. No modules, no fee: a verified worker goes straight
 *     to the assessment and then applies.
 *
 * `trainingRequired` is that choice, and it is the one thing the fee hangs on. The admin sets it in
 * the console alongside the job's pay; there is no second place for the two to disagree.
 *
 * An earlier revision derived the flag from whether the card had authored sections, which quietly
 * turned "no sections written yet" into "assessment-only" and stripped 16 cards of their courses.
 * These tests pin the flag as the card type instead, and pin the coursebook as what a training card
 * falls back to.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { jobHasTraining, jobRequiresTrainingFee, jobTrainingModuleCount, seedJobs, JOB_CATEGORY_LIST } from '@/lib/afterworks-data'
import { getJobTrainingCourse } from '@/lib/training-curriculum'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}
/** Source with `//` comments removed, so an assertion about code is not answered by prose about it. */
function code(rel: string): string {
  return read(rel)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

// The rule itself

test('the flag is the card type, and the fee follows it', () => {
  assert.equal(jobHasTraining({ trainingRequired: true }), true, 'a training card has training')
  assert.equal(jobHasTraining({ trainingRequired: false }), false, 'an assessment-only card does not')
  assert.equal(jobHasTraining({}), false)
  assert.equal(jobHasTraining(null), false)
  assert.equal(jobHasTraining(undefined), false)

  for (const job of [{ trainingRequired: true }, { trainingRequired: false }, {}]) {
    assert.equal(jobRequiresTrainingFee(job), jobHasTraining(job), 'the fee is the same question')
  }
})

test('a training card has modules whether or not the admin wrote any', () => {
  // Authored sections are the modules when they exist. A half-authored one is not a module.
  const authored = jobTrainingModuleCount({
    trainingRequired: true,
    trainingNotes: [
      { title: 'The transcript template', content: 'Page and line, speaker in capitals.' },
      { title: '', content: '' },
    ],
  })
  assert.equal(authored, 1)

  // None written is fine: the built-in coursebook supplies them, so the card still has training.
  assert.equal(jobTrainingModuleCount({ trainingRequired: true, trainingNotes: [] }), 0, 'no authored modules')
  assert.equal(jobTrainingModuleCount({ trainingRequired: true }), 0)
  assert.equal(jobTrainingModuleCount({ trainingRequired: false, trainingNotes: [] }), 0)

  // The resolver is what actually turns "no authored sections" into a course.
  const jobs = seedJobs()
  const trainingCards = jobs.filter((job) => job.trainingRequired)
  assert.ok(trainingCards.length > 0, 'the board has training cards')
  for (const job of trainingCards) {
    const course = getJobTrainingCourse(job)
    assert.ok(course.modules.length > 0, `${job.id} is a training card and must have modules`)
  }

  // An assessment-only card must never be handed a course by the resolver either.
  for (const job of jobs.filter((j) => !j.trainingRequired)) {
    assert.equal(getJobTrainingCourse(job).modules.length, 0, `${job.id} is assessment-only and must have no modules`)
  }
})

test('the seeded board is made of both kinds, and neither is mislabelled', () => {
  const jobs = seedJobs()
  const training = jobs.filter((job) => job.trainingRequired)
  const assessmentOnly = jobs.filter((job) => !job.trainingRequired)

  assert.ok(training.length >= 10, `expected training cards, found ${training.length}`)
  assert.ok(assessmentOnly.length >= 10, `expected assessment-only cards, found ${assessmentOnly.length}`)

  // A training card charges; an assessment-only card does not.
  for (const job of training) {
    assert.ok(
      typeof job.trainingFeeUsd === 'number' && job.trainingFeeUsd > 0,
      `${job.id} is a training card and must carry a fee`,
    )
  }
  for (const job of assessmentOnly) {
    assert.ok(job.trainingFeeUsd === undefined, `${job.id} is assessment-only and must not carry a fee`)
  }

  // Both kinds exist in every category, so neither kind is a dead end on any part of the board.
  for (const category of JOB_CATEGORY_LIST) {
    assert.ok(training.some((job) => job.category === category), `${category} has no training card`)
    assert.ok(assessmentOnly.some((job) => job.category === category), `${category} has no assessment-only card`)
  }
})

// Where the choice is made and read

test('the console offers the choice, and saves what was chosen', () => {
  const editor = code('app/admin/jobs/page.tsx')

  // Two buttons, one per kind of card.
  assert.match(editor, /Training \+ assessment/, 'the training-card option')
  assert.match(editor, /Assessment only/, 'the assessment-only option')
  assert.match(editor, /setEditing\(\{ \.\.\.editing, trainingRequired: true \}\)/)
  assert.match(editor, /setEditing\(\{ \.\.\.editing, trainingRequired: false, trainingFeeUsd: 0 \}\)/, 'opting out clears the fee')

  // The editor reads the flag, not a guess about the sections.
  assert.match(editor, /editingHasTraining = editing\?\.trainingRequired === true/)
  assert.doesNotMatch(editor, /editingHasTraining = editingTrainingCount > 0/, 'not derived from the section count')

  // And it saves the flag the admin set.
  assert.match(editor, /trainingRequired: editing\.trainingRequired === true/)

  // The fee field appears only for a training card.
  assert.match(editor, /\{editingHasTraining && \(/)

  // A training card is told where its modules come from.
  assert.match(editor, /built-in coursebook/, 'and that no authored modules means the built-in course')
})

test('every write path preserves the choice rather than re-deriving it', () => {
  assert.match(code('app/api/admin/jobs/route.ts'), /trainingRequired: body\.trainingRequired === true/)
  assert.match(code('lib/firestore-admin.ts'), /const trainingRequired = input\.trainingRequired === true/)
  assert.match(code('lib/job-seed.ts'), /trainingRequired: job\.trainingRequired/)
  assert.match(code('lib/job-catalogue.ts'), /trainingRequired: data\.trainingRequired === true/)
  assert.match(code('lib/public-jobs-server.ts'), /const trainingRequired = data\.trainingRequired === true/)
})

test('the member surfaces branch on the same choice', () => {
  // The training page still splits on the card's own choice — but the split is now "does this card
  // have a course", not "has this card been paid for". The per-card paywall is gone; the modules are
  // not.
  const training = code('app/training/[id]/page.tsx')
  assert.match(training, /const hasTraining = jobHasTraining\(job\)/)
  assert.match(training, /\{!hasTraining && \(/, 'and takes the assessment-only branch')
  assert.doesNotMatch(training, /hasTraining && !isPaid/, 'the per-card paywall is retired')
  const assessmentOnly = training.slice(
    training.indexOf('{!hasTraining && ('),
    training.indexOf('A PRICED CARD THE MEMBER HAS NOT PAID FOR'),
  )
  assert.doesNotMatch(assessmentOnly, /TrainingModules/, 'no modules on an assessment-only card')
  assert.match(assessmentOnly, /AssessmentQuiz/, 'just the assessment')
  // The card that has training shows it, and the course is not behind a card-level charge.
  const trained = training.slice(training.indexOf('A CARD WITH TRAINING'))
  assert.match(trained, /<TrainingModules/, 'a training card shows its modules')
  assert.match(trained, /unlockedRegion/, 'what it gates on is the *region* unlock, not a card payment')

  // The rest of the member surface.
  assert.match(code('components/job-card.tsx'), /jobHasTraining\(job\)/)
  assert.match(code('app/dashboard/page.tsx'), /jobHasTraining\(job\)/)
  assert.match(code('lib/admin-search.ts'), /!jobHasTraining\(job\)/)
  assert.match(code('app/jobs/[id]/page.tsx'), /jobHasTraining\(job\)/)
})

// The gates

test('a price unlock can be paid before identity verification, but the assessment cannot', () => {
  // The payment is a *price access* charge now, not a per-card training fee, but the verification
  // order it depends on is unchanged and still worth pinning: money first, identity later.
  const init = code('app/api/paystack/initialize/route.ts')
  assert.match(init, /requireUser\(req\)/, 'payment takes an authenticated member, not a verified one')
  assert.doesNotMatch(init, /requireVerifiedUser/, 'so an unverified member can still pay for a tier')
  assert.match(init, /priceRegion/, 'the body names the region whose prices are being bought')
  assert.match(init, /priceAccessFeeUsd\(/, 'and the price comes from the tier, never from the request')
  assert.doesNotMatch(init, /training_not_required/, 'the old per-card training gate is gone')

  const assessments = code('app/api/assessments/route.ts')
  assert.match(assessments, /requireVerifiedUser\(req\)/, 'the assessment still requires verification')
})

test('the training modules survive the change of what the payment buys', () => {
  // The instruction was explicit: remove the training *gating*, keep the training. Both halves get a
  // test, because "we replaced the fee" is exactly the change that quietly deletes a coursebook.
  const page = code('app/training/[id]/page.tsx')
  assert.match(page, /TrainingModules/, 'the modules still render')
  assert.match(page, /readTrainingProgress/, 'and progress is still read')
  const modules = code('components/training-modules.tsx')
  assert.match(modules, /export function TrainingModules/)

  // The fee the board *shows* is now a tier-unlock price, so it is no longer charged per card: the
  // card's own `trainingFeeUsd` prices a region, it does not meter a lesson.
  const priceAccess = code('lib/price-access.ts')
  assert.match(priceAccess, /priceAccessFeeUsd/)
  assert.match(priceAccess, /PRICE_ACCESS_PURPOSE = 'price_access'/)
})

test('the admin can create a card and set both the pay and the training fee', () => {
  // The concept the console exists for: publish a card, decide what it pays, decide what it charges.
  const editor = code('app/admin/jobs/page.tsx')
  assert.match(editor, /New job/, 'a card can be created')
  assert.match(editor, /label="Pay per job \(USD\)"/, 'and the job pay is editable')
  // The money field is still there, but it now prices the region's tier rather than the card's lesson.
  assert.match(editor, /label="Region price access \(USD\)"/, 'and the region price-access fee')
  assert.doesNotMatch(editor, /label="Training fee \(USD\)"/, 'the per-card training fee is retired')
  assert.match(editor, /label="Estimated minutes"/)
  assert.match(editor, /label="Capacity"/)
})
