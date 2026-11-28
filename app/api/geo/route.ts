import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, requireUser, routeError } from '@/lib/guards'
import { clientIdentity, PUBLIC_SHORT_CACHE } from '@/lib/security-core'
import { resolveRequestCountry } from '@/lib/geo-country'

/**
 * GET /api/geo — where this request appears to come from, so the profile form can preselect a
 * country the device's clock cannot tell us about.
 *
 * The existing detector reads the browser's IANA time zone, which is the right answer for a normal
 * member and the wrong one for a member on a VPN: a tunnel changes the IP, not the handset. This
 * route answers from the *server's* view of the connection instead, which is the only place that
 * can see it.
 *
 * Signed in, because:
 *  • it is a per-member convenience, not a public feature;
 *  • an open endpoint that fans out to a geo service, keyed by caller-controlled IP, is a free
 *    amplification target for whoever finds it;
 *  • the IP it reasons about is then a real member's, and a rate limit exists to protect.
 *
 * The answer is a **guess** and is labelled as one by every caller. `country: null` means "we could
 * not tell" — it is never `KE` by default, because a wrong flag pre-selected on a form is worse
 * than an empty one.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('geo-country', 30, 60_000, guard.value.uid)
  if (!bucket.ok) return fail(429, 'Too many lookups. Please wait a moment.', { code: 'rate_limited' })

  try {
    const identity = clientIdentity(req.headers)
    const { country, source } = await resolveRequestCountry(req.headers, identity.ip)
    const body = json({ ok: true, country, source })
    // A per-member answer must not sit in a shared cache, but a minute in the member's own browser
    // saves a lookup every time they reopen the form.
    for (const [key, value] of Object.entries({ ...PUBLIC_SHORT_CACHE, 'Cache-Control': 'private, max-age=60' })) {
      body.headers.set(key, value)
    }
    return body
  } catch (err) {
    return routeError('geo', err)
  }
}
