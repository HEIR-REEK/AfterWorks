import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The menu lives on the left, vertically, in both shells.
 *
 * A member asked for the top menu to "fall on the left side" — Jobs, Dashboard and the rest,
 * together with the profile and the log-out button — and for the same treatment on the admin panel.
 * That is a structural change: the shells used to carry a horizontal nav in a sticky header plus a
 * six-column bar pinned to the bottom of a phone, with sign-out off to the right.
 *
 * Nothing here can be checked by rendering (there is no browser in CI), so these are source scans.
 * The value is that the *shape* cannot quietly regress: a future edit that moves the nav back into
 * the header, or drops the profile/sign-out block out of the rail, turns this red.
 */

const ROOT = process.cwd()

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

const MEMBER_SHELL = 'components/app-shell.tsx'
const ADMIN_SHELL = 'app/admin/layout.tsx'

test('both shells put their nav in a fixed left rail', () => {
  for (const file of [MEMBER_SHELL, ADMIN_SHELL]) {
    const source = read(file)
    assert.match(
      source,
      /fixed inset-y-0 left-0/,
      `${file} has no rail pinned to the left edge of the viewport`,
    )
    // The content column is padded by exactly the rail's width, so nothing sits underneath it.
    assert.match(
      source,
      /(md|xl):pl-(64|72)/,
      `${file} does not pad its content column clear of the rail`,
    )
  }
})

test('the rail lists its destinations vertically, not across', () => {
  for (const file of [MEMBER_SHELL, ADMIN_SHELL]) {
    const source = read(file)
    assert.match(source, /flex flex-col gap-1/, `${file} does not stack its nav items vertically`)
    // The old shapes. A horizontal row inside the rail, or a bottom bar, is the regression.
    assert.doesNotMatch(source, /grid-cols-6/, `${file} still has the six-column bottom bar`)
    assert.doesNotMatch(
      source,
      /hidden items-center gap-1 md:flex/,
      `${file} still has the horizontal nav back in the header`,
    )
  }
})

test('the member rail carries Jobs, Dashboard, profile and sign out', () => {
  const source = read(MEMBER_SHELL)
  for (const label of ['Dashboard', 'Jobs', 'Applied', 'Wallet', 'Referrals', 'Profile']) {
    assert.ok(source.includes(`label: '${label}'`), `the member rail lost ${label}`)
  }
  // Profile is reachable as a card at the foot of the rail, not only as a nav row.
  assert.match(source, /href="\/profile"[\s\S]{0,1000}View profile/, 'the member rail has no profile card')
  assert.match(source, /onClick=\{handleSignOut\}/, 'sign out is no longer in the member rail')
  assert.match(source, /<LogOut/, 'the member rail has no sign-out icon')
})

test('the admin rail carries every console section and its own sign out', () => {
  const source = read(ADMIN_SHELL)
  for (const label of [
    'Overview',
    'Users & KYC',
    'Jobs Catalogue',
    'Applications & QA',
    'Staff',
    'Withdrawals',
    'Money Ledger',
    'Maintenance Mode',
    'Audit Log',
    'Security',
  ]) {
    assert.ok(source.includes(`label: '${label}'`), `the admin rail lost ${label}`)
  }
  assert.match(source, /session\.signOut\(\)/, 'sign out is no longer in the admin rail')
  // The role and the session countdown moved with it, so the rail says who is signed in.
  assert.match(source, /session\.email/, 'the admin rail does not say which operator is signed in')
})

test('the drawer opens, closes on navigation and closes on Escape', () => {
  for (const file of [MEMBER_SHELL, ADMIN_SHELL]) {
    const source = read(file)
    assert.match(source, /useState\(false\)/, `${file} has no open/closed state for the drawer`)
    assert.match(source, /setNavOpen\(false\)\s*\n\s*\}, \[pathname\]\)/, `${file} does not close the drawer on navigation`)
    assert.match(source, /event\.key === 'Escape'/, `${file} does not close the drawer on Escape`)
    // Off-screen must also mean out of the tab order.
    assert.match(source, /invisible/, `${file} leaves the closed rail focusable`)
  }
})

test('the header keeps the switch that opens the rail on small screens', () => {
  for (const file of [MEMBER_SHELL, ADMIN_SHELL]) {
    const source = read(file)
    assert.match(source, /aria-label="Open navigation"/, `${file} has no button that opens the drawer`)
    assert.match(source, /aria-expanded=\{navOpen\}/, `${file} does not report the drawer state`)
  }
})
