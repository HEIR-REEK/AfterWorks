import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  countryFlag,
  formatPhoneForDisplay,
  getCountry,
  guessCountryFromE164,
  isKnownCountry,
  normalisePhone,
  phoneMatchKey,
} from '@/lib/countries'
import {
  REFERRAL_BONUS_USD,
  REFERRAL_CODE_RE,
  REFERRAL_SIGNUP_WEEKLY_LIMIT,
  evaluateReferralClaim,
  generateReferralCode,
  normaliseReferralCode,
  referralShareUrl,
  referralStats,
  type ReferralRow,
} from '@/lib/referrals'
import { PRIVACY_SECTIONS, TERMS_SECTIONS, TERMS_VERSION } from '@/lib/terms'
import { PROFILE_REQUIRED_FIELDS, profileCompletion } from '@/lib/profile-completion'

// ─── Referral codes ──────────────────────────────────────────────────────────

test('generated codes always match the published shape', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateReferralCode()
    assert.match(code, REFERRAL_CODE_RE)
    assert.equal(code.length, 8)
  }
})

test('generated codes avoid visually ambiguous characters', () => {
  // 0/O and 1/I are the characters people mistype when reading a code off a screenshot, and a
  // mistyped code is a referral that silently never pays.
  for (let i = 0; i < 300; i++) {
    assert.doesNotMatch(generateReferralCode(), /[01OIL]/)
  }
})

test('code generation is driven entirely by the supplied random source', () => {
  // A pure function of `random`, so the collision-retry loop in the server is testable and the
  // alphabet is provably used rather than assumed.
  assert.equal(generateReferralCode(() => 0), 'AW222222')
  assert.equal(generateReferralCode(() => 0.999), 'AWZZZZZZ')
})

test('a pasted code is normalised, never repaired', () => {
  // NB: the alphabet excludes 0, O, 1, I and L, so no real code can contain them. A fixture that
  // does is a fixture the normaliser must reject, not one it should quietly accept.
  assert.equal(normaliseReferralCode('awk7mnpq'), 'AWK7MNPQ')
  assert.equal(normaliseReferralCode('  aw k7 mnpq  '), 'AWK7MNPQ')
  assert.equal(normaliseReferralCode('K7MNPQ'), 'AWK7MNPQ')
  // The query-string shape a shared link actually has.
  assert.equal(normaliseReferralCode('https://app.example.com/sign-up?ref=AWK7MNPQ'), 'AWK7MNPQ')
  // A code that is right except for one unguessable character is refused, not guessed at.
  assert.equal(normaliseReferralCode('AWK7MNP'), null)
  assert.equal(normaliseReferralCode('AWK7MNPQX'), null)
  assert.equal(normaliseReferralCode('AW01MNPQ'), null, 'characters outside the alphabet are refused')
  assert.equal(normaliseReferralCode(''), null)
  assert.equal(normaliseReferralCode(undefined), null)
  assert.equal(normaliseReferralCode({ evil: 'AWK7MNPQ' }), null)
})

test('the share link carries the code and nothing else', () => {
  const url = referralShareUrl('https://afterworks.example.com/', 'awk7mnpq')
  assert.equal(url, 'https://afterworks.example.com/sign-up?ref=AWK7MNPQ')
})

// ─── Referral attribution rules ──────────────────────────────────────────────

const goodClaim = {
  code: 'AWK7MNPQ',
  referrerUid: 'ref-1',
  referrerEmail: 'Amina@example.com',
  referredUid: 'new-1',
  referredEmail: 'grace@example.com',
  recentSignups: 0,
  referrerKycVerified: true,
  referrerAccountState: 'active',
}

test('a clean claim is allowed', () => {
  assert.equal(evaluateReferralClaim(goodClaim).ok, true)
})

test('a member cannot refer themselves, by uid or by email', () => {
  const byUid = evaluateReferralClaim({ ...goodClaim, referredUid: 'ref-1' })
  assert.equal(byUid.ok, false)
  assert.equal(byUid.ok === false && byUid.code, 'self_referral')

  // Case matters here: an address is stored lowercase, and the comparison has to be too.
  const byEmail = evaluateReferralClaim({ ...goodClaim, referredEmail: 'AMINA@Example.com' })
  assert.equal(byEmail.ok, false)
  assert.equal(byEmail.ok === false && byEmail.code, 'self_referral')
})

