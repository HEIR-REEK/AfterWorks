/**
 * GET /api/admin/kyc/diagnose — owner-only connection test for Didit.
 *
 * "Identity verification could not be started" is what the member sees for at least six different
 * faults: no API key, the wrong host, a revoked key, a workflow that belongs to another
 * application, no credits, or the provider being down. The browser must never see the provider's
 * answer, so the person who *can* fix it needs somewhere to read it. This route is that place.
 *
 * It reports configuration as booleans (never values), the API host, and the result of a live
 * `GET /v3/workflows/` read — the cheapest call that proves host + key + workflow together without
 * spending a verification credit. The owner-only gate is deliberate: the payload names
 * infrastructure, which is not day-to-day staff information.
 */

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, requireOwner, routeError } from '@/lib/guards'
import { diditConfig, diditConfigHint, probeDidit } from '@/lib/didit'

export async function GET(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  // Each run is a provider call; a refresh loop must not become a Didit rate-limit incident.
  const bucket = consumeBucket('admin-kyc-diagnose', 10, 60_000, String(guard.value.jti).slice(0, 12))
  if (!bucket.ok) {
    return fail(429, 'Too many connection tests. Please wait a moment.', {
      headers: { 'Retry-After': String(bucket.retryAfterSec) },
    })
  }

  try {
    const config = diditConfig()
    const probe = await probeDidit()

    // A deployment can be "configured" and still unusable: the host or the key is wrong. Report
    // the two separately so the fix is obvious rather than a hunt through the provider's console.
    const healthy = config.configured && probe.reachable && probe.status !== null && probe.status >= 200 && probe.status < 300 && probe.workflowFound

    await audit({
      action: 'KYC_DIAGNOSTIC_RUN',
      actorEmail: guard.value.email,
      details: {
        host: config.host,
        configured: config.configured,
        reachable: probe.reachable,
        status: probe.status,
        workflowFound: probe.workflowFound,
      },
      req,
    })

    return json({
      ok: true,
      healthy,
      config: {
        host: config.host,
        apiUrl: config.apiUrl,
        usesRegistrationHost: config.usesRegistrationHost,
        hasApiKey: config.hasApiKey,
        hasWorkflowId: config.hasWorkflowId,
        hasWebhookSecret: config.hasWebhookSecret,
        missing: config.missing,
      },
      probe,
      hint: diditConfigHint(),
    })
  } catch (err) {
    return routeError('KYC diagnostic', err)
  }
}
