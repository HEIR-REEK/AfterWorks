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
  const production = isProduction()
  const allowList = configuredHosts()
  const listed = allowList.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  // Localhost is only a public host when an operator has listed it. Unit tests and `next dev` run
  // with NODE_ENV=development; production containers get their real host from APP_URL/RENDER.
  if (LOCAL_HOST.test(host)) return !production || listed
  // Arena-style preview tunnels are a development convenience. In production an arbitrary
  // `*.e2b.app` Host must be opted into explicitly (or be the configured APP_URL), otherwise a
  // forged Host header could still poison absolute links built from the request.
  if (PREVIEW_HOST.test(host)) return !production || envBool('ALLOW_E2B_PREVIEW_HOSTS') || listed
  if (!production && (host.endsWith('.onrender.com') || host.endsWith('.vercel.app'))) return true
  // Fail closed in production. The old fallback let any Host header through whenever the operator
  // forgot APP_ALLOWED_HOSTS, which is exactly the case host-header poisoning exploits.
  if (allowList.length === 0) return !production
  return listed
}

// ─── Public origin resolution ────────────────────────────────────────────────

const PRIVATE_HOSTNAME =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i

/**
 * True only for an absolute HTTPS URL on a hostname the public internet can reach.
 *
 * Third-party providers send the member back to whatever callback URL they are
 * handed. A callback of `http://localhost:3000/kyc/callback` is accepted as a string and then
 * fails silently at the end of the flow — the member is stranded, and the only symptom on our side
 * is a session that never completes. Classifying the URL up front turns that into a visible state.
 */
export function isPublicHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    if (PRIVATE_HOSTNAME.test(host)) return false
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return false
    return true
  } catch {
    return false
  }
}

export type OriginSource = 'env' | 'forwarded-host' | 'host-header' | 'request-origin'

/**
 * The origin a third party should send the member back to.
 *
 * Precedence is deliberate: an operator-set app URL wins over anything the request claims, because
 * Host and X-Forwarded-Host are attacker-controlled. Only when no app URL is configured do the
 * headers get a say, and only if the host passes the allow-list. The last resort — the request's own
 * origin — is what a container behind a proxy tends to produce, so `source` is reported alongside it
 * to make that fallback obvious instead of invisible.
 */
export function publicOriginFor(req: {
  headers: { get(name: string): string | null }
  nextUrl: { origin: string }
}): { origin: string; source: OriginSource; isPublicHttps: boolean } {
  const configured = env('NEXT_PUBLIC_APP_URL') || env('APP_URL') || env('RENDER_EXTERNAL_URL') || env('VERCEL_URL')
  const forwardedHost = req.headers.get('x-forwarded-host')
  const host = forwardedHost || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'

  let origin: string
  let source: OriginSource
  if (configured) {
    origin = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`
    source = 'env'
  } else if (host && isHostAllowed(host)) {
    origin = `${proto}://${host}`
    source = forwardedHost ? 'forwarded-host' : 'host-header'
  } else {
    origin = req.nextUrl.origin
    source = 'request-origin'
  }

  origin = origin.replace(/\/+$/, '')
  return { origin, source, isPublicHttps: isPublicHttpsUrl(origin) }
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

// ─── Cookie names (one source for the edge, the API and the console) ─────────
//
// These lived in `lib/security.ts` (Node-only, because it hashes passcodes) while `middleware.ts`
// spelled the literals out by hand. The names are part of the security contract — "which cookie do
// we trust for what" — so they belong in the module every runtime can read.

/** The console session. HttpOnly + SameSite=strict; the only carrier of console privilege. */
export const ADMIN_SESSION_COOKIE = 'aw_admin_session'
/** Maintenance passage only. It never unlocks the console (`lib/session-token` types the claim). */
export const MAINTENANCE_BYPASS_COOKIE = 'aw_ops_bypass'
/** Cookies written by the pre-hardening client, cleared on sign-in and refused for privilege. */
export const LEGACY_ADMIN_SESSION_COOKIES = ['afterworks_admin_session'] as const

// ─── The console's door ──────────────────────────────────────────────────────

/**
 * Is this a page of the operations console — i.e. something only a signed-in operator may render?
 *
 * `/api/admin/*` is deliberately *not* included: those routes guard themselves (401 without a
 * verified session) and must answer JSON errors, not redirects. `/admin/login` is where you go
 * when the answer is "no", so it is never gated.
 */
/**
 * Which console panel a Host header belongs to: the staff panel lives on its own subdomain
 * (`staff.<app host>`, override with STAFF_SUBDOMAIN), the admin panel on the app host itself.
 *
 * Session cookies are set host-only (no Domain attribute), so the two panels never share a cookie
 * jar — an admin and a staff member can use the same browser in different tabs without their
 * sessions disrupting each other. This helper only *classifies* the host; both runtimes import it
 * (edge middleware included), so it must stay runtime-agnostic and read env statically.
 */
export function consoleHostKind(hostHeader: string | null | undefined): 'staff' | 'admin' {
  const sub = String(process.env.STAFF_SUBDOMAIN ?? 'staff').trim().toLowerCase() || 'staff'
  const host = String(hostHeader ?? '').toLowerCase().split(':')[0].trim()
  if (!host) return 'admin'
  if (host === sub || host.startsWith(`${sub}.`)) return 'staff'
  return 'admin'
}

/** The staff-panel origin hint shown to a staff member who lands on the admin panel. */
export function staffPanelHint(hostHeader: string | null | undefined, appUrlEnv?: string): string {
  const sub = String(process.env.STAFF_SUBDOMAIN ?? 'staff').trim().toLowerCase() || 'staff'
  const host = String(hostHeader ?? '').toLowerCase().split(':')[0].trim()
  if (host.startsWith(`${sub}.`)) return host
  if (host) return `${sub}.${host}`
  const fallback = String(appUrlEnv ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? '').trim()
  try {
    return `${sub}.${new URL(fallback.startsWith('http') ? fallback : `https://${fallback}`).host}`
  } catch {
    return `${sub}.<your-app-domain>`
  }
}

export function isAdminConsolePath(pathname: string): boolean {
  const path = String(pathname ?? '').split(/[?#]/)[0]
  if (path !== '/admin' && !path.startsWith('/admin/')) return false
  const rest = path.slice('/admin/'.length)
  return !(rest === 'login' || rest.startsWith('login/'))
}

/**
 * Where an unauthenticated console request is sent, remembering where it was headed.
 *
 * The `next` value is validated by `safeAdminReturnPath`, so it can only ever point back inside the
 * console — never at another origin.
 */
export function adminConsoleLoginPath(pathname: string, search = ''): string {
  const next = safeAdminReturnPath(`${String(pathname ?? '')}${String(search ?? '')}`)
  return next ? `/admin/login?next=${encodeURIComponent(next)}` : '/admin/login'
}

/**
 * A return path the sign-in screen is allowed to honour.
 *
 * Accepts only a console path (query string included); anything else — an absolute URL, a
 * protocol-relative `//evil.example`, a backslash trick some browsers normalise, a control
 * character, the login page itself — returns null and the caller falls back to `/admin`.
 */
export function safeAdminReturnPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null
  const value = candidate.trim()
  if (!value || value.length > 512) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  if (value.includes('\\') || value.includes('://') || value.startsWith('//')) return null
  // `..` segments are not a redirect risk (the value is same-origin and the router normalises it)
  // but they have no business being in a return path, and refusing them keeps the rule obvious.
  if (value.includes('/..')) return null
  const path = value.split(/[?#]/)[0]
  if (!isAdminConsolePath(path)) return null
  return value
}

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
