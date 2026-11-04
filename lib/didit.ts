/**
 * Didit KYC API helper — server-side only.
 *
 * Didit uses a simple API key (x-api-key header) for authentication.
 * Base URL: https://verification.didit.me
 *
 * Docs: https://docs.didit.me
 *
 * ─── Didit Session Status Glossary (v3) ─────────────────────────────────────
 *
 *  Not Started      – Session created, user hasn't started yet.        → Pending
 *  In Progress      – User is actively going through the flow.         → InProgress
 *  Awaiting User    – Didit is waiting for the user to do one more step → InProgress
 *  Resubmitted      – User redid the steps Didit asked them to redo.    → Resubmission
 *  In Review        – Flagged for manual human review (compliance/fraud) → OnHold
 *  Approved         – All checks passed; identity is verified.
 *  Declined         – One or more checks failed; user is rejected.
 *  Not Finished     – The flow was started but never completed.        → Abandoned
 *  Abandoned        – User started but did not complete within the time limit.
 *  Expired          – The session URL / token passed its TTL without completion.
 *
 * ─── Webhook Events ──────────────────────────────────────────────────────────
 *
 * Didit sends POST webhooks to the registered URL for every status transition.
 * The payload contains: event_id, session_id, vendor_data (userId), status and,
 * for terminal outcomes, a `decision` object. In v3 every per-feature result is
 * a *plural array* — `id_verifications[]`, `liveness_checks[]`, `face_matches[]`
 * and so on — one entry per workflow node, each carrying `node_id`, `status` and
 * `warnings[]`. There is no singular `verification_checks` block.
 *
 * CRITICAL: NEVER trust status information from URL parameters (the redirect
 * callback). Always treat the signed webhook or a signed server-side status
 * fetch as the single source of truth for business logic.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { timingSafeEqual, createHmac } from 'crypto'
import { isPublicHttpsUrl } from '@/lib/security-core'

const DIDIT_BASE_URL = process.env.DIDIT_API_URL || 'https://verification.didit.me'
const DIDIT_API_KEY = process.env.DIDIT_API_KEY || ''
const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID || ''

/**
 * All possible statuses Didit can return for a KYC session.
 * Used to ensure exhaustive handling in webhooks and status checks.
 */
export type DiditSessionStatus =
  | 'Pending'
  | 'InProgress'
  | 'Approved'
  | 'Declined'
  | 'Resubmission'
  | 'OnHold'
  | 'Abandoned'
  | 'Expired'

/**
 * Normalise any raw status string to a canonical DiditSessionStatus.
 *
 * The `case` labels are compared after stripping every separator, so `In Review`,
 * `in_review` and `IN-REVIEW` are one case. Keep the *v3 spellings* here — a status this
 * function does not recognise falls through to `Pending`, which is why "Resubmitted" and
 * "Not Finished" used to leave a member sitting on "verifying" forever.
 */
export function normaliseStatus(raw: string | undefined | null): DiditSessionStatus {
  switch ((raw ?? '').toLowerCase().replace(/[_\s-]/g, '')) {
    case 'approved':
    case 'verified':
    case 'completed':
      return 'Approved'
    case 'declined':
    case 'rejected':
    case 'failed':
      return 'Declined'
    case 'resubmission':
    case 'resubmissionrequired':
    case 'resubmitted':
    case 'resubmit':
      return 'Resubmission'
    case 'onhold':
    case 'underreview':
    case 'manualreview':
    case 'inreview':
    case 'review':
      return 'OnHold'
    case 'notfinished':
    case 'unfinished':
    case 'abandoned':
    case 'timedout':
      return 'Abandoned'
    case 'expired':
      return 'Expired'
    case 'inprogress':
    case 'started':
    case 'awaitinguser':
      return 'InProgress'
    case 'notstarted':
    case 'newsession':
    default:
      return 'Pending'
  }
}

/** Returns true for statuses that represent a terminal (final) outcome. */
export function isTerminalStatus(status: DiditSessionStatus): boolean {
  return ['Approved', 'Declined', 'Abandoned', 'Expired'].includes(status)
}

/** Returns true for the single "user is verified" outcome. */
export function isApprovedStatus(status: DiditSessionStatus): boolean {
  return status === 'Approved'
}

/** Returns true for hard-failure outcomes (user cannot reuse this session). */
export function isRejectedStatus(status: DiditSessionStatus): boolean {
  return status === 'Declined'
}

/** Returns true if the user is expected to take another action (retry). */
export function needsUserAction(status: DiditSessionStatus): boolean {
  return status === 'Resubmission'
}

// ─── Configuration & failures ────────────────────────────────────────────────

/**
 * Didit rejected the request, or could not be reached at all.
 *
 * The distinction matters operationally: "key invalid", "wrong host", "workflow missing" and
 * "provider down" all used to surface as the same browser message, so a broken deployment looked
 * identical to a provider hiccup. The `status` and `detail` here are for the server log and the
 * console's connection test — never for the browser.
 */
export class DiditApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string, context: string) {
    super(`${context} (${status}): ${detail.slice(0, 400)}`)
    this.name = 'DiditApiError'
    this.status = status
    this.detail = detail
  }
}

/** Credentials are missing. This is our bug, not the provider's, and it must not look like one. */
export class DiditConfigError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`Didit is not configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required.`)
    this.name = 'DiditConfigError'
    this.missing = missing
  }
}

