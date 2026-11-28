import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  PAYOUT_METHODS,
  PAYABLE_PAYOUT_METHODS,
  describeDestination,
  isPayoutMethodPayable,
  isValidPayPalEmail,
  mapPayoutRequest,
  maskEmail,
  payoutMethodPendingNote,
  validatePayoutDestination,
  type PayoutDestination,
} from '@/lib/payouts'
import { sanitiseProfilePatch } from '@/lib/profile-completion'
import { payoutDestinationState } from '@/lib/wallet-server'

/**
 * PayPal is being added as a *withdrawal surface* only — the member can record where the money
 * should go, but no disbursement integration exists yet.
 *
 * That split creates two ways to lose money, and both are about defaults:
 *
 *   1. An unrecognised method silently becoming M-Pesa. The old validator read
 *      `methodValue === 'Bank Transfer' ? 'Bank Transfer' : 'M-Pesa'`, so a member who chose PayPal
 *      would have had the money sent to mobile money instead. A wrong destination is worse than a
 *      refusal.
 *   2. A request that is accepted (taking the amount out of the spendable balance) for a method
 *      that can never be sent, leaving it stuck until an operator refunds it by hand.
 *
 * These tests pin both, plus the detail-clearing and masking that protect the address itself.
 */

const read = (path: string) => readFileSync(path, 'utf8')

const NAME = 'Amina Wanjiru'

// ─── Method vocabulary ──────────────────────────────────────────────────────

test('PayPal is storable but not yet payable — the split is explicit', () => {
  assert.ok((PAYOUT_METHODS as readonly string[]).includes('PayPal'))
  assert.ok(!(PAYABLE_PAYOUT_METHODS as readonly string[]).includes('PayPal'))
  assert.equal(isPayoutMethodPayable('PayPal'), false)
  assert.equal(isPayoutMethodPayable('M-Pesa'), true)
  assert.equal(isPayoutMethodPayable('Bank Transfer'), true)
})

test('a not-yet-payable method explains itself instead of failing silently', () => {
  const note = payoutMethodPendingNote('PayPal')
  assert.ok(note && /not switched on yet/i.test(note))
  assert.match(note!, /M-Pesa or a bank account/, 'the note must say what the member can do today')
  // Payable methods carry no note.
  assert.equal(payoutMethodPendingNote('M-Pesa'), null)
  assert.equal(payoutMethodPendingNote('Bank Transfer'), null)
})

// ─── The coercion bug ───────────────────────────────────────────────────────

test('an unknown method is refused, never coerced to M-Pesa', () => {
  for (const method of ['PayPal ', 'BITCOIN', 'bank transfer', '', undefined, null, 42]) {
    const result = validatePayoutDestination({ method, accountName: NAME, phone: '0712345678' })
    assert.equal(result.ok, false, `method ${JSON.stringify(method)} must not validate`)
  }
})

test('M-Pesa and bank destinations still validate exactly as before', () => {
  const mpesa = validatePayoutDestination({ method: 'M-Pesa', accountName: NAME, phone: '0712345678' })
  assert.equal(mpesa.ok, true)
  if (mpesa.ok) {
    assert.equal(mpesa.destination.method, 'M-Pesa')
    assert.equal(mpesa.destination.accountNumber, '0712345678')
    assert.equal(mpesa.destination.paypalEmail, '', 'an M-Pesa destination carries no PayPal address')
  }

  const bank = validatePayoutDestination({
    method: 'Bank Transfer',
    accountName: NAME,
    bankName: 'Equity',
    bankBranch: 'Nyeri',
    bankAccountNumber: '0123456789',
  })
  assert.equal(bank.ok, true)
  if (bank.ok) assert.equal(bank.destination.paypalEmail, '')
})

// ─── PayPal address validation ──────────────────────────────────────────────

test('a PayPal address must be a plausible email, because the address IS the account', () => {
  for (const good of ['amina@example.com', 'amina.wanjiru@mail.co.ke', 'a@b.io']) {
    assert.equal(isValidPayPalEmail(good), true, `${good} should be accepted`)
  }
  for (const bad of [
    'amina',
    'amina@',
    '@example.com',
    'amina@example',
    'amina example@mail.com',
    'amina@@example.com',
    '',
    '   ',
    'a'.repeat(300) + '@example.com',
  ]) {
    assert.equal(isValidPayPalEmail(bad), false, `${JSON.stringify(bad)} should be rejected`)
  }
})

