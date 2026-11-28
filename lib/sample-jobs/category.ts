/**
 * Listing helpers that need the platform's own types.
 *
 * Split from `index.ts` so the dataset module stays pure data and can be imported by anything — the
 * board mapping, a test, or a script — without pulling the card type along with it.
 */

import type { JobCategory } from '@/lib/afterworks-data'
import type { PaymentFrequency, SampleJob, SampleRegion } from './types'

/**
 * The work each board leads with.
 *
 * The complaint this fixes: every board showed the same roles in the same order, so "the jobs are
 * the same everywhere". Each region now has its own emphasis, taken from where that market's remote
 * hiring actually is — Africa skews annotation and support, Asia engineering and BPO, Europe
 * translation and compliance review, the Americas analytics and technical account work.
 *
 * The order is the board's placement order: position 0 fills the first row.
 */
export const REGION_LANES: Record<SampleRegion, readonly string[]> = {
  Africa: ['ai', 'support', 'data', 'content', 'admin', 'marketing'],
  Asia: ['engineering', 'support', 'design', 'operations', 'data', 'marketing'],
  Europe: ['language', 'review', 'data', 'design', 'engineering', 'support'],
  Americas: ['data', 'support', 'engineering', 'marketing', 'design', 'language'],
}

/**
 * Which lane a listing belongs to, inferred from its title.
 *
 * Ordered rules, first match wins, so "Technical Support Agent" is support before it is technical.
 * A lane is a *placement* concept — it decides where a card sits on its board — and deliberately not
 * a filter: every board still carries every listing it was given.
 */
const LANE_RULES: readonly (readonly [RegExp, string])[] = [
  [/transcri|translat|localis|localiz|tutor/i, 'language'],
  [/support|assistant|administrative|coordinator|project/i, 'support'],
  [/annotat|label|trainer|evaluator|ai /i, 'ai'],
  [/review|moderat|qa |tester|quality|security|cyber/i, 'review'],
  [/developer|engineer|python|web|mobile|software|frontend|backend|wordpress|it support|technician/i, 'engineering'],
  [/designer|ui\/ux|video|graphic/i, 'design'],
  [/marketing|seo|social|sales|business development|e-commerce|commerce/i, 'marketing'],
  [/data|analyst|research|insight/i, 'data'],
]

export function laneForListing(title: string): string {
  for (const [pattern, lane] of LANE_RULES) if (pattern.test(title)) return lane
  return 'operations'
}

/** Which lane position a listing takes on its board (0 = first). Unknown lanes sort last. */
export function laneRank(listing: SampleJob): number {
  const lanes = REGION_LANES[listing.region]
  const index = lanes.indexOf(laneForListing(listing.title))
  return index === -1 ? lanes.length : index
}

/**
 * The nearest work category for a listing.
 *
 * The board is organised by category and a card needs one. This is a keyword map rather than an
 * extra field on all 100 records: the title carries the meaning, and a hand-set field would drift
 * the moment somebody renames a title. Order matters — the first rule wins, so the specific
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
 * it covers before it is shown. That keeps every card comparable and it is stated here rather than
 * buried in a formula. The board then places that figure inside its region's band — see
 * `REGION_PAY_BAND` in `lib/card-from-listing.ts` — and the card repeats the original salary.
 */
export const PAY_BASIS: Record<PaymentFrequency, { label: string; hoursPerPeriod: number }> = {
  hourly: { label: 'hour', hoursPerPeriod: 1 },
  weekly: { label: 'week', hoursPerPeriod: 40 },
  monthly: { label: 'month', hoursPerPeriod: 160 },
}
