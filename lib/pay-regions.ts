/**
 * Pay by region — the rule that decides what a card is worth to *one* worker.
 *
 * The requirement: an American, a European and an Asian member sees the same work priced higher
 * than a member in Africa, because the cost of living is not the same. The two halves of that are
 * deliberately separate:
 *
 *  • **Which region** — `regionForCountry`, from the *verified* country: the ISO code an owner
 *    stamped when they approved identity, or the country the payout destination is held in. Both
 *    are things a worker cannot change by opening a VPN tab.
 *  • **What that region pays** — a per-region table on each job card, authored in the console.
 *
 * Why not the request IP, which is the obvious shortcut: the IP a request arrives with is the
 * client's egress. It is choosable, free and instantly changeable, and the money is snapshotted at
 * apply time (`createApplicationServer` copies `payAmountUsd` into the application) and paid at
 * approval. A member in Nairobi on a US VPN would apply at $32, switch the tunnel off, do the work
 * from Nyeri and be paid $32 — as a *correct* application, with no anomaly to catch. So the IP is
 * used for what it is good at (see `lib/geo-country.ts`: showing the right board, preselection) and
 * never for the number that leaves the building.
 *
 * The countries of the world are grouped below rather than stored per job, so a card carries four
 * prices instead of 150. Anything unclassified falls to `AFRICA` — pricing a German at the African
 * rate costs a little; pricing a Kenyan at the European rate is the direction that bankrupts.
 */

import { getCountry, isKnownCountry } from '@/lib/countries'

export const PAY_REGIONS = ['Africa', 'Americas', 'Europe', 'Asia'] as const

export type PayRegion = (typeof PAY_REGIONS)[number]

/**
 * Region membership. Sorted for scanning; the lookup is a set, not this order.
 *
 * Notes on the judgement calls, because a few of these are arguable and should be easy to review:
 *  • Russia sits in Europe (its labour and payment rails do), Turkey likewise.
 *  • Central Asia, the Middle East and the Caucasus are `Asia` — they are not African, and pricing
 *    them at the American rate would be indefensible.
 *  • Central America and the Caribbean are `Americas`, which is the literal reading of the
 *    continent and keeps the group coherent.
 *  • Pacific small states (FJ, PG, WS, TO, VU) are `Asia` as the nearest coherent grouping; they
 *    are single-country edge cases and nothing depends on them being elsewhere.
 */
const AFRICA = [
  'AO', 'BF', 'BI', 'BJ', 'BW', 'CD', 'CG', 'CI', 'CM', 'CV', 'DJ', 'DZ', 'EG', 'ER', 'ET', 'GA', 'GH', 'GM',
  'GN', 'GQ', 'GW', 'KE', 'KM', 'LR', 'LS', 'LY', 'MA', 'MG', 'ML', 'MR', 'MU', 'MW', 'MZ', 'NA', 'NE', 'NG',
  'RE', 'RW', 'SC', 'SD', 'SH', 'SL', 'SN', 'SO', 'SS', 'ST', 'SZ', 'TD', 'TG', 'TN', 'TZ', 'UG', 'YT', 'ZA',
  'ZM', 'ZW',
]

const AMERICAS = [
  'AG', 'AI', 'AR', 'AW', 'BB', 'BL', 'BM', 'BO', 'BQ', 'BR', 'BS', 'BZ', 'CA', 'CL', 'CO', 'CR', 'CU', 'CW',
  'DM', 'DO', 'EC', 'FK', 'GD', 'GF', 'GL', 'GP', 'GT', 'GY', 'HN', 'HT', 'JM', 'KN', 'KY', 'LC', 'MF', 'MQ',
  'MS', 'MX', 'NI', 'PA', 'PE', 'PM', 'PR', 'PY', 'SR', 'SV', 'SX', 'TC', 'TT', 'US', 'UY', 'VC', 'VE', 'VG',
  'VI',
]

const EUROPE = [
  'AD', 'AL', 'AM', 'AT', 'AX', 'AZ', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI',
  'FO', 'FR', 'GB', 'GE', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT', 'LU', 'LV',
  'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI', 'SK', 'SM', 'TR', 'UA',
  'VA', 'XK',
]

// Oceania rides with Asia as the nearest coherent grouping for labour-market pricing. AU and NZ are
// high-cost, which is the point of the last three-clause ordering check in `validateRegionalPay`.
const ASIA = [
  'AE', 'AF', 'AU', 'BD', 'BH', 'BN', 'BT', 'CN', 'FJ', 'HK', 'ID', 'IL', 'IN', 'IQ', 'IR', 'JO', 'JP', 'KG',
  'KH', 'KP', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LK', 'MM', 'MN', 'MO', 'MV', 'MY', 'NP', 'NZ', 'OM', 'PG', 'PH',
  'PK', 'PS', 'QA', 'SA', 'SG', 'SY', 'TH', 'TJ', 'TL', 'TM', 'TW', 'UZ', 'VN', 'WS', 'YE', 'TO', 'VU',
]

