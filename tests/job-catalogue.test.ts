import assert from 'node:assert/strict'
import test from 'node:test'
import type { Job } from '@/lib/afterworks-data'
import { sanitizeJob } from '@/lib/firestore-admin'
import {
  catalogueEntriesEqual,
  mergeCatalogue,
  normaliseAssessmentQuestions,
  normaliseJobRecord,
  normaliseTrainingSections,
} from '@/lib/job-catalogue'

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)

function document(overrides: Record<string, unknown> = {}) {
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
    requiresVerified: true,
    status: 'open',
    closesAt: '2026-02-01T00:00:00.000Z',
    postedAgo: '2 hours ago',
    ...overrides,
  }
}

test('a job card is keyed by the document id, not by a stale field inside the document', () => {
  // The console writes `id` on save, but documents created by hand or by an older build carry a
  // missing/renamed one. `getJob(id)` and `/jobs/[id]` address cards by document id, so the stored
  // field must never win over the reference — that mismatch made cards unopenable.
  const card = normaliseJobRecord('job-real-id', document({ id: 'job-stale-id' }))
  assert.equal(card?.id, 'job-real-id')

  const withoutStoredId = normaliseJobRecord('job-only-reference', document({ id: undefined }))
  assert.equal(withoutStoredId?.id, 'job-only-reference')
})

test('documents that are not renderable cards are dropped instead of rendering blanks', () => {
  // No id anywhere: nothing can address the card, so it is not shown.
  assert.equal(normaliseJobRecord('', { title: 'Copy review' }), null)
  // No usable title: the console refuses to save one, and an empty card helps nobody.
  assert.equal(normaliseJobRecord('job-x', { title: '   ' }), null)
  assert.equal(normaliseJobRecord('job-x', null), null)
})

test('a missing id field falls back to the document reference', () => {
  assert.equal(normaliseJobRecord('job-real-id', { title: 'Copy review' })?.id, 'job-real-id')
})

test('the per-job training price survives the round trip, including sub-dollar fees', () => {
  // This is the value the worker's card and the "Pay …" button show; it must be exactly what the
  // admin saved, because the server prices the Paystack charge from the same field.
  assert.equal(normaliseJobRecord('job-a', document({ trainingFeeUsd: 25 }))?.trainingFeeUsd, 25)
  assert.equal(normaliseJobRecord('job-a', document({ trainingFeeUsd: '18.75' }))?.trainingFeeUsd, 18.75)
  assert.equal(normaliseJobRecord('job-a', document({ trainingFeeUsd: 0.0077 }))?.trainingFeeUsd, 0.0077)
})

test('an absent or zero fee falls back to the global price rather than pricing training at zero', () => {
  // Pricing helpers treat "no fee" as "use the configured price", and so does /api/paystack/initialize.
  for (const fee of [undefined, null, 0, '', 'abc', -5]) {
    assert.equal(normaliseJobRecord('job-a', document({ trainingFeeUsd: fee }))?.trainingFeeUsd, undefined)
  }
})

test('a hand-edited document cannot push impossible numbers onto the board', () => {
  const card = normaliseJobRecord(
    'job-messy',
    document({ payAmountUsd: 'not-a-number', capacity: -4, slotsRemaining: 900, estimatedMinutes: 'soon' }),
    NOW,
  )
  assert.equal(card?.payAmountUsd, 0)
  assert.equal(card?.capacity, 1)
  // Slots can never exceed capacity, or the board would advertise places that cannot be filled.
  assert.equal(card?.slotsRemaining, 1)
  assert.equal(card?.estimatedMinutes, 60)
})

test('slots are clamped to capacity and to zero, and a status outside the enum reads as open', () => {
  assert.equal(normaliseJobRecord('job-a', document({ capacity: 20, slotsRemaining: 25 }))?.slotsRemaining, 20)
  assert.equal(normaliseJobRecord('job-a', document({ capacity: 20, slotsRemaining: -3 }))?.slotsRemaining, 0)
  assert.equal(normaliseJobRecord('job-a', document({ status: 'archived' }))?.status, 'open')
  assert.equal(normaliseJobRecord('job-a', document({ status: 'paused' }))?.status, 'paused')
  assert.equal(normaliseJobRecord('job-a', document({ category: 'Astrology' }))?.category, 'Data Entry')
})

test('a card without a closing date renders as a dated card, never "Closes in NaN days"', () => {
  const card = normaliseJobRecord('job-a', document({ closesAt: undefined, postedAgo: undefined }), NOW)
  assert.equal(card?.closesAt, new Date(NOW + 7 * 86400_000).toISOString())
  assert.equal(card?.postedAgo, 'just now')
})

