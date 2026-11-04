import assert from 'node:assert/strict'
import test from 'node:test'
import { EXPANDED_CATALOGUE_JOB_IDS, seedJobs } from '@/lib/afterworks-data'
import { importStarterJobs, starterJobInput } from '@/lib/job-seed'

test('a starter import carries the card, its briefing and the assessment fallback', () => {
  const job = seedJobs().find((entry) => entry.id === 'job-swahili-radio-interviews')
  assert.ok(job)

  const payload = starterJobInput(job)
  assert.equal(payload.id, job.id)
  assert.equal(payload.title, job.title)
  assert.equal(payload.category, job.category)
  assert.equal(payload.trainingRequired, true)
  assert.equal(payload.trainingFeeUsd, job.trainingFeeUsd)
  assert.equal(payload.trainingNotes?.length, job.trainingNotes?.length)
  assert.deepEqual(payload.assessmentQuestions, [], 'empty means the built-in category bank')
  assert.equal(payload.status, 'open')
  assert.equal(payload.closesAt, job.closesAt)
})

test('an assessment-only starter card is imported without a training charge', () => {
  const job = seedJobs().find((entry) => entry.id === 'job-retail-shelf-label')
  assert.ok(job)
  const payload = starterJobInput(job)
  assert.equal(payload.trainingRequired, false)
  assert.equal(payload.trainingFeeUsd, undefined)
})

test('the import refuses ids outside the reviewed expansion batch', async () => {
  await assert.rejects(
    () => importStarterJobs({ ids: ['job-swahili-radio-interviews', 'job-admin-created'] }),
    (err: unknown) =>
      err instanceof Error &&
      err.name === 'StarterImportError' &&
      (err as Error & { code?: string }).code === 'unknown_ids',
  )
  assert.ok(EXPANDED_CATALOGUE_JOB_IDS.includes('job-swahili-radio-interviews'))
})
