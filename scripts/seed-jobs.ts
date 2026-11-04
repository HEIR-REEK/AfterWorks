/**
 * Publish the 2026 catalogue expansion into Firestore.
 *
 * The sample catalogue in `lib/afterworks-data.ts` is what a new deployment shows before an
 * operator creates cards. A live deployment already has a Firestore catalogue, and an authoritative
 * read never mixes sample cards into it — so adding a card to the sample list does not put it on the
 * live board. This script copies the new batch, and only that batch, through the same
 * `upsertJob()` path the admin console uses (sanitised, bounded, audited).
 *
 * It is idempotent and conservative:
 *   • only IDs in `EXPANDED_CATALOGUE_JOB_IDS` are considered;
 *   • an existing document is skipped unless `--overwrite` is passed;
 *   • `--dry-run` prints the plan and writes nothing.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a && npx tsx scripts/seed-jobs.ts --dry-run
 *   set -a && . ./.env.local && set +a && npx tsx scripts/seed-jobs.ts
 *   npx tsx scripts/seed-jobs.ts --ids job-a,job-b --overwrite
 *
 * The actor recorded in the audit log is `catalogue-2026`, so these writes are distinguishable from
 * console edits.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  EXPANDED_CATALOGUE_JOB_IDS,
  seedJobs,
} from '../lib/afterworks-data'

const ACTOR = 'catalogue-2026'

function loadEnvFile(): void {
  const file = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!match) continue
    const key = match[1]!
    if (process.env[key] !== undefined) continue
    process.env[key] = match[2]!.replace(/^["']|["']$/g, '')
  }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main() {
  loadEnvFile()

  const dryRun = process.argv.includes('--dry-run')
  const overwrite = process.argv.includes('--overwrite')
  const requestedIds = (arg('ids') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const allowed = new Set<string>(EXPANDED_CATALOGUE_JOB_IDS)
  const ids = requestedIds.length > 0 ? requestedIds : [...allowed]
  const unknown = ids.filter((id) => !allowed.has(id))
  if (unknown.length > 0) {
    console.error(`Refusing unknown card id(s): ${unknown.join(', ')}`)
    console.error('This script only publishes the 2026 expansion batch.')
    process.exitCode = 1
    return
  }

  const cards = seedJobs().filter((job) => ids.includes(job.id))
  const missingFromSeed = ids.filter((id) => !cards.some((job) => job.id === id))
  if (missingFromSeed.length > 0) {
    console.error(`Seed data is missing: ${missingFromSeed.join(', ')}`)
    process.exitCode = 1
    return
  }

  console.log(
    `${dryRun ? 'Plan' : 'Publishing'} ${cards.length} card(s): ${cards.map((job) => job.id).join(', ')}`,
  )

  if (dryRun) {
    for (const job of cards) {
      console.log(`  ${job.id} · ${job.title} · $${job.payAmountUsd} · ${job.category}${job.trainingRequired ? ' · training' : ''}`)
    }
    console.log('Dry run: no writes were made.')
    return
  }

  const { adminDb, isFirebaseAdminUsable, upsertJob } = await import('../lib/firestore-admin')
  if (!isFirebaseAdminUsable()) {
    console.error('Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or _PATH.')
    process.exitCode = 1
    return
  }

  const db = adminDb()
  let created = 0
  let updated = 0
  let skipped = 0

  for (const job of cards) {
    const ref = db.collection('jobs').doc(job.id)
    const exists = (await ref.get()).exists
    if (exists && !overwrite) {
      skipped += 1
      console.log(`  skip  ${job.id} (already exists)`)
      continue
    }

    await upsertJob(
      {
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
        trainingFeeUsd: job.trainingFeeUsd,
        trainingNotes: job.trainingNotes,
        requiresVerified: job.requiresVerified,
        status: job.status,
        closesAt: job.closesAt,
      },
      ACTOR,
    )
    if (exists) updated += 1
    else created += 1
    console.log(`  ${exists ? 'update' : 'create'} ${job.id}`)
  }

  console.log(`Done: ${created} created, ${updated} updated, ${skipped} skipped.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-jobs] failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
