import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ADZUNA_COUNTRIES,
  adzunaHomeUrl,
  adzunaJobFromRaw,
  adzunaSalaryCurrency,
  externalDescription,
  externalJobDocId,
  formatAdzunaSalary,
  formatExternalPosted,
  isAdzunaCountry,
  safeAdzunaRedirect,
  toExternalJobCard,
  type AdzunaJobRecord,
} from '@/lib/adzuna'

const ROOT = process.cwd()

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 4300123,
    title: 'Remote data entry assistant',
    description: '<strong>Remote</strong> data entry &amp; verification. <script>alert(1)</script>',
    created: '2026-11-01T09:00:00Z',
    redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/4300123?se=abc',
    company: { display_name: 'Example Research Ltd' },
    location: { display_name: 'London, UK' },
    category: { label: 'Admin Jobs', tag: 'admin-jobs' },
    salary_min: 24000,
    salary_max: 28000,
    salary_is_predicted: '0',
    contract_type: 'permanent',
    contract_time: 'full_time',
    ...overrides,
  }
}

test('Adzuna country handling never sends the unsupported Kenya code', () => {
  assert.ok(ADZUNA_COUNTRIES.includes('za'), 'South Africa is a supported market')
  assert.ok(ADZUNA_COUNTRIES.includes('gb'))
  assert.equal(isAdzunaCountry('ke'), false, 'Adzuna has no Kenya feed')
  assert.equal(isAdzunaCountry('KE'), false, 'country codes are lowercase')
  assert.equal(isAdzunaCountry('za'), true)
  assert.equal(adzunaHomeUrl('za'), 'https://www.adzuna.co.za')
  assert.equal(adzunaSalaryCurrency('za'), 'ZAR')
})

test('a raw advert is normalised, de-scripted and given a stable document id', () => {
  const job = adzunaJobFromRaw(raw(), 'gb', '2026-11-04T00:00:00.000Z')
  assert.ok(job, 'a well-formed advert maps')
  assert.equal(job?.source, 'adzuna')
  assert.equal(job?.sourceId, '4300123')
  assert.equal(job?.company, 'Example Research Ltd')
  assert.equal(job?.location, 'London, UK')
  assert.equal(job?.category, 'Admin Jobs')
  assert.equal(job?.contractType, 'Permanent')
  assert.equal(job?.contractTime, 'Full Time')
  assert.equal(job?.salaryMin, 24000)
  assert.equal(job?.salaryMax, 28000)
  assert.equal(job?.sourcePostedAt, '2026-11-01T09:00:00.000Z')
  assert.match(job?.description ?? '', /Remote data entry & verification/)
  assert.doesNotMatch(job?.description ?? '', /script|alert|</i)
  assert.equal(externalJobDocId(job as AdzunaJobRecord), 'gb_4300123')
})

test('predicted salaries are omitted rather than shown without Jobsworth attribution', () => {
  const predicted = adzunaJobFromRaw(raw({ salary_is_predicted: '1' }), 'gb')
  assert.ok(predicted)
  assert.equal(predicted?.salaryMin, undefined)
  assert.equal(predicted?.salaryMax, undefined)

  const booleanPredicted = adzunaJobFromRaw(raw({ salary_is_predicted: true }), 'gb')
  assert.equal(booleanPredicted?.salaryMin, undefined)
})

test('only an https Adzuna redirect is published', () => {
  assert.equal(safeAdzunaRedirect('https://www.adzuna.co.uk/jobs/land/ad/1'), 'https://www.adzuna.co.uk/jobs/land/ad/1')
  assert.equal(safeAdzunaRedirect('https://adzuna.co.za/jobs/land/ad/1'), 'https://adzuna.co.za/jobs/land/ad/1')
  assert.equal(safeAdzunaRedirect('http://www.adzuna.co.uk/jobs/land/ad/1'), '', 'http is downgraded out')
  assert.equal(safeAdzunaRedirect('https://evil.example/jobs/land/ad/1'), '', 'an off-network redirect is dropped')
  assert.equal(safeAdzunaRedirect('https://adzuna.co.uk.evil.example/'), '', 'a lookalike host is dropped')
  assert.equal(safeAdzunaRedirect('javascript:alert(1)'), '', 'a script URL is dropped')

  const offNetwork = adzunaJobFromRaw(raw({ redirect_url: 'https://evil.example/jobs/1' }), 'gb')
  assert.equal(offNetwork, null, 'an advert without a safe destination is not published')
})

test('a malformed id or title is dropped instead of rendering an empty card', () => {
  assert.equal(adzunaJobFromRaw(raw({ id: '' }), 'gb'), null)
  assert.equal(adzunaJobFromRaw(raw({ title: '   ' }), 'gb'), null)
  assert.equal(adzunaJobFromRaw(null, 'gb'), null)
})

