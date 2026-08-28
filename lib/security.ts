/**
 * AfterWorks server-side security layer (Node runtime only — never import this from the browser
 * or from `middleware.ts`; import `@/lib/security-core` for the shared parts).
 *
 * Responsibilities
 * ────────────────
 * 1. Single place where privileged secrets are read (ADMIN_PASSWORD, ADMIN_SESSION_SECRET, …)
 *    so no client bundle can ever reach them by accident.
 * 2. Passcode verification with scrypt + constant-time compare (no length or timing oracle).
 * 3. Admin session issuing, expiry and *revocation* (shared secret means "log out everywhere").
 * 4. Brute-force lockouts that key on IP **and** target email, so rotating one of the two does
 *    not fully reset the budget.
 * 5. A machine-readable posture report consumed by the admin Security Center.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  env,
  envBool,
  envInt,
  isEmailLike,
  isProduction,
  parseEmailList,
  worstSeverity,
  type SecurityCheck,
} from '@/lib/security-core'
import { issueSession, readSession, type SessionClaims } from '@/lib/session-token'

// ─── Configuration ───────────────────────────────────────────────────────────

export type SecurityConfig = {
  sessionSecret: string
  /** True when a usable secret exists (production fails closed without one). */
  secretReady: boolean
  sessionTtlMs: number
  adminEmails: string[]
  /** Hashed admin passcode material, or null when the master passcode is disabled. */
  passcode: { source: 'scrypt-env' | 'env-derived' | 'none'; value: string }
  lockoutThreshold: number
  lockoutWindowMs: number
  lockoutMs: number
  requireHostAllowList: boolean
  leakyClientVars: string[]
}

let cachedConfig: { value: SecurityConfig; expiresAt: number } | null = null
const CONFIG_TTL_MS = 30_000

/** Env vars whose *names* are safe to check but whose values must never be public. */
const LEAKY_PUBLIC_VARS = ['NEXT_PUBLIC_ADMIN_PASSWORD', 'NEXT_PUBLIC_ADMIN_EMAILS', 'NEXT_PUBLIC_ADMIN_SESSION_SECRET']

function detectLeakedPublicVars(): string[] {
  return LEAKY_PUBLIC_VARS.filter((name) => env(name) !== '')
}

function derivePasscode(): SecurityConfig['passcode'] {
  const scryptEnv = env('ADMIN_PASSWORD_SCRYPT').trim()
  if (scryptEnv.startsWith('scrypt$')) {
    return { source: 'scrypt-env', value: scryptEnv }
  }
  const plaintext = env('ADMIN_PASSWORD')
  if (plaintext) {
    // Hash once per process; the plaintext value is then dropped on the floor and never leaves
    // the server. Rotate by regenerating the scrypt digest into ADMIN_PASSWORD_SCRYPT.
    const salt = env('ADMIN_PASSWORD_SALT') || 'afterworks-admin-passcode'
    return { source: 'env-derived', value: hashPasscode(plaintext, salt) }
  }
  return { source: 'none', value: '' }
}

export function getSecurityConfig(): SecurityConfig {
  const now = Date.now()
  if (cachedConfig && cachedConfig.expiresAt > now) return cachedConfig.value

  let secret = env('ADMIN_SESSION_SECRET').trim()
  const production = isProduction()
  if (secret.length < 32) {
    if (production) {
      console.error(
        '[security] ADMIN_SESSION_SECRET is missing or shorter than 32 characters. ' +
          'Admin sessions are disabled until it is configured (fail-closed).',
      )
      secret = ''
    } else {
      secret = secret || `dev-only-${randomBytes(24).toString('hex')}`
      if (!process.env.__AW_DEV_SECRET_WARNED) {
        process.env.__AW_DEV_SECRET_WARNED = '1'
        console.warn(
          '[security] Using an ephemeral development ADMIN_SESSION_SECRET. ' +
            'Admin sessions will be invalidated on restart. Set ADMIN_SESSION_SECRET for production.',
        )
      }
    }
  }

  const value: SecurityConfig = {
    sessionSecret: secret,
    secretReady: secret.length >= 32,
    sessionTtlMs: Math.max(5, envInt('ADMIN_SESSION_TTL_MINUTES', 240)) * 60_000,
    adminEmails: parseEmailList(env('ADMIN_EMAILS')),
    passcode: derivePasscode(),
    lockoutThreshold: Math.max(3, envInt('ADMIN_LOCKOUT_THRESHOLD', 5)),
    lockoutWindowMs: Math.max(60, envInt('ADMIN_LOCKOUT_WINDOW_SECONDS', 900)) * 1000,
    lockoutMs: Math.max(60, envInt('ADMIN_LOCKOUT_SECONDS', 900)) * 1000,
    requireHostAllowList: envBool('REQUIRE_HOST_ALLOW_LIST', production),
    leakyClientVars: detectLeakedPublicVars(),
  }

  cachedConfig = { value, expiresAt: now + CONFIG_TTL_MS }
  return value
}

