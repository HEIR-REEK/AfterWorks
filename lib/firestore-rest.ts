/**
 * Firestore + Firebase Auth over REST — a Workers-compatible core.
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 * `firebase-admin`'s Firestore client speaks gRPC over HTTP/2 with bidirectional streaming.
 * Cloudflare Workers (workerd) does not implement that, and `nodejs_compat` does not add it —
 * there is no flag that fixes it. So the *transport* has to change, even though the storage
 * layout does not.
 *
 * This module is that transport: service-account JWT → OAuth2 access token → Firestore REST
 * (`:runQuery`, `:batchWrite`, `:beginTransaction`/`:commit`) and the Identity Toolkit REST API.
 * Everything is `fetch` + WebCrypto, so it runs identically on Workers, on Node, and on Render.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 * It is not a complete re-implementation of the Admin SDK, and it is not yet wired into
 * `lib/firestore-admin.ts`. It deliberately covers the primitives that the *hot paths* need —
 * point reads, queries, merges, batches, optimistic transactions, token verification — which is
 * the part that has to exist and be correct before any route is moved onto it. See
 * CLOUDFLARE_MIGRATION.md for the honest remaining surface (notably `listUsers` paging).
 *
 * ── Design rules ─────────────────────────────────────────────────────────────
 *  1. Field values are encoded/decoded explicitly. Firestore REST wraps every scalar in a
 *     type tag (`{"stringValue": …}`), and getting that wrong silently writes strings where
 *     numbers belonged — so encode/decode are pure, exported, and unit-tested.
 *  2. A transaction retries on contention (Firestore returns ABORTED) — bounded, with jitter.
 *     The ledger and wallet paths depend on read-then-write actually being serialised.
 *  3. The access token is cached in the isolate for its lifetime, minus a safety margin, so a
 *     warm Worker does not re-sign a JWT per request. The in-flight promise is shared so a
 *     burst of cold requests mints one token, not fifty.
 *  4. Nothing here reads `process.env` directly at module scope: values are resolved per call,
 *     because Workers bind env at request time.
 */

// ─── Minimal ambient types ───────────────────────────────────────────────────
// These mirror the shapes `lib/firestore-admin.ts` already consumes, so the eventual switch is
// a change of import, not a rewrite of every caller.

export type FirestoreValue = Record<string, unknown>
export type DocumentData = Record<string, unknown>

export type QueryOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'array-contains'
  | 'array-contains-any'
  | 'in'
  | 'not-in'

export type QueryFilter = {
  field: string | { documentId: true }
  op: QueryOperator
  value: unknown
}

export type QueryOrder = { field: string | { documentId: true }; direction?: 'asc' | 'desc' }

export type RestDocument = {
  /** Document id (the last path segment). */
  id: string
  /** Fully-qualified `projects/…/documents/…` name, needed for writes. */
  name: string
  data: DocumentData
  createTime?: string
  updateTime?: string
}

export type RestSnapshot = {
  exists: boolean
  id: string
  /** `false` when the read returned a 404 — `data` is then `{}`, not `null`. */
  data: DocumentData
}

export type WriteOp =
  | { kind: 'set'; path: string; data: DocumentData; merge?: boolean }
  | { kind: 'update'; path: string; data: DocumentData; mask?: string[] }
  | { kind: 'delete'; path: string; precondition?: { exists?: boolean; updateTime?: string } }
  | { kind: 'create'; path: string; data: DocumentData }

export type ServiceAccount = {
  project_id: string
  client_email: string
  /** PEM private key, `\n` already unescaped. */
  private_key: string
}

export type RestFirestoreOptions = {
  projectId: string
  /** Pre-issued OAuth token. When absent, the token comes from `accessTokenProvider` or `serviceAccount`. */
  accessToken?: string
  serviceAccount?: ServiceAccount
  /**
   * Mints a fresh access token. Used on the first call and again whenever Firestore answers 401
   * (a cached token can be revoked early). Defaults to {@link getAccessToken} over
   * `serviceAccount`; injecting it keeps the retry path testable without a real key.
   */
  accessTokenProvider?: () => Promise<string>
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
  /** Firestore emulator base, e.g. `http://127.0.0.1:8080`. No auth is sent to it. */
  emulatorHost?: string
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class FirestoreRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'FirestoreRestError'
  }
}

