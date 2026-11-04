/**
 * Adzuna integration — pure half.
 *
 * Nothing here touches the network, Firestore or `process.env`, because the admin console and the
 * public cards both need the country list and the formatters. The server-only client lives in
 * `lib/adzuna-server.ts`, and the cached feed in `lib/external-jobs-server.ts`.
 *
 * Two deliberate constraints shape this module:
 *
 *  • Adzuna does not cover Kenya. Its country enum is fixed, so the feed is always pinned to one
 *    supported market (`ADZUNA_COUNTRY`); `ke` must never be sent upstream.
 *  • A salary that Adzuna marks as predicted is a Jobsworth estimate. Jobsworth has its own
 *    attribution requirements (an icon, a label and a hover disclosure), so we omit predicted
 *    salaries rather than display an estimate without the required furniture.
 */

export const ADZUNA_COUNTRIES = [
  'gb',
  'us',
  'at',
  'au',
  'be',
  'br',
  'ca',
  'ch',
  'de',
  'es',
  'fr',
  'in',
  'it',
  'mx',
  'nl',
  'nz',
  'pl',
  'sg',
  'za',
] as const

export type AdzunaCountry = (typeof ADZUNA_COUNTRIES)[number]

export const ADZUNA_DEFAULT_COUNTRY: AdzunaCountry = 'gb'

export const ADZUNA_COUNTRY_LABELS: Record<AdzunaCountry, string> = {
  gb: 'United Kingdom',
  us: 'United States',
  at: 'Austria',
  au: 'Australia',
  be: 'Belgium',
  br: 'Brazil',
  ca: 'Canada',
  ch: 'Switzerland',
  de: 'Germany',
  es: 'Spain',
  fr: 'France',
  in: 'India',
  it: 'Italy',
  mx: 'Mexico',
  nl: 'Netherlands',
  nz: 'New Zealand',
  pl: 'Poland',
  sg: 'Singapore',
  za: 'South Africa',
}

/** The local Adzuna domain for each market. Attribution links use these, never a guessed host. */
export const ADZUNA_HOME_URLS: Record<AdzunaCountry, string> = {
  gb: 'https://www.adzuna.co.uk',
  us: 'https://www.adzuna.com',
  at: 'https://www.adzuna.at',
  au: 'https://www.adzuna.com.au',
  be: 'https://www.adzuna.be',
  br: 'https://www.adzuna.com.br',
  ca: 'https://www.adzuna.ca',
  ch: 'https://www.adzuna.ch',
  de: 'https://www.adzuna.de',
  es: 'https://www.adzuna.es',
  fr: 'https://www.adzuna.fr',
  in: 'https://www.adzuna.in',
  it: 'https://www.adzuna.it',
  mx: 'https://www.adzuna.com.mx',
  nl: 'https://www.adzuna.nl',
  nz: 'https://www.adzuna.co.nz',
  pl: 'https://www.adzuna.pl',
  sg: 'https://www.adzuna.sg',
  za: 'https://www.adzuna.co.za',
}

const CURRENCY_BY_COUNTRY: Record<AdzunaCountry, string> = {
  gb: 'GBP',
  us: 'USD',
  at: 'EUR',
  au: 'AUD',
  be: 'EUR',
  br: 'BRL',
  ca: 'CAD',
  ch: 'CHF',
  de: 'EUR',
  es: 'EUR',
  fr: 'EUR',
  in: 'INR',
  it: 'EUR',
  mx: 'MXN',
  nl: 'EUR',
  nz: 'NZD',
  pl: 'PLN',
  sg: 'SGD',
  za: 'ZAR',
}

export function isAdzunaCountry(value: unknown): value is AdzunaCountry {
  return typeof value === 'string' && (ADZUNA_COUNTRIES as readonly string[]).includes(value)
}

export function adzunaCountryLabel(country: AdzunaCountry): string {
  return ADZUNA_COUNTRY_LABELS[country] ?? country.toUpperCase()
}

export function adzunaHomeUrl(country: AdzunaCountry): string {
  return ADZUNA_HOME_URLS[country] ?? ADZUNA_HOME_URLS[ADZUNA_DEFAULT_COUNTRY]
}

export function adzunaSalaryCurrency(country: AdzunaCountry): string {
  return CURRENCY_BY_COUNTRY[country] ?? 'USD'
}

