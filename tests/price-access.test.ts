/**
 * Price access — paying for a region's price tier.
 *
 * The change these tests protect: the payment stopped being "a training fee on this card" and became
 * "access to this region's prices". Two things must not slip while that changes:
 *
 *  1. the fee obeys the tier it unlocks, so a $40 Asian tier cannot be bought at an Americas price;
 *  2. the entitlement is per region and exact, so paying for Asia never opens Europe; and
 *  3. the training modules are still there — the change was to the gate, not to the course.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  PRICE_ACCESS_PURPOSE,
  UNLOCKED_PRICE_REGIONS_FIELD,
  canWorkRegionPrices,
  priceAccessBlurb,
  priceAccessFeeUsd,
  priceAccessState,
  priceTierOrder,
} from '@/lib/price-access'
import { REGION_PAY_CEILING, PAY_REGIONS } from '@/lib/pay-regions'

test('the fee for a tier is capped by that tier’s own ceiling', () => {
  for (const region of PAY_REGIONS) {
    const fee = priceAccessFeeUsd({ trainingFeeUsd: 500 }, region)
    assert.equal(fee, REGION_PAY_CEILING[region], `${region}: a fee written for another economy must be capped`)
    assert.ok(fee > 0, `${region}: an unlock is never free`)
  }
  // A deliberately cheaper price is honoured: the console is where a lower fee is set, not a floor.
  assert.equal(priceAccessFeeUsd({ trainingFeeUsd: 3 }, 'Americas'), 3)
})

test('a card that states no fee falls back to its tier’s ceiling, never to zero', () => {
  for (const region of PAY_REGIONS) {
    assert.equal(priceAccessFeeUsd({ trainingFeeUsd: 0 }, region), REGION_PAY_CEILING[region])
    assert.equal(priceAccessFeeUsd(null, region), REGION_PAY_CEILING[region])
  }
})

test('the tiers are advertised cheapest first and never include the member’s own board', () => {
  for (const own of PAY_REGIONS) {
    const order = priceTierOrder(own)
    assert.equal(order.length, PAY_REGIONS.length - 1, `${own}: three tiers to sell, not four`)
    assert.ok(!order.includes(own), `${own}: the member’s own board is not for sale`)
    // Cheapest first: the ladder the platform set (Africa < Asia < Europe < Americas).
    const fees = order.map((region) => priceAccessFeeUsd({ trainingFeeUsd: 0 }, region))
    for (let i = 1; i < fees.length; i += 1) {
      assert.ok(fees[i] >= fees[i - 1], `${own}: tiers must be listed cheapest first`)
    }
  }
})

test('an unlock is per region, exact, and deduplicated', () => {
  const state = priceAccessState({ ownRegion: 'Africa', unlockedPriceRegions: ['Asia', 'Asia', 'Europe'] })
  assert.deepEqual(state.unlocked, ['Asia', 'Europe'])
  assert.deepEqual(state.workable, ['Africa', 'Asia', 'Europe'])
  assert.equal(state.allUnlocked, false)

  // Paying for Asia does not open Europe.
  assert.equal(canWorkRegionPrices({ ownRegion: 'Africa', unlockedPriceRegions: ['Asia'] }, 'Africa'), true)
  assert.equal(canWorkRegionPrices({ ownRegion: 'Africa', unlockedPriceRegions: ['Asia'] }, 'Asia'), true)
  assert.equal(canWorkRegionPrices({ ownRegion: 'Africa', unlockedPriceRegions: ['Asia'] }, 'Europe'), false)
  assert.equal(canWorkRegionPrices({ ownRegion: 'Africa', unlockedPriceRegions: ['Asia'] }, 'Americas'), false)
})

test('a profile cannot assert a region that is not a price region', () => {
  const state = priceAccessState({
    ownRegion: 'Africa',
    unlockedPriceRegions: ['Mars', '', null, 42, 'africa', 'Americas'],
  })
  assert.deepEqual(state.unlocked, ['Americas'], 'unknown and wrong-case values are dropped, not trusted')
})

test('the member’s own region is never listed as an unlock, even if the profile says so', () => {
  const state = priceAccessState({ ownRegion: 'Europe', unlockedPriceRegions: ['Europe', 'Asia'] })
  assert.deepEqual(state.unlocked, ['Asia'], 'own region is free by default — it is not a purchase')
})

test('every region unlocked is reported as all-unlocked, and nothing is left to sell', () => {
  const state = priceAccessState({ ownRegion: 'Asia', unlockedPriceRegions: ['Africa', 'Europe', 'Americas'] })
  assert.equal(state.allUnlocked, true)
  assert.equal(state.workable.length, PAY_REGIONS.length)
})

test('the unlock blurb names the region, the price and what it buys', () => {
  const blurb = priceAccessBlurb({ region: 'Americas', ownRegion: 'Africa', feeUsd: 12 })
  assert.match(blurb, /Unlock Americas job prices for \$12\.00/)
  assert.match(blurb, /pay Americas rates/)
  assert.match(priceAccessBlurb({ region: 'Africa', ownRegion: 'Africa', feeUsd: 4 }), /no payment needed/)
})

test('the purchase marker is one constant, because three routes compare it', () => {
  const files = [
    'app/api/paystack/initialize/route.ts',
    'app/api/paystack/verify/[reference]/route.ts',
    'app/api/paystack/webhook/route.ts',
  ]
  assert.equal(PRICE_ACCESS_PURPOSE, 'price_access')
  assert.equal(UNLOCKED_PRICE_REGIONS_FIELD, 'unlockedPriceRegions')
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /priceRegion/, `${file} must carry the region`)
  }
  // The entitlement is written by the server, on the profile, under one field name.
  const admin = readFileSync('lib/firestore-admin.ts', 'utf8')
  assert.match(admin, /export async function recordPriceAccessAdmin/)
  assert.match(admin, /unlockedPriceRegions: FieldValue\.arrayUnion\(region\)/)
})

test('the training modules were not removed with the fee', () => {
  // The instruction was explicit, and this is the test that notices a later cleanup deleting them.
  const page = readFileSync('app/training/[id]/page.tsx', 'utf8')
  assert.match(page, /<TrainingModules/, 'the course still renders on the training page')
  const modules = readFileSync('components/training-modules.tsx', 'utf8')
  assert.match(modules, /export function TrainingModules/)
  // The board still carries the authored sections a module renders.
  const catalogue = readFileSync('lib/regional-jobs.ts', 'utf8')
  assert.match(catalogue, /trainingNotes/)
})
