import { NextResponse, type NextRequest } from 'next/server'

/**
 * AfterWorks edge layer — the first and last line of defence for every request.
 *
 * What runs here (and why):
 *  • Host-header validation    → blocks cache poisoning / password-reset poisoning.
 *  • Security headers          → CSP without unsafe-eval in production, HSTS, frame denial.
 *  • Maintenance interception  → a blackout really returns 503 + Retry-After at the edge, so
 *                                crawlers, cached HTML and non-JS clients are gated too.
 *  • Cross-site mutation guard → Origin/Referer + Sec-Fetch-Site check on every write.
 *  • Per-IP token buckets      → cheap blast-radius limiting for auth, KYC and payment routes.
 *
 * Constraints: this bundle runs on the Edge runtime, so it may only import runtime-agnostic
 * modules (no `node:crypto`, no firebase-admin) and must read `process.env.X` *statically* —
 * dynamic indexing is undefined on some edge targets. Session verification uses the same
 * Web-Crypto code as the Node route handlers, so middleware and API routes can never disagree
 * about who is an administrator.
 */

import {
  MUTATING_METHODS,
  NO_STORE_HEADERS,
  isSameSiteRequest,
} from '@/lib/security-core'
import { getCachedMaintenanceStatus } from '@/lib/maintenance-shared'
import { readSession } from '@/lib/session-token'

// ─── Static configuration (resolved once at module load) ─────────────────────

const PRODUCTION = process.env.NODE_ENV === 'production'
const SESSION_SECRET = (process.env.ADMIN_SESSION_SECRET ?? '').trim()
const SIGNING_OK = SESSION_SECRET.length >= 32
const TRUST_PROXY = (process.env.TRUST_PROXY_HEADERS ?? (PRODUCTION ? 'false' : 'true')) !== 'false'
const EDGE_RATE_LIMIT_ON = (process.env.MIDDLEWARE_RATE_LIMIT ?? 'true') !== 'false'
const MAINTENANCE_GATE_ON = (process.env.MAINTENANCE_EDGE_GATE ?? 'true') !== 'false'
const RATE_CAPACITY = Number(process.env.MIDDLEWARE_RATE_LIMIT_PER_MINUTE ?? 40)
const ALLOWED_HOSTS = new Set(
  [process.env.APP_ALLOWED_HOSTS, process.env.NEXT_PUBLIC_APP_URL, process.env.RENDER_EXTERNAL_URL]
    .filter(Boolean)
    .flatMap((raw) => String(raw).split(/[\s,]+/))
    .map((token) => {
      try {
        return new URL(token.startsWith('http') ? token : `https://${token}`).host.toLowerCase()
      } catch {
        return String(token).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      }
    })
    .filter(Boolean),
)

// ─── Route classes ───────────────────────────────────────────────────────────

