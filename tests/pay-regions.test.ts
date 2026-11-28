import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { COUNTRIES } from '@/lib/countries'
import {
  PAY_REGIONS,
  countriesInRegion,
  isRegionalPayComplete,
  payForRegion,
  payRangeForCard,
  regionForCountry,
  resolveWorkerRegion,
  validateRegionalPay,
  type RegionalPay,
} from '@/lib/pay-regions'

/**
 * Pay varies by where a worker is: the Americas, Europe and Asia are priced above Africa because
 * the cost of living is not the same. The requirement is simple and the implementation is not,
 * because "where a worker is" has two candidate answers and only one of them is safe to pay on.
 *
 * The dangerous version — detecting the country from the request IP — looks correct and is not:
 * the IP is the client's egress, it is free to change, and payment is snapshotted at apply time and
 * credited at approval. A member in Nairobi on a US VPN applies at the US rate, turns the tunnel
 * off, does the work, and is paid the US rate as a perfectly ordinary application. So these tests
 * pin the rule that the *verified* country decides, and that the IP is not consulted at all.
 */

// ─── Region mapping ─────────────────────────────────────────────────────────

test('the four regions map the countries people actually live in', () => {
  const expectations: [string, string][] = [
    ['US', 'Americas'], ['CA', 'Americas'], ['BR', 'Americas'], ['MX', 'Americas'],
    ['GB', 'Europe'], ['DE', 'Europe'], ['FR', 'Europe'], ['PL', 'Europe'],
    ['JP', 'Asia'], ['IN', 'Asia'], ['CN', 'Asia'], ['PH', 'Asia'], ['SG', 'Asia'], ['AE', 'Asia'],
    ['KE', 'Africa'], ['NG', 'Africa'], ['ZA', 'Africa'], ['UG', 'Africa'], ['TZ', 'Africa'], ['GH', 'Africa'],
  ]
  for (const [code, region] of expectations) {
    assert.equal(regionForCountry(code), region, `${code} should price as ${region}`)
  }
})

test('every country the picker offers can be priced — no silent holes', () => {
  // A country in the phone picker but not in any region would fall to the default silently, and a
  // member in it would be priced by accident rather than by decision.
  const mapped = new Set(PAY_REGIONS.flatMap((region) => countriesInRegion(region)))
  const unmapped = COUNTRIES.map((c) => c.code).filter((code) => !mapped.has(code))
  assert.deepEqual(unmapped, [], `these countries have no region: ${unmapped.join(', ')}`)
})

test('every region lists every code as a country, and no country sits in two regions', () => {
  const seen = new Map<string, string>()
  for (const region of PAY_REGIONS) {
    for (const code of countriesInRegion(region)) {
      assert.match(code, /^[A-Z]{2}$/)
      const previous = seen.get(code)
      assert.equal(previous, undefined, `${code} is in both ${previous} and ${region}`)
      seen.set(code, region)
    }
  }
})

test('an unknown or missing country falls to Africa, which is the cheaper mistake', () => {
  // Overpaying a low-cost region is what drains a budget; underpaying a high-cost one is a
  // complaint. When we do not know, we take the recoverable direction.
  for (const value of [null, undefined, '', 'ZZ', 'not-a-country', 0]) {
    assert.equal(regionForCountry(value), 'Africa')
  }
  // Case and whitespace are not a reason to mis-price somebody.
  assert.equal(regionForCountry('  us '), 'Americas')
})

// ─── Which country decides ──────────────────────────────────────────────────

test('the verified country outranks everything — this is the anti-VPN rule', () => {
  // The scenario the whole design exists for: a member whose ID says Kenya, on a US VPN. There is
  // no IP argument here at all, which is the point: the decision cannot see the VPN.
  const resolved = resolveWorkerRegion({
    verifiedCountry: 'KE',
    payoutCountry: 'KE',
    declaredCountry: 'US',
  })
  assert.deepEqual(resolved, { region: 'Africa', basis: 'verified', country: 'KE' })
})

test('a verified American in America gets the American rate', () => {
  // The feature working as asked: genuinely being in the US is worth the US price.
  const resolved = resolveWorkerRegion({ verifiedCountry: 'US', declaredCountry: 'KE' })
  assert.equal(resolved.region, 'Americas')
  assert.equal(resolved.basis, 'verified')
})

