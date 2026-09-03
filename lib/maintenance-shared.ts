/**
 * Maintenance mode — shared model + resolvers.
 *
 * Pure and runtime-agnostic on purpose: the middleware (Edge), the admin API (Node) and the
 * browser all evaluate maintenance through *this* code, so "what the operator configured",
 * "what the server blocks" and "what the worker sees" can never drift apart.
 */

import { isEmailLike, sanitizeLine, sanitizePlainText } from '@/lib/security-core'

/**
 * Static env reads only.
 *
 * This module is imported by `middleware.ts`, which is compiled for the Edge runtime where
 * `process.env` is *inlined at build time* — `process.env.MY_VAR` works, but a dynamic lookup like
 * `process.env[name]` is undefined. That silently disables the edge maintenance gate on Vercel-style
 * builds, so every env read that the edge path needs goes through these helpers instead.
 */
/**
 * Environment names this module may read.
 *
 * Each one is accessed as a literal below on purpose: Next inlines `process.env.NAME` for the
 * Edge/middleware bundle only when it appears literally in the source. A dynamic index
 * (`process.env[name]`) silently yields `undefined` at the edge, which would mean the maintenance
 * gate and its cache TTL were only ever configurable in Node — i.e. the documented switch would not
 * actually switch the thing that blocks traffic.
 */
export type MaintenanceEnvName =
  | 'FIREBASE_PROJECT_ID'
  | 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'
  | 'FIREBASE_WEB_API_KEY'
  | 'NEXT_PUBLIC_FIREBASE_API_KEY'
  | 'MAINTENANCE_CACHE_MS'
  | 'MAINTENANCE_EDGE_GATE'
  | 'MAINTENANCE_FORCE'
  | 'MAINTENANCE_FORCE_UNTIL'
  | 'MAINTENANCE_FORCE_MESSAGE'
  | 'MAINTENANCE_FORCE_PATHS'

function staticEnv(name: MaintenanceEnvName): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined
  switch (name) {
    case 'FIREBASE_PROJECT_ID':
      return process.env.FIREBASE_PROJECT_ID
    case 'NEXT_PUBLIC_FIREBASE_PROJECT_ID':
      return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    case 'FIREBASE_WEB_API_KEY':
      return process.env.FIREBASE_WEB_API_KEY
    case 'NEXT_PUBLIC_FIREBASE_API_KEY':
      return process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    case 'MAINTENANCE_CACHE_MS':
      return process.env.MAINTENANCE_CACHE_MS
    case 'MAINTENANCE_EDGE_GATE':
      return process.env.MAINTENANCE_EDGE_GATE
    case 'MAINTENANCE_FORCE':
      return process.env.MAINTENANCE_FORCE
    case 'MAINTENANCE_FORCE_UNTIL':
      return process.env.MAINTENANCE_FORCE_UNTIL
    case 'MAINTENANCE_FORCE_MESSAGE':
      return process.env.MAINTENANCE_FORCE_MESSAGE
    case 'MAINTENANCE_FORCE_PATHS':
      return process.env.MAINTENANCE_FORCE_PATHS
    default:
      return undefined
  }
}

export type MaintenanceMode = 'blackout' | 'banner'
/**
 * `full` gates the whole site. `sections` gates only the listed path prefixes, so "payouts are down"
 * does not have to take the job board with it — the rest of the platform keeps working and the notice
 * says which parts are paused.
 */
export type MaintenanceScope = 'full' | 'sections'

/** Editable areas the console offers for `scope: 'sections'`. Paths are matched as prefixes. */
export type MaintenanceSection = { id: string; label: string; paths: readonly string[] }

export const MAINTENANCE_SECTIONS: MaintenanceSection[] = [
  {
    id: 'jobs',
    label: 'Jobs & applications',
    paths: ['/jobs', '/applications', '/api/applications'],
  },
  {
    id: 'wallet',
    label: 'Wallet & payouts',
    paths: ['/profile', '/api/wallet', '/api/payouts'],
  },
  {
    id: 'training',
    label: 'Training & payments',
    paths: ['/training', '/api/paystack'],
  },
  {
    id: 'kyc',
    label: 'ID verification',
    paths: ['/kyc', '/api/kyc'],
  },
]

/** Path prefixes that may never be gated: the exit doors and the things that lift the gate. */
export const MAINTENANCE_UNGATABLE_PATHS = ['/admin', '/status', '/maintenance', '/api/health', '/api/maintenance', '/api/admin']

