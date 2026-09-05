import { NextRequest } from 'next/server'
import {
  DEFAULT_MAINTENANCE_CONFIG,
  isMaintenanceForced,
  resolveMaintenance,
  type MaintenanceConfig,
  type MaintenanceService,
} from '@/lib/maintenance-shared'
import { audit, consumeBucket, fail, json, requireOwner, routeError } from '@/lib/guards'
import { isEmailLike, parseEmailList, sanitizeLine, sanitizePlainText } from '@/lib/security-core'
import { normaliseBlockedPath } from '@/lib/maintenance-shared'
import { invalidateGuardCaches } from '@/lib/guard-cache'

/**
 * /api/admin/maintenance — the authoritative write path for the maintenance switch.
 *
 * Previously the admin page wrote `system/maintenance` straight from the browser with the client
 * Firebase SDK, which meant (a) anyone with a free Firebase account could unlock the platform and
 * rewrite the public notice, and (b) the *only* enforcement of maintenance mode was a React
 * component that a visitor can disable by not running JavaScript. Now writes go through an
 * authenticated, validated, audited endpoint, and the middleware enforces the result at the edge.
 */

export const dynamic = 'force-dynamic'

const EMAIL_CAP = 200

/**
 * What the console needs to know about the *effective* window. Kept in one place because the page
 * reuses the object after every save: a field missing here silently disappears from the UI after a
 * write, which reads as "my setting did not stick".
 */
function maintenanceStatusProjection(status: ReturnType<typeof resolveMaintenance>) {
  return {
    active: status.active,
    blocksAll: status.blocksAll,
    scope: status.scope,
    blockedPaths: status.blockedPaths,
    bannerOnly: status.bannerOnly,
    pending: status.pending,
    stale: status.stale,
    retryAfterSec: status.retryAfterSec,
    remainingMs: status.remainingMs,
    endsAt: status.endsAt,
    startsAt: status.startsAt,
  }
}

function validatePatch(body: Record<string, unknown>): { ok: true; patch: Partial<MaintenanceConfig> } | { ok: false; error: string } {
  const patch: Partial<MaintenanceConfig> = {}

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') return { ok: false, error: '`enabled` must be a boolean.' }
    patch.enabled = body.enabled
  }
  if ('mode' in body) {
    if (body.mode !== 'blackout' && body.mode !== 'banner') return { ok: false, error: '`mode` must be "blackout" or "banner".' }
    patch.mode = body.mode
  }
  if ('scope' in body) {
    if (body.scope !== 'full' && body.scope !== 'sections') return { ok: false, error: '`scope` must be "full" or "sections".' }
    patch.scope = body.scope
  }
  if ('blockedPaths' in body) {
    if (body.blockedPaths === null || body.blockedPaths === '') patch.blockedPaths = []
    else if (!Array.isArray(body.blockedPaths)) return { ok: false, error: '`blockedPaths` must be a list of paths.' }
    else {
      const paths = Array.from(
        new Set(
          (body.blockedPaths as unknown[])
            .map(normaliseBlockedPath)
            .filter((value): value is string => value !== null),
        ),
      )
      if (paths.length > 20) return { ok: false, error: 'At most 20 paths can be paused at once.' }
      patch.blockedPaths = paths
    }
  }
  if ('title' in body) patch.title = sanitizeLine(body.title, 90)
  if ('message' in body) patch.message = sanitizePlainText(body.message, 900)
  if ('banner' in body) patch.banner = sanitizeLine(body.banner, 200)
  if ('reason' in body) {
    const allowed = ['scheduled_upgrade', 'payment_settlement', 'fraud_review', 'security_patch', 'outage', 'other']
    if (typeof body.reason !== 'string' || !allowed.includes(body.reason)) return { ok: false, error: 'Unknown maintenance reason.' }
    patch.reason = body.reason as MaintenanceConfig['reason']
  }
  if ('autoResolve' in body) {
    if (typeof body.autoResolve !== 'boolean') return { ok: false, error: '`autoResolve` must be a boolean.' }
    patch.autoResolve = body.autoResolve
  }
  if ('allowSignIn' in body) {
    if (typeof body.allowSignIn !== 'boolean') return { ok: false, error: '`allowSignIn` must be a boolean.' }
    patch.allowSignIn = body.allowSignIn
  }
  if ('contactEmail' in body) {
    if (body.contactEmail === null || body.contactEmail === '') patch.contactEmail = ''
    else if (!isEmailLike(body.contactEmail)) return { ok: false, error: 'Support contact must be a valid email address.' }
    else patch.contactEmail = String(body.contactEmail).trim().toLowerCase()
  }
  if ('scheduledStart' in body) {
    if (body.scheduledStart === null || body.scheduledStart === '') patch.scheduledStart = null
    else {
      const t = new Date(String(body.scheduledStart))
      if (Number.isNaN(t.getTime())) return { ok: false, error: 'Start time is not a valid date.' }
      patch.scheduledStart = t.toISOString()
    }
  }
  if ('estimatedEnd' in body) {
    if (body.estimatedEnd === null || body.estimatedEnd === '') patch.estimatedEnd = null
    else {
      const t = new Date(String(body.estimatedEnd))
      if (Number.isNaN(t.getTime())) return { ok: false, error: 'Return time is not a valid date.' }
      patch.estimatedEnd = t.toISOString()
    }
  }
  if ('allowedEmails' in body) {
    const list = Array.isArray(body.allowedEmails)
      ? (body.allowedEmails as unknown[]).map((e) => String(e))
      : parseEmailList(body.allowedEmails)
    let invalidEntry = ''
    for (const entry of list) {
      if (!isEmailLike(entry)) {
        invalidEntry = entry
        break
      }
    }
    if (invalidEntry) return { ok: false, error: `Not a valid email: ${invalidEntry.slice(0, 40)}` }
    if (list.length > EMAIL_CAP) return { ok: false, error: `The bypass list is capped at ${EMAIL_CAP} addresses.` }
    patch.allowedEmails = Array.from(new Set(list.map((e) => e.trim().toLowerCase())))
  }
  if ('affectedServices' in body) {
    if (!Array.isArray(body.affectedServices)) return { ok: false, error: '`affectedServices` must be a list.' }
    patch.affectedServices = body.affectedServices
      .map((entry): MaintenanceService | null => {
        const item = (entry ?? {}) as Record<string, unknown>
        const id = sanitizeLine(item.id, 32).toLowerCase().replace(/[^a-z0-9-]/g, '-')
        if (!id) return null
        const status = ['operational', 'degraded', 'maintenance', 'outage'].includes(String(item.status))
          ? (String(item.status) as MaintenanceConfig['affectedServices'][number]['status'])
          : 'operational'
        return {
          id,
          label: sanitizeLine(item.label, 60) || id,
          status,
          note: item.note ? sanitizeLine(item.note, 120) : undefined,
        }
      })
      .filter((v): v is MaintenanceConfig['affectedServices'][number] => v !== null)
      .slice(0, 12)
  }

  // Cross-field sanity: an ETA in the past with auto-resolve on is how a window silently dies.
  if (patch.estimatedEnd && patch.enabled === true) {
    if (new Date(patch.estimatedEnd).getTime() <= Date.now() + 30_000) {
      return { ok: false, error: 'The estimated return time must be in the future (or clear it to run an open-ended window).' }
    }
  }
  if (patch.scheduledStart && patch.estimatedEnd && new Date(patch.scheduledStart) >= new Date(patch.estimatedEnd)) {
    return { ok: false, error: 'The scheduled start must be before the estimated return time.' }
  }

  return { ok: true, patch }
}

