/**
 * External jobs feed (Adzuna) — storage, cache and admin operations.
 *
 * Why this is a separate collection instead of `jobs/`:
 *
 *  • An Adzuna advert has no assessment bank, training module, capacity counter or Paystack gate.
 *    Putting one in `jobs/` would make `/api/assessments?jobId=…` and checkout answer for a job
 *    that AfterWorks cannot actually deliver.
 *  • Adzuna's terms require the adverts to be labelled and attributed to Adzuna. A separate,
 *    clearly-marked feed keeps that distinction visible to the worker instead of blending a
 *    third-party advert into our paid catalogue.
 *  • Removing the feed (on termination, or if the licence lapses) is one collection delete, not a
 *    hunt through authored job documents.
 *
 * `external_jobs/` is written only here, through the Admin SDK. Firestore rules deny clients.
 */

import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import { dbOrNull, isFirebaseAdminUsable } from '@/lib/firestore-admin'
import {
  externalJobDocId,
  isAdzunaCountry,
  toExternalJobCard,
  type AdzunaCountry,
  type AdzunaJobRecord,
  type ExternalJobCard,
} from '@/lib/adzuna'
import {
  ADZUNA_MAX_PAGES,
  ADZUNA_RESULTS_PER_PAGE,
  AdzunaError,
  adzunaConfiguration,
  searchAdzunaJobs,
  type AdzunaConfiguration,
} from '@/lib/adzuna-server'

export const EXTERNAL_JOBS_COLLECTION = 'external_jobs'
export const EXTERNAL_FEED_DOC = 'external_jobs_feed'
export const EXTERNAL_JOB_TTL_MS = 14 * 86_400_000
const CACHE_MS = 60_000
const MAX_PUBLIC_JOBS = 300
const BATCH_SIZE = 400

export type ExternalFeedMeta = {
  source: 'adzuna'
  country: AdzunaCountry
  what: string
  where: string
  pages: number
  fetched: number
  stored: number
  removed: number
  sourceCount: number
  syncedAt: string
  syncedBy: string
  expiresAt: string
}

export type ExternalJobsSyncResult = Omit<ExternalFeedMeta, 'syncedAt' | 'syncedBy' | 'expiresAt'> & {
  syncedAt: string
}

export type ExternalJobsAdminSnapshot = {
  configured: boolean
  configuration: AdzunaConfiguration
  storageAvailable: boolean
  meta: ExternalFeedMeta | null
  count: number
  preview: ExternalJobCard[]
}

let cached: { at: number; jobs: ExternalJobCard[] } | null = null

export function clearExternalJobsCache(): void {
  cached = null
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function iso(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''
}

function positiveInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

function metaFromDoc(raw: unknown): ExternalFeedMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  if (data.source !== 'adzuna' || !isAdzunaCountry(data.country)) return null
  return {
    source: 'adzuna',
    country: data.country,
    what: text(data.what, 80),
    where: text(data.where, 80),
    pages: Math.min(ADZUNA_MAX_PAGES, positiveInt(data.pages)),
    fetched: positiveInt(data.fetched),
    stored: positiveInt(data.stored),
    removed: positiveInt(data.removed),
    sourceCount: positiveInt(data.sourceCount),
    syncedAt: iso(data.syncedAt),
    syncedBy: text(data.syncedBy, 160),
    expiresAt: iso(data.expiresAt),
  }
}

/** The public projection. Expired adverts are filtered twice: in the query and in the mapper. */
export async function listExternalJobs(now = Date.now()): Promise<ExternalJobCard[]> {
  if (cached && now - cached.at < CACHE_MS) return cached.jobs

  if (!isFirebaseAdminUsable()) {
    cached = { at: now, jobs: [] }
    return []
  }
  const db = dbOrNull()
  if (!db) {
    cached = { at: now, jobs: [] }
    return []
  }

  try {
    const snap = await db
      .collection(EXTERNAL_JOBS_COLLECTION)
      .where('expiresAt', '>', new Date(now).toISOString())
      .limit(MAX_PUBLIC_JOBS)
      .get()
    const jobs = snap.docs
      .map((doc) => toExternalJobCard(doc.id, doc.data(), now))
      .filter((job): job is ExternalJobCard => Boolean(job))
      .sort((a, b) => {
        const aTime = Date.parse(a.postedAt) || 0
        const bTime = Date.parse(b.postedAt) || 0
        return bTime - aTime || a.title.localeCompare(b.title)
      })
    cached = { at: now, jobs }
    return jobs
  } catch (err) {
    console.warn('[ExternalJobs] feed read failed:', err instanceof Error ? err.message : err)
    // A failed refresh must not empty a page that has a usable recent copy.
    return cached?.jobs ?? []
  }
}

