import type { JobCategory } from '@/lib/afterworks-data'
import { JOB_CATEGORY_LIST } from '@/lib/afterworks-data'
import { dbOrNull } from '@/lib/firestore-admin'
import type { PublicJob } from '@/lib/public-jobs'

/**
 * Server-only public catalogue projection.
 *
 * Three rules keep this safe:
 *  • only open, unexpired jobs with a free slot are published;
 *  • only the fields in `PUBLIC_FIELDS` are read and returned;
 *  • assessment questions and training notes are never part of the projection. Those fields hold
 *    answer keys, and a public page must not become an answer sheet.
 */

const PUBLIC_FIELDS = [
  'title',
  'category',
  'description',
  'responsibilities',
  'payAmountUsd',
  'estimatedMinutes',
  'capacity',
  'slotsRemaining',
  'trainingRequired',
  'trainingFeeUsd',
  'requiresVerified',
  'status',
  'closesAt',
  'postedAt',
  'updatedAt',
  'postedAgo',
] as const

const CACHE_MS = 30_000
let cached: { at: number; jobs: PublicJob[] } | null = null

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function lines(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => text(entry, maxLength)).filter(Boolean).slice(0, max)
}

function finite(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''
}

function category(value: unknown): JobCategory {
  return JOB_CATEGORY_LIST.includes(value as JobCategory) ? (value as JobCategory) : 'Data Entry'
}

/** A raw `jobs/{id}` document → the public card, or null when it must not be published. */
export function toPublicJob(id: string, raw: unknown, now = Date.now()): PublicJob | null {
  if (!id || id.length > 200 || id.includes('/')) return null
  const data = (raw ?? {}) as Record<string, unknown>
  if (data.status !== 'open') return null

  const title = text(data.title, 120)
  if (!title) return null

  const closesAt = isoDate(data.closesAt)
  if (closesAt && Date.parse(closesAt) <= now) return null

  const capacity = Math.max(1, Math.min(100_000, Math.round(finite(data.capacity, 1))))
  const slotsRemaining = Math.max(0, Math.min(capacity, Math.round(finite(data.slotsRemaining, capacity))))
  if (slotsRemaining <= 0) return null

  const payAmountUsd = Math.max(0, Math.min(10_000, finite(data.payAmountUsd, 0)))
  const estimatedMinutes = Math.max(5, Math.min(10_080, Math.round(finite(data.estimatedMinutes, 60))))
  // Derived from the card's own content, not the stored flag: a card charges because it has training.
  const sections = Array.isArray(data.trainingNotes) ? (data.trainingNotes as Record<string, unknown>[]) : []
  const trainingRequired = sections.some(
    (section) => String(section?.title ?? '').trim() !== '' || String(section?.content ?? '').trim() !== '',
  )
  const trainingFeeUsd = Math.max(0, Math.min(1_000, finite(data.trainingFeeUsd, 0)))

  return {
    id,
    title,
    category: category(data.category),
    description: text(data.description, 4_000),
    responsibilities: lines(data.responsibilities, 12, 300),
    payAmountUsd,
    estimatedMinutes,
    capacity,
    slotsRemaining,
    trainingRequired,
    ...(trainingRequired && trainingFeeUsd > 0
      ? { trainingFeeUsd: Math.round(trainingFeeUsd * 10_000) / 10_000 }
      : {}),
    requiresVerified: data.requiresVerified !== false,
    closesAt,
    ...(isoDate(data.postedAt) || isoDate(data.updatedAt)
      ? { postedAt: isoDate(data.postedAt) || isoDate(data.updatedAt) }
      : {}),
    postedAgo: text(data.postedAgo, 40) || 'recently',
  }
}

export async function listPublicJobs(): Promise<PublicJob[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.jobs
  const db = dbOrNull()
  if (!db) {
    cached = { at: Date.now(), jobs: [] }
    return []
  }

  try {
    const snap = await db
      .collection('jobs')
      .where('status', '==', 'open')
      .select(...PUBLIC_FIELDS)
      .limit(200)
      .get()
    const jobs = snap.docs
      .map((doc) => toPublicJob(doc.id, doc.data()))
      .filter((job): job is PublicJob => Boolean(job))
      .sort((a, b) => {
        const aTime = Date.parse(a.closesAt) || Number.MAX_SAFE_INTEGER
        const bTime = Date.parse(b.closesAt) || Number.MAX_SAFE_INTEGER
        return aTime - bTime || a.title.localeCompare(b.title)
      })
    cached = { at: Date.now(), jobs }
    return jobs
  } catch (err) {
    console.warn('[PublicJobs] catalogue read failed:', err instanceof Error ? err.message : err)
    cached = { at: Date.now(), jobs: [] }
    return []
  }
}

/** Called by the admin catalogue route after a write so a public page cannot serve stale data. */
export function clearPublicJobsCache(): void {
  cached = null
}

export async function getPublicJob(id: string): Promise<PublicJob | null> {
  if (!id || id.length > 200 || id.includes('/')) return null
  const job = (await listPublicJobs()).find((entry) => entry.id === id)
  return job ?? null
}
