import { NextRequest } from 'next/server'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { consumeBucket, fail, json, routeError } from '@/lib/guards'

/**
 * /api/admin/cron/wallet-sweep — settlement sweep for workers who are not online when their
 * clearing window closes. Pending earnings move to the available balance lazily on each worker's
 * next wallet read; this route covers everyone else, on a schedule.
 *
 * Auth is the shared `CRON_SECRET`, constant-time, fail-closed. Two transport forms are accepted
 * because schedulers differ:
 *   • POST with the secret in the `x-cron-secret` header (GitHub Actions, cron-job.org, curl…)
 *   • GET with the secret in the `?secret=` query (Render's cron jobs only send GET and cannot
 *     set custom headers; the value appears in server logs, which is why it stays a dedicated
 *     endpoint rate-limited to 12 sweeps/hour regardless of the secret).
 *
 * The sweep only ever *moves* money that has already been credited and is past its clearing
 * window — it cannot create or increase a balance.
 *
 * Suggested schedule: every 15 minutes (see render.yaml → crons).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function secretMatches(provided: string | null | undefined): boolean {
  const expected = (process.env.CRON_SECRET ?? '').trim()
  if (!expected || !provided) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    // Burn a comparison anyway so timing does not leak the length difference.
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}

async function sweep(req: NextRequest, providedSecret: string | null | undefined): Promise<Response> {
  if (!(process.env.CRON_SECRET ?? '').trim()) {
    // Fail closed: a deployment without the secret cannot be swept at all.
    return fail(503, 'CRON_SECRET is not configured on this deployment.', { code: 'cron_not_configured' })
  }
  if (!secretMatches(providedSecret)) {
    return fail(401, 'Unauthorized.', { code: 'cron_unauthorized' })
  }

  // Even with the secret, keep the endpoint from being an unbounded write loop if it ever leaks:
  // one global bucket, 12 sweeps per hour maximum, from any caller.
  const bucket = consumeBucket('cron-wallet-sweep', 12, 3_600_000, 'global')
  if (!bucket.ok) {
    return fail(429, 'Sweep budget exhausted for this hour.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })
  }

  try {
    const { settleOverdueEarnings } = await import('@/lib/firestore-admin')
    const result = await settleOverdueEarnings(200)
    return json({ ok: true, settledUsd: result.settledUsd, members: result.members, at: new Date().toISOString() })
  } catch (err) {
    console.error('[cron:wallet-sweep] nonce=%s error:', randomBytes(4).toString('hex'), err instanceof Error ? err.message : err)
    return routeError('cron:wallet-sweep', err)
  }
}

export async function POST(req: NextRequest) {
  return sweep(req, req.headers.get('x-cron-secret'))
}

/** Render's cron jobs send GET only; the secret therefore travels in the query string. */
export async function GET(req: NextRequest) {
  return sweep(req, req.nextUrl.searchParams.get('secret'))
}
