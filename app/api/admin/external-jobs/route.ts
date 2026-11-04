import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, requireAdmin, requireOwner, routeError } from '@/lib/guards'
import { clampNumber, readJsonBody, sanitizeLine } from '@/lib/security-core'
import { isAdzunaCountry } from '@/lib/adzuna'
import {
  ADZUNA_MAX_PAGES,
  AdzunaError,
  adzunaConfiguration,
  isAdzunaConfigured,
} from '@/lib/adzuna-server'
import {
  clearExternalJobs,
  getExternalJobsAdminSnapshot,
  syncAdzunaFeed,
} from '@/lib/external-jobs-server'

/**
 * /api/admin/external-jobs — the Adzuna import desk.
 *
 * Importing is owner authority, like catalogue authoring: it decides what appears on a public
 * page and consumes a third-party API quota. Reading the current status and preview is open to
 * staff so the QA desk can answer "is the external feed current?" without a credential.
 *
 * No route here returns the Adzuna key, the upstream URL or an upstream response body.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function adzunaFailure(err: AdzunaError) {
  switch (err.code) {
    case 'not_configured':
      return fail(503, err.message, { code: 'adzuna_not_configured' })
    case 'invalid_country':
      return fail(400, err.message, { code: 'adzuna_country_unsupported' })
    case 'unauthorised':
      return fail(502, err.message, { code: 'adzuna_unauthorised' })
    case 'rate_limited':
      return fail(503, err.message, { code: 'adzuna_rate_limited', headers: { 'Retry-After': '60' } })
    case 'invalid_response':
      return fail(502, err.message, { code: 'adzuna_invalid_response' })
    default:
      return fail(502, err.message, { code: 'adzuna_upstream_error' })
  }
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response
  try {
    const snapshot = await getExternalJobsAdminSnapshot()
    return json({ ok: true, ...snapshot })
  } catch (err) {
    return routeError('admin/external-jobs:GET', err)
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  // A sync fans out to up to five upstream pages, so the bucket is deliberately tighter than the
  // catalogue editor's. Three per minute is plenty for an operator and unkind to a runaway loop.
  const bucket = consumeBucket('admin-external-jobs', 3, 60_000, String(guard.value.jti).slice(0, 12))
  if (!bucket.ok) {
    return fail(429, 'External imports are rate limited. Please wait before trying again.', {
      headers: { 'Retry-After': String(bucket.retryAfterSec) },
    })
  }

  const parsed = await readJsonBody<Record<string, unknown>>(req, 8 * 1024)
  if (!parsed.ok) return fail(400, parsed.error, { code: 'bad_request' })

  const configuration = adzunaConfiguration()
  const requestedCountry = sanitizeLine(parsed.data.country, 8).toLowerCase()
  const country = requestedCountry || configuration.country
  if (!isAdzunaCountry(country)) {
    return fail(
      400,
      'Adzuna does not cover that country. Choose one of its supported markets; Kenya is not currently in the Adzuna country list.',
      { code: 'adzuna_country_unsupported' },
    )
  }
  if (!isAdzunaConfigured()) {
    return fail(
      503,
      'Adzuna is not configured on this deployment. Set ADZUNA_APP_ID and ADZUNA_APP_KEY, then redeploy.',
      { code: 'adzuna_not_configured' },
    )
  }

  const what = sanitizeLine(parsed.data.what, 80)
  const where = sanitizeLine(parsed.data.where, 80)
  const pages = clampNumber(parsed.data.pages, { min: 1, max: ADZUNA_MAX_PAGES, fallback: 2 })

  try {
    const result = await syncAdzunaFeed({
      country,
      what,
      where,
      pages,
      actorEmail: guard.value.email,
    })
    await audit({
      action: 'EXTERNAL_JOBS_SYNCED',
      actorEmail: guard.value.email,
      details: {
        source: 'adzuna',
        country: result.country,
        what: result.what,
        where: result.where,
        pages: result.pages,
        stored: result.stored,
        removed: result.removed,
        sourceCount: result.sourceCount,
      },
      req,
    })
    return json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof AdzunaError) return adzunaFailure(err)
    const message = err instanceof Error ? err.message : ''
    if (message === 'storage_unavailable') {
      return fail(503, 'Storage is unavailable, so the external feed was not changed.', {
        code: 'storage_unavailable',
      })
    }
    return routeError('admin/external-jobs:POST', err)
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  const parsed = await readJsonBody<Record<string, unknown>>(req, 4 * 1024)
  if (!parsed.ok) return fail(400, parsed.error, { code: 'bad_request' })
  const reason = sanitizeLine(parsed.data.reason, 300)
  if (reason.length < 4) {
    return fail(400, 'Write a short reason for removing the external feed.', { code: 'reason_required' })
  }

  try {
    const removed = await clearExternalJobs()
    await audit({
      action: 'EXTERNAL_JOBS_CLEARED',
      actorEmail: guard.value.email,
      details: { source: 'adzuna', removed, reason },
      req,
    })
    return json({ ok: true, removed })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message === 'storage_unavailable') {
      return fail(503, 'Storage is unavailable, so the external feed was not changed.', {
        code: 'storage_unavailable',
      })
    }
    return routeError('admin/external-jobs:DELETE', err)
  }
}