/** Firestore's ABORTED — contention inside a transaction. Retryable. */
const ABORTED = 10
const NOT_FOUND = 5

export class PreconditionFailedError extends Error {
  constructor(message = 'Document precondition failed (already exists or was modified).') {
    super(message)
    this.name = 'PreconditionFailedError'
  }
}

// ─── Base64url over bytes (Workers + Node both have btoa; neither has Buffer guarantee) ──

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function utf8ToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text))
}

/**
 * PEM (`-----BEGIN PRIVATE KEY-----`) → PKCS#8 DER bytes, for `crypto.subtle.importKey`.
 *
 * The header is *required*, not merely stripped. Service accounts normally ship PKCS#8, but a
 * key re-exported by some tools is PKCS#1 (`BEGIN RSA PRIVATE KEY`), which `importKey('pkcs8')`
 * would reject with an opaque DataError. Failing here says which of the two is wrong.
 */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  if (!pem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(
      pem.includes('-----BEGIN RSA PRIVATE KEY-----')
        ? 'Service account private_key is PKCS#1 (BEGIN RSA PRIVATE KEY); convert it to PKCS#8 (BEGIN PRIVATE KEY).'
        : 'Service account private_key is not a PKCS#8 PEM (missing -----BEGIN PRIVATE KEY-----).',
    )
  }
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  if (!body) throw new Error('Service account private_key is empty or not a PKCS#8 PEM.')

  const binary = atob(body)
  // Explicitly ArrayBuffer-backed: `crypto.subtle.importKey` rejects a view that may be backed
  // by a SharedArrayBuffer (lib.dom's `BufferSource`).
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ─── Service-account JWT → access token ──────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'
const IDENTITY_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit'

/** Refresh 60 s early so an in-flight request cannot race the expiry. */
const TOKEN_SAFETY_MS = 60_000

type CachedToken = { token: string; expiresAt: number }

// Isolate-scoped, keyed by scope+client so two projects cannot share a token.
const tokenCache = new Map<string, CachedToken>()
const tokenFlights = new Map<string, Promise<string>>()

/**
 * Signs a service-account JWT and exchanges it for an OAuth2 access token.
 *
 * The assertion JWT is RS256 over `header.payload`; WebCrypto's `RSASSA-PKCS1-v1_5` with
 * SHA-256 is exactly that. This is the step that fakes-out easiest, so the signature is
 * verified back against the same key in the test suite.
 */
export async function mintAccessToken(
  serviceAccount: ServiceAccount,
  opts?: { scope?: string; fetchImpl?: typeof fetch; now?: () => number },
): Promise<{ token: string; expiresIn: number }> {
  const scope = opts?.scope ?? FIRESTORE_SCOPE
  const fetchImpl = opts?.fetchImpl ?? fetch
  const now = opts?.now ?? Date.now
  const issuedAt = Math.floor(now() / 1000)

  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: serviceAccount.client_email,
    scope,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    // Max accepted by Google is 1 h.
    exp: issuedAt + 3600,
  }

  const unsigned = `${utf8ToBase64Url(JSON.stringify(header))}.${utf8ToBase64Url(JSON.stringify(claims))}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  )
  const assertion = `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })

  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new FirestoreRestError(
      `Google token exchange failed (${res.status}): ${detail.slice(0, 300)}`,
      res.status,
    )
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) {
    throw new FirestoreRestError('Google token exchange returned no access_token.', 502)
  }
  return { token: json.access_token, expiresIn: json.expires_in ?? 3600 }
}

/**
 * Cached access token for a service account. Concurrent callers share one in-flight exchange,
 * which matters on a cold start when a page fires several parallel queries.
 */