test('with no verified country, the payout destination decides', () => {
  // An M-Pesa destination is Kenyan by construction, so the money can only land in Kenya.
  const resolved = resolveWorkerRegion({ payoutCountry: 'KE', declaredCountry: 'US' })
  assert.deepEqual(resolved, { region: 'Africa', basis: 'destination', country: 'KE' })
})

test('the self-declared country is the last resort, and is labelled as such', () => {
  // Editable by the member, so it must never be presented as verified evidence.
  const resolved = resolveWorkerRegion({ declaredCountry: 'US' })
  assert.deepEqual(resolved, { region: 'Americas', basis: 'declared', country: 'US' })
})

test('nothing known at all is Africa on the declared basis, never a crash', () => {
  assert.deepEqual(resolveWorkerRegion({}), { region: 'Africa', basis: 'declared', country: '' })
  // Junk in every field is treated as nothing known.
  assert.deepEqual(
    resolveWorkerRegion({ verifiedCountry: 'ZZ', payoutCountry: '', declaredCountry: '??' }),
    { region: 'Africa', basis: 'declared', country: '' },
  )
})

test('the pricing path never reads the request IP', () => {
  // The one assertion that makes the rest safe. If geo detection ever reaches the money path, the
  // VPN problem comes back and this is what should fail first.
  const source = readFileSync('lib/pay-regions.ts', 'utf8')
  // Assert the *imports*, not the prose: the module documents why it does not use the IP detector,
  // and a substring check over the whole file fails on that explanation.
  const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n')
  assert.doesNotMatch(imports, /geo-country/, 'pay-regions must not import the IP detector')
  assert.doesNotMatch(imports, /countryFromHeaders|resolveRequestCountry|next\/server/)

  const admin = readFileSync('lib/firestore-admin.ts', 'utf8')
  const start = admin.indexOf('export async function createApplicationServer(')
  const body = admin
    .slice(start, start + 6_000)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
  assert.doesNotMatch(body, /geo-country|countryFromHeaders/, 'the pay snapshot must not be IP-derived')
  assert.match(body, /resolveWorkerRegion/, 'the snapshot should come from the verified region')
})

// ─── What a card pays ───────────────────────────────────────────────────────

const card = (payAmountUsd: number, payByRegion?: RegionalPay) => ({ payAmountUsd, payByRegion })

test('a card with no regional table pays its scalar everywhere, exactly as before', () => {
  for (const region of PAY_REGIONS) {
    assert.equal(payForRegion(card(18), region), 18, `${region} should be unchanged for a legacy card`)
  }
})

test('a regional table prices each region from its own number', () => {
  const priced = card(18, { Africa: 6, Americas: 34, Europe: 30, Asia: 14 })
  assert.equal(payForRegion(priced, 'Africa'), 6)
  assert.equal(payForRegion(priced, 'Americas'), 34)
  assert.equal(payForRegion(priced, 'Europe'), 30)
  assert.equal(payForRegion(priced, 'Asia'), 14)
})

test('a missing region falls back to the default, never to zero', () => {
  // "The admin forgot a region" must not become "this member worked for nothing".
  const partial = card(18, { Africa: 6, default: 20 })
  assert.equal(payForRegion(partial, 'Americas'), 20)
  // And with neither an entry nor a default, the legacy scalar is still paid rather than nothing.
  assert.equal(payForRegion(card(18, { Africa: 6 }), 'Europe'), 18)
  assert.equal(payForRegion(card(18, { Africa: 6 }), 'Europe') > 0, true)
})

test('a zero or negative regional price is ignored rather than paid', () => {
  const broken = card(18, { Africa: 0, Americas: -5, default: -1 } as RegionalPay)
  assert.equal(payForRegion(broken, 'Africa'), 18)
  assert.equal(payForRegion(broken, 'Americas'), 18)
})

test('the console can show the spread on a card', () => {
  assert.deepEqual(payRangeForCard(card(18, { Africa: 6, Americas: 34, Europe: 30, Asia: 14 })), { min: 6, max: 34 })
  assert.deepEqual(payRangeForCard(card(18)), { min: 18, max: 18 })
})

// ─── Validating what an admin types ─────────────────────────────────────────

