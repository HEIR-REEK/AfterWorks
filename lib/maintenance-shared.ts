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
function staticEnv(name: 'FIREBASE_PROJECT_ID' | 'NEXT_PUBLIC_FIREBASE_PROJECT_ID' | 'FIREBASE_WEB_API_KEY' | 'NEXT_PUBLIC_FIREBASE_API_KEY' | 'MAINTENANCE_CACHE_MS' | 'MAINTENANCE_EDGE_GATE'): string | undefined {
  return typeof process !== 'undefined' && process.env ? process.env[name] : undefined
}

export type MaintenanceMode = 'blackout' | 'banner'
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
          return {
            id,
            label: sanitizeLine(item.label, 60) || id,
            status,
            note: item.note ? sanitizeLine(item.note, 120) : undefined,
          }
        })
        .filter((v): v is MaintenanceService => v !== null)
        .slice(0, 12)
    : base.affectedServices

  return {
    enabled: input.enabled === true,
    mode,
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
  /** Millis until estimatedEnd; null when no ETA. */
  remainingMs: number | null
}

export function resolveMaintenance(configInput: MaintenanceConfig, now: number = Date.now()): MaintenanceStatus {
  const config = normaliseMaintenanceConfig(configInput)
  const start = config.scheduledStart ? new Date(config.scheduledStart).getTime() : null
  const end = config.estimatedEnd ? new Date(config.estimatedEnd).getTime() : null

  const pending = config.enabled && start !== null && start > now
  const expired = config.enabled && config.autoResolve && end !== null && end <= now && !pending
  const blocking = config.enabled && config.mode === 'blackout'
  const active = config.enabled && !pending && !expired

  const remainingMs = end !== null ? Math.max(0, end - now) : null
  const retryAfterSec = remainingMs === null ? 0 : Math.max(30, Math.ceil(remainingMs / 1000))

  return {
    active: active && blocking,
    bannerOnly: active && config.mode === 'banner',
    pending,
    stale: expired,
    mode: config.mode,
    config: expired ? { ...config, enabled: false } : pending ? { ...config, enabled: false } : config,
    retryAfterSec,
    remainingMs,
  }
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
