import { NextRequest } from 'next/server'
import { consumeBucket, json, requireUser, routeError } from '@/lib/guards'
import { fetchMaintenanceSnapshot } from '@/lib/maintenance-shared'
import { isEmailWhitelisted } from '@/lib/maintenance-shared'
import { createBypassSession } from '@/lib/security'
import { isProduction } from '@/lib/security-core'

/**
 * POST /api/maintenance/bypass — "let this person through the blackout".
 *
 * The middleware cannot read a member's Firebase ID token, so an allow-list of staff emails would
 * be unenforceable at the edge. Instead: an authenticated member asks once, the server checks the
 * roster, and on success mints a short-lived signed bypass cookie that the edge can verify by
 * signature alone. It grants no data access — only passage around maintenance — and it is audited
 * implicitly by the maintenance route that created the list.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const guard = await requireUser(req)
  if (!guard.ok) return json({ allowed: false })

  const bucket = consumeBucket('maintenance-bypass', 6, 60_000, guard.value.uid)
  if (!bucket.ok) return json({ allowed: false, throttled: true })

  try {
    const { config } = await fetchMaintenanceSnapshot()
    const whitelisted = isEmailWhitelisted(guard.value.email, config)
    const allowed = whitelisted || guard.value.isAdmin

    if (!allowed) return json({ allowed: false, reason: 'not_on_list' })

    const res = json({
      allowed: true,
      expiresInHours: 12,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    })
    const token = await createBypassSession(guard.value.email)
    if (token) {
      res.cookies.set('aw_ops_bypass', token, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: 'lax',
        path: '/',
        maxAge: 12 * 60 * 60,
      })
    }
    return res
  } catch (err) {
    return routeError('maintenance/bypass', err)
  }
}
