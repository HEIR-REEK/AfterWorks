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

  // Identity verification must never fall back to a self-asserted "demo" session. A demo
  // session previously rendered an Approved result, which meant a missing environment variable
  // silently turned KYC into a no-op. Fail loudly instead: the health check already reports the
  // degraded state, and the member is told verification is unavailable rather than being
  // marked verified without a document.
  if (missingKey || missingWorkflow) {
    throw new Error('Didit is not configured: DIDIT_API_KEY and DIDIT_WORKFLOW_ID are required.')
  }

  const baseCbUrl = getCallbackUrl(origin)
  // Include device type so the callback page can render the correct UI branch
  const cbUrl = isMobile ? `${baseCbUrl}?device=mobile` : `${baseCbUrl}?device=cross_device`

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
    const errorText = await response.text()
    throw new Error(`Didit status fetch failed (${response.status}): ${errorText}`)
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
