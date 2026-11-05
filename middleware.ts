import { NextResponse, type NextRequest } from 'next/server'

/**
 * AfterWorks edge layer — the first and last line of defence for every request.
 *
 * What runs here (and why):
 *  • Host-header validation    → blocks cache poisoning / password-reset poisoning.
 *  • Security headers          → CSP without unsafe-eval in production, HSTS, frame denial.
 *  • Console sign-in gate      → /admin pages require a signed session cookie, full stop. The
 *                                console never decides for itself whether to show you its data.
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
  ADMIN_SESSION_COOKIE,
  MAINTENANCE_BYPASS_COOKIE,
  MUTATING_METHODS,
  NO_STORE_HEADERS,
  adminConsoleLoginPath,
  isAdminConsolePath,
  isSameSiteRequest,
} from '@/lib/security-core'
import { getCachedMaintenanceStatus, isGatedPath, isSignInExempt } from '@/lib/maintenance-shared'
import { renderMaintenanceShell } from '@/lib/maintenance-shell'
import { readSession } from '@/lib/session-token'

// ─── Static configuration (resolved once at module load) ─────────────────────

const PRODUCTION = process.env.NODE_ENV === 'production'
const SESSION_SECRET = (process.env.ADMIN_SESSION_SECRET ?? '').trim()
const SIGNING_OK = SESSION_SECRET.length >= 32
const TRUST_PROXY = (process.env.TRUST_PROXY_HEADERS ?? (PRODUCTION ? 'false' : 'true')) !== 'false'
const EDGE_RATE_LIMIT_ON = (process.env.MIDDLEWARE_RATE_LIMIT ?? 'true') !== 'false'
const MAINTENANCE_GATE_ON = (process.env.MAINTENANCE_EDGE_GATE ?? 'true') !== 'false'
/**
 * Serve the blackout page from the edge as a static document instead of rewriting into the app.
 * The app is usually what is degraded, so the notice must not depend on it. Set
 * MAINTENANCE_STATIC_SHELL=false to fall back to the rendered /maintenance route.
 */
