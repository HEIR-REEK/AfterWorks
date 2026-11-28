import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  FALLBACK_COUNTRY,
  __clearGeoCache,
  countryFromHeaders,
  parseLookupCountry,
  preselectCountry,
  resolveRequestCountry,
  shouldPreferDetectedCountry,
} from '@/lib/geo-country'
import { isKnownCountry } from '@/lib/countries'

/**
 * The profile form preselects a phone country. It used to do that from the browser's IANA time
 * zone, which is the honest answer for a normal member and the wrong one for a member on a VPN:
 * a tunnel changes the IP, never the handset's clock. A member routed through the US still
 * reported `Africa/Nairobi` and was handed a Kenyan flag and a `+254` prefix.
 *
 * Two failure modes are pinned here, and they are not the same bug:
 *
 *   1. **A placeholder read as a country.** `CF-IPCountry` emits `XX` when it cannot tell and `T1`
 *      for a Tor exit. Preselecting "country XX" would put a nameless flag on the form.
 *   2. **A failed lookup silently becoming Kenya.** `DEFAULT_COUNTRY` is the right *fallback for
 *      display*; it is the wrong *answer*. A guess of `KE` for a member in Ohio is worse than an
 *      empty picker, because the member may submit it without noticing.
 */

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name) => lower.get(name.toLowerCase()) ?? null }
}

// ─── Edge headers ───────────────────────────────────────────────────────────

test('the country a proxy resolved is read, and Cloudflare spelling wins over the rest', () => {
  assert.equal(countryFromHeaders(headers({ 'cf-ipcountry': 'US' })), 'US')
  assert.equal(countryFromHeaders(headers({ 'x-vercel-ip-country': 'UG' })), 'UG')
  assert.equal(countryFromHeaders(headers({ 'cloudfront-viewer-country': 'TZ' })), 'TZ')
  // Precedence: a CDN header is more authoritative than a generic one.
  assert.equal(countryFromHeaders(headers({ 'cf-ipcountry': 'US', 'x-vercel-ip-country': 'KE' })), 'US')
})

test('placeholders are not countries and must not reach the picker', () => {
  // Cloudflare's "unknown", Tor, and the anonymous-proxy / satellite buckets.
  for (const code of ['XX', 'T1', 'A1', 'A2']) {
    assert.equal(countryFromHeaders(headers({ 'cf-ipcountry': code })), null, `${code} was accepted as a country`)
  }
})

test('a code the picker cannot format is refused rather than selected', () => {
  // A well-formed ISO code we do not carry would otherwise select a flag with no dialling code.
  assert.equal(countryFromHeaders(headers({ 'cf-ipcountry': 'ZZ' })), null)
  // Junk, empty and malformed values fall through instead of being uppercased into a country.
  assert.equal(countryFromHeaders(headers({ 'cf-ipcountry': 'U' })), null)
  assert.equal(countryFromHeaders(headers({ 'cf-ipcountry': 'USA' })), null)
  assert.equal(countryFromHeaders(headers({ 'cf-ipcountry': '' })), null)
  assert.equal(countryFromHeaders(headers({})), null)
})

test('a header list is read from its first entry, which is the client it belongs to', () => {
  assert.equal(countryFromHeaders(headers({ 'cf-ipcountry': 'us, KE' })), 'US')
})

// ─── Lookup service ─────────────────────────────────────────────────────────

test('the lookup reader tolerates every shape a geo service actually returns', () => {
  assert.equal(parseLookupCountry({ country_code: 'US' }), 'US')
  assert.equal(parseLookupCountry({ countryCode: 'ug' }), 'UG')
  assert.equal(parseLookupCountry({ country_code2: 'TZ' }), 'TZ')
  assert.equal(parseLookupCountry({ country: 'ke' }), 'KE')
})

test('an error body from the lookup service is not read as a country', () => {
  // ip-api answers `{status: 'fail', message: 'reserved range'}` with HTTP 200.
  assert.equal(parseLookupCountry({ status: 'fail', country: 'Kenya' }), null)
  assert.equal(parseLookupCountry({ error: true, country_code: 'KE' }), null)
  // A captive portal answers HTML; `response.json()` would have thrown, this must not.
  assert.equal(parseLookupCountry(null), null)
  assert.equal(parseLookupCountry('Kenya'), null)
  assert.equal(parseLookupCountry({}), null)
  // `country` carrying a *name* rather than a code is not a code.
  assert.equal(parseLookupCountry({ country: 'United States' }), null)
  assert.equal(parseLookupCountry({ country: 'ZZ' }), null)
})

test('with no lookup service configured, the answer is "unknown", never the default country', async () => {
  delete process.env.GEOIP_LOOKUP_URL
  __clearGeoCache()
  // No header and no service: the honest result.
  const result = await resolveRequestCountry(headers({}), '8.8.8.8')
  assert.equal(result.country, null, 'a failed lookup must not fall back to KE')
  assert.equal(result.source, 'none')
  // The display fallback still exists, but it is a separate value the caller opts into.
  assert.equal(FALLBACK_COUNTRY, 'KE')
  assert.notEqual(result.country, FALLBACK_COUNTRY)
})

test('a private or malformed address is refused before any request is made', async () => {
  process.env.GEOIP_LOOKUP_URL = 'http://127.0.0.1:9/' // deliberately unroutable
  __clearGeoCache()
  for (const ip of ['10.0.0.1', '192.168.1.5', '172.16.0.1', '127.0.0.1', '::1', 'unknown', 'unavailable', '', 'not-an-ip']) {
    const result = await resolveRequestCountry(headers({}), ip)
    assert.equal(result.country, null, `${ip} should not have been looked up`)
  }
  delete process.env.GEOIP_LOOKUP_URL
})

