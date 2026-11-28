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
  | { ok: true; region: PayRegion | null }
  | { ok: false; message: string; jobRegion: string; region: PayRegion | null }

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
): Promise<JobGate> {
  if (!job) return { ok: true, region: null }
  const region = await requestRegion(req)
  const refusal = jobActionRefusal(job, { region })
  if (!refusal) return { ok: true, region }
  return { ok: false, region, message: refusal.message, jobRegion: refusal.jobRegion }
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
): Promise<{ gate: JobGate; job: Record<string, unknown> | null }> {
  let job: Record<string, unknown> | null = null
  try {
    const { dbOrNull } = await import('@/lib/firestore-admin')
    const db = dbOrNull()
    if (db) {
      const snap = await db.collection('jobs').doc(jobId).get()
      if (snap.exists) job = (snap.data() ?? {}) as Record<string, unknown>
    }
  } catch {
    // Storage trouble is not a region problem: let the route report it in its own words. The
    // listing lookup below may still identify the card, so fall through rather than returning.
  }

  // The generated sample listings are served from a module, not from Firestore, so a missing
  // document is expected for them. Resolve the card here, or a member could take another board's
  // assessment and apply to it simply because no document exists to check.
  if (!job) {
    try {
      const { findListingCard } = await import('@/lib/job-cards')
      const card = findListingCard(jobId)
      if (card) job = card as unknown as Record<string, unknown>
    } catch {
      /* a broken import must not turn into a region refusal */
    }
  }

  // No card anywhere: the caller's own "no such job" handling gives a better message than a region
  // error for a job that does not exist.
  if (!job) return { gate: { ok: true, region: null }, job: null }
  return { gate: await checkJobRegion(req, job), job }
}
