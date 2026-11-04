import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { resolvePaymentBinding } from '@/lib/payment-binding'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

test('a training charge unlocks only the job card it was opened for', () => {
  const ok = resolvePaymentBinding({
    requestedJobId: 'job-alpha',
    storedJobId: 'job-alpha',
    metadataJobId: 'job-alpha',
    uid: 'user-1',
    storedUserId: 'user-1',
    metadataUserId: 'user-1',
  })
  assert.deepEqual(ok, { ok: true, jobId: 'job-alpha' })

  const wrongCard = resolvePaymentBinding({
    requestedJobId: 'job-beta',
    storedJobId: 'job-alpha',
    metadataJobId: 'job-alpha',
    uid: 'user-1',
    storedUserId: 'user-1',
    metadataUserId: 'user-1',
  })
  assert.equal(wrongCard.ok, false)
  if (!wrongCard.ok) {
    assert.equal(wrongCard.code, 'job_mismatch')
    assert.match(wrongCard.message, /different job card/i)
  }
})

test('a charge with no job binding, or with conflicting bindings, is refused', () => {
  const unbound = resolvePaymentBinding({ requestedJobId: 'job-alpha', uid: 'user-1' })
  assert.equal(unbound.ok, false)
  if (!unbound.ok) assert.equal(unbound.code, 'missing_job_id')

  const noRequest = resolvePaymentBinding({ storedJobId: 'job-alpha', uid: 'user-1' })
  assert.equal(noRequest.ok, false)
  if (!noRequest.ok) assert.equal(noRequest.code, 'missing_job_id')

  const conflict = resolvePaymentBinding({
    requestedJobId: 'job-alpha',
    storedJobId: 'job-alpha',
    metadataJobId: 'job-beta',
    uid: 'user-1',
  })
  assert.equal(conflict.ok, false)
  if (!conflict.ok) assert.equal(conflict.code, 'job_mismatch')
})

test('a charge cannot be verified by a different signed-in account', () => {
  const storedOther = resolvePaymentBinding({
    requestedJobId: 'job-alpha',
    storedJobId: 'job-alpha',
    uid: 'user-2',
    storedUserId: 'user-1',
  })
  assert.equal(storedOther.ok, false)
  if (!storedOther.ok) assert.equal(storedOther.code, 'uid_mismatch')

  const metadataOther = resolvePaymentBinding({
    requestedJobId: 'job-alpha',
    metadataJobId: 'job-alpha',
    uid: 'user-2',
    metadataUserId: 'user-1',
  })
  assert.equal(metadataOther.ok, false)
  if (!metadataOther.ok) assert.equal(metadataOther.code, 'uid_mismatch')

  const conflictingUsers = resolvePaymentBinding({
    requestedJobId: 'job-alpha',
    storedJobId: 'job-alpha',
    uid: 'user-1',
    storedUserId: 'user-1',
    metadataUserId: 'user-2',
  })
  assert.equal(conflictingUsers.ok, false)
  if (!conflictingUsers.ok) assert.equal(conflictingUsers.code, 'uid_mismatch')
})

test('the verify route requires the requested card and grants only the bound card', () => {
  const route = read('app/api/paystack/verify/[reference]/route.ts')
  assert.match(route, /searchParams\.get\('jobId'\)/, 'verification must ask which card it is unlocking')
  assert.match(route, /resolvePaymentBinding\(/, 'the server must apply the shared binding rule')
  assert.match(route, /PAYMENT_JOB_MISMATCH/, 'a cross-job attempt must leave an audit trail')
  assert.match(route, /binding\.jobId/, 'the granted job id must come from the verified charge, not the request')
  assert.match(route, /recordPaidTrainingAdmin\(uid, jobId\)/, 'only the bound job id may be granted')
  assert.match(route, /job_mismatch/)
  assert.match(route, /jobId, amountKes/, 'a successful verification must return the bound job id')
})

test('the webhook refuses a charge whose row and metadata disagree', () => {
  const webhook = read('app/api/paystack/webhook/route.ts')
  assert.match(webhook, /storedJobId !== metadataJobId/, 'the webhook must compare the two job ids')
  assert.match(webhook, /storedUserId !== metadataUserId/, 'the webhook must compare the two user ids')
  assert.match(webhook, /PAYMENT_WEBHOOK_BINDING_CONFLICT/, 'a conflict must be audited, not granted')
  assert.match(webhook, /recorded: 'binding_conflict'/)
})

test('the browser credits only the job card the server confirmed', () => {
  const provider = read('components/afterworks-provider.tsx')
  assert.match(
    provider,
    /api\/paystack\/verify\/\$\{encodeURIComponent\(reference\)\}\?jobId=\$\{encodeURIComponent\(jobId\)\}/,
    'the requested job id must travel with the verification call',
  )
  assert.match(provider, /const verifiedJobId = .*data\.jobId/, 'the job id must come from the response')
  assert.match(provider, /data\.paid === true && verifiedJobId === jobId/, 'a paid charge for another card is not a pass')
  assert.match(provider, /prev\.includes\(verifiedJobId\)/, 'only the verified job id may be added to paidTrainings')

  const page = read('app/training/[id]/page.tsx')
  assert.match(page, /result\.paid && result\.jobId === id/, 'the training page must check the bound job before unlocking')
  assert.match(page, /referenceKey\(jobId: string\)/, 'pending references must be scoped per job card')
  assert.match(page, /rememberReference\(jobId, data\.reference\)/, 'a checkout reference must be stored under its own card')
})
