import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  countryFlag,
  detectCountryFromLocale,
  detectCountryFromTimeZone,
  isKnownCountry,
  normalisePhone,
  phoneMatchKey,
} from '@/lib/countries'
import { resolveIdleGuardConfig } from '@/components/idle-session-guard'
import { readFile } from 'node:fs/promises'

// ─── Flags ───────────────────────────────────────────────────────────────────

test('a flag is one emoji made of two regional indicators, and only one', () => {
  assert.equal(countryFlag('KE'), '\u{1F1F0}\u{1F1EA}')
  assert.equal(countryFlag('UG'), '\u{1F1FA}\u{1F1EC}')
  assert.equal(countryFlag('GB'), '\u{1F1EC}\u{1F1E7}')
  // An unknown ISO code must not render a half-formed flag.
  assert.equal(countryFlag('XX'), '\u{1F3F3}\u{FE0F}')
  assert.equal(countryFlag(''), '\u{1F3F3}\u{FE0F}')
})

test('every country in the picker carries a flag, so none renders blank', () => {
  for (const country of COUNTRIES) {
    assert.ok(country.flag.length >= 2, `${country.code} has no flag`)
    assert.notEqual(country.flag, '\u{1F3F3}\u{FE0F}', `${country.code} fell back to the placeholder`)
  }
})

// ─── The double flag ─────────────────────────────────────────────────────────

