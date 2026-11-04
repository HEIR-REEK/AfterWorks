import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Composite-index parity for the server's Firestore queries.
 *
 * A `where('f', '==', …)` combined with `orderBy('g', 'desc')` cannot be served by Firestore's
 * automatic single-field indexes — Firestore cannot merge them, so the whole query fails with
 * FAILED_PRECONDITION until a composite index exists. The console's audit log shipped exactly that
 * way: the index was declared in firestore.indexes.json but never deployed to the project, the
 * read fell back to an unordered scan, and the ledger quietly showed an arbitrary slice of rows.
 *
 * Declaring the index is only half of it — it must also reach the project (`npm run deploy:indexes`)
 * — so this test pins both halves: every composite query visible in the server code has a matching
 * declared index, and the one-command deploy path exists. The deployed half is watched at runtime
 * by the `degraded` signal listAuditLogs returns when the index is missing.
 *
 * Two query shapes are scanned, because the audit-log bug lived in the second one:
 *   1. a fluent chain — `db.collection('x').where('f','==',v).orderBy('g','desc')`, including one
 *      built on an alias (`const col = db.collection('wallet_ledger'); col.where(…)…`);
 *   2. a statement-assembled query — `let q = db.collection('admin_logs')` followed by
 *      `q = q.where(…)` and `q = q.orderBy(…)` on later lines.
 * A query assembled through a helper that is not a plain collection reference is not statically
 * visible to either and must be checked by hand when one is added.
 */

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

type IndexFields = [string, 'ASC' | 'DESC'][]

const signature = (fields: IndexFields) => JSON.stringify(fields)

function declaredIndexes(): Map<string, IndexFields[]> {
  const parsed = JSON.parse(read('firestore.indexes.json')) as {
    indexes?: { collectionGroup?: string; fields?: { fieldPath?: string; order?: string }[] }[]
  }
  const byCollection = new Map<string, IndexFields[]>()
  for (const index of parsed.indexes ?? []) {
    const group = index.collectionGroup
    if (!group || !Array.isArray(index.fields)) continue
    const fields: IndexFields = index.fields.flatMap((field): IndexFields => {
      const path = field.fieldPath
      const order = field.order === 'DESCENDING' ? 'DESC' : field.order === 'ASCENDING' ? 'ASC' : null
      return path && order ? [[path, order]] : []
    })
    byCollection.set(group, [...(byCollection.get(group) ?? []), fields])
  }
  return byCollection
}

/** Consecutive fluent calls (one level of nested parens, no semicolons) — no statement bleed. */
const FLUENT = String.raw`(?:\s*\.(?:where|orderBy|limit|startAfter|offset)\((?:[^;()]|\([^;()]*\))*\))+`

