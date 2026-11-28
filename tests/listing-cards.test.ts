import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { listingCards, listingCardsByRegion, findListingCard, isListingCardId, boardPayUsd, arrangeBoard, REGION_PAY_BAND } from '@/lib/job-cards'
import { seedRegionalJobs } from '@/lib/regional-jobs'
import { seedJobs } from '@/lib/afterworks-data'
import { payForRegion } from '@/lib/pay-regions'
import { buildRegionalCatalogue } from '@/lib/job-regions'
import { SAMPLE_JOBS } from '@/lib/sample-jobs'
import { categoryForListing, PAY_BASIS } from '@/lib/sample-jobs'

test('the 100 listings become 100 board cards, 25 on each board', () => {
  const cards = listingCards()
  assert.equal(cards.length, 100)
  const byRegion = listingCardsByRegion()
  for (const region of ['Europe', 'Africa', 'Asia', 'Americas'] as const) {
    assert.equal(byRegion[region].length, 25, `${region} board should carry 25 listing cards`)
    assert.ok(byRegion[region].every((card) => card.region === region), `${region} cards must name their board`)
  }
  // Ids cannot collide with the seeded micro-work batch, or with each other.
  assert.equal(new Set(cards.map((card) => card.id)).size, 100)
  for (const card of cards) assert.ok(isListingCardId(card.id), `${card.id} is not a listing id`)
  assert.equal(findListingCard(cards[0]!.id)?.id, cards[0]!.id)
  assert.equal(findListingCard('job-africa-invoice-entry'), null, 'a stored id must not resolve to a listing')
})

test('a listing card is complete enough for the board and the apply flow', () => {
  for (const card of listingCards()) {
    assert.ok(card.title.length > 3)
    assert.ok(card.description.length > 120, `${card.id} lost the employer detail`)
    assert.ok(card.responsibilities.length >= 3, `${card.id} needs responsibilities`)
    assert.ok(card.payAmountUsd > 0 && card.payAmountUsd < 500, `${card.id} has an implausible hourly pay`)
    assert.equal(card.estimatedMinutes, 60, 'the pay is an hourly figure, so the task is an hour')
    // Assessment-only: these are demo listings and must be startable without a training fee.
    assert.equal(card.trainingRequired, false)
    assert.equal(card.trainingFeeUsd, undefined)
    assert.equal(card.status, 'open')
    assert.ok(Date.parse(card.closesAt) > Date.now(), `${card.id} is already closed`)
    assert.ok(card.region)
  }
})

test('the advertised salary survives into the card, and the board price is explainable', () => {
  // A monthly salary divided by 160 hours, a weekly one by 40 — documented in PAY_BASIS so the
  // number on the card can be explained to the member who reads it.
  assert.equal(PAY_BASIS.monthly.hoursPerPeriod, 160)
  assert.equal(PAY_BASIS.weekly.hoursPerPeriod, 40)
  assert.equal(PAY_BASIS.hourly.hoursPerPeriod, 1)
  const monthly = SAMPLE_JOBS.find((listing) => listing.salary.frequency === 'monthly')!
  assert.ok(boardPayUsd(monthly) > 0)
  for (const listing of SAMPLE_JOBS) {
    const card = findListingCard(`listing-${listing.referenceId.toLowerCase()}`)!
    assert.ok(card.description.includes(listing.company), `${card.id} lost the employer name`)
    assert.ok(card.description.includes(listing.education), `${card.id} lost the education requirement`)
    assert.ok(card.description.includes(`${listing.salary.currency}`), `${card.id} lost the advertised currency`)
    assert.ok(card.description.includes(listing.applicationDeadline), `${card.id} lost the deadline`)
    assert.ok(card.description.includes(String(listing.applicants)), `${card.id} lost the applicant count`)
  }
})

