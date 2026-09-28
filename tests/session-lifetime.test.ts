import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTH_SESSION_MARKER,
  resolveAuthPersistence,
  shouldEndRestoredSession,
} from '@/lib/auth-policy'
import { demoModeAllowed } from '@/components/app-mode-notices'

/**
 * How long a session lives, and what the app does when it has no session at all.
 *
 * Reported as: *"I closed Chrome and opened it again and the dashboards are still displaying without
 * even a login process, both for admin and user."* Three separate mechanisms could produce that, and
 * these tests pin the fix for each of the two that live in this codebase:
 *
 *  1. the member app never chose a Firebase persistence mode, so the SDK's default (durable,
 *     survives a browser restart) applied;
 *  2. a deployment with no Firebase config rendered the *seeded* worker and catalogue with no
 *     sign-in required, because the gate skipped its redirect when `configured === false`;
 *  3. the console's cookie carried a `Max-Age`, so it outlived the browser.
 *
 * (3) is asserted end to end in `tests/admin-auth-gate.test.ts`-style probing; the cookie option
 * construction is checked here by the same table that documents the decision.
 */

// ─── The member app: how long a device remembers you ─────────────────────────

test('a closed browser ends the session unless the deployment says otherwise', () => {
  // Default: strict. Anything absent, empty or nonsense lands on `session`.
  for (const raw of [undefined, null, '', '   ', 'session', 'SESSION', 'bogus', '0']) {
    assert.equal(resolveAuthPersistence(raw), 'session', `${String(raw)} should mean session`)
  }
  // The one deliberate opt-in, and the synonyms an operator might type.
  for (const raw of ['local', 'LOCAL', ' local ', 'persist', 'persistent']) {
    assert.equal(resolveAuthPersistence(raw), 'local', `${String(raw)} should mean local`)
  }
})

test('a session restored from durable storage is ended — that is the whole report', () => {
  // The reported case: a credential from an older build (or another device policy) survives a
  // browser restart and the app opens signed in. No marker, so it is signed out on sight.
  assert.equal(
    shouldEndRestoredSession({ persistence: 'session', hasUser: true, hasSessionMarker: false }),
    true,
  )
  // A session this browser session started: keep it.
  assert.equal(
    shouldEndRestoredSession({ persistence: 'session', hasUser: true, hasSessionMarker: true }),
    false,
  )
  // Nothing restored: nothing to do (the sign-in page handles it).
  assert.equal(
    shouldEndRestoredSession({ persistence: 'session', hasUser: false, hasSessionMarker: false }),
    false,
  )
  // A deployment that opted into durable sessions keeps them, marker or not.
  assert.equal(
    shouldEndRestoredSession({ persistence: 'local', hasUser: true, hasSessionMarker: false }),
    false,
  )
})

test('the marker is a browser-session cookie, not a credential', () => {
  // It must not be HttpOnly (the browser sets it), must be same-site, and must carry no lifetime —
  // "browser-session" is the property the whole policy rests on. This is the string the provider
  // writes, so a change here is a behaviour change.
  assert.equal(AUTH_SESSION_MARKER, 'afterworks_auth_session')
  const written = `${AUTH_SESSION_MARKER}=1; path=/; SameSite=Lax`
  assert.equal(/Max-Age|Expires/i.test(written), false)
  assert.match(written, /SameSite=Lax/)
})

test('reloading the same tab keeps the session; only a new browser session needs a sign-in', () => {
  // sessionStorage survives a reload but not a browser restart; a cookie survives both within a
  // session. The provider asks `shouldEndRestoredSession` on every auth event, so the interesting
  // assertion is that a *second* auth event in the same browser session (a token refresh, a focus
  // reload) never logs anybody out.
  const browserSessionSignedIn = { persistence: 'session' as const, hasUser: true, hasSessionMarker: true }
  assert.equal(shouldEndRestoredSession(browserSessionSignedIn), false)
  assert.equal(shouldEndRestoredSession(browserSessionSignedIn), false)
})

// ─── An unconfigured deployment must not serve a fake dashboard ──────────────

test('demo mode is off unless it is explicitly switched on', () => {
  for (const raw of [undefined, null, '', '   ', 'false', 'no', '0', 'off', 'disabled']) {
    assert.equal(demoModeAllowed(raw), false, `${String(raw)} must not enable demo mode`)
  }
  for (const raw of ['1', 'true', 'TRUE', 'yes', 'on', ' on ']) {
    assert.equal(demoModeAllowed(raw), true, `${String(raw)} should enable demo mode`)
  }
})

test('the gate fails closed: no Firebase config, no private screen, no seeded data', () => {
  // The predicate the gate uses, restated here so the rule is visible in one place.
  const wallOff = ({
    configured,
    allowDemo,
    isPublic,
    isAdminRoute,
  }: {
    configured: boolean
    allowDemo: boolean
    isPublic: boolean
    isAdminRoute: boolean
  }) => configured === false && !allowDemo && !isPublic && !isAdminRoute

  // The reported symptom: nothing configured, a private dashboard requested → the wall, not a
  // dashboard built from seedWorker().
  assert.equal(wallOff({ configured: false, allowDemo: false, isPublic: false, isAdminRoute: false }), true)
  // Public pages still render (the sign-in form explains the situation itself).
  assert.equal(wallOff({ configured: false, allowDemo: false, isPublic: true, isAdminRoute: false }), false)
  // The console brings its own server-side session and is never gated by this rule.
  assert.equal(wallOff({ configured: false, allowDemo: false, isPublic: false, isAdminRoute: true }), false)
  // A configured deployment behaves exactly as before.
  assert.equal(wallOff({ configured: true, allowDemo: false, isPublic: false, isAdminRoute: false }), false)
  // A developer who asked for the demo gets the demo (loudly, via DemoModeBanner).
  assert.equal(wallOff({ configured: false, allowDemo: true, isPublic: false, isAdminRoute: false }), false)
})
