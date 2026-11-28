/**
 * Console notification read-state — the shared, runtime-agnostic part.
 *
 * Why this file exists
 * ────────────────────
 * "Mark all read" was broken by an ambiguity in the request shape, not by Firestore. The browser
 * sent `{ ids: [] }` to mean *everything*; the route turned that into `ids = []` (truthy, because
 * an empty array is truthy in JavaScript); and the helper took its "specific documents" branch and
 * ran `where(documentId(), 'in', [])` — which Firestore rejects with INVALID_ARGUMENT. The button
 * showed an error and nothing was ever marked.
 *
 * The lesson is that "all" and "none" must not be expressed by the same value. So the request is
 * parsed into a tagged union here — `{ kind: 'all' }` or `{ kind: 'ids', ids: [...] }` — and a
 * caller cannot reach a query without saying which one it means. Everything in this module is pure
 * so the decision logic is unit-tested; the Firestore calls live in `lib/firestore-admin.ts`.
 */

import { sanitizeLine } from '@/lib/security-core'

/** How many documents one `batch.update` commit may carry (Firestore caps a commit at 500). */
export const ADMIN_NOTIFICATION_BATCH_SIZE = 400

/**
 * How long a single "mark all read" request may keep paging.
 *
 * The old implementation marked at most 100 and then reported success, so a backlog beyond that
 * never cleared and the badge looked stuck. Paging fixes that, but an unbounded loop on a
 * misbehaving query is its own outage — so this is a hard ceiling (200 × 400 = 80,000 documents),
 * and hitting it is reported rather than silently truncated.
 */
export const ADMIN_NOTIFICATION_MAX_PAGES = 200

export type MarkReadRequest =
  | { kind: 'all' }
  | { kind: 'ids'; ids: string[] }

export type MarkReadParseResult =
  | { ok: true; request: MarkReadRequest }
  | { ok: false; reason: string }

/**
 * Parses a PATCH body into an explicit instruction.
 *
 * Accepted shapes, in priority order:
 *   `{ all: true }`     → everything unread
 *   `{}` / no `ids`     → everything unread (the historical "mark all" contract)
 *   `{ ids: [] }`       → everything unread. This is the case that used to break: an empty list is
 *                         read as "no specific targets", which means all, never "nothing".
 *   `{ ids: [...] }`    → exactly those ids
 *
 * Anything else is rejected instead of guessed at.
 */
export function parseMarkReadRequest(body: unknown): MarkReadParseResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'Body must be a JSON object.' }
  }
  const raw = body as Record<string, unknown>

  if (raw.all !== undefined) {
    if (raw.all === true) return { ok: true, request: { kind: 'all' } }
    if (raw.all === false && raw.ids === undefined) {
      return { ok: false, reason: '`all: false` needs an explicit `ids` array.' }
    }
  }

  if (raw.ids === undefined || raw.ids === null) {
    return { ok: true, request: { kind: 'all' } }
  }
  if (!Array.isArray(raw.ids)) {
    return { ok: false, reason: '`ids` must be an array when present.' }
  }

  const ids = Array.from(
    new Set(
      raw.ids
        .filter((v): v is string => typeof v === 'string')
        .map((v) => sanitizeLine(v, 64))
        .filter(Boolean),
    ),
  )

  // An empty list means "every unread notification", never "nothing". Making this branch explicit
  // is the actual fix: the old code fell through to a document-id query with no ids in it.
  if (ids.length === 0) return { ok: true, request: { kind: 'all' } }

  return { ok: true, request: { kind: 'ids', ids } }
}

/** A minimal shape this module can reason about without importing the Admin SDK. */
export type ReadStateDoc = { id: string; read?: boolean }

/**
 * Which of `docs` still need marking.
 *
 * A document is unread unless it explicitly says `read: true`, matching how the pages render a
 * dot for anything falsy. Targets are only kept when the request names them.
 */
export function selectToMark(docs: ReadStateDoc[], request: MarkReadRequest): string[] {
  const target = request.kind === 'ids' ? new Set(request.ids) : null
  const out: string[] = []
  for (const doc of docs) {
    if (doc.read === true) continue
    if (target && !target.has(doc.id)) continue
    out.push(doc.id)
  }
  return out
}

/** Splits work into commits that respect Firestore's 500-write limit. */
export function chunk<T>(items: T[], size: number = ADMIN_NOTIFICATION_BATCH_SIZE): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1')
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size))
  return pages
}

/**
 * Decides whether the paging loop should request another page.
 *
 * It continues only while a page came back full *and* the caller has not hit the ceiling. A short
 * page is proof there is no more to read, so the loop ends without a wasted extra query.
 */
export function shouldFetchAnotherPage(input: {
  pageSize: number
  pageLimit: number
  pagesFetched: number
}): boolean {
  return input.pageSize >= input.pageLimit && input.pagesFetched < ADMIN_NOTIFICATION_MAX_PAGES
}

export type MarkReadOutcome = {
  /** Documents actually flipped to read in this request. */
  marked: number
  /** True when the ceiling was hit and unread notifications may remain. */
  truncated: boolean
}

/**
 * Folds per-page results into the number the UI shows.
 *
 * `marked` must reflect what really changed: the old routine returned a count that was discarded,
 * so the page could say "All notifications marked as read" while Firestore had rejected the write.
 */
export function foldPages(pageCounts: number[], pagesFetched: number): MarkReadOutcome {
  return {
    marked: pageCounts.reduce((sum, n) => sum + n, 0),
    truncated: pagesFetched >= ADMIN_NOTIFICATION_MAX_PAGES,
  }
}