test('every listing lands in a category, and the category drives its assessment', () => {
  const categories = new Set(listingCards().map((card) => card.category))
  assert.ok(categories.size >= 4, `expected several categories, got ${[...categories].join(', ')}`)
  // The built-in bank is the assessment, so the mapping must be one of the six the bank knows.
  for (const card of listingCards()) {
    assert.ok(['Data Entry', 'Transcription', 'Image Labeling', 'Content Review', 'Translation', 'Research'].includes(card.category))
  }
  assert.equal(categoryForListing('Transcription Specialist'), 'Transcription')
  assert.equal(categoryForListing('AI Data Annotator'), 'Image Labeling')
  assert.equal(categoryForListing('Junior Data Analyst'), 'Research')
  assert.equal(categoryForListing('Customer Support Representative'), 'Data Entry', 'no keyword match falls back')
})

test('the listing cards obey the region lock, exactly like the seeded batch', () => {
  // A member on the Europe board gets 25 cards; the other 75 travel for the blurred preview only.
  const board = buildRegionalCatalogue(listingCards(), { region: 'Europe', source: 'header' })
  assert.equal(board.jobs.length, 25)
  assert.ok(board.jobs.every((job) => job.region === 'Europe'))
  const africa = board.regions.find((entry) => entry.region === 'Africa')!
  assert.equal(africa.open, false)
  assert.equal(africa.count, 25)
  assert.equal(africa.cards.length, 25, 'the blurred preview carries the real cards')
  assert.ok(africa.cards.every((card) => card.locked === true))
})

test('the board, the assessment route and the apply path all know about listing cards', () => {
  const route = readFileSync('app/api/jobs/board/route.ts', 'utf8')
  assert.match(route, /listingCards\(\)/, 'the board must serve the generated cards')
  const admin = readFileSync('lib/firestore-admin.ts', 'utf8')
  assert.match(admin, /findListingCard\(jobId\)/, 'the assessment and apply paths must resolve them')
  assert.match(admin, /createListingApplication/, 'a listing needs its own application writer')
  // The provider resolves one for a deep link.
  const provider = readFileSync('components/afterworks-provider.tsx', 'utf8')
  assert.match(provider, /findListingCard\(id\)/)
})

// ─── The region lock has to cover the generated cards too ────────────────────

test('the server gate refuses another board’s listing card, document or not', async () => {
  // A generated listing has no `jobs/{id}` document. When the gate only read Firestore it saw
  // "missing" and waved the action through, so a member could take the Europe board's assessment
  // and apply to it from Kenya. The gate must resolve the card before deciding.
  const { NextRequest } = await import('next/server')
  const { gateJobId } = await import('@/lib/job-region-gate')
  const id = 'listing-sample-eu-001'

  const fromKenya = new NextRequest(`https://example.test/api/assessments?jobId=${id}`, {
    headers: { 'cf-ipcountry': 'KE' },
  })
  const refused = await gateJobId(fromKenya, id)
  assert.equal(refused.gate.ok, false, 'a Europe card must be refused to an African connection')
  if (!refused.gate.ok) assert.equal(refused.gate.jobRegion, 'Europe')

  const fromGermany = new NextRequest(`https://example.test/api/assessments?jobId=${id}`, {
    headers: { 'cf-ipcountry': 'DE' },
  })
  assert.equal((await gateJobId(fromGermany, id)).gate.ok, true, 'the same card is open on its own board')

  // An id that is neither stored nor generated keeps the route's own "not found" path.
  const unknown = new NextRequest('https://example.test/api/assessments?jobId=nope', { headers: { 'cf-ipcountry': 'KE' } })
  assert.equal((await gateJobId(unknown, 'nope')).gate.ok, true)
})

