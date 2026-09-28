import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PUBLIC_ROUTES, isPublicRoute } from '@/lib/public-routes'
import { privacyHref, termsHref } from '@/lib/terms'

/**
 * The links a signed-out visitor can click, and where they are allowed to end up.
 *
 * This exists because the legal documents were broken in the least visible way a page can break:
 * `/terms` and `/privacy` were server-rendered correctly and then the client gate — which kept its
 * own inline list of public routes — redirected the visitor to `/sign-in` a moment later, and on a
 * deployment without Firebase replaced the whole document with the configuration wall. Nothing
 * threw, nothing 404'd, and the page source looked right. The first sign-up checkbox in the product
 * was, in effect, a link to the sign-in form.
 *
 * Three things are checked here, in the order they can go wrong:
 *  1. the pages the links point at exist on disk;
 *  2. the routes are declared public, so the gate does not redirect off them or wall them off;
 *  3. the routes that *should* still require a session still do.
 */

const ROOT = process.cwd()

/** `app/(marketing)/terms/page.tsx` and `app/terms/route.ts` both serve `/terms`. */
function routeFileExists(href: string): boolean {
  const path = href.split('#')[0].split('?')[0]
  if (path === '/') return existsSync(join(ROOT, 'app/page.tsx'))
  const segments = path.split('/').filter(Boolean)
  // A dynamic segment (`/jobs/[id]`) is satisfied by any concrete link into it.
  const candidates = [join(ROOT, 'app', ...segments, 'page.tsx'), join(ROOT, 'app', ...segments, 'route.ts')]
  if (candidates.some(existsSync)) return true
  const parent = join(ROOT, 'app', ...segments.slice(0, -1))
  if (!existsSync(parent)) return false
  return readdirSync(parent).some((entry) => entry.startsWith('[') && statSync(join(parent, entry)).isDirectory())
}

test('the legal documents the member app links to exist as routes', () => {
  assert.ok(routeFileExists('/terms'), 'app/terms/page.tsx is missing')
  assert.ok(routeFileExists('/privacy'), 'app/privacy/page.tsx is missing')
})

test('a legal document is readable without signing in first', () => {
  // The regression: the sign-up checkboxes and the footer both point here, and both were answered
  // with a redirect to /sign-in or with the "not ready on this site yet" wall.
  assert.equal(isPublicRoute('/terms'), true)
  assert.equal(isPublicRoute('/privacy'), true)
  // Deep links, including the referral rules the sign-up checkbox explicitly names.
  assert.equal(isPublicRoute('/terms#referrals'), true)
  assert.equal(isPublicRoute('/privacy#what-we-collect'), true)
  // Every helper the app actually renders must produce a public target, so a future section id
  // cannot make the link private again.
  assert.equal(isPublicRoute(termsHref()), true)
  assert.equal(isPublicRoute(privacyHref()), true)
  assert.equal(isPublicRoute(termsHref('earnings')), true)
  assert.equal(isPublicRoute(privacyHref('retention')), true)
})

test('the routes the app already treated as public stay public', () => {
  for (const route of ['/sign-in', '/sign-up', '/forgot-password', '/verify-email', '/kyc/callback', '/maintenance', '/status']) {
    assert.equal(isPublicRoute(route), true, `${route} must render for a signed-out visitor`)
  }
  // Sub-paths of a public route are public (`/sign-in/anything`), which is how the gate matched
  // them before this list moved into `lib/public-routes`.
  assert.equal(isPublicRoute('/sign-in/anything'), true)
})

test('the routes that need a session are still private', () => {
  for (const route of ['/', '/profile', '/jobs', '/wallet', '/applications', '/referrals', '/training', '/admin', '/admin/login']) {
    assert.equal(isPublicRoute(route), false, `${route} must not render without a session`)
  }
})

test('a public prefix does not leak past its own segment', () => {
  // `/term` and `/terms-of-use` are not `/terms`; a prefix match without the boundary check would
  // hand the sign-in screen's exemption to any path that merely starts with the same letters.
  assert.equal(isPublicRoute('/terms-of-use'), false)
  assert.equal(isPublicRoute('/privacypolicy'), false)
  assert.equal(isPublicRoute('/sign-in-fake'), false)
})

test('every internal link in the member surface resolves to a real route', () => {
  // The other half of "the link does not work": pointing at a page that was never created. This
  // scans the source rather than rendering, so it catches a typo in a link the day it is written.
  const internal = new Set<string>()
  const hrefPattern = /href=["'](\/[^"'`]*)["']|href=\{`(\/[^`]*)`\}/g

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (full.includes('/app/admin') || full.includes('/app/api')) continue
        walk(full)
        continue
      }
      if (!entry.endsWith('.tsx')) continue
      const source = readFileSync(full, 'utf8')
      for (const match of source.matchAll(hrefPattern)) {
        internal.add(match[1] ?? match[2])
      }
    }
  }
  walk(join(ROOT, 'app'))
  walk(join(ROOT, 'components'))

  assert.ok(internal.size > 5, 'the scan found no links at all — it is not looking where the links are')
  for (const href of internal) {
    if (href.startsWith('/api/')) continue
    // Template links to a member's own record (`/jobs/${job.id}`) are checked against the
    // directory that holds the dynamic route.
    const concrete = href.replace(/\$\{[^}]*\}/g, 'sample-id')
    assert.ok(routeFileExists(concrete), `${href} does not resolve to a page`)
  }
})

test('the public list is what the gate reads, not a copy of it', () => {
  // The actual defect was two lists: one in `lib/terms` (where the pages were) and one inline in
  // the gate. A duplicated list is how the second one went stale, so the gate must import this one.
  const gate = readFileSync(join(ROOT, 'components/app-gate.tsx'), 'utf8')
  assert.match(gate, /from '@\/lib\/public-routes'/, 'app-gate must import the shared list')
  assert.doesNotMatch(gate, /const PUBLIC_ROUTES\s*=/, 'app-gate must not keep its own copy of the list')
  assert.ok(PUBLIC_ROUTES.includes('/terms') && PUBLIC_ROUTES.includes('/privacy'))
})
