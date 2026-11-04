#!/usr/bin/env node
/**
 * Didit connection check — run this locally, without deploying, to see why verification fails.
 *
 *   node scripts/didit-check.mjs            # reads: workflows + credit balance (spends nothing)
 *   node scripts/didit-check.mjs --session  # also opens one real session and prints Didit's answer
 *
 * It reads the same variables the app does — DIDIT_API_KEY, DIDIT_WORKFLOW_ID, DIDIT_API_URL —
 * from the environment first and then from .env / .env.local, so a local copy of the deployment's
 * settings is enough. Nothing is written anywhere and no key is ever printed.
 *
 * Why this exists: the admin console's connection test only used to read the workflow list, which
 * passes for a key without session-write permission, an application with no credit, and a workflow
 * id that exists only as an unpublished draft. All three refuse every member's session. The list
 * is the cheapest useful signal; this script adds the credit balance and, on request, the exact
 * reply to POST /v3/session/ — the call a member's "Verify" button makes.
 *
 * Pricing fact worth knowing before you start: since 1 November 2026 the Free plan grants $10 of
 * credit a month (about 30 full KYC checks at $0.33), not 500 free checks, and only to
 * organisations that signed up with a work email. It does not pay for phone verification. The
 * sandbox is separate and stays free on every plan.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const WANT_SESSION = process.argv.includes('--session')

/** Minimal .env reader: KEY=VALUE, optional `export`, # comments, quoted values. */
function readEnvFile(name) {
  const path = resolve(ROOT, name)
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const value = match[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
    out[match[1]] = value
  }
  return out
}

const env = { ...readEnvFile('.env'), ...readEnvFile('.env.local'), ...process.env }

const API_KEY = env.DIDIT_API_KEY ?? ''
const WORKFLOW_ID = env.DIDIT_WORKFLOW_ID ?? ''
const BASE_URL = (env.DIDIT_API_URL || 'https://verification.didit.me').replace(/\/+$/, '')

const ok = []
const bad = []
const note = (message) => console.log(`  ${message}`)
const pass = (message) => {
  ok.push(message)
  console.log(`  \u001b[32m✔\u001b[0m ${message}`)
}
const fail = (message) => {
  bad.push(message)
  console.log(`  \u001b[31m✗\u001b[0m ${message}`)
}
const head = (message) => console.log(`\n\u001b[1m${message}\u001b[0m`)

/** The caller's own origin, used only so the session probe's callback matches what the app sends. */
function callbackUrl() {
  const base = env.NEXT_PUBLIC_APP_URL || env.APP_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:3000'
  return `${String(base).replace(/^https?:\/\//, 'https://').replace(/\/+$/, '')}/kyc/callback`
}

async function call(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: { 'x-api-key': API_KEY, Accept: 'application/json', ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text.slice(0, 300)
  }
  return { response, body }
}

head('Didit connection check')
note(`host            ${BASE_URL}`)
note(`api key         ${API_KEY ? `${API_KEY.slice(0, 6)}…${API_KEY.slice(-4)} (${API_KEY.length} chars)` : 'NOT SET'}`)
note(`workflow id     ${WORKFLOW_ID || 'NOT SET'}`)

if (!API_KEY) {
  fail('DIDIT_API_KEY is not set — nothing else can be checked. Copy it from the Didit console (Settings → API & Webhooks).')
  process.exit(1)
}
if (!WORKFLOW_ID) {
  fail('DIDIT_WORKFLOW_ID is not set — session creation cannot work without it.')
}

if (/^https?:\/\/apx\.didit\.me/.test(BASE_URL)) {
  fail(`${BASE_URL} is the registration host. Its /v3/* routes 404, so every verification fails. Unset DIDIT_API_URL (or set it to https://verification.didit.me).`)
}