/** `const col = db.collection('x')`, `let q: Query = db.collection('x')`, `const snap = await …` */
// The annotation may not cross a newline: `[^=\n]` keeps an object property such as
// `rows: page.rows,` from matching across lines and swallowing the next real assignment.
// `.doc(` is excluded — `const ref = db.collection('jobs').doc(id)` is a document reference, not a
// query, and treating it as one attributes whatever the reused variable name does elsewhere to it.
const ASSIGNMENT = /(?:const|let\s+)?(\w+)(?::[^=\n]+)?\s*=\s*(?:await\s+)?(?:db\.)?collection\('([a-z_]+)'\)(?!\s*\.doc\()/g

/** `FieldPath.documentId()` is the wire name Firestore indexes under. */
const DOCUMENT_ID_ORDER = /\.orderBy\(FieldPath\.documentId\(\),\s*'(asc|desc)'\)/gi

function compositeQueries(source: string): { collection: string; needs: IndexFields }[] {
  const found: { collection: string; needs: IndexFields }[] = []

  const record = (collection: string, wheres: string[], orders: [string, 'ASC' | 'DESC'][]) => {
    if (wheres.length === 0 || orders.length === 0) return
    // A scope can hold the same query twice (an ordered read plus its unordered fallback), and an
    // index lists each field once — dedupe before comparing signatures.
    const uniqueWheres = [...new Set(wheres)]
    const uniqueOrders = orders.filter(
      ([field, dir], index) => orders.findIndex((other) => other[0] === field && other[1] === dir) === index,
    )
    found.push({
      collection,
      needs: [...uniqueWheres.map((field) => [field, 'ASC'] as [string, 'ASC']), ...uniqueOrders],
    })
  }

  const readWheres = (text: string) =>
    [...text.matchAll(/\.where\('([A-Za-z_]+)',\s*'(==|array-contains|in)'/g)].map(([, field]) => field!)

  const readOrders = (text: string): [string, 'ASC' | 'DESC'][] => {
    const out: [string, 'ASC' | 'DESC'][] = []
    for (const [, field, dir] of text.matchAll(/\.orderBy\('([A-Za-z_]+)',\s*'(asc|desc)'\)/gi)) {
      out.push([field!, /^desc$/i.test(dir) ? 'DESC' : 'ASC'])
    }
    for (const [, dir] of text.matchAll(DOCUMENT_ID_ORDER)) {
      out.push(['__name__', /^desc$/i.test(dir) ? 'DESC' : 'ASC'])
    }
    return out
  }

  /** Calls made directly on a variable: `q = q.where(…)`, `q = q.orderBy(…)`. */
  const readDirectCalls = (text: string, name: string) => ({
    wheres: [...text.matchAll(new RegExp(String.raw`\b${name}\.where\('([A-Za-z_]+)',\s*'(==|array-contains|in)'`, 'g'))].map(
      ([, field]) => field!,
    ),
    orders: [
      ...[...text.matchAll(new RegExp(String.raw`\b${name}\.orderBy\('([A-Za-z_]+)',\s*'(asc|desc)'\)`, 'gi'))].map(
        ([, field, dir]) => [field!, /^desc$/i.test(dir) ? 'DESC' : 'ASC'] as [string, 'ASC' | 'DESC'],
      ),
      ...[...text.matchAll(new RegExp(String.raw`\b${name}\.orderBy\(FieldPath\.documentId\(\),\s*'(asc|desc)'\)`, 'gi'))].map(
        ([, dir]) => ['__name__', /^desc$/i.test(dir) ? 'DESC' : 'ASC'] as [string, 'ASC' | 'DESC'],
      ),
    ],
  })

  // 1. Fluent chains anchored on the collection reference itself:
  //    `db.collection('notifications').where('uid','==',uid).orderBy('createdAt','desc')`.
  const anchored = new RegExp(String.raw`\.collection\('([a-z_]+)'\)` + FLUENT, 'g')
  for (const match of source.matchAll(anchored)) {
    record(match[1]!, readWheres(match[0]!), readOrders(match[0]!))
  }

  const assignments = [...source.matchAll(ASSIGNMENT)]
  for (const [index, assignment] of assignments.entries()) {
    const [, name, collection] = assignment

    // Each alias's scope runs to its next assignment of the same name: a name like `ref` or `q`
    // is reused across functions, so a file-wide search would attribute one function's chain to
    // another function's collection.
    const from = assignment.index! + assignment[0].length
    const nextSameName = assignments.slice(index + 1).find((candidate) => candidate[1] === name)
    const scope = source.slice(from, nextSameName ? nextSameName.index! : source.length)

    // 2. Fluent chains built on the alias: `col.where('uid','==',uid).orderBy('createdAt','desc')`.
    //    Chained calls never carry the variable name, so the chain text itself is the evidence.
    const onAlias = new RegExp(String.raw`\b${name}` + FLUENT, 'g')
    for (const match of scope.matchAll(onAlias)) {
      record(collection!, readWheres(match[0]!), readOrders(match[0]!))
    }

    // 3. The same query assembled statement by statement — the shape the audit-log bug hid in:
    //    `let q: Query = db.collection('admin_logs')`, then `q = q.where(…)` and
    //    `q = q.orderBy(…)` on later lines. Only calls made *directly* on the variable count here;
    //    chained ones are already covered by (2).
    const direct = readDirectCalls(scope, name)
    record(collection!, direct.wheres, direct.orders)
  }

  return found
}

/** Every server-side module that talks to Firestore, discovered rather than listed. */
function serverSources(): string[] {
  const dirs = ['lib', join('app', 'api'), 'scripts']
  const files: string[] = []
  for (const dir of dirs) {
    let entries: string[]
    try {
      entries = readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? readdirSync(join(ROOT, dir, entry.name)).map((name) => join(entry.name, name))
          : [entry.name],
      )
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.endsWith('.ts')) continue
      const path = join(dir, name)
      if (read(path).includes('.collection(')) files.push(path)
    }
  }
  return files
}

