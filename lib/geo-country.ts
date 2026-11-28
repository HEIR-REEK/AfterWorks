/**
 * "Which country is this request coming from?" — answered at the edge, not on the device.
 *
 * The profile form already preselects a country, but it derives it from the **browser's time zone**
 * (`detectCountry` in `lib/countries`). That is the honest signal for a normal member and a useless
 * one for a member on a VPN: the tunnel changes the IP, never the handset's clock. So somebody
 * routed through the United States still reported `Africa/Nairobi` and got handed a Kenyan flag and
 * a `+254` prefix, which is the complaint this module exists to answer.
 *
 * Two sources, in order of authority:
 *
 *  1. **An edge header** (`CF-IPCountry`, `X-Vercel-IP-Country`, `CloudFront-Viewer-Country`). These
 *     are set by the proxy that actually terminates the connection, so they are the closest thing to
 *     the truth available to a request handler — and they cost nothing.
 *  2. **A lookup service**, for a deployment behind a proxy that reports nothing (Render sets no
 *     geo header; this app's `render.yaml` runs there today, and the Cloudflare target would need a
 *     custom request header to forward `CF-IPCountry`). See `lookupCountryByIp`.
 *
 * Deliberately **not** a browser API. Anything client-side sees the same IP the request carried, so
 * it cannot be more accurate than the server; what it can do is leak the member's IP to a third
 * party from their own browser, in an `img`/`fetch` the page cannot audit. One server-side lookup
 * keeps the IP within the deployment and gives the member exactly one thing.
 *
 * Everything here is a **preselection**. A country from an IP is a guess: an office NAT two
 * countries over, a satellite uplink, a corporate egress are all normal and all wrong. The picker
 * stays authoritative, the guess never overwrites a stored value, and a failed lookup returns
 * `null` — never `DEFAULT_COUNTRY` — so an unknown request degrades to today's behaviour rather
 * than to a confidently wrong flag on a form the member then submits.
 */

import { DEFAULT_COUNTRY, isKnownCountry } from '@/lib/countries'

/** Headers a proxy sets to tell us the country it resolved. Lower-case; `Headers.get` is case-insensitive. */
const COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'cloudfront-viewer-country',
  'x-amz-cf-ipcountry',
  'x-geo-country',
] as const

/**
 * Values these headers emit that are **not** countries.
 *
 * `XX` is Cloudflare's "I could not tell", `T1` is a Tor exit node (deliberately unlocatable), and
 * `A1`/`A2` are the anonymous-proxy and satellite-provider buckets. All four must fall through
 * rather than be handed to a picker as if they were somewhere a person could live.
 */
const NON_COUNTRY_CODES = new Set(['XX', 'T1', 'A1', 'A2'])

/**
 * Read the country a trusted proxy reported for this request.
 *
 * Returns `null` when no header is present, when the value is one of the placeholder codes above,
 * and when it names a country the picker cannot format a phone number for — the last case matters
 * because a two-letter code we do not carry would otherwise select a flag nobody has.
 */
export function countryFromHeaders(headers: { get(name: string): string | null }): string | null {
  for (const name of COUNTRY_HEADERS) {
    const raw = headers.get(name)
    if (!raw) continue
    const code = raw.split(',')[0]!.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(code)) continue
    if (NON_COUNTRY_CODES.has(code)) continue
    if (!isKnownCountry(code)) continue
    return code
  }
  return null
}

export type GeoLookupResult = {
  /** ISO-3166 alpha-2, or null when the country could not be established. */
  country: string | null
  /** Which source answered — useful in logs and in the credentials-free case, where nothing did. */
  source: 'header' | 'lookup' | 'none'
}

/**
 * The lookup service, and why it is a variable rather than a constant.
 *
 * `ipapi.co` needs no key and no account, which is what lets this ship before anyone has signed up
 * for a geo plan. But relying on it silently would be wrong: it is a third party receiving member
 * IPs, it rate limits, and it can be down. So the base URL is configuration —
 *
 *   GEOIP_LOOKUP_URL=""                                  disable the lookup, header only (default)
 *   GEOIP_LOOKUP_URL="https://ipapi.co/"                 the credential-free default service
 *   GEOIP_LOOKUP_URL="https://your-geo-proxy.example/"   self-hosted, keeps IPs in your network
 *
 * Whatever is set receives `{base}{ip}/json/`. Nothing is called unless an operator opts in, so a
 * fresh deploy does not start shipping IPs to a third party merely by upgrading.
 */
function lookupBase(): string {
  const raw = (process.env.GEOIP_LOOKUP_URL ?? '').trim()
  if (!raw) return ''
  return raw.endsWith('/') ? raw : `${raw}/`
}

/** Seconds a positive result is cached per IP. */
const LOOKUP_TTL_MS = 12 * 60 * 60 * 1000
const LOOKUP_TIMEOUT_MS = 2_500

/**
 * Bounded cache. Keyed by IP, capped, with the oldest entries evicted first.
 *
 * A profile page load should not cost a network round trip, and a member who reloads the form five
 * times should not cost the lookup service five requests. The cap matters more than the TTL here:
 * without it this is an unbounded map keyed by user-controlled input, which is a memory leak an
 * attacker can drive.
 */
const cache = new Map<string, { country: string; at: number }>()
const CACHE_MAX = 500

function cacheGet(ip: string): string | null {
  const hit = cache.get(ip)
  if (!hit) return null
  if (Date.now() - hit.at > LOOKUP_TTL_MS) {
    cache.delete(ip)
    return null
  }
  return hit.country
}

