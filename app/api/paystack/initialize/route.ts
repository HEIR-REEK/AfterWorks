import { NextRequest } from 'next/server'
import { consumeBucket, audit, fail, json, maintenanceBlockForApi, requireVerifiedUser, routeError } from '@/lib/guards'
import { env, envInt, isHostAllowed, readJsonBody, sanitizeLine } from '@/lib/security-core'
import { paystackSubunitsFor, trainingFeeKesFor, trainingFeeUsdFor } from '@/lib/afterworks-data'
import { randomId } from '@/lib/session-token'

export const dynamic = 'force-dynamic'

/**
 * Hosts a browser can never reach: the app's *bind* address and loopback. Paystack redirects the
 * payer's browser to the callback URL, so handing it `https://0.0.0.0:10000/…` (what `Host` looks
 * like behind a port-forwarding preview tunnel) sends the worker to a page that says "site not
 * reachable" the moment the payment succeeds.
 */
const BIND_OR_LOOPBACK_HOST = /^(localhost|127(\.\d+){1,3}|\[::1\]|0\.0\.0\.0)(:\d+)?$/i

/**
 * The public origin Paystack should send the payer back to after the charge settles.
 *
 * Resolution order: the deployment's configured public URL, then trusted forwarded host/proto
 * headers, then the request Host — skipping any candidate that is a bind/loopback address. When
 * nothing usable exists (a bare preview tunnel with no APP_URL), `popupMode` is returned instead:
 * the checkout then opens Paystack in a new tab while the training page stays open and confirms
 * the charge itself, so a successful payment never ends in an unreachable redirect.
 */
function browserReachableOrigin(req: NextRequest): { origin: string; popupMode: boolean } {
  const configured = env('NEXT_PUBLIC_APP_URL') || env('APP_URL') || env('RENDER_EXTERNAL_URL') || env('VERCEL_URL')
  if (configured) {
    try {
      const url = new URL(configured.startsWith('http') ? configured : `https://${configured}`)
      if (url.hostname && !BIND_OR_LOOPBACK_HOST.test(url.host)) return { origin: url.origin.replace(/\/+$/, ''), popupMode: false }
    } catch {
      /* malformed config — fall through to the request headers */
    }
  }

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const forwardedHost = req.headers.get('x-forwarded-host')?.trim().replace(/\/+$/, '')
  const hostHeader = req.headers.get('host')?.trim().replace(/\/+$/, '')
  for (const host of [forwardedHost, hostHeader]) {
    if (!host || BIND_OR_LOOPBACK_HOST.test(host)) continue
    if (!isHostAllowed(host)) continue
    const scheme = forwardedProto === 'http' ? 'http' : 'https'
    return { origin: `${scheme}://${host}`, popupMode: false }
  }

  // Last resort: Next's own reconstruction of the origin. Still refuse bind/loopback addresses.
  try {
    const url = new URL(req.nextUrl.origin)
    if (url.hostname && !BIND_OR_LOOPBACK_HOST.test(url.host)) return { origin: url.origin.replace(/\/+$/, ''), popupMode: false }
  } catch {
    /* no usable origin */
  }
  return { origin: '', popupMode: true }
}

/**
 * POST /api/paystack/initialize — start a training payment.
 *
 * The previous version took `amount`, `email` and `metadata` from the request body and passed them
 * straight to Paystack. Anyone could therefore buy a KES 13,000 training for KES 10, or start a
 * charge against somebody else's address. The route was also unused by the UI, which instead asked
 * `react-paystack` to build the transaction in the browser — the same problem, one layer earlier.
 *
 * Now: the amount is derived from server config, the payer email is the authenticated user's, the
 * reference is minted here so it can be reconciled, and the pending row is written from the server.
 */

