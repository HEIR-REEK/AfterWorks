/**
 * Route guards — the gate every privileged or state-changing API route must pass through.
 *
 * Rules of engagement for this codebase:
 *  • The browser never decides who is an admin. It asks, and this module answers.
 *  • Every mutation is (a) authenticated, (b) same-site, (c) rate-limited by the caller, and
 *    (d) written to the audit ledger with a redacted diff. No exceptions for "quick" endpoints.
 *  • Failures return generic copy to the client and precise copy to the log.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  ADMIN_COOKIE,
  LEGACY_ADMIN_COOKIES,
  attemptKey,
  checkAttemptBudget,
  readAdminSession,
  securityChecks,
} from '@/lib/security'
import {
  MUTATING_METHODS,
  NO_STORE_HEADERS,
  clientIdentity,
  env,
  envBool,
  envInt,
  isHostAllowed,
  isProduction,
  isSameSiteRequest,
  parseEmailList,
  type ClientIdentity,
} from '@/lib/security-core'
import { getCachedMaintenanceStatus, isGatedPath, isSignInExempt, resolveMaintenance } from '@/lib/maintenance-shared'
import {
  getCachedRevocation,
  invalidateGuardCaches,
  getCachedRole,
  setCachedRole,
  setCachedRevocation,
} from '@/lib/guard-cache'

export type AdminPrincipal = {
  email: string
  /** Session id (revocable) or the Firebase uid when the caller used a bearer ID token. */
  jti: string
  expiresAt: number
  via: 'session-cookie' | 'firebase-token'
}

export type GuardResult<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

// ─── Response helpers ────────────────────────────────────────────────────────

export function json(data: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(data, init)
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) res.headers.set(key, value)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  return res
}

export function fail(
  status: number,
  message: string,
  extras?: Record<string, unknown> & { code?: string; headers?: Record<string, string> },
): NextResponse {
  const { headers, ...rest } = extras ?? {}
  const res = json({ ok: false, error: message, ...rest }, { status })
  for (const [key, value] of Object.entries(headers ?? {})) res.headers.set(key, value)
  return res
}

export function unauthorized(message = 'Administrator sign-in required.'): NextResponse {
  return fail(401, message, { code: 'admin_session_required' })
}

export function forbidden(message = 'Your account is not authorised for this action.'): NextResponse {
  return fail(403, message, { code: 'forbidden' })
}

export function tooManyRequests(retryAfterSec: number, message?: string): NextResponse {
  return fail(429, message ?? 'Too many attempts. Please wait before trying again.', {
    code: 'rate_limited',
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))) },
  })
}

// ─── Shared request context ──────────────────────────────────────────────────

export type RequestContext = {
  identity: ClientIdentity
  requestId: string
}

export function requestContext(req: NextRequest): RequestContext {
  const identity = clientIdentity(req.headers)
  return { identity, requestId: identity.requestId || randomRequestId() }
}

function randomRequestId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

/** Origin/Referer + Sec-Fetch-Site enforcement for every mutation. */
export function assertSameSite(req: NextRequest): NextResponse | null {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return null
  if (isSameSiteRequest(req.headers)) return null
  return fail(403, 'Cross-site request rejected.', { code: 'csrf_rejected' })
}

/**
 * Global per-IP budget for sensitive routes (shared implementation with the middleware, but
 * scoped per-route here). Returns null when the caller is within budget.
 */
const globalBuckets = globalThis as unknown as { __awBuckets?: Map<string, { tokens: number; updatedAt: number }> }

export function consumeBucket(scope: string, capacity: number, windowMs: number, key: string): { ok: boolean; retryAfterSec: number } {
  if (!envBool('API_RATE_LIMIT_ENABLED', true)) return { ok: true, retryAfterSec: 0 }
  if (!globalBuckets.__awBuckets) globalBuckets.__awBuckets = new Map()
  const buckets = globalBuckets.__awBuckets
  const bucketKey = `${scope}:${key}`
  const now = Date.now()
  const bucket = buckets.get(bucketKey) ?? { tokens: capacity, updatedAt: now }

  const refill = ((now - bucket.updatedAt) / windowMs) * capacity
  bucket.tokens = Math.min(capacity, bucket.tokens + refill)
  bucket.updatedAt = now

  if (bucket.tokens < 1) {
    buckets.set(bucketKey, bucket)
    return { ok: false, retryAfterSec: Math.ceil(((1 - bucket.tokens) / capacity) * (windowMs / 1000)) }
  }
  bucket.tokens -= 1
  buckets.set(bucketKey, bucket)

  if (buckets.size > 20_000) {
    for (const [k, v] of buckets) {
      if (now - v.updatedAt > windowMs * 4) buckets.delete(k)
    }
  }
  return { ok: true, retryAfterSec: 0 }
}

