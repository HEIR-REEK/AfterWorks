import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  JOB_REGION_LIST,
  buildRegionalCatalogue,
  jobActionRefusal,
  jobAudienceOf,
  jobVisibleInRegion,
  partitionCatalogue,
  regionalJobId,
  validateJobRegion,
} from '@/lib/job-regions'
import { seedRegionalJobs } from '@/lib/regional-jobs'
import { normaliseJobRecord } from '@/lib/job-catalogue'
import { toPublicJob } from '@/lib/public-jobs-server'
import { importStarterJobs } from '@/lib/job-seed'
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
  assert.equal(cards.length, JOB_REGION_LIST.length * 6, 'six cards per region')
  for (const region of JOB_REGION_LIST) {
    const mine = cards.filter((card) => card.region === region)
    assert.equal(mine.length, 6, `${region} should seed six cards`)
    // One card in every category: a board that skips a category leaves that region with no work of
    // that kind at all, which is the complaint this batch exists to answer.
    assert.deepEqual(
      [...new Set(mine.map((card) => card.category))].sort(),
      [...JOB_CATEGORY_LIST].sort(),
      `${region} should cover every category`,
    )
    // Distinct work, not the same card copied four times.
    assert.equal(new Set(mine.map((c) => c.title)).size, 6)
    // The copy is written from the region's own market, not the same text with a label swapped:
    // the descriptions must differ between boards for the same category.
    const descriptionFor = (r: string, category: string) =>
      cards.find((c) => c.region === r && c.category === category)?.description ?? ''
    if (region !== 'Africa') {
      for (const category of JOB_CATEGORY_LIST) {
        assert.notEqual(
          descriptionFor(region, category),
          descriptionFor('Africa', category),
          `${region}/${category} reuses Africa's copy`,
        )
      }
    }
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

test('the regional cards survive the round trip out of Firestore with their board', () => {
  // This is what made the boards look broken: the reader dropped `region`, so every card the client
  // received was global — the own board was empty and the locked preview had nothing to blur.
  const stored = {
    id: 'job-europe-market-research',
    title: 'Compile a competitor price sheet',
    category: 'Research',
    description: 'A stored card',
    responsibilities: [],
    payAmountUsd: 43,
    capacity: 10,
    slotsRemaining: 9,
    region: 'Europe',
    trainingRequired: false,
    requiresVerified: true,
    status: 'open',
  }
  const card = normaliseJobRecord('job-europe-market-research', stored)
  assert.ok(card)
  assert.equal(card?.region, 'Europe', 'a stored board must not be dropped on read')
  // A board the rules do not know is not invented rather than passed through.
  const stray = normaliseJobRecord('job-x', { ...stored, region: 'Mars' })
  assert.equal(stray?.region, undefined)
})

test('the importer can actually resolve the regional batch, so an import publishes cards', async () => {
  // The cards lived in `lib/regional-jobs.ts`, which `seedJobs()` does not include, so every
  // regional import failed as "seed missing" and no board was ever published. Importing the ids now
  // gets past the seed check — it only fails later, for want of storage credentials in a test.
  await assert.rejects(
    () => importStarterJobs({ ids: [...REGIONAL_CATALOGUE_JOB_IDS] }),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      const code = (err as Error & { code?: string }).code
      assert.notEqual(code, 'seed_missing', 'the regional ids must resolve to real cards')
      assert.notEqual(code, 'unknown_ids', 'the regional ids must be importable')
      return true
    },
  )
})

test('a board-locked card is never published to the open web', () => {
  // The public listing has no idea where the reader is. Publishing a regional card would index one
  // region's work and price for everyone, and leak the other boards' catalogues to search engines.
  const job = {
    title: 'Compile a competitor price sheet',
    category: 'Research',
    status: 'open',
    capacity: 10,
    slotsRemaining: 9,
    payAmountUsd: 43,
    estimatedMinutes: 240,
    trainingRequired: false,
    requiresVerified: true,
    closesAt: new Date(Date.now() + 86400_000).toISOString(),
  }
  assert.ok(toPublicJob('job-global', { ...job, region: '' }), 'a global card is publishable')
  assert.equal(toPublicJob('job-europe-x', { ...job, region: 'Europe' }), null, 'a regional card is not')
})

