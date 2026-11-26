import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildStructuredQuery,
  decodeFields,
  encodeFields,
  encodeValue,
  generateDocumentId,
  pemToPkcs8,
  RestFirestore,
  PreconditionFailedError,
  FirestoreRestError,
  type RestDocument,
} from '@/lib/firestore-rest'

/**
 * These are the parts of the REST layer where a mistake is silent and expensive:
 *
 *  - a mis-encoded value writes `"1200"` where a number belongs, and arithmetic on a wallet
 *    balance starts concatenating strings;
 *  - a mis-built query returns documents that are *almost* right, which is worse than failing;
 *  - a batch that half-applies, or a transaction that never yields ABORTED, both lose money.
 *
 * So the encoding and query builders are pure and pinned here, and the transport is exercised
 * against a fake `fetch` that asserts the exact wire shape Firestore expects.
 */

// ─── Value encoding ──────────────────────────────────────────────────────────

test('scalars encode to the exact type tags Firestore REST expects', () => {
  assert.deepEqual(encodeValue('amina'), { stringValue: 'amina' })
  assert.deepEqual(encodeValue(true), { booleanValue: true })
  assert.deepEqual(encodeValue(null), { nullValue: null })
  // Integers must stay integers: `doubleValue` round-trips as 1300 but loses precision past 2^53,
  // and money in this app is stored as whole shillings/cents.
  assert.deepEqual(encodeValue(1300), { integerValue: '1300' })
  assert.deepEqual(encodeValue(-42), { integerValue: '-42' })
  assert.deepEqual(encodeValue(12.5), { doubleValue: 12.5 })
  assert.deepEqual(encodeValue(new Date('2026-11-26T10:00:00.000Z')), {
    timestampValue: '2026-11-26T10:00:00.000Z',
  })
})

test('non-finite numbers are rejected before they reach Firestore', () => {
  // NaN/Infinity are not representable; sending them silently becomes a string in some clients.
  assert.throws(() => encodeValue(Number.NaN), /non-finite/)
  assert.throws(() => encodeValue(Number.POSITIVE_INFINITY), /non-finite/)
})

test('arrays, nested maps and undefined values round-trip', () => {
  const encoded = encodeValue({ a: [1, 'two', { three: true }], skipped: undefined, b: null })
  assert.deepEqual(encoded, {
    mapValue: {
      fields: {
        a: {
          arrayValue: {
            values: [
              { integerValue: '1' },
              { stringValue: 'two' },
              { mapValue: { fields: { three: { booleanValue: true } } } },
            ],
          },
        },
        b: { nullValue: null },
      },
    },
  })
  // `undefined` is a Firestore no-op, never a null write — that distinction matters on merge.
  const fields = encodeFields({ keep: 1, drop: undefined })
  assert.deepEqual(Object.keys(fields), ['keep'])
})

test('decoding restores numbers, arrays and nested maps without turning them into strings', () => {
  const decoded = decodeFields({
    payAmountUsd: { integerValue: '1300' },
    ratio: { doubleValue: 129.5 },
    title: { stringValue: 'Transcription' },
    active: { booleanValue: false },
    nothing: { nullValue: null },
    tags: { arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] } },
    nested: { mapValue: { fields: { deep: { integerValue: '7' } } } },
    at: { timestampValue: '2026-11-26T10:00:00Z' },
  })
  assert.deepEqual(decoded, {
    payAmountUsd: 1300,
    ratio: 129.5,
    title: 'Transcription',
    active: false,
    nothing: null,
    tags: ['a', 'b'],
    nested: { deep: 7 },
    at: '2026-11-26T10:00:00Z',
  })
})

test('encode → decode is lossless for the shapes this app stores', () => {
  const original = {
    uid: 'abc',
    balanceCents: 12500,
    pending: 0,
    kycVerified: true,
    history: [{ status: 'submitted_for_review', at: '2026-11-26T10:00:00.000Z' }],
    meta: { source: 'web', retries: 2, ratio: 0.25 },
  }
  assert.deepEqual(decodeFields(encodeFields(original)), original)
})

// ─── Query building ──────────────────────────────────────────────────────────

test('a single equality filter becomes one fieldFilter, not a compositeFilter', () => {
  const q = buildStructuredQuery({
    parentPath: 'users',
    filters: [{ field: 'uid', op: '==', value: 'abc' }],
  })
  assert.deepEqual(q.from, [{ collectionId: 'users' }])
  assert.deepEqual(q.where, {
    fieldFilter: {
      field: { fieldPath: 'uid' },
      op: 'EQUAL',
      value: { stringValue: 'abc' },
    },
  })
})

test('multiple filters are ANDed, and an in-array is expanded per element', () => {
  const q = buildStructuredQuery({
    parentPath: 'applications',
    filters: [
      { field: 'workerUid', op: '==', value: 'u1' },
      { field: 'status', op: 'in', value: ['submitted_for_review', 'approved'] },
    ],
    orders: [{ field: 'createdAt', direction: 'desc' }],
    limit: 20,
  })
  assert.equal((q.where as any).compositeFilter.op, 'AND')
  const filters = (q.where as any).compositeFilter.filters
  assert.equal(filters.length, 2)

  const inFilter = filters[1]
  // `in` must become an OR of equalities; Firestore REST has no native COMPOSITE `in`.
  assert.equal(inFilter.compositeFilter.op, 'OR')
  assert.deepEqual(
    inFilter.compositeFilter.filters.map((f: any) => f.fieldFilter.value.stringValue),
    ['submitted_for_review', 'approved'],
  )
  assert.deepEqual(q.orderBy, [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }])
  assert.equal(q.limit, 20)
})