export function rateLimit(req: NextRequest, scope: string, capacity?: number, windowMs?: number): NextResponse | null {
  const { identity } = requestContext(req)
  const limit = capacity ?? envInt('API_RATE_LIMIT_PER_MINUTE', 60)
  const window = windowMs ?? 60_000
  const verdict = consumeBucket(scope, limit, window, identity.ipHash)
  if (verdict.ok) return null
  return tooManyRequests(verdict.retryAfterSec, 'This endpoint is rate limited. Please slow down and retry.')
}

// ─── Maintenance gate for API traffic ───────────────────────────────────────

export async function maintenanceBlockForApi(req: NextRequest, opts?: { privileged?: boolean }): Promise<NextResponse | null> {
  if (opts?.privileged) return null
  const status = await getCachedMaintenanceStatus()
  const { active, config, retryAfterSec, blocksAll, blockedPaths } = status.status
  if (!active) return null
  // Console auth stays reachable (ADMIN_PATH). Worker /api/auth is only exempt on a scoped window.
  if (isSignInExempt(req.nextUrl.pathname, status.status) || (config.allowSignIn && !blocksAll && isAuthRoute(req.nextUrl.pathname))) return null
  // Scoped window: only the listed areas are down. A wallet endpoint must fail while the job board
  // keeps answering, otherwise "some parts are under maintenance" is a lie the UI tells.
  if (!blocksAll && !isGatedPath(req.nextUrl.pathname, status.status)) return null
  return fail(503, config.message || 'The platform is in a maintenance window. Please retry shortly.', {
    code: 'maintenance_active',
    details: blocksAll ? undefined : { affectedPaths: blockedPaths },
    headers: {
      'Retry-After': String(retryAfterSec || 300),
      'X-Maintenance-Mode': blocksAll ? 'blackout' : 'sections',
    },
  })
}

function isAuthRoute(pathname: string): boolean {
  return pathname.startsWith('/api/admin/auth') || pathname.startsWith('/api/auth')
}

// ─── Firestore-backed privileged helpers (lazy import keeps edge-safe paths light) ─

/** Env roster ∪ Firestore role — never a client-asserted value. */
export async function isPrivilegedEmail(email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase()
  if (!clean) return false

  const cached = getCachedRole(`role:${clean}`)
  if (cached !== null) return cached

  const roster = parseEmailList(env('ADMIN_EMAILS'))
  let decision = roster.includes(clean)

  if (!decision) {
    try {
      const { checkUserAdminRoleAdmin } = await import('@/lib/firestore-admin')
      decision = await checkUserAdminRoleAdmin(clean)
    } catch (err) {
      console.warn('[guard] Firestore role lookup failed; denying privilege escalation:', err)
      decision = false
    }
  }

  setCachedRole(`role:${clean}`, decision, Math.max(5, envInt('ADMIN_ROLE_CACHE_SECONDS', 45)) * 1000)
  return decision
}

async function getRevocationState(): Promise<{ revokedBefore: number; revokedJtis: Set<string> }> {
  const cached = getCachedRevocation()
  if (cached) return cached
  let revokedBefore = 0
  const revokedJtis = new Set<string>()
  try {
    const { getSecuritySettings } = await import('@/lib/firestore-admin')
    const settings = await getSecuritySettings()
    revokedBefore = settings.revokedBefore
    for (const jti of settings.revokedJtis) revokedJtis.add(jti)
  } catch (err) {
    console.warn('[guard] Could not load revocation state:', err)
  }
  return setCachedRevocation(revokedBefore, revokedJtis, Math.max(5, envInt('ADMIN_REVOKE_CACHE_SECONDS', 20)) * 1000)
}

export function clearRevocationCache(): void {
  invalidateGuardCaches()
}

/**
 * Forget cached privilege decisions. Called right after a role change so a demoted operator loses
 * access on their next request rather than when the cache entry happens to expire.
 */
export function invalidateAdminCache(email?: string): void {
  invalidateGuardCaches(email)
}

// ─── requireAdmin ────────────────────────────────────────────────────────────

export async function resolveAdmin(req: NextRequest): Promise<AdminPrincipal | null> {
  // 1) Signed, HttpOnly, SameSite=strict session cookie (set by /api/admin/auth).
  const cookieToken =
    req.cookies.get(ADMIN_COOKIE)?.value ||
    LEGACY_ADMIN_COOKIES.map((name) => req.cookies.get(name)?.value).find(Boolean) ||
    null

  if (cookieToken) {
    const claims = await readAdminSession(cookieToken)
    if (claims) {
      const { revokedBefore, revokedJtis } = await getRevocationState()
      const revoked = claims.iat <= revokedBefore || revokedJtis.has(claims.jti)
      if (!revoked && (await isPrivilegedEmail(claims.sub))) {
        return { email: claims.sub, jti: claims.jti, expiresAt: claims.exp, via: 'session-cookie' }
      }
    }
  }

  // 2) Firebase ID token with an `admin` custom claim (or Firestore role) — used by tooling
  //    and by the in-app "continue as staff" path.
  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (bearer) {
    try {
      const { verifyIdToken } = await import('@/lib/firestore-admin')
      const decoded = await verifyIdToken(bearer)
      if (decoded?.email) {
        const claimedAdmin = (decoded as unknown as { admin?: boolean }).admin === true
        if (claimedAdmin || (await isPrivilegedEmail(decoded.email))) {
          return {
            email: decoded.email.toLowerCase(),
            jti: `uid:${decoded.uid}`,
            expiresAt: (decoded.exp ?? 0) * 1000,
            via: 'firebase-token',
          }
        }
      }
    } catch (err) {
      console.warn('[guard] Bearer token verification failed:', err)
    }
  }

  return null
}