test('a PayPal destination requires the address and clears every other field', () => {
  const missing = validatePayoutDestination({ method: 'PayPal', accountName: NAME })
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.equal(missing.field, 'paypalEmail')

  const invalid = validatePayoutDestination({ method: 'PayPal', accountName: NAME, paypalEmail: 'nope' })
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.match(invalid.error, /valid PayPal email/)

  const ok = validatePayoutDestination({
    method: 'PayPal',
    accountName: NAME,
    paypalEmail: '  Amina@Example.com  ',
    // Stale details from a previous method must not survive into a PayPal destination.
    bankName: 'Equity',
    bankAccountNumber: '0123456789',
    phone: '0712345678',
  })
  assert.equal(ok.ok, true)
  if (!ok.ok) return
  assert.equal(ok.destination.paypalEmail, 'amina@example.com', 'address is normalised to lower case')
  assert.equal(ok.destination.bankName, '')
  assert.equal(ok.destination.bankAccountNumber, '')
  assert.equal(ok.destination.accountNumber, '')
})

test('an account holder name is still required for PayPal (it must match the verified ID)', () => {
  const result = validatePayoutDestination({ method: 'PayPal', accountName: 'A', paypalEmail: 'a@b.co' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.field, 'accountName')
})

// ─── Masking ────────────────────────────────────────────────────────────────

test('a PayPal address is masked for display but recognisable', () => {
  assert.equal(maskEmail('amina.wanjiru@gmail.com'), 'a' + '•'.repeat(12) + '@gmail.com')
  assert.match(maskEmail('ab@outlook.com'), /^a•{3}@outlook\.com$/)
  // A short local part must not leak in full.
  assert.equal(maskEmail('a@b.io'), 'a•••@b.io')
  // Something that is not an address is returned unchanged rather than mangled.
  assert.equal(maskEmail('not-an-email'), 'not-an-email')
  assert.equal(maskEmail(''), '')
})

test('describeDestination names the method and masks by default', () => {
  const destination: PayoutDestination = {
    method: 'PayPal',
    accountName: NAME,
    accountNumber: '',
    bankName: '',
    bankBranch: '',
    bankAccountNumber: '',
    paypalEmail: 'amina.wanjiru@gmail.com',
  }
  assert.match(describeDestination(destination), /^PayPal · a••+@gmail\.com$/)
  assert.doesNotMatch(describeDestination(destination), /amina\.wanjiru/)
  // The unmasked form is available for the member's own receipt.
  assert.equal(describeDestination(destination, { masked: false }), 'PayPal · amina.wanjiru@gmail.com')
})

test('an older document without a method still maps to a known one', () => {
  const legacy = mapPayoutRequest('p1', { status: 'pending', accountName: NAME, accountNumber: '0712345678' })
  assert.equal(legacy.destination.method, 'M-Pesa')
  assert.equal(legacy.destination.paypalEmail, '')

  const paypal = mapPayoutRequest('p2', {
    status: 'pending',
    method: 'PayPal',
    accountName: NAME,
    paypalEmail: 'amina@example.com',
  })
  assert.equal(paypal.destination.method, 'PayPal', 'a stored PayPal request must not read back as M-Pesa')
  assert.equal(paypal.destination.paypalEmail, 'amina@example.com')
})

// ─── Profile details cannot describe two destinations at once ───────────────

test('switching method clears the fields that belong to the other methods', () => {
  const toPaypal = sanitiseProfilePatch({
    preferredPayoutMethod: 'PayPal',
    paypalEmail: 'a@b.com',
    bankName: 'Equity',
    bankBranch: 'Nyeri',
    bankAccountNumber: '0123456789',
  })
  assert.equal(toPaypal.patch.paypalEmail, 'a@b.com')
  assert.equal(toPaypal.patch.bankName, '')
  assert.equal(toPaypal.patch.bankAccountNumber, '')

  const toMpesa = sanitiseProfilePatch({ preferredPayoutMethod: 'M-Pesa', paypalEmail: 'a@b.com' })
  assert.equal(toMpesa.patch.paypalEmail, '', 'an M-Pesa member must not keep a PayPal address on file')

  const toBank = sanitiseProfilePatch({
    preferredPayoutMethod: 'Bank Transfer',
    paypalEmail: 'a@b.com',
    bankName: 'Equity',
  })
  assert.equal(toBank.patch.paypalEmail, '')
  assert.equal(toBank.patch.bankName, 'Equity', 'bank details survive a switch TO bank')
})

test('paypalEmail is an accepted profile field, not silently dropped', () => {
  const result = sanitiseProfilePatch({ paypalEmail: 'keep@me.com' }, { method: 'PayPal' })
  assert.equal(result.patch.paypalEmail, 'keep@me.com')
  assert.ok(!result.dropped.includes('paypalEmail'))
})

// ─── Destination state shown in the wallet ─────────────────────────────────

test('the wallet tells a PayPal member the truth: details saved, payout not live', () => {
  const state = payoutDestinationState({
    name: NAME,
    preferredPayoutMethod: 'PayPal',
    paypalEmail: 'amina@example.com',
  })
  assert.equal(state.method, 'PayPal')
  assert.equal(state.ready, true, 'the details are valid, so the destination is ready')
  assert.ok(state.notYetPayable, 'but the method cannot be paid yet, and the UI must say so')
  assert.match(state.notYetPayable!, /not switched on yet/i)
  assert.match(state.label, /^PayPal · /)
})

test('a payable destination carries no "not yet" note', () => {
  const mpesa = payoutDestinationState({ name: NAME, preferredPayoutMethod: 'M-Pesa', phone: '0712345678' })
  assert.equal(mpesa.ready, true)
  assert.equal(mpesa.notYetPayable, null)

  const bank = payoutDestinationState({
    name: NAME,
    preferredPayoutMethod: 'Bank Transfer',
    bankName: 'Equity',
    bankBranch: 'Nyeri',
    bankAccountNumber: '0123456789',
  })
  assert.equal(bank.ready, true)
  assert.equal(bank.notYetPayable, null)
})

test('an incomplete PayPal profile reports the missing field, not a fake destination', () => {
  const state = payoutDestinationState({ name: NAME, preferredPayoutMethod: 'PayPal' })
  assert.equal(state.ready, false)
  assert.equal(state.method, 'PayPal')
  assert.ok(state.problem && /PayPal account/i.test(state.problem))
})

// ─── The withdraw gate ──────────────────────────────────────────────────────

test('the withdraw path refuses a not-yet-payable method BEFORE holding any money', () => {
  const source = read('lib/wallet-server.ts')
  const start = source.indexOf('const destinationCheck = validatePayoutDestination(')
  assert.ok(start > 0, 'the withdraw path should validate its destination')
  const block = source.slice(start, start + 1800)

  // The refusal must precede the balance mutation.
  const refusal = block.indexOf('isPayoutMethodPayable')
  const hold = block.indexOf('payoutHoldUsd')
  assert.ok(refusal > 0, 'a not-yet-payable method must be refused')
  assert.ok(hold > 0, 'the hold is applied on this path')
  assert.ok(refusal < hold, 'the refusal must come before the amount is taken out of the balance')

  // And the request row carries the PayPal address so the console can see it.
  assert.match(source, /paypalEmail: destinationCheck\.destination\.paypalEmail/)
})

test('the withdraw path passes paypalEmail into validation', () => {
  const source = read('lib/wallet-server.ts')
  assert.match(source, /paypalEmail: data\.paypalEmail/, 'without this, a PayPal profile can never validate')
})

// ─── Presentation layer ─────────────────────────────────────────────────────

test('every method has presentation copy, including the one that is not live', async () => {
  const { PAYOUT_METHOD_PRESENTATION, payoutMethodPresentation } = await import('@/lib/payouts')
  for (const method of PAYOUT_METHODS) {
    const entry = PAYOUT_METHOD_PRESENTATION[method]
    assert.ok(entry, `${method} is missing presentation copy`)
    assert.ok(entry.label.length > 0)
    assert.ok(entry.destinationNoun.length > 0, `${method} needs a noun for "paid to your …"`)
    assert.ok(entry.description.length > 20, `${method} needs a real description`)
    // The payable flag must agree with the single source of truth.
    assert.equal(entry.payable, isPayoutMethodPayable(method), `${method} payable flag disagrees`)
  }
  // The PayPal copy reads as ordinary payout copy now. The caveat still exists — but it is the
  // *server's* job to enforce it (see the settlement gate below), not a badge's job to advertise it.
  assert.doesNotMatch(
    PAYOUT_METHOD_PRESENTATION.PayPal.description,
    /not (live|switched on)/i,
    'the member-facing description should not carry a status caveat',
  )
  // An unknown stored value falls back rather than rendering undefined.
  assert.equal(payoutMethodPresentation('Bitcoin').method, 'M-Pesa')
  assert.equal(payoutMethodPresentation(undefined).method, 'M-Pesa')
})

test('no page re-implements the two-method ternary that mislabels PayPal', () => {
  // The bug shape: `method === 'Bank Transfer' ? X : Y` reads as "bank, else M-Pesa" and quietly
  // dresses PayPal as mobile money. Payment pages must go through the shared helpers instead.
  for (const file of ['components/withdraw-panel.tsx', 'app/admin/payouts/page.tsx']) {
    const source = read(file)
    // The bug shape is in the ELSE branch: `method === 'Bank Transfer' ? <Landmark/> : <Smartphone/>`
    // means "bank, else M-Pesa", so PayPal silently wears the M-Pesa icon. Detect the ternary and
    // then look at what follows the colon.
    const ternary = /===\s*'Bank Transfer'(?![\s\S]{0,200}?selected\.destination\.bankAccountNumber)\s*\?[\s\S]{0,160}?:\s*(?:<Smartphone|'M-Pesa')/g
    const offenders = [...source.matchAll(ternary)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 90))
    assert.deepEqual(
      offenders,
      [],
      `${file} still branches two ways on the payout method, which renders PayPal as M-Pesa:\n${offenders.join('\n')}`,
    )
    assert.match(source, /PayoutMethodIcon/, `${file} should use the shared icon`)
  }
})

