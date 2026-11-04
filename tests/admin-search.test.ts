import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applicationMatchesSearch,
  decodeSearchCursor,
  encodeSearchCursor,
  filterJobs,
  jobMatchesSearch,
  ledgerMatchesSearch,
  matchesSearch,
  normaliseUserStateFilter,
  paginateSearchResults,
  payoutMatchesSearch,
  userMatchesSearch,
  userMatchesState,
} from '@/lib/admin-search'
import { seedJobs } from '@/lib/afterworks-data'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('free-text search is case-insensitive and requires every word', () => {
  assert.equal(matchesSearch('  JANE   doe ', ['Jane W. Doe', 'jane@example.com']), true)
  assert.equal(matchesSearch('doe jane', ['Jane W. Doe']), true)
  assert.equal(matchesSearch('jane missing', ['Jane W. Doe']), false)
  assert.equal(matchesSearch('', ['anything']), true)
})

test('member search covers name, email, uid and payout handle — not just an email prefix', () => {
  const row = {
    uid: 'uid-12345',
    name: 'Jane Wanjiku Doe',
    email: 'jane@example.com',
    phone: '254712345678',
    payoutNumber: '0712345678',
    accountState: 'active',
    kycVerified: true,
  }
  assert.equal(userMatchesSearch(row, 'jane'), true, 'name search must work')
  assert.equal(userMatchesSearch(row, 'wanjiku'), true)
  assert.equal(userMatchesSearch(row, 'uid-123'), true)
  assert.equal(userMatchesSearch(row, '0712'), true)
  assert.equal(userMatchesSearch(row, 'someone else'), false)
})

test('the console state filters mean what their labels say', () => {
  assert.equal(normaliseUserStateFilter('admins'), 'admins')
  assert.equal(normaliseUserStateFilter('staff'), 'admins')
  assert.equal(normaliseUserStateFilter('kyc_pending'), 'kyc_pending')
  assert.equal(normaliseUserStateFilter('not-a-state'), 'all')

  assert.equal(userMatchesState({ uid: '1', role: 'admin' }, 'admins'), true)
  assert.equal(userMatchesState({ uid: '1', isAdmin: true }, 'admins'), true)
  assert.equal(userMatchesState({ uid: '1', role: 'user' }, 'admins'), false)

  // "KYC pending" is the review queue: a member who asked and has not been answered. A member who
  // never asked is not waiting, and counting them made both this filter and the dashboard tile
  // report the entire member base as a backlog.
  assert.equal(userMatchesState({ uid: '1', kycVerified: false, accountState: 'active' }, 'kyc_pending'), false)
  assert.equal(
    userMatchesState({ uid: '1', kycVerified: false, kycRequestedAt: '2026-11-04T10:00:00Z' }, 'kyc_pending'),
    true,
  )
  // Already decided — approved or declined — so not waiting any more.
  assert.equal(
    userMatchesState(
      { uid: '1', kycVerified: true, kycRequestedAt: '2026-11-04T10:00:00Z' },
      'kyc_pending',
    ),
    false,
  )
  assert.equal(
    userMatchesState({ uid: '1', kycVerified: false, accountState: 'kyc_rejected' }, 'kyc_pending'),
    false,
  )
  // A restricted member who asked is still waiting for an answer. Hiding them would make the
  // request invisible: the identity decision and the access decision are separate, and approving
  // an identity deliberately does not lift a suspension.
  assert.equal(
    userMatchesState({ uid: '1', kycVerified: false, accountState: 'suspended', kycRequestedAt: 'x' }, 'kyc_pending'),
    true,
  )
  assert.equal(userMatchesState({ uid: '1', accountState: 'kyc_rejected' }, 'kyc_rejected'), true)
  assert.equal(userMatchesState({ uid: '1', accountState: 'suspended' }, 'restricted'), true)
  assert.equal(userMatchesState({ uid: '1', accountState: 'banned' }, 'restricted'), true)
  assert.equal(userMatchesState({ uid: '1', accountState: 'active' }, 'restricted'), false)
})

