/**
 * Credential parsing + latency statistics for the Cloudflare go/no-go benchmark.
 *
 * Why this is a module and not part of the script
 * ──────────────────────────────────────────────
 * `scripts/cloud-firestore.ts` cannot be exercised in CI: it needs a real service account and
 * reachability to firestore.googleapis.com. Everything in *this* file is pure — credential
 * parsing, percentile maths, the verdict rule — so the part that can be wrong silently is
 * unit-tested, and the script is left with nothing but I/O.
 *
 * The credential parser deliberately mirrors the quirks `lib/firestore-admin.ts` already has to
 * tolerate, because the operator will paste the same value into both places. If the two parsers
 * disagree, the benchmark measures a different project than the app runs against.
 */

export type ServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
}

export type ParsedCredentials =
  | {
      ok: true
      account: ServiceAccount
      /** Which env var the value came from, for the `status` report. */
      source: 'FIREBASE_SERVICE_ACCOUNT_JSON' | 'FIREBASE_SERVICE_ACCOUNT_PATH'
      /** True when the env var was base64 rather than raw JSON. */
      base64: boolean
    }
  | { ok: false; reason: string; source?: string }

type Env = Record<string, string | undefined>

/** Handles the `\n` escaping that survives a copy/paste through a dashboard. */
function normalisePrivateKey(key: string): string {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key
}

/**
 * Validates the three fields the REST client actually needs. A service-account JSON has many
 * more; missing ones are not an error here, but a missing key would fail later inside
 * `crypto.subtle.importKey` with an opaque message, so it fails now with a useful one.
 */
function asServiceAccount(value: unknown): { ok: true; account: ServiceAccount } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'Decoded JSON is not an object.' }
  }
  const raw = value as Record<string, unknown>
  const project_id = typeof raw.project_id === 'string' ? raw.project_id.trim() : ''
  const client_email = typeof raw.client_email === 'string' ? raw.client_email.trim() : ''
  const key = typeof raw.private_key === 'string' ? raw.private_key : ''

  if (!project_id) return { ok: false, reason: 'Missing project_id in the service account.' }
  if (!client_email) return { ok: false, reason: 'Missing client_email in the service account.' }
  if (!key) return { ok: false, reason: 'Missing private_key in the service account.' }
  if (!key.includes('BEGIN PRIVATE KEY')) {
    return {
      ok: false,
      reason: key.includes('BEGIN RSA PRIVATE KEY')
        ? 'private_key is PKCS#1 (BEGIN RSA PRIVATE KEY); convert it to PKCS#8 (BEGIN PRIVATE KEY).'
        : 'private_key is not a PKCS#8 PEM (no BEGIN PRIVATE KEY marker).',
    }
  }

  return { ok: true, account: { project_id, client_email, private_key: normalisePrivateKey(key) } }
}

/**
 * Parses a raw `FIREBASE_SERVICE_ACCOUNT_JSON` value.
 *
 * Accepts, in the same order the Admin SDK path does:
 *   1. JSON wrapped in stray quotes (a Render/dashboard paste),
 *   2. base64 of the JSON (also a common dashboard paste — it survives newlines),
 *   3. raw JSON.
 */