const REGION_BY_COUNTRY: ReadonlyMap<string, PayRegion> = new Map<string, PayRegion>([
  ...AFRICA.map((code) => [code, 'Africa'] as const),
  ...AMERICAS.map((code) => [code, 'Americas'] as const),
  ...EUROPE.map((code) => [code, 'Europe'] as const),
  ...ASIA.map((code) => [code, 'Asia'] as const),
])

/** The region a country is priced at. Unknown or missing → `AFRICA`, the lower of the two risks. */
export function regionForCountry(country: unknown): PayRegion {
  const code = String(country ?? '').trim().toUpperCase()
  if (!code) return 'Africa'
  return REGION_BY_COUNTRY.get(code) ?? 'Africa'
}

/** Registration order matters for display: the platform's home market first. */
export const PAY_REGION_LABELS: Record<PayRegion, string> = {
  Africa: 'Africa',
  Americas: 'Americas',
  Europe: 'Europe',
  Asia: 'Asia',
}

/**
 * Which evidence decided the region. Carried on the application and shown in the console, because
 * "why is this person on the European rate?" has to be answerable months later during a dispute.
 */
export type RegionBasis = 'verified' | 'destination' | 'declared'

export type ResolvedRegion = {
  region: PayRegion
  basis: RegionBasis
  /** ISO code the decision was made from, empty when nothing usable was stored. */
  country: string
}

/**
 * Decide a worker's region, with the evidence trail.
 *
 * Order of authority:
 *
 *  1. **`verifiedCountry`** — stamped when an owner approved identity. This is the only value that
 *     was checked against a document, so it is the only one that settles a disagreement.
 *  2. **The payout destination's country** — an M-Pesa number is Kenyan by construction and a
 *     Kenyan bank account is held in Kenya. Not *proven* the way a document is, and it is a field
 *     the member can change, but money cannot be received into a country they are not in.
 *  3. **`country`** — self-declared on the profile. Editable by the member, so it is only a
 *     fallback for accounts that predate verification, and it is labelled as such.
 *
 * Every path ends in a region: an unrecorded member is priced at `Africa`. That is a deliberate
 * choice in favour of the platform, and the console shows `basis: 'declared'` so an operator can
 * see who is on the fallback and fix it before approving anything expensive.
 */
export function resolveWorkerRegion(input: {
  verifiedCountry?: unknown
  payoutCountry?: unknown
  declaredCountry?: unknown
}): ResolvedRegion {
  const verified = String(input.verifiedCountry ?? '').trim().toUpperCase()
  if (isKnownCountry(verified)) return { region: regionForCountry(verified), basis: 'verified', country: verified }

  const destination = String(input.payoutCountry ?? '').trim().toUpperCase()
  if (isKnownCountry(destination)) {
    return { region: regionForCountry(destination), basis: 'destination', country: destination }
  }

  const declared = String(input.declaredCountry ?? '').trim().toUpperCase()
  if (isKnownCountry(declared)) return { region: regionForCountry(declared), basis: 'declared', country: declared }

  return { region: 'Africa', basis: 'declared', country: '' }
}

/**
 * The country a phone number is *structurally* held in.
 *
 * M-Pesa payouts are Kenyan by construction (`lib/payouts.ts` enforces a Kenyan mobile-money
 * rule), so a member whose payout number passes that check is operating in Kenya whatever else the
 * profile says. Kept as a helper rather than inlined so the two callers cannot drift.
 */
export function kenyaIfMpesa(method: unknown): string {
  return String(method ?? '') === 'M-Pesa' ? 'KE' : ''
}

/** A per-region price list on one card. Every region must be priced; the editor enforces it. */
export type RegionalPay = Partial<Record<PayRegion, number>> & { default?: number }

/**
 * What this card pays *this* region.
 *
 * Resolution: the region's own entry, then `default`, then the card's legacy scalar
 * (`payAmountUsd`). The last step is what lets existing cards keep working untouched — a card that
 * never had a regional table is worth its scalar everywhere, exactly as it was before this existed.
 *
 * Never returns 0 for a priced card: a missing entry is filled from the scalar rather than
 * silently making the work unpaid, because "the admin forgot a region" must not become "this
 * member worked for nothing".
 */
