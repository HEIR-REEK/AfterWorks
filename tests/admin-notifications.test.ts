import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  ADMIN_NOTIFICATION_BATCH_SIZE,
  ADMIN_NOTIFICATION_MAX_PAGES,
  chunk,
  foldPages,
  parseMarkReadRequest,
  selectToMark,
  shouldFetchAnotherPage,
} from '@/lib/admin-notifications-shared'

/**
 * "Mark all read" in the console was broken, and no test noticed because none existed. The bug was
 * a type confusion, not a Firestore problem:
 *
 *   the page sent `{ ids: [] }` to mean "everything"
 *   → the route turned it into `ids = []`, and `[]` is truthy
 *   → the helper took its "specific documents" branch
 *   → it ran `where(documentId(), 'in', [])`, which Firestore rejects with INVALID_ARGUMENT
 *   → the button showed an error and nothing was marked.
 *
 * These tests pin the request contract so the same ambiguity cannot come back, and cover the two
 * related faults found alongside it: a badge that capped at 100, and a success toast that appeared
 * whether or not anything was written.
 */

const read = (path: string) => readFileSync(path, 'utf8')

// ─── Request parsing: "all" and "none" must not share a value ───────────────

test('an empty id list means EVERYTHING, never nothing — the exact bug that shipped', () => {
  const result = parseMarkReadRequest({ ids: [] })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.request, { kind: 'all' })
})

test('the new explicit form is accepted', () => {
  const result = parseMarkReadRequest({ all: true })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.request, { kind: 'all' })
})

test('an absent ids key keeps the documented "mark all" contract', () => {
  for (const body of [{}, { all: undefined }, { ids: null }, { ids: undefined }]) {
    const result = parseMarkReadRequest(body)
    assert.equal(result.ok, true, `expected ${JSON.stringify(body)} to mean "all"`)
    if (result.ok) assert.deepEqual(result.request, { kind: 'all' })
  }
})

test('a named set is preserved, de-duplicated and trimmed', () => {
  const result = parseMarkReadRequest({ ids: ['a', 'a', ' b ', '', 123 as unknown as string, 'c'] })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.request, { kind: 'ids', ids: ['a', 'b', 'c'] })
})

test('malformed bodies are rejected instead of guessed at', () => {
  for (const body of [null, 'nope', 42, []]) {
    const result = parseMarkReadRequest(body)
    assert.equal(result.ok, false, `expected ${JSON.stringify(body)} to be rejected`)
  }
  const notArray = parseMarkReadRequest({ ids: 'a' })
  assert.equal(notArray.ok, false)
  if (!notArray.ok) assert.match(notArray.reason, /must be an array/)
})

test('`all: false` without ids is an error rather than a silent no-op', () => {
  const result = parseMarkReadRequest({ all: false })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /needs an explicit `ids`/)
})

// ─── Selection ──────────────────────────────────────────────────────────────

test('only unread documents are selected, and only those the request names', () => {
  const docs = [
    { id: 'a', read: false },
    { id: 'b', read: true },
    { id: 'c' },
    { id: 'd', read: false },
  ]
  // "all" takes everything not already read.
  assert.deepEqual(selectToMark(docs, { kind: 'all' }), ['a', 'c', 'd'])
  // A named set is intersected with what is actually unread.
  assert.deepEqual(selectToMark(docs, { kind: 'ids', ids: ['a', 'b', 'z'] }), ['a'])
  // Already-read documents are never re-written, so the reported count stays honest.
  assert.deepEqual(selectToMark(docs, { kind: 'ids', ids: ['b'] }), [])
})

test('a document with no read field at all counts as unread', () => {
  assert.deepEqual(selectToMark([{ id: 'x' }], { kind: 'all' }), ['x'])
})

// ─── Chunking and paging ────────────────────────────────────────────────────

