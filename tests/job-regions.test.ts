import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  JOB_REGION_LIST,
  buildRegionalCatalogue,
  jobAudienceOf,
  jobVisibleInRegion,
  partitionCatalogue,
  regionalJobId,
  validateJobRegion,
} from '@/lib/job-regions'
import { seedRegionalJobs } from '@/lib/regional-jobs'
import { PAY_REGIONS } from '@/lib/pay-regions'
import { REGIONAL_CATALOGUE_JOB_IDS, IMPORTABLE_CATALOGUE_JOB_IDS, JOB_CATEGORY_LIST } from '@/lib/afterworks-data'

/**
 * Each region has its own job cards, its own content and its own prices, and a member only sees the
 * board for the region they are connecting from. The other regions' cards are locked.
 *
 * Two things are easy to get wrong here and both are pinned below:
 *
 *  1. **A lock that ships the cards anyway.** A blurred card still carries its id, price and
 *     description. If the payload contains them, the blur is decoration. So locked regions travel
 *     as a name and a count, and there is no code path that sends their card bodies.
 *  2. **Accidentally building anti-VPN.** Connecting from America is *how a member chooses the
 *     American board*. A VPN is expected, allowed and deliberately unpunished — the tests assert
 *     that nothing in the detection path inspects proxies, Tor or a profile-country match.
 */

// ─── Scoping ────────────────────────────────────────────────────────────────

test('a card with no region is open everywhere, which is how the old catalogue behaves', () => {
  for (const region of PAY_REGIONS) {
    assert.equal(jobVisibleInRegion({}, region), true, `an unscoped card should be visible in ${region}`)
    assert.equal(jobVisibleInRegion({ region: '' }, region), true)
    assert.equal(jobVisibleInRegion({ region: null }, region), true)
  }
})

test('a scoped card is open only on its own board', () => {
  const card = { region: 'Americas' }
  assert.equal(jobVisibleInRegion(card, 'Americas'), true)
  for (const region of ['Africa', 'Europe', 'Asia'] as const) {
    assert.equal(jobVisibleInRegion(card, region), false, `Americas card should be locked in ${region}`)
  }
})

test('an unrecognised stored region falls back to global rather than hiding the card everywhere', () => {
  // Hiding it would look like a broken board for a typo an admin made; visible-everywhere is
  // recoverable and obvious in the console.
  assert.deepEqual(jobAudienceOf('Martian'), { kind: 'global' })
  assert.deepEqual(jobAudienceOf('americas'), { kind: 'region', region: 'Americas' })
  assert.deepEqual(jobAudienceOf(' EUROPE '), { kind: 'region', region: 'Europe' })
})

test('an unresolved region returns the whole catalogue instead of a blank board', () => {
  // Failing closed here would blank the board for a deployment with no geo source, which reads as
  // "the site is broken". Locking is a pricing decision, not a security boundary.
  const cards = [{ id: 'a', region: 'Americas' }, { id: 'b', region: 'Africa' }, { id: 'c' }]
  const board = buildRegionalCatalogue(cards, { region: null, source: 'none' })
  assert.equal(board.jobs.length, 3)
  assert.equal(board.wholeCatalogue, true)
  assert.deepEqual(board.lockedRegions, [])
})

test('a resolved region gets its own cards plus the global ones, and counts the rest', () => {
  const cards = [
    { id: 'us-1', region: 'Americas' },
    { id: 'us-2', region: 'Americas' },
    { id: 'ke-1', region: 'Africa' },
    { id: 'eu-1', region: 'Europe' },
    { id: 'global', region: '' },
  ]
  const board = buildRegionalCatalogue(cards, { region: 'Americas', source: 'header' })
  assert.deepEqual(board.jobs.map((c: { id: string }) => c.id), ['us-1', 'us-2', 'global'])
  assert.equal(board.wholeCatalogue, false)
  // Locked regions are named and counted, never sent as cards.
  assert.deepEqual(
    board.lockedRegions.map((r) => [r.region, r.count]),
    [['Africa', 1], ['Europe', 1]],
  )
  for (const locked of board.lockedRegions) {
    assert.ok(locked.label && locked.blurb, 'a locked region must explain itself')
    assert.equal('jobs' in locked, false, 'a locked region must not carry cards')
  }
})

