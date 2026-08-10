/**
 * Didit KYC API helper — server-side only.
 *
 * Didit uses a simple API key (x-api-key header) for authentication.
 * Base URL: https://verification.didit.me
 *
 * Docs: https://docs.didit.me
 *
 * ─── Didit Session Status Glossary ──────────────────────────────────────────
 *
 *  Pending          – Session created, user hasn't started yet.
 *  InProgress       – User is actively going through the flow.
 *  Approved         – All checks passed; identity is verified.
 *  Declined         – One or more checks failed; user is rejected.
 *  Resubmission     – Checks were inconclusive; user must retry specific steps.
 *  OnHold           – Flagged for manual human review (compliance / fraud).
 *  Abandoned        – User started but did not complete within the time limit.
 *  Expired          – The session URL / token passed its TTL without completion.
 *
 * ─── Webhook Events ──────────────────────────────────────────────────────────
 *
 * Didit sends POST webhooks to the registered URL for every status transition.
 * The payload contains: session_id, vendor_data (userId), status, decision,
 *   verification_checks (document, liveness, face_match), and optionally
 *   rejection_reason / resubmission_reason.
 *
 * CRITICAL: NEVER trust status information from URL parameters (the redirect
 * callback). Always treat the webhook or a signed server-side status fetch
 * as the single source of truth for business logic.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { timingSafeEqual, createHmac } from 'crypto'

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

/** Normalise any raw status string to a canonical DiditSessionStatus. */
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
    case 'resubmission_required':
      return 'Resubmission'
    case 'onhold':
    case 'under_review':
    case 'manual_review':
      return 'OnHold'
    case 'abandoned':
      return 'Abandoned'
    case 'expired':
      return 'Expired'
    case 'inprogress':
    case 'started':
      return 'InProgress'
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

  const baseCbUrl = getCallbackUrl(origin)
  // Include device type so the callback page can render the correct UI branch
  const cbUrl = isMobile ? `${baseCbUrl}?device=mobile` : `${baseCbUrl}?device=cross_device`

  // ── Demo / development fallback ───────────────────────────────────────────
  if (missingKey || missingWorkflow) {
    console.warn(
      '[Didit] API Key or Workflow ID not configured — generating a DEMO session. ' +
        'This should never happen in production.',
    )
    const mockSessionId = `demo_session_${Date.now()}`
    const mockToken = `demo_token_${Date.now()}`
    const verificationUrl = `${cbUrl}&session_id=${mockSessionId}&vendor_data=${encodeURIComponent(userId)}&status=Approved`

    return {
      session_id: mockSessionId,
      session_token: mockToken,
      verification_url: verificationUrl,
      status: 'Pending',
      is_demo: true,
    }
  }

  // ── Real Didit API call ───────────────────────────────────────────────────
  const response = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
    method: 'POST',
    headers: {
      'x-api-key': DIDIT_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: userId,      // Ties the session to your Firebase UID
      callback: cbUrl,          // Didit redirects here after the flow completes
      callback_method: 'both',  // Ensures redirect works on all device types
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Didit session creation failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  return {
    session_id: data.session_id || data.id || '',
    session_token: data.session_token || '',
    // Didit returns "url" in v3; normalise to "verification_url" for the rest of the app
    verification_url: data.url ?? data.verification_url ?? '',
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
  /** Full raw payload returned from Didit (for debugging). */
  raw: Record<string, unknown>
}

/**
 * Fetches the current status of a Didit KYC session from the server side.
 *
 * Uses the /v3/session/{id}/decision/ endpoint (authoritative).
 * Falls back to /v3/session/{id}/ if the decision endpoint returns 404.
 */
export async function getKycSessionStatus(sessionId: string): Promise<KycStatusResult> {
  // ── Demo session shortcut ─────────────────────────────────────────────────
  if (sessionId.startsWith('demo_session_')) {
    return {
      session_id: sessionId,
      status: 'Approved',
      raw_status: 'Approved',
      is_approved: true,
      is_rejected: false,
      is_expired: false,
      is_abandoned: false,
      is_on_hold: false,
      needs_resubmission: false,
      raw: { session_id: sessionId, status: 'Approved' },
    }
  }

  if (!DIDIT_API_KEY) throw new Error('DIDIT_API_KEY is not configured.')

  // Try the decision endpoint first (most authoritative for completed sessions)
  let response = await fetch(`${DIDIT_BASE_URL}/v3/session/${sessionId}/decision/`, {
    method: 'GET',
    headers: {
      'x-api-key': DIDIT_API_KEY,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  // Fallback for sessions that haven't reached a decision yet
  if (response.status === 404) {
    response = await fetch(`${DIDIT_BASE_URL}/v3/session/${sessionId}/`, {
      method: 'GET',
      headers: {
        'x-api-key': DIDIT_API_KEY,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Didit status fetch failed (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as Record<string, unknown>
  const raw_status = ((data.status ?? data.state ?? '') as string)
  const status = normaliseStatus(raw_status)

  // Extract failed check names if Didit provides them
  const failed_checks = extractFailedChecks(data)

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
    failed_checks,
    raw: data,
  }
}

/** Extracts a human-readable rejection reason from the Didit payload, if present. */
function extractRejectionReason(data: Record<string, unknown>): string | undefined {
  const candidates = [
    data.rejection_reason,
    data.decline_reason,
    data.resubmission_reason,
    data.reason,
    (data.decision as Record<string, unknown>)?.reason,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return undefined
}

/** Extracts names of failed verification checks from the Didit payload. */
function extractFailedChecks(data: Record<string, unknown>): string[] | undefined {
  const checks = data.verification_checks as Record<string, unknown> | undefined
  if (!checks) return undefined

  const failed: string[] = []
  for (const [key, value] of Object.entries(checks)) {
    const check = value as Record<string, unknown> | undefined
    const passed = check?.passed ?? check?.status
    if (passed === false || passed === 'failed' || passed === 'declined') {
      failed.push(key)
    }
  }
  return failed.length > 0 ? failed : undefined
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

/**
 * Verifies a Didit webhook signature using a timing-safe HMAC-SHA256 comparison.
 *
 * Didit signs each webhook request body with HMAC-SHA256 using the
 * DIDIT_WEBHOOK_SECRET you set in the Business Console. Always call this before
 * acting on any webhook payload.
 *
 * @param rawBody         - The raw UTF-8 request body string (before JSON.parse).
 * @param signatureHeader - The value of the `x-signature-v2` or `x-didit-signature`
 *                          header sent by Didit.
 * @returns true if the signature is valid, false otherwise.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = process.env.DIDIT_WEBHOOK_SECRET
  if (!secret || !signatureHeader) return false

  try {
    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    const receivedBuf = Buffer.from(signatureHeader.replace(/^sha256=/, ''), 'hex')

    // Use timingSafeEqual to prevent timing-attack-based forgery
    if (expectedBuf.length !== receivedBuf.length) return false
    return timingSafeEqual(expectedBuf, receivedBuf)
  } catch {
    return false
  }
}
