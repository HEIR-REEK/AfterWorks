/**
 * The board's employment cards, generated from the 100 sample listings.
 *
 * This is the bridge the board imports: it converts each listing into a card the existing apply,
 * training and assessment flow already understands, and exposes them grouped by board. The
 * converter itself lives in `lib/card-from-listing.ts`, which is pure and testable.
 */

import type { Job } from '@/lib/afterworks-data'
import { SAMPLE_JOBS, type SampleRegion } from '@/lib/sample-jobs'
import { JOB_REGION_LIST } from '@/lib/job-regions'
import { LISTING_ID_PREFIX, listingCardId, listingToCard, hourlyPayUsd } from '@/lib/card-from-listing'

export { LISTING_ID_PREFIX, listingCardId, listingToCard, hourlyPayUsd }

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
  return listingCards().find((card) => card.id === id) ?? null
}

/** All 100 listing cards. */
export function listingCards(): Job[] {
  return SAMPLE_JOBS.map(listingToCard)
}

/** The listing cards, grouped by the board that should show them. */
export function listingCardsByRegion(): Record<SampleRegion, Job[]> {
  const grouped = {} as Record<SampleRegion, Job[]>
  for (const region of JOB_REGION_LIST as readonly SampleRegion[]) grouped[region] = []
  for (const card of listingCards()) grouped[card.region as SampleRegion].push(card)
  return grouped
}