/** The registration/console host — everything under /v3/* 404s there. */
const REGISTRATION_HOST = 'apx.didit.me'

/**
 * What the deployment is actually pointing at. Booleans rather than values: this feeds the
 * console's connection test and the health check, and neither may echo a key.
 */
export function diditConfig() {
  const apiUrl = DIDIT_BASE_URL
  let host = ''
  try {
    host = new URL(apiUrl).host
  } catch {
    host = apiUrl
  }
  const missing: string[] = []
  if (!DIDIT_API_KEY || DIDIT_API_KEY.startsWith('your_')) missing.push('DIDIT_API_KEY')
  if (!DIDIT_WORKFLOW_ID || DIDIT_WORKFLOW_ID.startsWith('your_')) missing.push('DIDIT_WORKFLOW_ID')
  if (!process.env.DIDIT_WEBHOOK_SECRET) missing.push('DIDIT_WEBHOOK_SECRET')

  return {
    apiUrl,
    host,
    /** True when the API base is the registration host, where /v3/session/ does not exist. */
    usesRegistrationHost: host === REGISTRATION_HOST,
    hasApiKey: Boolean(DIDIT_API_KEY) && !DIDIT_API_KEY.startsWith('your_'),
    hasWorkflowId: Boolean(DIDIT_WORKFLOW_ID) && !DIDIT_WORKFLOW_ID.startsWith('your_'),
    hasWebhookSecret: Boolean(process.env.DIDIT_WEBHOOK_SECRET),
    missing,
    configured: missing.length === 0,
  }
}

/** One line explaining the most likely reason a session cannot be created, for logs and the console. */
export function diditConfigHint(): string | null {
  const config = diditConfig()
  if (config.usesRegistrationHost) {
    return `DIDIT_API_URL points at ${REGISTRATION_HOST}, which only serves /auth/v2/* registration — /v3/session/ 404s there. Unset it to use https://verification.didit.me.`
  }
  if (!config.hasApiKey || !config.hasWorkflowId) {
    return `Set ${[config.hasApiKey ? null : 'DIDIT_API_KEY', config.hasWorkflowId ? null : 'DIDIT_WORKFLOW_ID'].filter(Boolean).join(' and ')} from the Didit console (Settings → API & Webhooks / Workflows).`
  }
  if (!config.hasWebhookSecret) {
    return 'Set DIDIT_WEBHOOK_SECRET so approvals arriving by webhook are accepted, not refused.'
  }
  return null
}

/** One workflow row as the provider reports it — enough to tell *why* an id is unusable. */
export type DiditWorkflowRow = {
  id: string
  label: string
  /** "published" | "draft" | "unknown" — new sessions always use the latest *published* version. */
  status: string
  version?: number
  archived?: boolean
  /** Raw feature string, e.g. "OCR + LIVENESS + FACE_MATCH" (a phone step is not billable on Free). */
  features?: string
  totalPrice?: number
  workflowType?: string
  isDefault?: boolean
}

/**
 * Live read-through of the provider's workflow list.
 *
 * `GET /v3/workflows/` is the cheapest call that proves the host is right and the API key is
 * accepted, and it names every workflow on the application. Two things it must NOT be read as
 * proof of, because both used to pass this check while every member's session creation failed:
 *
 *  • that the configured `DIDIT_WORKFLOW_ID` is *usable*. Each row is one version of a workflow
 *    group and new sessions use the latest **published** version, so an id that exists only as a
 *    draft — or whose only rows are archived — lists fine and still refuses every session.
 *    `workflowUsable` is the check that matters; `workflowFound` only says the id was seen.
 *  • that the whole list was seen. The endpoint paginates at 50 rows per page, so an id on page
 *    two reads as "not on this key" — `morePages` says when that is possible.
 */