test('authored training sections and quiz questions are normalised, and unusable rows are dropped', () => {
  assert.deepEqual(
    normaliseTrainingSections([
      { title: '  Section 1  ', content: 'Read this.' },
      { title: '', content: '   ' },
      'nonsense',
    ]),
    [{ title: 'Section 1', content: 'Read this.' }],
  )

  const questions = normaliseAssessmentQuestions([
    { question: 'Which is correct?', options: ['A', 'B', 'C'], correctIndex: 9 },
    { question: 'Too few options', options: ['only'], correctIndex: 0 },
    { question: '', options: ['A', 'B'], correctIndex: 0 },
  ])
  assert.equal(questions.length, 1)
  // A correct answer pointing past the end of the options is pulled back inside the list.
  assert.equal(questions[0]!.correctIndex, 2)
})

test('a refreshed snapshot updates changed cards and leaves unchanged ones identical', () => {
  const first = [normaliseJobRecord('job-a', document())!, normaliseJobRecord('job-b', document({ id: 'job-b', title: 'Second card' }))!]
  const edited = normaliseJobRecord('job-a', document({ trainingFeeUsd: 30 }))!

  const merged = mergeCatalogue(first, [edited, first[1]!])
  assert.equal(merged[0]!.trainingFeeUsd, 30)
  // Identity is preserved for the untouched row, so the grid does not re-mount every card on a poll.
  assert.equal(merged[1], first[1])
  assert.equal(catalogueEntriesEqual(first[0]!, edited), false)
})

test('a card deleted in the console leaves the board on the next snapshot', () => {
  const first = [normaliseJobRecord('job-a', document())!, normaliseJobRecord('job-b', document({ id: 'job-b', title: 'Second card' }))!]
  const merged = mergeCatalogue(first, [first[0]!])
  assert.deepEqual(
    merged.map((job) => job.id),
    ['job-a'],
  )
})

test('merging an unchanged snapshot returns the very same card objects', () => {
  const rows: Job[] = [normaliseJobRecord('job-a', document())!]
  const merged = mergeCatalogue(rows, [normaliseJobRecord('job-a', document())!])
  assert.equal(merged[0], rows[0])
})

// ─── The admin half of the round trip ────────────────────────────────────────────
//
// These cover the console edit itself: what the admin form sends has to end up in the `jobs/{id}`
// document the worker-side reads above consume. The fee is the field the board was reported to be
// showing stale values for, so it gets the strictest treatment.

function adminInput(overrides: Partial<Parameters<typeof sanitizeJob>[0]> = {}) {
  return {
    title: 'Transcribe Swahili call recordings',
    category: 'Transcription',
    description: 'Transcribe 20 short recordings.',
    responsibilities: ['Keep timestamps'],
    payAmountUsd: 35,
    estimatedMinutes: 120,
    capacity: 25,
    slotsRemaining: 25,
    trainingRequired: true,
    trainingFeeUsd: 12.5,
    requiresVerified: true,
    status: 'open',
    ...overrides,
  } as Parameters<typeof sanitizeJob>[0]
}

test('an admin fee edit is what gets stored, at the price the console showed', () => {
  const edited = sanitizeJob(adminInput({ trainingFeeUsd: 27.5 }), { trainingFeeUsd: 12.5 })
  assert.equal(edited.trainingFeeUsd, 27.5)
  assert.equal(edited.payAmountUsd, 35)

  // Sub-dollar prices are real prices (they map to Paystack's minimum charge) and keep 4 places.
  assert.equal(sanitizeJob(adminInput({ trainingFeeUsd: 0.0077 })).trainingFeeUsd, 0.0077)
})

test('an edit that does not touch the fee keeps the stored one instead of resetting it', () => {
  // A console save sends `trainingFeeUsd: undefined` when the field was never filled in; silently
  // falling back to the global price there would re-price every card the admin touched.
  const kept = sanitizeJob(adminInput({ trainingFeeUsd: undefined }), { trainingFeeUsd: 18 })
  assert.equal(kept.trainingFeeUsd, 18)

  // No stored fee either: the documented global default applies.
  assert.equal(sanitizeJob(adminInput({ trainingFeeUsd: undefined }), null).trainingFeeUsd, 10)
})

test('turning paid training off stores no fee, and the bounds are enforced server-side', () => {
  assert.equal(sanitizeJob(adminInput({ trainingRequired: false, trainingFeeUsd: 25 })).trainingFeeUsd, 0)
  assert.equal(sanitizeJob(adminInput({ trainingFeeUsd: 99_999 })).trainingFeeUsd, 1_000)
  assert.equal(sanitizeJob(adminInput({ trainingFeeUsd: -4 }), { trainingFeeUsd: 12.5 }).trainingFeeUsd, 12.5)
})

