/**
 * Region-scoped job cards — each region has its own work, its own content and its own price.
 *
 * The rule, in the user's words: the site detects where a member is, and **only that region's cards
 * are open to them**. A member whose connection says America sees the Americas board; everybody
 * else's cards are blurred and locked. Same for Europe and Asia, and Africa.
 *
 * Two consequences that shape everything below:
 *
 *  1. **It is enforced on the server.** The board is read client-side through the Firestore SDK
 *     today, and the value that decides the region is the request IP — which the client controls.
 *     Filtering in the browser would mean a member can simply not filter. So the region comes from
 *     the request headers, on a route, and the response only contains what they may see. The client
 *     receives the locked regions as *counts and names*, never as cards: a blurred card still
 *     carries its id, its price and its description in the payload, and a determined member would
 *     just read it.
 *
 *  2. **A VPN is not a problem to solve.** Choosing a US VPN is, by design here, choosing the US
 *     board — that is what the member asked for by connecting from there. There is no anti-VPN and
 *     no anti-proxy check anywhere in this module, deliberately, and the tests pin that absence so
 *     it does not get "hardened" in later.
 *
 * Pricing is separate and unchanged: `lib/pay-regions.ts` decides what a card *pays*, from the
 * verified country. This module decides what a member may *see*, from the connection. Keeping them
 * apart is what stops one from quietly overwriting the other.
 */

import { PAY_REGIONS, countriesInRegion, type PayRegion } from '@/lib/pay-regions'

export type JobRegion = PayRegion

/** How a card is scoped. `global` means every region, and is what legacy cards become. */
export type JobAudience = { kind: 'global' } | { kind: 'region'; region: JobRegion }

export const JOB_REGION_LIST: readonly JobRegion[] = PAY_REGIONS

export const JOB_REGION_LABELS: Record<JobRegion, string> = {
  Africa: 'Africa',
  Americas: 'Americas',
  Europe: 'Europe',
  Asia: 'Asia',
}

/**
 * One line per region, written for the member who is looking at a locked board.
 *
 * The point of these is that a member should understand *why* they cannot see the cards, without
 * being told their IP is wrong or that a VPN would fix it.
 */
export const JOB_REGION_BLURBS: Record<JobRegion, string> = {
  Africa: 'Work for members connecting from Africa — M-Pesa payouts, Kenyan and regional clients.',
  Americas: 'Work for members connecting from the Americas — USD and card payouts, US and Canadian clients.',
  Europe: 'Work for members connecting from Europe — GBP and EUR clients, EU-morning working windows.',
  Asia: 'Work for members connecting from Asia — APAC clients and Asian-language review queues.',
}

/**
 * Read a card's region from a stored document.
 *
 * Absent means `global`, which is how every card published before regions existed behaves: it stays
 * visible everywhere. That backward compatibility is the reason this feature can ship without
 * rewriting the live catalogue.
 */
export function jobAudienceOf(raw: unknown): JobAudience {
  const value = String(raw ?? '').trim()
  if (!value) return { kind: 'global' }
  const match = PAY_REGIONS.find((region) => region.toLowerCase() === value.toLowerCase())
  return match ? { kind: 'region', region: match } : { kind: 'global' }
}

/** Validate an admin-supplied region: empty/absent → global, anything unrecognised → an error. */
export function validateJobRegion(raw: unknown): { ok: true; value: JobRegion | '' } | { ok: false; error: string } {
  const value = String(raw ?? '').trim()
  if (!value || value.toLowerCase() === 'global' || value.toLowerCase() === 'all') return { ok: true, value: '' }
  const match = PAY_REGIONS.find((region) => region.toLowerCase() === value.toLowerCase())
  if (!match) {
    return { ok: false, error: `Region must be one of ${PAY_REGIONS.join(', ')}, or blank for every region.` }
  }
  return { ok: true, value: match }
}

/** True when this card may be opened by a member in `region`. Global cards are open everywhere. */
export function jobVisibleInRegion(card: { region?: unknown }, region: JobRegion): boolean {
  const audience = jobAudienceOf(card.region)
  if (audience.kind === 'global') return true
  return audience.region === region
}

/**
 * The board one member gets: their cards, plus the locked regions stated honestly.
 *
 * `others` deliberately carries no card data. A blurred card is still a card — id, title, price,
 * description — and shipping it so the UI can blur it would defeat the entire point of locking it.
 * The UI shows "Americas — 4 job cards, connect from the Americas to open them", which is true,
 * useful and reveals nothing.
 *
 * The *open* region's cards, by contrast, are sent in full, because they are the member's own work.
 * One consequence worth stating: a region with no cards of its own is still open — the member sees
 * the global cards and an honest "no cards on this board yet", rather than a lock they cannot clear.
 */