test('the refusal message reads like a sentence, and offers the unlock', async () => {
  const { jobActionRefusal } = await import('@/lib/job-regions')
  const europe = jobActionRefusal({ region: 'Europe', title: 'Virtual Assistant' }, { region: 'Africa' })
  assert.match(europe!.message, /Connect from a country in Europe/)
  // The new rule: a locked board is a price tier, so the refusal has to name the way in, not only the
  // way around it. "Connect from Europe" alone would hide the thing the platform now sells.
  assert.match(europe!.message, /Unlock Europe job prices/, 'a refusal must offer the paid unlock')
  const africa = jobActionRefusal({ region: 'Africa', title: 'AI Data Annotator' }, { region: 'Asia' })
  assert.match(africa!.message, /Connect from a country in Africa/, 'the phrase must read correctly for every board')
  const americas = jobActionRefusal({ region: 'Americas', title: 'Software Developer' }, { region: 'Europe' })
  assert.match(americas!.message, /Connect from a country in Americas/)
  assert.doesNotMatch(africa!.message, /from the Africa/)

  // A paid unlock clears the refusal for exactly that region, and for nothing else.
  assert.equal(
    jobActionRefusal({ region: 'Europe', title: 'Virtual Assistant' }, { region: 'Africa', unlockedRegions: ['Europe'] }),
    null,
    'a purchased tier is not a locked board',
  )
  assert.ok(
    jobActionRefusal({ region: 'Europe', title: 'Virtual Assistant' }, { region: 'Africa', unlockedRegions: ['Asia'] }),
    'paying for Asia must not open Europe',
  )
  assert.ok(
    jobActionRefusal({ region: 'Europe', title: 'Virtual Assistant' }, { region: 'Africa', unlockedRegions: ['europe'] }),
    'the unlock is compared exactly, not case-folded from a stray value',
  )
})

test('a Firestore snapshot cannot delete the generated cards', () => {
  // The listener reads stored documents only. Replacing the board with a snapshot removed the 100
  // listing cards a second after the route served them, which is why they appeared to vanish.
  const provider = readFileSync('components/afterworks-provider.tsx', 'utf8')
  assert.match(provider, /mergeCatalogueAdditive\(catalogueRef\.current\.jobs, scoped\)/, 'snapshots must merge, not replace')
  // And a missing document must not remove a listing card the member is reading.
  assert.match(provider, /if \(findListingCard\(id\)\) return null/)
})

// ─── Price bands and board placement ────────────────────────────────────────

test('the boards are priced in their own bands: Africa under $15, the Americas above $45', () => {
  // The platform rule, and the thing a raw currency conversion could not deliver: a Nairobi card
  // within a few dollars of a Berlin one.
  const byRegion = listingCardsByRegion()
  const africa = byRegion.Africa.map((card) => card.payAmountUsd)
  assert.ok(Math.max(...africa) < 15, `Africa must stay under $15, found ${Math.max(...africa)}`)
  assert.ok(Math.min(...africa) >= REGION_PAY_BAND.Africa.floor)
  const americas = byRegion.Americas.map((card) => card.payAmountUsd)
  assert.ok(Math.min(...americas) >= 45, `the Americas must start above $45, found ${Math.min(...americas)}`)
  for (const region of ['Europe', 'Asia'] as const) {
    const band = REGION_PAY_BAND[region]
    for (const pay of byRegion[region].map((card) => card.payAmountUsd)) {
      assert.ok(pay >= band.floor && pay <= band.max + 0.01, `${region} card at $${pay} is outside its band`)
    }
  }
  // And the ordering between boards still holds: Africa < Asia < Europe < Americas at the top end.
  const top = (region: keyof typeof byRegion) => Math.max(...byRegion[region].map((card) => card.payAmountUsd))
  assert.ok(top('Africa') < top('Asia'))
  assert.ok(top('Asia') < top('Europe'))
  assert.ok(top('Europe') < top('Americas'))
})

test('the seeded micro-work cards follow the same bands', () => {
  // The seeded batch is typed, so read the pay off it directly rather than through the loose
  // region payload the route ships.
  const seeded = seedRegionalJobs()
  const africa = seeded.filter((card) => card.region === 'Africa').map((card) => card.payAmountUsd)
  assert.ok(Math.max(...africa) < 15, `Africa micro-work must stay under $15, found ${Math.max(...africa)}`)
  const americas = seeded.filter((card) => card.region === 'Americas').map((card) => card.payAmountUsd)
  assert.ok(Math.min(...americas) > 45, `Americas micro-work must be above $45, found ${Math.min(...americas)}`)
})