test('documentId filters use __name__ and a document reference, not a bare string', () => {
  const q = buildStructuredQuery({
    parentPath: 'notifications',
    filters: [
      {
        field: { documentId: true },
        op: 'in',
        value: [{ __documentPath: 'projects/p/databases/(default)/documents/notifications/a' }],
      },
    ],
  })
  const inner = (q.where as any).compositeFilter.filters[0]
  assert.deepEqual(inner.fieldFilter.field, { fieldPath: '__name__' })
  assert.ok(inner.fieldFilter.value.referenceValue.includes('notifications/a'))
})

test('a batch over 500 writes is rejected instead of being partially applied', async () => {
  const db = new RestFirestore({ projectId: 'p', accessToken: 't', fetchImpl: async () => new Response('{}') })
  const ops = Array.from({ length: 501 }, (_, i) => ({ kind: 'delete' as const, path: `users/${i}` }))
  await assert.rejects(db.batch(ops), /500-write limit/)
})

// ─── Transport, against a fake Firestore ─────────────────────────────────────

type Call = { url: string; method: string; body: any }

function fakeFetch(responder: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> }): {
  fetchImpl: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchImpl = (async (input: any, init: any = {}) => {
    const call: Call = {
      url: String(input),
      method: String(init.method ?? 'GET'),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    const result = responder(call)
    return new Response(result.body === undefined ? '' : JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json', ...(result.headers ?? {}) },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

test('a point read returns exists:false on 404 instead of throwing', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ status: 404, body: { error: { message: 'not found' } } }))
  const db = new RestFirestore({ projectId: 'proj', accessToken: 'tok', fetchImpl })

  const snap = await db.get('users/missing')
  assert.equal(snap.exists, false)
  assert.deepEqual(snap.data, {})
  assert.match(calls[0]!.url, /projects\/proj\/databases\/\(default\)\/documents\/users\/missing$/)
})

test('a merge write sends an updateMask listing exactly the written fields', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ body: { name: 'x' } }))
  const db = new RestFirestore({ projectId: 'proj', accessToken: 'tok', fetchImpl })

  await db.set('users/u1', { displayName: 'Amina', updatedAt: 'now', untouched: undefined }, { merge: true })

  const call = calls[0]!
  assert.equal(call.method, 'PATCH')
  // A merge without a mask REPLACES the document — the single most destructive REST mistake.
  assert.match(call.url, /updateMask\.fieldPaths=displayName/)
  assert.match(call.url, /updateMask\.fieldPaths=updatedAt/)
  assert.doesNotMatch(call.url, /untouched/)
  assert.deepEqual(Object.keys(call.body.fields).sort(), ['displayName', 'updatedAt'])
})

test('create() maps ALREADY_EXISTS to a distinguishable error, so a race cannot be swallowed', async () => {
  const { fetchImpl } = fakeFetch(() => ({
    status: 400,
    body: { error: { message: 'Document already exists', status: 'ALREADY_EXISTS' } },
  }))
  const db = new RestFirestore({ projectId: 'proj', accessToken: 'tok', fetchImpl })
  await assert.rejects(db.create('emailReservations/a@b.c', {}), PreconditionFailedError)
})

test('runQuery reads the streamed {document} rows and ignores readTime entries', async () => {
  const { fetchImpl } = fakeFetch(() => ({
    body: [
      {
        document: {
          name: 'projects/proj/databases/(default)/documents/jobs/j1',
          fields: { title: { stringValue: 'Transcription' }, payAmountUsd: { integerValue: '1300' } },
        },
      },
      { readTime: '2026-11-26T10:00:00Z' },
      {},
    ],
  }))
  const db = new RestFirestore({ projectId: 'proj', accessToken: 'tok', fetchImpl })

  const rows = await db.query('jobs', { filters: [{ field: 'status', op: '==', value: 'open' }] })
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0]!.data, { title: 'Transcription', payAmountUsd: 1300 })
  assert.equal(rows[0]!.id, 'j1')
})