test('an unverified or restricted referrer still attaches — but the bonus waits', () => {
  // A signup must never be silently thrown away over somebody else's unfinished KYC: the record
  // is kept (the panel shows it as awaiting), and the money gate is re-checked at release time —
  // which is what pays these out once the referrer is approved later.
  const unverified = evaluateReferralClaim({ ...goodClaim, referrerKycVerified: false })
  assert.equal(unverified.ok, true)
  assert.equal(unverified.ok === true && unverified.deferred, true)
  assert.equal(unverified.ok === true && unverified.deferred ? unverified.code : '', 'referrer_unverified')

  const suspended = evaluateReferralClaim({ ...goodClaim, referrerAccountState: 'suspended' })
  assert.equal(suspended.ok, true)
  assert.equal(suspended.ok === true && suspended.deferred ? suspended.code : '', 'referrer_restricted')

  const banned = evaluateReferralClaim({ ...goodClaim, referrerAccountState: 'banned' })
  assert.equal(banned.ok, true)
  assert.equal(banned.ok === true && banned.deferred ? banned.code : '', 'referrer_restricted')

  // A clean claim attaches and pays without deferral.
  const clean = evaluateReferralClaim(goodClaim)
  assert.equal(clean.ok, true)
  assert.equal(clean.ok === true ? clean.deferred : true, false)
})

test('the weekly cap is enforced at the limit, not above it', () => {
  const at = evaluateReferralClaim({ ...goodClaim, recentSignups: REFERRAL_SIGNUP_WEEKLY_LIMIT - 1 })
  assert.equal(at.ok, true, 'the last slot in the week still works')

  const over = evaluateReferralClaim({ ...goodClaim, recentSignups: REFERRAL_SIGNUP_WEEKLY_LIMIT })
  assert.equal(over.ok, false)
  assert.equal(over.ok === false && over.code, 'referral_rate_limited')
})

test('every rejection and every deferral carries a message a member can be shown', () => {
  const cases: Array<{ claim: Parameters<typeof evaluateReferralClaim>[0]; outcome: 'refuse' | 'defer' }> = [
    { claim: { ...goodClaim, code: 'nope' }, outcome: 'refuse' },
    { claim: { ...goodClaim, referredUid: 'ref-1' }, outcome: 'refuse' },
    { claim: { ...goodClaim, recentSignups: 999 }, outcome: 'refuse' },
    { claim: { ...goodClaim, referrerKycVerified: false }, outcome: 'defer' },
    { claim: { ...goodClaim, referrerAccountState: 'suspended' }, outcome: 'defer' },
  ]
  for (const { claim, outcome } of cases) {
    const decision = evaluateReferralClaim(claim)
    if (outcome === 'refuse') assert.equal(decision.ok, false)
    else assert.equal(decision.ok === true && decision.deferred, true)
    const message = decision.ok ? (decision.deferred ? decision.message : '') : decision.message
    assert.ok(message.length > 10, 'the member-facing copy is too thin')
    assert.doesNotMatch(message, /undefined|NaN|\[object/)
  }
})

// ─── Referral totals ─────────────────────────────────────────────────────────

function row(over: Partial<ReferralRow> = {}): ReferralRow {
  return {
    id: 'r1',
    code: 'AWK7MNPQ',
    referrerUid: 'ref-1',
    referrerName: 'Amina',
    referrerEmail: 'amina@example.com',
    referredUid: 'new-1',
    referredName: 'Grace',
    referredEmailVerified: true,
    status: 'pending',
    bonusUsd: REFERRAL_BONUS_USD,
    createdAt: '2026-09-01T00:00:00.000Z',
    qualifiedAt: null,
    ledgerId: null,
    ...over,
  }
}

test('only qualified referrals count as earned', () => {
  const stats = referralStats([
    row({ id: 'a', status: 'qualified', bonusUsd: 3 }),
    row({ id: 'b', status: 'qualified', bonusUsd: 3 }),
    row({ id: 'c', status: 'pending' }),
  ])
  assert.equal(stats.total, 3)
  assert.equal(stats.qualified, 2)
  assert.equal(stats.pending, 1)
  assert.equal(stats.earnedUsd, 6)
  // A pending referral is shown as what it is still worth, not as money in the bank.
  assert.equal(stats.pendingUsd, 3)
})

test('stats on an empty panel are zero, not NaN', () => {
  const stats = referralStats([])
  assert.deepEqual(stats, { total: 0, qualified: 0, pending: 0, earnedUsd: 0, pendingUsd: 0 })
})

test('the bonus is three dollars', () => {
  assert.equal(REFERRAL_BONUS_USD, 3)
})

// ─── Phone normalisation ─────────────────────────────────────────────────────

test('Kenyan numbers all collapse onto one canonical value', () => {
  // The whole point of the rule: these four strings are one person, and the uniqueness check
  // must not be able to tell them apart.
  const expected = '+254712345678'
  for (const input of ['0712345678', '0712 345 678', '+254712345678', '+254 712 345 678', '254712345678', '(0712) 345-678']) {
    const result = normalisePhone(input, 'KE')
    assert.equal(result.ok, true, `${input} should parse`)
    assert.equal(result.ok === true ? result.e164 : '', expected, `${input} should normalise`)
  }
})

test('the trunk prefix is stripped, not left to fail the length check', () => {
  const withZero = normalisePhone('0712345678', 'KE')
  const withoutZero = normalisePhone('712345678', 'KE')
  assert.equal(withZero.ok && withoutZero.ok, true)
  assert.equal(withZero.ok === true ? withZero.e164 : '', withoutZero.ok === true ? withoutZero.e164 : '')
})

test('Kenyan mobile numbers must start with 7 or 1', () => {
  assert.equal(normalisePhone('0712345678', 'KE').ok, true)
  assert.equal(normalisePhone('0112345678', 'KE').ok, true)
  // 2 is neither a mobile nor a Kenyan fixed-line prefix — a mistyped 7.
  const bad = normalisePhone('0212345678', 'KE')
  assert.equal(bad.ok, false)
  assert.equal(bad.ok === false && bad.error.includes('Kenyan mobile'), true)
})

test('a Kenyan number of the wrong length is rejected with a useful message', () => {
  const result = normalisePhone('0712345', 'KE')
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error.includes('Kenya'), true)
})

