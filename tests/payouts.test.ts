import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANCELLABLE_PAYOUT_STATUSES,
  PAYOUT_STATUSES,
  canTransitionPayout,
  describeDestination,
  isCancellablePayoutStatus,
  isOpenPayoutStatus,
  isValidMobileNumber,
  mapPayoutRequest,
  maskAccountNumber,
  nextPayoutStatuses,
  requiresPayoutReference,
  roundUsd,
  validatePayoutDestination,
  validateWithdrawalAmount,
  withdrawalQuote,
  type PayoutRequestStatus,
} from '@/lib/payouts'
import { MEMBER_PROFILE_FIELDS, PROFILE_REQUIRED_FIELDS, profileCompletion, sanitiseProfilePatch } from '@/lib/profile-completion'

// ─── Money maths ─────────────────────────────────────────────────────────────

test('roundUsd keeps money to the cent and refuses nonsense', () => {
  assert.equal(roundUsd(12.3449), 12.34)
  assert.equal(roundUsd(12.345), 12.35)
  assert.equal(roundUsd(0), 0)
  assert.equal(roundUsd(Number.NaN), 0)
  assert.equal(roundUsd(Number.POSITIVE_INFINITY), 0)
})

test('withdrawalQuote subtracts the hold and never goes negative', () => {
  const quote = withdrawalQuote({ availableUsd: 42.5, heldUsd: 12.5, minWithdrawalUsd: 10, usdToKes: 130 })
  assert.equal(quote.availableUsd, 42.5)
  assert.equal(quote.heldUsd, 12.5)
  assert.equal(quote.withdrawableUsd, 30)
  assert.equal(quote.withdrawableKes, 3900)

  // A hold larger than the balance (stale hold, manual adjustment) is clamped, not subtracted twice.
  const clamped = withdrawalQuote({ availableUsd: 5, heldUsd: 50, minWithdrawalUsd: 10, usdToKes: 130 })
  assert.equal(clamped.withdrawableUsd, 0)

  const zero = withdrawalQuote({ availableUsd: 0, heldUsd: 0, minWithdrawalUsd: 10 })
  assert.equal(zero.withdrawableUsd, 0)
  assert.equal(zero.availableUsd, 0)
})

test('validateWithdrawalAmount enforces the minimum and the ceiling with useful copy', () => {
  assert.deepEqual(validateWithdrawalAmount(25, 40, 10), { ok: true, amountUsd: 25 })
  const belowMin = validateWithdrawalAmount(4, 40, 10)
  assert.equal(belowMin.ok, false)
  assert.match(belowMin.ok === false ? belowMin.error : '', /minimum/i)
  const aboveBalance = validateWithdrawalAmount(41, 40, 10)
  assert.equal(aboveBalance.ok, false)
  assert.match(aboveBalance.ok === false ? aboveBalance.error : '', /up to/i)
  const nothingYet = validateWithdrawalAmount(10, 0, 10)
  assert.equal(nothingYet.ok, false)
  assert.match(nothingYet.ok === false ? nothingYet.error : '', /clearing window/i)
})

// ─── Destination validation ──────────────────────────────────────────────────

test('Kenyan mobile numbers are accepted in the shapes members actually type', () => {
  for (const value of ['0712345678', '0712 345 678', '+254712345678', '254712345678', '0112345678']) {
    assert.equal(isValidMobileNumber(value), true, `${value} should be valid`)
  }
  for (const value of ['071234567', '0812345678', '712345678', '', 'not-a-number', '+15551234567']) {
    assert.equal(isValidMobileNumber(value), false, `${value} should be invalid`)
  }
})

test('validatePayoutDestination requires a name and the fields for the chosen method', () => {
  const mpesa = validatePayoutDestination({ method: 'M-Pesa', accountName: 'Amina Otieno', phone: '0712 345 678' })
  assert.equal(mpesa.ok, true)
  if (mpesa.ok) {
    assert.equal(mpesa.destination.method, 'M-Pesa')
    assert.equal(mpesa.destination.accountNumber, '0712 345 678')
    // Masked: recognisable to the owner, useless to anyone else (spacing of the typed number is kept).
    assert.equal(describeDestination(mpesa.destination).startsWith('M-Pesa · 0712'), true)
    assert.equal(describeDestination(mpesa.destination).endsWith('678'), true)
    assert.equal(describeDestination(mpesa.destination).includes('•••'), true)
    assert.equal(describeDestination(mpesa.destination, { masked: false }), 'M-Pesa · 0712 345 678')
  }

  const noName = validatePayoutDestination({ method: 'M-Pesa', accountName: 'A', phone: '0712345678' })
  assert.equal(noName.ok, false)

  const badBank = validatePayoutDestination({ method: 'Bank Transfer', accountName: 'Amina Otieno', bankName: 'KCB', bankBranch: 'Kiambu', bankAccountNumber: '12' })
  assert.equal(badBank.ok, false)
  if (!badBank.ok) assert.equal(badBank.field, 'bankAccountNumber')

  const bank = validatePayoutDestination({ method: 'Bank Transfer', accountName: 'Amina Otieno', bankName: 'KCB', bankBranch: 'Kiambu', bankAccountNumber: '1234567890' })
  assert.equal(bank.ok, true)
  if (bank.ok) assert.match(describeDestination(bank.destination), /Bank transfer · KCB \(Kiambu\)/)
})

test('account numbers are masked for display', () => {
  assert.equal(maskAccountNumber('0712345678'), '07123•••678')
  assert.equal(maskAccountNumber('1234567890'), '12345•••890')
  assert.equal(maskAccountNumber('123'), '123')
  assert.equal(maskAccountNumber(''), '')
})