export async function getExternalFeedMeta(): Promise<ExternalFeedMeta | null> {
  if (!isFirebaseAdminUsable()) return null
  const db = dbOrNull()
  if (!db) return null
  try {
    const snap = await db.collection('system').doc(EXTERNAL_FEED_DOC).get()
    if (!snap.exists) return null
    return metaFromDoc(snap.data())
  } catch (err) {
    console.warn('[ExternalJobs] feed metadata read failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function setInChunks(db: Firestore, records: AdzunaJobRecord[], fetchedAt: string): Promise<void> {
  const expiresAt = new Date(Date.parse(fetchedAt) + EXTERNAL_JOB_TTL_MS).toISOString()
  for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
    const batch = db.batch()
    for (const record of records.slice(offset, offset + BATCH_SIZE)) {
      batch.set(db.collection(EXTERNAL_JOBS_COLLECTION).doc(externalJobDocId(record)), {
        ...record,
        expiresAt,
      })
    }
    await batch.commit()
  }
}

async function deleteRefs(db: Firestore, refs: DocumentReference[]): Promise<number> {
  let removed = 0
  for (let offset = 0; offset < refs.length; offset += BATCH_SIZE) {
    const batch = db.batch()
    for (const ref of refs.slice(offset, offset + BATCH_SIZE)) {
      batch.delete(ref)
      removed += 1
    }
    await batch.commit()
  }
  return removed
}

/** Delete every imported advert and the feed metadata. Used by the console's "remove feed" action. */
export async function clearExternalJobs(): Promise<number> {
  if (!isFirebaseAdminUsable()) throw new Error('storage_unavailable')
  const db = dbOrNull()
  if (!db) throw new Error('storage_unavailable')

  let removed = 0
  for (;;) {
    const snap = await db.collection(EXTERNAL_JOBS_COLLECTION).limit(BATCH_SIZE).get()
    if (snap.empty) break
    removed += await deleteRefs(db, snap.docs.map((doc) => doc.ref))
    if (snap.size < BATCH_SIZE) break
  }
  await db.collection('system').doc(EXTERNAL_FEED_DOC).delete().catch(() => undefined)
  clearExternalJobsCache()
  return removed
}

/**
 * Pull one feed configuration and replace the collection with it.
 *
 * The replacement is intentional: Adzuna's search is a window on live inventory, so an advert no
 * longer returned should disappear rather than linger for the whole TTL. New adverts are written
 * before stale ones are deleted, so a mid-sync failure leaves a readable superset, not an empty
 * page.
 */
export async function syncAdzunaFeed(input: {
  country: AdzunaCountry
  what?: string
  where?: string
  pages?: number
  actorEmail: string
}): Promise<ExternalJobsSyncResult> {
  if (!isFirebaseAdminUsable()) throw new Error('storage_unavailable')
  const db = dbOrNull()
  if (!db) throw new Error('storage_unavailable')
  if (!isAdzunaCountry(input.country)) throw new AdzunaError('invalid_country', 'Unsupported Adzuna country.')
  if (!adzunaConfiguration().configured) {
    throw new AdzunaError('not_configured', 'Set ADZUNA_APP_ID and ADZUNA_APP_KEY before importing.')
  }

  const pages = Math.min(ADZUNA_MAX_PAGES, Math.max(1, Math.trunc(input.pages ?? 2)))
  const what = text(input.what, 80)
  const where = text(input.where, 80)
  const records: AdzunaJobRecord[] = []
  const seen = new Set<string>()
  let sourceCount = 0
  let rawResultCount = 0

  for (let page = 1; page <= pages; page += 1) {
    const result = await searchAdzunaJobs({
      country: input.country,
      page,
      what,
      where,
      resultsPerPage: ADZUNA_RESULTS_PER_PAGE,
    })
    if (page === 1) sourceCount = result.count
    rawResultCount += result.jobs.length
    for (const record of result.jobs) {
      if (seen.has(record.sourceId)) continue
      seen.add(record.sourceId)
      records.push(record)
    }
  }

  // A non-empty upstream result that maps to nothing means the payload shape changed. Do not wipe
  // the current feed in that case — fail loudly and leave the last good import in place.
  if (sourceCount > 0 && records.length === 0 && rawResultCount === 0) {
    throw new AdzunaError('invalid_response', 'Adzuna returned results but none could be published. The feed was left unchanged.')
  }

  const fetchedAt = new Date().toISOString()
  const existing = await db.collection(EXTERNAL_JOBS_COLLECTION).limit(500).get()
  const keep = new Set(records.map((record) => externalJobDocId(record)))
  const stale = existing.docs.filter((doc) => !keep.has(doc.id)).map((doc) => doc.ref)

  await setInChunks(db, records, fetchedAt)
  const removed = await deleteRefs(db, stale)
  // Make the newly written feed visible immediately, even if writing the metadata below fails.
  clearExternalJobsCache()

  const expiresAt = new Date(Date.parse(fetchedAt) + EXTERNAL_JOB_TTL_MS).toISOString()
  const meta: ExternalFeedMeta = {
    source: 'adzuna',
    country: input.country,
    what,
    where,
    pages,
    fetched: records.length,
    stored: records.length,
    removed,
    sourceCount,
    syncedAt: fetchedAt,
    syncedBy: input.actorEmail,
    expiresAt,
  }
  await db.collection('system').doc(EXTERNAL_FEED_DOC).set(meta)

  return {
    source: meta.source,
    country: meta.country,
    what: meta.what,
    where: meta.where,
    pages: meta.pages,
    fetched: meta.fetched,
    stored: meta.stored,
    removed: meta.removed,
    sourceCount: meta.sourceCount,
    syncedAt: meta.syncedAt,
  }
}

/** Console payload: configuration state, last import and a small preview. Never calls Adzuna. */
export async function getExternalJobsAdminSnapshot(): Promise<ExternalJobsAdminSnapshot> {
  const configuration = adzunaConfiguration()
  const [jobs, meta] = await Promise.all([listExternalJobs(), getExternalFeedMeta()])
  return {
    configured: configuration.configured,
    configuration,
    storageAvailable: isFirebaseAdminUsable(),
    meta,
    count: jobs.length,
    preview: jobs.slice(0, 12),
  }
}