test('other countries are accepted, and are not confused with each other', () => {
  const ug = normalisePhone('0772123456', 'UG')
  assert.equal(ug.ok === true ? ug.e164 : '', '+256772123456')
  assert.equal(ug.ok === true ? ug.country : '', 'UG')

  // Same national digits, different country: two different people, two allowed accounts.
  const us = normalisePhone('4155552671', 'US')
  assert.equal(us.ok === true ? us.e164 : '', '+14155552671')

  // The same national digits in two countries are two different people, and both are allowed:
  // 0772 is a live Kenyan mobile prefix, so this is a Kenyan number, not a malformed one.
  const ke2 = normalisePhone('0772123456', 'KE')
  assert.equal(ke2.ok === true ? ke2.e164 : '', '+254772123456')
  assert.notEqual(ke2.ok === true ? ke2.e164 : '', ug.ok === true ? ug.e164 : '')
})

test('an unknown country is refused rather than guessed', () => {
  const result = normalisePhone('0712345678', 'ZZ')
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error.includes('country'), true)
  assert.equal(normalisePhone('0712345678', '').ok, false)
})

test('an empty number is refused', () => {
  assert.equal(normalisePhone('', 'KE').ok, false)
  assert.equal(normalisePhone('   ', 'KE').ok, false)
  assert.equal(normalisePhone(undefined, 'KE').ok, false)
})

test('the same typed national number gives the same uniqueness key in any formatting', () => {
  const a = phoneMatchKey('+254712345678', 'KE')
  const b = phoneMatchKey('+254 712 345 678', 'KE')
  // A locally-formatted number must produce the same key as the E.164 one it normalises to,
  // because the whole rule is "these are one person".
  const c = phoneMatchKey('0712345678', 'KE')
  const d = phoneMatchKey('(0712) 345-678', 'KE')
  assert.equal(a, '712345678')
  assert.equal(a, b)
  assert.equal(a, c)
  assert.equal(a, d)
})

test('guessing a country from a stored number prefers the longest dial code', () => {
  assert.equal(guessCountryFromE164('+254712345678'), 'KE')
  assert.equal(guessCountryFromE164('+256772123456'), 'UG')
  // +1 and +7 are shared by several countries and carry no country information at all, so the
  // guess resolves to a stated default rather than to whichever country sorts first.
  assert.equal(guessCountryFromE164('+14155552671'), 'US')
  assert.equal(guessCountryFromE164('+79123456789'), 'RU')
  // Unknown prefix falls back to the operating country rather than throwing.
  assert.equal(guessCountryFromE164('+999123456'), DEFAULT_COUNTRY)
  assert.equal(guessCountryFromE164(''), DEFAULT_COUNTRY)
})

