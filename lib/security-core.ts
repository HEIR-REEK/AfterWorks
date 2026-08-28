/**
 * AfterWorks security core — the edge-safe half of the security layer.
 *
 * Everything here is pure: no `node:*` imports, no Firebase imports. That is what lets the
 * *same* rules run inside `middleware.ts` (Edge runtime), inside route handlers (Node), and
 * inside React components without polyfill games or subtle behaviour drift between them.
 */

// ─── Environment access ──────────────────────────────────────────────────────

export function env(name: string, fallback = ''): string {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  const value = proc?.env?.[name]
  return value === undefined || value === '' ? fallback : value
}

export function envBool(name: string, fallback = false): boolean {
  const raw = env(name).toLowerCase().trim()
  if (raw === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

export function envInt(name: string, fallback: number): number {
  const raw = env(name).trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

export function isProduction(): boolean {
  return env('NODE_ENV').toLowerCase() === 'production'
}

// ─── Validation & sanitisation primitives ────────────────────────────────────

export const EMAIL_MAX_LENGTH = 254
const EMAIL_SHAPE = /^[^\s@,;()<>"'\\]+@[^\s@,;()<>"'\\]+\.[^\s@,;()<>"'\\@]{2,}$/

export function normalizeEmail(input: unknown): string {
  return typeof input === 'string' ? input.trim().toLowerCase() : ''
}

export function isEmailLike(input: unknown): input is string {
  if (typeof input !== 'string') return false
  const value = input.trim()
  return value.length > 3 && value.length <= EMAIL_MAX_LENGTH && EMAIL_SHAPE.test(value)
}

export function parseEmailList(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return Array.from(
    new Set(
      raw
        .split(/[\n,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    ),
  )
}

/**
 * Defensive sanitiser for any human-authored string that is stored and later echoed back
 * (maintenance copy, admin notes, reasons, job titles…). React escapes by default, but the
 * same fields are read by webhooks, exports and third-party dashboards, so we normalise at
 * the write boundary instead of trusting every future renderer.
 */
export function sanitizePlainText(input: unknown, maxLength = 500): string {
  if (typeof input !== 'string') return ''
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|link|meta)[^>]*>/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
}

/** Single-line variant: used for names, emails, titles, IDs. */
export function sanitizeLine(input: unknown, maxLength = 160): string {
  return sanitizePlainText(input, maxLength * 2).replace(/[\r\n]+/g, ' ').trim().slice(0, maxLength)
}

/** Firestore keys are limited and cannot contain `/`, `.`, `#`, `[`, `]`. */
export function isSafeDocId(input: unknown, maxLength = 128): input is string {
  return typeof input === 'string' && input.length > 0 && input.length <= maxLength && !/[/.[\]#]/.test(input)
}

export function clampNumber(input: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const n = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100))
}

/** Cap request bodies *before* parsing them, so oversized payloads can't be buffered. */
export async function readJsonBody<T = Record<string, unknown>>(
  req: { headers: { get(name: string): string | null }; text(): Promise<string> },
  maxBytes = 64 * 1024,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const declared = Number(req.headers.get('content-length') || '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, error: 'Request body is too large.' }
  }
  let text = ''
  try {
    text = await req.text()
  } catch {
    return { ok: false, error: 'Could not read request body.' }
  }
  if (text.length > maxBytes) return { ok: false, error: 'Request body is too large.' }
  if (!text.trim()) return { ok: true, data: {} as T }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Expected a JSON object body.' }
    }
    return { ok: true, data: parsed as T }
  } catch {
    return { ok: false, error: 'Malformed JSON body.' }
  }
}

// ─── Client identity (IP, request id, UA) ────────────────────────────────────

const IP_HEADERS = ['cf-connecting-ip', 'x-real-ip', 'x-verifier-ip', 'true-client-ip', 'x-forwarded-for']

export type ClientIdentity = {
  /** Best-effort originating IP; `unknown` when no trusted proxy header is present. */
  ip: string
  /** Stable hashed form — what we actually key rate limiters and audit rows on. */
  ipHash: string
  userAgent: string
  requestId: string
}

/**
 * `x-forwarded-for` is trivially spoofable by any client that is not behind our proxy, so the
 * client IP is only trusted when TRUST_PROXY_HEADERS is on (Render/Vercel/Cloudflare all set it).
 * Regardless, we never *derive* authorization from an IP — only rate-limit and audit with it.
 */
export function clientIdentity(headers: { get(name: string): string | null }): ClientIdentity {
  const trustProxy = envBool('TRUST_PROXY_HEADERS', !isProduction())
  const direct = headers.get('x-actual-client-ip') || ''
  let candidate = ''

  if (trustProxy || direct) {
    for (const header of IP_HEADERS) {
      const value = headers.get(header)
      if (value) {
        candidate = value.split(',')[0].trim()
        if (candidate) break
      }
    }
  }
  if (!candidate) candidate = direct || 'unavailable'

  return {
    ip: candidate.slice(0, 64),
    ipHash: fnv1a(candidate, 12),
    userAgent: (headers.get('user-agent') || 'unknown').slice(0, 240),
    requestId: headers.get('x-request-id')?.slice(0, 64) || '',
  }
}

/** Fast non-cryptographic hash — only used to shorten log/rate-limit keys, never for secrets. */
export function fnv1a(input: string, hexChars = 12): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, hexChars)
}

