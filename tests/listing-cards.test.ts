import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { listingCards, listingCardsByRegion, findListingCard, isListingCardId, hourlyPayUsd } from '@/lib/job-cards'
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

test('the advertised salary survives into the card, and the hourly figure is explainable', () => {
  // A monthly salary divided by 160 hours, a weekly one by 40 — documented in PAY_BASIS so the
  // number on the card can be explained to the member who reads it.
  assert.equal(PAY_BASIS.monthly.hoursPerPeriod, 160)
  assert.equal(PAY_BASIS.weekly.hoursPerPeriod, 40)
  assert.equal(PAY_BASIS.hourly.hoursPerPeriod, 1)
  const monthly = SAMPLE_JOBS.find((listing) => listing.salary.frequency === 'monthly')!
  assert.equal(hourlyPayUsd(monthly), Math.round((monthly.salaryUsd / 160) * 100) / 100)
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