test('the partition puts every card in exactly one bucket', () => {
  const cards = [{ region: 'Americas' }, { region: 'Asia' }, { region: 'Europe' }, {}]
  const { visible, locked } = partitionCatalogue(cards, 'Asia')
  assert.equal(visible.length + locked.reduce((sum, l) => sum + l.count, 0), cards.length)
})

test('the locked payload carries no card fields', () => {
  // Direct guarantee against "ship it and blur it": the shape the route sends has no room for a card.
  const board = buildRegionalCatalogue(
    [{ id: 'us-1', title: 'Secret US work', payAmountUsd: 48, region: 'Americas' }],
    { region: 'Africa', source: 'header' },
  )
  const serialised = JSON.stringify(board.lockedRegions)
  assert.doesNotMatch(serialised, /Secret US work/)
  assert.doesNotMatch(serialised, /us-1/)
  assert.doesNotMatch(serialised, /48/)
})

// ─── The seeded regional content ────────────────────────────────────────────

test('every region has its own cards, with its own content and price', () => {
  const cards = seedRegionalJobs()
  assert.equal(cards.length, JOB_REGION_LIST.length * 3, 'three cards per region')
  for (const region of JOB_REGION_LIST) {
    const mine = cards.filter((card) => card.region === region)
    assert.equal(mine.length, 3, `${region} should seed three cards`)
    // Distinct work, not the same card copied four times.
    assert.equal(new Set(mine.map((c) => c.title)).size, 3)
    for (const card of mine) {
      assert.ok(card.description.length > 80, `${card.id} needs real description copy`)
      assert.ok((card.responsibilities ?? []).length >= 3, `${card.id} needs responsibilities`)
      assert.ok((card.trainingNotes ?? []).length >= 3, `${card.id} needs training sections`)
      assert.ok((card.trainingFeeUsd ?? 0) > 0, `${card.id} is a paid training card`)
      assert.ok((card.assessmentQuestions ?? []).length >= 20, `${card.id} needs a full assessment`)
      assert.ok(JOB_CATEGORY_LIST.includes(card.category), `${card.id} has an unknown category`)
    }
  }
})

test('non-African regions are priced above Africa, which is the point of the split', () => {
  const cards = seedRegionalJobs()
  const byRegion = (region: string) => cards.filter((c) => c.region === region).map((c) => c.payAmountUsd)
  const africa = byRegion('Africa')
  for (const region of ['Americas', 'Europe', 'Asia']) {
    const other = byRegion(region)
    other.forEach((pay, index) => {
      assert.ok(pay > africa[index]!, `${region} card ${index} (${pay}) should pay more than Africa (${africa[index]})`)
    })
  }
  // And the ordering the platform asked for: Americas highest, then Europe, then Asia.
  const highest = (region: string) => Math.max(...byRegion(region))
  assert.ok(highest('Americas') > highest('Europe'))
  assert.ok(highest('Europe') > highest('Asia'))
  assert.ok(highest('Asia') > highest('Africa'))
})

test('every seeded assessment question is answerable and internally consistent', () => {
  for (const card of seedRegionalJobs()) {
    for (const [index, question] of (card.assessmentQuestions ?? []).entries()) {
      assert.ok(question.question.length > 20, `${card.id} q${index + 1} is too short to be a real question`)
      assert.ok(question.options.length === 4, `${card.id} q${index + 1} should offer four options`)
      assert.ok(
        question.correctIndex >= 0 && question.correctIndex < question.options.length,
        `${card.id} q${index + 1} points at an option that does not exist`,
      )
      assert.equal(new Set(question.options).size, question.options.length, `${card.id} q${index + 1} repeats an option`)
      assert.ok((question.explanation ?? '').length > 20, `${card.id} q${index + 1} needs an explanation`)
    }
  }
})

