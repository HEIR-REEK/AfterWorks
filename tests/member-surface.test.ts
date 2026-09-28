import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * What a member is allowed to see about how the platform works: nothing.
 *
 * Two rules, both learned the hard way:
 *
 *  1. The member app never links to the operations console. A "Staff login" in the sign-in footer or
 *     the status page footer is an advertisement for the one door that should not be public, and it
 *     costs nothing to remove because staff sign in from a bookmark.
 *  2. The member app never explains its own plumbing. "Firebase is not configured on this
 *     deployment", "set the FIREBASE_* variables", "the server has recorded", a raw `TypeError` on
 *     the error page — none of that is actionable for a worker, and all of it describes the
 *     implementation to whoever is reading. Operator detail belongs in the console and in
 *     DEPLOYMENT.md.
 *
 * These are source scans, not render tests: the point is that the phrases cannot come back in a
 * future edit without a test going red.
 */

const ROOT = process.cwd()

/** Every page and component a member can reach — the console and the API are not member surfaces. */
function memberFacingFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (full.includes('/app/admin') || full.includes('/app/api')) continue
        walk(full)
        continue
      }
      if (!full.endsWith('.tsx')) continue
      const name = entry.toLowerCase()
      if (name.startsWith('admin-')) continue // console-only components
      out.push(full)
    }
  }
  walk(join(ROOT, 'app'))
  walk(join(ROOT, 'components'))
  return out.sort()
}

/** Source with comments removed, so a code comment explaining a decision is not a violation. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Only what a member can actually read: string literals and JSX text.
 *
 * Scanning the whole file would flag `process.env.FIREBASE_WEB_API_KEY`, which is the app reading
 * its own configuration — necessary, and invisible to anybody using the site.
 */
function visibleText(source: string): string {
  const chunks: string[] = []
  for (const match of source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/gs)) chunks.push(match[2])
  for (const match of source.matchAll(/>([^<>{}]+)</g)) chunks.push(match[1])
  return chunks.join('\n')
}

const files = memberFacingFiles()
const rel = (file: string) => relative(ROOT, file)

test('the scan really does cover the member app', () => {
  assert.ok(files.length > 30, `expected the member surface, saw ${files.length} files`)
  assert.ok(files.some((f) => f.endsWith('app/sign-in/page.tsx')), 'the sign-in page is in scope')
  assert.ok(files.some((f) => f.endsWith('components/auth-form.tsx')), 'the auth form is in scope')
  assert.ok(files.some((f) => f.endsWith('app/status/page.tsx')), 'the public status page is in scope')
  assert.equal(files.some((f) => f.includes('/app/admin/')), false, 'console pages are out of scope')
})

test('no member-facing page or component links to the operations console', () => {
  const offenders: string[] = []
  for (const file of files) {
    const source = withoutComments(readFileSync(file, 'utf8'))
    // Any href, redirect or navigation aimed at /admin.
    const patterns = [
      /href=["'{\s`]*\/admin\b[^"'`\s]*/g,
      /(?:push|replace|assign|open)\(\s*["'`]\/admin\b/g,
      /<Link[^>]*\/admin\b/g,
    ]
    for (const pattern of patterns) {
      for (const match of source.match(pattern) ?? []) offenders.push(`${rel(file)}: ${match.trim()}`)
    }
  }
  assert.deepEqual(offenders, [], 'the console address must not be reachable from the member app')
})

test('member-facing copy does not explain the implementation', () => {
  // Phrases that have shipped before. Each one told a worker something only an operator can act on.
  const banned = [
    'Firebase is not configured',
    'no Firebase project',
    'no Firebase configuration',
    'set the Firebase variables',
    'Firebase Auth',
    'Firestore',
    'Admin SDK',
    'this deployment',
    'Demo mode',
    'sample catalogue',
    'the server has recorded',
    'stored on the server',
    'ADMIN_SESSION_SECRET',
    'FIREBASE_WEB_API_KEY',
    'live catalogue',
  ]

  const offenders: string[] = []
  for (const file of files) {
    const source = visibleText(withoutComments(readFileSync(file, 'utf8')))
    for (const phrase of banned) {
      if (source.includes(phrase)) offenders.push(`${rel(file)}: "${phrase}"`)
    }
  }
  assert.deepEqual(offenders, [], 'a member never needs to know which service is missing')
})

test('the error boundary shows a sentence, not the exception', () => {
  const source = withoutComments(readFileSync(join(ROOT, 'app/error.tsx'), 'utf8'))
  // The raw message is what leaked "Cannot read properties of undefined (reading 'availableUsd')"
  // onto a member's screen. The digest stays: support can look it up.
  assert.equal(/\{\s*error\??\.message/.test(source), false, 'error.message must not be rendered')
  assert.match(source, /digest/, 'the support reference is still shown')
})

test('the public status feed describes services, not configuration', async () => {
  const { GET } = await import('@/app/api/health/route')
  const body = JSON.parse(await (await GET()).text()) as {
    status: string
    checks: { id: string; label: string; detail: string }[]
  }

  // The feed still answers honestly — this is the shape uptime monitors and /status depend on.
  assert.ok(['operational', 'degraded', 'maintenance', 'outage'].includes(body.status))
  assert.ok(body.checks.length >= 5, `expected the service checks, saw ${body.checks.length}`)

  const published = body.checks.map((check) => `${check.label} ${check.detail}`).join('\n')
  for (const phrase of [
    'Admin console',
    'console',
    'ADMIN_SESSION_SECRET',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'PAYSTACK',
    'DIDIT',
    'RESEND',
    'Firebase',
    'Firestore',
    'Admin SDK',
    'webhook',
    'deployment',
    'API key',
  ]) {
    assert.equal(published.includes(phrase), false, `the public feed must not mention ${phrase}`)
  }

  // Runtime fingerprints are operator detail on a public endpoint.
  for (const key of ['node', 'load', 'region', 'service']) {
    assert.equal(key in body, false, `the public feed must not include "${key}"`)
  }
})