test('the console can copy a PayPal address, and says the request cannot be paid', () => {
  const admin = read('app/admin/payouts/page.tsx')
  // A PayPal destination has no account number: "copy account number" would copy "".
  assert.match(admin, /Copy PayPal email/)
  assert.match(admin, /selected\.destination\.paypalEmail/)
  // The warning banner is gone from the console, so the refusal has to live in the transition
  // itself — asserted separately in the settlement-gate tests. What still has to hold here is that
  // the console shows the PayPal address, not an empty account number.
  assert.doesNotMatch(admin, /PayPal payouts are not live/)
})

test('the wallet paints no "not live" badge beside the payout method', () => {
  const panel = read('components/withdraw-panel.tsx')
  assert.doesNotMatch(panel, /Not live/, 'the wallet badge was removed on request')
  assert.doesNotMatch(panel, />\s*Not live\s*</)
  // The method is still named through the shared helper — removing the badge must not cost the
  // member the ability to see where the money is going.
  assert.match(panel, /<PayoutMethodIcon method=\{payouts\.destination\.method\}/)
  assert.match(panel, /\{payouts\.destination\.label\}/)
})

test('the profile shows one description per method and a labelled summary', () => {
  const profile = read('app/profile/page.tsx')
  assert.match(profile, /payoutMethodPresentation\(formData\.preferredPayoutMethod\)\.description/)
  assert.match(profile, /payoutMethodPresentation\(worker\.preferredPayoutMethod\)\.label/)
  // PayPal gains an email field, and it is only sent when PayPal is the chosen method.
  assert.match(profile, /value=\{formData\.paypalEmail\}/)
  assert.match(profile, /paypalEmail: formData\.preferredPayoutMethod === 'PayPal' \? formData\.paypalEmail\.trim\(\) : ''/)
})

