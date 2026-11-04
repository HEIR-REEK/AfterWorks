/**
 * Publish the 2026 catalogue expansion into Firestore.
 *
 * The sample catalogue in `lib/afterworks-data.ts` is what a new deployment shows before an
 * operator creates cards. A live deployment already has a Firestore catalogue, and an authoritative
 * read never mixes sample cards into it — so adding a card to the sample list does not put it on the
 * live board. This script and the owner-only "Import 2026 cards" button in `/admin/jobs` call the
 * same `importStarterJobs()` function.
 *
 * It is idempotent and conservative:
 *   • only IDs in `IMPORTABLE_CATALOGUE_JOB_IDS` are considered;
 *   • an existing document is skipped unless `--overwrite` is passed;
 *   • `--dry-run` prints the plan and writes nothing.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a && npx tsx scripts/seed-jobs.ts --dry-run
 *   set -a && . ./.env.local && set +a && npx tsx scripts/seed-jobs.ts
 *   npx tsx scripts/seed-jobs.ts --ids job-a,job-b --overwrite
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  IMPORTABLE_CATALOGUE_JOB_IDS,
  seedJobs,
} from '../lib/afterworks-data'
import { importStarterJobs, starterJobInput, STARTER_IMPORT_ACTOR } from '../lib/job-seed'

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

  const allowed = new Set<string>(IMPORTABLE_CATALOGUE_JOB_IDS)
  const ids = requestedIds.length > 0 ? requestedIds : [...allowed]
  const unknown = ids.filter((id) => !allowed.has(id))
  if (unknown.length > 0) {
    console.error(`Refusing unknown card id(s): ${unknown.join(', ')}`)
    console.error('This script only publishes the known catalogue batches.')
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
      const payload = starterJobInput(job)
      console.log(
        `  ${job.id} · ${job.title} · $${job.payAmountUsd} · ${job.category}${payload.trainingRequired ? ` · training $${payload.trainingFeeUsd}` : ' · assessment only'}`,
      )
    }
    console.log('Dry run: no writes were made.')
    return
  }

  const result = await importStarterJobs({
    ids,
    overwrite,
    actorEmail: STARTER_IMPORT_ACTOR,
  })
  console.log(
    `Done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-jobs] failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