/**
 * Routes that let somebody get *into* the platform. `allowSignIn` decides whether a blackout keeps
 * these reachable: onboarding should not stop because a payout queue is being drained, but an
 * identity-system incident does want new sessions to wait.
 */
export const MAINTENANCE_SIGN_IN_PATHS = ['/sign-in', '/sign-up', '/api/auth', '/api/kyc/callback']

export function isSignInPath(pathname: string): boolean {
  const clean = pathname.startsWith('/') ? pathname : `/${pathname}`
  return MAINTENANCE_SIGN_IN_PATHS.some((path) => clean === path || clean.startsWith(`${path}/`))
}

export function isUngatablePath(path: string): boolean {
  const clean = path.startsWith('/') ? path : `/${path}`
  return MAINTENANCE_UNGATABLE_PATHS.some((reserved) => clean === reserved || clean.startsWith(`${reserved}/`))
}

/** Normalise one operator-supplied path: leading slash, no trailing slash, no query, 1..20 of them. */
export function normaliseBlockedPath(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const withoutQuery = raw.split(/[?#]/)[0] ?? ''
  const withSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`
  const trimmed = withSlash.replace(/\/+$/, '') || '/'
  if (trimmed.length > 100) return null
  if (isUngatablePath(trimmed)) return null
  if (!/^\/[A-Za-z0-9._~/-]*$/.test(trimmed)) return null
  return trimmed
}
export type MaintenanceReason =
  | 'scheduled_upgrade'
  | 'payment_settlement'
  | 'fraud_review'
  | 'security_patch'
  | 'outage'
  | 'other'

export type ComponentStatus = 'operational' | 'degraded' | 'maintenance' | 'outage'

export type MaintenanceService = {
  id: string
  label: string
  status: ComponentStatus
  note?: string
}

export type MaintenanceConfig = {
  enabled: boolean
  mode: MaintenanceMode
  /** `full` gates every non-exempt path; `sections` gates only `blockedPaths`. */
  scope: MaintenanceScope
  blockedPaths: string[]
  title: string
  message: string
  /** Compact strip shown in the app shell when mode = 'banner'. */
  banner: string
  reason: MaintenanceReason
  scheduledStart: string | null
  estimatedEnd: string | null
  /** When true, the gate lifts itself once `estimatedEnd` has passed. */
  autoResolve: boolean
  contactEmail: string
  affectedServices: MaintenanceService[]
  /** Operators/staff who still get through a blackout. */
  allowedEmails: string[]
  /** Allow sign-in + KYC callbacks to complete even during a blackout. */
  allowSignIn: boolean
  /** Bumped on every write so clients can tell "unchanged" from "identical". */
  version: number
  updatedAt: string | null
  updatedBy: string | null
}

export const MAINTENANCE_REASONS: Record<MaintenanceReason, string> = {
  scheduled_upgrade: 'Scheduled upgrade',
  payment_settlement: 'Payment settlement run',
  fraud_review: 'Fraud / QA review',
  security_patch: 'Security patching',
  outage: 'Unplanned outage',
  other: 'Maintenance',
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  enabled: false,
  mode: 'blackout',
  scope: 'full',
  blockedPaths: [],
  title: 'Under scheduled maintenance',
  message:
    "We're upgrading the AfterWorks platform to keep worker payments accurate and on time. Your balance, applications and verification status are untouched — nothing to do on your side.",
  banner: 'We are running a short maintenance window. Some actions may be temporarily unavailable.',
  reason: 'scheduled_upgrade',
  scheduledStart: null,
  estimatedEnd: null,
  autoResolve: true,
  contactEmail: '',
  affectedServices: [
    { id: 'jobs', label: 'Jobs & applications', status: 'operational' },
    { id: 'wallet', label: 'Wallet & payouts', status: 'operational' },
    { id: 'kyc', label: 'ID verification', status: 'operational' },
  ],
  allowedEmails: [],
  allowSignIn: true,
  version: 1,
  updatedAt: null,
  updatedBy: 'System',
}

// ─── Normalisation ───────────────────────────────────────────────────────────

const SERVICE_ID = /^[a-z0-9][a-z0-9-]{1,30}$/

function asIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export function normaliseMaintenanceConfig(raw: unknown): MaintenanceConfig {
  const input = (raw ?? {}) as Record<string, unknown>
  const base = DEFAULT_MAINTENANCE_CONFIG

  const mode: MaintenanceMode = input.mode === 'banner' ? 'banner' : 'blackout'
  const reason: MaintenanceReason =
    typeof input.reason === 'string' && input.reason in MAINTENANCE_REASONS
      ? (input.reason as MaintenanceReason)
      : base.reason

  const allowedEmails = Array.isArray(input.allowedEmails)
    ? input.allowedEmails.filter(isEmailLike).map((e) => e.trim().toLowerCase()).slice(0, 200)
    : base.allowedEmails

  const affectedServices: MaintenanceService[] = Array.isArray(input.affectedServices)
    ? input.affectedServices
        .map((entry): MaintenanceService | null => {
          const item = (entry ?? {}) as Record<string, unknown>
          const id = sanitizeLine(item.id, 32).toLowerCase()
          if (!SERVICE_ID.test(id)) return null
          const status = (['operational', 'degraded', 'maintenance', 'outage'] as const).includes(
            item.status as ComponentStatus,
          )
            ? (item.status as ComponentStatus)
            : 'operational'
          const service: MaintenanceService = {
            id,
            label: sanitizeLine(item.label, 60) || id,
            status,
          }
          if (item.note) service.note = sanitizeLine(item.note, 120)
          return service
        })
        .filter((v): v is MaintenanceService => v !== null)
        .slice(0, 12)
    : base.affectedServices

  const blockedPaths = Array.isArray(input.blockedPaths)
    ? Array.from(
        new Set(
          input.blockedPaths
            .map(normaliseBlockedPath)
            .filter((value): value is string => value !== null),
        ),
      ).slice(0, 20)
    : base.blockedPaths

  return {
    enabled: input.enabled === true,
    mode,
    scope: input.scope === 'sections' ? 'sections' : 'full',
    // A sections window with no paths selected would gate nothing — treat it as a full blackout
    // rather than silently doing nothing when the operator meant to block the site.
    blockedPaths,
    title: typeof input.title === 'string' && input.title.trim() ? sanitizeLine(input.title, 90) : base.title,
    message:
      typeof input.message === 'string' && input.message.trim()
        ? sanitizePlainText(input.message, 900)
        : base.message,
    banner: typeof input.banner === 'string' && input.banner.trim() ? sanitizeLine(input.banner, 200) : base.banner,
    reason,
    scheduledStart: asIso(input.scheduledStart),
    estimatedEnd: asIso(input.estimatedEnd),
    autoResolve: input.autoResolve !== false,
    contactEmail: isEmailLike(input.contactEmail) ? String(input.contactEmail).trim().toLowerCase() : '',
    affectedServices: affectedServices.length ? affectedServices : base.affectedServices,
    allowedEmails,
    allowSignIn: input.allowSignIn !== false,
    version: Number.isFinite(Number(input.version)) ? Math.max(1, Math.trunc(Number(input.version))) : base.version,
    updatedAt: asIso(input.updatedAt),
    updatedBy: typeof input.updatedBy === 'string' ? sanitizeLine(input.updatedBy, 80) : 'System',
  }
}

// ─── Resolution (the single decision function) ───────────────────────────────

export type MaintenanceStatus = {
  /** True when non-privileged traffic must be intercepted. */
  active: boolean
  /** True when the *whole* site is gated. False for a `sections` window, where only listed paths are. */
  blocksAll: boolean
  scope: MaintenanceScope
  /** Path prefixes gated while `scope` is `sections`. */
  blockedPaths: string[]
  /** True when enabled but only showing a banner (site stays usable). */
  bannerOnly: boolean
  /** Enabled with a future `scheduledStart`. */
  pending: boolean
  /** enabled=true but auto-resolve has passed the ETA → treated as over. */
  stale: boolean
  mode: MaintenanceMode
  config: MaintenanceConfig
  /** Seconds for the Retry-After header; 0 when unknown. */
  retryAfterSec: number
  /** ISO instants the decision was made from, so a UI can show the same clock the edge used. */
  startsAt: string | null
  endsAt: string | null
  /** Millis until estimatedEnd; null when no ETA. */
  remainingMs: number | null
}

/**
 * Emergency override: `MAINTENANCE_FORCE=blackout|banner` in the deployment environment.
 *
 * The normal source of truth is `system/maintenance` in Firestore — but when the datastore itself is
 * degraded, or a credentials problem means the console cannot save, the operator still needs one way
 * to stop traffic. A platform-level env var is that lever, it is honoured identically at the edge and
 * in Node, and it cannot be set from the application.
 */
export function forcedMaintenanceConfig(): MaintenanceConfig | null {
  const flag = (staticEnv('MAINTENANCE_FORCE') ?? '').trim().toLowerCase()
  if (!flag || flag === 'false' || flag === '0' || flag === 'off') return null

  const until = (staticEnv('MAINTENANCE_FORCE_UNTIL') ?? '').trim()
  const parsed = until ? new Date(until) : null
  const estimatedEnd = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null
  const message = (staticEnv('MAINTENANCE_FORCE_MESSAGE') ?? '').trim()
  // Optional: gate only listed areas (`MAINTENANCE_FORCE_PATHS=/api/wallet,/profile`). Without it the
  // override is a full-site blackout.
  const paths = (staticEnv('MAINTENANCE_FORCE_PATHS') ?? '')
    .split(/[\s,]+/)
    .map(normaliseBlockedPath)
    .filter((value): value is string => value !== null)

  return normaliseMaintenanceConfig({
    ...DEFAULT_MAINTENANCE_CONFIG,
    enabled: true,
    mode: flag === 'banner' ? 'banner' : 'blackout',
    scope: paths.length ? 'sections' : 'full',
    blockedPaths: paths,
    reason: 'outage',
    // Scoped wording matters: telling a worker the platform is unavailable while the job board is
    // serving normally is the kind of copy that makes people abandon an account.
    title: paths.length ? 'This part of the platform is under maintenance' : 'Temporarily unavailable',
    message:
      message ||
      (paths.length
        ? 'These areas are paused while we work on them. Everything else on AfterWorks keeps working as usual — browse jobs, apply and check your balance freely.'
        : 'We have interrupted access while we stabilise the platform. Your applications, earnings and verification records are untouched — please try again shortly.'),
    estimatedEnd,
    // Only auto-resolve when the operator gave an end time; otherwise an env override that cannot
    // expire silently turns into "blocked forever" the moment the ETA passes.
    autoResolve: Boolean(estimatedEnd),
    allowSignIn: false,
    updatedBy: 'MAINTENANCE_FORCE',
  })
}

export function isMaintenanceForced(): boolean {
  return forcedMaintenanceConfig() !== null
}

export function resolveMaintenance(configInput: MaintenanceConfig, now: number = Date.now()): MaintenanceStatus {
  const parsed = normaliseMaintenanceConfig(forcedMaintenanceConfig() ?? configInput)
  // A `sections` window that names nothing would gate nothing. If the operator enabled maintenance and
  // selected no areas, they meant the whole site — so escalate rather than no-op.
  const scope: MaintenanceScope = parsed.scope === 'sections' && parsed.blockedPaths.length === 0 ? 'full' : parsed.scope
  const config: MaintenanceConfig = { ...parsed, scope }
  const start = config.scheduledStart ? new Date(config.scheduledStart).getTime() : null
  const end = config.estimatedEnd ? new Date(config.estimatedEnd).getTime() : null

  const pending = config.enabled && start !== null && start > now
  const expired = config.enabled && config.autoResolve && end !== null && end <= now && !pending
  const blocking = config.enabled && config.mode === 'blackout'
  const active = config.enabled && !pending && !expired
  const blocksAll = scope === 'full'

  const remainingMs = end !== null ? Math.max(0, end - now) : null
  // Retry-After is a hint for crawlers and queues; an ETA years away must not make them disappear
  // for years, so it is clamped to a day.
  const retryAfterSec =
    remainingMs === null || !Number.isFinite(remainingMs)
      ? 0
      : Math.min(MAX_RETRY_AFTER_SEC, Math.max(30, Math.ceil(remainingMs / 1000)))

  return {
    active: active && blocking,
    bannerOnly: active && config.mode === 'banner',
    // True when the whole site must be intercepted, as opposed to only the selected areas.
    blocksAll: active && blocking && blocksAll,
    scope,
    blockedPaths: config.blockedPaths,
    pending,
    stale: expired,
    mode: config.mode,
    config: expired ? { ...config, enabled: false } : pending ? { ...config, enabled: false } : config,
    retryAfterSec,
    remainingMs,
    startsAt: config.scheduledStart,
    endsAt: config.estimatedEnd,
  }
}

/**
 * Should this pathname be intercepted for the given window?
 *
 * `full` gates everything the caller has not exempted; `sections` gates only the listed prefixes
 * (matched on segment boundaries, so `/wallet` does not catch `/wallet-history`), and reserved paths
 * — the console, the status page, anything that lifts the gate — can never be gated even if someone
 * types them into the list.
 */
/** Longest Retry-After we advertise (one day). */
export const MAX_RETRY_AFTER_SEC = 86_400

export function isGatedPath(pathname: string, status: MaintenanceStatus): boolean {
  if (!status.active) return false
  const clean = pathname.startsWith('/') ? pathname : `/${pathname}`
  if (isUngatablePath(clean)) return false
  if (status.blocksAll) return true
  return matchesBlockedPath(clean, status.blockedPaths)
}

/** Segment-aware prefix match, shared by the edge gate and the client so they cannot disagree. */
export function matchesBlockedPath(pathname: string, prefixes: readonly string[]): boolean {
  const clean = pathname.startsWith('/') ? pathname : `/${pathname}`
  return prefixes.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`))
}