export async function requireAdmin(req: NextRequest): Promise<GuardResult<AdminPrincipal>> {
  const principal = await resolveAdmin(req)
  if (principal) return { ok: true, value: principal }
  return {
    ok: false,
    response: unauthorized(
      isProduction()
        ? 'Your administrator session is not active or has expired.'
        : 'Administrator session required. Sign in at /admin/login (dev: ensure ADMIN_SESSION_SECRET + ADMIN_EMAILS are set).',
    ),
  }
}

export type UserPrincipal = {
  uid: string
  email: string
  emailVerified: boolean
  isAdmin: boolean
}

export async function requireUser(req: NextRequest): Promise<GuardResult<UserPrincipal>> {
  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!bearer) {
    return { ok: false, response: fail(401, 'Sign in to continue.', { code: 'auth_required' }) }
  }
  try {
    const { verifyIdToken } = await import('@/lib/firestore-admin')
    const decoded = await verifyIdToken(bearer)
    if (!decoded) {
      return { ok: false, response: fail(401, 'Your session expired. Please sign in again.', { code: 'auth_invalid' }) }
    }
    const email = (decoded.email || '').toLowerCase()
    return {
      ok: true,
      value: {
        uid: decoded.uid,
        email,
        emailVerified: Boolean(decoded.email_verified),
        isAdmin: (decoded as unknown as { admin?: boolean }).admin === true || (await isPrivilegedEmail(email)),
      },
    }
  } catch (err) {
    console.error('[guard] requireUser failed:', err)
    return { ok: false, response: fail(503, 'Authentication service unavailable. Please retry.', { code: 'auth_unavailable' }) }
  }
}

/**
 * Same as `requireUser`, plus the Firebase `email_verified` claim. Profile updates via the
 * client SDK are separately fenced by the app gate; this is the server fence for KYC, apply
 * and checkout — the things that must not run against an unproven inbox.
 */
export async function requireVerifiedUser(req: NextRequest): Promise<GuardResult<UserPrincipal>> {
  const guard = await requireUser(req)
  if (!guard.ok) return guard
  if (!guard.value.emailVerified) {
    return {
      ok: false,
      response: fail(403, 'Verify your email before continuing. Check your inbox for the AfterWorks link.', {
        code: 'email_not_verified',
      }),
    }
  }
  return guard
}

// ─── Host integrity (defence in depth below the middleware) ───────────────────

export function assertHost(req: NextRequest): NextResponse | null {
  if (isHostAllowed(req.headers.get('host'))) return null
  return fail(400, 'Unrecognised host.', { code: 'host_not_allowed' })
}

// ─── Audit trail ─────────────────────────────────────────────────────────────

export type AuditInput = {
  action: string
  actorEmail?: string
  details?: Record<string, unknown>
  req?: NextRequest
  /** Audit failures must never break the user-facing action. */
  throwOnError?: boolean
}

export async function audit({ action, actorEmail, details, req, throwOnError }: AuditInput): Promise<void> {
  try {
    const { createAuditEntry } = await import('@/lib/firestore-admin')
    const base = req ? requestContext(req) : null
    await createAuditEntry(action, {
      ...(details ?? {}),
      requestId: base?.requestId,
      ip: base ? base.identity.ipHash : undefined,
      ua: base ? base.identity.userAgent.slice(0, 120) : undefined,
      at: new Date().toISOString(),
    }, actorEmail || 'System')
  } catch (err) {
    console.error(`[audit] Failed to record "${action}":`, err)
    if (throwOnError) throw err
  }
}

/** Convenience: standard error envelope for unexpected route failures (never leak stack). */
export function routeError(route: string, err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[${route}]`, message)
  if (message.startsWith('MAINTENANCE:')) {
    return fail(503, message.slice('MAINTENANCE:'.length), { code: 'maintenance_active' })
  }
  return fail(500, 'The request could not be completed. Please retry in a moment.', {
    code: 'internal_error',
    ...(isProduction() ? {} : { detail: message.slice(0, 200) }),
  })
}

export { resolveMaintenance, securityChecks, attemptKey, checkAttemptBudget }
