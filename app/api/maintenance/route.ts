import { NextRequest } from 'next/server'
import { getCachedMaintenanceStatus, MAINTENANCE_REASONS } from '@/lib/maintenance-shared'
import { PUBLIC_SHORT_CACHE, fnv1a } from '@/lib/security-core'
import { json } from '@/lib/guards'
import { site } from '@/lib/site'

/**
 * GET /api/maintenance — the public maintenance snapshot.
 *
 * Two consumers:
 *  • the browser (AppGate / outage banner), which otherwise depends on a live Firestore listener
 *    and silently shows "everything is fine" when that listener is blocked;
 *  • uptime monitors and the /status page, which must be able to tell 200 from 503 without
 *    executing JavaScript.
 *
 * It returns a *public* projection only: copy, timing and service states. The bypass list and the
 * operator's email are never included — a worker does not learn which accounts skip the gate.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { status } = await getCachedMaintenanceStatus({ force: req.headers.get('cache-control')?.includes('no-cache') ?? false })
  const config = status.config
  const etag = `"m${config.version}-${status.active ? 'on' : 'off'}-${config.mode}"`

  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...PUBLIC_SHORT_CACHE } })
  }

  const payload = {
    ok: true,
    enabled: status.active || status.bannerOnly,
    blocking: status.active,
    bannerOnly: status.bannerOnly,
    scheduled: status.pending,
    mode: config.mode,
    title: status.active || status.bannerOnly ? config.title : '',
    message: status.active || status.bannerOnly ? config.message : '',
    banner: status.bannerOnly ? config.banner : '',
    reason: config.reason,
    reasonLabel: MAINTENANCE_REASONS[config.reason],
    estimatedEnd: config.estimatedEnd,
    scheduledStart: config.scheduledStart,
    remainingMs: status.remainingMs,
    retryAfterSec: status.retryAfterSec,
    services: config.affectedServices.map((s) => ({
      id: s.id,
      label: s.label,
      status: status.active ? (s.status === 'operational' ? 'maintenance' : s.status) : s.status,
      note: s.note ?? '',
    })),
    contactEmail: config.contactEmail || site.supportEmail,
    version: config.version,
    updatedAt: config.updatedAt,
    bypassHint: config.allowedEmails.length > 0,
    /** Opaque hint for ops dashboards — never a bypass token. */
    configHash: fnv1a(`${config.version}:${config.enabled}:${config.mode}:${config.estimatedEnd ?? ''}`, 8),
    serverTime: new Date().toISOString(),
  }

  if (status.active) {
    const res = json({ ...payload, error: 'The platform is inside a maintenance window.' }, { status: 503 })
    res.headers.set('Retry-After', String(status.retryAfterSec || 300))
    res.headers.set('X-Maintenance-Mode', 'blackout')
    res.headers.set('ETag', etag)
    res.headers.set('Cache-Control', 'public, max-age=10, s-maxage=15')
    return res
  }

  const res = json(payload)
  res.headers.set('ETag', etag)
  res.headers.set('X-Maintenance-Mode', status.bannerOnly ? 'banner' : 'off')
  for (const [key, value] of Object.entries(PUBLIC_SHORT_CACHE)) res.headers.set(key, value)
  return res
}