test('chunks never exceed Firestore’s 500-write commit limit', () => {
  assert.ok(ADMIN_NOTIFICATION_BATCH_SIZE < 500, 'must leave headroom under the hard cap of 500')
  const pages = chunk(Array.from({ length: 900 }, (_, i) => i))
  assert.equal(pages.length, Math.ceil(900 / ADMIN_NOTIFICATION_BATCH_SIZE))
  for (const page of pages) assert.ok(page.length <= ADMIN_NOTIFICATION_BATCH_SIZE)
  // Nothing may be dropped when splitting.
  assert.equal(pages.flat().length, 900)
})

test('paging stops on a short page and keeps going on a full one', () => {
  const pageLimit = ADMIN_NOTIFICATION_BATCH_SIZE
  assert.equal(shouldFetchAnotherPage({ pageSize: pageLimit, pageLimit, pagesFetched: 1 }), true)
  assert.equal(shouldFetchAnotherPage({ pageSize: pageLimit - 1, pageLimit, pagesFetched: 1 }), false)
  assert.equal(shouldFetchAnotherPage({ pageSize: 0, pageLimit, pagesFetched: 1 }), false)
  // The ceiling always wins, so a misbehaving query cannot page forever.
  assert.equal(
    shouldFetchAnotherPage({ pageSize: pageLimit, pageLimit, pagesFetched: ADMIN_NOTIFICATION_MAX_PAGES }),
    false,
  )
})

test('the reported total is the sum of what really changed, and truncation is surfaced', () => {
  assert.deepEqual(foldPages([40, 25, 5], 3), { marked: 70, truncated: false })
  assert.deepEqual(foldPages([], 0), { marked: 0, truncated: false })
  const atCeiling = foldPages([10], ADMIN_NOTIFICATION_MAX_PAGES)
  assert.equal(atCeiling.marked, 10)
  assert.equal(atCeiling.truncated, true, 'hitting the ceiling must be reported, not hidden')
})

// ─── Wiring: the pieces that were individually wrong ────────────────────────

test('the route no longer infers intent from a bare array', () => {
  const route = read('app/api/admin/notifications/route.ts')
  // The old line that turned `ids: []` into a truthy empty array.
  assert.doesNotMatch(route, /Array\.isArray\(body\.ids\)\s*\?/, 'must parse the body, not coerce it')
  assert.match(route, /parseMarkReadRequest/)
  assert.match(route, /markAdminNotificationsRead\(parsed\.request\)/)
})

test('the helper cannot be called with an empty in-query any more', () => {
  const admin = read('lib/firestore-admin.ts')
  const start = admin.indexOf('export async function markAdminNotificationsRead')
  const block = admin.slice(start, start + 2600)
  // Guard the exact failing construct: a document-id `in` filter built from a possibly-empty list.
  assert.match(block, /request\.kind === 'ids'/, 'the ids branch must be explicit')
  assert.match(block, /remaining\.length/, 'the ids branch must bail on an empty remainder')
  assert.doesNotMatch(block, /where\(FieldPath\.documentId\(\), 'in', clean\)/)
  // And the count it returns is real, not assumed.
  assert.match(block, /batch\.commit\(\)/)
})

test('the unread badge counts instead of reading one page', () => {
  const admin = read('lib/firestore-admin.ts')
  const start = admin.indexOf('export async function countUnreadAdminNotifications')
  const block = admin.slice(start, start + 900)
  assert.match(block, /\.count\(\)\.get\(\)/, 'an aggregation count, so a backlog above 100 is not hidden')
})

test('the page sends the unambiguous form and reports the real result', () => {
  const page = read('app/admin/notifications/page.tsx')
  assert.match(page, /body: \{ all: true \}/)
  assert.doesNotMatch(page, /body: \{ ids: \[\] \}/, 'the payload that broke the button')
  // A zero/partial result must not produce a success toast, which is how this stayed hidden.
  assert.match(page, /marked/)
  assert.match(page, /truncated/)
  assert.doesNotMatch(page, /'All notifications marked as read\.'/, 'unconditional success toast')
})
