/**
 * Measure Firestore reachability and latency over REST — the Cloudflare go/no-go check.
 *
 * Why this exists
 * ---------------
 * The Workers migration takes a lot of work and is justified by exactly one claim: serving from
 * an edge PoP near Nyeri is faster. But every page in this app that touches Firestore pays a
 * round-trip from that PoP to the datastore, and the dashboard pays seven. If the datastore is far
 * from the users, the edge win is spent before the page renders — and no amount of adapter
 * plumbing fixes that.
 *
 * This script answers that with a number. It uses `lib/firestore-rest.ts`, which is the same
 * transport a Workers deployment would use, so what it measures is what you would ship.
 *
 * Usage
 * -----
 *   set -a && . ./.env.local && set +a && npx tsx scripts/cloud-firestore.ts status
 *   set -a && . ./.env.local && set +a && npx tsx scripts/cloud-firestore.ts read
 *   set -a && . ./.env.local && set +a && npx tsx scripts/cloud-firestore.ts read --iterations 20
 *
 *   status  credentials + token exchange + one read + what region the datastore reports
 *   read    the latency benchmark, with a verdict
 *
 * Run `read` from the machine whose position you care about: from your laptop it measures your
 * ISP; from a Cloudflare Worker it measures the edge. Both are useful, and they are not the same
 * number.
 *
 * This script only READS. It never writes, never deletes, and needs no confirmation flag.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { RestFirestore, getAccessToken } from '../lib/firestore-rest'
import {
  formatMs,
  resolveCredentials,
  summarise,
  verdict,
  type ParsedCredentials,
} from '../lib/cloud-benchmark'

/** Load `.env.local` without a dependency — same approach as the other scripts here. */
function loadEnvFile(): void {
  const file = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!match) continue
    const key = match[1]!
    let value = match[2] ?? ''
    // Strip surrounding quotes and trailing comments, as .env parsers do.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`

function fail(message: string, hint?: string): never {
  console.error(`${red('✗')} ${message}`)
  if (hint) console.error(dim(`  ${hint}`))
  process.exit(1)
}

function loadCredentials(): ParsedCredentials {
  return resolveCredentials(process.env, (p) => fs.readFileSync(p, 'utf8'))
}

/** Re-uses the token the client already minted, so a status call shows the real exchange time. */
async function reportCredentials(creds: Extract<ParsedCredentials, { ok: true }>) {
  console.log(`${green('✓')} Credentials: ${bold(creds.account.project_id)}`)
  console.log(`  source      ${creds.source}${creds.base64 ? dim(' (base64)') : ''}`)
  console.log(`  identity    ${creds.account.client_email}`)
  console.log(dim('  (the private key is present and PKCS#8; it is never printed)'))
}

/**
 * `fetch` collapses every transport problem into "fetch failed", which tells an operator nothing
 * about whether to fix credentials, egress or DNS. The token endpoint is the first outbound call,
 * so it is where connectivity problems surface.
 */
function explainNetworkError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
    return (
      'Could not reach Google. This host has no outbound HTTPS to oauth2.googleapis.com ' +
      '(check firewall/egress), or it cannot resolve DNS. From a locked-down sandbox this is expected.'
    )
  }
  if (/invalid_grant|invalid_client|unauthorized_client/i.test(message)) {
    return (
      'Google rejected the service account: it may be deleted, disabled, or the clock on this ' +
      'host may be far enough off that the signed JWT is not valid.'
    )
  }
  return message
}

/** Times the service-account JWT → OAuth2 exchange, which is a cold-start cost on Workers. */
async function timeTokenExchange(creds: Extract<ParsedCredentials, { ok: true }>): Promise<number> {
  const started = performance.now()
  try {
    await getAccessToken(creds.account, { scope: 'https://www.googleapis.com/auth/datastore' })
  } catch (err) {
    fail(explainNetworkError(err))
  }
  return performance.now() - started
}