export function invalidateSecurityConfig(): void {
  cachedConfig = null
}

// ─── Passcode hashing ────────────────────────────────────────────────────────

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

export function hashPasscode(passcode: string, salt: string = randomBytes(16).toString('hex')): string {
  const derived = scryptSync(passcode.normalize('NFKC'), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  }).toString('hex')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`
}

export function verifyPasscode(stored: string, candidate: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, expectedHex] = parts
  let candidateHex: string
  try {
    candidateHex = scryptSync(candidate.normalize('NFKC'), salt, expectedHex.length / 2, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    }).toString('hex')
  } catch {
    return false
  }
  const a = Buffer.from(candidateHex, 'hex')
  const b = Buffer.from(expectedHex, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Rough entropy estimate so the admin console can warn about weak passcodes. */
export function passcodeStrength(input: string): { score: 0 | 1 | 2 | 3 | 4; issues: string[] } {
  const issues: string[] = []
  let score = 0
  if (input.length >= 10) score += 1
  else issues.push('Use at least 12 characters')
  if (/[a-z]/.test(input) && /[A-Z]/.test(input)) score += 1
  else issues.push('Mix upper and lower case')
  if (/\d/.test(input) && /[^A-Za-z0-9]/.test(input)) score += 1
  else issues.push('Add a digit and a symbol')
  if (input.length >= 16) score += 1
  else issues.push('16+ characters resists offline cracking')
  const common = ['password', 'admin', 'afterworks', '12345', 'qwerty', 'letmein', 'welcome']
  if (common.some((c) => input.toLowerCase().includes(c))) {
    score = Math.max(0, score - 2)
    issues.push('Avoid common words like "password"/"admin"')
  }
  return { score: Math.min(4, score) as 0 | 1 | 2 | 3 | 4, issues }
}

// ─── Admin sessions ──────────────────────────────────────────────────────────

export const ADMIN_COOKIE = 'aw_admin_session'
export const BYPASS_COOKIE = 'aw_ops_bypass'
export const LEGACY_ADMIN_COOKIES = ['afterworks_admin_session']

export type AdminSession = { token: string; jti: string; expiresAt: number; email: string }

export async function createAdminSession(email: string): Promise<AdminSession | null> {
  const cfg = getSecurityConfig()
  if (!cfg.secretReady) return null
  const issued = await issueSession(email, cfg.sessionSecret, cfg.sessionTtlMs, 'admin')
  return { ...issued, email: email.trim().toLowerCase() }
}

/** Short-lived cookie that only bypasses maintenance mode (ops on-call, audited). */
export async function createBypassSession(email: string, ttlMs = 12 * 60 * 60 * 1000): Promise<string | null> {
  const cfg = getSecurityConfig()
  if (!cfg.secretReady) return null
  const { token } = await issueSession(email, cfg.sessionSecret, ttlMs, 'bypass')
  return token
}

export async function readAdminSession(token: string | undefined | null): Promise<SessionClaims | null> {
  const cfg = getSecurityConfig()
  if (!cfg.secretReady || !token) return null
  return readSession(token, cfg.sessionSecret, 'admin')
}

export async function readBypassSession(token: string | undefined | null): Promise<SessionClaims | null> {
  const cfg = getSecurityConfig()
  if (!cfg.secretReady || !token) return null
  return readSession(token, cfg.sessionSecret, 'bypass')
}

// ─── Brute-force lockouts ────────────────────────────────────────────────────

type AttemptRecord = {
  count: number
  first: number
  last: number
  lockedUntil: number
}

type AttemptStore = {
  map: Map<string, AttemptRecord>
  lastSweep: number
  totalBlocked: number
  totalAttempts: number
}

const globalStore = globalThis as unknown as { __awAttemptStore?: AttemptStore }

function attempts(): AttemptStore {
  if (!globalStore.__awAttemptStore) {
    globalStore.__awAttemptStore = { map: new Map(), lastSweep: Date.now(), totalBlocked: 0, totalAttempts: 0 }
  }
  return globalStore.__awAttemptStore
}

const MAX_TRACKED_KEYS = 20_000

function sweep(store: AttemptStore, now: number, windowMs: number): void {
  if (now - store.lastSweep < 60_000) return
  store.lastSweep = now
  for (const [key, record] of store.map) {
    if (record.lockedUntil < now && now - record.last > windowMs) store.map.delete(key)
  }
  // Hard cap: evict the oldest entries so an attacker cannot balloon our heap.
  if (store.map.size > MAX_TRACKED_KEYS) {
    const overflow = store.map.size - MAX_TRACKED_KEYS
    let i = 0
    for (const key of store.map.keys()) {
      store.map.delete(key)
      if (++i >= overflow) break
    }
  }
}

export type AttemptVerdict = {
  allowed: boolean
  remaining: number
  lockedUntil: number | null
  retryAfterSec: number
}

/**
 * Two independent budgets per attempt: one keyed by client IP, one keyed by the *target*
 * email. Blocking either one is enough, which stops both single-IP spraying and
 * "rotate IPs against one account" (classic credential stuffing).
 */
export function checkAttemptBudget(identifier: string): AttemptVerdict {
  const cfg = getSecurityConfig()
  const store = attempts()
  const now = Date.now()
  sweep(store, now, cfg.lockoutWindowMs)

  const record = store.map.get(identifier)
  if (!record) return { allowed: true, remaining: cfg.lockoutThreshold, lockedUntil: null, retryAfterSec: 0 }

  if (record.lockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      lockedUntil: record.lockedUntil,
      retryAfterSec: Math.ceil((record.lockedUntil - now) / 1000),
    }
  }

  if (now - record.first > cfg.lockoutWindowMs) {
    store.map.delete(identifier)
    return { allowed: true, remaining: cfg.lockoutThreshold, lockedUntil: null, retryAfterSec: 0 }
  }

  const remaining = Math.max(0, cfg.lockoutThreshold - record.count)
  return { allowed: remaining > 0, remaining, lockedUntil: null, retryAfterSec: remaining > 0 ? 0 : Math.ceil((record.first + cfg.lockoutWindowMs - now) / 1000) }
}

export function registerFailedAttempt(...identifiers: string[]): { remaining: number; locked: boolean } {
  const cfg = getSecurityConfig()
  const store = attempts()
  const now = Date.now()
  store.totalAttempts += 1
  let remaining = cfg.lockoutThreshold
  let locked = false

  for (const identifier of identifiers) {
    if (!identifier) continue
    const record = store.map.get(identifier) ?? { count: 0, first: now, last: now, lockedUntil: 0 }
    record.count += 1
    record.last = now
    if (record.count >= cfg.lockoutThreshold) {
      // Exponential back-off on repeat offenders: 1×, 2×, 4× … capped at 8× the base lockout.
      const strikes = Math.max(1, Math.floor(record.count / cfg.lockoutThreshold))
      record.lockedUntil = now + cfg.lockoutMs * Math.min(8, 2 ** (strikes - 1))
      locked = true
      store.totalBlocked += 1
      remaining = 0
    } else {
      remaining = Math.min(remaining, Math.max(0, cfg.lockoutThreshold - record.count))
    }
    store.map.set(identifier, record)
  }

  return { remaining, locked }
}

export function clearAttemptBudget(...identifiers: string[]): void {
  const store = attempts()
  for (const identifier of identifiers) {
    if (identifier) store.map.delete(identifier)
  }
}

export function unlockIdentifier(fragment: string): number {
  const store = attempts()
  let removed = 0
  for (const key of Array.from(store.map.keys())) {
    if (key.includes(fragment)) {
      store.map.delete(key)
      removed += 1
    }
  }
  return removed
}

export function attemptSnapshot(): { tracked: number; totalAttempts: number; totalBlocked: number; locked: { key: string; until: number }[] } {
  const store = attempts()
  const now = Date.now()
  const locked = Array.from(store.map.entries())
    .filter(([, record]) => record.lockedUntil > now)
    .map(([key, record]) => ({ key, until: record.lockedUntil }))
    .sort((a, b) => b.until - a.until)
    .slice(0, 25)
  return { tracked: store.map.size, totalAttempts: store.totalAttempts, totalBlocked: store.totalBlocked, locked }
}

export function attemptKey(kind: 'ip' | 'email' | 'route', value: string): string {
  return `${kind}:${createHmac('sha256', getSecurityConfig().sessionSecret || 'unsalted').update(value.toLowerCase()).digest('hex').slice(0, 24)}`
}

// ─── PII redaction for logs / audit rows ─────────────────────────────────────

const SECRET_KEYS = /(password|passcode|token|secret|authorization|cookie|credential|private_?key|otp|cvv)/i
const PII_KEYS = /(email|phone|idnumber|nationalid|accountnumber|bankaccount|bank|id|dob|address|kyc)/i

export function redact(input: unknown, depth = 0): unknown {
  if (depth > 4 || input === null || input === undefined) return input
  if (Array.isArray(input)) return input.slice(0, 25).map((v) => redact(v, depth + 1))
  if (typeof input !== 'object') return typeof input === 'string' && input.length > 300 ? `${input.slice(0, 300)}…` : input

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEYS.test(key)) {
      out[key] = '[redacted]'
      continue
    }
    if (PII_KEYS.test(key)) {
      const asString = typeof value === 'string' ? value : String(value ?? '')
      out[key] = maskMiddle(asString)
      continue
    }
    out[key] = redact(value, depth + 1)
  }
  return out
}

function maskMiddle(value: string): string {
  if (!value) return ''
  if (value.length <= 6) return '•'.repeat(value.length)
  const head = value.slice(0, 2)
  const tail = value.slice(-2)
  return `${head}${'•'.repeat(Math.min(12, Math.max(3, value.length - 4)))}${tail}`
}

// ─── Posture report (admin → Security Center) ────────────────────────────────

export function securityChecks(extra?: { firestoreAdminOk?: boolean; maintenanceEdgeGate?: boolean }): SecurityCheck[] {
  const cfg = getSecurityConfig()
  const production = isProduction()
  const checks: SecurityCheck[] = []

  checks.push({
    id: 'session-secret',
    label: 'Session signing secret',
    severity: cfg.secretReady ? (env('ADMIN_SESSION_SECRET').length >= 48 ? 'pass' : 'warn') : 'fail',
    detail: cfg.secretReady
      ? 'HMAC signing secret loaded; admin tokens are signed, time-limited and revocable.'
      : 'No ADMIN_SESSION_SECRET of 32+ characters — admin sign-in is disabled (fail-closed).',
    fix: 'Generate one with `openssl rand -hex 32` and set ADMIN_SESSION_SECRET.',
  })

  if (cfg.leakyClientVars.length) {
    checks.push({
      id: 'public-env-leak',
      label: 'No secrets in the browser bundle',
      severity: 'fail',
      detail: `These variables must not be NEXT_PUBLIC_* — they are shipped to every visitor: ${cfg.leakyClientVars.join(', ')}.`,
      fix: 'Remove them from the deployment env; the server-only names (ADMIN_EMAILS, ADMIN_PASSWORD) are enough.',
    })
  } else {
    checks.push({
      id: 'public-env-leak',
      label: 'No secrets in the browser bundle',
      severity: 'pass',
      detail: 'No NEXT_PUBLIC_* variables collide with privileged admin configuration.',
    })
  }

  checks.push({
    id: 'passcode-storage',
    label: 'Admin passcode storage',
    severity:
      cfg.passcode.source === 'scrypt-env' ? 'pass' : cfg.passcode.source === 'env-derived' ? (production ? 'warn' : 'pass') : 'fail',
    detail:
      cfg.passcode.source === 'scrypt-env'
        ? 'Only an scrypt digest is stored; the passcode itself is never persisted.'
        : cfg.passcode.source === 'env-derived'
          ? 'Passcode read from ADMIN_PASSWORD and hashed in memory at boot. Prefer a stored scrypt digest.'
          : 'No admin passcode configured — the master passcode door is closed.',
    fix: 'Run `npm run admin:hash-passcode` and set ADMIN_PASSWORD_SCRYPT + ADMIN_PASSWORD_SALT.',
  })

  const configured = env('ADMIN_PASSWORD')
  if (configured) {
    const strength = passcodeStrength(configured)
    checks.push({
      id: 'passcode-strength',
      label: 'Admin passcode entropy',
      severity: strength.score >= 3 ? 'pass' : strength.score >= 2 ? 'warn' : 'fail',
      detail: strength.score >= 3 ? 'Passcode strength looks adequate for the current exposure.' : strength.issues.join(' · '),
    })
  }

  checks.push({
    id: 'admin-roster',
    label: 'Administrator roster',
    severity: cfg.adminEmails.length ? 'pass' : 'warn',
    detail: cfg.adminEmails.length
      ? `${cfg.adminEmails.length} staff ${cfg.adminEmails.length === 1 ? 'account' : 'accounts'} whitelisted (never exposed to clients).`
      : 'ADMIN_EMAILS is empty; only Firestore `role: admin` accounts can enter the console.',
    fix: 'Set ADMIN_EMAILS=ops@afterworks.io (comma separated) or grant roles from the Users page.',
  })

  checks.push({
    id: 'lockout',
    label: 'Brute-force lockout',
    severity: 'pass',
    detail: `${cfg.lockoutThreshold} failures / ${Math.round(cfg.lockoutWindowMs / 60000)} min per IP and per target account, then ${(cfg.lockoutMs / 60000).toFixed(0)} min lockout with exponential back-off.`,
  })

  checks.push({
    id: 'firestore',
    label: 'Firebase Admin credentials',
    severity: extra?.firestoreAdminOk === false ? 'fail' : extra?.firestoreAdminOk === true ? 'pass' : 'warn',
    detail:
      extra?.firestoreAdminOk === true
        ? 'Admin SDK verified: server writes, KYC and audit logging are available.'
        : extra?.firestoreAdminOk === false
          ? 'Admin SDK could not initialise — privileged writes (maintenance, moderation, audit) will fail.'
          : 'Admin SDK not exercised yet in this process.',
    fix: 'Set FIREBASE_SERVICE_ACCOUNT_JSON (single line) or FIREBASE_SERVICE_ACCOUNT_PATH.',
  })

  checks.push({
    id: 'host-allow-list',
    label: 'Host / origin integrity',
    severity: env('APP_ALLOWED_HOSTS') || !production ? 'pass' : 'warn',
    detail: env('APP_ALLOWED_HOSTS')
      ? `Host header must match APP_ALLOWED_HOSTS; cross-site state changes are rejected.`
      : 'Local/preview hosts always pass; set APP_ALLOWED_HOSTS=https://afterworks.io in production to block host-header poisoning.',
    fix: 'Set APP_ALLOWED_HOSTS to your canonical domain(s).',
  })

  checks.push({
    id: 'maintenance-gate',
    label: 'Maintenance interception',
    severity: extra?.maintenanceEdgeGate === false ? 'warn' : 'pass',
    detail:
      extra?.maintenanceEdgeGate === false
        ? 'Edge gate disabled — maintenance is enforced in the app shell only (traffic still reaches the server).'
        : 'Middleware rejects page traffic with 503 + Retry-After during a blackout window, so it holds even for cached HTML and bots.',
  })

  checks.push({
    id: 'transport',
    label: 'Transport & click-jacking',
    // Outside production HSTS/CSP strictness is intentionally relaxed so local HTTP works.
    severity: production ? 'pass' : 'warn',
    detail: production
      ? 'HSTS with preload, CSP frame-ancestors none, X-Frame-Options DENY, nosniff, strict referrer policy.'
      : 'Strict transport/CSP tightening is applied only in production builds.',
    fix: 'Set NODE_ENV=production to enable the hardened header set.',
  })

  return checks
}

export function overallPosture(checks: SecurityCheck[] = securityChecks()): ReturnType<typeof worstSeverity> {
  return worstSeverity(checks)
}