test('the wallet summary agrees with the destination panel about the method', () => {
  // `walletMeta.preferredPayoutMethod` had its own copy of the two-method coercion, so a PayPal
  // member saw "M-Pesa" in the summary and "PayPal" in the panel on the same page.
  const source = read('lib/wallet-server.ts')
  const start = source.indexOf('preferredPayoutMethod:')
  const line = source.slice(start, start + 400)
  assert.doesNotMatch(
    line,
    /=== 'Bank Transfer' \? 'Bank Transfer' : 'M-Pesa'/,
    'the wallet summary must not coerce every non-bank method to M-Pesa',
  )
  assert.match(line, /PAYOUT_METHODS/)
})

// ─── The settlement gate (server, not just the button) ──────────────────────

test('a method that cannot be paid is never offered the "paid" move', async () => {
  const { availablePayoutStatuses, PAYOUT_STATUSES } = await import('@/lib/payouts')
  for (const from of PAYOUT_STATUSES) {
    const moves = availablePayoutStatuses(from, 'PayPal')
    assert.ok(!moves.includes('paid'), `a PayPal request in ${from} must not offer "paid"`)
    // But the escapes stay open: a request that cannot be sent must still be closable, or the
    // member's money is held forever with no route back through the console.
    const payable = availablePayoutStatuses(from, 'M-Pesa')
    for (const to of moves) {
      assert.ok(payable.includes(to), `${to} should stay legal for PayPal, since it does not send money`)
    }
  }
})

