/**
 * Give every job card that has training an explicit training fee.
 *
 * Why this exists
 * ---------------
 * The fee is derived from the card's content: a card charges *because* it has authored training
 * sections. Cards written before that rule existed can carry sections with no `trainingFeeUsd` of
 * their own. They are not broken — every pricing helper falls back to the globally configured fee
 * — but the card is silent about its own price, and the console shows a card whose fee is a
 * fallback rather than a decision. That is the state the rule was meant to end.
 *
 * What it does
 * ------------
 * Reads every `jobs` document, derives whether it has training from its `trainingNotes`, and for
 * any card that does but has no valid fee of its own, writes the globally configured fee and sets
 * `trainingRequired: true`. It never touches a card that already carries a real fee, and never
 * touches an assessment-only card — those are free by design, not by omission.
 *
 * It is idempotent: a second run finds nothing to do.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a && npx tsx scripts/backfill-training-fees.ts            # report only
 *   set -a && . ./.env.local && set +a && npx tsx scripts/backfill-training-fees.ts --apply     # write
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { getTrainingFeeUsd } from '../lib/afterworks-data'
import { dbOrNull } from '../lib/firestore-admin'

/**
 * Load `.env.local` into `process.env` without a dependency — same approach as the other scripts
 * in this folder. Existing shell values win.
 */
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

/** A section counts as training only if it actually says something. */
function authoredSections(raw: unknown): number {
  if (!Array.isArray(raw)) return 0
  return (raw as Record<string, unknown>[]).filter(
    (section) =>
      String(section?.title ?? '').trim() !== '' || String(section?.content ?? '').trim() !== '',
  ).length
}

async function main(): Promise<void> {
  loadEnvFile()
  const apply = process.argv.includes('--apply')
  const db = dbOrNull()
  if (!db) {
    console.error('Firebase Admin SDK is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or _PATH in .env.local.')
    process.exitCode = 1
    return
  }

  // The globally configured fee is what these cards already charge; this only makes it explicit.
  const fallbackFee = getTrainingFeeUsd()
  console.log(`Globally configured training fee: $${fallbackFee}`)
  console.log(apply ? 'Mode: APPLY (writes)\n' : 'Mode: report only (pass --apply to write)\n')

  let snap
  try {
    snap = await db.collection('jobs').get()
  } catch (err) {
    console.error(
      'Could not read the jobs collection. Check that FIREBASE_SERVICE_ACCOUNT_JSON (or _PATH) points at a service account with datastore access.',
    )
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
    return
  }
  const needs: { id: string; title: string; sections: number; fee: number }[] = []
  let ok = 0
  let assessmentOnly = 0

  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>
    const sections = authoredSections(data.trainingNotes)
    const title = String(data.title ?? doc.id)
    const fee = Number(data.trainingFeeUsd)

    if (sections === 0) {
      assessmentOnly += 1
      continue
    }
    // A real, positive fee is already a decision — leave it alone.
    if (Number.isFinite(fee) && fee > 0) {
      ok += 1
      continue
    }
    needs.push({ id: doc.id, title, sections, fee: fallbackFee })
  }

  console.log(`Cards read:              ${snap.size}`)
  console.log(`Training with a fee:     ${ok}`)
  console.log(`Training without a fee:  ${needs.length}`)
  console.log(`Assessment-only (free):  ${assessmentOnly}\n`)

  if (needs.length === 0) {
    console.log('Nothing to do — every card that has training carries its own fee.')
    return
  }

  for (const card of needs) {
    console.log(`  ${card.id}  ${card.title}  (${card.sections} section${card.sections === 1 ? '' : 's'}) → $${card.fee}`)
  }

  if (!apply) {
    console.log('\nReport only. Re-run with --apply to set those fees.')
    return
  }

  const batch = db.batch()
  for (const card of needs) {
    batch.set(
      db.collection('jobs').doc(card.id),
      {
        trainingRequired: true,
        trainingFeeUsd: card.fee,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    )
  }
  await batch.commit()
  console.log(`\nUpdated ${needs.length} card${needs.length === 1 ? '' : 's'}.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
