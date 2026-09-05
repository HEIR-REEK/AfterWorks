import { NextRequest } from 'next/server'
import { attemptSnapshot, securityChecks } from '@/lib/security'
import { guardCacheStats } from '@/lib/guard-cache'
import { audit, fail, json, requireAdmin, routeError, consumeBucket } from '@/lib/guards'
import { envBool, envInt, isProduction, sanitizeLine } from '@/lib/security-core'
import { resolveMaintenance } from '@/lib/maintenance-shared'

/**
 * /api/admin — aggregate console data.
 *
 * GET  /api/admin            → metrics snapshot (server-aggregated, cached) + posture
 * PATCH /api/admin           → operator actions that only the server may perform:
 *                              { action: 'revoke-sessions' | 'revoke-session' | 'unlock' | 'broadcast' }
 *
 * The overview page used to open six live Firestore listeners (every user doc, every application,
 * every transaction) to render eight numbers. That is ~O(collection) reads on every admin paint,
 * it leaks the entire user table into the browser, and it breaks the moment the data outgrows the
 * tab. Aggregation now happens once on the server behind a short cache, and the client polls.
 */

export const dynamic = 'force-dynamic'

type CacheEntry = { at: number; payload: unknown }
const globalCache = globalThis as unknown as { __awAdminStatsCache?: CacheEntry }
const STATS_TTL_MS = () => Math.max(5_000, envInt('ADMIN_STATS_CACHE_MS', 20_000))

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const cache = globalCache.__awAdminStatsCache
  const now = Date.now()
  const forced = req.nextUrl.searchParams.get('refresh') === '1'
  if (!forced && cache && now - cache.at < STATS_TTL_MS()) {
    const res = json({ ...forceObject(cache.payload), cached: true, ageSeconds: Math.round((now - cache.at) / 1000) })
    res.headers.set('X-Stats-Cache', `HIT age=${Math.round((now - cache.at) / 1000)}s`)
    return res
  }

  try {
    const { getPlatformStats, isFirebaseAdminUsable, recentActivity } = await import('@/lib/firestore-admin')
    if (!isFirebaseAdminUsable()) {
      return fail(503, 'Firestore is not reachable from the server, so live metrics are unavailable.', {
        code: 'storage_unavailable',
      })
    }

    // One round trip: aggregate metrics plus the tail of the audit ledger for the activity ticker.
    const [stats, activity] = await Promise.all([getPlatformStats(), recentActivity(10)])
    const payload = {
      ok: true,
      ...stats,
      activity,
      security: {
        ...stats.security,
        lockouts: attemptSnapshot(),
        posture: securityChecks({
          firestoreAdminOk: isFirebaseAdminUsable(),
          maintenanceEdgeGate: envBool('MAINTENANCE_EDGE_GATE', true),
        }),
        caches: guardCacheStats(),
        sessionPolicy: {
          cookieOnly: true,
          sameSite: 'strict',
          revocable: true,
          production: isProduction(),
        },
      },
      maintenanceStatus: resolveMaintenance(stats.maintenance),
      generatedAt: new Date().toISOString(),
    }

    globalCache.__awAdminStatsCache = { at: Date.now(), payload }
    const res = json(payload)
    res.headers.set('X-Stats-Cache', 'MISS')
    return res
  } catch (err) {
    return routeError('admin:GET', err)
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('admin-actions', 12, 60_000, String(guard.value.jti).slice(0, 12))
  if (!bucket.ok) return fail(429, 'Operator actions are rate limited. Please wait a moment.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 32_000) return fail(413, 'Payload is too large.', { code: 'payload_too_large' })
    body = JSON.parse(raw || '{}')
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }

  const action = String(body.action ?? '')

  // Role split: staff may leave audit notes; revoking sessions, clearing lockouts and flushing
  // caches are security operations reserved for the main administrator.
  if (guard.value.role !== 'owner' && action !== 'note') {
    return fail(403, 'This operator action is restricted to the main administrator.', { code: 'owner_only' })
  }

  try {
    const firestore = await import('@/lib/firestore-admin')

    switch (action) {
      case 'revoke-sessions': {
        if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Storage unavailable.', { code: 'storage_unavailable' })
        const reason = sanitizeLine(body.reason ?? '', 400)
        const at = await firestore.revokeAllAdminSessionsWithReason(guard.value.email, reason)
        const { clearRevocationCache, invalidateAdminCache } = await import('@/lib/guards')
        clearRevocationCache()
        invalidateAdminCache()
        return json({ ok: true, revokedBefore: new Date(at).toISOString(), note: 'Every console session issued before this moment is now invalid.' })
      }

      case 'revoke-session': {
        const jti = String(body.jti ?? '').slice(0, 80)
        if (!jti) return fail(400, 'A session id is required.', { code: 'missing_jti' })
        const reason = sanitizeLine(body.reason ?? '', 400)
        await firestore.revokeAdminSession(jti, guard.value.email)
        if (reason) {
          await audit({
            action: 'ADMIN_SESSION_REVOKE_REASON',
            actorEmail: guard.value.email,
            details: { jti, reason },
            req,
          })
        }
        const { clearRevocationCache } = await import('@/lib/guards')
        clearRevocationCache()
        return json({ ok: true, revoked: jti, self: jti === guard.value.jti })
      }

      case 'unlock': {
        const { unlockIdentifier } = await import('@/lib/security')
        const fragment = String(body.fragment ?? '').trim()
        if (fragment.length < 3) return fail(400, 'Provide at least 3 characters to identify the lockout.', { code: 'weak_fragment' })
        const removed = unlockIdentifier(fragment)
        await audit({
          action: 'ADMIN_LOCKOUT_CLEARED',
          actorEmail: guard.value.email,
          details: { fragmentHash: fragment.length, removed },
          req,
        })
        return json({ ok: true, removed })
      }

      case 'note': {
        const reason = sanitizeLine(body.reason ?? '', 400)
        if (reason.length < 4) return fail(400, 'A note needs at least a few words.', { code: 'reason_required' })
        const target = sanitizeLine(body.target ?? '', 120)
        await audit({ action: 'ADMIN_NOTE', actorEmail: guard.value.email, details: { target, reason }, req })
        return json({ ok: true, note: 'Recorded in the audit log.' })
      }

      case 'refresh-cache': {
        delete globalCache.__awAdminStatsCache
        return json({ ok: true, cleared: true })
      }

      default:
        return fail(400, `Unsupported operator action "${action || '(blank)'}".`, { code: 'unknown_action' })
    }
  } catch (err) {
    return routeError('admin:PATCH', err)
  }
}

function forceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
