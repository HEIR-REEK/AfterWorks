import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, routeError } from '@/lib/guards'
import { clientIdentity } from '@/lib/security-core'
import { listExternalJobs } from '@/lib/external-jobs-server'

/**
 * GET /api/external-jobs — the stored company-hiring feed for the member board.
 *
 * This is a read of our own cached copy; it never calls Adzuna and never returns the app key.
 * The per-advert `redirectUrl` is stripped from the payload before it leaves the server, because
 * the cards show company details and advertised pay rather than sending the worker off-site for
 * every role. The required Adzuna attribution link is built from `attributionUrl`.
 *
 * The route is public because the same feed is rendered on the public external page; if there is
 * no imported feed it returns an empty list, never sample adverts.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const identity = clientIdentity(req.headers)
  const bucket = consumeBucket('external-jobs-read', 120, 60_000, identity.ipHash)
  if (!bucket.ok) {
    return fail(429, 'Too many requests. Please wait a moment.', {
      headers: { 'Retry-After': String(bucket.retryAfterSec) },
    })
  }

  try {
    const jobs = (await listExternalJobs()).map(({ redirectUrl: _redirectUrl, ...job }) => job)
    return json({ ok: true, jobs, count: jobs.length })
  } catch (err) {
    return routeError('external-jobs:GET', err)
  }
}
