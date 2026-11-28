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
  const entitlements = await requestEntitlements(req, knownUid)
  return entitlements.unlockedRegions
}

/**
 * The member's price entitlements, read once: which regions they may work, and which cards on their
 * own board they have paid for.
 *
 * Both come from the same profile read because every card action needs both — a foreign card is
 * unlocked by its region, a card on the member's own board by its own fee. Splitting them into two
 * reads would be two chances to disagree.
 */
export async function requestEntitlements(
  req: NextRequest,
  knownUid?: string,
): Promise<{ unlockedRegions: PayRegion[]; paidCards: string[] }> {
  const none = { unlockedRegions: [] as PayRegion[], paidCards: [] as string[] }
  try {
    let uid = knownUid ?? ''
    if (!uid) {
      const bearer = (req.headers.get('authorization') || '').replace(/^Bearer /i, '').trim()
      if (!bearer) return none
      const { verifyIdToken } = await import('@/lib/firestore-admin')
      const decoded = await verifyIdToken(bearer)
      uid = decoded?.uid ?? ''
    }
    if (!uid) return none
    const { dbOrNull } = await import('@/lib/firestore-admin')
    const db = dbOrNull()
    if (!db) return none
    const snap = await db.collection('users').doc(uid).get()
    if (!snap.exists) return none
    const raw = (snap.data() ?? {}) as Record<string, unknown>
    const paidCards = Array.isArray(raw.paidTrainings)
      ? (raw.paidTrainings as unknown[]).filter((v): v is string => typeof v === 'string' && v !== '')
      : []
    const list = Array.isArray(raw.unlockedPriceRegions) ? raw.unlockedPriceRegions : []
    const known: PayRegion[] = ['Africa', 'Americas', 'Europe', 'Asia']
    const out: PayRegion[] = []
    for (const value of list) {
      const region = String(value ?? '').trim() as PayRegion
      if (known.includes(region) && !out.includes(region)) out.push(region)
    }
    return { unlockedRegions: out, paidCards }
  } catch {
    return none
  }
}

/**
 * Refuse a card that states a fee the member has not paid.
 *
 * The gate that makes a fee mean something, on the server, for every entry point that can start a
 * card's work — the assessment questions, the scoring call, and the apply. Without it the charged
 * state is cosmetic: hiding the button in the page leaves the route open, which is exactly how a
 * "priced" card ends up being worked for free.
 *
 * Two ways to be paid up, and they are deliberately different things:
 *  • the card's own fee was bought (`paidTrainings`, the per-card charge), or
 *   * the card's region was bought (`unlockedPriceRegions`, the price-access charge).
 *
 * A card with no fee, or the member's own free board, is always fine. Storage trouble fails *open*
 * here, unlike the region list: a database blip must not lock a member out of work they have paid
 * for, and the money question is answered by a profile the route already read.
 */
export function unpaidCardRefusal(input: {
  card: { id?: unknown; title?: unknown; region?: unknown; trainingFeeUsd?: unknown; trainingRequired?: unknown } | null
  resolvedRegion: PayRegion | null
  paidCards: readonly string[]
  unlockedRegions: readonly string[]
}): { message: string; code: 'payment_required'; jobRegion: string; feeUsd: number } | null {
  const card = input.card
  if (!card) return null
  const fee = Number(card.trainingFeeUsd ?? 0) || 0
  if (fee <= 0) return null

  const cardRegion = String(card.region ?? '')
  // Unknown region is *not* the same as "mine". A geo outage must not turn every foreign card into a
  // free one, so the card is only treated as the member's own when the regions genuinely match (or
  // the card is global). Everything else has to clear one of the two entitlements.
  const ownBoard = cardRegion === '' || (input.resolvedRegion !== null && cardRegion === input.resolvedRegion)
  // A foreign card is paid for by its region's price, whatever its own fee says. When the region is
  // unresolved, either entitlement is honoured — a member who has paid is never blocked, and one who
  // has not is still refused.
  if (!ownBoard) {
    if (input.unlockedRegions.includes(cardRegion)) return null
    if (input.resolvedRegion === null && input.paidCards.includes(String(card.id ?? ''))) return null
    return {
      code: 'payment_required',
      jobRegion: cardRegion,
      feeUsd: fee,
      message: `“${String(card.title ?? 'This job')}” is priced for ${cardRegion}. Pay to access ${cardRegion} job prices to work it — $${fee.toFixed(2)}, paid once for the whole region.`,
    }
  }
  // On the member's own board: the card's own fee is the gate, and only a training card has one.
  if (card.trainingRequired !== true) return null
  if (input.paidCards.includes(String(card.id ?? ''))) return null
  return {
    code: 'payment_required',
    jobRegion: cardRegion,
    feeUsd: fee,
    message: `“${String(card.title ?? 'This job')}” has a $${fee.toFixed(2)} access fee that has not been paid, so its course and task are still locked. Pay it from the card to start.`,
  }
}
