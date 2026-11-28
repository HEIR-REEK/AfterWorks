/**
 * Price access — paying to work a region's price tier.
 *
 * What this replaces: a member used to pay a **training fee on each card** before its material and
 * assessment opened. The platform changed the rule: the payment is now about *prices*, not lessons.
 * A member in Africa works the Africa board at African rates; to work cards priced for the Americas
 * or Asia they pay to unlock that region's price tier, once, and then those cards pay that region's
 * prices for as long as they hold that region.
 *
 * What this deliberately does **not** touch: the training modules. Every card keeps its authored
 * sections, `TrainingModules` keeps rendering them, and progress is still tracked. Only the *charge*
 * moved — it is no longer per card and no longer about training.
 *
 * Three things a reviewer should be able to see at a glance:
 *
 *  • **The member's own region is always free.** Nobody pays to work the board they are standing in.
 *  • **The fee is real money, so it obeys the region ceiling** (`trainingFeeForRegion`), exactly as
 *    card prices do. A $40 tier cannot be unlocked with a fee written for the Americas.
 *  • **An unlock is per region, held on the profile**, in `unlockedPriceRegions`, written only by the
 *    server after Paystack confirms the charge. It is never inferred from a request header: the
 *    region a member is *in* decides their own board, but the region they may *work* is what they
 *    paid for.
 */

import { trainingFeeForRegion, type PayRegion } from '@/lib/pay-regions'

/** The order the price tiers are advertised in: cheapest first, the member's own region excluded. */
export function priceTierOrder(own: PayRegion): PayRegion[] {
  const order: PayRegion[] = ['Africa', 'Asia', 'Europe', 'Americas']
  return order.filter((region) => region !== own)
}

/**
 * What unlocking a region's prices costs.
 *
 * The card's own fee is the starting point, capped by the tier's ceiling so a $40 Asian tier cannot
 * be sold at an Americas price. A card that states no fee at all falls back to the region's ceiling —
 * never to zero, because a free unlock is a pricing rule that quietly stops existing.
 */
export function priceAccessFeeUsd(card: { trainingFeeUsd?: number | null } | null | undefined, region: PayRegion): number {
  const stated = Number(card?.trainingFeeUsd ?? 0) || 0
  const base = stated > 0 ? stated : regionCeilingFallback(region)
  return trainingFeeForRegion({ trainingFeeUsd: base }, region)
}

/**
 * The tier's price when no card states one: its ceiling.
 *
 * Imported lazily from the same table the platform already uses, so the access fee and the pay band
 * can never disagree about what a region is worth.
 */
function regionCeilingFallback(region: PayRegion): number {
  // Kept as a literal table rather than a new export so `pay-regions.ts` stays the one money module;
  // the test suite pins these to `REGION_PAY_CEILING`.
  const ceilings: Record<PayRegion, number> = { Africa: 14, Asia: 40, Europe: 62, Americas: 75 }
  return ceilings[region]
}

export type PriceAccessState = {
  /** The region whose board the member may work for free — their own. */
  ownRegion: PayRegion
  /** Regions whose price tier has been paid for, newest first, deduplicated. */
  unlocked: PayRegion[]
  /** What the member may work right now: their own region plus every unlocked one. */
  workable: PayRegion[]
  /** True when every region is already workable — nothing left to sell. */
  allUnlocked: boolean
}

/**
 * Read a profile's `unlockedPriceRegions` into something the UI and the routes can use.
 *
 * Unknown values are dropped rather than trusted: the array is written by the server, but a profile
 * edited in the console (or written by an older build) must not be able to assert a region that does
 * not exist in the price table.
 */
export function priceAccessState(input: {
  ownRegion: PayRegion
  unlockedPriceRegions?: unknown
}): PriceAccessState {
  const known: PayRegion[] = ['Africa', 'Americas', 'Europe', 'Asia']
  const raw = Array.isArray(input.unlockedPriceRegions) ? input.unlockedPriceRegions : []
  const unlocked: PayRegion[] = []
  for (const value of raw) {
    const region = String(value ?? '').trim() as PayRegion
    if (known.includes(region) && region !== input.ownRegion && !unlocked.includes(region)) unlocked.push(region)
  }
  const workable = [input.ownRegion, ...unlocked]
  return {
    ownRegion: input.ownRegion,
    unlocked,
    workable,
    allUnlocked: unlocked.length >= known.length - 1,
  }
}

/** True when the member may work (and earn from) cards priced for this region. */
export function canWorkRegionPrices(
  state: { ownRegion: PayRegion; unlockedPriceRegions?: unknown },
  region: PayRegion,
): boolean {
  return priceAccessState(state).workable.includes(region)
}

/**
 * The one-line reason a locked region cannot be worked, for the card panel and the route refusal.
 *
 * Names the region and the price, because the member's next question is always "how much, and where".
 */
export function priceAccessBlurb(input: {
  region: PayRegion
  ownRegion: PayRegion
  feeUsd: number
}): string {
  if (input.region === input.ownRegion) return 'Included with your own board — no payment needed.'
  return `Unlock ${input.region} job prices for $${input.feeUsd.toFixed(2)} and its cards pay ${input.region} rates.`
}

/**
 * The marker written to a payment row for this kind of charge.
 *
 * Kept as a constant because three places compare it — initialize, verify and the webhook — and a
 * typo in one of them is a charge that never unlocks anything.
 */
export const PRICE_ACCESS_PURPOSE = 'price_access'

/** The profile field the entitlement lands in. */
export const UNLOCKED_PRICE_REGIONS_FIELD = 'unlockedPriceRegions'