test('a transaction retries on ABORTED and succeeds, keeping reads before writes', async () => {
  let beginCount = 0
  let commitCount = 0
  const { fetchImpl, calls } = fakeFetch((call) => {
    if (call.url.endsWith(':beginTransaction')) {
      beginCount += 1
      return { body: { transaction: `tx-${beginCount}` } }
    }
    if (call.url.endsWith(':batchGet')) {
      return {
        body: [{ found: { name: 'n', fields: { balanceCents: { integerValue: '1000' } } } }],
      }
    }
    if (call.url.endsWith(':commit')) {
      commitCount += 1
      // First commit loses the race; second wins.
      return commitCount === 1
        ? { status: 409, body: { error: { message: 'ABORTED', status: 'ABORTED' } } }
        : { body: { writeResults: [{}] } }
    }
    if (call.url.endsWith(':rollback')) return { body: {} }
    return { body: {} }
  })

  const db = new RestFirestore({ projectId: 'proj', accessToken: 'tok', fetchImpl })
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get('wallets/u1')
    assert.equal(snap.data.balanceCents, 1000)
    tx.update('wallets/u1', { balanceCents: 500 })
    return 'ok'
  })

  assert.equal(result, 'ok')
  assert.equal(beginCount, 2, 'the aborted attempt must be retried with a fresh transaction')
  assert.equal(commitCount, 2)

  // Reads must carry the transaction id, otherwise they are not part of the snapshot.
  const batchGet = calls.find((c) => c.url.endsWith(':batchGet'))!
  assert.ok(batchGet.body.transaction)
})

test('a transaction that never settles stops retrying instead of looping forever', async () => {
  const { fetchImpl } = fakeFetch((call) => {
    if (call.url.endsWith(':beginTransaction')) return { body: { transaction: 'tx' } }
    if (call.url.endsWith(':batchGet')) return { body: [{}] }
    if (call.url.endsWith(':commit')) return { status: 409, body: { error: { message: 'ABORTED' } } }
    return { body: {} }
  })
  const db = new RestFirestore({ projectId: 'proj', accessToken: 'tok', fetchImpl })
  await assert.rejects(
    db.runTransaction(async (tx) => {
      await tx.get('wallets/u1')
      tx.update('wallets/u1', { balanceCents: 1 })
    }, { maxAttempts: 3 }),
    /aborted/i,
  )
})

test('a 401 mints a fresh token and retries the read exactly once', async () => {
  let attempt = 0
  const seenTokens: string[] = []
  const fetchImpl = (async (_url: any, init: any = {}) => {
    attempt += 1
    seenTokens.push(String(init.headers?.authorization ?? ''))
    return attempt === 1
      ? new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 })
      : new Response(JSON.stringify({ fields: { uid: { stringValue: 'u1' } } }), { status: 200 })
  }) as typeof fetch

  let mintCount = 0
  const db = new RestFirestore({
    projectId: 'proj',
    accessToken: 'stale',
    accessTokenProvider: async () => {
      mintCount += 1
      return 'fresh'
    },
    fetchImpl,
  })

  const snap = await db.get('users/u1')
  assert.equal(snap.exists, true)
  assert.equal(snap.data.uid, 'u1')
  assert.equal(attempt, 2, 'the retry must actually be attempted')
  assert.equal(mintCount, 1, 'the stale token must be replaced, not reused')
  assert.match(seenTokens[0]!, /Bearer stale/)
  assert.match(seenTokens[1]!, /Bearer fresh/)
})

test('a 401 with no way to mint a token fails fast instead of retrying', async () => {
  let attempt = 0
  const { fetchImpl } = fakeFetch(() => {
    attempt += 1
    return { status: 401, body: { error: { message: 'expired' } } }
  })
  const db = new RestFirestore({ projectId: 'proj', accessToken: 'stale', fetchImpl })
  await assert.rejects(db.get('users/u1'), /401/)
  assert.equal(attempt, 1, 'a retry without a provider would just 401 twice')
})

test('batch() surfaces a per-item failure rather than reporting success', async () => {
  const { fetchImpl } = fakeFetch(() => ({
    body: { status: [{ code: 0 }, { code: 5, message: 'NOT_FOUND' }] },
  }))
  const db = new RestFirestore({ projectId: 'proj', accessToken: 'tok', fetchImpl })
  await assert.rejects(
    db.batch([
      { kind: 'delete', path: 'a/1' },
      { kind: 'delete', path: 'a/2' },
    ]),
    /batchWrite item failed/,
  )
})

test('generated document ids are 20 chars from Firestore’s own alphabet and do not collide', () => {
  const ids = new Set(Array.from({ length: 500 }, () => generateDocumentId()))
  assert.equal(ids.size, 500)
  for (const id of ids) {
    assert.equal(id.length, 20)
    assert.match(id, /^[A-Za-z0-9]{20}$/)
  }
})

test('a malformed PEM is rejected with a clear message instead of a crypto error', () => {
  assert.throws(() => pemToPkcs8('not a pem'), /not a PKCS#8 PEM/)
  // The realistic mistake: a key re-exported as PKCS#1 would fail deep inside importKey with an
  // opaque DataError, so name the actual fix.
  assert.throws(
    () => pemToPkcs8('-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----'),
    /PKCS#1 .*convert it to PKCS#8/,
  )
})

test('a degraded 500 is a FirestoreRestError the callers can branch on', async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 503, body: { error: { status: 'UNAVAILABLE' } } }))
  const db = new RestFirestore({ projectId: 'proj', accessToken: 'tok', fetchImpl })
  await assert.rejects(db.get('users/u1'), (err: unknown) => {
    assert.ok(err instanceof FirestoreRestError)
    assert.equal((err as FirestoreRestError).status, 503)
    return true
  })
})

export type { RestDocument }
