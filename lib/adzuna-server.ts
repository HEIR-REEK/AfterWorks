/**
 * Server-only Adzuna API client.
 *
 * Credentials never leave this module. The public route reads the *stored* feed, so a page render
 * cannot call Adzuna with the app key, and the browser never receives the key, a signed URL or an
 * upstream error body.
 *
 * API notes that matter here:
 *  • `GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}` — page starts at 1, at most 50
 *    results per page.
 *  • There is no Kenya country code. `ADZUNA_COUNTRY` must be one of `ADZUNA_COUNTRIES`; an invalid
 *    value fails closed rather than being forwarded.
 *  • 410 means authorisation failed, not "gone". It is mapped to an operator-actionable error.
 */

import { env, envInt } from '@/lib/security-core'
import {
  ADZUNA_DEFAULT_COUNTRY,
  adzunaJobFromRaw,
  isAdzunaCountry,
  type AdzunaCountry,
  type AdzunaJobRecord,
} from '@/lib/adzuna'

const ADZUNA_BASE_URL = 'https://api.adzuna.com/v1/api/jobs'
const REQUEST_TIMEOUT_MS = 15_000
export const ADZUNA_MAX_PAGES = 5
export const ADZUNA_RESULTS_PER_PAGE = 50

export type AdzunaErrorCode =
  | 'not_configured'
  | 'invalid_country'
  | 'unauthorised'
  | 'rate_limited'
  | 'upstream_error'
  | 'invalid_response'

export class AdzunaError extends Error {
  readonly code: AdzunaErrorCode

  constructor(code: AdzunaErrorCode, message: string) {
    super(message)
    this.name = 'AdzunaError'
    this.code = code
  }
}

export type AdzunaConfiguration = {
  configured: boolean
  appIdPresent: boolean
  appKeyPresent: boolean
  country: AdzunaCountry
}

function credentialPresent(value: string): boolean {
  const trimmed = value.trim()
  return Boolean(trimmed) && !/^(your_|replace|changeme|xxx)/i.test(trimmed)
}

/** Which credentials are present — never their values. Safe to return to the console. */
export function adzunaConfiguration(): AdzunaConfiguration {
  const appId = env('ADZUNA_APP_ID')
  const appKey = env('ADZUNA_APP_KEY')
  const configuredCountry = env('ADZUNA_COUNTRY').trim().toLowerCase()
  return {
    configured: credentialPresent(appId) && credentialPresent(appKey),
    appIdPresent: credentialPresent(appId),
    appKeyPresent: credentialPresent(appKey),
    country: isAdzunaCountry(configuredCountry) ? configuredCountry : ADZUNA_DEFAULT_COUNTRY,
  }
}

export function isAdzunaConfigured(): boolean {
  return adzunaConfiguration().configured
}

export type AdzunaSearchPage = {
  /** Adzuna's total across all pages, useful for showing "showing 100 of 1,240". */
  count: number
  jobs: AdzunaJobRecord[]
}

type SearchInput = {
  country: AdzunaCountry
  page: number
  what?: string
  where?: string
  resultsPerPage?: number
  maxDaysOld?: number
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * One upstream search page.
 *
 * The response body is parsed defensively: `results` must be an array, and each item is normalised
 * independently so one malformed advert does not discard a whole page.
 */
export async function searchAdzunaJobs(input: SearchInput): Promise<AdzunaSearchPage> {
  const { country } = input
  if (!isAdzunaCountry(country)) {
    throw new AdzunaError('invalid_country', `Adzuna does not support the country code "${String(country)}".`)
  }
  const appId = env('ADZUNA_APP_ID').trim()
  const appKey = env('ADZUNA_APP_KEY').trim()
  if (!credentialPresent(appId) || !credentialPresent(appKey)) {
    throw new AdzunaError(
      'not_configured',
      'Adzuna is not configured. Set ADZUNA_APP_ID and ADZUNA_APP_KEY in the server environment.',
    )
  }

  const page = clampInt(input.page, 1, 50)
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(clampInt(input.resultsPerPage ?? ADZUNA_RESULTS_PER_PAGE, 1, 50)),
    sort_by: 'date',
  })
  const what = (input.what ?? '').trim().slice(0, 80)
  const where = (input.where ?? '').trim().slice(0, 80)
  if (what) params.set('what', what)
  if (where) params.set('where', where)
  const maxDaysOld = clampInt(input.maxDaysOld ?? envInt('ADZUNA_MAX_DAYS_OLD', 30), 1, 90)
  params.set('max_days_old', String(maxDaysOld))

  let response: Response
  try {
    response = await fetch(`${ADZUNA_BASE_URL}/${country}/search/${page}?${params.toString()}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    console.warn('[Adzuna] search request failed:', err instanceof Error ? err.name : 'network error')
    throw new AdzunaError('upstream_error', 'The external job source did not respond. Try again shortly.')
  }

  if (response.status === 410) {
    throw new AdzunaError(
      'unauthorised',
      'Adzuna rejected the credentials. Check ADZUNA_APP_ID / ADZUNA_APP_KEY and the plan attached to them.',
    )
  }
  if (response.status === 429) {
    throw new AdzunaError('rate_limited', 'Adzuna is rate limiting this key. Wait a minute and retry.')
  }
  if (!response.ok) {
    console.warn('[Adzuna] search returned HTTP', response.status)
    throw new AdzunaError('upstream_error', `The external job source returned HTTP ${response.status}.`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new AdzunaError('invalid_response', 'The external job source returned an unreadable response.')
  }

  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const rawResults = Array.isArray(body.results) ? body.results : []
  const fetchedAt = new Date().toISOString()
  const jobs = rawResults
    .map((item) => adzunaJobFromRaw(item, country, fetchedAt))
    .filter((job): job is AdzunaJobRecord => Boolean(job))
  const count = Number(body.count)

  return {
    count: Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : jobs.length,
    jobs,
  }
}