export async function POST(req: NextRequest) {
  const maintenance = await maintenanceBlockForApi(req)
  if (maintenance) return maintenance

  const guard = await requireVerifiedUser(req)
  if (!guard.ok) return guard.response
  const { uid, email } = guard.value

  if (!email) return fail(400, 'Add an email address to your profile before paying.', { code: 'email_required' })

  const bucket = consumeBucket('paystack-init', envInt('PAYSTACK_INIT_RATE_PER_MINUTE', 6), 60_000, uid)
  if (!bucket.ok) {
    return fail(429, 'Too many checkout requests. Please wait a moment.', { code: 'rate_limited', headers: { 'Retry-After': String(bucket.retryAfterSec) } })
  }

  const secretKey = env('PAYSTACK_SECRET_KEY')
  if (!secretKey) {
    return fail(503, 'Card and mobile-money checkout is not configured on this deployment.', { code: 'paystack_unconfigured' })
  }

  const parsed = await readJsonBody<Record<string, unknown>>(req, 8_000)
  if (!parsed.ok) return fail(400, parsed.error, { code: 'bad_request' })
  const jobId = sanitizeLine(parsed.data.jobId, 80)
  if (!jobId) return fail(400, 'Which job card is this for?', { code: 'missing_job_id' })

  try {
    // Refuse job ids that look like traversal / injection, and confirm the job actually gates on training.
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(jobId)) return fail(400, 'Unknown job reference.', { code: 'bad_job_id' })
    const gate = await jobTrainingGate(jobId)
    if (gate.missing) return fail(404, 'That job card is not on the board any more.', { code: 'job_not_found' })
    if (gate.requiresTraining === false) {
      return fail(409, 'This job card does not require paid training — no charge is needed.', { code: 'training_not_required' })
    }

    const amountKes = trainingFeeKesFor(gate.feeUsd)
    const subunits = paystackSubunitsFor(gate.feeUsd)

    const reference = `aw_tr_${randomId(10)}`
    const { origin: callbackOrigin, popupMode } = browserReachableOrigin(req)
    const callbackUrl = popupMode ? '' : `${callbackOrigin}/training/${encodeURIComponent(jobId)}`

    const upstream = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: subunits,
        currency: 'KES',
        reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        metadata: { uid, jobId, purpose: 'training_access', expectedAmountKes: amountKes },
      }),
      cache: 'no-store',
    })

    const data = (await upstream.json().catch(() => null)) as
      | { status?: boolean; message?: string; data?: { authorization_url?: string; access_code?: string; reference?: string } }
      | null

    if (!upstream.ok || !data?.status || !data.data?.authorization_url) {
      await audit({ action: 'PAYMENT_INIT_FAILED', actorEmail: email, details: { jobId, status: upstream.status, message: data?.message?.slice(0, 160) }, req })
      return fail(502, 'The payment provider refused to open a checkout session. Please try again.', { code: 'paystack_init_failed' })
    }

    const { recordPaymentTransactionAdmin } = await import('@/lib/firestore-admin')
    await recordPaymentTransactionAdmin({
      reference: data.data.reference || reference,
      email,
      userId: uid,
      amountKes,
      amountUsd: trainingFeeUsdFor(gate.feeUsd),
      currency: 'KES',
      status: 'pending',
      jobId,
      metadata: { accessCode: data.data.access_code ?? '', expectedSubunits: subunits },
    }).catch((err) => console.warn('[paystack/initialize] pending row not written:', err))

    await audit({ action: 'PAYMENT_INIT', actorEmail: email, details: { jobId, reference: data.data.reference || reference, amountKes }, req })

    return json({
      ok: true,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code ?? '',
      reference: data.data.reference || reference,
      amountKes,
      currency: 'KES',
      expiresInSec: 600,
      // true = no browser-reachable callback origin exists, so the checkout must NOT navigate the
      // tab away; the client opens Paystack in a new window and confirms the charge itself.
      popupMode,
    })
  } catch (err) {
    return routeError('paystack/initialize', err)
  }
}

/** Reads just enough of the job document to price the charge honestly. */
async function jobTrainingGate(jobId: string): Promise<{ missing: boolean; requiresTraining?: boolean; feeUsd?: number }> {
  const { dbOrNull } = await import('@/lib/firestore-admin')
  const db = dbOrNull()
  if (!db) return { missing: false, requiresTraining: true } // storage unavailable → keep the fee as configured
  try {
    const snap = await db.collection('jobs').doc(jobId).get()
    if (!snap.exists) {
      // Seeded/demo jobs are not in Firestore; do not block a payment for a catalogue entry the
      // public site can still render, but do not invent a price either.
      return { missing: false, requiresTraining: true }
    }
    const data = snap.data() as Record<string, unknown> | undefined
    // The admin-set per-job fee; absent/invalid → undefined so the global configured fee applies.
    const fee = Number(data?.trainingFeeUsd)
    return {
      missing: false,
      requiresTraining: data?.trainingRequired !== false,
      feeUsd: Number.isFinite(fee) && fee > 0 ? fee : undefined,
    }
  } catch {
    return { missing: false, requiresTraining: true }
  }
}