test('a complete table is accepted', () => {
  const result = validateRegionalPay({ Africa: 6, Americas: 34, Europe: 30, Asia: 14 })
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.deepEqual(result.value, { Africa: 6, Americas: 34, Europe: 30, Asia: 14 })
  assert.equal(isRegionalPayComplete(result.value), true)
})

test('a partial table without a default is refused, because it silently under-prices', () => {
  // The failure this prevents: Africa priced at 6, everything else falling back to a $40 scalar.
  const result = validateRegionalPay({ Africa: 6 })
  assert.equal(result.ok, false)
  assert.match(result.errors.join(' '), /default/i)
})

test('a partial table WITH a default is fine', () => {
  const result = validateRegionalPay({ Africa: 6, default: 30 })
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.equal(result.value?.default, 30)
})

test('the regions priced the wrong way round are flagged', () => {
  // A transposed digit here is a real overpayment across every application in that region.
  const wrong = validateRegionalPay({ Africa: 40, Americas: 6, Europe: 30, Asia: 14 })
  assert.equal(wrong.ok, false)
  assert.match(wrong.errors.join(' '), /Africa is priced above/)
})

test('out-of-range and non-numeric prices are refused with a readable reason', () => {
  for (const bad of [{ Africa: 'six' }, { Africa: 0 }, { Africa: 0.1 }, { Africa: 20_000 }]) {
    const result = validateRegionalPay({ ...bad, default: 10 })
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should be refused`)
    assert.ok(result.errors.length > 0)
  }
  // Not an object at all.
  assert.equal(validateRegionalPay([1, 2, 3]).ok, false)
  assert.equal(validateRegionalPay('cheap').ok, false)
  // Absent is not an error — it means "this card is not regionally priced".
  assert.deepEqual(validateRegionalPay(null), { ok: true, value: null, errors: [] })
})

test('prices are rounded to cents, so a stored price never has a third decimal', () => {
  const result = validateRegionalPay({ Africa: 6.005, default: 30 })
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.equal(result.value?.Africa, 6.01)
})

// ─── The wiring that makes it real ──────────────────────────────────────────

test('the pay snapshot carries its own evidence onto the application', () => {
  // A dispute three months later asks "why was this person on this rate?" — the application has to
  // answer without re-deriving it from a profile that has since been edited.
  const admin = readFileSync('lib/firestore-admin.ts', 'utf8')
  assert.match(admin, /payRegion: pricing\.region/)
  assert.match(admin, /payRegionBasis: pricing\.basis/)
  assert.match(admin, /payRegionCountry: pricing\.country/)
  assert.match(admin, /payAmountUsd: pricing\.amountUsd/)
})

test('the region is stamped at KYC approval, and a blank re-approval does not erase it', () => {
  const admin = readFileSync('lib/firestore-admin.ts', 'utf8')
  assert.match(admin, /verifiedCountry: stampedCountry/)
  // The conditional spread is the guard: re-approving without a country must not wipe the first one.
  assert.match(admin, /\.\.\.\(stampedCountry \? \{ verifiedCountry: stampedCountry \} : \{\}\)/)
  // And an unpriced country is refused rather than stored.
  assert.match(admin, /isKnownCountry\(rawCountry\)/)
})

test('the console sends the country it confirmed', () => {
  const route = readFileSync('app/api/admin/users/route.ts', 'utf8')
  assert.match(route, /payload\.country/, 'the KYC action must carry the verified country')
  assert.match(route, /verifyKycAdmin\(uid, approve, reason, guard\.value\.email, verifiedCountry\)/)
})

test('an M-Pesa destination attests Kenya, because the payout rule only accepts Kenyan numbers', () => {
  const payouts = readFileSync('lib/payouts.ts', 'utf8')
  assert.match(payouts, /country: 'KE'/)
})

test('the board and the payout agree on the price, or a member sees one number and is paid another', () => {
  // The catalogue read must carry `payByRegion` through normalisation, or the card renders its
  // legacy scalar while the server prices the application regionally.
  const catalogue = readFileSync('lib/job-catalogue.ts', 'utf8')
  assert.match(catalogue, /regionalPayFrom\(data\.payByRegion\)/)
  const source = readFileSync('lib/job-catalogue.ts', 'utf8')
  assert.match(source, /function regionalPayFrom/)
})