// ─── Status machine ──────────────────────────────────────────────────────────

test('the payout state machine allows exactly the intended moves', () => {
  assert.deepEqual(nextPayoutStatuses('pending').sort(), ['approved', 'cancelled', 'paid', 'processing', 'rejected'].sort())
  assert.deepEqual(nextPayoutStatuses('processing').sort(), ['failed', 'paid'].sort())
  for (const terminal of ['paid', 'rejected', 'failed'] as const) {
    assert.deepEqual(nextPayoutStatuses(terminal), [], `${terminal} must be terminal`)
    for (const to of PAYOUT_STATUSES) {
      if (to === terminal) continue // same-status replay is a no-op, not a transition
      assert.equal(canTransitionPayout(terminal, to), false, `${terminal} → ${to} must be refused`)
    }
  }
  // Replaying the same status is a no-op, not an error (the API treats it that way).
  assert.equal(canTransitionPayout('paid', 'paid'), true)
})

test('open vs released statuses decide who holds the money', () => {
  assert.equal(isOpenPayoutStatus('pending'), true)
  assert.equal(isOpenPayoutStatus('approved'), true)
  assert.equal(isOpenPayoutStatus('processing'), true)
  assert.equal(isOpenPayoutStatus('paid'), false)
  assert.equal(isOpenPayoutStatus('cancelled'), false)

  // A paid request must carry a provider reference; refusals must carry a reason.
  assert.equal(requiresPayoutReference('paid'), true)
  assert.equal(requiresPayoutReference('rejected'), false)

  assert.deepEqual([...CANCELLABLE_PAYOUT_STATUSES], ['pending', 'approved'])
  assert.equal(isCancellablePayoutStatus('processing'), false)
  assert.equal(isCancellablePayoutStatus('pending'), true)
})

test('mapPayoutRequest tolerates partial documents instead of throwing', () => {
  const row = mapPayoutRequest('pr_1', {
    uid: 'u1',
    amountUsd: '12.345',
    status: 'weird-status',
    method: 'Bank Transfer',
    history: [{ status: 'pending', at: '2026-01-01T00:00:00.000Z' }],
  })
  assert.equal(row.amountUsd, 12.35)
  assert.equal(row.status, 'pending')
  assert.equal(row.method, 'Bank Transfer')
  assert.equal(row.destinationLabel.length > 0, true)
  assert.equal(row.history.length, 1)

  const empty = mapPayoutRequest('pr_2', {})
  assert.equal(empty.amountUsd, 0)
  assert.equal(empty.status, 'pending')
})

// ─── Profile completion + patch sanitiser ────────────────────────────────────

test('profile completion is all-or-nothing on the six required fields', () => {
  const partial = profileCompletion({ name: 'Amina', phone: '0712345678', location: 'Kiambu', bio: '', skills: ['Transcription'], languages: [] })
  assert.equal(partial.percent, 67)
  assert.deepEqual(partial.missing, ['bio', 'languages'])
  assert.equal(partial.complete, false)

  const complete = profileCompletion({ name: 'Amina', phone: '0712345678', location: 'Kiambu', bio: 'Detail-oriented.', skills: ['Reading'], languages: ['Swahili'] })
  assert.equal(complete.percent, 100)
  assert.equal(complete.complete, true)
  assert.deepEqual(complete.missingLabels, [])

  // Whitespace is not a value, and neither is an empty list.
  const whitespace = profileCompletion({ name: '   ', phone: '0712345678', location: 'Kiambu', bio: 'x', skills: '  ', languages: ['English'] })
  assert.equal(whitespace.complete, false)
  assert.deepEqual(whitespace.missing, ['name', 'skills'])

  assert.equal(profileCompletion(null).percent, 0)
  assert.equal(PROFILE_REQUIRED_FIELDS.length, 6)
})

test('sanitiseProfilePatch drops privileged keys, caps lengths and clears stale bank details', () => {
  const { patch, dropped } = sanitiseProfilePatch({
    name: '  Amina Otieno  ',
    bio: 'x'.repeat(2000),
    wallet: { availableUsd: 9999 },
    kycVerified: true,
    role: 'admin',
    preferredPayoutMethod: 'M-Pesa',
    bankName: 'KCB',
    bankBranch: 'Kiambu',
    bankAccountNumber: '1234567890',
    skills: ['Data Entry', 'Data Entry', '  ', 'Transcription'],
  })

  assert.equal(patch.name, 'Amina Otieno')
  assert.equal((patch.bio as string).length, 800)
  assert.deepEqual(patch.skills, ['Data Entry', 'Transcription'])
  assert.deepEqual(dropped.sort(), ['kycVerified', 'role', 'wallet'].sort())
  // Switching to M-Pesa must not leave a bank account on the document.
  assert.equal(patch.bankName, '')
  assert.equal(patch.bankBranch, '')
  assert.equal(patch.bankAccountNumber, '')

  // Every accepted key is on the member allow-list.
  for (const key of Object.keys(patch)) {
    assert.ok((MEMBER_PROFILE_FIELDS as readonly string[]).includes(key), `${key} is not member-writable`)
  }

  const bank = sanitiseProfilePatch({ bankName: 'Equity', bankAccountNumber: '1234567890' }, { method: 'Bank Transfer' })
  assert.equal(bank.patch.bankName, 'Equity')
  assert.equal(bank.patch.bankAccountNumber, '1234567890')
})

test('an unknown status never becomes a transition the console can offer', () => {
  assert.deepEqual(nextPayoutStatuses('not-a-status'), [])
  assert.equal(canTransitionPayout('not-a-status', 'paid' satisfies PayoutRequestStatus), false)
})