function cacheSet(ip: string, country: string): void {
  if (cache.size >= CACHE_MAX) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(ip, { country, at: Date.now() })
}

/** Test seam: the suite must not reach the network. */
export function __clearGeoCache(): void {
  cache.clear()
}

/**
 * Pull an ISO-3166 code out of whatever the lookup service answered.
 *
 * Written as a tolerant reader because the response shape is a vendor detail: `ipapi.co` and
 * `ip-api.com` both use `country_code`/`country`, others use `countryCode` or `country_code2`, and
 * a self-hosted proxy will invent its own. Anything unreadable — an error body, an HTML page from a
 * captive portal, a rate-limit message — resolves to `null` rather than throwing.
 */
export function parseLookupCountry(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  // A few services report success in-band; `false`/`fail` must not be read as a country.
  if (record.error === true || record.status === 'fail') return null
  for (const key of ['country_code', 'countryCode', 'country_code2', 'country']) {
    const value = String(record[key] ?? '').trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(value) && isKnownCountry(value)) return value
  }
  return null
}

/**
 * Ask the configured service where an IP is.
 *
 * Never throws: this feeds a form preselection, and a lookup that fails must cost the member a
 * default flag, not a broken profile page. Private and malformed addresses are refused before the
 * request so a local development IP does not become a lookup.
 */
export async function lookupCountryByIp(ip: unknown): Promise<string | null> {
  const address = String(ip ?? '').trim()
  if (!address || address === 'unavailable' || address === 'unknown') return null
  // Only routable addresses: a LAN address (`10.`, `192.168.`, `::1`) says nothing about a country
  // and would only waste a request.
  if (!/^[0-9a-fA-F.:]+$/.test(address)) return null
  if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) return null
  if (address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80')) return null

  const cached = cacheGet(address)
  if (cached) return cached

  const base = lookupBase()
  if (!base) return null

  try {
    const response = await fetch(`${base}${encodeURIComponent(address)}/json/`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    const payload = (await response.json()) as unknown
    const country = parseLookupCountry(payload)
    if (!country) return null
    cacheSet(address, country)
    return country
  } catch {
    return null
  }
}

/**
 * The country this request appears to come from, or `null`.
 *
 * `header` is consulted first and wins: a proxy that already resolved the country is both cheaper
 * and more trustworthy than a second opinion from a third party. The lookup runs only when the
 * operator has configured one and no header answered.
 */
export async function resolveRequestCountry(
  headers: { get(name: string): string | null },
  ip: unknown,
): Promise<GeoLookupResult> {
  const fromHeader = countryFromHeaders(headers)
  if (fromHeader) return { country: fromHeader, source: 'header' }
  const fromLookup = await lookupCountryByIp(ip)
  if (fromLookup) return { country: fromLookup, source: 'lookup' }
  return { country: null, source: 'none' }
}

/**
 * Which country a picker should open on — the whole precedence rule, in one testable place.
 *
 * It lives here rather than inside the component because the rule is the part that can be wrong,
 * and a source-text assertion ("does the provider branch appear above the device branch?") proves
 * nothing about behaviour. Extracting it means every rule below is a real assertion instead.
 *
 * The order, and the reason for each step:
 *
 *  1. **A choice already made wins.** A stored country is a decision; an IP is a guess about a
 *     network. Rewriting somebody's answer is worse than not guessing at all.
 *  2. **A stored number decides its own country.** Re-guessing would silently move the dialling
 *     prefix next to a number the member has already typed and saved.
 *  3. **Wait instead of flashing.** While the provider answer is in flight, answer `null`. Falling
 *     back to the device clock first and correcting a moment later shows a Kenyan flag and `+254`
 *     to exactly the VPN member this exists for.
 *  4. **The provider outranks the device.** The connection follows a VPN; the clock does not.
 *  5. **The device is the fallback**, for the ordinary deployment with no geo source configured.
 *
 * `device` is a thunk so that a provider answer never pays for the clock read, and so a test can
 * prove the fallback was *not* consulted.
 */
export function preselectCountry(input: {
  /** Answer from `/api/geo`, or null when it could not tell. */
  provider: string | null | undefined
  /** The device's own guess, evaluated only if needed. */
  device: () => string | null
  /** True while the provider answer is still being fetched. */
  pending: boolean
  /** What the form already has selected or stored. */
  chosen: string | null | undefined
  /** Anything the member has already typed into the national field. */
  nationalNumber: string | null | undefined
}): { code: string; source: 'provider' | 'device' } | null {
  if (isKnownCountry(input.chosen)) return null
  if (String(input.nationalNumber ?? '').trim()) return null
  if (input.pending) return null

  const provider = String(input.provider ?? '').trim().toUpperCase()
  if (provider && isKnownCountry(provider)) return { code: provider, source: 'provider' }

  const device = String(input.device() ?? '').trim().toUpperCase()
  if (device && isKnownCountry(device)) return { code: device, source: 'device' }

  return null
}

/** True when a saved number's own country should outrank a guess. Exposed for the UI's decision. */
export function shouldPreferDetectedCountry(storedCountry: unknown, storedPhone: unknown): boolean {
  if (isKnownCountry(storedCountry)) return false
  if (String(storedPhone ?? '').trim()) return false
  return true
}

/** The fallback the picker shows when nothing could be established. Never presented as a guess. */
export const FALLBACK_COUNTRY = DEFAULT_COUNTRY
