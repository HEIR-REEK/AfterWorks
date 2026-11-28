import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { SAMPLE_JOBS, SAMPLE_JOBS_BY_REGION, SAMPLE_JOBS_DISCLOSURE, type SampleRegion } from '@/scripts/sample-jobs'
import { validateSampleJobs, REGION_TOTALS } from '@/scripts/sample-jobs/validate'

const REGIONS: SampleRegion[] = ['Europe', 'Africa', 'Asia', 'Americas']

test('the sample catalogue is exactly 100 listings, 25 per region', () => {
  assert.equal(SAMPLE_JOBS.length, 100)
  for (const region of REGIONS) {
    assert.equal(SAMPLE_JOBS_BY_REGION[region].length, REGION_TOTALS[region], `${region} should hold 25`)
    assert.equal(new Set(SAMPLE_JOBS_BY_REGION[region].map((job) => job.title)).size, 25, `${region} repeats a title`)
  }
})

test('every listing satisfies the brief — the validator finds nothing', () => {
  // Countries spread, local currency per country, all three experience levels and arrangements, all
  // four employment types, 2–4 sentence descriptions, skills, requirements, deadlines, sample flag.
  assert.deepEqual(validateSampleJobs(), [])
})

test('no listing claims to be a verified vacancy', () => {
  for (const job of SAMPLE_JOBS) {
    assert.equal(job.isSample, true, `${job.referenceId} is not marked as a sample`)
    // Nothing in the record may read as a verification claim.
    const record = JSON.stringify(job).toLowerCase()
    assert.doesNotMatch(record, /verified vacancy|verified job|guaranteed salary/)
  }
  assert.match(SAMPLE_JOBS_DISCLOSURE, /fictional/i)
  assert.match(SAMPLE_JOBS_DISCLOSURE, /not verified vacancies/i)
})

test('the shipped exports are current — regenerate with `npm run sample:jobs`', () => {
  const json = JSON.parse(readFileSync('data/sample-job-listings/sample-jobs.json', 'utf8'))
  assert.equal(json.length, 100)
  assert.deepEqual(json, JSON.parse(JSON.stringify(SAMPLE_JOBS)), 'JSON export is stale')
  const sql = readFileSync('data/sample-job-listings/sample-jobs.sql', 'utf8')
  assert.equal((sql.match(/^\(/gm) ?? []).length, 100, 'SQL export should hold 100 rows')
  assert.match(sql, /is_sample/)
  const markdown = readFileSync('data/sample-job-listings/SAMPLE_JOB_LISTINGS.md', 'utf8')
  assert.equal((markdown.match(/^### \d+\. /gm) ?? []).length, 100, 'the document should list all 100')
  for (const region of REGIONS) assert.match(markdown, new RegExp(`## ${region.toUpperCase()} — 25 JOBS`))
})

test('the business-listing shape keeps its own currency alongside the USD view', () => {
  // An international board has to show the employer's currency, not only a converted figure.
  for (const job of SAMPLE_JOBS) {
    assert.match(job.salary.currency, /^[A-Z]{3}$/)
    assert.ok(['hourly', 'weekly', 'monthly'].includes(job.salary.frequency))
    assert.ok(job.salaryUsd > 0)
  }
})
