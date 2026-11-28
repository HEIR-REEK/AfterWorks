/**
 * The board's employment cards, generated from the 100 sample listings.
 *
 * This is the bridge the board imports: it converts each listing into a card the existing apply,
 * training and assessment flow already understands, and exposes them grouped by board. The
 * converter itself lives in `lib/card-from-listing.ts`, which is pure and testable.
 */

import type { Job } from '@/lib/afterworks-data'
import { SAMPLE_JOBS, laneRank, type SampleRegion } from '@/lib/sample-jobs'
import { JOB_REGION_LIST } from '@/lib/job-regions'
import { LISTING_ID_PREFIX, listingCardId, listingToCard, boardPayUsd } from '@/lib/card-from-listing'

/**
 * The fields the board reads to arrange a card.
 *
 * Deliberately loose: the route arranges documents it has projected into `Record<string, unknown>`,
 * while the listing path arranges typed cards. Both go through one rule, and both are read through
 * the same accessors below, so neither call site needs a cast of its own.
 */
export type BoardRow = { id?: unknown; region?: unknown; payAmountUsd?: unknown; title?: unknown }

function rowOf(card: unknown): { id: string; region: string; pay: number; title: string } {
  const row = (card ?? {}) as Record<string, unknown>
  return {
    id: String(row.id ?? ''),
    region: typeof row.region === 'string' ? row.region : '',
    pay: Number(row.payAmountUsd ?? 0) || 0,
    title: String(row.title ?? ''),
  }
}

export { LISTING_ID_PREFIX, listingCardId, listingToCard, boardPayUsd, REGION_PAY_BAND } from '@/lib/card-from-listing'

/** True when a card id belongs to the generated employment batch. */
export function isListingCardId(id: string): boolean {
  return id.startsWith(`${LISTING_ID_PREFIX}-`)
}

/**
 * One generated card by id.
 *
 * Used by the assessment and application routes, which are handed an id from a client the browser
 * could have edited. Returns null for anything that is not a listing card, so a stored id never
 * resolves here by accident.
 */
export function findListingCard(id: string): Job | null {
  if (!isListingCardId(id)) return null
  const listing = SAMPLE_JOBS.find((entry) => listingCardId(entry) === id)
  return listing ? listingToCard(listing) : null
}

/** All 100 listing cards, each board's slice in that board's order. */
export function listingCards(): Job[] {
  const byRegion = listingCardsByRegionUnordered()
  return (Object.keys(byRegion) as SampleRegion[]).flatMap((region) => orderListingCards(byRegion[region]))
}

/**
 * The order a board shows its listings in.
 *
 * Each region leads with its own kind of work (see `REGION_LANES`), so the four boards do not open
 * with the same roles in the same order — which is what made them look like one list copied four
 * times. Within a lane the best-paid cards come first, so each board's first row is its strongest
 * draw rather than an alphabetical accident.
 */
export function orderListingCards<T>(cards: T[]): T[] {
  const byId = new Map(SAMPLE_JOBS.map((listing) => [listingCardId(listing), listing]))
  return [...cards].sort((a, b) => {
    const left = rowOf(a)
    const right = rowOf(b)
    const listingA = byId.get(left.id)
    const listingB = byId.get(right.id)
    const rankA = listingA ? laneRank(listingA) : 99
    const rankB = listingB ? laneRank(listingB) : 99
    if (rankA !== rankB) return rankA - rankB
    if (right.pay !== left.pay) return right.pay - left.pay
    return left.title.localeCompare(right.title)
  })
}

/** The grouping step, without any ordering: the one place the 100 are sorted into boards. */
function listingCardsByRegionUnordered(): Record<SampleRegion, Job[]> {
  const grouped = {} as Record<SampleRegion, Job[]>
  for (const region of JOB_REGION_LIST as readonly SampleRegion[]) grouped[region] = []
  for (const listing of SAMPLE_JOBS) grouped[listing.region].push(listingToCard(listing))
  return grouped
}

/**
 * Which micro-work card each board opens with.
 *
 * The seeded batch is the same six roles on every board (only the copy differs), so serving it in
 * one fixed order made all four boards start with the same card — which is what "the placements
 * should differ" is about. Each board starts at a different point in that list, matching where its
 * emphasis sits in `REGION_LANES`.
 */
const SEED_OPENING: Record<SampleRegion, number> = { Africa: 0, Asia: 2, Europe: 4, Americas: 5 }

/**
 * Arrange one board.
 *
 * Three decisions, in order of what a member sees first:
 *   1. the board's own listings lead, in that board's lane order — so the first row is its kind of
 *      work, not a copy of the next board's first row;
 *   2. a micro-work card is woven in every third slot, because a board of nothing but demo listings
 *      reads like a mock-up;
 *   3. cards open to every board come last, where they do not displace a region's own work.
 */
export function arrangeBoard<T>(region: SampleRegion, cards: T[]): T[] {
  const own = cards.filter((card) => {
    const { region: cardRegion } = rowOf(card)
    return !cardRegion || cardRegion === region
  })
  const listings = orderListingCards(own.filter((card) => isListingCardId(rowOf(card).id)))
  const seeded = own.filter((card) => {
    const { id, region: cardRegion } = rowOf(card)
    return cardRegion === region && !isListingCardId(id)
  })
  const opening = SEED_OPENING[region] ?? 0
  const rotated = [...seeded.slice(opening), ...seeded.slice(0, opening)]
  const global = own.filter((card) => !rowOf(card).region)

  const arranged: T[] = []
  let nextSeed = 0
  listings.forEach((card, index) => {
    arranged.push(card)
    if ((index + 1) % 2 === 0 && nextSeed < rotated.length) arranged.push(rotated[nextSeed++]!)
  })
  arranged.push(...rotated.slice(nextSeed))
  arranged.push(...global)
  return arranged
}

/** The listing cards, grouped by the board that should show them, in that board's order. */
export function listingCardsByRegion(): Record<SampleRegion, Job[]> {
  const grouped = listingCardsByRegionUnordered()
  for (const region of JOB_REGION_LIST as readonly SampleRegion[]) grouped[region] = orderListingCards(grouped[region])
  return grouped
}
