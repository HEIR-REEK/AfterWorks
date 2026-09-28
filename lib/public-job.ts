/**
 * The public (signed-out) shape of a job card, and the pure helpers that work on it.
 *
 * This module is deliberately free of `firebase-admin`, `next/headers` and anything else that only
 * exists on the server, because both halves of the job board import it: the Server Component that
 * reads the catalogue and the client component that filters it. `lib/public-catalogue.ts` is the
 * server-only half that actually performs the read.
 *
 * The rule that matters: **a `PublicJob` has no `trainingNotes` and no `assessmentQuestions`.**
 * Those are the authored training a worker pays for and the assessment answer key (`correctIndex`).
 * A public page serialises its props into the RSC payload the browser downloads, so leaking either
 * field would give away paid content to anyone who viewed source. `toPublicJob` is the only door
 * from `Job` to `PublicJob`, and `tests/public-catalogue.test.ts` fails if `Job` grows a field that
 * has not been classified here.
 */

import type { Job, JobCategory } from '@/lib/afterworks-data'

/**
 * A card with every paywalled field removed. The only job shape a public page may render.
 *
 * `updatedAt` is added rather than inherited: `Job` does not carry it, but the public pages need a
 * real timestamp for `JobPosting.datePosted`, for `<link rel="canonical">` freshness and for the
 * sitemap's `lastmod`. It is the last time an operator saved the card, which is not privileged.
 */
export type PublicJob = Omit<Job, 'trainingNotes' | 'assessmentQuestions'> & { updatedAt?: string }

/** Keys stripped before a card is rendered or serialised to a signed-out visitor. */
export const PAYWALLED_JOB_FIELDS = ['trainingNotes', 'assessmentQuestions'] as const

export function toPublicJob(job: Job): PublicJob {
  // Destructuring rather than `delete`: the result is a fresh object, so a caller still holding the
  // full card can never see it mutated, and the compiler rejects this line if `Job` grows a field
  // that is not in `PublicJob`.
  const { trainingNotes: _trainingNotes, assessmentQuestions: _assessmentQuestions, ...rest } = job
  return rest
}

/** Only cards a visitor could actually apply for right now. */
export function openPublicJobs(jobs: readonly PublicJob[]): PublicJob[] {
  return jobs.filter((job) => job.status === 'open' && job.slotsRemaining > 0)
}

/** Category → count of open cards, for the landing page and the board's filter chips. */
export function publicCategoryCounts(jobs: readonly PublicJob[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const job of openPublicJobs(jobs)) {
    counts[job.category] = (counts[job.category] ?? 0) + 1
  }
  return counts
}

/** True when `category` is one of the catalogue's categories — used to validate `?category=`. */
export function isPublicCategory(value: string, categories: readonly JobCategory[]): boolean {
  return (categories as readonly string[]).includes(value)
}

const AGO_UNITS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
}

/**
 * `"3 days ago"` → an ISO timestamp, or null when the string is not a relative age.
 *
 * Job documents store a human `postedAgo` and (since the console started writing it) an `updatedAt`.
 * Neither is a true "first published" date, so `publicPostedDate` prefers the real timestamp and only
 * estimates from the copy when there is nothing better — and returns null rather than inventing
 * `now`, because a wrong `datePosted` is what gets structured data a manual action.
 */
export function parsePostedAgo(postedAgo: string, now: number = Date.now()): string | null {
  const text = String(postedAgo ?? '').trim().toLowerCase()
  // No copy at all is not "just now" — it is no information, and `null` keeps the field out of the
  // structured data instead of publishing a date nobody ever wrote.
  if (!text) return null
  if (text === 'just now' || text === 'now') return new Date(now).toISOString()
  const match = /^(\d+)\s*(minute|hour|day|week|month)s?\s+ago$/.exec(text)
  if (!match) return null
  const amount = Number(match[1])
  const unit = AGO_UNITS[match[2]!]
  if (!Number.isFinite(amount) || !unit) return null
  return new Date(now - amount * unit).toISOString()
}

/** Best honest `datePosted` for a card, or null when the document carries no usable timestamp. */
export function publicPostedDate(job: Pick<PublicJob, 'updatedAt' | 'postedAgo'>, now: number = Date.now()): string | null {
  const updated = Date.parse(job.updatedAt ?? '')
  if (job.updatedAt && Number.isFinite(updated)) return new Date(updated).toISOString()
  return parsePostedAgo(job.postedAgo, now)
}

/** Closing copy shared by the public card and the board, so both age the same way. */
export function publicClosingLabel(closesAt: string): { text: string; urgent: boolean } {
  const ms = new Date(closesAt).getTime() - Date.now()
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24))
  if (!Number.isFinite(ms) || ms <= 0) return { text: 'Closed', urgent: true }
  if (days <= 1) return { text: 'Closes today', urgent: true }
  if (days <= 2) return { text: 'Closes in 2 days', urgent: true }
  return { text: `Closes in ${days} days`, urgent: false }
}