export function isEmailWhitelisted(email: unknown, config: MaintenanceConfig): boolean {
  const clean = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!clean) return false
  return config.allowedEmails.includes(clean)
}

// ─── View model shared by the browser and the server components ───────────────

export type MaintenanceView = {
  enabled: boolean
  blocking: boolean
  bannerOnly: boolean
  /** False when only selected areas are down: the app keeps working and shows a scoped notice. */
  blocksAll: boolean
  scope: MaintenanceScope
  /** Areas paused right now (path prefixes), for targeted in-app notices. */
  blockedPaths: string[]
  mode: MaintenanceMode
  title: string
  message: string
  banner: string
  estimatedEnd: string | null
  remainingMs: number | null
  contactEmail: string
  services: MaintenanceService[]
  version: number
  /** True when the feed could not be read; the UI then says so instead of pretending all is well. */
  unknown: boolean
  raw: MaintenanceConfig
}

export const INERT_MAINTENANCE_VIEW: MaintenanceView = {
  enabled: false,
  blocking: false,
  bannerOnly: false,
  blocksAll: false,
  scope: 'full',
  blockedPaths: [],
  mode: 'blackout',
  title: '',
  message: '',
  banner: '',
  estimatedEnd: null,
  remainingMs: null,
  contactEmail: '',
  services: DEFAULT_MAINTENANCE_CONFIG.affectedServices,
  version: 0,
  unknown: true,
  raw: DEFAULT_MAINTENANCE_CONFIG,
}

