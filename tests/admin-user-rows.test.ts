import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adminUserDetailFromDoc,
  adminUserRowFromDoc,
  coerceIsoTimestamp,
  maskPayoutHandle,
} from '@/lib/admin-domain'

/**
 * The console crash this file is named after.
 *
 * A `users/{uid}` document is not guaranteed to be a profile. The phone-claim guard, the terms
 * acceptance write and the referral index all use `set(..., { merge: true })`, so a stub document —
 * no name, no email, no `wallet` — can sit in the directory. Clicking one of those rows threw
 * `Cannot read properties of undefined (reading 'availableUsd')` from the detail drawer and
 * replaced the whole console with the error boundary.
 *
 * The fix is a projection applied on both sides of the wire, so these tests are about one promise:
 * *any* input produces a row and a detail payload whose every field is present and typed.
 */

// ─── The reported failure ────────────────────────────────────────────────────

test("a stub document still yields a readable wallet — the reported 'availableUsd' crash", () => {
  // Exactly what a partial write leaves behind: a doc id and nothing a profile would have.
  const stub = { termsAcceptedAt: '2026-01-04T09:00:00.000Z', termsVersion: '2026-01' }

  const detail = adminUserDetailFromDoc({ uid: 'stub-uid-1', ...stub })

  // This is the expression that used to throw inside the drawer.
  assert.equal(detail.wallet.availableUsd, 0)
  assert.equal(detail.wallet.pendingUsd, 0)
  assert.equal(detail.wallet.payoutNumberMasked, '')
  assert.doesNotThrow(() => `${detail.wallet.availableUsd}`.toString())
})

test('every document shape the drawer can be handed produces a complete row', () => {
  const inputs: unknown[] = [
    undefined,
    null,
    {},
    { uid: 'only-a-uid' },
    { wallet: 'not-an-object' },
    { wallet: [] },
    { wallet: null },
    { wallet: { pendingUsd: 'nonsense', availableUsd: Number.NaN } },
    { name: 42, email: { toString: () => 'x' } },
    { accountState: null, qualityScore: 'abc', jobsCompleted: undefined },
  ]

  for (const input of inputs) {
    const detail = adminUserDetailFromDoc(input)
    assert.equal(typeof detail.wallet.availableUsd, 'number')
    assert.equal(typeof detail.wallet.pendingUsd, 'number')
    assert.equal(typeof detail.wallet.payoutNumberMasked, 'string')
    assert.equal(typeof detail.uid, 'string')
    assert.equal(typeof detail.name, 'string')
    assert.equal(typeof detail.email, 'string')
    assert.equal(typeof detail.accountState, 'string')
    assert.equal(typeof detail.role, 'string')
    assert.equal(typeof detail.qualityScore, 'number')
    assert.equal(typeof detail.jobsCompleted, 'number')
    assert.equal(typeof detail.paidTrainingsCount, 'number')
    assert.equal(typeof detail.kycVerified, 'boolean')
    assert.equal(typeof detail.profileIncomplete, 'boolean')
    assert.match(detail.accountState, /^active$/)
  }
})

// ─── The blank row, explained ────────────────────────────────────────────────

test('a nameless, emailless document is flagged as an incomplete record, not rendered as an empty line', () => {
  const row = adminUserRowFromDoc('ghost', { phone: '+254712345678', phoneKey: '254712345678' })
  assert.equal(row.name, '')
  assert.equal(row.email, '')
  assert.equal(row.profileIncomplete, true)

  // The phone is still there — it is the reason the stub exists (a claim on the number).
  assert.equal(row.phoneMasked, '••••••5678')
})

test('a real member is never flagged incomplete, and defaults survive a missing document body', () => {
  const row = adminUserRowFromDoc('u1', { name: 'Amina Otieno', email: 'amina@example.com' })
  assert.equal(row.profileIncomplete, false)
  assert.equal(row.accountState, 'active')
  assert.equal(row.role, 'user')
  assert.equal(row.qualityScore, 100)
  assert.equal(row.jobsCompleted, 0)
  assert.equal(row.wallet.availableUsd, 0)

  // An email alone is enough to describe somebody: no false "incomplete" badge for phone-only sign-ups.
  assert.equal(adminUserRowFromDoc('u2', { email: 'b@example.com' }).profileIncomplete, false)
  assert.equal(adminUserRowFromDoc('u3', { name: '  ' }).profileIncomplete, true)
})

test('legacy documents keep their existing fields and gain the new ones', () => {
  const row = adminUserRowFromDoc('legacy', {
    name: 'Old Row',
    email: 'old@example.com',
    wallet: { pendingUsd: 12.5, availableUsd: 80 },
    paidTrainings: ['a', 'b'],
    country: 'Kenya',
    updatedAt: '2026-02-01T10:00:00.000Z',
  })
  assert.equal(row.wallet.pendingUsd, 12.5)
  assert.equal(row.wallet.availableUsd, 80)
  assert.equal(row.paidTrainingsCount, 2)
  assert.equal(row.lastActiveAt, '2026-02-01T10:00:00.000Z')
  assert.equal(row.country, 'Kenya')
})

test('staff flag and blank strings do not leak into the row', () => {
  assert.equal(adminUserRowFromDoc('a', { isAdmin: true, role: 'user' }).role, 'admin')
  assert.equal(adminUserRowFromDoc('a', { role: 'admin' }).role, 'admin')
  assert.equal(adminUserRowFromDoc('a', { kycStatus: '' }).kycStatus, undefined)
  assert.equal(adminUserRowFromDoc('a', { country: '   ' }).country, undefined)
})

