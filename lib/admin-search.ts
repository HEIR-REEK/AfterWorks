/**
 * Search rules shared by the admin console and the server reads behind it.
 *
 * Firestore has no substring search, and the console's old "search" filtered only the one page it
 * had already fetched. A member on page 4 whose name matched the query simply vanished. These
 * helpers make the contract explicit:
 *
 *   • the server scans a bounded window of the collection, applies the same predicate the UI
 *     describes, then pages the *filtered* rows;
 *   • the cursor is an offset tied to a fingerprint of the query, so changing the search or the
 *     status filter starts at row 1 instead of applying an old cursor to a new result set;
 *   • a scan that reaches its bound says so, rather than pretending the collection ended.
 *
 * Everything here is pure so the rules can be tested without Firestore.
 */

import type { Job, JobCategory } from '@/lib/afterworks-data'
import { ADMIN_MUTABLE_STATES } from '@/lib/admin-domain'

/** How many documents one admin search will inspect. */
export const ADMIN_SEARCH_SCAN_LIMIT = 1_000

export function normaliseSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : ''
}

/**
 * True when every word in the query appears somewhere in the record. Word-wise matching makes
 * "jane doe" find "Jane W. Doe" and "doe jane" find the same row, without a search index.
 */
export function matchesSearch(search: unknown, fields: Array<string | null | undefined>): boolean {
  const needle = normaliseSearch(search)
  if (!needle) return true
  const haystack = fields.filter(Boolean).join(' ').toLowerCase()
  return needle.split(' ').every((token) => haystack.includes(token))
}

function hash32(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** Opaque page cursor for a filtered result set. */
export function encodeSearchCursor(scope: string, offset: number): string {
  const safeOffset = Math.max(0, Math.floor(offset))
  return `s1_${hash32(scope)}_${safeOffset}`
}

/** Returns 0 when the cursor belongs to a different query, so a stale cursor cannot skip rows. */
export function decodeSearchCursor(cursor: string | null | undefined, scope: string): number {
  if (!cursor) return 0
  const match = /^s1_([a-z0-9]+)_(\d+)$/.exec(cursor)
  if (!match) return 0
  if (match[1] !== hash32(scope)) return 0
  const offset = Number(match[2])
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0
}

export type SearchPage<T> = {
  rows: T[]
  nextCursor: string | null
  hasMore: boolean
  offset: number
}

export function paginateSearchResults<T>(
  rows: T[],
  opts: { scope: string; pageSize: number; cursor?: string | null },
): SearchPage<T> {
  const pageSize = Math.max(1, Math.floor(opts.pageSize) || 25)
  const offset = decodeSearchCursor(opts.cursor, opts.scope)
  const page = rows.slice(offset, offset + pageSize)
  const nextOffset = offset + page.length
  return {
    rows: page,
    nextCursor: nextOffset < rows.length ? encodeSearchCursor(opts.scope, nextOffset) : null,
    hasMore: nextOffset < rows.length,
    offset,
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────

export type UserStateFilter =
  | 'all'
  | 'kyc_pending'
  | 'restricted'
  | 'admins'
  | (typeof ADMIN_MUTABLE_STATES)[number]

export function normaliseUserStateFilter(value: unknown): UserStateFilter {
  const state = typeof value === 'string' ? value.trim() : ''
  if (state === 'staff') return 'admins'
  if (state === 'kyc_pending' || state === 'restricted' || state === 'admins') return state
  if ((ADMIN_MUTABLE_STATES as readonly string[]).includes(state)) {
    return state as (typeof ADMIN_MUTABLE_STATES)[number]
  }
  return 'all'
}

export type AdminUserSearchRecord = {
  uid: string
  name?: string
  email?: string
  phone?: string
  payoutNumber?: string
  accountState?: string
  kycVerified?: boolean
  /** Set while a member is waiting for a review; cleared when one is decided. */
  kycRequestedAt?: string
  role?: string
  isAdmin?: boolean
}

export function userMatchesState(row: AdminUserSearchRecord, state: UserStateFilter): boolean {
  if (state === 'all') return true
  if (state === 'admins') return row.role === 'admin' || row.isAdmin === true
  const accountState = row.accountState || 'active'
  if (state === 'restricted') return accountState === 'suspended' || accountState === 'banned'
  if (state === 'kyc_pending') {
    // The review queue, not "everyone who is not verified yet". A member who never asked is not
    // waiting, and a member who was already declined is not waiting either — they were answered.
    // Without this the filter and the dashboard tile both counted the whole member base.
    return Boolean(row.kycRequestedAt) && row.kycVerified !== true
  }
  return accountState === state
}

export function userMatchesSearch(row: AdminUserSearchRecord, search: unknown): boolean {
  return matchesSearch(search, [row.uid, row.name, row.email, row.phone, row.payoutNumber])
}

// ─── Applications and money ──────────────────────────────────────────────────

export type ApplicationSearchRecord = {
  id: string
  jobId: string
  jobTitle: string
  workerUid: string
  workerEmail: string
  status?: string
}

export function applicationMatchesSearch(row: ApplicationSearchRecord, search: unknown): boolean {
  return matchesSearch(search, [
    row.id,
    row.jobId,
    row.jobTitle,
    row.workerUid,
    row.workerEmail,
    row.status,
  ])
}

export type PayoutSearchRecord = {
  uid: string
  email: string
  name: string
  requestedAt: string
  payoutReference: string
  destination: { accountNumber?: string }
}

export function payoutMatchesSearch(row: PayoutSearchRecord, search: unknown): boolean {
  return matchesSearch(search, [
    row.uid,
    row.email,
    row.name,
    row.requestedAt,
    row.destination?.accountNumber,
    row.payoutReference,
  ])
}

export type LedgerSearchRecord = {
  uid: string
  email: string
  reference: string
  label: string
}

export function ledgerMatchesSearch(row: LedgerSearchRecord, search: unknown): boolean {
  return matchesSearch(search, [row.uid, row.email, row.reference, row.label])
}

// ─── Catalogue ───────────────────────────────────────────────────────────────

export type JobSearchRecord = {
  id: string
  title: string
  category: string
  description: string
  responsibilities?: string[]
  status?: string
}

/** Free-text search used by `/jobs` and the console's catalogue table. */
export function jobMatchesSearch(job: JobSearchRecord, search: unknown): boolean {
  return matchesSearch(search, [
    job.id,
    job.title,
    job.category,
    job.description,
    ...(job.responsibilities ?? []),
    job.status,
  ])
}

export type JobBrowseFilters = {
  search?: string
  category?: JobCategory | 'All'
  trainingOnly?: boolean
  hideFull?: boolean
  now?: number
}

/** One predicate for the worker's board and its tests: category, training, availability, query. */
export function filterJobs<T extends Job>(jobs: T[], filters: JobBrowseFilters): T[] {
  const now = filters.now ?? Date.now()
  return jobs.filter((job) => {
    if (filters.category && filters.category !== 'All' && job.category !== filters.category) return false
    if (filters.trainingOnly && !job.trainingRequired) return false
    if (filters.hideFull) {
      if (job.status !== 'open') return false
      if (job.slotsRemaining <= 0) return false
      if (job.closesAt && Date.parse(job.closesAt) <= now) return false
    }
    if (!jobMatchesSearch(job, filters.search)) return false
    return true
  })
}
