import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADMIN_SESSION_COOKIE,
  MAINTENANCE_BYPASS_COOKIE,
  adminConsoleLoginPath,
  isAdminConsolePath,
  safeAdminReturnPath,
} from '@/lib/security-core'
import { bearerAdminPrincipal } from '@/lib/admin-domain'
import { issueSession, readSession, verifyToken } from '@/lib/session-token'

/**
 * The console's door.
 *
 * Reported as: "the admin site opens without a login — it just displays the dashboard, and a login
 * process is a must." Two things were true in the code:
 *
 *  1. The console's pages were served to anybody. Which one you saw was decided by client
 *     JavaScript after an async probe, so the login form was a courtesy, not a requirement — and
 *     `middleware.ts` now redirects any `/admin/*` page request that arrives without a signed
 *     session cookie.
 *  2. A Firebase ID token carrying the `admin` claim was accepted on its own. That claim is minted
 *     onto *member* accounts (and trusted by firestore.rules), so an ordinary worker session was a
 *     passcode-free administration credential; only the role table may grant access now.
 *
 * These tests pin both rules down, plus the no-logging rule on the signature path.
 */

const SECRET = 'test-secret-that-is-at-least-32-characters-long'

// ─── Which paths are console pages ───────────────────────────────────────────

test('every console page is behind the sign-in gate', () => {
  for (const path of ['/admin', '/admin/', '/admin/users', '/admin/users/anything', '/admin/security', '/admin/audit-log']) {
    assert.equal(isAdminConsolePath(path), true, `${path} should be gated`)
  }
})

test('the sign-in page, the API and lookalike paths are not gated', () => {
  for (const path of [
    '/admin/login',
    '/admin/login/',
    '/admin/login?next=%2Fadmin%2Fusers',
    '/api/admin/users',
    '/api/admin/session',
    '/administrator',
    '/adminx',
    '/',
    '/sign-in',
    '',
    'admin',
  ]) {
    assert.equal(isAdminConsolePath(path), false, `${path} should not be gated`)
  }
})

test('the redirect remembers where the operator was going — and only ever inside the console', () => {
  assert.equal(adminConsoleLoginPath('/admin/users'), '/admin/login?next=%2Fadmin%2Fusers')
  assert.equal(
    adminConsoleLoginPath('/admin/users', '?state=kyc_on_hold'),
    '/admin/login?next=%2Fadmin%2Fusers%3Fstate%3Dkyc_on_hold',
  )
  // Nothing to return to (or a target that is not a console page) → the plain sign-in URL.
  assert.equal(adminConsoleLoginPath('/admin/login'), '/admin/login')
  // A query string that smuggles a URL is dropped rather than re-encoded and offered back: the
  // return path is only ever a console path, and `/admin` is the fallback anyway.
  assert.equal(adminConsoleLoginPath('/admin', '?next=https://evil.example'), '/admin/login')
})

test('return paths are validated: console-only, same-origin, no tricks', () => {
  assert.equal(safeAdminReturnPath('/admin'), '/admin')
  assert.equal(safeAdminReturnPath('/admin/users?state=active'), '/admin/users?state=active')
  assert.equal(safeAdminReturnPath('  /admin/users  '), '/admin/users')

  for (const bad of [
    '',
    null,
    undefined,
    42,
    'https://evil.example/admin',
    '//evil.example/admin',
    '\\\\evil.example\\admin',
    '/admin/../../etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/admin/login',
    '/admin/login?next=/admin',
    '/api/admin/users',
    '/sign-in',
    '/ADMIN',
    `/${'a'.repeat(600)}`,
  ]) {
    assert.equal(safeAdminReturnPath(bad), null, `${String(bad)} must not be honoured`)
  }
  // Control characters are stripped rather than reflected into a redirect.
  assert.equal(safeAdminReturnPath('/admin/users\u0000'), null)
  assert.equal(safeAdminReturnPath('/admin/users\nnext'), null)
})

// ─── What a verified token is allowed to become ──────────────────────────────

