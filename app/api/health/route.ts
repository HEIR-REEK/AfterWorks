import { getCachedMaintenanceStatus } from '@/lib/maintenance-shared'
import { PUBLIC_SHORT_CACHE, env, envBool, envInt, isProduction } from '@/lib/security-core'
import { json } from '@/lib/guards'

/**
 * GET /api/health — an honest status feed, not a 200-on-a-string.
 *
 * A status page that always says "All systems operational" is worse than none: it teaches people
 * not to trust it. Each check here reflects something the app actually depends on (a configured
 * credential, a reachable datastore, a live maintenance flag) and degrades visibly when it is not.
 */

export const dynamic = 'force-dynamic'

const STARTED_AT = Date.now()

type Check = { id: string; label: string; status: 'operational' | 'degraded' | 'maintenance' | 'outage'; detail: string; latencyMs?: number }

let dataProbe: { at: number; value: Check } | null = null

async function probeFirestoreRead(): Promise<Check> {
  const now = Date.now()
  if (dataProbe && now - dataProbe.at < Math.max(5_000, envInt('HEALTH_PROBE_CACHE_MS', 20_000))) return dataProbe.value

  const projectId = env('FIREBASE_PROJECT_ID') || env('NEXT_PUBLIC_FIREBASE_PROJECT_ID')
  const apiKey =
    env('FIREBASE_WEB_API_KEY') ||
    env('FIREBASE_API_KEY') ||
    env('NEXT_PUBLIC_FIREBASE_API_KEY') ||
    env('NEXT_PUBLIC_FIREBASE_WEB_API_KEY')
  let value: Check

  if (!projectId) {
    value = { id: 'datastore', label: 'Datastore', status: 'degraded', detail: 'No Firebase project configured for this deployment.' }
  } else {
    const started = Date.now()
    try {
      const res = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/system/maintenance${apiKey ? `?key=${apiKey}` : ''}`,
        { cache: 'no-store', signal: AbortSignal.timeout(2500) },
      )
      value = {
        id: 'datastore',
        label: 'Datastore',
        status: res.ok || res.status === 404 ? 'operational' : 'degraded',
        detail: res.ok || res.status === 404 ? 'Firestore REST reads are answering.' : `Firestore responded ${res.status}.`,
        latencyMs: Date.now() - started,
      }
    } catch (err) {
      value = {
        id: 'datastore',
        label: 'Datastore',
        status: 'outage',
        detail: `Datastore unreachable (${err instanceof Error ? err.name : 'error'}).`,
        latencyMs: Date.now() - started,
      }
    }
  }

  dataProbe = { at: now, value }
  return value
}

async function privilegedWritesCheck(): Promise<Pick<Check, 'label' | 'status' | 'detail'>> {
  const label = 'Privileged writes'
  try {
    const { isFirebaseAdminUsable } = await import('@/lib/firestore-admin')
    return isFirebaseAdminUsable()
      ? {
          label,
          status: 'operational',
          detail: 'Admin SDK handles moderation, payouts, audit and maintenance persistence.',
        }
      : {
          label,
          status: 'degraded',
          detail: 'FIREBASE_SERVICE_ACCOUNT_JSON is not loaded, so moderation and payout writes are disabled.',
        }
  } catch {
    return { label, status: 'degraded', detail: 'Admin SDK could not be initialised in this runtime.' }
  }
}

export async function GET() {
  const { status: maintenance, usable: maintenanceReadable } = await getCachedMaintenanceStatus()
  const datastore = await probeFirestoreRead()
  const production = isProduction()
  const firebaseClientConfig = {
    apiKey:
      env('FIREBASE_WEB_API_KEY') ||
      env('FIREBASE_API_KEY') ||
      env('NEXT_PUBLIC_FIREBASE_API_KEY') ||
      env('NEXT_PUBLIC_FIREBASE_WEB_API_KEY'),
    authDomain: env('FIREBASE_AUTH_DOMAIN') || env('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    projectId: env('FIREBASE_PROJECT_ID') || env('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
    appId: env('FIREBASE_APP_ID') || env('NEXT_PUBLIC_FIREBASE_APP_ID'),
  }
  const missingFirebaseConfig = Object.entries(firebaseClientConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  const firebaseClientReady = missingFirebaseConfig.length === 0

  const checks: Check[] = [
    datastore,
    {
      id: 'auth',
      label: 'Authentication',
      status: firebaseClientReady ? 'operational' : 'degraded',
      detail: firebaseClientReady
        ? 'Firebase Auth client configuration is complete; ID tokens are verified server-side for privileged calls.'
        : `Firebase Auth configuration is incomplete (missing ${missingFirebaseConfig.join(', ')}), so sign-in cannot work.`,
    },
    {
      id: 'privileged-writes',
      ...(await privilegedWritesCheck()),
    },
    {
      id: 'payments',
      label: 'Payments',
      status: env('PAYSTACK_SECRET_KEY') ? 'operational' : 'degraded',
      detail: env('PAYSTACK_SECRET_KEY')
        ? `Paystack ${env('PAYSTACK_SECRET_KEY').startsWith('sk_live') ? 'live' : 'test'} key configured; webhook signatures are always required and amounts are re-checked against the API.`
        : 'PAYSTACK_SECRET_KEY is missing — training checkout cannot run.',
    },
    {
      id: 'identity',
      label: 'ID verification',
      status: env('DIDIT_API_KEY') && env('DIDIT_WORKFLOW_ID') ? (env('DIDIT_WEBHOOK_SECRET') ? 'operational' : 'degraded') : 'degraded',
      detail: !env('DIDIT_API_KEY')
        ? 'DIDIT_API_KEY is not set, so KYC sessions run in demo mode.'
        : !env('DIDIT_WORKFLOW_ID')
          ? 'Key present but DIDIT_WORKFLOW_ID is unset — no verification flow can start.'
          : env('DIDIT_WEBHOOK_SECRET')
            ? 'Didit sessions + signed webhooks configured.'
            : 'Sessions work but DIDIT_WEBHOOK_SECRET is unset — results cannot be trusted in production.',
    },
    {
      id: 'email',
      label: 'Transactional email',
      status: env('RESEND_API_KEY').startsWith('re_') ? (env('EMAIL_FROM') || !production ? 'operational' : 'degraded') : 'degraded',
      detail: env('RESEND_API_KEY').startsWith('re_')
        ? env('EMAIL_FROM')
          ? 'Resend delivers signup verification mail; the link is what marks Firebase Auth verified.'
          : 'Resend key is set. EMAIL_FROM is empty — using the development sender, which will not reach real inboxes in production.'
        : 'RESEND_API_KEY is not set — new accounts cannot verify their email.',
    },
    {
      id: 'console',
      label: 'Admin console',
      status: (env('ADMIN_SESSION_SECRET') ?? '').length >= 32 ? 'operational' : production ? 'outage' : 'degraded',
      detail:
        (env('ADMIN_SESSION_SECRET') ?? '').length >= 32
          ? 'Console enabled with signed, revocable sessions.'
          : 'ADMIN_SESSION_SECRET missing — the console fails closed.',
    },
  ]

  if (maintenanceReadable === false && datastore.status === 'operational') {
    checks.push({ id: 'maintenance-feed', label: 'Maintenance feed', status: 'degraded', detail: 'Using the last known maintenance state.' })
  }
  if (maintenance.active) {
    checks.push({
      id: 'maintenance',
      label: 'Maintenance window',
      status: 'maintenance',
      detail: maintenance.config.title,
    })
  }

  const overall = checks.some((c) => c.status === 'outage')
    ? 'outage'
    : maintenance.active
      ? 'maintenance'
      : checks.some((c) => c.status === 'degraded' || c.status === 'maintenance')
        ? 'degraded'
        : 'operational'

  const heap = process.memoryUsage()
  const payload = {
    ok: overall === 'operational',
    status: overall,
    service: 'afterworks-web',
    version: env('APP_VERSION') || '0.1.0',
    environment: production ? 'production' : env('NODE_ENV') || 'development',
    region: env('AWS_REGION') || env('REGION') || 'edge',
    now: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    node: process.version,
    checks,
    maintenance: {
      enabled: maintenance.config.enabled,
      blocking: maintenance.active,
      bannerOnly: maintenance.bannerOnly,
      mode: maintenance.config.mode,
      blocksAll: maintenance.blocksAll,
      scope: maintenance.scope,
      blockedPaths: maintenance.blockedPaths,
      title: maintenance.config.title,
      message: maintenance.config.message,
      estimatedEnd: maintenance.config.estimatedEnd,
      remainingMs: maintenance.remainingMs,
      affectedServices: maintenance.config.affectedServices,
    },
    load: {
      heapUsedMb: Math.round((heap.heapUsed / 1024 / 1024) * 10) / 10,
      rssMb: Math.round((heap.rss / 1024 / 1024) * 10) / 10,
    },
  }

  const res = json(payload, { status: overall === 'outage' ? 503 : 200 })
  for (const [key, value] of Object.entries(PUBLIC_SHORT_CACHE)) res.headers.set(key, value)
  res.headers.set('Cache-Control', 'public, max-age=5, s-maxage=10')
  res.headers.set('X-Platform-Status', overall)
  if (maintenance.active) res.headers.set('Retry-After', String(maintenance.retryAfterSec || 300))
  return res
}