// ── 1. Workflows ──────────────────────────────────────────────────────────────
head('1. Workflows  GET /v3/workflows/')
let configured = null
try {
  const { response, body } = await call('/v3/workflows/', { method: 'GET' })
  if (response.status === 401 || response.status === 403) {
    fail(`Didit refused the key (${response.status}): ${JSON.stringify(body)}`)
    note('   The key is missing, expired, restricted to an IP list, or belongs to another application.')
  } else if (!response.ok) {
    fail(`Didit answered ${response.status}: ${JSON.stringify(body)}`)
  } else {
    const rows = Array.isArray(body?.results) ? body.results : Array.isArray(body) ? body : []
    pass(`the key is accepted and ${rows.length} workflow version(s) are visible`)
    for (const row of rows.slice(0, 20)) {
      const state = row.is_archived ? 'archived' : String(row.status ?? 'unknown')
      const marker = row.workflow_id === WORKFLOW_ID ? '  ← DIDIT_WORKFLOW_ID' : ''
      note(`   ${state.padEnd(10)} ${String(row.workflow_label ?? '?').padEnd(28)} ${row.workflow_id}${marker}`)
    }
    if (body?.next) note('   …the provider reports another page, so more workflows exist than are listed here.')

    const matches = rows.filter((row) => row.workflow_id === WORKFLOW_ID)
    configured = matches[0] ?? null
    if (matches.length === 0) {
      fail(`DIDIT_WORKFLOW_ID (${WORKFLOW_ID}) is not on this application. Copy the workflow_id from Workflows in the console.`)
    } else {
      const usable = matches.some((row) => !row.is_archived && (row.status === 'published' || row.status === undefined))
      const states = [...new Set(matches.map((row) => (row.is_archived ? 'archived' : row.status ?? 'unknown')))].join(', ')
      if (usable) pass(`the configured workflow is usable (${states})`)
      else fail(`the configured workflow exists but no version of it can serve a session (versions: ${states}). New sessions always use the latest PUBLISHED version — open the workflow in the console and publish it.`)
    }
  }
} catch (err) {
  fail(`could not reach ${BASE_URL}: ${err instanceof Error ? err.message : String(err)}`)
}

// ── 2. Credit balance ────────────────────────────────────────────────────────
head('2. Credit balance  GET /v3/billing/balance/')
try {
  const { response, body } = await call('/v3/billing/balance/', { method: 'GET' })
  if (!response.ok) {
    fail(`Didit answered ${response.status}: ${JSON.stringify(body)}`)
    note('   The balance could not be read; a refused session still reports its own reason.')
  } else {
    const balance = Number.parseFloat(String(body.balance ?? ''))
    const price = configured?.total_price ?? 0.33
    if (!Number.isFinite(balance)) {
      fail('the balance response did not contain a readable number.')
    } else if (balance <= 0) {
      fail(`the balance is $${balance.toFixed(2)} — there is nothing to pay for a check with, so every session is refused.`)
      note('   Free plan reality: since 1 Nov 2026 it is $10 of credit a month (≈30 checks at $0.33),')
      note('   granted only to organisations that signed up with a work email, and it does not cover phone')
      note('   verification. Top up, or check Billing in the console.')
    } else {
      const checks = Math.floor(balance / price)
      pass(`the balance is $${balance.toFixed(2)} — about ${checks} check(s) at $${price.toFixed(2)} each${body.auto_refill_enabled ? ' (auto top-up on)' : ''}`)
    }
  }
} catch (err) {
  fail(`could not read the balance: ${err instanceof Error ? err.message : String(err)}`)
}

// ── 3. The call a member actually makes ──────────────────────────────────────
head(WANT_SESSION ? '3. Session creation  POST /v3/session/' : '3. Session creation  (skipped — pass --session)')
if (!WANT_SESSION) {
  note('   Reads above cost nothing. Pass --session to open one real session under the probe identity')
  note('   afterworks-console-connection-test and print Didit\'s exact answer.')
} else if (configured) {
  try {
    const { response, body } = await call('/v3/session/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_id: WORKFLOW_ID,
        vendor_data: 'afterworks-console-connection-test',
        callback: callbackUrl(),
        // The same value the app sends for a member verifying on a laptop. Didit allows one
        // non-finished session per (workflow_id, vendor_data) and reuses it, so this is also why
        // re-running this script does not stack up sessions.
        callback_method: 'completer',
        metadata: { source: 'scripts/didit-check.mjs' },
      }),
    })
    if (response.status === 201 || response.status === 200) {
      pass(`Didit opened session ${body.session_id} — the call a member's "Verify" makes works from here.`)
      note(`   ${body.url}`)
    } else {
      fail(`Didit refused to open a session (${response.status}): ${JSON.stringify(body)}`)
    }
  } catch (err) {
    fail(`could not open a session: ${err instanceof Error ? err.message : String(err)}`)
  }
}

head(bad.length === 0 ? 'Result: nothing blocking found' : `Result: ${bad.length} problem(s) to fix`)
for (const message of bad) note(`- ${message}`)
process.exit(bad.length === 0 ? 0 : 2)
