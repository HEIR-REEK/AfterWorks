import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The eye toggle, and what it actually covers.
 *
 * A member asked to be able to blur and unblur their balance. The switch itself is trivial; what
 * makes it real is that *every* number that is a balance goes through it. A tile that still renders
 * `formatUsd(...)` straight into JSX is a tile that stays legible when the member asked for the
 * opposite, and it is invisible in review because the toggle works everywhere else.
 *
 * These are source scans rather than render tests: the surfaces below are the ones a member opens to
 * look at their money, and the rule is that none of them formats a balance on its own.
 */

const ROOT = process.cwd()

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

/** Every place a member's own balance is shown as a number. */
const BALANCE_SURFACES = [
  'app/page.tsx',
  'app/wallet/page.tsx',
  'app/referrals/page.tsx',
  'components/withdraw-panel.tsx',
]

/**
 * Money that is a *rule* rather than a balance — the minimum withdrawal, a job's price. These stay
 * readable when balances are hidden: "the minimum is $50" is not the member's money.
 */
const POLICY_ARGUMENTS = /^(minUsd|payouts\.minWithdrawalUsd|walletMeta\.minWithdrawalUsd|job\.payAmountUsd|data\.bonusUsd|bonus\.amountUsd)/

/** A balance formatted straight into JSX, i.e. rendered without going through the toggle. */
const RAW_RENDER = />\s*\{?\s*format(Usd|KesValue)\(\s*([^)]*?)\s*\)/g

test('no balance surface formats a balance straight into JSX', () => {
  for (const file of BALANCE_SURFACES) {
    const source = read(file)
    const leaks: string[] = []
    for (const match of source.matchAll(RAW_RENDER)) {
      const argument = match[2].trim()
      if (POLICY_ARGUMENTS.test(argument)) continue
      leaks.push(`format${match[1]}(${argument})`)
    }
    assert.deepEqual(
      leaks,
      [],
      `${file} renders these balances itself, so the eye toggle cannot cover them: ${leaks.join(', ')}`,
    )
  }
})

test('every balance surface renders at least one masked figure', () => {
  for (const file of BALANCE_SURFACES) {
    const source = read(file)
    assert.match(
      source,
      /<(Money|KesMoney|MaskedValue)[\s/>]/,
      `${file} shows money but nothing on it goes through the balance toggle`,
    )
  }
})

test('the toggle is on the dashboard, the wallet and the referral panel', () => {
  // The member asked for it on the dashboard; it is on the other two money screens too, so the
  // switch is wherever the money is rather than only on one page.
  for (const file of ['app/page.tsx', 'app/wallet/page.tsx', 'app/referrals/page.tsx']) {
    assert.match(read(file), /<BalanceToggle/, `${file} has no balance toggle`)
  }
})

test('the toggle is in the member shell, so it is reachable without opening a page', () => {
  assert.match(read('components/app-shell.tsx'), /<BalanceToggle/, 'the member shell has no balance toggle')
  // The console shows operator figures rather than member balances, and deliberately does not
  // carry the switch — this asserts the rail still exists, not that the toggle was copied over.
  assert.match(read('app/admin/layout.tsx'), /aria-label="Console sidebar"/, 'the admin shell lost its left rail')
})

test('the visibility preference is stored under one key and read defensively', () => {
  const source = read('components/balance-privacy.tsx')
  const keys = source.match(/STORAGE_KEY = '[^']+'/g) ?? []
  assert.equal(keys.length, 1, `expected exactly one storage key, found ${keys.length}`)
  // Blocked or disabled storage must fall back to "visible", never to a stuck-hidden balance.
  assert.match(source, /catch \{[\s\S]{0,200}return false/, 'the storage read does not fall back to visible')
  assert.match(source, /getServerSnapshot/, 'the store declares no server snapshot, so SSR and the first client render can disagree')
})

test('the masked placeholder is not the number itself', () => {
  const source = read('components/balance-privacy.tsx')
  // Dots, not zeroes or dashes: hiding a balance must not read as "you have nothing".
  assert.match(source, /MASK = '\\u2022/, 'the mask is not a run of bullets')
  assert.ok(source.includes('`$${MASK}`'), 'missing the dollar placeholder')
  assert.ok(source.includes('`KSh ${MASK}`'), 'missing the shilling placeholder')
  // A screen reader must not read the hidden value out from behind the dots.
  assert.match(source, /aria-hidden/, 'the masked value is still exposed to assistive tech')
  // One fixed-width placeholder, so hiding a balance does not reflow the tile around it.
  assert.match(source, /tabular-nums/, 'the mask is not rendered with tabular figures')
})
