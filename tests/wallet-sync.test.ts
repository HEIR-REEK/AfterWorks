import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { walletBalancesChanged } from '@/lib/wallet-sync'

/**
 * "The dashboard balance isn't reflecting."
 *
 * The dashboard leads with `payouts.withdrawableUsd`, which only `GET /api/wallet` can compute —
 * it is the one place that runs the settlement pass. The live Firestore listener updates `wallet`,
 * not `payouts`, so money landing in the document moved the "Pending (clearing)" tile and left
 * "Withdrawable" frozen at its mount-time value until something explicitly re-read the wallet.
 *
 * The provider now re-reads whenever the document's balances move. These tests pin the rule that
 * decides when, because the two failure modes are both silent:
 *   • re-read too often and every mount and every keystroke costs an extra wallet GET;
 *   • re-read too little and the bug is simply back.
 */

test('the first observation is a baseline, not a change', () => {
  // The snapshot effect already reads the wallet on mount. Counting the baseline as a change would
  // double that read on every page load, for no new information.
  assert.equal(walletBalancesChanged(null, { pendingUsd: 0, availableUsd: 0 }), false)
  assert.equal(walletBalancesChanged(null, { pendingUsd: 3, availableUsd: 12 }), false)
})

test('a document that has not moved does not trigger a read', () => {
  const balances = { pendingUsd: 3, availableUsd: 12 }
  assert.equal(walletBalancesChanged(balances, { ...balances }), false)
})

test('a credit landing in pending triggers a read', () => {
  // The referral bonus, a staff grant, a matured clearing entry — all of them land in Firestore
  // first and only become withdrawable once the server snapshot is rebuilt.
  assert.equal(walletBalancesChanged({ pendingUsd: 0, availableUsd: 0 }, { pendingUsd: 3, availableUsd: 0 }), true)
})

test('a credit landing in available triggers a read', () => {
  assert.equal(walletBalancesChanged({ pendingUsd: 0, availableUsd: 0 }, { pendingUsd: 0, availableUsd: 5 }), true)
})

test('a balance going down triggers a read too', () => {
  // A paid withdrawal, a reversal or a hold does not move the figure up, and it is just as invisible.
  assert.equal(walletBalancesChanged({ pendingUsd: 3, availableUsd: 12 }, { pendingUsd: 0, availableUsd: 4 }), true)
})

test('one figure moving is enough, and both moving is still one read', () => {
  assert.equal(walletBalancesChanged({ pendingUsd: 3, availableUsd: 12 }, { pendingUsd: 3, availableUsd: 13 }), true)
  assert.equal(walletBalancesChanged({ pendingUsd: 3, availableUsd: 12 }, { pendingUsd: 4, availableUsd: 12 }), true)
  assert.equal(walletBalancesChanged({ pendingUsd: 3, availableUsd: 12 }, { pendingUsd: 4, availableUsd: 13 }), true)
})

test('the comparison is exact, so a sub-cent difference is not lost', () => {
  // Training fees and FX land in fractions of a cent; `Math.abs(a - b) < 0.01` would swallow them.
  assert.equal(walletBalancesChanged({ pendingUsd: 0, availableUsd: 0 }, { pendingUsd: 0.0077, availableUsd: 0 }), true)
  assert.equal(walletBalancesChanged({ pendingUsd: 0, availableUsd: 0 }, { pendingUsd: 0, availableUsd: 0 }), false)
})

test('the provider actually wires the resync to the live listener', () => {
  // The predicate above is only half the fix. If the listener stops calling it — or the debounced
  // read is dropped — the dashboard goes stale again and nothing else fails.
  const source = readFileSync(join(process.cwd(), 'components/afterworks-provider.tsx'), 'utf8')
  assert.match(source, /walletBalancesChanged\(previousWallet, nextWallet\)/, 'the listener no longer asks whether the balances moved')
  assert.match(source, /refreshWalletRef\.current\(\)/, 'the listener no longer re-reads the wallet snapshot')
  // Debounced: one save moves both figures, and a burst of edits must not become a burst of reads.
  assert.match(source, /setTimeout\(/, 'the resync is no longer debounced')
  // The timer is cleared with the subscription, or an unmount schedules a read into a dead provider.
  assert.match(source, /clearTimeout\(walletResyncTimer\.current\)/, 'the resync timer is never cleared')
})
