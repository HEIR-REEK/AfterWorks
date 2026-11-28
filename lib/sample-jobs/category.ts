/**
 * Listing helpers that need the platform's own types.
 *
 * Split from `index.ts` so the dataset module stays pure data and can be imported by anything — the
 * board mapping, a test, or a script — without pulling the card type along with it.
 */

import type { JobCategory } from '@/lib/afterworks-data'
import type { PaymentFrequency } from './types'

/**
 * The nearest work category for a listing.
 *
 * The board is organised by category and a card needs one. This is a keyword map rather than an
 * extra field on all 100 records: the title carries the meaning, and a hand-set field would drift
 * the moment somebody renames a title. Order matters — the first rule that wins, so the specific
 * patterns come before the general ones (a "Data Analyst" is Research, not Data Entry).
 */
const CATEGORY_RULES: readonly (readonly [RegExp, JobCategory])[] = [
  [/transcri|subtitle|caption/i, 'Transcription'],
  [/translat|localis|localiz/i, 'Translation'],
  [/label|annotat/i, 'Image Labeling'],
  [/review|moderat|policy|quality|tester/i, 'Content Review'],
  [/research|analyst|analysis|seo|marketing|business development|sales|tutor|recruit/i, 'Research'],
]

export function categoryForListing(title: string): JobCategory {
  for (const [pattern, category] of CATEGORY_RULES) if (pattern.test(title)) return category
  return 'Data Entry'
}

/**
 * How a listing's advertised pay becomes the figure on its card.
 *
 * A card pays for an hour of work, so a weekly or monthly salary is divided by the standard period
 * it covers before it is shown. That keeps every card comparable — a $3,000-a-month role and a $20
 * an-hour role end up on the same scale — and it is stated here rather than buried in a formula,
 * because a member is entitled to ask where the number on the card came from. The card's own
 * description repeats the original advertised salary next to the derived hourly figure.
 */
export const PAY_BASIS: Record<PaymentFrequency, { label: string; hoursPerPeriod: number }> = {
  hourly: { label: 'hour', hoursPerPeriod: 1 },
  weekly: { label: 'week', hoursPerPeriod: 40 },
  monthly: { label: 'month', hoursPerPeriod: 160 },
}