export function toMaintenanceView(status: MaintenanceStatus): MaintenanceView {
  const config = status.config
  return {
    enabled: config.enabled,
    blocking: status.active,
    bannerOnly: status.bannerOnly,
    blocksAll: status.blocksAll,
    scope: status.scope,
    blockedPaths: status.blockedPaths,
    mode: config.mode,
    title: config.title,
    message: config.message,
    banner: config.banner,
    estimatedEnd: config.estimatedEnd,
    remainingMs: status.remainingMs,
    contactEmail: config.contactEmail,
    services: config.affectedServices,
    version: config.version,
    unknown: false,
    raw: config,
  }
}

// ─── Server-side limits (env-tunable) ────────────────────────────────────────

export const MAINTENANCE_EDGE_CACHE_MS = (): number => {
  const raw = Number(staticEnv('MAINTENANCE_CACHE_MS') ?? '')
  return Number.isFinite(raw) && raw > 0 ? Math.max(5_000, Math.trunc(raw)) : 15_000
}
export const MAINTENANCE_EDGE_ENABLED = (): boolean => (staticEnv('MAINTENANCE_EDGE_GATE') ?? 'true') !== 'false'

// ─── Firestore REST read (works on Edge *and* Node — no firebase-admin needed) ─

export type MaintenanceSnapshot = {
  config: MaintenanceConfig
  /** 'doc' = read live config, 'default' = no doc yet, 'unavailable' = read failed. */
  source: 'doc' | 'default' | 'unavailable'
  fetchedAt: number
}