export type RegionalCatalogue<T = unknown> = {
  /** The region the request was resolved to. `null` means we could not tell, so nothing is locked. */
  region: JobRegion | null
  /** How the region was decided. `none` = no header and no lookup. */
  source: 'header' | 'lookup' | 'none'
  /** Cards this member may open. Global cards are included. */
  jobs: T[]
  /**
   * Every region, with how many cards its board holds. The open one is carried so the board can
   * render all four tabs from one source; only the locked entries carry no card bodies.
   */
  regions: { region: JobRegion; label: string; blurb: string; count: number; open: boolean }[]
  /** Regions this member may not open, with a count only. */
  lockedRegions: { region: JobRegion; label: string; blurb: string; count: number }[]
  /** True when the member is seeing every card, i.e. we could not resolve a region. */
  wholeCatalogue: boolean
}

export function partitionCatalogue<T extends { region?: unknown }>(
  cards: T[],
  region: JobRegion | null,
): { visible: T[]; locked: { region: JobRegion; count: number }[] } {
  if (!region) return { visible: cards, locked: [] }
  const visible: T[] = []
  const counts = new Map<JobRegion, number>()
  for (const card of cards) {
    const audience = jobAudienceOf(card.region)
    if (audience.kind === 'global' || audience.region === region) {
      visible.push(card)
      continue
    }
    counts.set(audience.region, (counts.get(audience.region) ?? 0) + 1)
  }
  const locked = [...counts.entries()]
    .map(([lockedRegion, count]) => ({ region: lockedRegion, count }))
    .sort((a, b) => a.region.localeCompare(b.region))
  return { visible, locked }
}

/**
 * Build the payload the board renders.
 *
 * When the region cannot be resolved — no geo header, no lookup service configured — `wholeCatalogue`
 * is true and every card is returned. That is a deliberate choice over the alternative (showing
 * nothing): an unresolved request is a configuration gap on our side, and blanking the board for
 * those members would look like the site is broken. Locking is a pricing decision, not a security
 * boundary, so failing open here costs money at worst.
 */
export function buildRegionalCatalogue<T extends { region?: unknown }>(
  cards: T[],
  resolved: { region: JobRegion | null; source: 'header' | 'lookup' | 'none' },
): RegionalCatalogue<T> {
  const { visible, locked } = partitionCatalogue(cards, resolved.region)

  // How many cards each board holds. Global cards are excluded: they appear on every board, so
  // counting them here would make each region look bigger than its own content.
  const counts = new Map<JobRegion, number>()
  for (const card of cards) {
    const audience = jobAudienceOf(card.region)
    if (audience.kind !== 'region') continue
    counts.set(audience.region, (counts.get(audience.region) ?? 0) + 1)
  }
  const regions = PAY_REGIONS.map((region) => ({
    region,
    label: JOB_REGION_LABELS[region],
    blurb: JOB_REGION_BLURBS[region],
    count: counts.get(region) ?? 0,
    // With no resolved region every board is open; with one, only that one is.
    open: resolved.region === null || resolved.region === region,
  }))

  return {
    region: resolved.region,
    source: resolved.source,
    jobs: visible,
    regions,
    lockedRegions: locked.map((entry) => ({
      region: entry.region,
      label: JOB_REGION_LABELS[entry.region],
      blurb: JOB_REGION_BLURBS[entry.region],
      count: entry.count,
    })),
    wholeCatalogue: resolved.region === null,
  }
}

/**
 * The card id used on the board for a regional card.
 *
 * Region-scoped cards are authored with an explicit id, so this is only used by the seeding path to
 * keep the generated ids predictable and unique. Keeping the region in the id makes a stale
 * application obviously stale — `app-us-…` against `job-us-…` reads correctly in the console.
 */
export function regionalJobId(region: JobRegion, slug: string): string {
  const clean = slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `job-${region.toLowerCase()}-${clean}`
}

/**
 * Anti-VPN is deliberately absent.
 *
 * Exported so the intent is testable rather than only documented: any future "harden this" change
 * that starts inspecting proxies, blocking Tor, or comparing the IP to the profile's country will
 * fail the suite. Connecting from America is how a member says they want the American board.
 */
export const REGION_DETECTION_USES_IP_BY_DESIGN = true

/** Countries a region names, for the console's region picker. */
export function regionCountries(region: JobRegion): string[] {
  // One country→region table in the codebase, owned by pay-regions.
  return countriesInRegion(region)
}