const MAINTENANCE_STATIC_SHELL = (process.env.MAINTENANCE_STATIC_SHELL ?? 'true') !== 'false'
/** Preview tunnels are allowed in development, or in a production preview that opts in. */
const ALLOW_E2B_PREVIEW_HOSTS = (process.env.ALLOW_E2B_PREVIEW_HOSTS ?? 'false') !== 'false'
const SUPPORT_EMAIL_EDGE = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'supportafterworks@gmail.com').trim().toLowerCase()
const RATE_CAPACITY = Number(process.env.MIDDLEWARE_RATE_LIMIT_PER_MINUTE ?? 40)
const ALLOWED_HOSTS = new Set(
  [process.env.APP_ALLOWED_HOSTS, process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL, process.env.RENDER_EXTERNAL_URL, process.env.VERCEL_URL]
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
const WEBHOOK_PATHS = ['/api/paystack/webhook']
const ADMIN_PATH = /^\/(admin|api\/admin)(\/|$)/
const RATE_LIMITED: Array<[RegExp, number]> = [
  [/^\/api\/admin\/auth$/, 8],
  [/^\/api\/auth\//, 8],
  [/^\/api\/kyc\//, 10],
  [/^\/api\/paystack\//, 25],
  [/^\/api\/applications/, 30],
  [/^\/api\/wallet/, 60],
  // Referral attribution runs during sign-up, so it is limited like an auth route: it is a write
  // that can mint credit, and it must never be usable as an unauthenticated faucet. It gets its
  // own rule because it is not under /api/auth, and the first matching entry wins.
  // `/api/auth/terms` needs no rule of its own — the `/^\/api\/auth\//` entry above already covers
  // it, and at 8/min it is already tighter than any limit worth writing here.
  [/^\/api\/referrals/, 15],
]

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i
const PREVIEW_HOST = /^[a-z0-9-]+\.e2b\.app$/i

function isOpenPath(pathname: string): boolean {
  return ALWAYS_OPEN.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function hostAllowed(host: string | null): boolean {
  if (!host) return false
  const value = host.toLowerCase().trim()
  const listed = [...ALLOWED_HOSTS].some((allowed) => value === allowed || value.endsWith(`.${allowed}`))
  // `localhost` is a development convenience, not a public host. In production it must be listed
  // explicitly; otherwise a forged Host: localhost reaches request handlers that build absolute
  // URLs (verification links, callbacks) from the request.
  if (LOCAL_HOST.test(value)) return !PRODUCTION || listed
  if (PREVIEW_HOST.test(value)) return !PRODUCTION || ALLOW_E2B_PREVIEW_HOSTS || listed
  // Platform wildcards are a development convenience, not an allow-list. In production every
  // host must match APP_ALLOWED_HOSTS / APP_URL / RENDER_EXTERNAL_URL; otherwise any tenant on the
  // shared onrender.com or vercel.app domain could make the app believe a forged Host header.
  if (!PRODUCTION && (value.endsWith('.onrender.com') || value.endsWith('.vercel.app'))) return true
  if (ALLOWED_HOSTS.size === 0) return !PRODUCTION
  return listed
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
/**
 * Firestore's realtime listener runs over WebChannel, whose WebSocket endpoint is
 * `wss://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?...&TYPE=websocket`.
 * The https wildcard above does not match a `wss:` URL, and `wss://*.firebaseio.com` is the
 * Realtime Database host, not Firestore — so the socket was refused and the SDK quietly fell back
 * to the XHR long-poll transport (`TYPE=xmlhttp`). Realtime updates still arrived, one held
 * connection per listener, with reconnect latency and far more requests than a socket needs.
 * The https wildcard is already allowed for the same hosts, so this widens nothing.
 */
const FIREBASE_WSS_HOSTS = 'wss://*.googleapis.com'
const PAYSTACK_HOSTS = 'https://checkout.paystack.com https://api.paystack.co https://js.paystack.co'

function buildCsp(production: boolean, nonce: string): string {
  // Production: no 'unsafe-inline' / 'unsafe-eval' for scripts — Next.js's own inline bootstrap
  // scripts carry the per-request nonce (passed via the x-nonce request header below), and the app
  // has no other inline scripts (the only <script> blocks are JSON-LD data, which CSP does not
  // treat as executable). An XSS that slips in therefore has no inline script execution channel.
  const scriptSrc = production
    ? `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' ${FIREBASE_HOSTS} https://apis.google.com https://js.paystack.co`
    : // Dev mode needs inline/eval for the React refresh runtime injected by Next.
      `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${FIREBASE_HOSTS} https://apis.google.com https://js.paystack.co`

  return [
    `default-src 'self'`,
    scriptSrc,
    // Tailwind emits inline styles; fonts are self-hosted so no external font origin is needed.
    `style-src 'self' 'unsafe-inline'`,
    `font-src 'self' data:`,
    `img-src 'self' data: blob: https:`,
    // No blanket `https: wss:`. A successful script injection could otherwise exfiltrate the
    // member's data to any host; the app only talks to Firebase and Paystack.
    `connect-src 'self' ${production ? '' : 'ws: '}${FIREBASE_HOSTS} ${FIREBASE_WSS_HOSTS} ${PAYSTACK_HOSTS} wss://*.firebaseio.com wss://*.firebaseapp.com`,
    `frame-src 'self' ${FIREBASE_HOSTS} ${PAYSTACK_HOSTS} https://apis.google.com`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    ...(production ? [`frame-ancestors 'none'`] : []),
    // No `require-trusted-types-for`: Next 14 injects inline bootstrap scripts (nonce'd above), so
    // declaring a Trusted Types requirement here would break the app in a way that only shows up
    // in production.
    ...(production ? [`upgrade-insecure-requests`] : []),
  ].join('; ')
}

function applySecurityHeaders(res: NextResponse, nonce: string): void {
  res.headers.set('Content-Security-Policy', buildCsp(PRODUCTION, nonce))
  if (PRODUCTION) res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // camera=(self): the assessment proctor needs the webcam on this origin. microphone stays off.
  res.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(self), browsing-topics=(), interest-cohort=()')
  // OAuth/payment popups must retain a reference to their opener so they can post the result back.
  // `same-origin` severs that channel for Google's cross-origin window and makes Firebase report a
  // closed/cancelled popup. This still isolates pages opened *by* another origin while allowing
  // popups that AfterWorks itself opens.
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
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
  // Per-request CSP nonce for production. It is put on the request (x-nonce) so Next.js stamps it
  // on its own inline bootstrap scripts, and into the CSP header so only those may run.
  const cspNonce = PRODUCTION
    ? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    : ''

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

  // 5. The console's door.
  //
  //    Every `/api/admin/*` route guards itself (401 without a verified session), but the *pages*
  //    under /admin used to be served to anyone: which one you saw — console or sign-in form — was
  //    decided by client JavaScript after an async probe. A bookmark, a crawler, a shared
  //    screenshot, a browser whose session had expired, or simply a tab whose bundle never
  //    finished loading could therefore bring up console chrome before, or instead of, the form.
  //    Signing in is now a requirement of the server: no signed session cookie, no console page —
  //    the request is answered with a redirect to `/admin/login` that remembers where it was going.
  //
  //    `/admin/login` itself is always reachable (it is the way in), and `/api/admin/*` is left to
  //    the route guards so those keep answering JSON errors rather than redirects.
  //
  //    Skipped when the edge holds no usable signing secret: it could not verify a cookie anyway,
  //    and with no secret no session can exist to verify (`lib/security.ts` fails closed in
  //    production and falls back to a process-local dev key otherwise, where the in-app gate
  //    still applies). That keeps local development without ADMIN_SESSION_SECRET working instead
  //    of bouncing an operator around the login form forever.
  if (isAdminConsolePath(pathname)) {
    // With no signing secret the edge cannot verify a session, but it must still not serve console
    // pages. In production that is a configuration failure: send the operator to the sign-in page
    // (which explains the console is disabled) instead of rendering console chrome and relying on a
    // client-side gate. Local development without a secret keeps the in-app gate.
    if (!SIGNING_OK) {
      if (PRODUCTION) {
        const res = NextResponse.redirect(new URL('/admin/login?reason=console_unconfigured', request.url), 307)
        res.headers.set('Cache-Control', 'no-store')
        applySecurityHeaders(res, cspNonce)
        return res
      }
    } else {
      const session = await readSession(
        request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
        SESSION_SECRET,
        'admin',
      )
      if (!session) {
        const res = NextResponse.redirect(
          new URL(adminConsoleLoginPath(pathname, request.nextUrl.search), request.url),
          307,
        )
        res.headers.set('Cache-Control', 'no-store')
        applySecurityHeaders(res, cspNonce)
        return res
      }
    }
  }

  // 6. Maintenance blackout. Document requests are rewritten to the maintenance screen; API
  //    traffic gets a plain 503 so clients surface a retryable error instead of parsing HTML.
  //    The resolved mode is also forwarded as a request header so the root layout can mark the
  //    document (`<html data-maintenance>`) without reading Firestore a second time.
  let maintenanceMode = 'off'
  if (MAINTENANCE_GATE_ON && !EXTENSION_PATH.test(pathname)) {
    const { status } = await getCachedMaintenanceStatus()
    maintenanceMode = status.blocksAll
      ? 'blackout'
      : status.active
        ? 'sections'
        : status.bannerOnly
          ? 'banner'
          : 'off'

    if (status.active) {
      const privileged = await hasPrivilegedCookie(request)
      // Always open: the console (so the operator can end the window), the outage and status
      // pages, health/maintenance feeds, static assets. A whole-site blackout also takes down
      // /sign-in — `allowSignIn` only keeps auth reachable during a *scoped* window.
      const gated =
        !ADMIN_PATH.test(pathname) &&
        !isOpenPath(pathname) &&
        !isSignInExempt(pathname, status) &&
        (status.blocksAll || isGatedPath(pathname, status))

      if (gated && !privileged) {
        const modeLabel = status.blocksAll ? 'blackout' : 'sections'
        if (pathname.startsWith('/api/')) {
          return reject(
            503,
            status.blocksAll
              ? 'The platform is inside a maintenance window. Please retry shortly.'
              : 'This part of the platform is under maintenance. Everything else keeps working.',
            'maintenance_active',
            {
              'Retry-After': String(status.retryAfterSec || 300),
              'X-Maintenance-Mode': modeLabel,
              ...(status.blocksAll ? {} : { 'X-Maintenance-Paths': status.blockedPaths.join(' ') }),
            },
          )
        }
        if (isDocumentRequest(request)) {
          if (MAINTENANCE_STATIC_SHELL) {
            // No bundle, no providers, no datastore read: the notice is built right here from the
            // cached config, so it survives the app being down.
            const html = renderMaintenanceShell(status, {
              siteName: 'AfterWorks',
              supportEmail: SUPPORT_EMAIL_EDGE,
              statusPath: '/status',
            })
            const res = new NextResponse(html, {
              status: 503,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Retry-After': String(status.retryAfterSec || 300),
                'X-Maintenance-Mode': modeLabel,
                'X-Robots-Tag': 'noindex, nofollow',
              },
            })
            applySecurityHeaders(res, cspNonce)
            return res
          }
          const rewriteHeaders = new Headers(request.headers)
          rewriteHeaders.set('x-afterworks-maintenance-mode', modeLabel)
          if (PRODUCTION) rewriteHeaders.set('x-nonce', cspNonce)
          const res = NextResponse.rewrite(new URL(`/maintenance${search}`, request.url), {
            status: 503,
            request: { headers: rewriteHeaders },
          })
          res.headers.set('Retry-After', String(status.retryAfterSec || 300))
          res.headers.set('X-Maintenance-Mode', modeLabel)
          res.headers.set('X-Robots-Tag', 'noindex, nofollow')
          applySecurityHeaders(res, cspNonce)
          return res
        }
      }
    }
  }

  // 7. Pass through with hardened headers.
  const headers = new Headers(request.headers)
  headers.set('x-request-id', requestId)
  if (PRODUCTION) headers.set('x-nonce', cspNonce)
  if (maintenanceMode !== 'off') headers.set('x-afterworks-maintenance-mode', maintenanceMode)
  const response = NextResponse.next({ request: { headers } })
  applySecurityHeaders(response, cspNonce)
  response.headers.set('X-Request-Id', requestId)

  if (ADMIN_PATH.test(pathname) || pathname.startsWith('/api/admin')) {
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value)
  }

  // Tell crawlers not to index private/API routes even if they discover them through links.
  // This is belt-and-suspenders alongside robots.txt (which they should respect first).
  const NOINDEX_PATHS = /^\/(api|admin|dashboard|profile|applications|jobs|referrals|kyc|training|wallet|verify-email|forgot-password)(\/|$)/
  if (NOINDEX_PATHS.test(pathname)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
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
  if (await readSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value, SESSION_SECRET, 'admin')) return true
  return Boolean(await readSession(request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value, SESSION_SECRET, 'bypass'))
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