export async function probeDidit(): Promise<{
  reachable: boolean
  status: number | null
  detail: string
  workflows: DiditWorkflowRow[]
  workflowFound: boolean
  workflowUsable: boolean
  morePages: boolean
  hint: string | null
}> {
  const config = diditConfig()
  const hint = diditConfigHint()
  if (!config.hasApiKey) {
    return {
      reachable: false,
      status: null,
      detail: 'No API key is configured, so Didit cannot be called.',
      workflows: [],
      workflowFound: false,
      workflowUsable: false,
      morePages: false,
      hint,
    }
  }

  try {
    const response = await fetch(`${DIDIT_BASE_URL}/v3/workflows/`, {
      method: 'GET',
      headers: { 'x-api-key': DIDIT_API_KEY, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300)
      const refused = response.status === 401 || response.status === 403
      return {
        reachable: true,
        status: response.status,
        detail: refused
          ? `Didit refused the key for ${config.host}: ${detail}`
          : `Didit answered ${response.status} from ${config.host}: ${detail}`,
        workflows: [],
        workflowFound: false,
        workflowUsable: false,
        morePages: false,
        hint:
          hint ??
          (config.usesRegistrationHost
            ? diditConfigHint()
            : refused
              ? `The key was refused. Confirm DIDIT_API_KEY belongs to this application (Settings → API & Webhooks) and that DIDIT_API_URL is unset, so calls go to https://verification.didit.me.`
              : response.status === 400
                ? 'A 400 here is usually exhausted credits or an archived workflow. Check Billing and Workflows in the Didit console.'
                : 'The provider answered with an error. Retry, then check the Didit status page.'),
      }
    }

    const payload = (await response.json()) as Record<string, unknown>
    const rows = Array.isArray(payload.results)
      ? payload.results
      : Array.isArray(payload)
        ? (payload as unknown[])
        : Array.isArray(payload.workflows)
          ? (payload.workflows as unknown[])
          : []

    const workflows: DiditWorkflowRow[] = rows.flatMap((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : null
      if (!record) return []
      const id = String(record.workflow_id ?? record.uuid ?? record.id ?? '')
      if (!id) return []
      return [
        {
          id,
          label: String(record.workflow_label ?? record.label ?? 'Untitled workflow'),
          status: String(record.status ?? 'unknown'),
          version: typeof record.version === 'number' ? record.version : undefined,
          archived: record.is_archived === true,
          features: typeof record.features === 'string' ? record.features : undefined,
          totalPrice: typeof record.total_price === 'number' ? record.total_price : undefined,
          workflowType: typeof record.workflow_type === 'string' ? record.workflow_type : undefined,
          isDefault: record.is_default === true,
        },
      ]
    })

    const matches = workflows.filter((workflow) => workflow.id === DIDIT_WORKFLOW_ID)
    const workflowFound = matches.length > 0
    // A missing `status` field must not fail a working deployment, but an explicit "draft" or an
    // archived row must: neither can serve a session.
    const workflowUsable = matches.some((workflow) => (workflow.status === 'published' || workflow.status === 'unknown') && !workflow.archived)
    const morePages = Boolean(payload.next)

    const statusesSeen = [...new Set(matches.map((workflow) => (workflow.archived ? 'archived' : workflow.status)))].join(', ')
    return {
      reachable: true,
      status: response.status,
      detail: !workflowFound
        ? workflows.length === 0
          ? 'The key works, but this application has no workflows. Create one in the Didit console, then set DIDIT_WORKFLOW_ID.'
          : `The key works, but DIDIT_WORKFLOW_ID is not one of the ${workflows.length} workflow(s) on this application${morePages ? ' shown on this page' : ''}. Copy the id from the console.`
        : !workflowUsable
          ? `DIDIT_WORKFLOW_ID matches a workflow on this application, but no published, non-archived version exists (versions seen: ${statusesSeen || 'none'}). New sessions always use the latest published version, so every member's session creation is refused until the workflow is published.`
          : `Didit accepted the key and the workflow is published in this application (${workflows.length} workflow${workflows.length === 1 ? '' : 's'} visible).`,
      workflows,
      workflowFound,
      workflowUsable,
      morePages,
      hint: !workflowFound
        ? morePages
          ? 'The workflow list is paginated (50 per page), so the configured workflow may simply be on a later page. Open Workflows in the Didit console and copy the workflow_id exactly.'
          : 'DIDIT_WORKFLOW_ID must be the id of a workflow that exists on the application bound to this API key.'
        : !workflowUsable
          ? `Publish the workflow in the Didit console (Workflows → open it → Publish). Versions seen for this id: ${statusesSeen || 'none'}.`
          : hint,
    }
  } catch (err) {
    return {
      reachable: false,
      status: null,
      detail: `Could not reach ${DIDIT_BASE_URL}: ${err instanceof Error ? err.message : 'unknown error'}`,
      workflows: [],
      workflowFound: false,
      workflowUsable: false,
      morePages: false,
      hint: config.usesRegistrationHost ? diditConfigHint() : "Check the deployment's outbound network access to verification.didit.me.",
    }
  }
}

// ─── Billing probe (console connection test) ────────────────────────────────

/**
 * Live read of the organization's credit balance.
 *
 * `GET /v3/billing/balance/` answers the one question a refused session cannot: whether there is
 * anything to pay with. Since 1 November 2026 the Free plan grants **$10 of credit a month — about
 * 30 full KYC checks at $0.33 — not 500 free checks**, and only to organizations that signed up
 * with a work email; it also does not cover phone verification. A deployment whose workflow read
 * passes and whose sessions are all refused with "not enough credits" has a billing fact, not a
 * code bug, so the console reads the balance instead of leaving the operator to guess.
 */
export async function probeDiditBilling(): Promise<{
  ok: boolean
  status: number | null
  balance: number | null
  autoRefill: boolean | null
  detail: string
  hint: string | null
}> {
  const config = diditConfig()
  if (!config.hasApiKey) {
    return {
      ok: false,
      status: null,
      balance: null,
      autoRefill: null,
      detail: 'No API key is configured, so the balance cannot be read.',
      hint: diditConfigHint(),
    }
  }

  try {
    const response = await fetch(`${DIDIT_BASE_URL}/v3/billing/balance/`, {
      method: 'GET',
      headers: { 'x-api-key': DIDIT_API_KEY, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300)
      return {
        ok: false,
        status: response.status,
        balance: null,
        autoRefill: null,
        detail: `Didit answered ${response.status} for the balance read: ${detail}`,
        hint: 'The balance could not be read. A refused session still reports its own reason, so use that.',
      }
    }

    const payload = (await response.json()) as Record<string, unknown>
    const balance = Number.parseFloat(String(payload.balance ?? ''))
    const autoRefill = typeof payload.auto_refill_enabled === 'boolean' ? payload.auto_refill_enabled : null
    const readable = Number.isFinite(balance)
    return {
      ok: readable,
      status: response.status,
      balance: readable ? balance : null,
      autoRefill,
      detail: readable
        ? `Credit balance is $${balance.toFixed(2)}${autoRefill ? ' (auto top-up on)' : ''}. A full KYC check costs $0.33, so that is about ${Math.max(0, Math.floor(balance / 0.33))} checks.`
        : 'The balance response did not contain a readable number.',
      hint: readable && balance <= 0
        ? 'The balance is empty, so Didit refuses to open sessions. On the Free plan the grant is $10 a month (about 30 checks) for organizations that signed up with a work email — check Billing in the Didit console, or top up.'
        : null,
    }
  } catch (err) {
    return {
      ok: false,
      status: null,
      balance: null,
      autoRefill: null,
      detail: `Could not read the balance from ${DIDIT_BASE_URL}: ${err instanceof Error ? err.message : 'unknown error'}`,
      hint: null,
    }
  }
}

// ─── Session probe (console connection test) ────────────────────────────────

/**
 * The fixed identity the console's connection test opens its probe session under.
 *
 * Didit allows only one non-finished session per (workflow_id, vendor_data) and returns the
 * existing one instead of opening a duplicate, so every "Test connection" click after the first
 * reuses this session: the test proves the member-facing call works without stacking up sessions
 * or spending a verification credit per click.
 */
export const DIDIT_PROBE_VENDOR_DATA = 'afterworks-console-connection-test'

/**
 * Live read-through of the *member-facing* call: `POST /v3/session/`.
 *
 * `GET /v3/workflows/` proves the host, the key and the workflow — and nothing else. A key without
 * write:sessions, an application out of credits, a callback origin that is not on the application's
 * allowed domains and a blocklisted identity all pass the workflow read and still refuse the
 * session a member needs. That is the exact shape of the failure where the console reports "Ready
 * to verify" while every member is told verification could not be started, so the console now
 * makes the same request the member's "Verify" button makes.
 *
 * The provider's answer (status + detail) is for the operator's console and the server log only —
 * it never reaches the browser.
 */
export async function probeDiditSession(origin?: string): Promise<{
  ok: boolean
  status: number | null
  detail: string
  sessionId: string | null
  hint: string | null
}> {
  const config = diditConfig()
  if (!config.hasApiKey || !config.hasWorkflowId || config.usesRegistrationHost) {
    return {
      ok: false,
      status: null,
      detail: 'No session was opened: the API key, workflow id or host is not usable.',
      sessionId: null,
      hint: diditConfigHint(),
    }
  }

  try {
    // Same endpoint, headers and body shape the member flow uses — a probe that called anything
    // else could pass while members still fail.
    const session = await createKycSession(DIDIT_PROBE_VENDOR_DATA, true, origin)
    return {
      ok: true,
      status: 201,
      detail: `Didit opened session ${session.session_id} — the call a member's "Verify" makes succeeds on this deployment.`,
      sessionId: session.session_id,
      hint: null,
    }
  } catch (err) {
    if (err instanceof DiditConfigError) {
      return { ok: false, status: null, detail: err.message, sessionId: null, hint: diditConfigHint() }
    }
    if (err instanceof DiditApiError) {
      return {
        ok: false,
        status: err.status,
        detail: `Didit refused to open a session (${err.status}): ${err.detail.slice(0, 300)}`,
        sessionId: null,
        hint: sessionProbeHint(err.status, err.detail, callbackTarget(origin).url),
      }
    }
    return {
      ok: false,
      status: null,
      detail: `Could not open a session: ${err instanceof Error ? err.message : 'unknown error'}`,
      sessionId: null,
      hint: "Check the deployment's outbound network access to verification.didit.me, then retry.",
    }
  }
}

/**
 * The one-line operator fix for each way session creation can fail while the workflow read passes.
 *
 * `detail` is the provider's own words, so the mapping keys off its phrasing rather than off
 * status alone: Didit reports expired keys, IP-restricted keys, deleted applications and missing
 * credits under statuses that would otherwise all read as the same "refused".
 */
function sessionProbeHint(status: number, detail: string, callbackUrl?: string): string {
  const body = detail.toLowerCase()
  if (status === 403) {
    if (body.includes('application_deleted')) {
      return 'Didit reports the application behind this key was deleted, so nothing can be verified on it. Create a new application in the Didit console, then issue a fresh API key and workflow and point DIDIT_API_KEY and DIDIT_WORKFLOW_ID at those.'
    }
    if (body.includes('ip list') || body.includes('ip allowlist') || body.includes('ip whitelist') || body.includes('outside its ip')) {
      return 'This API key is restricted to an IP allow-list and this request did not come from a listed address. Add the deployment’s egress IP (on Render: service → Outbound IPs) to the key’s IP list in the Didit console, or drop the restriction.'
    }
    return 'The key is accepted for reads but lacks write:sessions. Create a key with session-write permission in the Didit console (Settings → API & Webhooks) and set DIDIT_API_KEY to it.'
  }
  if (status === 401) {
    return body.includes('expired')
      ? 'This API key has expired. Create a new key in the Didit console (Settings → API & Webhooks) and set DIDIT_API_KEY to it — reads can keep succeeding after an expiry the provider only enforces on writes.'
      : 'Didit refused the key for session creation. Confirm DIDIT_API_KEY belongs to this application.'
  }
  if (status === 404) {
    return 'Didit cannot see this session or its workflows under this key, which is what a key scoped to a different application (or a deleted one) looks like. Check the key’s application and workflow scope in the Didit console.'
  }
  if (body.includes('credit')) {
    return 'The application is out of verification credits: the workflow list is free, but opening a session is not. Since 1 November 2026 the Free plan grants $10 of credit a month — about 30 full KYC checks, not 500 — and only to organizations that signed up with a work email. Check Billing in the Didit console, or top up.'
  }
  if (body.includes('allowed domain')) {
    return `Didit refuses the callback origin: ${callbackUrl ?? 'the configured callback URL'} must be one of the application’s allowed domains (PATCH /v3/webhook/). Add that origin there — or set NEXT_PUBLIC_APP_URL to an origin that is already allowed.`
  }
  if (body.includes('phone')) {
    return 'The workflow includes a phone verification step, and the Free plan’s monthly credit does not pay for phone verification. Remove the phone step from the workflow, or move to a plan that covers it.'
  }
  if (body.includes('blocked')) {
    return 'Didit has an identity blocklisted on this application, so no session can be opened for it. Remove the block, or the members it covers cannot verify.'
  }
  if (body.includes('portrait')) {
    return 'The workflow expects a reference face (portrait_image) or a stored face for this identity. Send one when creating the session, or move Face Match after ID Verification in the workflow.'
  }
  if (body.includes('workflow')) {
    return 'Didit did not accept DIDIT_WORKFLOW_ID for this session. It must be the workflow_id of a workflow that is published on the application bound to this key — a draft or archived workflow id lists fine but refuses every session.'
  }
  if (status === 429) {
    return 'Didit rate-limited the call (600 successful calls per minute). Wait a minute and test again.'
  }
  if (status >= 500) {
    return 'The provider failed while opening a session. Check the Didit status page, then retry — the passing workflow read means the host and key are fine.'
  }
  return 'Didit refused to open a session. The full provider answer is in this deployment’s server log for the KYC diagnostic run.'
}

// ─── Callback URL ────────────────────────────────────────────────────────────

/**
 * Builds the absolute callback URL Didit will redirect the user to
 * after they complete (or abandon) the verification flow.
 */
function getCallbackUrl(origin?: string): string {
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.VERCEL_URL

  let baseUrl = origin
  if (envUrl) {
    baseUrl = envUrl.startsWith('http') ? envUrl : `https://${envUrl}`
  }
  if (!baseUrl) {
    baseUrl = 'http://localhost:3000'
  }
  return `${baseUrl.replace(/\/$/, '')}/kyc/callback`
}

/**
 * Reports the callback URL that would be handed to Didit right now, and whether a member's browser
 * could actually reach it. Used by the console connection test: a healthy provider plus an
 * unreachable callback origin is a flow that starts and then strands the member, which looks like
 * "verification is broken" and is invisible in every other diagnostic.
 */
export function callbackTarget(origin?: string): {
  url: string
  origin: string
  fromEnv: boolean
  isPublicHttps: boolean
} {
  const url = getCallbackUrl(origin)
  const envUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.VERCEL_URL ||
    ''
  ).trim()
  return {
    url,
    origin: url.replace(/\/kyc\/callback$/, ''),
    fromEnv: Boolean(envUrl),
    isPublicHttps: isPublicHttpsUrl(url),
  }
}

// ─── Session Creation ─────────────────────────────────────────────────────────

export type KycSessionResult = {
  session_id: string
  session_token: string
  verification_url: string
  status: DiditSessionStatus
  is_demo?: boolean
}

/**
 * Creates a new Didit KYC session for the given Firebase UID.
 *
 * @param userId   - Firebase UID of the authenticated user.
 * @param isMobile - If true, the user will complete KYC on the same device.
 *                   If false, a QR code cross-device flow is used.
 * @param origin   - The public-facing origin (protocol + host) of the app
 *                   so that Didit can redirect back to the correct host.
 */
export async function createKycSession(
  userId: string,
  isMobile?: boolean,
  origin?: string,
): Promise<KycSessionResult> {
  const missingKey = !DIDIT_API_KEY || DIDIT_API_KEY.startsWith('your_')
  const missingWorkflow = !DIDIT_WORKFLOW_ID || DIDIT_WORKFLOW_ID.startsWith('your_')

  // Identity verification must never fall back to a self-asserted "demo" session. A demo
  // session previously rendered an Approved result, which meant a missing environment variable
  // silently turned KYC into a no-op. Fail loudly instead: the health check already reports the
  // degraded state, and the member is told verification is unavailable rather than being
  // marked verified without a document.
  if (missingKey || missingWorkflow) {
    throw new DiditConfigError([
      ...(missingKey ? ['DIDIT_API_KEY'] : []),
      ...(missingWorkflow ? ['DIDIT_WORKFLOW_ID'] : []),
    ])
  }

  if (diditConfig().usesRegistrationHost) {
    throw new DiditConfigError(['DIDIT_API_URL must be https://verification.didit.me, not the registration host'])
  }

  const baseCbUrl = getCallbackUrl(origin)
  // Include device type so the callback page can render the correct UI branch
  const cbUrl = isMobile ? `${baseCbUrl}?device=mobile` : `${baseCbUrl}?device=cross_device`

  // A callback the member's browser cannot reach is not a provider error, so nothing in the response
  // gives it away: the session is created, the flow completes, and the redirect dies. Say it here,
  // where the operator's log can see it, rather than leaving a half-finished verification to explain.
  if (!isPublicHttpsUrl(baseCbUrl)) {
    console.warn(
      `[KYC] Callback URL is not a public https address (${baseCbUrl}). Didit will send the member back to ` +
        `an address their browser may not reach — set NEXT_PUBLIC_APP_URL to the deployed site.`,
    )
  }

  // ── Real Didit API call ───────────────────────────────────────────────────
  const response = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
    method: 'POST',
    headers: {
      'x-api-key': DIDIT_API_KEY,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: userId, // Ties the session to your Firebase UID
      callback: cbUrl, // Didit redirects here after the flow completes
      // Which device is *sent back* to `callback`. 'both' looks convenient and is wrong for the
      // cross-device flow: the laptop would be navigated away from the page that is polling for
      // the result (and lands on "please return to your laptop" while sitting on the laptop).
      // Same-device: the initiating device is also the completing one. Cross-device: only the
      // phone that scanned the QR code is redirected; the desktop keeps its poll alive.
      callback_method: isMobile ? 'initiator' : 'completer',
    }),
  })

  if (!response.ok) {
    throw new DiditApiError(response.status, await response.text(), 'Didit session creation failed')
  }

  const data = await response.json()
  const verificationUrl = (data.url ?? data.verification_url ?? '') as string

  // A 201 without a hosted URL is useless to the member: the client would redirect to an empty
  // string and they would sit on a blank page. Treat it as a provider fault so the route can say
  // so instead of pretending a session was opened.
  if (!verificationUrl) {
    throw new DiditApiError(502, `Session ${String(data.session_id ?? '?')} had no hosted URL in the response.`, 'Didit session creation returned no URL')
  }

  return {
    session_id: data.session_id || data.id || '',
    session_token: data.session_token || '',
    // Didit returns "url" in v3; normalise to "verification_url" for the rest of the app
    verification_url: verificationUrl,
    status: normaliseStatus(data.status),
  }
}

