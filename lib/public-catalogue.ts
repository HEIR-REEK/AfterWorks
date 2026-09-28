/**
 * Server-side reads that back the public, indexable pages (`/`, `/jobs`, `/jobs/[id]`).
 *
 * Why the read is on the server: `firestore.rules` allows `jobs/{jobId}` reads only for
 * `signedIn() || isStaff()`, so a browser with no session gets `permission-denied`. The Admin SDK is
 * not subject to those rules, which means the marketing pages can render real cards **without
 * weakening a single rule** — the catalogue stays closed to anonymous client reads and open only to
 * our own server. A crawler gets full HTML; it never gets a Firestore credential.
 *
 * Only `PublicJob` values leave this module. See `lib/public-job.ts` for why that projection exists
 * (paid training content and assessment answers must never reach a signed-out browser).
 */

import { seedJobs, type Job } from '@/lib/afterworks-data'
import { normaliseJobRecord } from '@/lib/job-catalogue'
import { dbOrNull, isFirebaseAdminUsable, listJobsServer } from '@/lib/firestore-admin'
import { toPublicJob, type PublicJob } from '@/lib/public-job'

export type { PublicJob } from '@/lib/public-job'

export type PublicCatalogue = {
  jobs: PublicJob[]
  /** False when Firestore is unconfigured or unreadable — the cards are then the sample catalogue. */
  live: boolean
  syncedAt: string
}

/** How many cards a public page reads. Bounded so a crawler cannot make us scan the collection. */
export const PUBLIC_CATALOGUE_LIMIT = 200

/**
 * Crawlers arrive in bursts, and a search console "inspect URL" re-requests the same page several
 * times, so the bounded read is memoised in-process for a few seconds. This is a courtesy cache, not
 * a correctness one: members still see live data through the client listener on `/jobs`.
 */
const CATALOGUE_CACHE_MS = 15_000
let catalogueCache: (PublicCatalogue & { at: number }) | null = null

/** Test hook, and the way an operator forces a fresh read without waiting out the TTL. */
export function resetPublicCatalogueCache(): void {
  catalogueCache = null
}

export async function getPublicCatalogue(opts: { fresh?: boolean } = {}): Promise<PublicCatalogue> {
  const now = Date.now()
  if (!opts.fresh && catalogueCache && now - catalogueCache.at < CATALOGUE_CACHE_MS) {
    return { jobs: catalogueCache.jobs, live: catalogueCache.live, syncedAt: catalogueCache.syncedAt }
  }

  // Gated on the same probe the health endpoint uses, so an unconfigured deployment degrades to the
  // labelled sample catalogue instead of logging a Firestore error on every crawler hit.
  const rows = isFirebaseAdminUsable() ? await listJobsServer({ pageSize: PUBLIC_CATALOGUE_LIMIT }) : []
  const live = rows.length > 0
  const cards: PublicJob[] = live
    ? rows
        .map((row) => withTimestamp(normaliseJobRecord(row.id, row, now), row.updatedAt))
        .filter((job): job is PublicJob => job !== null)
    : seedJobs().map(toPublicJob)

  const result: PublicCatalogue = {
    // Open work first, then the soonest closing — the order a visitor actually scans in.
    jobs: cards.slice().sort((a, b) => rankJob(a) - rankJob(b) || closingTime(a) - closingTime(b)),
    live,
    syncedAt: new Date(now).toISOString(),
  }
  catalogueCache = { ...result, at: now }
  return result
}

function closingTime(job: PublicJob): number {
  const parsed = Date.parse(job.closesAt)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function rankJob(job: PublicJob): number {
  if (job.status === 'open' && job.slotsRemaining > 0) return 0
  if (job.status === 'paused') return 1
  return 2
}

/**
 * One card, read directly so a deep link resolves even when the card sits outside the bounded list
 * read — the same guarantee `ensureJob` gives a signed-in member, but for a visitor with no session.
 */
/**
 * `null` means "this card does not exist", which the route turns into a 404 — so it must only ever be
 * returned for a genuine miss. An unconfigured or unreachable Firestore is *not* a miss: answering
 * 404 for a live card because of an outage tells a crawler the page is gone and can get real,
 * indexable work deindexed. In that case the card is served from the sample catalogue (the same
 * degradation the board shows) and the operator sees the warning in the logs.
 */
export async function getPublicJob(id: string): Promise<PublicJob | null> {
  const cleanId = String(id ?? '').trim().slice(0, 80)
  if (!cleanId) return null

  if (!isFirebaseAdminUsable()) return fromSampleCatalogue(cleanId)
  const db = dbOrNull()
  if (!db) return fromSampleCatalogue(cleanId)
  try {
    const snap = await db.collection('jobs').doc(cleanId).get()
    if (!snap.exists) return null
    const data = (snap.data() ?? {}) as Record<string, unknown>
    const job = normaliseJobRecord(snap.id, data, Date.now())
    return withTimestamp(job, typeof data.updatedAt === 'string' ? data.updatedAt : undefined)
  } catch (err) {
    console.warn('[PublicCatalogue] getPublicJob failed, falling back to the sample catalogue:', err)
    return fromSampleCatalogue(cleanId)
  }
}

/**
 * Attach the document's last-saved timestamp to the stripped card. `normaliseJobRecord` deliberately
 * does not carry it (the worker `Job` type has no such field), and the public pages need it for
 * `datePosted` and the sitemap's `lastmod`.
 */
function withTimestamp(job: Job | null, updatedAt?: string): PublicJob | null {
  if (!job) return null
  const publicJob = toPublicJob(job)
  return updatedAt ? { ...publicJob, updatedAt } : publicJob
}

function fromSampleCatalogue(id: string): PublicJob | null {
  const job = seedJobs().find((entry) => entry.id === id)
  return job ? toPublicJob(job) : null
}