test('a closed request offers nothing at all, whatever the method', async () => {
  const { availablePayoutStatuses } = await import('@/lib/payouts')
  for (const method of PAYOUT_METHODS) {
    assert.deepEqual(availablePayoutStatuses('paid', method), [], `${method} after paid`)
    assert.deepEqual(availablePayoutStatuses('rejected', method), [], `${method} after rejected`)
    assert.deepEqual(availablePayoutStatuses('cancelled', method), [], `${method} after cancelled`)
  }
})

test('payable methods keep the full state machine, unchanged', async () => {
  const { availablePayoutStatuses, nextPayoutStatuses, PAYOUT_STATUSES } = await import('@/lib/payouts')
  for (const from of PAYOUT_STATUSES) {
    assert.deepEqual(availablePayoutStatuses(from, 'M-Pesa'), nextPayoutStatuses(from))
    assert.deepEqual(availablePayoutStatuses(from, 'Bank Transfer'), nextPayoutStatuses(from))
  }
})

test('the refusal explains what to do instead, and only fires for unpayable methods', async () => {
  const { payoutSettlementRefusal } = await import('@/lib/payouts')
  // `paid` is the only move that claims the money left.
  assert.match(String(payoutSettlementRefusal('paid', 'PayPal')), /Refund it instead/)
  assert.equal(payoutSettlementRefusal('paid', 'M-Pesa'), null)
  assert.equal(payoutSettlementRefusal('paid', 'Bank Transfer'), null)
  // Everything that releases the hold is allowed for every method.
  for (const to of ['rejected', 'failed', 'cancelled', 'approved', 'processing'] as const) {
    assert.equal(payoutSettlementRefusal(to, 'PayPal'), null, `${to} must not be refused`)
  }
})

test('the transition itself is refused on the server, not just hidden in the UI', () => {
  // Hiding a button is a courtesy. The money path is `settlePayoutRequest`, so the refusal has to
  // live inside it, before the ledger write, or a hand-rolled POST can still mark PayPal paid.
  const source = read('lib/wallet-server.ts')
  const start = source.indexOf('export async function settlePayoutRequest(')
  assert.ok(start > 0, 'settlePayoutRequest should exist')
  const body = source.slice(start, start + 4000)

  const refusal = body.indexOf('payoutSettlementRefusal(')
  assert.ok(refusal > 0, 'settlePayoutRequest must consult the settlement gate')
  const paidWrite = body.indexOf("if (input.to === 'paid')")
  assert.ok(paidWrite > 0, 'the paid branch should be visible in this window')
  assert.ok(refusal < paidWrite, 'the refusal must precede the ledger write, not follow it')

  // The gate is applied to the *stored* method (read back from the document), not to anything the
  // caller sent, so it cannot be bypassed by omitting or spoofing a field.
  assert.match(body.slice(refusal - 200, refusal + 120), /row\.method/)
})

test('the console derives its buttons from the same gate as the server', () => {
  const admin = read('app/admin/payouts/page.tsx')
  assert.match(admin, /availablePayoutStatuses\([\s\S]{0,80}?row\.status,[\s\S]{0,80}?row\.method,/)
  assert.match(admin, /availablePayoutStatuses\([\s\S]{0,80}?selected\.status,[\s\S]{0,80}?selected\.method[,)]/)
  // The old two-line filter that only dropped the owner check would have offered "paid" here.
  assert.doesNotMatch(admin, /const moves = \(transitions\[row\.status\]\?\.next \?\? \[\]\)\.filter\(/)
})