// ─── Host / origin integrity ─────────────────────────────────────────────────

const PREVIEW_HOST = /^[a-z0-9.-]+\.e2b\.app$/i
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i

function configuredHosts(): string[] {
  const hosts = new Set<string>()
  for (const name of ['APP_ALLOWED_HOSTS', 'NEXT_PUBLIC_APP_URL', 'APP_URL', 'RENDER_EXTERNAL_URL', 'VERCEL_URL']) {
    const raw = env(name)
    if (!raw) continue
    for (const token of raw.split(/[\s,]+/)) {
      if (!token) continue
      try {
        hosts.add(new URL(token.startsWith('http') ? token : `https://${token}`).host.toLowerCase())
      } catch {
        hosts.add(token.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      }
    }
  }
  return Array.from(hosts)
}

/**
 * Host-header allow-list. Blocks cache-poisoning / password-reset poisoning / auth-bypass tricks
 * that all start with "the app believed a Host header it was handed".
 */
export function isHostAllowed(hostHeader: string | null): boolean {
  if (!hostHeader) return false
  const host = hostHeader.toLowerCase().trim()
  if (LOCAL_HOST.test(host)) return true
  if (PREVIEW_HOST.test(host)) return true
  if (host.endsWith('.onrender.com') || host.endsWith('.vercel.app')) return true
  const allowList = configuredHosts()
  if (allowList.length === 0) return true // nothing configured: cannot enforce, surfaced as a warning
  return allowList.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

/**
 * Origin/Referer check for state-changing calls. Same-origin (no Origin header on same-origin
 * GET/HEAD, or Origin equal to Host) passes; anything else is rejected.
 */
export function isSameSiteRequest(headers: { get(name: string): string | null }): boolean {
  const host = headers.get('host')
  const fetchSite = headers.get('sec-fetch-site')
  if (fetchSite === 'cross-site') return false
  if (fetchSite === 'same-origin' || fetchSite === 'none') return true

  const origin = headers.get('origin')
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() === (host || '').toLowerCase()) return true
    } catch {
      return false
    }
  }

  const referer = headers.get('referer')
  if (referer) {
    try {
      if (new URL(referer).host.toLowerCase() === (host || '').toLowerCase()) return true
    } catch {
      return false
    }
  }

  // A non-browser caller (webhook / CLI / health probe) sends neither Origin nor Referer.
  // Those are allowed only on routes that authenticate by signature, enforced per-route.
  return !origin && !referer
}

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// ─── Response hardening helpers ──────────────────────────────────────────────

export const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store',
  Vary: 'Cookie, Authorization',
}

export const PUBLIC_SHORT_CACHE: Record<string, string> = {
  'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
}

// ─── Security posture report (shared shape used by /admin/security) ──────────

export type CheckSeverity = 'pass' | 'warn' | 'fail'

export type SecurityCheck = {
  id: string
  label: string
  severity: CheckSeverity
  detail: string
  fix?: string
  docs?: string
}

export function worstSeverity(checks: SecurityCheck[]): 'healthy' | 'attention' | 'critical' {
  if (checks.some((c) => c.severity === 'fail')) return 'critical'
  if (checks.some((c) => c.severity === 'warn')) return 'attention'
  return 'healthy'
}