const EXTENSION_PATH = /\.(?:ico|png|jpe?g|svg|webp|avif|gif|css|js|mjs|woff2?|ttf|txt|xml|json|map|webmanifest)$/i
const ALWAYS_OPEN = ['/maintenance', '/status', '/offline', '/api/health', '/api/maintenance', '/api/admin/auth', '/api/admin/session']
/** Signature-authenticated inbound integrations: no cookies, no Origin header. */
const WEBHOOK_PATHS = ['/api/paystack/webhook', '/api/kyc/webhook']
const ADMIN_PATH = /^\/(admin|api\/admin)(\/|$)/
const RATE_LIMITED: Array<[RegExp, number]> = [
  [/^\/api\/admin\/auth$/, 8],
  [/^\/api\/kyc\//, 20],
  [/^\/api\/paystack\//, 25],
  [/^\/api\/applications/, 30],
  [/^\/api\/wallet/, 60],
]

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i
const PREVIEW_HOST = /^[a-z0-9-]+\.e2b\.app$/i

function isOpenPath(pathname: string): boolean {
  return ALWAYS_OPEN.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function hostAllowed(host: string | null): boolean {
  if (!host) return false
  const value = host.toLowerCase().trim()
  if (LOCAL_HOST.test(value) || PREVIEW_HOST.test(value)) return true
  if (value.endsWith('.onrender.com') || value.endsWith('.vercel.app')) return true
  if (ALLOWED_HOSTS.size === 0) return true // nothing configured → cannot enforce (reported in Security Center)
  for (const allowed of ALLOWED_HOSTS) {
    if (value === allowed || value.endsWith(`.${allowed}`)) return true
  }
  return false
}

/** Scanner noise & traversal probes: answered with 404 before any handler or database is touched. */
function isNoisePath(pathname: string): boolean {
  if (pathname.length > 1024) return true
  if (/\.\.;|\/\.\/|\/%2e|%00|\.env(\.|$)|wp-admin|phpmyadmin|\/\.git\/|\/\.aws\/|\/\.well-known\/(?!security)/i.test(pathname)) return true
  if (/(shell|cmd=|eval\(|union\+select|onerror=)/i.test(pathname)) return true
  return /\.(?:php|asp|aspx|jsp|cgi|bak|old|sql|conf)(?:$|[?/])/i.test(pathname)
}

/** Best-effort originating IP — used for limiting and log keys only, never for authorization. */
function clientIp(request: NextRequest): string {
  if (TRUST_PROXY) {
    for (const header of ['cf-connecting-ip', 'x-real-ip', 'true-client-ip', 'x-forwarded-for']) {
      const value = request.headers.get(header)
      if (value) return value.split(',')[0].trim().slice(0, 64)
    }
  }
  return 'unavailable'
}

function fnv(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

// ─── CSP ─────────────────────────────────────────────────────────────────────

const FIREBASE_HOSTS = 'https://*.firebaseapp.com https://*.firebaseio.com https://*.googleapis.com'
const PAYSTACK_HOSTS = 'https://checkout.paystack.com https://api.paystack.co https://js.paystack.co'
const DIDIT_HOSTS = 'https://*.didit.me https://apx.didit.me'

function buildCsp(production: boolean): string {
  const scriptSrc = production
    ? `script-src 'self' 'wasm-unsafe-eval' ${FIREBASE_HOSTS} https://apis.google.com https://js.paystack.co`
    : // Dev mode needs inline/eval for the React refresh runtime injected by Next.
      `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${FIREBASE_HOSTS} https://apis.google.com https://js.paystack.co`

  return [
    `default-src 'self'`,
    scriptSrc,
    // Tailwind emits inline styles; fonts are self-hosted so no external font origin is needed.
    `style-src 'self' 'unsafe-inline'`,
    `font-src 'self' data:`,
    `img-src 'self' data: blob: https:`,
    `connect-src 'self' https: wss:${production ? '' : ' ws:'} ${FIREBASE_HOSTS} ${PAYSTACK_HOSTS}`,
    `frame-src 'self' ${PAYSTACK_HOSTS} ${DIDIT_HOSTS} https://apis.google.com`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    // No `require-trusted-types-for`: Next 14 injects inline bootstrap scripts, so declaring a
    // Trusted Types requirement here would break the app in a way that only shows up in production.
    // XSS is instead handled the other way round — no unsafe-inline in production script-src above.
    ...(production ? [`upgrade-insecure-requests`] : []),
  ].join('; ')
}

function applySecurityHeaders(res: NextResponse): void {
  res.headers.set('Content-Security-Policy', buildCsp(PRODUCTION))
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self), browsing-topics=(), interest-cohort=()')
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  res.headers.set('Cross-Origin-Resource-Policy', PRODUCTION ? 'same-origin' : 'cross-origin')
  res.headers.set('X-DNS-Prefetch-Control', 'off')
  res.headers.set('X-Permitted-Cross-Domain-Policies', 'none')
  if (PRODUCTION) {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const method = request.method.toUpperCase()
  const ipHash = fnv(clientIp(request) || 'unknown')
  const requestId = `${Date.now().toString(36)}${ipHash}`.slice(0, 20)

  const reject = (status: number, message: string, code: string, extra?: Record<string, string>) => {
    const res = NextResponse.json(
      { ok: false, error: message, code, requestId },
      { status, headers: { ...NO_STORE_HEADERS, 'X-Content-Type-Options': 'nosniff', ...extra } },
    )
    return res
  }

  // 1. Scanner noise / traversal attempts.
  if (isNoisePath(pathname)) return reject(404, 'Not found.', 'not_found')

  // 2. Host header integrity.
  const host = request.headers.get('host')
  if (!hostAllowed(host)) {
    if (PRODUCTION) return reject(400, 'Unrecognised host for this deployment.', 'host_not_allowed')
    console.warn(`[middleware] Host "${host}" is not listed in APP_ALLOWED_HOSTS (dev: passing through).`)
  }

  // 3. Cross-site writes.
  if (MUTATING_METHODS.has(method) && !WEBHOOK_PATHS.includes(pathname) && !isSameSiteRequest(request.headers)) {
    return reject(403, 'Cross-site request rejected.', 'csrf_rejected')
  }

  // 4. Per-IP token buckets on sensitive routes (authoritative limits still live in the routes).
  if (EDGE_RATE_LIMIT_ON && pathname.startsWith('/api/')) {
    const rule = RATE_LIMITED.find(([re]) => re.test(pathname))
    if (rule) {
      const verdict = consumeEdgeBucket(`${pathname}:${ipHash}`, Math.max(2, RATE_CAPACITY * rule[1] / 40), 60_000)
      if (!verdict.ok) {
        return reject(429, 'Too many requests from this address. Please wait a moment.', 'rate_limited', {
          'Retry-After': String(verdict.retryAfterSec),
        })
      }
    }
  }

  // 5. Maintenance blackout. Document requests are rewritten to the maintenance screen; API
  //    traffic gets a plain 503 so clients surface a retryable error instead of parsing HTML.
  //    The resolved mode is also forwarded as a request header so the root layout can mark the
  //    document (`<html data-maintenance>`) without reading Firestore a second time.
  let maintenanceMode = 'off'
  if (MAINTENANCE_GATE_ON && !EXTENSION_PATH.test(pathname)) {
    const { status } = await getCachedMaintenanceStatus()
    if (status.bannerOnly) maintenanceMode = 'banner'
    if (status.active) {
      maintenanceMode = 'blackout'
      const privileged = await hasPrivilegedCookie(request)
      const gated = !ADMIN_PATH.test(pathname) && !isOpenPath(pathname)
      if (gated && !privileged) {
        if (isDocumentRequest(request)) {
          const rewriteHeaders = new Headers(request.headers)
          rewriteHeaders.set('x-afterworks-maintenance-mode', 'blackout')
          const res = NextResponse.rewrite(new URL(`/maintenance${search}`, request.url), {
            status: 503,
            request: { headers: rewriteHeaders },
          })
          res.headers.set('Retry-After', String(status.retryAfterSec || 300))
          res.headers.set('X-Maintenance-Mode', 'blackout')
          res.headers.set('X-Robots-Tag', 'noindex, nofollow')
          applySecurityHeaders(res)
          return res
        }
        if (pathname.startsWith('/api/')) {
          return reject(503, 'The platform is inside a maintenance window. Please retry shortly.', 'maintenance_active', {
            'Retry-After': String(status.retryAfterSec || 300),
            'X-Maintenance-Mode': 'blackout',
          })
        }
      }
    }
  }

  // 6. Pass through with hardened headers.
  const headers = new Headers(request.headers)
  headers.set('x-request-id', requestId)
  if (maintenanceMode !== 'off') headers.set('x-afterworks-maintenance-mode', maintenanceMode)
  const response = NextResponse.next({ request: { headers } })
  applySecurityHeaders(response)
  response.headers.set('X-Request-Id', requestId)

  if (ADMIN_PATH.test(pathname) || pathname.startsWith('/api/admin')) {
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value)
  }

  return response
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isDocumentRequest(request: NextRequest): boolean {
  if (request.nextUrl.pathname.startsWith('/api/')) return false
  const fetchMode = request.headers.get('sec-fetch-mode')
  if (fetchMode === 'navigate') return true
  const accept = request.headers.get('accept') || ''
  return accept.includes('text/html') || accept.includes('application/xhtml')
}

/**
 * An operator holding a valid signed session (or bypass) cookie keeps access during a blackout.
 * The edge only derives "is this staff?" from that — it never trusts a client-set flag.
 */
async function hasPrivilegedCookie(request: NextRequest): Promise<boolean> {
  if (!SIGNING_OK) return false
  if (await readSession(request.cookies.get('aw_admin_session')?.value, SESSION_SECRET, 'admin')) return true
  return Boolean(await readSession(request.cookies.get('aw_ops_bypass')?.value, SESSION_SECRET, 'bypass'))
}

/**
 * In-process token bucket. Edge memory is per isolate, so this is deliberately coarse: it blunts
 * scripted abuse, while the authoritative account/IP lockouts are enforced inside the API routes
 * where they can also be audited and unlocked by staff.
 */
type Bucket = { tokens: number; updatedAt: number }
const globalBuckets = globalThis as unknown as { __awEdgeBuckets?: Map<string, Bucket> }

function consumeEdgeBucket(key: string, capacity: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  if (!globalBuckets.__awEdgeBuckets) globalBuckets.__awEdgeBuckets = new Map()
  const buckets = globalBuckets.__awEdgeBuckets
  const now = Date.now()
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now }
  bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updatedAt) / windowMs) * capacity)
  bucket.updatedAt = now

  if (bucket.tokens < 1) {
    buckets.set(key, bucket)
    if (buckets.size > 10_000) buckets.clear()
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - bucket.tokens) / capacity) * (windowMs / 1000))) }
  }
  bucket.tokens -= 1
  buckets.set(key, bucket)
  if (buckets.size > 10_000) buckets.clear()
  return { ok: true, retryAfterSec: 0 }
}

export const config = {
  matcher: [
    /*
     * Everything except immutable build output and Next's image/serialization endpoints —
     * those need no headers, no rate limiting and cannot leak state.
     */
    '/((?!_next/static|_next/image|_next/data).*)',
  ],
}