// ─── Timestamps ──────────────────────────────────────────────────────────────

test('timestamps are accepted as ISO strings, Dates, Admin SDK Timestamps and their JSON leftovers', () => {
  const iso = '2026-03-01T08:30:00.000Z'
  assert.equal(coerceIsoTimestamp(iso), iso)
  assert.equal(coerceIsoTimestamp(new Date(iso)), iso)
  // firebase-admin `Timestamp` exposes toDate(); JSON.stringify turns it into {_seconds,…}
  assert.equal(coerceIsoTimestamp({ toDate: () => new Date(iso) }), iso)
  assert.equal(coerceIsoTimestamp({ _seconds: Date.parse(iso) / 1000, _nanoseconds: 0 }), iso)
  assert.equal(coerceIsoTimestamp({ seconds: Date.parse(iso) / 1000 }), iso)

  for (const nothing of [undefined, null, '', '   ', {}, [], new Date('nope'), { toDate: () => 'x' }, { _seconds: 0 }]) {
    assert.equal(coerceIsoTimestamp(nothing), null)
  }
})

test("a serverTimestamp() left in the document no longer renders as 'Invalid Date'", () => {
  const row = adminUserRowFromDoc('ts', { createdAt: { _seconds: 1_770_000_000, _nanoseconds: 0 } })
  assert.ok(row.createdAt)
  assert.notEqual(new Date(row.createdAt as string).toLocaleDateString(), 'Invalid Date')
})

// ─── The drawer payload ──────────────────────────────────────────────────────

test('the payout handle travels masked — the raw number stays on the server', () => {
  const detail = adminUserDetailFromDoc({
    uid: 'u1',
    name: 'Amina',
    email: 'amina@example.com',
    wallet: { pendingUsd: 0, availableUsd: 10, payoutNumber: '+254712345678' },
  })
  assert.equal(detail.wallet.payoutNumberMasked, '••••••5678')
  assert.equal(detail.payoutNumberMasked, '••••••5678')
  assert.equal('payoutNumber' in detail.wallet, false)
  assert.equal(JSON.stringify(detail).includes('+254712345678'), false)
})

test('fields the drawer prints are coerced, so a bad document cannot crash React', () => {
  const detail = adminUserDetailFromDoc({
    uid: 'u1',
    // `{...}` here used to reach JSX and throw "Objects are not valid as a React child".
    moderationReason: { nested: true },
    walletNote: 12,
    skills: ['Boda delivery', 7, null],
    languages: 'Swahili',
    rating: 'four',
    jobsApplied: 3,
  })
  assert.equal(detail.moderationReason, undefined)
  assert.equal(detail.walletNote, '12')
  assert.deepEqual(detail.skills, ['Boda delivery', '7'])
  assert.equal(detail.languages, undefined)
  assert.equal(detail.rating, undefined)
  assert.equal(detail.jobsApplied, 3)
})

test('undescribed document fields are not forwarded to the browser', () => {
  const detail = adminUserDetailFromDoc({
    uid: 'u1',
    name: 'Amina',
    internalNotes: 'do not ship',
    payoutNumber: '+254700000000',
    bank: { accountNumber: '0123456789', bankName: 'Equity' },
  })
  assert.equal('internalNotes' in detail, false)
  assert.equal('payoutNumber' in detail, false)
  assert.equal(JSON.stringify(detail).includes('0123456789'), false)
  assert.equal(detail.bank?.bankName, 'Equity')
  assert.equal(detail.bank?.accountNumber, '••••6789')
})

test('the drawer knobs the console switches on are present as booleans', () => {
  const detail = adminUserDetailFromDoc({ uid: 'u1', welcomeBonusPending: 'yes', signupBonusGranted: true })
  assert.equal(detail.welcomeBonusPending, undefined) // only a real `true` counts
  assert.equal(detail.signupBonusGranted, true)
})

// ─── The browser boundary ────────────────────────────────────────────────────

test('the console client normalises the API response: a stub from the server still opens', async () => {
  const { adminApi } = await import('@/lib/admin')
  const originalFetch = globalThis.fetch
  // What GET /api/admin/users?uid=… used to answer for a stub document: no wallet, no name.
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        user: { uid: 'stub-uid', termsAcceptedAt: '2026-01-04T09:00:00.000Z', termsVersion: '2026-01' },
        account: { exists: false, disabled: false, emailVerified: false, createdAt: null, lastSignInAt: null, providers: [], orphaned: true },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch

  try {
    const data = await adminApi.userDetail('stub-uid')
    // Verbatim what the drawer evaluates — the line from the bug report.
    assert.equal(data.user.wallet.availableUsd, 0)
    assert.equal(data.user.wallet.pendingUsd, 0)
    assert.equal(data.user.profileIncomplete, true)
    assert.equal(data.user.uid, 'stub-uid')
    assert.equal(data.account?.exists, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ─── Sharing story ───────────────────────────────────────────────────────────

test('maskPayoutHandle never returns a full handle and copes with anything', () => {
  assert.equal(maskPayoutHandle('+254712345678'), '••••••5678')
  assert.equal(maskPayoutHandle('0712345678'), '••••5678')
  assert.equal(maskPayoutHandle('123'), '')
  assert.equal(maskPayoutHandle(undefined), '')
  assert.equal(maskPayoutHandle({}), '')
})
