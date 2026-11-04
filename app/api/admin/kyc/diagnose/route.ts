/**
 * GET /api/admin/kyc/diagnose — owner-only connection test for Didit.
 *
 * "Identity verification could not be started" is what the member sees for at least six different
 * faults: no API key, the wrong host, a revoked key, a workflow that belongs to another
 * application, no credits, or the provider being down. The browser must never see the provider's
 * answer, so the person who *can* fix it needs somewhere to read it. This route is that place.
 *
 * It reports configuration as booleans (never values), the API host, the result of a live
 * `GET /v3/workflows/` read, the live credit balance, and — the part that used to be missing —
 * the result of the call the member actually triggers, `POST /v3/session/`, run once under a
 * fixed probe identity Didit reuses. The workflow read alone passes for a key without
 * write:sessions, an application with no credits, a workflow id that only exists as an unpublished
 * draft, and a callback origin that is not on the allowed domains, which is how a broken
 * deployment came to report "Ready to verify" while every member failed. The owner-only gate is
 * deliberate: the payload names infrastructure, which is not day-to-day staff information.
 */

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, requireOwner, routeError } from '@/lib/guards'
import { callbackTarget, diditConfig, diditConfigHint, probeDidit, probeDiditBilling, probeDiditSession } from '@/lib/didit'
import { publicOriginFor } from '@/lib/security-core'

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

    // The connection test proves the *provider* half of the flow. The other half is the address the
    // member is sent back to, which Didit accepts as an opaque string: a callback of
    // http://localhost:3000/kyc/callback creates a session fine and then strands the member at the
    // end of it. Report it here so that failure has somewhere to be seen.
    const resolvedOrigin = publicOriginFor(req)
    const callback = callbackTarget(resolvedOrigin.origin)
    const callbackHint = callback.isPublicHttps
      ? null
      : `Didit would send the member back to ${callback.url}, which is not a public https address (resolved from ${resolvedOrigin.source}). Set NEXT_PUBLIC_APP_URL to the deployed site — e.g. NEXT_PUBLIC_APP_URL="https://afterworks.site" — so the callback lands on a page their browser can open.`

    // The workflow read proves host + key + workflow — and nothing about the call a member
    // actually triggers. A key without write:sessions, an application out of credits and a callback
    // origin that is not on the application's allowed domains all pass GET /v3/workflows/ and
    // still refuse POST /v3/session/, which is how a deployment reports "Ready to verify" while
    // every member is told verification could not be started. Open one probe session under a fixed
    // identity Didit reuses (idempotent per workflow + vendor_data) and report its answer.
    const workflowReadOk =
      probe.reachable && probe.status !== null && probe.status >= 200 && probe.status < 300 && probe.workflowFound
    const sessionProbe = workflowReadOk ? await probeDiditSession(resolvedOrigin.origin) : null

    // Credits are the failure an operator is least likely to suspect, because the Free plan is no
    // longer "500 free checks": since 1 November 2026 it is $10 of credit a month, granted only to
    // organizations that signed up with a work email, and it does not pay for phone verification.
    // Read the balance so "your members are out of checks" is a number rather than a guess.
    const billing = workflowReadOk ? await probeDiditBilling() : null

    // A deployment can be "configured" and still unusable: the host or the key is wrong. Report
    // the two separately so the fix is obvious rather than a hunt through the provider's console.
    // A green workflow read alone is not "ready to verify" — the member's own call must work too,
    // and the id must be a *published, non-archived* workflow, which the id list alone does not
    // prove: a draft version of a workflow appears in the list and refuses every session.
    const healthy = config.configured && workflowReadOk && probe.workflowUsable && sessionProbe?.ok === true

    await audit({
      action: 'KYC_DIAGNOSTIC_RUN',
      actorEmail: guard.value.email,
      details: {
        host: config.host,
        configured: config.configured,
        reachable: probe.reachable,
        status: probe.status,
        workflowFound: probe.workflowFound,
        workflowUsable: probe.workflowUsable,
        sessionProbeOk: sessionProbe?.ok ?? null,
        sessionProbeStatus: sessionProbe?.status ?? null,
        creditBalance: billing?.balance ?? null,
        callbackOrigin: callback.origin,
        callbackSource: resolvedOrigin.source,
        callbackIsPublic: callback.isPublicHttps,
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
      sessionProbe,
      billing,
      callback: {
        url: callback.url,
        origin: callback.origin,
        source: resolvedOrigin.source,
        isPublicHttps: callback.isPublicHttps,
      },
      hint: diditConfigHint() ?? sessionProbe?.hint ?? probe.hint ?? billing?.hint ?? callbackHint,
    })
  } catch (err) {
    return routeError('KYC diagnostic', err)
  }
}