// ─── Raw payload → our record ────────────────────────────────────────────────

/** One advert as stored in `external_jobs/`. `source` is a literal so a future feed can coexist. */
export type AdzunaJobRecord = {
  source: 'adzuna'
  sourceId: string
  country: AdzunaCountry
  title: string
  company: string
  location: string
  description: string
  category: string
  contractType?: string
  contractTime?: string
  salaryMin?: number
  salaryMax?: number
  redirectUrl: string
  sourcePostedAt?: string
  fetchedAt: string
}

/** The projection a public page renders. No tracking ids, no raw upstream fields. */
export type ExternalJobCard = {
  id: string
  source: 'adzuna'
  country: AdzunaCountry
  title: string
  company: string
  location: string
  description: string
  category: string
  contractLabel: string
  salaryLabel: string
  postedLabel: string
  postedAt: string
  redirectUrl: string
  attributionUrl: string
}

/**
 * What the browser receives for the member board. The per-advert Adzuna redirect is deliberately
 * not sent: the card presents company hiring details and advertised pay, and the only outbound
 * link is the required 116×23 Adzuna attribution.
 */
export type ExternalJobView = Omit<ExternalJobCard, 'redirectUrl'>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function str(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const lower = code.toLowerCase()
    if (lower.startsWith('#x')) {
      const point = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
    }
    if (lower.startsWith('#')) {
      const point = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
    }
    return NAMED_ENTITIES[lower] ?? entity
  })
}

/**
 * Adzuna descriptions are HTML snippets (`<strong>` around search terms, entities).
 * Strip first, decode second, strip once more: the second pass catches markup that was entity-
 * encoded. React would escape it anyway, but the stored copy should be plain text.
 */
export function externalDescription(value: unknown, max = 700): string {
  const raw = str(value)
  if (!raw) return ''
  const first = raw
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, ' ')
    .replace(/<\s*\/\s*(p|li|div)\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  return decodeEntities(first)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const ALLOWED_ADZUNA_HOSTS = (() => {
  const hosts = new Set<string>(['adzuna.com'])
  for (const url of Object.values(ADZUNA_HOME_URLS)) {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    hosts.add(host)
    hosts.add(`www.${host}`)
  }
  return hosts
})()

/**
 * Adzuna's `redirect_url` is the only link we publish. A malformed or off-network URL is dropped
 * with the advert rather than passed through to an anchor: a feed is untrusted input even when it
 * comes from a partner.
 */
export function safeAdzunaRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:') return ''
    const host = url.hostname.toLowerCase()
    const allowed = [...ALLOWED_ADZUNA_HOSTS].some(
      (candidate) => host === candidate || host.endsWith(`.${candidate.replace(/^www\./, '')}`),
    )
    return allowed ? url.toString() : ''
  } catch {
    return ''
  }
}

function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''
}

function label(value: unknown): string {
  return str(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 48)
}

function clampMoney(value: number): number {
  return Math.max(0, Math.min(100_000_000, Math.round(value)))
}

/** A raw Adzuna result item → the record we store, or null when it cannot be published honestly. */
export function adzunaJobFromRaw(
  raw: unknown,
  country: AdzunaCountry,
  fetchedAt = new Date().toISOString(),
): AdzunaJobRecord | null {
  const item = record(raw)
  if (!item) return null

  const sourceId = str(item.id).trim().slice(0, 80)
  const title = str(item.title).replace(/\s+/g, ' ').trim().slice(0, 140)
  const redirectUrl = safeAdzunaRedirect(item.redirect_url)
  if (!sourceId || !title || !redirectUrl) return null

  const company = record(item.company)
  const location = record(item.location)
  const category = record(item.category)
  const salaryMin = finite(item.salary_min)
  const salaryMax = finite(item.salary_max)
  // `salary_is_predicted` marks a Jobsworth estimate. Omit it unless the required estimate
  // furniture is added; we never present an estimate as a stated salary.
  const predicted = item.salary_is_predicted === true || str(item.salary_is_predicted) === '1'

  const recordOut: AdzunaJobRecord = {
    source: 'adzuna',
    sourceId,
    country,
    title,
    company: str(company?.display_name).replace(/\s+/g, ' ').trim().slice(0, 100) || 'Employer not disclosed',
    location: str(location?.display_name).replace(/\s+/g, ' ').trim().slice(0, 120) || 'Location not specified',
    description: externalDescription(item.description),
    category: str(category?.label).replace(/\s+/g, ' ').trim().slice(0, 60) || 'External role',
    redirectUrl,
    fetchedAt,
  }

  const contractType = label(item.contract_type)
  if (contractType) recordOut.contractType = contractType
  const contractTime = label(item.contract_time)
  if (contractTime) recordOut.contractTime = contractTime

  if (!predicted) {
    if (salaryMin !== null && salaryMin > 0) recordOut.salaryMin = clampMoney(salaryMin)
    if (salaryMax !== null && salaryMax > 0) recordOut.salaryMax = clampMoney(salaryMax)
  }

  const posted = isoDate(item.created)
  if (posted) recordOut.sourcePostedAt = posted

  return recordOut
}