// ─── Session Status ───────────────────────────────────────────────────────────

export type KycStatusResult = {
  session_id: string
  status: DiditSessionStatus
  /** Raw status string returned by Didit (preserved for logging). */
  raw_status: string
  /** Whether the identity was successfully verified. */
  is_approved: boolean
  /** Whether the session ended in a hard rejection. */
  is_rejected: boolean
  /** Whether the session timed out without completion. */
  is_expired: boolean
  /** Whether the session was abandoned by the user. */
  is_abandoned: boolean
  /** Whether a manual compliance review is in progress. */
  is_on_hold: boolean
  /** Whether the user needs to resubmit specific verification steps. */
  needs_resubmission: boolean
  /** Human-readable reason if declined or flagged (if provided by Didit). */
  rejection_reason?: string
  /** Which document / liveness checks failed, if available. */
  failed_checks?: string[]
  /**
   * The Firebase uid this session was opened for (`vendor_data`). The status endpoint must
   * compare this with the authenticated caller before it writes any verification result: a
   * session id is not a bearer credential for somebody else's identity check.
   */
  vendor_data: string
  /** Full raw payload returned from Didit (for debugging). */
  raw: Record<string, unknown>
}

/**
 * Fetches the current status of a Didit KYC session from the server side.
 *
 * Uses the /v3/session/{id}/decision/ endpoint (authoritative). Falls back to /v3/session/{id}/
 * while the session has no decision yet, and — because the two endpoints do not always agree on
 * which fields they return — uses that same fallback to recover `vendor_data` when the decision
 * payload omits it. Without the owner field the callers cannot prove the session belongs to the
 * signed-in member, and a legitimate approval would be refused as somebody else's.
 */