test('plain-text description strips tags and decodes entities, with a length cap', () => {
  assert.equal(
    externalDescription('<p>One &amp; two</p><p>Three &#39;quoted&#39;</p>'),
    "One & two Three 'quoted'",
  )
  assert.equal(externalDescription('x'.repeat(900), 10).length, 10)
})

test('salary formatting uses the market currency and omits a range when only one bound exists', () => {
  const gbp = formatAdzunaSalary('gb', 30000, 40000).replace(/\u00a0/g, ' ')
  assert.match(gbp, /GBP/)
  assert.match(gbp, /30,000/)
  assert.match(gbp, /40,000/)
  assert.match(gbp, /–/)

  const zar = formatAdzunaSalary('za', 25000).replace(/\u00a0/g, ' ')
  assert.match(zar, /ZAR/)
  assert.match(zar, /25,000/)

  assert.equal(formatAdzunaSalary('gb'), '')
})

test('posted labels are relative when recent and absolute when old', () => {
  const now = Date.parse('2026-11-04T12:00:00Z')
  assert.equal(formatExternalPosted('2026-11-04T08:00:00Z', now), 'Listed today')
  assert.equal(formatExternalPosted('2026-11-03T08:00:00Z', now), 'Listed yesterday')
  assert.equal(formatExternalPosted('2026-10-30T08:00:00Z', now), 'Listed 5 days ago')
  assert.equal(formatExternalPosted('2026-10-15T08:00:00Z', now), 'Listed 2 weeks ago')
  assert.match(formatExternalPosted('2026-07-01T08:00:00Z', now), /2026/)
  assert.equal(formatExternalPosted('', now), 'Recently listed')
})

test('the public card drops expired adverts and fills every field', () => {
  const record = adzunaJobFromRaw(raw(), 'gb', '2026-11-04T00:00:00.000Z')
  assert.ok(record)
  const stored = { ...record, expiresAt: '2026-11-18T00:00:00.000Z' }
  const card = toExternalJobCard('gb_4300123', stored, Date.parse('2026-11-05T00:00:00Z'))
  assert.ok(card)
  assert.equal(card?.attributionUrl, 'https://www.adzuna.co.uk')
  assert.equal(card?.source, 'adzuna')
  assert.match(card?.contractLabel ?? '', /Full Time/)
  assert.match(card?.salaryLabel ?? '', /GBP/)
  assert.ok(card?.redirectUrl.startsWith('https://www.adzuna.co.uk/'))

  assert.equal(
    toExternalJobCard('gb_4300123', stored, Date.parse('2026-11-19T00:00:00Z')),
    null,
    'expired adverts are not rendered',
  )
  assert.equal(toExternalJobCard('x', { ...stored, source: 'other' }), null)
  assert.equal(toExternalJobCard('x', { ...stored, redirectUrl: 'https://evil.example/' }), null)
})

test('the external feed is a separate, attributed public surface and not in the sitemap', () => {
  const route = readFileSync(join(ROOT, 'app/api/admin/external-jobs/route.ts'), 'utf8')
  assert.match(route, /requireOwner\(req\)/, 'importing and removing the feed is owner authority')
  assert.match(route, /consumeBucket\('admin-external-jobs'/, 'upstream imports are rate limited')
  assert.match(route, /ADZUNA_APP_ID/, 'the route tells the operator which server variables are required')
  assert.doesNotMatch(route, /app_key=/, 'the route must not build or expose an upstream URL')

  const page = readFileSync(join(ROOT, 'app/work/external/page.tsx'), 'utf8')
  assert.match(page, /robots:\s*\{\s*index:\s*false/, 'third-party duplicate inventory must not be indexed')
  assert.match(page, /AdzunaAttribution/, 'every public external surface carries the attribution')

  const card = readFileSync(join(ROOT, 'components/external-job-card.tsx'), 'utf8')
  assert.match(card, /min-h-\[23px\]/, 'attribution must be at least 23px tall')
  assert.match(card, /min-w-\[116px\]/, 'attribution must be at least 116px wide')
  assert.match(card, /rel="noopener noreferrer nofollow sponsored"/, 'advert links are sponsored and isolated')

  const sitemap = readFileSync(join(ROOT, 'app/sitemap.ts'), 'utf8')
  assert.doesNotMatch(sitemap, /work\/external/, 'external inventory must not be invited into the index')

  const sync = readFileSync(join(ROOT, 'lib/external-jobs-server.ts'), 'utf8')
  assert.match(sync, /EXTERNAL_JOBS_COLLECTION = 'external_jobs'/, 'the feed lives outside the paid catalogue')
  assert.doesNotMatch(sync, /collection\('jobs'\)/, 'external adverts must never be written into jobs/')
  assert.match(sync, /toExternalJobCard/, 'storage output is re-validated before rendering')
})