test('pay, capacity and slots are bounded so the worker card can always render honestly', () => {
  assert.equal(sanitizeJob(adminInput({ payAmountUsd: 0.01 })).payAmountUsd, 0.5)
  assert.equal(sanitizeJob(adminInput({ payAmountUsd: 9_999_999 })).payAmountUsd, 10_000)
  assert.equal(sanitizeJob(adminInput({ capacity: 0 })).capacity, 1)

  const overfilled = sanitizeJob(adminInput({ capacity: 10, slotsRemaining: 50 }))
  assert.equal(overfilled.slotsRemaining, 10)
})

test('an unknown category or status cannot reach the board', () => {
  assert.equal(sanitizeJob(adminInput({ category: 'Astrology' })).category, 'Data Entry')
  assert.equal(sanitizeJob(adminInput({ status: 'archived' })).status, 'open')
  assert.equal(sanitizeJob(adminInput({ status: 'paused' })).status, 'paused')
})

// ─── Snapshot application (the rules that keep an open board honest) ─────────────

import { applyCatalogueSnapshot, EMPTY_CATALOGUE, type CatalogueSnapshot } from '@/lib/job-catalogue'

const AT = '2026-01-15T12:00:01.000Z'

function snapshot(overrides: Partial<CatalogueSnapshot> = {}): CatalogueSnapshot {
  return { jobs: [], authoritative: true, sample: () => SAMPLE, at: AT, ...overrides }
}

const SAMPLE: Job[] = [normaliseJobRecord('job-sample', document({ id: 'job-sample', title: 'Sample card' }))!]

test('a snapshot with rows turns the board live and stamps the sync time', () => {
  const rows = [normaliseJobRecord('job-a', document())!]
  const next = applyCatalogueSnapshot(EMPTY_CATALOGUE, snapshot({ jobs: rows }))
  assert.equal(next.live, true)
  assert.equal(next.syncedAt, AT)
  assert.deepEqual(next.jobs.map((job) => job.id), ['job-a'])
})

test('an admin fee edit reaches the board through the next snapshot', () => {
  // The reported bug in one assertion: the board was showing 12.50 and the console had raised the
  // price to 30. Nothing here depends on a reload — the snapshot is the whole input.
  const before = applyCatalogueSnapshot(EMPTY_CATALOGUE, snapshot({ jobs: [normaliseJobRecord('job-a', document())!] }))
  assert.equal(before.jobs[0]!.trainingFeeUsd, 12.5)

  const after = applyCatalogueSnapshot(before, snapshot({ jobs: [normaliseJobRecord('job-a', document({ trainingFeeUsd: 30 }))!] }))
  assert.equal(after.jobs[0]!.trainingFeeUsd, 30)
  assert.equal(after.syncedAt, AT)
})

test('a failed read or an offline-cache replay leaves the board exactly as it was', () => {
  const live = applyCatalogueSnapshot(EMPTY_CATALOGUE, snapshot({ jobs: [normaliseJobRecord('job-a', document())!] }))
  assert.equal(applyCatalogueSnapshot(live, snapshot({ authoritative: false })), live)
  // A cached snapshot may still be applied when it carries rows (they are real catalogue rows),
  // but its omissions prove nothing, so it can only add or update — never remove.
  const cached = applyCatalogueSnapshot(live, snapshot({ jobs: [normaliseJobRecord('job-b', document({ id: 'job-b' }))!], authoritative: false }))
  assert.deepEqual(cached.jobs.map((job) => job.id), ['job-a', 'job-b'])
  assert.equal(cached.syncedAt, live.syncedAt)

  // The server snapshot that follows is what removes a card.
  const authoritative = applyCatalogueSnapshot(cached, snapshot({ jobs: [normaliseJobRecord('job-a', document())!] }))
  assert.deepEqual(authoritative.jobs.map((job) => job.id), ['job-a'])
})

test('an empty catalogue that the console really emptied clears the board instead of re-showing samples', () => {
  const live = applyCatalogueSnapshot(EMPTY_CATALOGUE, snapshot({ jobs: [normaliseJobRecord('job-a', document())!] }))
  const emptied = applyCatalogueSnapshot(live, snapshot())
  assert.deepEqual(emptied.jobs, [])
  assert.equal(emptied.live, true)
  assert.equal(emptied.syncedAt, AT)
})

test('sample cards are a first-run fallback only, and a poll never re-renders a stable board', () => {
  const first = applyCatalogueSnapshot(EMPTY_CATALOGUE, snapshot())
  assert.deepEqual(first.jobs.map((job) => job.id), ['job-sample'])
  assert.equal(first.live, false)
  assert.equal(first.syncedAt, null)

  // A failed first read on a fresh deployment still leaves something explorable on screen.
  const offline = applyCatalogueSnapshot(EMPTY_CATALOGUE, snapshot({ authoritative: false }))
  assert.deepEqual(offline.jobs.map((job) => job.id), ['job-sample'])

  // Nothing new from a repeated read: the same object, so React does not re-render the grid.
  assert.equal(applyCatalogueSnapshot(first, snapshot()), first)
})