test('every composite Firestore query has a matching declared index', () => {
  const indexes = declaredIndexes()
  const sources = serverSources()
  assert.ok(sources.length > 0, 'no server sources were scanned — the discovery is broken')

  const scanned = new Set<string>()
  for (const file of sources) {
    for (const query of compositeQueries(read(file))) {
      scanned.add(`${query.collection} ${signature(query.needs)}`)
      const declared = indexes.get(query.collection) ?? []
      assert.ok(
        declared.some((fields) => signature(fields) === signature(query.needs)),
        `${file}: query on '${query.collection}' needs composite index ${signature(query.needs)} — ` +
          'declare it in firestore.indexes.json, then deploy with `npm run deploy:indexes`',
      )
    }
  }

  // A scan that finds nothing would pass vacuously. These are the composite queries in the tree
  // today — admin_logs and applications are the statement-assembled shape the audit-log bug hid in.
  for (const expected of [
    'admin_logs [["action","ASC"],["timestamp","DESC"]]',
    'applications [["status","ASC"],["__name__","DESC"]]',
    'notifications [["uid","ASC"],["createdAt","DESC"]]',
    'referrals [["referrerUid","ASC"],["createdAt","DESC"]]',
    'wallet_ledger [["uid","ASC"],["createdAt","DESC"]]',
    'payout_requests [["uid","ASC"],["createdAt","DESC"]]',
  ]) {
    assert.ok(scanned.has(expected), `the scan must find the ${expected} query — it is silently skipping real queries`)
  }
})

test('the admin_logs composite index is declared — the one whose absence broke the audit log', () => {
  const declared = declaredIndexes().get('admin_logs') ?? []
  assert.ok(
    declared.some((fields) => signature(fields) === signature([['action', 'ASC'], ['timestamp', 'DESC']])),
    `admin_logs must declare [action ASC, timestamp DESC]; found ${JSON.stringify(declared)}`,
  )
})

test('the index deploy path is a one-command script', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
  assert.match(pkg.scripts?.['deploy:indexes'] ?? '', /firebase deploy --only firestore:indexes/)
})

test('a missing index is reported to the operator, not papered over', () => {
  // The declared index is only half the fix; the other half is that a project without it stops
  // pretending. listAuditLogs must return the degraded marker, the route must forward it, and the
  // console must show it — otherwise the ledger reads as complete while it is an arbitrary slice.
  const reader = read('lib/firestore-admin.ts')
  assert.match(reader, /degraded\?: string/, 'listAuditLogs must report the degraded state')
  assert.match(reader, /degraded:\s*\n/, 'the bounded-scan fallback must set it')

  const route = read('app/api/admin/audit/route.ts')
  assert.match(route, /const \{ rows: logs, degraded \}/, 'the route must take the marker from the reader')
  assert.match(route, /degraded: degraded \?\? null/, 'the JSON response must carry it')
  assert.match(route, /X-Audit-Degraded/, 'the CSV export must carry it without breaking the rows')

  const page = read('app/admin/audit-log/page.tsx')
  assert.match(page, /setDegraded\(data\.degraded/, 'the console must read the marker')
  assert.match(page, /\{degraded && \(/, 'the console must render the warning')
})