export async function GET(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  try {
    const { getMaintenanceConfigServer } = await import('@/lib/firestore-admin')
    const config = await getMaintenanceConfigServer()
    const status = resolveMaintenance(config)
    return json({
      forced: isMaintenanceForced(),
      ok: true,
      config,
      status: maintenanceStatusProjection(status),
      defaults: DEFAULT_MAINTENANCE_CONFIG,
    })
  } catch (err) {
    return routeError('admin/maintenance:GET', err)
  }
}

export async function PUT(req: NextRequest) {
  return save(req)
}

export async function PATCH(req: NextRequest) {
  return save(req)
}

async function save(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('admin-maintenance', 20, 60_000, guard.value.jti.slice(0, 12))
  if (!bucket.ok) return fail(429, 'Maintenance settings are being saved too quickly. Please wait.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 64_000) return fail(413, 'Settings payload is too large.', { code: 'payload_too_large' })
    body = JSON.parse(raw || '{}')
  } catch {
    return fail(400, 'Expected a JSON body.', { code: 'bad_request' })
  }

  const validated = validatePatch(body)
  if (!validated.ok) return fail(400, validated.error, { code: 'invalid_settings' })

  if (Object.keys(validated.patch).length === 0) {
    return fail(400, 'Nothing to save — no recognised fields were sent.', { code: 'empty_patch' })
  }

  try {
    const { isFirebaseAdminUsable, saveMaintenanceConfigServer } = await import('@/lib/firestore-admin')
    if (!isFirebaseAdminUsable()) {
      return fail(503, 'The server cannot reach Firestore to persist this change. Check FIREBASE_SERVICE_ACCOUNT_JSON.', {
        code: 'storage_unavailable',
      })
    }

    const { config, changed } = await saveMaintenanceConfigServer(validated.patch, guard.value.email)
    invalidateGuardCaches()

    const status = resolveMaintenance(config)
    await audit({
      action: 'MAINTENANCE_SETTINGS_SAVED',
      actorEmail: guard.value.email,
      details: { changed, enabled: config.enabled, mode: config.mode, version: config.version, estimatedEnd: config.estimatedEnd },
      req,
    })

    return json({
      ok: true,
      // If the environment is forcing a window, saving the document will not lift it — say so
      // instead of letting the operator believe the switch is broken.
      forced: isMaintenanceForced(),
      ...(isMaintenanceForced()
        ? {
            warning:
              'MAINTENANCE_FORCE is set in the deployment environment, so it overrides these settings. Traffic stays gated until that variable is removed (or set to off).',
          }
        : {}),
      config,
      changed,
      effective: maintenanceStatusProjection(status),
      savedAt: config.updatedAt,
    })
  } catch (err) {
    return routeError('admin/maintenance:PUT', err)
  }
}

/** Fast "flip it off" for an on-call operator (and for the outage banner). */
export async function DELETE(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response
  try {
    const { saveMaintenanceConfigServer } = await import('@/lib/firestore-admin')
    const { config } = await saveMaintenanceConfigServer(
      { enabled: false, scheduledStart: null, estimatedEnd: null },
      guard.value.email,
    )
    await audit({ action: 'MAINTENANCE_DISABLED', actorEmail: guard.value.email, details: { version: config.version, forcedOverride: isMaintenanceForced() }, req })
    return json({
      ok: true,
      config,
      effective: maintenanceStatusProjection(resolveMaintenance(config)),
      forced: isMaintenanceForced(),
      ...(isMaintenanceForced()
        ? { warning: 'The stored window is cleared, but MAINTENANCE_FORCE is still set in the environment — traffic stays gated until it is removed.' }
        : {}),
    })
  } catch (err) {
    return routeError('admin/maintenance:DELETE', err)
  }
}