test('a bare `admin` claim is not an administration credential', () => {
  // Exactly the shape ADMIN_SYNC_CUSTOM_CLAIM leaves on a member account: the claim is there,
  // the role table says nothing. This used to return a staff principal (no passcode needed).
  const decoded = { email: 'owner@gmail.example', uid: 'member-uid', exp: 2_000_000_000, admin: true }
  assert.equal(bearerAdminPrincipal(decoded, null), null)
})

test('an operator whose role resolves still works, and gets their real role', () => {
  const decoded = { email: 'Owner@Afterworks.Example', uid: 'uid-1', exp: 2_000_000_000 }
  assert.deepEqual(bearerAdminPrincipal(decoded, 'owner'), {
    email: 'owner@afterworks.example',
    uid: 'uid-1',
    expiresAt: 2_000_000_000_000,
    role: 'owner',
  })
  // Tooling without the claim is fine as long as the roster or a staff account resolves it.
  assert.deepEqual(bearerAdminPrincipal({ ...decoded, admin: false }, 'staff')?.role, 'staff')
})

test('malformed tokens never become principals', () => {
  assert.equal(bearerAdminPrincipal({ email: 'a@b.example', exp: 1 }, 'staff'), null) // no uid
  assert.equal(bearerAdminPrincipal({ uid: 'u', exp: 1 }, 'staff'), null) // no email
  assert.equal(bearerAdminPrincipal({ uid: 'u', email: '   ', exp: 1 }, 'staff'), null)
  // A token without an expiry is not rejected outright (Firebase always sets one), but it must
  // not invent a lifetime either.
  assert.equal(bearerAdminPrincipal({ uid: 'u', email: 'a@b.example' }, 'staff')?.expiresAt, 0)
})

// ─── What the edge accepts as a console session ──────────────────────────────

test('a signed admin session opens the console; a forged one never does', async () => {
  const { token } = await issueSession('owner@afterworks.example', SECRET, 60_000, 'admin')
  assert.ok(await readSession(token, SECRET, 'admin'))

  const [version, payload, signature] = token.split('.')
  const tampered = `${version}.${payload}.${signature.slice(0, -2)}xx`
  assert.equal(await readSession(tampered, SECRET, 'admin'), null)
  assert.equal(await readSession(`${version}.${payload}`, SECRET, 'admin'), null)
  assert.equal(await readSession('', SECRET, 'admin'), null)
  assert.equal(await readSession(token, '', 'admin'), null)
  assert.equal(await readSession(token, 'a-different-secret-that-is-also-long-enough', 'admin'), null)
})

test('the maintenance bypass cookie does not open the console', async () => {
  // The two cookies share a signing secret and differ only by their `typ` claim, so this is the
  // test that keeps the types from being interchangeable: passage around an outage is not a
  // console session.
  const { token: bypass } = await issueSession('oncall@afterworks.example', SECRET, 60_000, 'bypass')
  assert.ok(await readSession(bypass, SECRET, 'bypass'))
  assert.equal(await readSession(bypass, SECRET, 'admin'), null)
})

test('an expired session is refused even though its signature is valid', async () => {
  const { token } = await issueSession('owner@afterworks.example', SECRET, -60_000, 'admin')
  assert.equal(await readSession(token, SECRET, 'admin'), null)
})

test('cookie names are the ones the edge and the API both read', () => {
  assert.equal(ADMIN_SESSION_COOKIE, 'aw_admin_session')
  assert.equal(MAINTENANCE_BYPASS_COOKIE, 'aw_ops_bypass')
})

// ─── The signature path must stay silent ─────────────────────────────────────

test('a rejected signature does not print the expected signature, the candidate or the key length', async () => {
  const calls: unknown[][] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    calls.push(args)
  }
  try {
    const result = await verifyToken('v1.eyJzdWIiOiJhQGIuZXhhbXBsZSJ9.forged-signature', SECRET, 'admin')
    assert.equal(result.ok, false)
  } finally {
    console.log = original
  }
  // Anything printed here hands an attacker a signing oracle plus a fingerprint of the deployment's
  // key — it used to print exactly that (`[DEBUG] Signature mismatch!`, with both signatures).
  assert.equal(calls.length, 0)
})