export function parseServiceAccountJson(raw: string): { ok: true; account: ServiceAccount; base64: boolean } | { ok: false; reason: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, reason: 'FIREBASE_SERVICE_ACCOUNT_JSON is empty.' }

  let cleaned = trimmed
  // Strip a wrapping quote pair, but only when it really is wrapping: `"..."` where the value
  // is not itself the JSON object (a bare `{...}` must keep its braces).
  if (
    (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
    (cleaned.startsWith('"') && !cleaned.endsWith('}'))
  ) {
    cleaned = cleaned.slice(1, cleaned.length - 1)
  }

  const looksBase64 = !cleaned.startsWith('{')
  let jsonText = cleaned
  if (looksBase64) {
    try {
      jsonText = Buffer.from(cleaned, 'base64').toString('utf8')
    } catch {
      return { ok: false, reason: 'Value does not start with "{" and could not be base64-decoded.' }
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return {
      ok: false,
      reason: looksBase64
        ? 'Value was treated as base64 but decoded to something that is not JSON.'
        : 'Value is not valid JSON (an unescaped newline inside private_key is the usual cause).',
    }
  }

  const account = asServiceAccount(parsed)
  if (!account.ok) return account
  return { ok: true, account: account.account, base64: looksBase64 }
}

/**
 * Resolves credentials from the environment, preferring the inline JSON (as the app does).
 * `readFile` is injected so the path branch is testable without touching disk.
 */
export function resolveCredentials(
  env: Env,
  readFile: (path: string) => string,
): ParsedCredentials {
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (inline && inline.trim()) {
    const parsed = parseServiceAccountJson(inline)
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason, source: 'FIREBASE_SERVICE_ACCOUNT_JSON' }
    }
    return {
      ok: true,
      account: parsed.account,
      source: 'FIREBASE_SERVICE_ACCOUNT_JSON',
      base64: parsed.base64,
    }
  }

  const pathValue = env.FIREBASE_SERVICE_ACCOUNT_PATH
  if (pathValue && pathValue.trim()) {
    let raw: string
    try {
      raw = readFile(pathValue.trim())
    } catch {
      return {
        ok: false,
        reason: `Could not read the file at ${pathValue.trim()} (FIREBASE_SERVICE_ACCOUNT_PATH).`,
        source: 'FIREBASE_SERVICE_ACCOUNT_PATH',
      }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        ok: false,
        reason: `The file at ${pathValue.trim()} is not valid JSON.`,
        source: 'FIREBASE_SERVICE_ACCOUNT_PATH',
      }
    }
    const account = asServiceAccount(parsed)
    if (!account.ok) {
      return { ok: false, reason: account.reason, source: 'FIREBASE_SERVICE_ACCOUNT_PATH' }
    }
    return {
      ok: true,
      account: account.account,
      source: 'FIREBASE_SERVICE_ACCOUNT_PATH',
      base64: false,
    }
  }

  return {
    ok: false,
    reason: 'Neither FIREBASE_SERVICE_ACCOUNT_JSON nor FIREBASE_SERVICE_ACCOUNT_PATH is set.',
  }
}

// ─── Statistics ─────────────────────────────────────────────────────────────

export type Summary = {
  count: number
  min: number
  p50: number
  p95: number
  max: number
  mean: number
}

/**
 * Nearest-rank percentile. With a handful of samples the interpolating variants imply a
 * precision the measurement does not have, so this reports an observed sample.
 */
export function percentile(samples: number[], p: number): number {
  if (!samples.length) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index]!
}

export function summarise(samples: number[]): Summary {
  if (!samples.length) return { count: 0, min: 0, p50: 0, p95: 0, max: 0, mean: 0 }
  const total = samples.reduce((sum, n) => sum + n, 0)
  return {
    count: samples.length,
    min: Math.min(...samples),
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: Math.max(...samples),
    mean: Math.round(total / samples.length),
  }
}

export function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

// ─── The verdict rule ───────────────────────────────────────────────────────

export type Verdict = {
  label: 'favourable' | 'marginal' | 'unfavourable'
  headline: string
  detail: string
}

/**
 * Turns the measured round-trip into the decision the migration actually hinges on.
 *
 * The thresholds are deliberately crude and stated openly rather than tuned: this app gains
 * roughly one edge hop (~100 ms saved versus a centralised Node host) but pays one datastore
 * round-trip per page on the Workers side. So the question is simply whether a round-trip is
 * small next to that saving.
 *
 * @param p50Ms median round-trip from the *measurement host* to the datastore.
 */
export function verdict(p50Ms: number): Verdict {
  if (p50Ms <= 80) {
    return {
      label: 'favourable',
      headline: 'The datastore hop is cheap — the migration can pay off.',
      detail:
        'A round-trip this short means an edge Worker keeps most of its latency advantage when it ' +
        'reads Firestore. The next question is CPU per request, not geography.',
    }
  }
  if (p50Ms <= 160) {
    return {
      label: 'marginal',
      headline: 'Borderline — concurrency and caching decide it, not geography.',
      detail:
        'Single-round-trip pages will feel roughly the same on Render and on Workers. Only routes ' +
        'that overlap several reads (the console) or serve cacheable content will improve. ' +
        'Finishing the port is hard to justify on latency alone.',
    }
  }
  return {
    label: 'unfavourable',
    headline: 'The datastore hop eats the edge win.',
    detail:
      'At this latency every page that touches Firestore pays more than the edge saves, so the ' +
      'migration would be work without a user-visible benefit. Put Cloudflare in front of the ' +
      'existing Render service (CDN, DDoS, asset caching, no code change) instead of moving the app.',
  }
}
