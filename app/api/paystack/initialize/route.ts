import { NextRequest } from 'next/server'
import { consumeBucket, audit, fail, json, maintenanceBlockForApi, requireUser, routeError } from '@/lib/guards'
import { env, envInt, readJsonBody, sanitizeLine } from '@/lib/security-core'
import { getPaystackAmountSubunits, getTrainingFeeKes, getTrainingFeeUsd } from '@/lib/afterworks-data'
import { randomId } from '@/lib/session-token'

export const dynamic = 'force-dynamic'

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

  const guard = await requireUser(req)
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

    const amountKes = getTrainingFeeKes()
    const subunits = getPaystackAmountSubunits()

    const reference = `aw_tr_${randomId(10)}`
    const callbackUrl = `${req.nextUrl.origin}/training/${encodeURIComponent(jobId)}`

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
        callback_url: callbackUrl,
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
      amountUsd: getTrainingFeeUsd(),
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
    })
  } catch (err) {
    return routeError('paystack/initialize', err)
  }
}

/** Reads just enough of the job document to price the charge honestly. */
async function jobTrainingGate(jobId: string): Promise<{ missing: boolean; requiresTraining?: boolean }> {
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
    return { missing: false, requiresTraining: data?.trainingRequired !== false }
  } catch {
    return { missing: false, requiresTraining: true }
  }
}