export async function getKycSessionStatus(
  sessionId: string,
  options: { timeoutMs?: number } = {},
): Promise<KycStatusResult> {
  if (!DIDIT_API_KEY) throw new Error('DIDIT_API_KEY is not configured.')

  // The webhook path passes a shorter budget: Didit times a delivery out after five seconds and
  // retries. A status read is a defence-in-depth check there, not the only source of truth.
  const timeoutMs = options.timeoutMs ?? 10_000

  // A session id is never sufficient proof on its own. Reject the old demo namespace
  // explicitly so a stale client or a crafted query cannot resurrect the approval shortcut.
  if (!sessionId || sessionId.startsWith('demo_session_') || sessionId.startsWith('demo_token_')) {
    throw new Error('Unknown identity-verification session.')
  }

  const readSession = async (path: string) =>
    fetch(`${DIDIT_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        'x-api-key': DIDIT_API_KEY,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })

  // Try the decision endpoint first (most authoritative for completed sessions)
  let response = await readSession(`/v3/session/${sessionId}/decision/`)

  // Fallback for sessions that haven't reached a decision yet
  if (response.status === 404) {
    response = await readSession(`/v3/session/${sessionId}/`)
  }

  if (!response.ok) {
    throw new DiditApiError(response.status, await response.text(), 'Didit status fetch failed')
  }

  const data = (await response.json()) as Record<string, unknown>
  const raw_status = (data.status ?? data.state ?? '') as string
  const status = normaliseStatus(raw_status)

  let vendor_data = extractVendorData(data)

  // The decision endpoint is the documented source for the verdict, but its field set has
  // drifted (it has shipped with and without `vendor_data`). Ownership is a security check, not
  // a convenience, so ask the session endpoint instead of guessing.
  if (!vendor_data) {
    try {
      const ownerResponse = await readSession(`/v3/session/${sessionId}/`)
      if (ownerResponse.ok) {
        vendor_data = extractVendorData((await ownerResponse.json()) as Record<string, unknown>)
      }
    } catch {
      // Leave it empty: the caller refuses the session rather than assuming an owner.
    }
  }

  return {
    session_id: (data.session_id ?? data.id ?? sessionId) as string,
    status,
    raw_status,
    is_approved: isApprovedStatus(status),
    is_rejected: isRejectedStatus(status),
    is_expired: status === 'Expired',
    is_abandoned: status === 'Abandoned',
    is_on_hold: status === 'OnHold',
    needs_resubmission: status === 'Resubmission',
    rejection_reason: extractRejectionReason(data),
    failed_checks: extractFailedChecks(data),
    vendor_data,
    raw: data,
  }
}

/** Didit has shipped both camelCase and nested metadata shapes; accept the known spellings. */
function extractVendorData(data: Record<string, unknown>): string {
  const candidates = [
    data.vendor_data,
    data.vendorData,
    (data.metadata as Record<string, unknown> | undefined)?.vendor_data,
    (data.metadata as Record<string, unknown> | undefined)?.vendorData,
    (data.session as Record<string, unknown> | undefined)?.vendor_data,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

// ─── Decision parsing (v3) ───────────────────────────────────────────────────

/**
 * Every per-feature result in a v3 decision is a **plural array** — `id_verifications[]`,
 * `liveness_checks[]`, `face_matches[]`, … — one entry per node in the workflow. The GET returns
 * them at the root; a webhook envelope nests the same arrays inside `decision`. There is no
 * singular `verification_checks` object in v3, which is why this module used to report "declined"
 * with no reason at all.
 */
export const DECISION_COLLECTIONS = [
  'id_verifications',
  'nfc_verifications',
  'liveness_checks',
  'face_matches',
  'poa_verifications',
  'phone_verifications',
  'database_validations',
  'aml_screenings',
  'ip_analyses',
  'profile_verifications',
  'questionnaires',
] as const

const CHECK_LABELS: Record<string, string> = {
  id_verifications: 'ID document',
  nfc_verifications: 'NFC / ePassport',
  liveness_checks: 'Liveness check',
  face_matches: 'Face match',
  poa_verifications: 'Proof of address',
  phone_verifications: 'Phone check',
  database_validations: 'Database check',
  aml_screenings: 'AML screening',
  ip_analyses: 'IP analysis',
  profile_verifications: 'Profile check',
  questionnaires: 'Questionnaire',
}

/** Node statuses that mean "this check did not pass". `In Review` is a verdict, not a failure. */
const FAILING_NODE_STATUSES = new Set(['declined', 'failed', 'rejected', 'notfinished', 'expired', 'abandoned', 'flagged', 'error'])

const FAILING_STATUS_LABELS: Record<string, string> = {
  declined: 'declined',
  failed: 'failed',
  rejected: 'declined',
  notfinished: 'not finished',
  expired: 'expired',
  abandoned: 'abandoned',
  flagged: 'flagged for review',
  error: 'could not be read',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * The flattened view of a Didit payload: the decision GET returns the arrays at the root, the
 * webhook nests them under `decision`. Merging the two lets one parser serve both without caring
 * which one it was handed.
 */
function decisionScope(payload: Record<string, unknown>): Record<string, unknown> {
  const inner = asRecord(payload.decision)
  return inner ? { ...payload, ...inner } : payload
}

function nodeStatus(node: Record<string, unknown>): string {
  return String(node.status ?? node.result ?? '').toLowerCase().replace(/[\s_-]/g, '')
}

function humaniseRisk(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The readable messages attached to a failing node — `short_description` first, risk code second. */
function nodeWarnings(node: Record<string, unknown>): string[] {
  const warnings = node.warnings
  if (!Array.isArray(warnings)) return []
  const out: string[] = []
  for (const warning of warnings) {
    const record = asRecord(warning)
    if (!record) {
      if (typeof warning === 'string' && warning.trim()) out.push(humaniseRisk(warning))
      continue
    }
    const description = [record.short_description, record.description, record.message].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0,
    )
    if (description) {
      out.push(description.trim())
      continue
    }
    if (typeof record.risk === 'string' && record.risk.trim()) out.push(humaniseRisk(record.risk))
  }
  return out
}

/** Every node in the payload that did not pass, as `"Label: status — reason"` strings. */
export function extractFailedChecks(payload: Record<string, unknown>): string[] | undefined {
  const scope = decisionScope(payload)
  const failed: string[] = []

  for (const key of DECISION_COLLECTIONS) {
    const nodes = scope[key]
    if (!Array.isArray(nodes)) continue

    for (const node of nodes) {
      const record = asRecord(node)
      if (!record) continue

      const status = nodeStatus(record)
      if (!FAILING_NODE_STATUSES.has(status)) continue

      const label = CHECK_LABELS[key] ?? key.replace(/_/g, ' ')
      const statusLabel = FAILING_STATUS_LABELS[status] ?? status
      const warning = nodeWarnings(record)[0]
      failed.push(warning ? `${label}: ${statusLabel} — ${warning}` : `${label}: ${statusLabel}`)
    }
  }

  return failed.length > 0 ? failed : undefined
}

/**
 * A human-readable reason, from the most specific source available: an explicit reason field,
 * the first warning on the first failing node, or a reviewer's comment.
 */
export function extractRejectionReason(payload: Record<string, unknown>): string | undefined {
  const scope = decisionScope(payload)

  const explicit: unknown[] = [
    scope.rejection_reason,
    scope.decline_reason,
    scope.resubmission_reason,
    scope.reason,
    scope.message,
  ]
  // `declined_reasons` is an array of strings on some v3 payloads.
  if (Array.isArray(scope.declined_reasons)) explicit.push(...scope.declined_reasons)

  for (const candidate of explicit) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  const reviews = scope.reviews
  if (Array.isArray(reviews)) {
    for (const review of reviews) {
      const record = asRecord(review)
      if (!record) continue
      const comment = [record.comment, record.reason, record.message].find(
        (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0,
      )
      if (comment) return comment.trim()
    }
  }

  for (const key of DECISION_COLLECTIONS) {
    const nodes = scope[key]
    if (!Array.isArray(nodes)) continue
    for (const node of nodes) {
      const record = asRecord(node)
      if (!record) continue
      if (!FAILING_NODE_STATUSES.has(nodeStatus(record))) continue
      const [warning] = nodeWarnings(record)
      if (warning) return warning
    }
  }

  return undefined
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

/** How far a webhook timestamp may drift before the delivery is treated as a replay. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

/**
 * Didit's "shortenFloats" step: whole-valued floats serialise as integers (`96.0` → `96`).
 * JSON.parse already collapses `96.0` to the number 96 and JSON.stringify prints it without the
 * trailing `.0`, so this walk exists to document the contract and to normalise any value that
 * arrived as a numeric string carrying a float suffix.
 */
function shortenFloats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shortenFloats)
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (record) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(record)) out[key] = shortenFloats(entry)
    return out
  }
  if (typeof value === 'number' && Number.isInteger(value)) return value
  return value
}

/** Sort object keys recursively — Didit sorts before signing, so a byte comparison cannot work. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (!record) return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key])
  return sorted
}

/**
 * The exact string Didit signs for `X-Signature-V2`: keys sorted recursively, whole-valued floats
 * shortened, compact separators, Unicode preserved. Exported so a test can pin the contract.
 */
export function canonicalWebhookPayload(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown
    return JSON.stringify(sortKeys(shortenFloats(parsed)))
  } catch {
    return null
  }
}

function decodeSignature(header: string): Buffer | null {
  const hex = header.trim().replace(/^sha256=/i, '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) return null
  return Buffer.from(hex, 'hex')
}

function hmacHex(secret: string, body: string): Buffer {
  return Buffer.from(createHmac('sha256', secret).update(body, 'utf8').digest('hex'), 'hex')
}

/**
 * Verifies a Didit webhook signature with a timing-safe HMAC-SHA256 comparison.
 *
 * ─── Why the canonical form matters ──────────────────────────────────────────
 * Didit does not sign the bytes it sent. `X-Signature-V2` is an HMAC over a *canonical
 * re-encoding* of the JSON body — keys sorted recursively, whole-valued floats shortened to
 * integers, compact separators, Unicode preserved. Hashing the raw body (what this function used
 * to do) only agrees when the payload happens to arrive already in that shape, so a decision
 * carrying a score such as `96.0` was rejected as a forgery and the approval never landed.
 *
 * The deprecated `X-Signature` variant *is* a raw-body HMAC with no timestamp, so both forms are
 * accepted here; the timestamp window is enforced whenever Didit supplies one (always, with V2).
 *
 * @param rawBody         - The raw UTF-8 request body string (before JSON.parse).
 * @param signatureHeader - `x-signature-v2` (preferred), `x-signature`, or `x-didit-signature`.
 * @param options.timestamp        - `x-timestamp`, seconds since the epoch, sent with V2 signatures.
 * @param options.requireTimestamp - Set when the delivery carries `X-Signature-V2`. A V2 delivery
 *   without a timestamp is refused rather than treated as an unsigned one: otherwise a replayer
 *   could simply drop the header to skip the freshness window.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  options: { timestamp?: string | null; requireTimestamp?: boolean } = {},
): boolean {
  const secret = process.env.DIDIT_WEBHOOK_SECRET
  if (!secret || !signatureHeader) return false

  const timestampHeader = options.timestamp
  if (options.requireTimestamp && !timestampHeader) return false

  if (timestampHeader) {
    const sentAt = Number.parseInt(timestampHeader, 10)
    const now = Math.floor(Date.now() / 1000)
    if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > WEBHOOK_TOLERANCE_SECONDS) return false
  }

  const received = decodeSignature(signatureHeader)
  if (!received) return false

  const candidates: string[] = []
  const canonical = canonicalWebhookPayload(rawBody)
  if (canonical !== null) candidates.push(canonical)
  // The deprecated raw-body variant, and the only way to verify a body that is not valid JSON
  // (which the route rejects anyway) — kept so an older destination keeps working.
  candidates.push(rawBody)

  try {
    for (const candidate of candidates) {
      const expected = hmacHex(secret, candidate)
      if (expected.length === received.length && timingSafeEqual(expected, received)) return true
    }
  } catch {
    return false
  }
  return false
}
