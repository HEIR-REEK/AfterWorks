import { getCachedMaintenanceStatus } from '@/lib/maintenance-shared'
import { PUBLIC_SHORT_CACHE, env, envBool, envInt, isProduction } from '@/lib/security-core'
import { json } from '@/lib/guards'

/**
 * GET /api/health — an honest status feed, not a 200-on-a-string.
 *
 * A status page that always says "All systems operational" is worse than none: it teaches people
 * not to trust it. Each check here reflects something the app actually depends on and degrades
 * visibly when it is not.
 *
 * This feed is public, so it describes *services* in the words a member reads, never the
 * configuration behind them: no vendor names, no environment-variable names, no runtime or memory
 * figures, and no mention of the operations console (which is not advertised anywhere a member can
 * see). The status of each check is still the truth — "Sign-in is unavailable" is more useful to a
 * worker than a config dump, and the operator-facing version of the same question (which variable is
 * missing, whether a secret is loaded) lives in the console's posture report, `securityChecks()` in
 * `lib/security.ts`, behind the admin gate.
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
    value = {
      id: 'datastore',
      label: 'Data & balances',
      status: 'degraded',
      detail: 'We cannot reach your saved data from this site right now.',
    }
  } else {
    const started = Date.now()
    try {
      const res = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/system/maintenance${apiKey ? `?key=${apiKey}` : ''}`,
        { cache: 'no-store', signal: AbortSignal.timeout(2500) },
      )
      const reachable = res.ok || res.status === 404
      value = {
        id: 'datastore',
        label: 'Data & balances',
        status: reachable ? 'operational' : 'degraded',
        detail: reachable
          ? 'Applications, balances and profiles are being saved and read normally.'
          : 'Saved data is responding slowly — some screens may take longer than usual.',
        latencyMs: Date.now() - started,
      }
    } catch {
      value = {
        id: 'datastore',
        label: 'Data & balances',
        status: 'outage',
        detail: 'We cannot reach your saved data. Nothing you have earned is lost — please try again shortly.',
        latencyMs: Date.now() - started,
      }
    }
  }

  dataProbe = { at: now, value }
  return value
}

async function privilegedWritesCheck(): Promise<Pick<Check, 'label' | 'status' | 'detail'>> {
  const label = 'Payouts & account changes'
  try {
    const { isFirebaseAdminUsable } = await import('@/lib/firestore-admin')
    return isFirebaseAdminUsable()
      ? {
          label,
          status: 'operational',
          detail: 'Payout requests and account changes are being processed.',
        }
      : {
          label,
          status: 'degraded',
          detail: 'Payouts are paused while we fix a problem. Money you have already earned is unaffected.',
        }
  } catch {
    return { label, status: 'degraded', detail: 'Payouts are paused while we fix a problem. Money you have already earned is unaffected.' }
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
  // Which values are missing is an operator question (the console's posture report answers it);
  // the public feed only reports whether sign-in can work at all.
  const firebaseClientReady = Object.values(firebaseClientConfig).every(Boolean)

  const checks: Check[] = [
    datastore,
    {
      id: 'auth',
      label: 'Sign-in',
      status: firebaseClientReady ? 'operational' : 'degraded',
      detail: firebaseClientReady
        ? 'Sign-in and account access are working normally.'
        : 'Sign-in is unavailable right now. Your account and balance are untouched.',
    },
    {
      id: 'privileged-writes',
      ...(await privilegedWritesCheck()),
    },
    {
      id: 'payments',
      label: 'Training payments',
      status: env('PAYSTACK_SECRET_KEY') ? 'operational' : 'degraded',
      detail: env('PAYSTACK_SECRET_KEY')
        ? 'Training checkout is accepting payments.'
        : 'Training checkout is temporarily unavailable — if you saw an error, you have not been charged.',
    },
    {
      id: 'identity',
      label: 'ID verification',
      status: env('DIDIT_API_KEY') && env('DIDIT_WORKFLOW_ID') ? (env('DIDIT_WEBHOOK_SECRET') ? 'operational' : 'degraded') : 'degraded',
      detail:
        env('DIDIT_API_KEY') && env('DIDIT_WORKFLOW_ID') && env('DIDIT_WEBHOOK_SECRET')
          ? 'Identity verification is available.'
          : 'Identity verification is limited right now. You can complete it later — your account stays open.',
    },
    {
      id: 'email',
      label: 'Verification email',
      status: env('RESEND_API_KEY').startsWith('re_') ? (env('EMAIL_FROM') || !production ? 'operational' : 'degraded') : 'degraded',
      detail:
        env('RESEND_API_KEY').startsWith('re_') && (env('EMAIL_FROM') || !production)
          ? 'Verification and receipt emails are being delivered.'
          : 'Verification emails may be delayed. You can resend one from the verification screen.',
    },
  ]

  if (maintenanceReadable === false && datastore.status === 'operational') {
    checks.push({
      id: 'maintenance-feed',
      label: 'Maintenance schedule',
      status: 'degraded',
      detail: 'Showing the last confirmed maintenance schedule.',
    })
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

  // No runtime fingerprint here: the node version, the region and the heap size are operator
  // detail, and this endpoint is public.
  const payload = {
    ok: overall === 'operational',
    status: overall,
    version: env('APP_VERSION') || '0.1.0',
    environment: production ? 'production' : env('NODE_ENV') || 'development',
    now: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
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
  }

  const res = json(payload, { status: overall === 'outage' ? 503 : 200 })
  for (const [key, value] of Object.entries(PUBLIC_SHORT_CACHE)) res.headers.set(key, value)
  res.headers.set('Cache-Control', 'public, max-age=5, s-maxage=10')
  res.headers.set('X-Platform-Status', overall)
  if (maintenance.active) res.headers.set('Retry-After', String(maintenance.retryAfterSec || 300))
  return res
}
