import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The erase path is a set of promises that are easy to lose one at a time:
 *
 *  - the profile marker on a soft delete must actually be written (the allowlist used to drop it);
 *  - an erase must know about every collection that holds the member, not just three;
 *  - writes must be chunked, because one batch over Firestore's limit aborts the whole operation;
 *  - the console must show the returned counts, otherwise "nothing changed" and "everything was
 *    removed" look identical in a toast.
 *
 * These are source-level assertions on purpose: the real deletion needs a live Firebase project,
 * but a future edit that quietly drops one of the above should still fail CI.
 */

const ROOT = process.cwd()
const firestore = readFileSync(join(ROOT, 'lib/firestore-admin.ts'), 'utf8')
const route = readFileSync(join(ROOT, 'app/api/admin/users/route.ts'), 'utf8')
const page = readFileSync(join(ROOT, 'app/admin/users/page.tsx'), 'utf8')

test('a soft delete writes the marker fields the console promises', () => {
  const allowlist = firestore.slice(firestore.indexOf('const ADMIN_MUTABLE_USER_FIELDS'), firestore.indexOf('export async function adminUpdateUser'))
  assert.match(allowlist, /'deletedAt'/, 'deletedAt must survive adminUpdateUser — otherwise "flagged" writes nothing')
  assert.match(allowlist, /'moderationReason'/, 'moderationReason must survive adminUpdateUser')
})

test('a hard delete clears every member-owned collection, not only the original three', () => {
  for (const collection of [
    'applications',
    'wallet_ledger',
    'notifications',
    'payout_requests',
    'payout_open',
    'transactions',
    'kyc_records',
    'referral_codes',
    'referrals',
    'email_verifications',
    'admin_sessions',
    'phone_claims',
  ]) {
    assert.match(firestore, new RegExp(`collection\\('${collection}'\\)`), `hardDeleteAccount must clean ${collection}`)
  }
})

test('hard deletes are chunked below the Firestore batch limit', () => {
  assert.match(firestore, /const DELETE_BATCH_SIZE = 400/)
  assert.match(firestore, /async function deleteRefsInChunks/)
  assert.match(firestore, /async function redactRefsInChunks/)
})

test('the console reports what erase removed instead of a generic success toast', () => {
  assert.match(page, /describeRemoved\(result\.removed\)/, 'the erase toast must include the API removed counts')
  assert.match(page, /result\.removed\)/)
})

test('flagging for deletion also disables the sign-in credential', () => {
  assert.match(route, /case 'delete':[\s\S]{0,900}setAccountEnabled\(uid, false/, 'a banned account must not keep a working credential')
  assert.match(route, /credentialDisabled: credential\.ok/, 'the response must say whether sign-in was actually disabled')
})

test('the flag action requires the same reason length on both sides of the wire', () => {
  assert.match(route, /case 'delete':[\s\S]{0,200}reason\.length < 6/, 'the server requires six characters for a flag')
  assert.match(page, /action: 'delete',[\s\S]{0,500}minReasonLength: 6/, 'the dialog must not allow a shorter reason than the server')
})
