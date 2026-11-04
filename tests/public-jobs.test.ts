import assert from 'node:assert/strict'
import test from 'node:test'
import { toPublicJob } from '@/lib/public-jobs-server'
import { jsonLd } from '@/lib/public-jobs'

const NOW = Date.parse('2026-11-03T12:00:00.000Z')

function raw(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Transcribe a short interview',
    category: 'Transcription',
    description: 'A short interview clip with clear speakers.',
    responsibilities: ['Follow the style sheet', 'Mark inaudible sections'],
    payAmountUsd: 12.5,
    estimatedMinutes: 45,
    capacity: 10,
    slotsRemaining: 4,
    trainingRequired: true,
    trainingFeeUsd: 8,
    requiresVerified: true,
    status: 'open',
    closesAt: new Date(NOW + 86_400_000).toISOString(),
    postedAgo: '2 hours ago',
    // These must never survive the public projection.
    assessmentQuestions: [{ question: 'Which line is right?', options: ['A', 'B'], correctIndex: 1 }],
    trainingNotes: [{ title: 'Lesson', content: 'Read this.', check: { question: 'Pick one', options: ['A', 'B'], correctIndex: 0 } }],
    ...overrides,
  }
}

test('the public projection contains only allow-listed fields', () => {
  const job = toPublicJob('job-1', raw(), NOW)
  assert.ok(job)
  assert.equal(job.title, 'Transcribe a short interview')
  assert.equal(job.category, 'Transcription')
  assert.equal(job.payAmountUsd, 12.5)
  assert.equal(job.trainingFeeUsd, 8)
  assert.equal(job.slotsRemaining, 4)

  const serialized = JSON.stringify(job)
  assert.doesNotMatch(serialized, /assessmentQuestions|trainingNotes|correctIndex|question|options|Lesson/)
})

test('paused, closed, expired and full jobs are never published', () => {
  assert.equal(toPublicJob('job-1', raw({ status: 'paused' }), NOW), null)
  assert.equal(toPublicJob('job-1', raw({ status: 'closed' }), NOW), null)
  assert.equal(toPublicJob('job-1', raw({ closesAt: new Date(NOW - 1).toISOString() }), NOW), null)
  assert.equal(toPublicJob('job-1', raw({ slotsRemaining: 0 }), NOW), null)
  assert.equal(toPublicJob('job-1', raw({ title: '' }), NOW), null)
  assert.equal(toPublicJob('job/1', raw(), NOW), null)
})

test('a fee is published only on a training card, whatever the body tried to send', () => {
  // Assessment-only → free, and the fee must not ride along with it.
  const free = toPublicJob('job-1', raw({ trainingRequired: false, trainingFeeUsd: 25 }), NOW)
  assert.ok(free)
  assert.equal(free.trainingRequired, false)
  assert.equal(free.trainingFeeUsd, undefined)
  assert.ok(!('trainingNotes' in (free as object)), 'the public card must not carry training sections')

  // Training card → the fee is published with it, authored modules or not.
  const paid = toPublicJob('job-2', raw({ trainingRequired: true, trainingFeeUsd: 25 }), NOW)
  assert.ok(paid)
  assert.equal(paid.trainingRequired, true)
  assert.equal(paid.trainingFeeUsd, 25)
})

test('the public source never reads or returns answer-key fields', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile('lib/public-jobs-server.ts', 'utf8'))
  // `trainingNotes` is read now — it is how the projection knows a card has training and therefore
  // a fee. What must never reach the browser is the answer key inside it.
  assert.doesNotMatch(source, /assessmentQuestions/)
  assert.doesNotMatch(source, /correctIndex/)
  assert.doesNotMatch(source, /\bexplanation\b/)
  // The projection *reads* trainingNotes now — that is how it knows a card has training — but it
  // must not hand them, or the answer key inside them, to the browser.
  assert.doesNotMatch(source, /trainingNotes[^\n]*correctIndex/)
  assert.match(source, /PUBLIC_FIELDS/)
  assert.match(source, /\.select\(\.\.\.PUBLIC_FIELDS\)/)
})

test('structured data cannot break out of its script element', () => {
  const encoded = jsonLd({ description: '</script><script>alert(1)</script>', title: 'A & B' })
  assert.doesNotMatch(encoded, /<\/script>/)
  assert.match(encoded, /u003c/)
  assert.match(encoded, /u0026/)
})