export function payForRegion(
  card: { payAmountUsd: number; payByRegion?: RegionalPay | null },
  region: PayRegion,
): number {
  const table = card.payByRegion
  const scalar = Number(card.payAmountUsd ?? 0) || 0
  if (table) {
    const regional = Number(table[region] ?? NaN)
    if (Number.isFinite(regional) && regional > 0) return round2(regional)
    const fallback = Number(table.default ?? NaN)
    if (Number.isFinite(fallback) && fallback > 0) return round2(fallback)
  }
  return round2(scalar)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Validate a regional table as it arrives from the console.
 *
 * Returns the clean table and the problems, rather than throwing, so the editor can show every
 * mistake at once. An incomplete table is accepted only when it has a `default` to fall back on —
 * otherwise some region would be priced at whatever the legacy scalar happened to be, which is how
 * a card ends up paying a Kenyan more than an American by accident.
 */
export function validateRegionalPay(
  input: unknown,
  opts: { legacyScalar?: number } = {},
): { ok: boolean; value: RegionalPay | null; errors: string[] } {
  const errors: string[] = []
  if (input === undefined || input === null) return { ok: true, value: null, errors }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, value: null, errors: ['Regional pay must be an object keyed by region.'] }
  }
  const record = input as Record<string, unknown>
  const value: RegionalPay = {}
  for (const region of PAY_REGIONS) {
    if (!(region in record)) continue
    const raw = Number(record[region])
    if (!Number.isFinite(raw)) {
      errors.push(`${region} must be a number.`)
      continue
    }
    if (raw < 0.5 || raw > 10_000) {
      errors.push(`${region} must be between 0.50 and 10,000 USD.`)
      continue
    }
    value[region] = round2(raw)
  }
  if ('default' in record) {
    const raw = Number(record.default)
    if (!Number.isFinite(raw) || raw < 0.5 || raw > 10_000) errors.push('The default price must be between 0.50 and 10,000 USD.')
    else value.default = round2(raw)
  }

  const priced = PAY_REGIONS.filter((region) => value[region] !== undefined)
  if (priced.length === 0 && value.default === undefined) {
    errors.push('Give at least one region a price, or a default.')
  }
  // A partial table without a default leaves some region on the legacy scalar; say so instead of
  // guessing whether that was intended.
  if (priced.length > 0 && priced.length < PAY_REGIONS.length && value.default === undefined) {
    const missing = PAY_REGIONS.filter((region) => value[region] === undefined)
    errors.push(`Price ${missing.join(', ')} as well, or set a default — otherwise those regions fall back to the card's original ${opts.legacyScalar ?? ''} USD.`)
  }
  // The one ordering rule worth enforcing automatically: nobody in a lower-cost region should be
  // paid more than one in a higher-cost region by accident. A typo here is a real overpayment.
  if (value.Africa !== undefined && value.Americas !== undefined && value.Africa > value.Americas) {
    errors.push('Africa is priced above the Americas — check the numbers are the right way round.')
  }
  if (value.Africa !== undefined && value.Europe !== undefined && value.Africa > value.Europe) {
    errors.push('Africa is priced above Europe — check the numbers are the right way round.')
  }
  if (value.Africa !== undefined && value.Asia !== undefined && value.Africa > value.Asia) {
    errors.push('Africa is priced above Asia — check the numbers are the right way round.')
  }

  return { ok: errors.length === 0, value: errors.length === 0 ? value : null, errors }
}

/** Reverse view for the admin editor: which countries sit in this region. */
export function countriesInRegion(region: PayRegion): string[] {
  return [...REGION_BY_COUNTRY.entries()].filter(([, value]) => value === region).map(([code]) => code).sort()
}

/** True when the region table is complete enough to price every region without the scalar. */
export function isRegionalPayComplete(table: RegionalPay | null | undefined): boolean {
  if (!table) return false
  return PAY_REGIONS.every((region) => Number(table[region] ?? 0) > 0) || Number(table.default ?? 0) > 0
}

/** The cheapest and most expensive region on a card — used by the console list view. */
export function payRangeForCard(card: { payAmountUsd: number; payByRegion?: RegionalPay | null }): { min: number; max: number } {
  const amounts = PAY_REGIONS.map((region) => payForRegion(card, region))
  return { min: Math.min(...amounts), max: Math.max(...amounts) }
}

/** Countries we can price. Exposed for the console, which lists them per region. */
export const PRICEABLE_COUNTRY_COUNT = REGION_BY_COUNTRY.size

/** A country's name for console copy, falling back to the code when we do not carry it. */
export function countryLabelForRegion(country: unknown): string {
  return getCountry(country)?.name ?? String(country ?? '').toUpperCase()
}