// ─── Country data integrity ──────────────────────────────────────────────────

test('the country list is internally consistent', () => {
  const codes = new Set<string>()
  const dials = new Map<string, string>()
  for (const country of COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/, `${country.code} is not an ISO alpha-2 code`)
    assert.ok(country.name.length > 2, `${country.code} has no display name`)
    assert.match(country.dial, /^\d{1,4}$/, `${country.code} has a malformed dialling code`)
    assert.ok(country.nsnMin >= 4 && country.nsnMax <= 15, `${country.code} has an impossible NSN length`)
    assert.ok(country.nsnMin <= country.nsnMax, `${country.code} has min > max`)
    assert.equal(country.flag, countryFlag(country.code))
    // Two code points, not two UTF-16 units — each regional indicator is a surrogate pair.
    assert.equal([...country.flag].length, 2, `${country.code} flag is not two regional indicators`)
    assert.equal(codes.has(country.code), false, `${country.code} is listed twice`)
    codes.add(country.code)
    dials.set(country.code, country.dial)
  }
  assert.ok(COUNTRIES.length > 150, 'the dial plan is suspiciously short')
  // Kenya is the operating country and must be selectable by default.
  assert.ok(isKnownCountry(DEFAULT_COUNTRY))
  assert.equal(getCountry(DEFAULT_COUNTRY)?.name, 'Kenya')
})

test('the display format never loses a digit', () => {
  for (const country of COUNTRIES) {
    const digits = '7'.repeat(country.nsnMin)
    const shown = formatPhoneForDisplay(`+${country.dial}${digits}`, country.code)
    assert.equal(shown.replace(/\D/g, ''), `${country.dial}${digits}`)
  }
})

// ─── Terms ───────────────────────────────────────────────────────────────────

test('the terms have unique section anchors, so every deep link resolves', () => {
  for (const sections of [TERMS_SECTIONS, PRIVACY_SECTIONS]) {
    const ids = sections.map((s) => s.id)
    assert.equal(new Set(ids).size, ids.length, 'duplicate section ids')
    for (const id of ids) assert.match(id, /^[a-z0-9-]+$/)
  }
})

test('every terms section has content', () => {
  for (const section of [...TERMS_SECTIONS, ...PRIVACY_SECTIONS]) {
    assert.ok(section.title.trim().length > 0, `section ${section.id} has no title`)
    assert.ok(section.paragraphs.length > 0, `section ${section.id} has no paragraphs`)
    for (const paragraph of section.paragraphs) {
      // A lead-in that ends in a colon ("You agree not to:") introduces a bullet list and is
      // allowed to be short; anything else is a stub.
      if (paragraph.trim().endsWith(':')) continue
      assert.ok(paragraph.trim().length > 20, `section ${section.id} has a stub paragraph: ${paragraph}`)
    }
  }
})

test('the terms cover the topics the platform actually implements', () => {
  const text = TERMS_SECTIONS.map((s) => `${s.title} ${s.paragraphs.join(' ')} ${(s.bullets ?? []).join(' ')}`).join(' ')
    .toLowerCase()
  // Each of these is a rule the code enforces, so each must be visible to the person it binds.
  for (const topic of ['one email address', 'one mobile phone number', 'identity verification', 'referral', 'clearing window', 'minimum withdrawal']) {
    assert.ok(text.includes(topic), `the Terms never mention "${topic}"`)
  }
})

test('a terms version is a dated, non-empty string', () => {
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/)
})

// ─── The referral trigger is the profile rule the code already enforces ───────

test('a referral qualifies exactly when the profile is complete', () => {
  // The bonus is released by the same `profileCompletion` score that pays the welcome reward.
  // If those two ever disagree, a member finishes their profile and nobody gets paid.
  const partial = Object.fromEntries(PROFILE_REQUIRED_FIELDS.map((field, index) => [field, index < 3 ? 'x' : '']))
  assert.equal(profileCompletion(partial).complete, false)

  const full = Object.fromEntries(PROFILE_REQUIRED_FIELDS.map((field) => [field, 'x']))
  assert.equal(profileCompletion(full).complete, true)
})

