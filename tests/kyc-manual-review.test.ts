import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Identity verification is a human review, not a provider integration.
 *
 * The Didit module, its session-creation route, its signed webhook, its callback page and the QR
 * modal that polled it are all gone. What replaced them has to be pinned, because the shape of the
 * failure is the same as it always was: a member who believes they are verified when they are not,
 * or one who cannot get verified at all, loses access to paid work and to their own money.
 *
 * The invariants worth defending:
 *   1. a member can *ask* for a review and nothing more — never grant themselves one;
 *   2. the decision is made server-side and is audited;
 *   3. asking again after a rejection is what clears the stale verdict;
 *   4. the member-facing UI reflects the queue, so nobody sits on a spinner forever.
 */

const root = resolve(import.meta.dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

test('the member-facing route only stamps a review request', () => {
  const route = read('app/api/kyc/request/route.ts')
  assert.match(route, /export async function POST/, 'the route must exist')
  assert.match(route, /requestKycReview/, 'it delegates the write to the server helper')

  // It must not import anything that could write a verdict. This is the whole security property:
  // the route can reach exactly two server functions, and neither can verify anyone.
  assert.match(
    route,
    /import \{ requestKycReview, getUserProfile \} from '@\/lib\/firestore-admin'/,
    'the route reaches exactly the request stamper and a profile read',
  )
  assert.doesNotMatch(route, /verifyKycAdmin/, 'a member must never reach the decision function')
  assert.doesNotMatch(route, /\.set\(|\.update\(|FieldValue/,
    'the route performs no Firestore write of its own — it delegates, so it cannot forge a verdict')

  // Both guards survive from the provider era: a tapped-repeatedly button is still a flood.
  assert.match(route, /rateLimit\(req, 'kyc-request'/)
  assert.match(route, /consumeBucket\('kyc-request-write'/)
})

test('a request stamps a timestamp and clears a stale verdict, but never a verdict of its own', () => {
  const admin = read('lib/firestore-admin.ts')
  let fn = admin.slice(admin.indexOf('export async function requestKycReview'))
  fn = fn.slice(0, fn.indexOf('\n}\n'))

  assert.match(fn, /kycRequestedAt: now/, 'the timestamp is what the console queue orders by')
  assert.doesNotMatch(fn, /kycVerified/, 'the helper never touches the verdict at all')
  assert.doesNotMatch(fn, /\.set\([^)]*kycVerified/, 'so it cannot write one even by accident')

  // Re-asking after a rejection must reset the status, otherwise the console shows "declined"
  // next to a member who is actively waiting.
  assert.match(fn, /kycStatus: 'requested'/, 'a fresh request supersedes the previous verdict')
  assert.match(fn, /alreadyRequested/, 'asking twice is idempotent')
})

test('a member asking for a review is audited, and the queue is a real count', () => {
  const admin = read('lib/firestore-admin.ts')
  // A queue nobody worked would otherwise look like nobody asked.
  assert.match(admin, /createAuditEntry\('KYC_REVIEW_REQUESTED'/, 'asking is a state change like any other')

  // The dashboard tile must count the queue, not the member base. It used to be
  // totalUsers - verified - suspended, which reports everyone who has not been verified yet.
  assert.match(admin, /kycRequestedAt',\s*'!='/ , 'the count is a real query')
  assert.doesNotMatch(
    admin,
    /kycRequested:\s*Math\.max\(0, totalUsers - verified/,
    'the queue must not be derived from the totals',
  )
  const page = read('app/admin/page.tsx')
  assert.match(page, /kycRequested/, 'the dashboard shows the queue')
  assert.doesNotMatch(page, /kyc_on_hold/, 'the old provider state no longer exists to link to')
})

test('the decision retires the request that produced it', () => {
  const admin = read('lib/firestore-admin.ts')
  let fn = admin.slice(admin.indexOf('export async function verifyKycAdmin'))
  fn = fn.slice(0, fn.indexOf('\n}\n', fn.indexOf('await notifyUser')))

  assert.match(fn, /kycRequestedAt: null/, 'approving or rejecting empties the queue entry')
  // A decision about identity must not lift a suspension or ban. Only an owner can restore access.
  assert.match(fn, /const restricted = currentState === 'suspended' \|\| currentState === 'banned'/)
  assert.match(fn, /\.\.\.\(restricted \? \{\} : \{ accountState: 'active' \}\)/)
  assert.match(fn, /createAuditEntry/, 'the decision is recorded against the operator')
})

test('a member cannot write their own verification state', () => {
  const rules = read('firestore.rules')
  let privileged = rules.slice(rules.indexOf('function privilegedKeys()'))
  privileged = privileged.slice(0, privileged.indexOf('}'))

  for (const key of ['kycVerified', 'kycStatus', 'kycRequestedAt']) {
    assert.match(privileged, new RegExp(`'${key}'`), `${key} must be on the privileged list`)
  }
  // The collection the provider used to write per-session records into no longer exists.
  assert.doesNotMatch(rules, /kyc_records/)
})

test('the provider integration is gone, not merely unused', () => {
  assert.throws(() => read('lib/didit.ts'), 'the provider module must be deleted')
  assert.throws(() => read('app/api/kyc/webhook/route.ts'), 'no signed webhook without a provider')
  assert.throws(() => read('app/api/kyc/submit/route.ts'), 'no session-creation route')
  assert.throws(() => read('app/api/kyc/status/route.ts'), 'no provider polling route')
  assert.throws(() => read('app/kyc/callback/page.tsx'), 'no provider redirect target')
  assert.throws(() => read('components/kyc-qr-modal.tsx'), 'no cross-device QR flow')

  // The CSP must not keep allowing a host the app never talks to.
  assert.doesNotMatch(read('middleware.ts'), /didit/i)
  // And the webhook allow-list in the middleware must not name a dead route.
  assert.doesNotMatch(read('middleware.ts'), /kyc\/webhook/)
})

test('the member UI asks for a review instead of polling a provider', () => {
  const profile = read('app/profile/page.tsx')
  assert.match(profile, /\/api\/kyc\/request/, 'the profile posts a request')
  assert.doesNotMatch(profile, /\/api\/kyc\/status/, 'and never polls a provider for a verdict')
  assert.doesNotMatch(profile, /verificationUrl/, 'there is no hosted URL to redirect to')
  assert.match(profile, /kycRequestedAt/, 'the card reflects the queue state')

  // The console shows the queue, and the approve/revoke actions already existed.
  const users = read('app/admin/users/page.tsx')
  assert.match(users, /kycRequestedAt/, 'the users table shows who is waiting')
  assert.match(users, /kyc-approve/, 'and still offers the decision')
})

test('the console no longer advertises a connection test', () => {
  const security = read('app/admin/security/page.tsx')
  assert.doesNotMatch(security, /kycDiagnose/, 'there is no provider to test')
  assert.doesNotMatch(security, /Test connection/, 'and no button that implies one')
  assert.match(security, /admin review/i, 'the card explains the manual process instead')

  // The posture report must not ask for credentials that are no longer read.
  const posture = read('lib/security.ts')
  assert.doesNotMatch(posture, /DIDIT_API_KEY'\) &&/, 'no "is the provider configured" gate')
  assert.match(posture, /diditLeftovers/, 'but it does flag leftovers so they get deleted')
})