test('filtered pages use a scoped offset cursor and reset when the query changes', () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ id: index }))
  const first = paginateSearchResults(rows, { scope: 'users|all|jane', pageSize: 3 })
  assert.deepEqual(first.rows.map((row) => row.id), [0, 1, 2])
  assert.equal(first.hasMore, true)

  const second = paginateSearchResults(rows, {
    scope: 'users|all|jane',
    pageSize: 3,
    cursor: first.nextCursor,
  })
  assert.deepEqual(second.rows.map((row) => row.id), [3, 4, 5])

  const changedQuery = paginateSearchResults(rows, {
    scope: 'users|restricted|jane',
    pageSize: 3,
    cursor: first.nextCursor,
  })
  assert.deepEqual(changedQuery.rows.map((row) => row.id), [0, 1, 2], 'a stale cursor must not skip rows')

  assert.equal(decodeSearchCursor(first.nextCursor, 'users|all|jane'), 3)
  assert.equal(decodeSearchCursor(first.nextCursor, 'users|all|john'), 0)
  assert.equal(decodeSearchCursor('a-document-id', 'users|all|jane'), 0)
  assert.equal(decodeSearchCursor(encodeSearchCursor('users|all|jane', 5), 'users|all|jane'), 5)
})

test('application, payout and ledger searches use the fields the console advertises', () => {
  const application = {
    id: 'app-1',
    jobId: 'job-swahili-radio-interviews',
    jobTitle: 'Transcribe Swahili radio interviews',
    workerUid: 'uid-1',
    workerEmail: 'jane@example.com',
    status: 'under_review',
  }
  assert.equal(applicationMatchesSearch(application, 'swahili'), true)
  assert.equal(applicationMatchesSearch(application, 'jane'), true)
  assert.equal(applicationMatchesSearch(application, 'other'), false)

  const payout = {
    uid: 'uid-1',
    email: 'jane@example.com',
    name: 'Jane Doe',
    requestedAt: '2026-11-01T10:00:00.000Z',
    payoutReference: 'MPESA-9X8',
    destination: { accountNumber: '0712345678' },
  }
  assert.equal(payoutMatchesSearch(payout, 'mpesa'), true)
  assert.equal(payoutMatchesSearch(payout, '0712'), true)
  assert.equal(payoutMatchesSearch(payout, 'jane'), true)

  const ledger = {
    uid: 'uid-1',
    email: 'jane@example.com',
    reference: 'aw_tr_ABC123',
    label: 'Transcribe Swahili radio interviews',
  }
  assert.equal(ledgerMatchesSearch(ledger, 'radio'), true)
  assert.equal(ledgerMatchesSearch(ledger, 'abc123'), true)
  assert.ok(ledger.reference.endsWith('ABC123'))
})

test('the worker board applies category, training, availability and search together', () => {
  const jobs = seedJobs()
  const transcriptions = filterJobs(jobs, { category: 'Transcription', hideFull: true })
  assert.ok(transcriptions.length > 0)
  assert.ok(transcriptions.every((job) => job.category === 'Transcription'))

  const training = filterJobs(jobs, { trainingOnly: true })
  assert.ok(training.length > 0)
  assert.ok(training.every((job) => job.trainingRequired))

  const search = filterJobs(jobs, { search: 'swahili', hideFull: true })
  assert.ok(search.some((job) => job.id === 'job-swahili-radio-interviews'))
  assert.ok(search.every((job) => jobMatchesSearch(job, 'swahili')))

  const unavailable = jobs.find((job) => job.slotsRemaining === 0)
  assert.ok(unavailable)
  assert.equal(
    filterJobs(jobs, { hideFull: true }).some((job) => job.id === unavailable.id),
    false,
    'a full card stays off the default board',
  )
  assert.equal(
    filterJobs(jobs, { hideFull: false }).some((job) => job.id === unavailable.id),
    true,
    'showing full and closed work brings it back',
  )
})

test('the admin user read wires the real search and state predicates', () => {
  const source = readFileSync(join(process.cwd(), 'lib/firestore-admin.ts'), 'utf8')
  assert.match(source, /userMatchesState\(record, state\) && userMatchesSearch\(record, search\)/)
  assert.match(source, /normaliseUserStateFilter\(opts\.state\)/)
  assert.doesNotMatch(source, /where\('email'\)\.startAt\(search\)/, 'email-prefix-only search is the bug')
  assert.match(source, /applicationMatchesSearch\(row, search\)/)
  assert.match(source, /ledgerMatchesSearch\(row, search\)/)
})

test('the catalogue import is owner-only and uses the shared starter import', () => {
  const route = readFileSync(join(process.cwd(), 'app/api/admin/jobs/route.ts'), 'utf8')
  assert.match(route, /export async function POST/)
  assert.match(route, /requireOwner\(req\)/)
  assert.match(route, /importStarterJobs/)
})