test('each board is arranged differently — its own roles lead, in its own order', () => {
  const byRegion = listingCardsByRegion()
  const openings = new Set(['Europe', 'Africa', 'Asia', 'Americas'].map((region) => byRegion[region as 'Europe'][0]!.title))
  assert.equal(openings.size, 4, 'the four boards must not open with the same role')
  // Africa leads with its own emphasis (annotation and support), the Americas with analytics.
  assert.match(byRegion.Africa[0]!.title, /Annotator|Trainer|Assistant|Support/)
  assert.match(byRegion.Americas[0]!.title, /Analyst|Support|Developer/)
  // The orders are materially different, not a rotation of one list.
  const ids = Object.values(byRegion).map((cards) => cards.map((card) => card.id).join(','))
  assert.equal(new Set(ids).size, 4)
})

test('a member’s board opens with its own listings, with micro-work woven in', () => {
  const catalogue = [...seedRegionalJobs(), ...listingCards()]
  const board = buildRegionalCatalogue(catalogue, { region: 'Asia', source: 'header' })
  const arranged = arrangeBoard('Asia', board.jobs)
  assert.equal(arranged.length, board.jobs.length, 'arranging must not add or drop a card')
  assert.ok(arranged[0]!.id.startsWith('listing-'), 'the listing batch leads the board')
  // The seeded cards are interleaved, not pushed to the bottom.
  assert.ok(arranged.slice(0, 8).some((card) => !card.id.startsWith('listing-')), 'micro-work must be woven in')
  // Nothing from another board sneaks in.
  assert.ok(arranged.every((card) => !card.region || card.region === 'Asia'))
})

// ─── The whole board obeys the bands, not just the listing batch ─────────────

test('no card on the Africa board can be priced at or above $15', () => {
  // The complaint this fixes: the 100 listings were capped, but the 46 global cards still paid their
  // own scalar — a $70 transcription card appeared on the Africa board at $70.
  const catalogue = [...seedJobs(), ...seedRegionalJobs(), ...listingCards()]
  const board = buildRegionalCatalogue(catalogue, { region: 'Africa', source: 'header' })
  const arranged = arrangeBoard('Africa', board.jobs)
  const over = arranged.filter((card) => card.payAmountUsd >= 15)
  assert.deepEqual(over.map((card) => `${card.id} $${card.payAmountUsd}`), [], 'no Africa card may reach $15')
  // And the fee is money too: never above the same ceiling.
  for (const card of arranged.filter((entry) => entry.trainingRequired)) {
    assert.ok(Number(card.trainingFeeUsd ?? 0) <= 14, `${card.id} charges a fee above the Africa ceiling`)
  }
})

test('the Americas board sits above $45, global cards included', () => {
  const catalogue = [...seedJobs(), ...seedRegionalJobs(), ...listingCards()]
  const board = buildRegionalCatalogue(catalogue, { region: 'Americas', source: 'header' })
  const arranged = arrangeBoard('Americas', board.jobs)
  const under = arranged.filter((card) => card.payAmountUsd < 45)
  assert.deepEqual(under.map((card) => `${card.id} $${card.payAmountUsd}`), [], 'no Americas card may sit under $45')
})

test('the board shows the price it will pay, not a different one', () => {
  // The board is priced through `payForRegion`, the same function the payout uses, so the two can
  // never disagree — which they did while the board served the raw scalar.
  const catalogue = [...seedJobs(), ...seedRegionalJobs(), ...listingCards()]
  for (const region of ['Africa', 'Asia', 'Europe', 'Americas'] as const) {
    const board = buildRegionalCatalogue(catalogue, { region, source: 'header' })
    for (const card of board.jobs) {
      const expected = payForRegion(
        { payAmountUsd: card.payAmountUsd, payByRegion: card.payByRegion },
        region,
      )
      assert.equal(card.payAmountUsd, expected, `${card.id} on ${region} is displayed at a different price than it pays`)
    }
  }
})