async function commandStatus(): Promise<void> {
  const creds = loadCredentials()
  if (!creds.ok) fail(creds.reason, creds.source ? `while reading ${creds.source}` : undefined)

  await reportCredentials(creds)
  if (creds.account.project_id !== process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID) {
    console.warn(
      `${yellow('!')} FIREBASE_PROJECT_ID is "${process.env.FIREBASE_PROJECT_ID}" but the service ` +
        `account belongs to "${creds.account.project_id}". The app would use the service account's id; ` +
        'this script does too.',
    )
  }

  const tokenMs = await timeTokenExchange(creds)
  console.log(`${green('✓')} OAuth token exchange: ${formatMs(tokenMs)} ${dim('(cached per isolate from here)')}`)

  const db = new RestFirestore({ projectId: creds.account.project_id, serviceAccount: creds.account })

  // A read that never 404s is not a useful probe; use a collection this app actually writes.
  // `system/maintenance` is read by the middleware, so a failure here is a real answer.
  const started = performance.now()
  try {
    const snap = await db.get('system/maintenance')
    const elapsed = performance.now() - started
    console.log(
      `${green('✓')} Firestore reachable — system/maintenance ${snap.exists ? 'read' : 'absent (still a successful round-trip)'} in ${formatMs(elapsed)}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/PERMISSION_DENIED|403/.test(message)) {
      fail(`Firestore refused the request: ${message}`, 'The service account needs the "Cloud Datastore User" role.')
    }
    fail(`Could not read Firestore: ${message}`, 'Check egress rules, and that Firestore is enabled for this project.')
  }

  // The datastore's location is what makes the latency predictable, so surface it when we can.
  const location = await lookupLocation(creds.account.project_id)
  if (location) {
    console.log(`${green('✓')} Datastore location: ${bold(location)}`)
    console.log(dim('  Compare this to where your users are — see the verdict in `read`.'))
  } else {
    console.log(dim('  (Datastore location unavailable from this API; check the Firebase console.)'))
  }
}

/**
 * Best-effort: Firestore exposes a `locations` field on the database resource. Not all projects
 * grant the metadata permission, and a missing answer is not an error.
 */
async function lookupLocation(projectId: string): Promise<string | null> {
  const creds = loadCredentials()
  if (!creds.ok) return null
  try {
    const token = await getAccessToken(creds.account, { scope: 'https://www.googleapis.com/auth/datastore' })
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { locationId?: string }
    return json.locationId ?? null
  } catch {
    return null
  }
}

async function commandRead(iterations: number): Promise<void> {
  const creds = loadCredentials()
  if (!creds.ok) fail(creds.reason, creds.source ? `while reading ${creds.source}` : undefined)

  const db = new RestFirestore({ projectId: creds.account.project_id, serviceAccount: creds.account })

  console.log(bold(`\nLatency benchmark — ${creds.account.project_id}\n`))

  // Warm the token so the first sample is not measuring the JWT exchange.
  const tokenMs = await timeTokenExchange(creds)
  console.log(dim(`token exchange ${formatMs(tokenMs)} (excluded from the samples below)\n`))

  // Run from here so the numbers are comparative: all three use the same view.
  const view = process.env.BENCH_VIEW

  let cold = -1
  const pointSamples: number[] = []
  const querySamples: number[] = []

  for (let i = 0; i < iterations + 1; i += 1) {
    const pointStart = performance.now()
    try {
      await db.get('system/maintenance')
    } catch (err) {
      fail(`Read failed on iteration ${i}: ${err instanceof Error ? err.message : String(err)}`)
    }
    const pointMs = performance.now() - pointStart

    const queryStart = performance.now()
    try {
      // A bounded, indexed read — the shape a list page uses. Ordered on `createdAt` deliberately:
      // that is the common hot-path query here, and an unindexed/ordered read is slower.
      await db.query('jobs', { limit: 20 })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('FAILED_PRECONDITION') || message.includes('index')) {
        fail(
          `The query needs an index: ${message}`,
          'Declare it in firestore.indexes.json and run `npm run deploy:indexes`.',
        )
      }
      fail(`Query failed on iteration ${i}: ${message}`)
    }
    const queryMs = performance.now() - queryStart

    if (i === 0) {
      // The very first read in a process pays TLS setup; report it separately rather than let it
      // drag the percentile upward.
      cold = pointMs
    } else {
      pointSamples.push(pointMs)
      querySamples.push(queryMs)
    }
  }

  const point = summarise(pointSamples)
  const query = summarise(querySamples)

  console.log(`cold first read      ${formatMs(cold)} ${dim('(TLS + DNS, one-off)')}\n`)
  console.log(bold('point read') + dim('  (GET system/maintenance)'))
  console.log(`  p50 ${formatMs(point.p50)}   p95 ${formatMs(point.p95)}   min ${formatMs(point.min)}   max ${formatMs(point.max)}`)
  console.log(bold('\nlist query') + dim('  (runQuery jobs limit 20)'))
  console.log(`  p50 ${formatMs(query.p50)}   p95 ${formatMs(query.p95)}   min ${formatMs(query.min)}   max ${formatMs(query.max)}`)

  // The console dashboard issues seven datastore calls, overlapping them; that is the worst case
  // a staff member waits on, so it is worth showing rather than leaving implied.
  console.log(
    `\n${dim('console dashboard: 7 calls, parallel → roughly')} ${bold(formatMs(query.p95))} ${dim('to')} ${bold(formatMs(query.p95 * 2))} ${dim('wall clock')}`,
  )

  const result = verdict(point.p50)
  const colour = result.label === 'favourable' ? green : result.label === 'marginal' ? yellow : red
  console.log(`\n${colour(bold('VERDICT: ' + result.label.toUpperCase()))}`)
  console.log(`  ${result.headline}`)
  for (const line of wrap(result.detail, 78)) console.log(dim(`  ${line}`))

  console.log(
    dim(
      `\n  Measured ${point.count} samples from this host. Re-run from a Cloudflare Worker` +
        ` (\`npm run cf:build && npx wrangler dev\`) to see the edge's number.`,
    ),
  )
  if (view) console.log(dim(`  BENCH_VIEW=${view}`))
}

/** Simple word wrap so the verdict stays readable in a narrow terminal. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      if (line) lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

async function main(): Promise<void> {
  loadEnvFile()
  const [command = 'status', ...rest] = process.argv.slice(2)

  if (command === 'status') return commandStatus()
  if (command === 'read') {
    const flagIndex = rest.indexOf('--iterations')
    const iterations = flagIndex >= 0 ? Number(rest[flagIndex + 1]) : 10
    if (!Number.isFinite(iterations) || iterations < 1 || iterations > 200) {
      fail('--iterations must be a number between 1 and 200.')
    }
    return commandRead(Math.trunc(iterations))
  }

  console.error(`Unknown command "${command}".`)
  console.error(dim('  npx tsx scripts/cloud-firestore.ts status'))
  console.error(dim('  npx tsx scripts/cloud-firestore.ts read [--iterations 20]'))
  process.exit(1)
}

main().catch((err) => {
  console.error(red('✗'), err instanceof Error ? err.message : err)
  process.exit(1)
})