/** Stable Firestore document id. Adzuna ids are opaque; keep them URL-safe and bounded. */
export function externalJobDocId(record: Pick<AdzunaJobRecord, 'country' | 'sourceId'>): string {
  const id = `${record.country}_${record.sourceId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)
  return id || 'invalid'
}

// ─── Formatting for cards ────────────────────────────────────────────────────

export function formatAdzunaSalary(country: AdzunaCountry, min?: number, max?: number): string {
  const currency = adzunaSalaryCurrency(country)
  const format = (value: number) => {
    try {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
        maximumFractionDigits: 0,
      }).format(Math.round(value))
    } catch {
      return `${currency} ${Math.round(value).toLocaleString('en')}`
    }
  }
  if (min && max && min !== max) return `${format(min)} – ${format(max)}`
  if (min || max) return format((min || max) as number)
  return ''
}

export function formatExternalPosted(iso: string, now = Date.now()): string {
  if (!iso) return 'Recently listed'
  const posted = Date.parse(iso)
  if (!Number.isFinite(posted)) return 'Recently listed'
  const days = Math.floor((now - posted) / 86_400_000)
  if (days <= 0) return 'Listed today'
  if (days === 1) return 'Listed yesterday'
  if (days < 14) return `Listed ${days} days ago`
  if (days < 60) return `Listed ${Math.floor(days / 7)} weeks ago`
  return `Listed ${new Date(posted).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })}`
}

/**
 * A stored `external_jobs/` document → the public card, or null.
 *
 * This is the last line of defence between Firestore and the page: it re-validates the redirect,
 * refuses an expired advert and fills every field, so a partially written document cannot render
 * as `undefined`.
 */
export function toExternalJobCard(id: string, raw: unknown, now = Date.now()): ExternalJobCard | null {
  if (!id || id.includes('/')) return null
  const data = record(raw)
  if (!data) return null
  if (data.source !== 'adzuna') return null
  if (!isAdzunaCountry(data.country)) return null

  const expiresAt = isoDate(data.expiresAt)
  if (expiresAt && Date.parse(expiresAt) <= now) return null

  const title = str(data.title).replace(/\s+/g, ' ').trim().slice(0, 140)
  const redirectUrl = safeAdzunaRedirect(data.redirectUrl)
  if (!title || !redirectUrl) return null

  const country = data.country
  const postedAt = isoDate(data.sourcePostedAt)
  const contractLabel = [label(data.contractTime), label(data.contractType)].filter(Boolean).join(' · ')
  const salaryLabel = formatAdzunaSalary(
    country,
    finite(data.salaryMin) ?? undefined,
    finite(data.salaryMax) ?? undefined,
  )

  return {
    id,
    source: 'adzuna',
    country,
    title,
    company: str(data.company).replace(/\s+/g, ' ').trim().slice(0, 100) || 'Employer not disclosed',
    location: str(data.location).replace(/\s+/g, ' ').trim().slice(0, 120) || 'Location not specified',
    description: externalDescription(data.description),
    category: str(data.category).replace(/\s+/g, ' ').trim().slice(0, 60) || 'External role',
    contractLabel,
    salaryLabel,
    postedLabel: formatExternalPosted(postedAt, now),
    postedAt,
    redirectUrl,
    attributionUrl: adzunaHomeUrl(country),
  }
}