test('the header short-circuits the lookup service entirely', async () => {
  // If this called out, the test would hang until the 2.5s timeout: the base is unroutable.
  process.env.GEOIP_LOOKUP_URL = 'http://127.0.0.1:9/'
  __clearGeoCache()
  const result = await resolveRequestCountry(headers({ 'cf-ipcountry': 'US' }), '8.8.8.8')
  assert.deepEqual(result, { country: 'US', source: 'header' })
  delete process.env.GEOIP_LOOKUP_URL
})

// ─── Precedence over what the member already has ────────────────────────────

test('a guess never outranks something the member already chose', () => {
  // A stored country is a decision. An IP is a guess about a network.
  assert.equal(shouldPreferDetectedCountry('UG', ''), false)
  // A stored *number* also decides its own country: re-guessing it would silently move the prefix.
  assert.equal(shouldPreferDetectedCountry('', '+256712345678'), false)
  // Only a genuinely blank profile is open to a preselection.
  assert.equal(shouldPreferDetectedCountry('', ''), true)
  assert.equal(shouldPreferDetectedCountry(null, undefined), true)
})

// ─── Wiring ─────────────────────────────────────────────────────────────────

test('the provider answer wins over the device clock — the VPN case, as behaviour', () => {
  // This is the whole point of the change. A member on a US VPN: the server says US, the handset
  // still says Africa/Nairobi. Asserting the *order of two lines in a file* proved nothing — an
  // injected device-first regression passed that check. This asserts the outcome.
  let deviceConsulted = false
  const pick = preselectCountry({
    provider: 'US',
    device: () => {
      deviceConsulted = true
      return 'KE'
    },
    pending: false,
    chosen: '',
    nationalNumber: '',
  })
  assert.deepEqual(pick, { code: 'US', source: 'provider' })
  assert.equal(deviceConsulted, false, 'the clock must not even be read when the connection answered')
})

test('with no provider answer, the device is the fallback', () => {
  const pick = preselectCountry({
    provider: null,
    device: () => 'UG',
    pending: false,
    chosen: '',
    nationalNumber: '',
  })
  assert.deepEqual(pick, { code: 'UG', source: 'device' })
})

test('while the answer is in flight, nothing is preselected — no flash of the wrong flag', () => {
  let deviceConsulted = false
  const pick = preselectCountry({
    provider: null,
    device: () => {
      deviceConsulted = true
      return 'KE'
    },
    pending: true,
    chosen: '',
    nationalNumber: '',
  })
  assert.equal(pick, null, 'guessing from the clock first is the bug, not a head start')
  assert.equal(deviceConsulted, false)
})

test('a choice, a stored number or a half-typed one all outrank a guess', () => {
  const base = { provider: 'US', device: () => 'KE', pending: false }
  // Already chosen.
  assert.equal(preselectCountry({ ...base, chosen: 'UG', nationalNumber: '' }), null)
  // Already typing.
  assert.equal(preselectCountry({ ...base, chosen: '', nationalNumber: '712' }), null)
  // Whitespace is not typing.
  assert.deepEqual(preselectCountry({ ...base, chosen: '', nationalNumber: '   ' }), { code: 'US', source: 'provider' })
})

test('a provider value the picker cannot use falls through instead of being trusted', () => {
  const base = { device: () => 'KE', pending: false, chosen: '', nationalNumber: '' }
  // `XX`/`T1` cannot get here through the header reader, but a self-hosted lookup proxy could
  // still return one, and the rule must not select a country that has no dialling code.
  assert.deepEqual(preselectCountry({ ...base, provider: 'XX' }), { code: 'KE', source: 'device' })
  assert.deepEqual(preselectCountry({ ...base, provider: 'ZZ' }), { code: 'KE', source: 'device' })
  assert.deepEqual(preselectCountry({ ...base, provider: '' }), { code: 'KE', source: 'device' })
  assert.deepEqual(preselectCountry({ ...base, provider: 'us' }), { code: 'US', source: 'provider' })
})

test('the attribution line names the right source, so the member knows what we assumed', () => {
  const input = readFileSync('components/phone-input.tsx', 'utf8')
  assert.match(input, /from your connection/)
  assert.match(input, /from this device/)
})

test('the geo route is authenticated and rate limited', () => {
  const route = readFileSync('app/api/geo/route.ts', 'utf8')
  assert.match(route, /requireUser\(req\)/, 'an unauthenticated geo fan-out is an amplification target')
  assert.match(route, /consumeBucket\('geo-country'/, 'lookups must be rate limited per member')
  assert.match(route, /private, max-age=60/, 'a per-member answer must not enter a shared cache')
})

test('nothing client-side asks a third party for the IP directly', () => {
  // The whole point of doing this server-side: a browser call would leak the member's IP from
  // their own machine, in a request the page cannot audit.
  const hook = readFileSync('components/use-detected-country.ts', 'utf8')
  assert.match(hook, /fetch\('\/api\/geo'/, 'the client should ask our own route')
  assert.doesNotMatch(hook, /https?:\/\/(?!www\.w3\.org)/, 'the hook must not call an external host')
})

test('the lookup service stays opt-in, so upgrading does not start shipping IPs', () => {
  const source = readFileSync('lib/geo-country.ts', 'utf8')
  // Empty base = no request. Asserted by the default, not by documentation.
  assert.match(source, /if \(!base\) return null/)
  assert.match(source, /GEOIP_LOOKUP_URL/)
  // The cache is bounded: it is keyed by a caller-influenced value.
  assert.match(source, /CACHE_MAX/)
})

test('every country this module can return is one the picker can format', () => {
  for (const code of ['US', 'KE', 'GB', 'UG', 'TZ']) {
    assert.ok(isKnownCountry(code), `${code} must exist in the picker`)
  }
})