type FirestoreRestValue =
  | { stringValue?: string; booleanValue?: boolean; integerValue?: string; doubleValue?: number; nullValue?: null }
  | { arrayValue?: { values?: Array<Record<string, unknown>> } }
  | { mapValue?: { fields?: Record<string, FirestoreRestValue> } }

function decodeValue(field: FirestoreRestValue | undefined): unknown {
  if (!field) return undefined
  if ('stringValue' in field) return field.stringValue
  if ('booleanValue' in field) return field.booleanValue
  if ('integerValue' in field) return Number(field.integerValue)
  if ('doubleValue' in field) return field.doubleValue
  if ('nullValue' in field) return null
  if ('arrayValue' in field) {
    return (field.arrayValue?.values ?? []).map((v) => decodeValue(v as FirestoreRestValue))
  }
  if ('mapValue' in field) {
    const fields = field.mapValue?.fields ?? {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      const decoded = decodeValue(v as FirestoreRestValue)
      if (decoded !== undefined) out[k] = decoded
    }
    return out
  }
  return undefined
}

export function decodeFirestoreDoc(doc: { fields?: Record<string, FirestoreRestValue> } | null): Record<string, unknown> {
  const fields = doc?.fields ?? {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    const decoded = decodeValue(value)
    if (decoded !== undefined) out[key] = decoded
  }
  return out
}