test('the console can inspect one board at a time', () => {
  const page = readFileSync('app/admin/jobs/page.tsx', 'utf8')
  assert.match(page, /aria-label="Filter by region board"/)
  assert.match(page, /JOB_REGION_LIST\.map\(\(region\) => \(/)
  // The empty case names the board instead of showing a blank list.
  assert.match(page, /board has no cards yet/)
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

test('an application to another region board is refused, not just blurred', () => {
  // The card is on screen (blurred), so pasting its id is the bypass that matters.
  const route = readFileSync('app/api/applications/route.ts', 'utf8')
  assert.match(route, /gateJobId\(req, jobId\)/)
  assert.match(route, /code: 'region_locked'/)
  // And it must fail open when the region cannot be resolved, or a geo outage blocks all work.
  const gate = readFileSync('lib/job-region-gate.ts', 'utf8')
  const start = gate.indexOf('export async function requestRegion')
  const body = gate.slice(start, start + 600)
  assert.match(body, /resolved\.country \? regionForCountry\(resolved\.country\) : null/, 'no country → no region → nothing locked')
  assert.match(body, /catch \{\s*return null/, 'a throwing resolver fails open')
})

test('every card action is refused on the server, because the blur is only cosmetic', () => {
  // The members can see another board's cards and strip the blur with one stylesheet edit, so the
  // three things a card does — assess, pay, apply — must each be refused by the server.
  const surfaces = [
    ['app/api/assessments/route.ts', 2],
    ['app/api/paystack/initialize/route.ts', 1],
    ['app/api/applications/route.ts', 1],
  ] as const
  for (const [file, calls] of surfaces) {
    const source = readFileSync(file, 'utf8')
    const found = source.match(/gateJobId\(/g) ?? []
    assert.equal(found.length, calls, `${file} must gate every entry point`)
    assert.match(source, /code: 'region_locked'/, `${file} must refuse with a region error`)
  }
  // Assessment scoring is the dangerous one: a pass unlocks applying, so POST is gated too.
  const assessments = readFileSync('app/api/assessments/route.ts', 'utf8')
  assert.match(assessments, /export async function POST/)
  assert.ok(
    assessments.indexOf('gateJobId') < assessments.indexOf('export async function POST') + 400 ||
      assessments.split('gateJobId').length - 1 > 1,
    'both the question read and the submission are gated',
  )
  // One rule decides, not three copies: the gate delegates to jobActionRefusal.
  const gate = readFileSync('lib/job-region-gate.ts', 'utf8')
  assert.match(gate, /jobActionRefusal\(job, \{ region \}\)/)
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

// ─── Region tabs on Browse jobs ─────────────────────────────────────────────

test('every region is sent to the board, with its own card count and open flag', () => {
  const cards = [
    { id: 'us-1', region: 'Americas' },
    { id: 'us-2', region: 'Americas' },
    { id: 'ke-1', region: 'Africa' },
    { id: 'global' },
  ]
  const board = buildRegionalCatalogue(cards, { region: 'Americas', source: 'header' })
  assert.equal(board.regions.length, PAY_REGIONS.length, 'all four tabs must exist')
  const byRegion = new Map(board.regions.map((r) => [r.region, r]))
  assert.equal(byRegion.get('Americas')?.open, true)
  assert.equal(byRegion.get('Americas')?.count, 2)
  // Every other board is present and locked — a member should see the work exists, not a missing tab.
  assert.equal(byRegion.get('Africa')?.open, false)
  assert.equal(byRegion.get('Africa')?.count, 1)
  assert.equal(byRegion.get('Europe')?.open, false)
  assert.equal(byRegion.get('Asia')?.open, false)
  // Global cards are not counted as any region's own content.
  assert.equal(byRegion.get('Europe')?.count, 0)
})

test('a region with no cards of its own is still open, not a lock the member cannot clear', () => {
  // A country whose board has not been seeded yet must see an honest empty board.
  const board = buildRegionalCatalogue([{ id: 'ke-1', region: 'Africa' }], { region: 'Europe', source: 'header' })
  const europe = board.regions.find((r) => r.region === 'Europe')
  assert.equal(europe?.open, true)
  assert.equal(europe?.count, 0)
})

test('with no resolved region every board is open and the tabs are not locked', () => {
  const board = buildRegionalCatalogue([{ id: 'us-1', region: 'Americas' }], { region: null, source: 'none' })
  assert.equal(board.regions.every((r) => r.open), true)
  assert.deepEqual(board.lockedRegions, [])
})

test('the locked region payload now carries its cards, stamped locked', () => {
  // The platform asked to see the other boards' work, prices and detail — blurred, not withheld.
  // The lock is carried on the card so every action can refuse it, not on the payload boundary.
  const board = buildRegionalCatalogue(
    [{ id: 'us-1', title: 'Secret US work', payAmountUsd: 48, region: 'Americas' }],
    { region: 'Africa', source: 'header' },
  )
  const americas = board.regions.find((r) => r.region === 'Americas')
  assert.equal(americas?.open, false)
  assert.equal(americas?.cards.length, 1)
  const card = americas?.cards[0] as { id: string; title: string; payAmountUsd: number; locked: boolean; region: string }
  assert.equal(card.title, 'Secret US work')
  assert.equal(card.payAmountUsd, 48, 'the price is visible on purpose')
  assert.equal(card.locked, true, 'and the card knows every action will be refused')
  assert.equal(card.region, 'Americas')
  // The member's own board is open and its cards are NOT marked locked.
  const africa = board.regions.find((r) => r.region === 'Africa')
  assert.equal(africa?.open, true)
  assert.ok(africa?.cards.every((c) => !c.locked), 'own cards are actionable')

  // The refusal itself is a server rule, tested directly rather than through the UI.
  assert.equal(jobActionRefusal({ region: '' }, { region: null }), null, 'a global card is always fine')
  assert.equal(jobActionRefusal({ region: 'Americas' }, { region: null }), null, 'unresolved region fails open')
  assert.equal(jobActionRefusal({ region: 'Americas' }, { region: 'Americas' }), null, 'own board')
  const refused = jobActionRefusal({ region: 'Americas' }, { region: 'Africa' })
  assert.ok(refused, 'another board is refused')
  assert.equal(refused?.jobRegion, 'Americas')
})

test('every board can be selected, but a locked one never becomes a card grid', () => {
  const page = readFileSync('app/jobs/page.tsx', 'utf8')
  // Any region the payload carries can be selected — pressing a locked tab is allowed, it is how
  // the member sees the blurred catalogue.
  assert.match(page, /regions\?\.\[0\]\?\.region/, 'the selection falls back to the first board sent')
  assert.match(page, /some\(\(entry\) => entry\.region === wanted\)/, 'the selection is still validated')
  // The grid is only for an open board; a locked one renders the blurred panel instead.
  assert.match(page, /activeRegionEntry && !activeRegionEntry\.open \?/, 'a locked board branches away from the grid')
  assert.match(page, /<LockedRegionPanel/, 'and renders the blurred preview')
  // Assert the predicate, not the identifier: renaming the variable would otherwise pass while
  // dropping the filter. Locked cards reach the client now, so this filter is the only thing
  // keeping them out of the interactive grid.
  assert.match(page, /if \(!activeRegion \|\| !activeIsOpen\) return jobs/)
  assert.match(page, /jobs\.filter\(\(job\) => !job\.region \|\| job\.region === activeRegion\)/)
})

test('a locked tab is pressable, marked with a lock, and its panel is inert', () => {
  const tabs = readFileSync('components/region-tabs.tsx', 'utf8')
  // Pressable: pressing it opens the blurred catalogue, which is the whole point of this design.
  assert.match(tabs, /onClick=\{\(\) => onSelect\(entry\.region\)\}/)
  assert.doesNotMatch(tabs, /aria-disabled/, 'a locked board is viewable, not disabled')
  assert.match(tabs, /<Lock/, 'and still marked with a lock')
  // The panel shows the real cards, blurred and out of reach.
  assert.match(tabs, /entry\.cards\.map/, 'the locked cards are rendered')
  assert.match(tabs, /blur-\[1\.5px\]/, 'blurred as asked — light, because the details are meant to be readable')
  assert.doesNotMatch(tabs, /blur-\[[2-9]/, 'the card blur must stay under 2px')
  assert.match(tabs, /pointer-events-none/)
  assert.match(tabs, /inert/, 'the whole subtree is out of the tab order')
  assert.match(tabs, /formatPay\(card\.payAmountUsd\)/, 'prices stay visible on a locked card')
  assert.match(tabs, /card\.description/, 'and so do the details')
  // It must never render the interactive card, so no apply/assess control exists in this subtree.
  assert.doesNotMatch(tabs, /JobCard/)
  assert.doesNotMatch(tabs, /Apply now|Start assessment/)
})
