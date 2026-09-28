/**
 * Backfill `users.phoneKey` / normalise `users.phone` to E.164.
 *
 * Why this exists
 * ---------------
 * "One phone number, one account" is enforced by comparing the E.164 digit string, and that
 * comparison runs against `users.phoneKey`. Documents written before this feature existed have no
 * `phoneKey`, so until they are migrated the check can only catch them by re-reading the raw
 * `phone` text — which is a bounded scan on every profile save.
 *
 * Run it once after deploying the change, then set `PHONE_UNIQUE_SCAN_LIMIT=0` to retire that scan.
 * It is idempotent: documents that already carry a `phoneKey` are skipped.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a && npx tsx scripts/backfill-phone-keys.ts [--limit 2000] [--dry-run]
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { backfillPhoneKeys } from '../lib/account-uniqueness'

/**
 * Load `.env.local` into `process.env` without a dependency.
 *
 * The project deliberately ships no dotenv: the other scripts in this folder read their inputs
 * from argv, and `tsx` does not load an env file on its own. Existing values win, so a value
 * exported by the shell (`set -a; . ./.env.local`) is not silently overwritten by the file.
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

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

async function main() {
  loadEnvFile()
  if (process.argv.includes('--dry-run')) {
    console.log('Dry run: no writes would be made. Re-run without --dry-run to apply.')
    return
  }
  const limit = Number(arg('limit', '2000'))
  const { scanned, updated } = await backfillPhoneKeys(Number.isFinite(limit) ? limit : 2000)
  console.log(`Scanned ${scanned} profile(s) without a phoneKey; normalised ${updated}.`)
  console.log('Set PHONE_UNIQUE_SCAN_LIMIT=0 in your environment once every deployment has run this.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
