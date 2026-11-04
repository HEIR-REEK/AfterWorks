/**
 * The one rule this file exists to protect:
 *
 *   a job card has a training fee *because* it has training, and only then.
 *
 * Before this, `trainingRequired` was a free-standing toggle an admin set by hand, so a card could
 * carry a full authored course and still be marked free — which is exactly the state the rule
 * removes. Everything below reads the rule from the code rather than trusting a stored flag, so a
 * document that disagrees with its own content loses.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { jobHasTraining, jobRequiresTrainingFee, type TrainingSection } from '@/lib/afterworks-data'

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

const section = (over: Partial<TrainingSection> = {}): TrainingSection => ({
  title: 'How the calls are structured',
  content: 'Label every paragraph with its speaker.',
  ...over,
})

// ─── The rule itself ────────────────────────────────────────────────────────

test('a card has training — and therefore a fee — only when it has authored sections', () => {
  assert.equal(jobHasTraining({ trainingNotes: [section()] }), true)
  assert.equal(jobRequiresTrainingFee({ trainingNotes: [section()] }), true)

  // No sections at all: assessment-only, free. There is deliberately no built-in coursebook
  // fallback, because "has training" is the very thing the fee hangs on.
  assert.equal(jobHasTraining({ trainingNotes: [] }), false)
  assert.equal(jobHasTraining({}), false)
  assert.equal(jobHasTraining(null), false)
  assert.equal(jobHasTraining(undefined), false)

  // A heading an admin typed and then cleared is not training.
  assert.equal(jobHasTraining({ trainingNotes: [{ title: '   ', content: '' }] }), false)
  assert.equal(jobHasTraining({ trainingNotes: [{ title: '', content: '\n\t ' }] }), false)

  // One real section among blanks still counts.
  assert.equal(jobHasTraining({ trainingNotes: [{ title: '', content: '' }, section()] }), true)

  // The two helpers are the same question asked two ways.
  for (const notes of [[section()], [], [{ title: ' ', content: ' ' }]]) {
    assert.equal(jobRequiresTrainingFee({ trainingNotes: notes }), jobHasTraining({ trainingNotes: notes }))
  }
})

test('no seeded card claims one thing and carries another', () => {
  // The rule checked against the actual board, not a fixture: a card with sections must be paid,
  // and a card with none must not be. This is the inconsistency the rule was written to remove.
  const source = read('lib/afterworks-data.ts')
  const cards = [...source.matchAll(/id: '([^']+)',\s*\n\s*title: '([^']+)',([\s\S]*?)(?=\n      id: |\n    \]|\Z)/g)]
  assert.ok(cards.length > 20, `expected the seeded board, parsed ${cards.length}`)

  const wrong: string[] = []
  for (const card of cards) {
    const body = card[3]
    const notes = /trainingNotes: \[([\s\S]*?)\n      \]/.exec(body)
    const sections = notes ? [...notes[1]!.matchAll(/\n          title:/g)].length : 0
    const flaggedPaid = /trainingRequired: true/.test(body)
    const fee = /trainingFeeUsd: ([\d.]+)/.exec(body)
    if (sections > 0 && !flaggedPaid) wrong.push(`${card[2]}: ${sections} sections, marked free`)
    if (sections > 0 && !fee) wrong.push(`${card[2]}: ${sections} sections, no fee`)
    if (sections === 0 && flaggedPaid) wrong.push(`${card[2]}: no sections, marked paid`)
  }
  assert.deepEqual(wrong, [])
})

// ─── Where the rule is enforced ─────────────────────────────────────────────

test('the write paths derive the flag instead of trusting the client', () => {
  // Admin console save.
  const adminRoute = read('app/api/admin/jobs/route.ts')
  assert.match(adminRoute, /authoredTrainingSections/, 'the server counts the sections')
  assert.match(adminRoute, /trainingRequired: authoredTrainingSections > 0/, 'and derives the flag from them')
  assert.doesNotMatch(adminRoute, /trainingRequired: body\.trainingRequired/, 'it never trusts the body copy')

  // The library that actually writes the document.
  const admin = read('lib/firestore-admin.ts')
  assert.match(admin, /const trainingRequired = trainingNotes\.length > 0/, 'upsertJob derives it too')

  // The console editor no longer offers a way to set the two apart.
  const editor = read('app/admin/jobs/page.tsx')
  assert.doesNotMatch(editor, /Paid training \+ assessment/, 'no paid/free toggle')
  assert.doesNotMatch(editor, /Free course \+ assessment/, 'no free/full-course toggle')
  assert.match(editor, /editingHasTraining/, 'the editor shows the derived state instead')
  assert.match(editor, /trainingRequired: editingHasTraining/, 'and saves it')
})

test('the member surfaces follow the same rule', () => {
  // The training page is where the fork is visible, so it must read the derived rule.
  const training = read('app/training/[id]/page.tsx')
  assert.match(training, /const hasTraining = jobHasTraining\(job\)/)
  assert.match(training, /const isPaid = !hasTraining \|\|/, 'a card with no training has nothing to pay')
  assert.match(training, /\{!hasTraining && \(/, 'and takes the assessment-only branch')
  // The assessment-only branch must not serve a course.
  const assessmentOnly = training.slice(training.indexOf('{!hasTraining && ('), training.indexOf('{hasTraining && !isPaid && ('))
  assert.doesNotMatch(assessmentOnly, /TrainingModules/, 'no training modules on a card with no training')
  assert.match(assessmentOnly, /AssessmentQuiz/, 'just the assessment')
  assert.match(assessmentOnly, /VerificationGate paid=\{false\}/, 'gated on verification, with nothing paid')

  // The job card, the dashboard tally and the browse filter.
  assert.match(read('components/job-card.tsx'), /jobHasTraining\(job\)/)
  assert.match(read('app/dashboard/page.tsx'), /jobHasTraining\(job\)/)
  assert.match(read('lib/admin-search.ts'), /!jobHasTraining\(job\)/)
  assert.match(read('lib/job-seed.ts'), /trainingRequired: jobHasTraining\(job\)/)
})

// ─── The gate that contradicts the rule ─────────────────────────────────────

test('a training fee can be paid before identity verification, but the assessment cannot', () => {
  // The rule says both of these, and they point in opposite directions, so both are pinned.
  const init = code('app/api/paystack/initialize/route.ts')
  assert.match(init, /requireUser\(req\)/, 'payment takes an authenticated member, not a verified one')
  assert.doesNotMatch(init, /requireVerifiedUser/, 'so an unverified member can still pay the fee')
  assert.match(init, /authored\.length > 0/, 'and only for a card that actually has training')

  // The assessment stays gated on verification: paying does not buy the right to sit it.
  const assessments = code('app/api/assessments/route.ts')
  assert.match(assessments, /requireVerifiedUser\(req\)/, 'the assessment still requires verification')
})
