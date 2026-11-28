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
