/**
 * Turn the 100 employment listings into cards the region boards can actually serve.
 *
 * A listing carries what an employment marketplace needs (employer, salary, experience level); a
 * board card carries what this platform's flow needs (a category, a pay figure per task, slots, a
 * training decision, a close date). This module is the bridge, and it is deliberate about the two
 * places where the shapes disagree:
 *
 *   • **Money.** A listing quotes `22 EUR hourly`. A card pays a per-task figure in USD, so the
 *     listing's pay is converted to USD and multiplied by the hours the platform expects the task to
 *     take. `PAY_BASIS` documents that multiplier, so the number on the card can be explained.
 *
 *   • **The employer's detail.** Responsibilities, skills, education, salary and the employer name
 *     have nowhere to live on `Job`, so they go in the description. Nothing is dropped: a member
 *     reading the card sees the same facts the listing carried.
 *
 * These cards are **published by the board, not stored**: the region catalogue serves them alongside
 * the seeded micro-work cards, so there is no import step and no Firestore write. Every generated
 * card's id is prefixed so the two batches can never collide.
 */

import type { Job } from '@/lib/afterworks-data'
import { PAY_BASIS, SAMPLE_JOBS, categoryForListing, type SampleJob, type SampleRegion } from '@/lib/sample-jobs'

export const LISTING_ID_PREFIX = 'listing'

/**
 * Sample listings are demo content, so the board labels them. Kept here so the card, the detail page
 * and the console all say the same thing.
 */
export const LISTING_BADGE = 'Sample listing'

/** The id a listing's board card uses. Stable, region-prefixed, distinct from the seeded cards. */
export function listingCardId(listing: SampleJob): string {
  return `${LISTING_ID_PREFIX}-${listing.referenceId.toLowerCase()}`
}

/** True when a card id belongs to the generated employment batch. */
export function isListingCardId(id: string): boolean {
  return id.startsWith(`${LISTING_ID_PREFIX}-`)
}

/**
 * The board prices each region on its own scale, and the band is the platform rule.
 *
 * The platform asked for two things that a raw currency conversion cannot both satisfy: Africa
 * stays below $15 a card, and the Americas sit above $45. So a listing's pay is **placed inside its
 * region's band**, by where it sits within its own country's salary range rather than by the exchange
 * rate. The advertised salary still travels with the card, so the member sees the employer's number
 * next to the board's.
 *
 * Inside a band, the ordering is preserved: a senior listing still pays more than a junior one.
 */
export const REGION_PAY_BAND: Record<SampleRegion, { min: number; max: number; floor: number }> = {
  // `floor` is the cheapest a card can be and still be worth opening; the band tops out below $15.
  Africa: { min: 6, max: 14, floor: 6 },
  // The Americas start above $45 and climb, which is what "more prices above 45" asks for.
  Americas: { min: 46, max: 72, floor: 46 },
  Europe: { min: 40, max: 62, floor: 40 },
  Asia: { min: 20, max: 40, floor: 20 },
}

/** Every listing's advertised salary normalised to an hour, in USD. */
const HOURLY_USD: Record<string, number> = Object.fromEntries(
  SAMPLE_JOBS.map((listing) => [listing.referenceId, listing.salaryUsd / PAY_BASIS[listing.salary.frequency].hoursPerPeriod]),
)

/** The hourly range of one region's listings, so a card can be placed inside its band. */
function regionHourlyRange(region: SampleRegion): { low: number; high: number } {
  const values = SAMPLE_JOBS.filter((listing) => listing.region === region).map((listing) => HOURLY_USD[listing.referenceId]!)
  return { low: Math.min(...values), high: Math.max(...values) }
}

/**
 * The figure a listing pays on its board.
 *
 * Position within the region's own salary range, mapped onto the region's band. Deliberately not a
 * currency conversion: the exchange rate would put a Nairobi card within a few dollars of a Berlin
 * one, which is exactly the complaint this replaces.
 */
export function boardPayUsd(listing: SampleJob): number {
  const band = REGION_PAY_BAND[listing.region]
  const { low, high } = regionHourlyRange(listing.region)
  const hourly = HOURLY_USD[listing.referenceId] ?? low
  // A flat region (one listing, or several at the same rate) lands at the middle of the band.
  const position = high > low ? (hourly - low) / (high - low) : 0.5
  const amount = band.min + position * (band.max - band.min)
  return Math.max(band.floor, Math.round(amount * 100) / 100)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** One listing → one board card. */
export function listingToCard(listing: SampleJob): Job {
  const category = categoryForListing(listing.title)
  const pay = boardPayUsd(listing)
  const payBasis = PAY_BASIS[listing.salary.frequency].label
  const money = `${listing.salary.amount.toLocaleString('en-US')} ${listing.salary.currency} ${listing.salary.frequency}`

  return {
    id: listingCardId(listing),
    title: listing.title,
    category,
    // The whole listing, in reading order, so nothing the employer said is lost on the card.
    description: [
      `${listing.description}`,
      `Employer: ${listing.company} (sample listing) · ${listing.city}, ${listing.country} · ${listing.employmentType} · ${listing.workArrangement} · ${listing.experienceLevel} experience.`,
      `Advertised pay: ${money}. On the ${listing.region} board this card pays $${pay.toFixed(2)} for a one-hour task, placed inside the board's own price band (the advertised rate normalised to an hour is $${(listing.salaryUsd / PAY_BASIS[listing.salary.frequency].hoursPerPeriod).toFixed(2)}).`,
      `Education: ${listing.education}. Application deadline: ${listing.applicationDeadline}. ${listing.applicants} applicants so far.`,
    ].join(' '),
    responsibilities: [
      ...listing.requiredSkills.map((skill) => `Bring: ${skill}`),
      ...listing.applicationRequirements.map((line) => `Application: ${line}`),
    ],
    payAmountUsd: pay,
    // One paid hour: the card's pay is the listing's hourly figure, so the work and the money match.
    estimatedMinutes: 60,
    capacity: 25,
    slotsRemaining: 25,
    // Assessment-only on purpose. These are the 100 demo listings, and the point of showing them is
    // that a member can see and start the work immediately: the built-in category bank is their
    // assessment, so there is no training fee to pay first and nothing invented to author.
    trainingRequired: false,
    // No authored questions: the built-in category bank is served, exactly as for the seeded batch.
    assessmentQuestions: [],
    region: listing.region,
    requiresVerified: true,
    status: 'open',
    closesAt: new Date(`${listing.applicationDeadline}T23:59:59Z`).toISOString(),
    postedAgo: 'sample listing',
  }
}