export async function getAccessToken(
  serviceAccount: ServiceAccount,
  opts?: { scope?: string; fetchImpl?: typeof fetch; now?: () => number },
): Promise<string> {
  const scope = opts?.scope ?? FIRESTORE_SCOPE
  const now = opts?.now ?? Date.now
  const cacheKey = `${serviceAccount.client_email}|${scope}`

  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_MS > now()) return cached.token

  const flight = tokenFlights.get(cacheKey)
  if (flight) return flight

  const promise = mintAccessToken(serviceAccount, { ...opts, scope })
    .then(({ token, expiresIn }) => {
      tokenCache.set(cacheKey, { token, expiresAt: now() + expiresIn * 1000 })
      return token
    })
    .finally(() => {
      tokenFlights.delete(cacheKey)
    })

  tokenFlights.set(cacheKey, promise)
  return promise
}

/** Tests and credential rotation only. */
export function resetTokenCache(): void {
  tokenCache.clear()
  tokenFlights.clear()
}

// ─── Value encoding (pure, unit-tested) ──────────────────────────────────────

/** `undefined` is dropped by Firestore, never sent — mirrors the Admin SDK. */
export function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot write a non-finite number (${value}) to Firestore.`)
    }
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }

  if (typeof value === 'object' && value !== null) {
    const sentinel = value as { __type?: string; value?: unknown }
    // FieldValue sentinels are applied by `encodeFields`, never here.
    if (sentinel.__type) throw new Error('FieldValue used where a plain value was expected.')
    const fields: Record<string, FirestoreValue> = {}
    for (const [k, v] of Object.entries(value as DocumentData)) {
      if (v === undefined) continue
      fields[k] = encodeValue(v)
    }
    return { mapValue: { fields } }
  }

  throw new Error(`Unsupported value type for Firestore: ${typeof value}`)
}

export function encodeFields(data: DocumentData): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    fields[key] = encodeValue(value)
  }
  return fields
}

export function decodeValue(field: FirestoreValue | undefined): unknown {
  if (!field) return undefined
  if ('nullValue' in field) return null
  if ('stringValue' in field) return field.stringValue as string
  if ('booleanValue' in field) return field.booleanValue as boolean
  if ('integerValue' in field) return Number(field.integerValue as string)
  if ('doubleValue' in field) return Number(field.doubleValue)
  if ('timestampValue' in field) return String(field.timestampValue)
  if ('bytesValue' in field) return String(field.bytesValue)
  if ('geoPointValue' in field) return field.geoPointValue
  if ('referenceValue' in field) return String(field.referenceValue)
  if ('arrayValue' in field) {
    const values = ((field.arrayValue as { values?: FirestoreValue[] }).values ?? [])
    return values.map((v) => decodeValue(v))
  }
  if ('mapValue' in field) {
    const fields = ((field.mapValue as { fields?: Record<string, FirestoreValue> }).fields ?? {})
    return decodeFields(fields)
  }
  return undefined
}

export function decodeFields(fields: Record<string, FirestoreValue> | undefined): DocumentData {
  const out: DocumentData = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    const decoded = decodeValue(value)
    if (decoded !== undefined) out[key] = decoded
  }
  return out
}

// ─── Query → REST structuredQuery (pure) ─────────────────────────────────────

function fieldRef(field: string | { documentId: true }) {
  return typeof field === 'string'
    ? { fieldPath: field }
    : { fieldPath: '__name__' }
}

function encodeComparisonValue(filter: QueryFilter): Record<string, unknown> {
  // Equality against a list is `in`/`array-contains`-style, and array values must be sent as
  // arrayValue with a value for each element.
  if (filter.op === 'in' || filter.op === 'not-in' || filter.op === 'array-contains-any') {
    if (!Array.isArray(filter.value)) {
      throw new Error(`Operator ${filter.op} needs an array value.`)
    }
    return {
      compositeFilter: {
        op: 'OR',
        filters: filter.value.map((v) => ({
          fieldFilter: {
            field: fieldRef(filter.field),
            op: filter.op === 'array-contains-any' ? 'ARRAY_CONTAINS_ANY' : filter.op === 'in' ? 'IN' : 'NOT_IN',
            value: encodeComparisonScalar(v),
          },
        })),
      },
    }
  }
  return {
    fieldFilter: {
      field: fieldRef(filter.field),
      op: UNARY_OP[filter.op],
      value: encodeComparisonScalar(filter.value),
    },
  }
}

function encodeComparisonScalar(value: unknown): FirestoreValue {
  // `__name__` filters take a document reference, not a scalar.
  if (typeof value === 'object' && value !== null && '__documentPath' in (value as object)) {
    return { referenceValue: String((value as { __documentPath: string }).__documentPath) }
  }
  return encodeValue(value)
}

const UNARY_OP: Record<string, string> = {
  '==': 'EQUAL',
  '!=': 'NOT_EQUAL',
  '<': 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  'array-contains': 'ARRAY_CONTAINS',
}

export type StructuredQuery = Record<string, unknown>

export function buildStructuredQuery(spec: {
  parentPath: string
  filters?: QueryFilter[]
  orders?: QueryOrder[]
  limit?: number
  offset?: number
  /** `projections` = a `select` on specific fields. */
  select?: string[]
  startAfter?: DocumentData | RestDocument
}): StructuredQuery {
  const query: StructuredQuery = { from: [{ collectionId: spec.parentPath.split('/').pop() }] }

  const filters = spec.filters ?? []
  if (filters.length === 1) {
    query.where = encodeComparisonValue(filters[0]!)
  } else if (filters.length > 1) {
    query.where = {
      compositeFilter: { op: 'AND', filters: filters.map(encodeComparisonValue) },
    }
  }

  if (spec.orders?.length) {
    query.orderBy = spec.orders.map((o) => ({
      field: fieldRef(o.field),
      direction: o.direction === 'desc' ? 'DESCENDING' : 'ASCENDING',
    }))
  }
  if (typeof spec.limit === 'number') query.limit = spec.limit
  if (typeof spec.offset === 'number' && spec.offset > 0) query.offset = spec.offset
  if (spec.select?.length) {
    query.select = { fields: spec.select.map((fieldPath) => ({ fieldPath })) }
  }
  if (spec.startAfter) {
    const cursor: DocumentData =
      'data' in spec.startAfter ? (spec.startAfter as RestDocument).data : (spec.startAfter as DocumentData)
    // Firestore requires the cursor values in the same order as `orderBy`.
    const values = (spec.orders ?? []).map((o) =>
      encodeValue(o.field === '__name__' ? undefined : cursor[o.field as string]),
    )
    query.startAt = { values, before: false }
  }
  return query
}

// ─── The client ──────────────────────────────────────────────────────────────

export type TransactionContext = {
  get(path: string): Promise<RestSnapshot>
  query(parentPath: string, spec: Omit<Parameters<typeof buildStructuredQuery>[0], 'parentPath'>): Promise<RestDocument[]>
  set(path: string, data: DocumentData, opts?: { merge?: boolean }): void
  update(path: string, data: DocumentData): void
  delete(path: string): void
}

export class RestFirestore {
  private readonly projectId: string
  private readonly fetchImpl: typeof fetch
  private token: string | null
  private readonly tokenProvider: (() => Promise<string>) | null
  private readonly emulatorHost?: string

  constructor(private readonly opts: RestFirestoreOptions) {
    this.projectId = opts.projectId
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.token = opts.accessToken ?? null
    this.emulatorHost = opts.emulatorHost
    this.tokenProvider =
      opts.accessTokenProvider ??
      (opts.serviceAccount ? () => getAccessToken(opts.serviceAccount!) : null)
  }

  private get baseUrl(): string {
    const root = this.emulatorHost ?? 'https://firestore.googleapis.com'
    return `${root.replace(/\/$/, '')}/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents`
  }

  private documentName(path: string): string {
    return `projects/${this.projectId}/databases/(default)/documents/${path.replace(/^\//, '')}`
  }

  private async authorize(): Promise<Record<string, string>> {
    // The emulator ignores auth entirely; skip the token so tests need no service account.
    if (this.emulatorHost) return {}
    if (!this.token) {
      if (!this.tokenProvider) {
        throw new FirestoreRestError('No access token, provider or service account configured.', 401)
      }
      this.token = await this.tokenProvider()
    }
    return { authorization: `Bearer ${this.token}` }
  }

  private async call(
    url: string,
    init: RequestInit & { retryOnUnauthorized?: boolean } = {},
  ): Promise<Response> {
    const headers = { ...(init.headers as Record<string, string>), ...(await this.authorize()) }
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...headers },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    })

    // A cached token can be revoked early; drop it and try exactly once more — but only when
    // something can actually mint a replacement, otherwise this would just 401 twice.
    if (res.status === 401 && init.retryOnUnauthorized !== false && this.tokenProvider && !this.emulatorHost) {
      this.token = null
      const fresh = await this.authorize()
      return this.fetchImpl(url, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>), ...fresh },
        signal: init.signal ?? AbortSignal.timeout(15_000),
      })
    }
    return res
  }

  // ── Reads ──

  async get(path: string): Promise<RestSnapshot> {
    const id = path.split('/').pop() ?? path
    const res = await this.call(`${this.baseUrl}/${path.replace(/^\//, '')}`, { method: 'GET' })
    if (res.status === 404) return { exists: false, id, data: {} }
    if (!res.ok) throw await this.toError(res, `get ${path}`)
    const json = (await res.json()) as { fields?: Record<string, FirestoreValue> }
    return { exists: true, id, data: decodeFields(json.fields) }
  }

  async query(
    parentPath: string,
    spec: Omit<Parameters<typeof buildStructuredQuery>[0], 'parentPath'> = {},
  ): Promise<RestDocument[]> {
    const structuredQuery = buildStructuredQuery({ parentPath, ...spec })
    const res = await this.call(`${this.baseUrl}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({ structuredQuery }),
    })
    if (!res.ok) throw await this.toError(res, `query ${parentPath}`)

    // A runQuery response is a stream of `{document}` / `{readTime}` / `{}` items, not an array
    // of documents.
    const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, FirestoreValue> } }>
    return rows
      .filter((row) => row.document)
      .map((row) => {
        const doc = row.document!
        return {
          id: doc.name.split('/').pop() ?? '',
          name: doc.name,
          data: decodeFields(doc.fields),
        }
      })
  }

  // ── Writes ──

  async set(path: string, data: DocumentData, opts?: { merge?: boolean }): Promise<void> {
    const mask = opts?.merge ? Object.keys(data).filter((k) => data[k] !== undefined) : []
    const search = new URLSearchParams()
    for (const field of mask) search.append('updateMask.fieldPaths', field)

    const res = await this.call(
      `${this.baseUrl}/${path.replace(/^\//, '')}${mask.length ? `?${search}` : ''}`,
      { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(data) }) },
    )
    if (!res.ok) throw await this.toError(res, `set ${path}`)
  }

  async update(path: string, data: DocumentData): Promise<void> {
    const fields = Object.keys(data).filter((k) => data[k] !== undefined)
    if (!fields.length) return
    const search = new URLSearchParams()
    for (const field of fields) search.append('updateMask.fieldPaths', field)

    const res = await this.call(`${this.baseUrl}/${path.replace(/^\//, '')}?${search}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: encodeFields(data) }),
    })
    if (!res.ok) throw await this.toError(res, `update ${path}`)
  }

  /**
   * Creates a document. `exists: false` is a precondition, so this is the correct primitive for
   * "claim this id exactly once" (e.g. a unique email/phone reservation) — a plain set would
   * silently overwrite.
   */
  async create(path: string, data: DocumentData): Promise<void> {
    const res = await this.call(`${this.baseUrl}/${path.replace(/^\//, '')}?currentDocument.exists=false`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: encodeFields(data) }),
    })
    if (res.status === 400) {
      const body = await res.text()
      if (/ALREADY_EXISTS/.test(body)) throw new PreconditionFailedError()
      throw await this.toError(res, `create ${path}`)
    }
    if (!res.ok) throw await this.toError(res, `create ${path}`)
  }

  async delete(path: string): Promise<void> {
    const res = await this.call(`${this.baseUrl}/${path.replace(/^\//, '')}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw await this.toError(res, `delete ${path}`)
  }

  /** `collection.add()` — a server-assigned id, as Firestore itself would generate. */
  async add(parentPath: string, data: DocumentData): Promise<string> {
    const id = generateDocumentId()
    await this.set(`${parentPath.replace(/\/$/, '')}/${id}`, data)
    return id
  }

  /**
   * Atomically applies a batch. Firestore caps a commit at 500 writes; callers that can exceed
   * that must chunk (this throws before sending, rather than half-applying).
   */
  async batch(ops: WriteOp[]): Promise<void> {
    if (ops.length > 500) {
      throw new FirestoreRestError(`Batch of ${ops.length} writes exceeds the 500-write limit.`, 400)
    }
    const writes = ops.map((op) => this.toWrite(op))
    const res = await this.call(`${this.baseUrl}:batchWrite`, {
      method: 'POST',
      body: JSON.stringify({ writes }),
    })
    if (!res.ok) throw await this.toError(res, 'batchWrite')
    const json = (await res.json()) as { status?: Array<{ code?: number; message?: string }> }
    const failure = json.status?.find((s) => s.code && s.code !== 0)
    if (failure) {
      throw new FirestoreRestError(`batchWrite item failed: ${failure.message ?? 'unknown'}`, 500)
    }
  }

  /**
   * Optimistic transaction.
   *
   * Firestore REST transactions are optimistic: `beginTransaction` → reads carry the transaction
   * id → `commit` with that id, and the commit is rejected (ABORTED) if anything read changed.
   * That rejection is the normal contention path, so it is retried with jitter instead of
   * surfacing. Money paths (wallet, referral ledger, profile save) rely on this.
   */
  async runTransaction<T>(handler: (tx: TransactionContext) => Promise<T>, opts?: { maxAttempts?: number }): Promise<T> {
    const maxAttempts = opts?.maxAttempts ?? 5
    let lastError: unknown

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const txId = await this.begin()
      const writes: WriteOp[] = []
      const tx: TransactionContext = {
        get: (path) => this.getInTransaction(path, txId),
        query: async (parentPath, spec) => {
          // All reads must happen before any write, and must be pinned to the transaction.
          const structuredQuery = buildStructuredQuery({ parentPath, ...spec })
          const res = await this.call(
            `${this.baseUrl}:runQuery`,
            { method: 'POST', body: JSON.stringify({ structuredQuery, transaction: txId }) },
          )
          if (!res.ok) throw await this.toError(res, `tx query ${parentPath}`)
          const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, FirestoreValue> } }>
          return rows
            .filter((row) => row.document)
            .map((row) => ({
              id: row.document!.name.split('/').pop() ?? '',
              name: row.document!.name,
              data: decodeFields(row.document!.fields),
            }))
        },
        set: (path, data, o) => writes.push({ kind: 'set', path, data, merge: o?.merge }),
        update: (path, data) => writes.push({ kind: 'update', path, data }),
        delete: (path) => writes.push({ kind: 'delete', path }),
      }

      try {
        const result = await handler(tx)
        if (writes.length) {
          await this.commit(txId, writes)
        } else {
          // Nothing written: release the transaction rather than leave it open.
          await this.rollback(txId)
        }
        return result
      } catch (err) {
        await this.rollback(txId).catch(() => {})
        lastError = err
        if (!isAborted(err) || attempt === maxAttempts - 1) throw err
        await sleep(jitter(attempt))
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Transaction failed.')
  }

  private async getInTransaction(path: string, txId: string): Promise<RestSnapshot> {
    const id = path.split('/').pop() ?? path
    const res = await this.call(`${this.baseUrl}:batchGet`, {
      method: 'POST',
      body: JSON.stringify({ documents: [this.documentName(path)], transaction: txId }),
    })
    if (!res.ok) throw await this.toError(res, `tx get ${path}`)

    // batchGet always returns one entry per requested document; `missing` marks a 404.
    const rows = (await res.json()) as Array<
      { found?: { name: string; fields?: Record<string, FirestoreValue> }; missing?: string }
    >
    const row = rows[0]
    if (!row?.found) return { exists: false, id, data: {} }
    return { exists: true, id, data: decodeFields(row.found.fields) }
  }

  private async begin(): Promise<string> {
    const res = await this.call(`${this.baseUrl}:beginTransaction`, {
      method: 'POST',
      body: JSON.stringify({ options: { readWrite: {} } }),
    })
    if (!res.ok) throw await this.toError(res, 'beginTransaction')
    const json = (await res.json()) as { transaction?: string }
    if (!json.transaction) throw new FirestoreRestError('beginTransaction returned no id.', 502)
    return json.transaction
  }

  private async commit(txId: string, ops: WriteOp[]): Promise<void> {
    const res = await this.call(`${this.baseUrl}:commit`, {
      method: 'POST',
      body: JSON.stringify({ transaction: txId, writes: ops.map((op) => this.toWrite(op)) }),
    })
    if (!res.ok) {
      const body = await res.text()
      if (/ABORTED/.test(body)) {
        throw new FirestoreRestError('Transaction aborted (contention).', 409, String(ABORTED))
      }
      throw await this.toError(res, 'commit')
    }
  }

  private async rollback(txId: string): Promise<void> {
    await this.call(`${this.baseUrl}:rollback`, {
      method: 'POST',
      body: JSON.stringify({ transaction: txId }),
    })
  }

  private toWrite(op: WriteOp): Record<string, unknown> {
    const name = this.documentName(op.path)
    switch (op.kind) {
      case 'delete':
        return {
          delete: name,
          ...(op.precondition ? { currentDocument: toPrecondition(op.precondition) } : {}),
        }
      case 'update':
      case 'set': {
        const fields = encodeFields(op.data)
        const mask = op.kind === 'update' ? Object.keys(fields) : op.merge ? Object.keys(fields) : []
        return {
          update: { name, fields },
          ...(mask.length ? { updateMask: { fieldPaths: mask } } : {}),
        }
      }
      case 'create':
        return { update: { name, fields: encodeFields(op.data) }, currentDocument: { exists: false } }
      default:
        throw new Error(`Unknown write op: ${JSON.stringify(op)}`)
    }
  }

  private async toError(res: Response, what: string): Promise<FirestoreRestError> {
    const body = await res.text().catch(() => '')
    let message = `${what} failed (${res.status})`
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } }
      if (parsed.error?.message) message = `${what} failed (${res.status} ${parsed.error.status ?? ''}): ${parsed.error.message}`
    } catch {
      if (body) message = `${what} failed (${res.status}): ${body.slice(0, 200)}`
    }
    return new FirestoreRestError(message, res.status)
  }
}

function toPrecondition(p: { exists?: boolean; updateTime?: string }): Record<string, unknown> {
  if (p.updateTime) return { updateTime: p.updateTime }
  return { exists: p.exists ?? false }
}

function isAborted(err: unknown): boolean {
  return err instanceof FirestoreRestError && (err.status === 409 || err.code === String(ABORTED))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Exponential backoff with full jitter, capped — keeps a contended ledger from lock-stepping. */
function jitter(attempt: number): number {
  const ceiling = Math.min(1_000, 25 * 2 ** attempt)
  return Math.floor(Math.random() * ceiling)
}

/**
 * A 20-character id in Firestore's own alphabet. `crypto.getRandomValues` is available on
 * Workers and Node alike; `Math.random` would risk a collision inside a burst.
 */
export function generateDocumentId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < bytes.length; i += 1) id += alphabet[bytes[i]! % alphabet.length]
  return id
}

export const AUTH_TOKEN_SCOPE = IDENTITY_SCOPE