test('the country pickers render one flag per option, never an overlaid second one', async () => {
  const source = await readFile('components/phone-input.tsx', 'utf8')
  // The regression: a native <select> paints the selected option's own text, so an absolutely
  // positioned <span> holding the same emoji put two flags side by side on screen.
  assert.doesNotMatch(source, /absolute[^"]*"\s*aria-hidden[^"]*">\s*\{/, 'a flag is still overlaid on the control')
  assert.doesNotMatch(source, /\{\s*(current|meta|c)\.flag\s*\}\s*<\/span>/, 'a flag is still rendered in its own span')
  // The dialling code is shown once, as the non-editable prefix next to the number, so the option
  // label carries the flag and the name only.
  assert.doesNotMatch(source, /\{c\.flag\}\s*\{c\.name\}\s*\+\{c\.dial\}/, 'the dial code is back inside the option label')
  // …and it is still shown.
  assert.match(source, /\+\{meta\.dial\}/, 'the +dial prefix next to the number is gone')
})

// ─── Detection ───────────────────────────────────────────────────────────────

test('a time zone resolves to the country a member is actually standing in', () => {
  assert.equal(detectCountryFromTimeZone('Africa/Nairobi'), 'KE')
  assert.equal(detectCountryFromTimeZone('Africa/Kampala'), 'UG')
  assert.equal(detectCountryFromTimeZone('Africa/Dar_es_Salaam'), 'TZ')
  assert.equal(detectCountryFromTimeZone('Africa/Johannesburg'), 'ZA')
  assert.equal(detectCountryFromTimeZone('Europe/London'), 'GB')
  assert.equal(detectCountryFromTimeZone('Asia/Tokyo'), 'JP')
  assert.equal(detectCountryFromTimeZone('America/Sao_Paulo'), 'BR')
  assert.equal(detectCountryFromTimeZone('Australia/Sydney'), 'AU')
})

test('detection answers null rather than guessing, so a blank form is never quietly labelled', () => {
  // Not in the dial plan we support, not in the table, and not in the list at all.
  assert.equal(detectCountryFromTimeZone('Pacific/Apia'), null)
  assert.equal(detectCountryFromTimeZone('Nowhere/Special'), null)
  assert.equal(detectCountryFromTimeZone(''), null)
  assert.equal(detectCountryFromTimeZone(null), null)
  // In the table but a country we cannot format a number for: still null, never DEFAULT_COUNTRY.
  assert.equal(detectCountryFromTimeZone('Asia/Hong_Kong'), null)
  assert.equal(detectCountryFromTimeZone('Europe/Nice'), null)
  // An unlisted African zone must not inherit Kenya.
  assert.equal(detectCountryFromTimeZone('Africa/Bissau'), null)
})

test('the locale is a fallback, and only when the region is one we can dial', () => {
  assert.equal(detectCountryFromLocale('en-KE'), 'KE')
  assert.equal(detectCountryFromLocale('sw-UG'), 'UG')
  assert.equal(detectCountryFromLocale('en_KE'), 'KE')
  // A bare language must not be *maximised* into a country: `fr` is not proof of France.
  assert.equal(detectCountryFromLocale('fr'), null)
  assert.equal(detectCountryFromLocale(''), null)
  assert.equal(detectCountryFromLocale('en-HK'), null)
})

test('detection can only ever return a country the picker can format a number for', () => {
  for (const zone of Object.keys({ 'Africa/Nairobi': 1, 'Asia/Tokyo': 1, 'Europe/London': 1 })) {
    const guess = detectCountryFromTimeZone(zone)
    assert.ok(guess && isKnownCountry(guess), `${zone} produced ${guess}`)
  }
  assert.ok(isKnownCountry(DEFAULT_COUNTRY))
})

// ─── The idle guard ──────────────────────────────────────────────────────────

test('the idle guard defaults to ten minutes, and the warning never eats the whole window', () => {
  const fallback = resolveIdleGuardConfig(undefined)
  assert.equal(fallback.enabled, true)
  assert.equal(fallback.timeoutMs, 10 * 60_000)
  assert.equal(fallback.warningMs, 60_000)
  assert.ok(fallback.warningMs < fallback.timeoutMs, 'the countdown must leave time to act')

  // A short override: the countdown is halved rather than eating the entire budget.
  const short = resolveIdleGuardConfig('2')
  assert.equal(short.timeoutMs, 2 * 60_000)
  assert.ok(short.warningMs <= short.timeoutMs / 2)

  // Out-of-band values are clamped, not obeyed.
  assert.equal(resolveIdleGuardConfig('0.2').timeoutMs, 1 * 60_000)
  assert.equal(resolveIdleGuardConfig('9999').timeoutMs, 120 * 60_000)
  assert.equal(resolveIdleGuardConfig('9999').warningMs, 60_000)

  // Nonsense falls back to the default rather than locking anybody out on a typo.
  for (const bad of ['', '   ', 'ten', 'NaN', '-1']) {
    assert.equal(resolveIdleGuardConfig(bad).timeoutMs, 10 * 60_000, `${JSON.stringify(bad)} changed the timeout`)
  }

  // 0 is the documented "switch it off" value, and it must actually switch it off.
  assert.equal(resolveIdleGuardConfig('0').enabled, false)
  assert.equal(resolveIdleGuardConfig(' 0 ').enabled, false, 'whitespace around 0 must not read as "unset"')
  // An env var that is present but blank is *absent*, not a request to disable the guard.
  assert.equal(resolveIdleGuardConfig('').enabled, true)
})

test('the idle budget starts when the session does, not when the app mounted', async () => {
  const source = await readFile('components/idle-session-guard.tsx', 'utf8')
  // The guard is mounted for the whole app, so a member who read the sign-in page for ten minutes
  // and only then signed in would be signed straight back out without this reset.
  assert.match(source, /lastActivity\.current = Date\.now\(\)\n\s*setRemainingMs\(null\)/)
  // And it must not run where it would reload an operator's console without ending their session.
  assert.match(source, /inConsole = pathname\.startsWith\('\/admin'\)/)
  assert.match(source, /if \(!user \|\| !config\.enabled \|\| inConsole\) return/)
})

test('the idle guard signs out and reloads rather than only refreshing', async () => {
  const source = await readFile('components/idle-session-guard.tsx', 'utf8')
  assert.match(source, /signOutRef\.current\(\)/, 'the guard no longer ends the Firebase session')
  // A soft refresh would leave the in-memory account visible on the unattended screen.
  assert.match(source, /window\.location\.replace\(/)
  assert.doesNotMatch(source, /router\.refresh\(\)/)
})

// ─── Regression guard for the numbers it touched ─────────────────────────────

test('detection does not disturb phone normalisation or the uniqueness key', () => {
  const ke = normalisePhone('0712345678', 'KE')
  assert.ok(ke.ok)
  assert.equal(ke.ok && ke.e164, '+254712345678')
  assert.equal(phoneMatchKey('+254 712 345 678'), phoneMatchKey('0712 345 678'))
  assert.equal(phoneMatchKey('+254712345678', detectCountryFromTimeZone('Africa/Nairobi')!), '712345678')
})
