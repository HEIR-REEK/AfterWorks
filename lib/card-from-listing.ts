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
import { PAY_BASIS, categoryForListing, type SampleJob, type SampleRegion } from '@/lib/sample-jobs'

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
 * The hourly figure a listing pays on the board, in USD.
 *
 * The advertised salary is normalised to an hour first — a monthly figure is divided by the hours a
 * month covers — so a card can be compared with the next card regardless of how the employer quoted
 * it. `PAY_BASIS` documents the divisors.
 */
export function hourlyPayUsd(listing: SampleJob): number {
  const basis = PAY_BASIS[listing.salary.frequency].hoursPerPeriod
  return Math.round((listing.salaryUsd / basis) * 100) / 100
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** One listing → one board card. */
export function listingToCard(listing: SampleJob): Job {
  const category = categoryForListing(listing.title)
  const pay = hourlyPayUsd(listing)
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
      `Advertised pay: ${money} — about $${pay.toFixed(2)} an hour, which is what this card pays for a one-hour task (derived by dividing a ${payBasis} figure by the hours it covers).`,
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
