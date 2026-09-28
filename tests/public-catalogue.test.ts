import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { seedJobs, type Job } from '@/lib/afterworks-data'
import {
  PAYWALLED_JOB_FIELDS,
  openPublicJobs,
  parsePostedAgo,
  publicCategoryCounts,
  publicClosingLabel,
  publicPostedDate,
  toPublicJob,
} from '@/lib/public-job'

/**
 * The public pages are indexable, which means a search crawler — an anonymous visitor running no
 * JavaScript — receives their full HTML *and* the serialised props behind it. These tests are the
 * guard on what that makes public: the paid training material and the assessment answer key must
 * never be in a `PublicJob`, and a new field on `Job` must never reach one by accident.
 */

function fullJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-copy-review',
    title: 'Review product copy',
    category: 'Content Review',
    description: 'Check listings for tone and accuracy.',
    responsibilities: ['Read the copy', 'Flag errors'],
    payAmountUsd: 40,
    estimatedMinutes: 90,
    capacity: 10,
    slotsRemaining: 7,
    trainingRequired: true,
    trainingFeeUsd: 12.5,
    trainingNotes: [{ title: 'Paid module', content: 'The material a worker pays 12.50 to unlock.' }],
    assessmentQuestions: [{ question: 'Which is correct?', options: ['A', 'B'], correctIndex: 1 }],
    requiresVerified: true,
    status: 'open',
    closesAt: '2026-02-01T00:00:00.000Z',
    postedAgo: '2 hours ago',
    ...overrides,
  }
}

test('the paid training material and the assessment answer key never leave the server', () => {
  const job = fullJob()
  const publicJob = toPublicJob(job)

  // The two fields that a signed-out visitor must not receive.
  assert.equal('trainingNotes' in publicJob, false, 'trainingNotes leaked into the public projection')
  assert.equal('assessmentQuestions' in publicJob, false, 'assessmentQuestions leaked into the public projection')
  assert.deepEqual(PAYWALLED_JOB_FIELDS, ['trainingNotes', 'assessmentQuestions'])

  // Serialising the props is what a Server Component does before the browser sees them, so the JSON
  // is the real attack surface — check it, not just the object shape.
  const serialised = JSON.stringify(publicJob)
  assert.equal(serialised.includes('pays 12.50 to unlock'), false, 'training copy is in the RSC payload')
  assert.equal(serialised.includes('correctIndex'), false, 'an answer key is in the RSC payload')
  assert.equal(serialised.includes('Which is correct?'), false, 'assessment text is in the RSC payload')

  // Everything a visitor is allowed to see survives, so the card is still useful and indexable.
  assert.equal(publicJob.id, 'job-copy-review')
  assert.equal(publicJob.title, 'Review product copy')
  assert.equal(publicJob.payAmountUsd, 40)
  assert.equal(publicJob.trainingRequired, true)
  assert.equal(publicJob.trainingFeeUsd, 12.5, 'the training *price* is public; the material is not')
  assert.deepEqual(publicJob.responsibilities, ['Read the copy', 'Flag errors'])

  // The strip must not mutate the card the server is still holding.
  assert.ok(job.trainingNotes, 'toPublicJob mutated its input')
})

test('the sample catalogue is safe to publish too', () => {
  // `/` and `/jobs` fall back to `seedJobs()` when Firestore is not configured, and those cards
  // carry authored training notes as well — the same projection has to hold for them.
  const cards = seedJobs().map(toPublicJob)
  assert.ok(cards.length > 0)
  for (const card of cards) {
    assert.equal('trainingNotes' in card, false)
    assert.equal('assessmentQuestions' in card, false)
    assert.equal(JSON.stringify(card).includes('correctIndex'), false)
  }
})

