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

// ─── The gate itself: a priced card is not open until it is paid ────────────

test('a priced card on the member’s own board is locked until its fee is paid', async () => {
  const { unpaidCardRefusal } = await import('@/lib/job-region-gate')
  const card = { id: 'job-ke-1', title: 'Enter supplier invoices', region: 'Africa', trainingFeeUsd: 4, trainingRequired: true }

  const unpaid = unpaidCardRefusal({ card, resolvedRegion: 'Africa', paidCards: [], unlockedRegions: [] })
  assert.ok(unpaid, 'the whole point of the fee: an unpaid card is refused')
  assert.equal(unpaid!.code, 'payment_required')
  assert.match(unpaid!.message, /\$4\.00/)
  assert.match(unpaid!.message, /still locked/)

  // Paid → open. Note the unlock list is irrelevant here: this is the card's own fee.
  assert.equal(unpaidCardRefusal({ card, resolvedRegion: 'Africa', paidCards: ['job-ke-1'], unlockedRegions: [] }), null)
})

test('a card priced for another region is paid for by that region, not by the card', async () => {
  const { unpaidCardRefusal } = await import('@/lib/job-region-gate')
  const card = { id: 'job-us-7', title: 'Business Analyst', region: 'Americas', trainingFeeUsd: 12, trainingRequired: true }

  const unpaid = unpaidCardRefusal({ card, resolvedRegion: 'Africa', paidCards: [], unlockedRegions: [] })
  assert.ok(unpaid)
  assert.match(unpaid!.message, /priced for Americas/)
  assert.match(unpaid!.message, /paid once for the whole region/)

  // The region unlock is what opens it — the card's own id in paidTrainings is not enough for a
  // pre-existing member, and it must not be: they never bought the Americas tier.
  assert.equal(unpaidCardRefusal({ card, resolvedRegion: 'Africa', paidCards: [], unlockedRegions: ['Americas'] }), null)
})

test('a free card, an untrained card, and an unresolved region are never charged', async () => {
  const { unpaidCardRefusal } = await import('@/lib/job-region-gate')
  assert.equal(
    unpaidCardRefusal({ card: { id: 'a', region: 'Africa', trainingFeeUsd: 0 }, resolvedRegion: 'Africa', paidCards: [], unlockedRegions: [] }),
    null,
    'no fee, nothing to pay',
  )
  assert.equal(
    unpaidCardRefusal({ card: { id: 'b', region: 'Africa', trainingFeeUsd: 4, trainingRequired: false }, resolvedRegion: 'Africa', paidCards: [], unlockedRegions: [] }),
    null,
    'an assessment-only card has no gate even if a stale fee is stored',
  )
  // An unresolved region must NOT make a foreign-priced card free — that is the same hole one layer
  // up. It fails closed on the money, and still honours a member who has paid either way.
  assert.ok(
    unpaidCardRefusal({ card: { id: 'c', region: 'Americas', trainingFeeUsd: 12, trainingRequired: true }, resolvedRegion: null, paidCards: [], unlockedRegions: [] }),
    'a geo outage must not open another region’s priced cards',
  )
  assert.equal(
    unpaidCardRefusal({ card: { id: 'c', region: 'Americas', trainingFeeUsd: 12, trainingRequired: true }, resolvedRegion: null, paidCards: ['c'], unlockedRegions: [] }),
    null,
    'but a paid member is never locked out of what they bought',
  )
})

test('every route that can start or finish a card’s work enforces the fee', () => {
  // The bug this pins: hiding the pay block in the page left the routes open, so a priced card could
  // be worked for free by calling the API. The gate is only a gate if the server enforces it.
  const assessments = readFileSync('app/api/assessments/route.ts', 'utf8')
  assert.equal(
    (assessments.match(/unpaidCardRefusal|unpaidRefusalFor/g) ?? []).length >= 3,
    true,
    'the questions and the scoring are both paywalled',
  )
  assert.match(assessments, /code: unpaid\.code/)
  const applications = readFileSync('app/api/applications/route.ts', 'utf8')
  assert.match(applications, /unpaidCardRefusal\(/)
  assert.match(applications, /402/)
})

test('the card page gates on the fee and admits it in words', () => {
  const page = readFileSync('app/jobs/[id]/page.tsx', 'utf8')
  assert.match(page, /needsUnlock/, 'a foreign-priced card is identified')
  assert.match(page, /Pay \$\{trainingFee\} to Unlock \$\{cardRegion\} Prices/, 'and the button says what the money buys')
  const training = readFileSync('app/training/[id]/page.tsx', 'utf8')
  assert.match(training, /const isPaid = !needsUnlock && !needsTrainingPayment/, 'the training page keeps the pay gate')
  assert.match(training, /\{!isPaid && \(/, 'and renders the checkout when it is unpaid')
  assert.match(training, /Unlock \{priceRegion\} Job Prices/, 'the checkout is labelled as a price unlock')
})