/**
 * Reads `system/maintenance` with the public Firestore REST endpoint.
 *
 * This is intentionally *not* an Admin-SDK read: the middleware runs on the Edge bundle where
 * firebase-admin cannot load, and this document is (and stays) public — the same bytes are
 * already readable by any browser running the client gate. Nothing sensitive is exposed, and it
 * lets us reject traffic at the edge instead of after React has rendered.
 */
export async function fetchMaintenanceSnapshot(opts?: {
  projectId?: string
  apiKey?: string
  signalTimeoutMs?: number
}): Promise<MaintenanceSnapshot> {
  const projectId = opts?.projectId || staticEnv('FIREBASE_PROJECT_ID') || staticEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID') || ''
  const apiKey = opts?.apiKey || staticEnv('FIREBASE_WEB_API_KEY') || staticEnv('NEXT_PUBLIC_FIREBASE_API_KEY') || ''

  if (!projectId) {
    return { config: DEFAULT_MAINTENANCE_CONFIG, source: 'unavailable', fetchedAt: Date.now() }
  }

  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/(default)/documents/system/maintenance` +
    (apiKey ? `?key=${encodeURIComponent(apiKey)}` : '')

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(opts?.signalTimeoutMs ?? 1500),
    })
    // 404 simply means the flag has never been saved → platform is open.
    if (!res.ok) {
      return { config: DEFAULT_MAINTENANCE_CONFIG, source: res.status === 404 ? 'default' : 'unavailable', fetchedAt: Date.now() }
    }
    const json = (await res.json()) as { fields?: Record<string, FirestoreRestValue> }
    return { config: normaliseMaintenanceConfig(decodeFirestoreDoc(json)), source: 'doc', fetchedAt: Date.now() }
  } catch {
    return { config: DEFAULT_MAINTENANCE_CONFIG, source: 'unavailable', fetchedAt: Date.now() }
  }
}

type EdgeCache = { snapshot: MaintenanceSnapshot; status: MaintenanceStatus; expiresAt: number }
const globalCache = globalThis as unknown as { __awMaintenanceCache?: EdgeCache }

/**
 * Cached maintenance view for request-path code (middleware).
 * `staleIfUnavailable` keeps the last known state on transient Firestore errors instead of
 * flapping the whole platform open mid-window.
 */
export async function getCachedMaintenanceStatus(opts?: {
  projectId?: string
  apiKey?: string
  force?: boolean
}): Promise<{ status: MaintenanceStatus; usable: boolean }> {
  const now = Date.now()
  const cached = globalCache.__awMaintenanceCache
  const ttl = MAINTENANCE_EDGE_CACHE_MS()

  if (!opts?.force && cached && cached.expiresAt > now) {
    return { status: cached.status, usable: cached.snapshot.source !== 'unavailable' }
  }

  const snapshot = await fetchMaintenanceSnapshot(opts)
  if (snapshot.source === 'unavailable' && cached) {
    return { status: cached.status, usable: false }
  }

  const status = resolveMaintenance(snapshot.config, now)
  globalCache.__awMaintenanceCache = { snapshot, status, expiresAt: now + ttl }
  return { status, usable: snapshot.source !== 'unavailable' }
}

export function primeMaintenanceCache(config: MaintenanceConfig): void {
  const snapshot: MaintenanceSnapshot = { config, source: 'doc', fetchedAt: Date.now() }
  globalCache.__awMaintenanceCache = {
    snapshot,
    status: resolveMaintenance(config, Date.now()),
    expiresAt: Date.now() + MAINTENANCE_EDGE_CACHE_MS(),
  }
}

export function invalidateMaintenanceCache(): void {
  delete globalCache.__awMaintenanceCache
}
