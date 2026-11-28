import { NextRequest } from 'next/server'
import { fail, json, requireUser, routeError } from '@/lib/guards'
import { clientIdentity } from '@/lib/security-core'
import { resolveRequestCountry } from '@/lib/geo-country'
import { regionForCountry } from '@/lib/pay-regions'
import { buildRegionalCatalogue, type JobRegion } from '@/lib/job-regions'

/**
 * GET /api/jobs/board — the job board this member may open, decided by where they connect from.
 *
 * The rule the platform asked for: a member in the Americas sees the Americas cards, everybody
 * else's cards are locked, and the same for every region. A VPN is not a problem to work around
 * here — connecting from America *is* how a member says they want the American board.
 *
 * Why this is a route and not a filter in the browser: the board is read client-side through the
 * Firestore SDK, and the value that decides the region is the request IP, which the browser holds.
 * A filter in the client would be advice, not a rule. So the region is resolved from the request
 * headers on the server and the response contains only the cards the member may open. The locked
 * regions are described by name, blurb and count — never by card payload, because a blurred card
 * still carries its id, title and price.
 *
 * Signed in: the board itself is member content, and an open endpoint that fans out to a geo lookup
 * keyed by caller-controlled IP is a free amplification target. Unauthenticated visitors get the
 * public listing instead (`app/jobs/page.tsx`).
 *
 * Fails open when no geo source can resolve a region: the whole catalogue is returned and
 * `wholeCatalogue: true` is set. Locking is a pricing decision, not a security boundary, and a blank
 * board caused by our own missing configuration would look like the site is broken.
 */

export const dynamic = 'force-dynamic'

const CARD_FIELDS = [
  'id',
  'title',
  'category',
  'description',
  'responsibilities',
  'payAmountUsd',
  'region',
  'estimatedMinutes',
  'capacity',
  'slotsRemaining',
  'trainingRequired',
  'trainingFeeUsd',
  'requiresVerified',
  'status',
  'closesAt',
  'postedAgo',
] as const

/** Project a job document down to what a card renders. The answer key never leaves the server. */
function toCard(id: string, raw: Record<string, unknown>): Record<string, unknown> {
  const card: Record<string, unknown> = { id }
  for (const field of CARD_FIELDS) {
    if (field === 'id') continue
    if (field in raw) card[field] = raw[field]
  }
  return card
}

export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  try {
    const { dbOrNull } = await import('@/lib/firestore-admin')
    const db = dbOrNull()
    if (!db) return json({ ok: true, jobs: [], lockedRegions: [], wholeCatalogue: true, unavailable: true })

    // Resolve where this request is coming from. Header first, then the configured lookup service;
    // `null` means we genuinely cannot tell, which the catalogue handles by opening everything.
    const identity = clientIdentity(req.headers)
    const resolved = await resolveRequestCountry(req.headers, identity.ip)
    const region: JobRegion | null = resolved.country ? regionForCountry(resolved.country) : null

    const cap = Math.min(200, Math.max(10, Number(req.nextUrl.searchParams.get('limit') ?? 120)))
    const snap = await db.collection('jobs').limit(cap).get()
    const cards = snap.docs.map((doc) => toCard(doc.id, (doc.data() ?? {}) as Record<string, unknown>))

    const board = buildRegionalCatalogue(
      cards.map((card) => ({ ...card, region: card.region as string | undefined })),
      { region, source: resolved.source },
    )

    return json(
      {
        ok: true,
        region: board.region,
        source: board.source,
        wholeCatalogue: board.wholeCatalogue,
        jobs: board.jobs,
        regions: board.regions,
        lockedRegions: board.lockedRegions,
      },
      {
        headers: {
          // Per-member answer: never in a shared cache. A minute in the member's own browser saves
          // a lookup every time they switch tabs back to the board.
          'Cache-Control': 'private, max-age=60',
          // The response varies by where the request came from, and by the country headers, so a
          // cache in front of this must key on them rather than serving one region's board to all.
          Vary: 'CF-IPCountry, X-Vercel-IP-Country, CloudFront-Viewer-Country, CF-Connecting-IP, Cookie, Authorization',
        },
      },
    )
  } catch (err) {
    return routeError('jobs:board', err)
  }
}

/** Kept so a future POST can be added without re-importing the shape. */
export async function POST(req: NextRequest) {
  return fail(405, 'Use GET for the job board.', { code: 'method_not_allowed' })
}
