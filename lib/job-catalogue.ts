/**
 * The worker-facing shape of the job catalogue.
 *
 * Every worker surface — the dashboard's recommended cards, `/jobs`, `/jobs/[id]`, `/training/[id]`
 * and the "Applied" list — renders the same `jobs/{id}` documents the admin console authors. That
 * means an edit in the console (training price, pay, capacity, slots, status, title, description,
 * authored training sections or quiz) has to reach a browser that is *already open*, not only the
 * next hard reload.
 *
 * This module holds the two decisions that make that safe, both pure so they can be unit tested
 * without Firestore:
 *
 *  1. `normaliseJobRecord` turns a raw document into a `Job`. The id comes from the **document
 *     reference**, never from a stored field — a card whose stored `id` was missing or stale used
 *     to be unreachable at `/jobs/[id]` ("This job could not be found") even though it appeared on
 *     the board. Numbers and arrays are coerced so a hand-edited document cannot crash a card.
 *  2. `mergeCatalogue` applies a fresh snapshot (a Firestore listener event or a poll) while
 *     re-using the previous object for rows that did not change, so React re-renders only the cards
 *     that actually moved. The caller is responsible for never applying an empty/failed read over a
 *     populated board — see `applyLiveJobs` in the provider.
 */

import {
  JOB_CATEGORY_LIST,
  type AssessmentQuestion,
  type Job,
  type JobCategory,
  type JobStatus,
  type TrainingSection,
} from '@/lib/afterworks-data'

/** How many cards the bounded public read fetches. Kept in step with the Firestore helper. */
export const CATALOGUE_PAGE_SIZE = 60

/**
 * Fallback poll interval. The primary path is the Firestore listener (admin edits arrive in about a
 * second); this heals deployments where the listener's long-lived connection is blocked or died,
 * because a failed `onSnapshot` does not retry on its own.
 */
export const CATALOGUE_POLL_MS = 60_000

const JOB_STATUSES: readonly JobStatus[] = ['open', 'paused', 'closed']

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function number(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function stringList(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => text(entry, maxLength))
    .filter(Boolean)
    .slice(0, max)
}

/** Authored training sections, bounded the same way the admin route bounds them. */
export function normaliseTrainingSections(value: unknown): TrainingSection[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const section = (entry ?? {}) as Record<string, unknown>
      return {
        title: text(section.title, 140),
        content: typeof section.content === 'string' ? section.content.trim().slice(0, 8_000) : '',
      }
    })
    .filter((section) => section.title || section.content)
    .slice(0, 40)
}

/** Authored quiz questions; a row without text or with fewer than two options is not answerable. */
export function normaliseAssessmentQuestions(value: unknown): AssessmentQuestion[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const question = (entry ?? {}) as Record<string, unknown>
      const options = stringList(question.options, 4, 400)
      return {
        question: text(question.question, 500),
        options,
        correctIndex: clamp(Math.round(number(question.correctIndex, 0)), 0, Math.max(0, options.length - 1)),
      }
    })
    .filter((question) => question.question && question.options.length >= 2)
    .slice(0, 50)
}

/**
 * A raw `jobs/{id}` document → the `Job` the UI renders, or `null` when the document is not a
 * renderable card (no id, or no title at all — the console refuses to save either).
 *
 * `now` is injectable so the default `closesAt` is deterministic in tests.
 */
export function normaliseJobRecord(docId: string, raw: unknown, now: number = Date.now()): Job | null {
  const data = (raw ?? {}) as Record<string, unknown>
  const id = text(docId, 80) || text(data.id, 80)
  const title = text(data.title, 120)
  if (!id || !title) return null

  const capacity = clamp(Math.round(number(data.capacity, 1)), 1, 100_000)
  const slotsRaw = Math.round(number(data.slotsRemaining, capacity))
  const status = String(data.status ?? 'open') as JobStatus
  // A fee is only carried when it is a real, positive price: every pricing helper treats a missing
  // or zero fee as "use the globally configured price", and so does the server when it opens the
  // Paystack charge — so the card and the checkout cannot disagree.
  const fee = number(data.trainingFeeUsd, 0)
  const closesAt = typeof data.closesAt === 'string' && data.closesAt ? data.closesAt : new Date(now + 7 * 86400_000).toISOString()

  const category = String(data.category ?? 'Data Entry') as JobCategory

  return {
    id,
    title,
    category: JOB_CATEGORY_LIST.includes(category) ? category : 'Data Entry',
    description: typeof data.description === 'string' ? data.description.trim().slice(0, 4_000) : '',
    responsibilities: stringList(data.responsibilities, 12, 300),
    payAmountUsd: Math.max(0, number(data.payAmountUsd, 0)),
    estimatedMinutes: Math.max(5, Math.round(number(data.estimatedMinutes, 60))),
    capacity,
    slotsRemaining: clamp(Number.isFinite(slotsRaw) ? slotsRaw : capacity, 0, capacity),
    trainingRequired: data.trainingRequired === true,
    ...(fee > 0 ? { trainingFeeUsd: Math.round(fee * 10_000) / 10_000 } : {}),
    trainingNotes: normaliseTrainingSections(data.trainingNotes),
    assessmentQuestions: normaliseAssessmentQuestions(data.assessmentQuestions),
    requiresVerified: data.requiresVerified !== false,
    status: JOB_STATUSES.includes(status) ? status : 'open',
    closesAt,
    postedAgo: text(data.postedAgo, 40) || 'just now',
  }
}

