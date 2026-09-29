import assert from 'node:assert/strict'
import test from 'node:test'
import { ADMIN_MUTABLE_USER_FIELDS, authAccountMissing } from '@/lib/firestore-admin'
import { ADMIN_MUTABLE_STATES, STATE_LABELS } from '@/lib/admin-domain'

/**
 * The console's 502-then-404 loop.
 *
 * Reported as: `PATCH /api/admin/users 502 (Bad Gateway)` followed, on every retry, by
 * `PATCH /api/admin/users 404 (Not Found)` — from the member drawer's confirm button.
 *
 * Two defects produced exactly that sequence:
 *
 *  1. Every "is this credential gone?" check matched the *message* against
 *     `/USER_NOT_FOUND|no such user|uid-not-found/`. Firebase's real message is
 *     "There is no user record corresponding to the provided identifier." — none of those
 *     strings appear in it — so a credential that simply does not exist was classified as a
 *     generic `auth_write_failed`, which the route answers as **502 Bad Gateway**. A 404 was
 *     reported as a partner-service outage.
 *
 *  2. `hardDeleteAccount()` deleted the *profile* first and the *credential* last. The stub
 *     profiles this module documents (a phone claim, a terms acceptance, an interrupted write)
 *     have no credential, so the final step threw after the profile was already gone: the
 *     endpoint answered 502 "Deletion stopped part-way", and every retry then answered
 *     404 "No such user." because the document it needed had been deleted. The erase could
 *     never be completed, and the orphaned credential was invisible to the directory that
 *     would have listed it.
 *
 * These tests pin the classification contract, the write order, and the field allow-list that
 * used to drop the operator's reason on the floor.
 */

// ─── 1. "No such Auth account" is a code, not a sentence ─────────────────────

test("Firebase's real 'no such user' error is recognised", () => {
  // The exact shape firebase-admin throws: a FirebaseError with `code` set and prose that
  // contains none of the strings the old regexes looked for.
  const real = Object.assign(new Error('There is no user record corresponding to the provided identifier.'), {
    code: 'auth/user-not-found',
  })
  assert.equal(authAccountMissing(real), true)
})

test("the message alone is enough when a transport carries no code", () => {
  assert.equal(authAccountMissing(new Error('There is no user record corresponding to the provided email.')), true)
  assert.equal(authAccountMissing(new Error('auth/user-not-found')), true)
  assert.equal(authAccountMissing(new Error('auth/email-not-found')), true)
})

test("the code alone is enough when a transport carries no prose", () => {
  assert.equal(authAccountMissing({ code: 'auth/user-not-found' }), true)
  assert.equal(authAccountMissing({ code: 'auth/email-not-found' }), true)
})

test("a real outage is not mistaken for a missing account", () => {
  // This is the case that must keep answering 502: something is genuinely wrong upstream.
  const outage = Object.assign(new Error('Deployment is unavailable. Please retry.'), { code: 'auth/internal-error' })
  assert.equal(authAccountMissing(outage), false)

  const weak = Object.assign(new Error('WEAK_PASSWORD : Password should be at least 6 characters'), {
    code: 'auth/invalid-password',
  })
  assert.equal(authAccountMissing(weak), false)
})

test("non-Error values never claim an account is missing", () => {
  for (const value of [null, undefined, '', 0, 'network down', [], { code: 'auth/quota-exceeded' }]) {
    assert.equal(authAccountMissing(value), false, `${JSON.stringify(value)} should not read as missing`)
  }
})

// ─── 2. The console's writes actually reach the document ─────────────────────

test("the moderation reason the operator typed is not silently dropped", () => {
  // `PATCH /api/admin/users` action `moderate` writes `{ accountState, moderationReason }` through
  // `adminUpdateUser`, which allow-lists its keys. `moderationReason` was missing from that set,
  // so the reason was validated, shown to the member and written to the audit log — and then
  // dropped from the very profile the drawer reads it back from.
  for (const field of ['moderationReason', 'deletedAt', 'accountState', 'wallet']) {
    assert.equal(ADMIN_MUTABLE_USER_FIELDS.has(field), true, `${field} must survive adminUpdateUser`)
  }
})

test("the allow-list still refuses fields the console must never write", () => {
  for (const field of ['uid', 'email', 'kycVerifiedAt', 'signupBonusGranted', 'password', 'isOwner']) {
    assert.equal(ADMIN_MUTABLE_USER_FIELDS.has(field), false, `${field} must stay read-only`)
  }
})

// ─── 3. The vocabulary the console sends is the vocabulary the domain defines ─

test("every account state the console can send is a state the domain knows", () => {
  // The drawer's "Under review" button used to send `accountState: 'under_review'` — the
  // *application* status vocabulary — so the action failed with 400 "Unknown account state."
  // every time. The button now sends `kyc_on_hold`.
  for (const state of ['active', 'suspended', 'banned', 'kyc_on_hold', 'kyc_rejected']) {
    assert.equal((ADMIN_MUTABLE_STATES as readonly string[]).includes(state), true, `${state} is a real state`)
    assert.equal(typeof STATE_LABELS[state as keyof typeof STATE_LABELS], 'string')
  }
  assert.equal((ADMIN_MUTABLE_STATES as readonly string[]).includes('under_review'), false)
})
