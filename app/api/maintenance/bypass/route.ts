import { NextRequest } from 'next/server'
import { audit, consumeBucket, json, requireUser, resolveAdminRole, routeError } from '@/lib/guards'
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
    // The bypass roster is server-only; read it with the Admin SDK, never from the public
    // `system/maintenance` document (which deliberately no longer contains the list).
    const { getMaintenanceConfigServer } = await import('@/lib/firestore-admin')
    const config = await getMaintenanceConfigServer()
    const whitelisted = isEmailWhitelisted(guard.value.email, config)
    // The `isAdmin` field on a member profile is a mutable label, not a console credential. Re-resolve the
    // operator from the server-owned roster/staff collection before minting an edge bypass.
    const role = await resolveAdminRole(guard.value.email)
    const allowed = whitelisted || role !== null

    if (!allowed) return json({ allowed: false, reason: 'not_on_list' })

    const token = await createBypassSession(guard.value.email)
    if (!token) {
      // No signing secret means the edge cannot verify a bypass. Saying "allowed" would be a lie;
      // the member would still be held at the maintenance page.
      return json({ allowed: false, reason: 'bypass_unavailable' })
    }
    const res = json({
      allowed: true,
      expiresInHours: 12,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    })
    res.cookies.set('aw_ops_bypass', token, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 60 * 60,
    })
    // Every mint is audited. The maintenance cookie is an operator action, and a bypass that left
    // no trace is exactly what an incident review cannot reconstruct.
    await audit({
      action: 'MAINTENANCE_BYPASS_GRANTED',
      actorEmail: guard.value.email,
      details: { role: role ?? 'whitelist', expiresInHours: 12 },
      req,
    })
    return res
  } catch (err) {
    return routeError('maintenance/bypass', err)
  }
}