test('the seeded ids are exactly the ids the importer will accept', () => {
  const seeded = seedRegionalJobs().map((job) => job.id)
  assert.deepEqual([...seeded].sort(), [...REGIONAL_CATALOGUE_JOB_IDS].sort())
  for (const id of seeded) {
    assert.ok(
      (IMPORTABLE_CATALOGUE_JOB_IDS as readonly string[]).includes(id),
      `${id} is seeded but the importer would refuse it`,
    )
  }
})

test('region-prefixed ids cannot collide with each other', () => {
  assert.equal(regionalJobId('Africa', 'Invoice Entry'), 'job-africa-invoice-entry')
  assert.equal(regionalJobId('Americas', 'invoice-entry'), 'job-americas-invoice-entry')
  const ids = seedRegionalJobs().map((job) => job.id)
  assert.equal(new Set(ids).size, ids.length)
})

// ─── No anti-VPN, by design ─────────────────────────────────────────────────

test('nothing in the region path inspects proxies, Tor or a VPN', () => {
  // An explicit requirement: a member on a VPN in the Americas opens the Americas board, and that
  // is intended. This fails the day somebody "hardens" it.
  const source = readFileSync('lib/job-regions.ts', 'utf8')
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
  assert.doesNotMatch(code, /proxy|vpn|tor\b|anonymous/i, 'the region rule must not detect proxies or VPNs')
  assert.doesNotMatch(code, /verifiedCountry|declaredCountry/, 'visibility is decided by the connection, not the profile')
})

test('the board route resolves the region from the request, and reads no profile field', () => {
  const route = readFileSync('app/api/jobs/board/route.ts', 'utf8')
  assert.match(route, /resolveRequestCountry\(req\.headers/)
  assert.match(route, /buildRegionalCatalogue/)
  assert.doesNotMatch(route, /verifiedCountry/, 'the board is not the profile')
  // Per-member answer must not land in a shared cache keyed on nothing.
  assert.match(route, /private, max-age=60/)
  assert.match(route, /Vary:/)
})

test('an application to another region board is refused, not just hidden', () => {
  // Hiding the card is a courtesy; pasting its id is the actual bypass.
  const route = readFileSync('app/api/applications/route.ts', 'utf8')
  assert.match(route, /checkJobRegionForRequest\(req, jobId\)/)
  assert.match(route, /code: 'region_locked'/)
  // And it must fail open when the region cannot be resolved, or a geo outage blocks all work.
  const start = route.indexOf('async function checkJobRegionForRequest')
  const body = route.slice(start, start + 2_000)
  assert.match(body, /if \(!resolved\.country\) return \{ ok: true \}/)
})

test('the client cannot undo the lock with a Firestore snapshot', () => {
  // The listener reads the whole collection; without this filter it would put another region's
  // cards back on screen a second after the board route removed them.
  const provider = readFileSync('components/afterworks-provider.tsx', 'utf8')
  assert.match(provider, /jobVisibleInRegion/)
  assert.match(provider, /const region = boardRef\.current\?\.region/, 'the snapshot filter reads the server-resolved region')
})

// ─── Console ────────────────────────────────────────────────────────────────

test('the console can set a card’s region, and refuses one it does not know', () => {
  assert.deepEqual(validateJobRegion(''), { ok: true, value: '' })
  assert.deepEqual(validateJobRegion('global'), { ok: true, value: '' })
  assert.deepEqual(validateJobRegion('europe'), { ok: true, value: 'Europe' })
  // An unknown region is an error, not a silent global card.
  assert.equal(validateJobRegion('Mars').ok, false)

  const page = readFileSync('app/admin/jobs/page.tsx', 'utf8')
  assert.match(page, /label="Region board"/)
  assert.match(page, /region: editing\.region/)
})