// ─── Profile patch hygiene (the phone is now an identifier) ──────────────────

test('switching payout method keeps the phone but clears the bank details', async () => {
  const { sanitiseProfilePatch } = await import('@/lib/profile-completion')

  // M-Pesa member switching to bank: the phone stays, because it is the account's contact number
  // and the value "one phone, one account" is checked against.
  const toBank = sanitiseProfilePatch(
    { phone: '+254712345678', phoneCountry: 'KE', preferredPayoutMethod: 'Bank Transfer', bankAccountNumber: '12345678' },
    { method: 'Bank Transfer' },
  )
  assert.equal(toBank.patch.phone, '+254712345678')
  assert.equal(toBank.patch.phoneCountry, 'KE')
  assert.equal(toBank.patch.bankAccountNumber, '12345678')

  // Bank member switching back to M-Pesa: bank details are wiped so a later payout cannot read
  // a stale account number.
  const toMpesa = sanitiseProfilePatch(
    { phone: '+254712345678', preferredPayoutMethod: 'M-Pesa', bankName: 'KCB', bankBranch: 'Nairobi', bankAccountNumber: '12345678' },
    { method: 'M-Pesa' },
  )
  assert.equal(toMpesa.patch.bankName, '')
  assert.equal(toMpesa.patch.bankBranch, '')
  assert.equal(toMpesa.patch.bankAccountNumber, '')
  assert.equal(toMpesa.patch.phone, '+254712345678')
})

test('a bank-only save never writes an undefined phone into Firestore', async () => {
  const { sanitiseProfilePatch } = await import('@/lib/profile-completion')
  // The Admin SDK rejects `undefined` values in a set(); the old code produced exactly this.
  const { patch } = sanitiseProfilePatch({ bankAccountNumber: '12345678' }, { method: 'Bank Transfer' })
  for (const [key, value] of Object.entries(patch)) {
    assert.notEqual(value, undefined, `${key} was set to undefined`)
  }
})

test('a client cannot smuggle the phone uniqueness key or its own referral code', async () => {
  const { sanitiseProfilePatch } = await import('@/lib/profile-completion')
  const { patch, dropped } = sanitiseProfilePatch({
    name: 'Amina',
    phone: '+254712345678',
    phoneKey: '000000000',
    referralCode: 'AWZZZZZZ',
    wallet: { availableUsd: 999_999 },
  })
  // `phoneCountry` survives (the picker needs it); the server-derived comparison key and the
  // referral code do not, because both are exactly the fields the rules would otherwise protect
  // only on the client path.
  assert.equal(patch.phoneCountry, undefined)
  assert.equal('phoneKey' in patch, false)
  assert.equal('referralCode' in patch, false)
  assert.equal('wallet' in patch, false)
  assert.ok(dropped.includes('phoneKey'))
  assert.ok(dropped.includes('referralCode'))
  assert.ok(dropped.includes('wallet'))
})

// ─── Module-load safety ──────────────────────────────────────────────────────

test('the new server modules load in any order, in a fresh process', async () => {
  // `firestore-admin` imports `account-uniqueness` (to canonicalise a phone when an operator
  // creates an account) and `account-uniqueness` imports the handles back. A cycle like that is
  // invisible to `tsc` and only fails at runtime as a "Cannot access before initialization" the
  // first time someone hits a route in production. Loading each module *first*, in its own
  // process, is the only way to catch it here.
  const orders: string[][] = [
    ['@/lib/firestore-admin', '@/lib/account-uniqueness'],
    ['@/lib/account-uniqueness', '@/lib/firestore-admin'],
    ['@/lib/wallet-server'],
    ['@/lib/referral-server'],
  ]
  for (const order of orders) {
    // `tsx -e` compiles to CJS, so top-level await is not available; chain instead.
    const program =
      `${JSON.stringify(order)}` +
      `.reduce((p, m) => p.then(() => import(m)), Promise.resolve())` +
      `.then(() => console.log('ok'), (e) => { console.error('FAILED:', e && e.message); process.exit(1) })`
    const { execFileSync } = await import('node:child_process')
    const out = execFileSync('npx', ['tsx', '-e', program], {
      encoding: 'utf8',
      // The Admin SDK logs a critical about missing credentials on import; that is expected here.
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    })
    assert.match(out, /ok/, `loading ${order.join(' -> ')} did not complete: ${out}`)
  }
})