/** True when two rows would render identically — used to keep object identity across snapshots. */
export function catalogueEntriesEqual(a: Job, b: Job): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.category === b.category &&
    a.description === b.description &&
    a.payAmountUsd === b.payAmountUsd &&
    a.estimatedMinutes === b.estimatedMinutes &&
    a.capacity === b.capacity &&
    a.slotsRemaining === b.slotsRemaining &&
    a.trainingRequired === b.trainingRequired &&
    a.trainingFeeUsd === b.trainingFeeUsd &&
    a.requiresVerified === b.requiresVerified &&
    a.status === b.status &&
    a.closesAt === b.closesAt &&
    a.postedAgo === b.postedAgo &&
    JSON.stringify(a.responsibilities) === JSON.stringify(b.responsibilities) &&
    JSON.stringify(a.trainingNotes ?? []) === JSON.stringify(b.trainingNotes ?? []) &&
    JSON.stringify(a.assessmentQuestions ?? []) === JSON.stringify(b.assessmentQuestions ?? [])
  )
}

/**
 * Apply a snapshot on top of what is on screen.
 *
 * The snapshot is the authority for *which* cards exist (a card deleted in the console must leave
 * the board), so rows missing from it are dropped. Unchanged rows keep their previous object, which
 * keeps the grid from re-mounting every card on every poll.
 */
export function mergeCatalogue(current: Job[], incoming: Job[]): Job[] {
  if (current.length === 0) return incoming
  const previous = new Map(current.map((job) => [job.id, job]))
  return incoming.map((job) => {
    const before = previous.get(job.id)
    return before && catalogueEntriesEqual(before, job) ? before : job
  })
}

/**
 * Additive apply, for a snapshot that proves nothing on its own (an offline-cache replay): rows it
 * carries are real catalogue rows, but their *absence* says nothing, so nothing is removed.
 */
export function mergeCatalogueAdditive(current: Job[], incoming: Job[]): Job[] {
  if (current.length === 0) return incoming
  const fresh = new Map(incoming.map((job) => [job.id, job]))
  // Known cards keep their position (a poll must not shuffle the board) and are replaced only when
  // they actually changed; cards the board has never seen are appended.
  const updated = current.map((row) => {
    const incomingRow = fresh.get(row.id)
    return incomingRow && !catalogueEntriesEqual(row, incomingRow) ? incomingRow : row
  })
  const additions = incoming.filter((job) => !current.some((row) => row.id === job.id))
  return additions.length > 0 ? [...updated, ...additions] : updated
}

/** What the board currently knows: the rows, whether they are real, and when they last synced. */
export type CatalogueState = {
  jobs: Job[]
  /** True once real catalogue rows have been applied in this session. */
  live: boolean
  /** When the board last matched Firestore; null while only sample cards are on screen. */
  syncedAt: string | null
}

/** One read: a listener event, a poll, or the first load. */
export type CatalogueSnapshot = {
  jobs: Job[]
  /**
   * False for a read that proved nothing — a failure, or an offline-cache replay. Only an
   * authoritative snapshot may take cards off the board.
   */
  authoritative: boolean
  /** Built-in sample cards, used while the deployment has no live catalogue to show. */
  sample: () => Job[]
  /** Timestamp to record; injected so the reducer stays a pure function in tests. */
  at: string
}

export const EMPTY_CATALOGUE: CatalogueState = { jobs: [], live: false, syncedAt: null }

/**
 * Fold one snapshot into the board.
 *
 * Three cases matter, and each one is a way the worker side used to get the wrong thing:
 *  • rows → apply them (an admin edit lands here);
 *  • an empty read that proved nothing (failure, offline cache) → change nothing, so a blip never
 *    empties a board the worker can still use;
 *  • an empty read that succeeded → the console really has no cards (or emptied them), so show an
 *    empty board rather than silently back-filling sample data over a live deployment.
 *
 * Sample cards are only ever a first-run fallback: once anything live has been seen they never
 * come back. The same object is returned when nothing changed, so polls do not re-render the grid.
 */
export function applyCatalogueSnapshot(state: CatalogueState, snapshot: CatalogueSnapshot): CatalogueState {
  if (snapshot.jobs.length > 0) {
    // A cached replay may add and update cards, but its *omissions* prove nothing, so it never
    // removes one — and it does not advance the "updated at" stamp, because it is not a fresh read.
    const jobs = snapshot.authoritative ? mergeCatalogue(state.jobs, snapshot.jobs) : mergeCatalogueAdditive(state.jobs, snapshot.jobs)
    return { jobs, live: true, syncedAt: snapshot.authoritative ? snapshot.at : state.syncedAt }
  }

  if (!snapshot.authoritative) {
    if (state.live || state.jobs.length > 0) return state
    return { jobs: snapshot.sample(), live: false, syncedAt: null }
  }

  if (state.live) return { jobs: [], live: true, syncedAt: snapshot.at }
  if (state.jobs.length > 0) return state
  return { jobs: snapshot.sample(), live: false, syncedAt: null }
}
