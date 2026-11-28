/**
 * Publish the 2026 catalogue expansion.
 *
 * Sample cards in `lib/afterworks-data.ts` are a first-run preview. A live board reads `jobs/`
 * from Firestore, and sample rows are deliberately never mixed into a live catalogue. This module
 * is the one place that copies the expansion into the live catalogue, used by both
 * `scripts/seed-jobs.ts` and the owner-only console action.
 *
 * It is deliberately narrow: only ids listed in `IMPORTABLE_CATALOGUE_JOB_IDS` are accepted, so a
 * seed or a console import cannot rewrite older or hand-authored cards. Every write still goes
 * through `upsertJob()`, which sanitises the payload and records an audit entry.
 */

import {
  jobHasTraining,
  IMPORTABLE_CATALOGUE_JOB_IDS,
  seedJobs,
  type Job,
} from '@/lib/afterworks-data'
import { dbOrNull, upsertJob, type AdminJobInput } from '@/lib/firestore-admin'
import { seedRegionalJobs } from '@/lib/regional-jobs'

/**
 * Every card the importer is allowed to write.
 *
 * The regional batch is its **own** module (`lib/regional-jobs.ts`, which imports the types from
 * `afterworks-data`), so it is not in `seedJobs()`. That was the bug behind empty boards: the
 * regional ids were importable in name only, and `byId` was built from `seedJobs()`, so every
 * regional import failed as "seed missing" and no board ever received a card.
 */
function importableCards(): Job[] {
  return [...seedJobs(), ...seedRegionalJobs()]
}

export const STARTER_IMPORT_ACTOR = 'catalogue-2026'

export type StarterImportResult = {
  created: number
  updated: number
  skipped: number
  ids: string[]
}

export class StarterImportError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown_ids' | 'storage_unavailable' | 'seed_missing',
  ) {
    super(message)
    this.name = 'StarterImportError'
  }
}

/** The exact `jobs/{id}` payload a starter card produces. Kept pure for tests. */
export function starterJobInput(job: Job): AdminJobInput {
  return {
    id: job.id,
    title: job.title,
    category: job.category,
    description: job.description,
    responsibilities: job.responsibilities,
    payAmountUsd: job.payAmountUsd,
    estimatedMinutes: job.estimatedMinutes,
    capacity: job.capacity,
    slotsRemaining: job.slotsRemaining,
    trainingRequired: job.trainingRequired,
    trainingFeeUsd: job.trainingRequired ? job.trainingFeeUsd : undefined,
    trainingNotes: job.trainingNotes ?? [],
    // The seeded cards carry their own assessments; the older batches carry none, which means the
    // built-in category bank is used. Both are meaningful, so both are written explicitly.
    assessmentQuestions: job.assessmentQuestions ?? [],
    // Which board the card belongs to. Blank on the older batches → visible everywhere, exactly as
    // before regions existed. Set on the regional batch → locked to that board.
    region: job.region ?? '',
    requiresVerified: job.requiresVerified,
    status: job.status,
    closesAt: job.closesAt,
  }
}

export async function importStarterJobs(opts: {
  ids?: string[]
  overwrite?: boolean
  actorEmail?: string
} = {}): Promise<StarterImportResult> {
  const allowed = new Set<string>(IMPORTABLE_CATALOGUE_JOB_IDS)
  const requested = (opts.ids && opts.ids.length > 0 ? opts.ids : [...allowed])
    .map((id) => id.trim())
    .filter(Boolean)
  const ids = [...new Set(requested)]
  const unknown = ids.filter((id) => !allowed.has(id))
  if (unknown.length > 0) {
    throw new StarterImportError(
      `Refusing unknown card id(s): ${unknown.join(', ')}. Only the 2026 expansion batch can be imported.`,
      'unknown_ids',
    )
  }

  const byId = new Map(importableCards().map((job) => [job.id, job]))
  const missing = ids.filter((id) => !byId.has(id))
  if (missing.length > 0) {
    throw new StarterImportError(`Seed data is missing: ${missing.join(', ')}`, 'seed_missing')
  }

  const db = dbOrNull()
  if (!db) throw new StarterImportError('Firebase Admin is not configured.', 'storage_unavailable')

  const actorEmail = opts.actorEmail?.trim() || STARTER_IMPORT_ACTOR
  let created = 0
  let updated = 0
  let skipped = 0

  for (const id of ids) {
    const job = byId.get(id)!
    const ref = db.collection('jobs').doc(id)
    const exists = (await ref.get()).exists
    if (exists && !opts.overwrite) {
      skipped += 1
      continue
    }
    await upsertJob(starterJobInput(job), actorEmail)
    if (exists) updated += 1
    else created += 1
  }

  return { created, updated, skipped, ids }
}