test('a new field on Job cannot reach a public page without being classified here', () => {
  /**
   * This is the test that keeps the guarantee from rotting. It reads the `Job` type declaration and
   * insists every field is either known-public or known-paywalled, so adding (say)
   * `clientContactEmail` or `internalNotes` to a job document fails the build until somebody
   * decides which side of the paywall it belongs on.
   */
  const PUBLIC_JOB_FIELDS = [
    'id',
    'title',
    'category',
    'description',
    'responsibilities',
    'payAmountUsd',
    'estimatedMinutes',
    'capacity',
    'slotsRemaining',
    'trainingRequired',
    'trainingFeeUsd',
    'requiresVerified',
    'status',
    'closesAt',
    'postedAgo',
  ] as const

  const source = fs.readFileSync('lib/afterworks-data.ts', 'utf8')
  const start = source.indexOf('export type Job = {')
  assert.ok(start >= 0, 'could not find the Job type in lib/afterworks-data.ts')
  const end = source.indexOf('\n}', start)
  assert.ok(end > start, 'could not find the end of the Job type')
  const block = source.slice(start, end)

  const declared = [...block.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((match) => match[1]!)
  assert.ok(declared.length >= 10, `only found ${declared.length} fields on Job — the regex is wrong`)

  const unclassified = declared.filter(
    (field) => !(PUBLIC_JOB_FIELDS as readonly string[]).includes(field) && !(PAYWALLED_JOB_FIELDS as readonly string[]).includes(field),
  )
  assert.deepEqual(
    unclassified,
    [],
    `Job has fields that are neither public nor paywalled: ${unclassified.join(', ')}. Classify them in lib/public-job.ts.`,
  )

  // And the runtime projection must actually drop every paywalled field, not just the two named above.
  for (const field of PAYWALLED_JOB_FIELDS) {
    assert.equal(field in toPublicJob(fullJob()), false, `${field} survived toPublicJob`)
  }
})

test('lib/public-job.ts stays importable from the browser', () => {
  /**
   * `components/jobs-board.tsx` and `components/job-detail.tsx` are client components that import
   * this module. If it ever grew a server-only dependency the public pages would fail to bundle —
   * or worse, ship firebase-admin to the browser.
   */
  const source = fs.readFileSync('lib/public-job.ts', 'utf8')
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]!)
  for (const specifier of imports) {
    assert.equal(specifier, '@/lib/afterworks-data', `unexpected dependency in lib/public-job.ts: ${specifier}`)
  }
  // Comments in this module name the server-only packages on purpose (to explain why they are not
  // here), so only executable code is scanned.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(/firebase-admin|next\/headers|node:|server-only/.test(code), false, 'server-only code in lib/public-job.ts')
})

test('only cards a visitor could apply for are counted as open', () => {
  const jobs = [
    toPublicJob(fullJob({ id: 'a', status: 'open', slotsRemaining: 3 })),
    toPublicJob(fullJob({ id: 'b', status: 'open', slotsRemaining: 0 })),
    toPublicJob(fullJob({ id: 'c', status: 'paused', slotsRemaining: 5 })),
    toPublicJob(fullJob({ id: 'd', status: 'closed', slotsRemaining: 5 })),
  ]
  assert.deepEqual(openPublicJobs(jobs).map((job) => job.id), ['a'])

  const counted = publicCategoryCounts(jobs)
  assert.deepEqual(counted, { 'Content Review': 1 })
})

test('datePosted comes from a real timestamp, and is null rather than invented', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0)

  // The operator's last save wins: it is a real timestamp on the document.
  assert.equal(
    publicPostedDate({ updatedAt: '2026-01-10T08:30:00.000Z', postedAgo: '2 hours ago' }, now),
    '2026-01-10T08:30:00.000Z',
  )
  // A junk timestamp falls through to the relative copy instead of being emitted as a date.
  assert.equal(publicPostedDate({ updatedAt: 'not-a-date', postedAgo: '3 days ago' }, now), new Date(now - 3 * 86400_000).toISOString())
  assert.equal(parsePostedAgo('just now', now), new Date(now).toISOString())
  assert.equal(parsePostedAgo('45 minutes ago', now), new Date(now - 45 * 60_000).toISOString())
  assert.equal(parsePostedAgo('2 weeks ago', now), new Date(now - 14 * 86400_000).toISOString())
  // Nothing usable → null, so `JobPosting` omits `datePosted` rather than claiming today.
  assert.equal(parsePostedAgo('sometime recently', now), null)
  assert.equal(publicPostedDate({ postedAgo: '' }, now), null)
})

test('closing copy ages the way the member card does', () => {
  const now = Date.now()
  const iso = (ms: number) => new Date(now + ms).toISOString()
  assert.equal(publicClosingLabel(iso(-1000)).text, 'Closed')
  assert.equal(publicClosingLabel(iso(5 * 3600_000)).text, 'Closes today')
  assert.equal(publicClosingLabel(iso(30 * 3600_000)).text, 'Closes in 2 days')
  assert.equal(publicClosingLabel(iso(10 * 86400_000)).text, 'Closes in 10 days')
  assert.equal(publicClosingLabel('not-a-date').text, 'Closed')
})
