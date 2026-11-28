/**
 * The server-side answer to "may this member act on this card?".
 *
 * Cards from every region are now sent to the browser so members can see other regions' work,
 * prices and details — blurred. That is a deliberate product decision, and it means the blur is
 * cosmetic: anyone can remove it with a devtools stylesheet edit. So the enforcement that matters
 * lives here, on the server, and covers the three things a card actually does:
 *
 *   • **Take its assessment** — `app/api/assessments` (GET and POST).
 *   • **Pay its training fee** — `app/api/paystack/initialize`.
 *   • **Apply for it** — `app/api/applications`.
 *
 * One helper, called by all of them, because three hand-written copies is how a fourth entry point
 * ends up forgotten. Every refusal carries the same code (`region_locked`) so the UI can show one
 * message and the client cannot mistake it for a retryable error.
 *
 * Read the request, never the profile: the platform asked for a member who connects from the
 * Americas to get the Americas board, VPN included, so the region is resolved from *this* request.
 * The lookup is cheap — a header read in the common case — and it fails open, because a geo outage
 * must never stop a member working.
 */

import type { NextRequest } from 'next/server'
import { clientIdentity } from '@/lib/security-core'
import { resolveRequestCountry } from '@/lib/geo-country'
import { regionForCountry, type PayRegion } from '@/lib/pay-regions'
import { jobActionRefusal } from '@/lib/job-regions'

export type JobGate =
  | { ok: true; region: PayRegion | null; unlockedRegions: PayRegion[] }
  | { ok: false; message: string; jobRegion: string; region: PayRegion | null; unlockedRegions: PayRegion[] }

/** The region this request is connecting from, or `null` when nothing could resolve it. */
export async function requestRegion(req: NextRequest): Promise<PayRegion | null> {
  try {
    const identity = clientIdentity(req.headers)
    const resolved = await resolveRequestCountry(req.headers, identity.ip)
    return resolved.country ? regionForCountry(resolved.country) : null
  } catch {
    return null
  }
}

/**
 * Check a job card against the region this request comes from.
 *
 * A missing job returns `ok` — the caller's own "no such job" handling gives a better message than
 * a region error for a card that does not exist.
 */
export async function checkJobRegion(
  req: NextRequest,
  job: { region?: unknown; title?: unknown } | null | undefined,
  unlockedRegions: readonly string[] = [],
): Promise<JobGate> {
  if (!job) return { ok: true, region: null, unlockedRegions: [...unlockedRegions] as PayRegion[] }
  const region = await requestRegion(req)
  const unlocked = [...unlockedRegions] as PayRegion[]
  const refusal = jobActionRefusal(job, { region, unlockedRegions: unlocked })
  if (!refusal) return { ok: true, region, unlockedRegions: unlocked }
  return { ok: false, region, unlockedRegions: unlocked, message: refusal.message, jobRegion: refusal.jobRegion }
}

/**
 * Load just enough of a job document to decide, and check it in one call.
 *
 * Used by the routes that only have an id (assessment, checkout). Returns `null` when the card does
 * not exist so the caller can keep its own 404 path; otherwise the gate result.
 */
export async function gateJobId(
  req: NextRequest,
  jobId: string,
  /** The signed-in member, when the caller already resolved them — saves a second token verify. */
  uid?: string,
): Promise<{ gate: JobGate; job: Record<string, unknown> | null }> {
  const job = await loadJobCard(jobId)
  // No card anywhere: the caller's own "no such job" handling gives a better message than a region
  // error for a job that does not exist.
  if (!job) return { gate: { ok: true, region: null, unlockedRegions: [] }, job: null }
  return { gate: await checkJobRegion(req, job, await requestUnlockedRegions(req, uid)), job }
}

/**
 * Load one card without judging it — the job document if it is stored, else the generated listing.
 *
 * Split out of `gateJobId` for the checkout, which must *not* gate on the region: selling a region's
 * price tier is the one action that has to work from outside that region. It still needs the card, to
 * know which tier a legacy `jobId` request means and what fee that tier states.
 */
export async function loadJobCard(jobId: string): Promise<Record<string, unknown> | null> {
  let job: Record<string, unknown> | null = null
  try {
    const { dbOrNull } = await import('@/lib/firestore-admin')
    const db = dbOrNull()
    if (db) {
      const snap = await db.collection('jobs').doc(jobId).get()
      if (snap.exists) job = (snap.data() ?? {}) as Record<string, unknown>
    }
  } catch {
    // Storage trouble is not a region problem: fall through to the generated listings, and let the
    // caller report the miss in its own words if nothing turns up.
  }
  if (!job) {
    try {
      const { findListingCard } = await import('@/lib/job-cards')
      const card = findListingCard(jobId)
      if (card) job = card as unknown as Record<string, unknown>
    } catch {
      /* a broken import must not turn into a region refusal */
    }
  }
  return job
}

/**
 * The price tiers this member has paid to work.
 *
 * Read from their own profile document, by uid, on the server — not from a header, a cookie or the
 * request body. A member's *own* board is decided by where they connect from; the *other* boards
 * they may work are decided by what they paid for, and this is that list.
 *
 * Fails closed to an empty list on any storage trouble. That is the safe direction: the cost of
 * failing closed is a member briefly told to unlock a region they already own, whereas failing open
 * would hand the whole catalogue to everyone and quietly delete the price tiers.
 */
export async function requestUnlockedRegions(req: NextRequest, knownUid?: string): Promise<PayRegion[]> {
  try {
    let uid = knownUid ?? ''
    if (!uid) {
      const bearer = (req.headers.get('authorization') || '').replace(/^Bearer /i, '').trim()
      if (!bearer) return []
      const { verifyIdToken } = await import('@/lib/firestore-admin')
      const decoded = await verifyIdToken(bearer)
      uid = decoded?.uid ?? ''
    }
    if (!uid) return []
    const { dbOrNull } = await import('@/lib/firestore-admin')
    const db = dbOrNull()
    if (!db) return []
    const snap = await db.collection('users').doc(uid).get()
    if (!snap.exists) return []
    const raw = (snap.data() ?? {}) as Record<string, unknown>
    const list = Array.isArray(raw.unlockedPriceRegions) ? raw.unlockedPriceRegions : []
    const known: PayRegion[] = ['Africa', 'Americas', 'Europe', 'Asia']
    const out: PayRegion[] = []
    for (const value of list) {
      const region = String(value ?? '').trim() as PayRegion
      if (known.includes(region) && !out.includes(region)) out.push(region)
    }
    return out
  } catch {
    return []
  }
}
