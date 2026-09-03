import { NextRequest } from 'next/server'
import { consumeBucket, audit, fail, json, requireUser, routeError } from '@/lib/guards'
import { env, normalizeEmail } from '@/lib/security-core'
import { getTrainingFeeKes, getPaystackAmountSubunits } from '@/lib/afterworks-data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/paystack/verify/[reference] — "did my payment land?"
 *
 * Two defects made the paywall decorative:
 *  • any reference starting with `test_ref_` returned `{ paid: true }`, so typing
 *    `/training/xyz?reference=test_ref_1` unlocked paid training for nothing;
 *  • the entitlement was written for `metadata.userId` from the transaction, which the caller of
 *    `/initialize` had controlled, and the amount paid was never compared with the price.
 *
 * Now the reference must be one this server minted, the charge is re-read from Paystack, the payer
 * email must match the signed-in member, the amount must be at least the configured price, and the
 * entitlement is written to the *authenticated* uid.
 */

const REFERENCE_PATTERN = /^aw_tr_[A-Za-z0-9]{4,32}$/

type PaystackVerify = {
  status?: boolean
  message?: string
  data?: {
    status?: string
    reference?: string
    amount?: number
    currency?: string
    paid_at?: string
    customer?: { email?: string }
    metadata?: Record<string, unknown>
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response
  const { uid, email } = guard.value

  const bucket = consumeBucket('paystack-verify', 60, 60_000, uid)
  if (!bucket.ok) {
    return fail(429, 'Too many verification checks. Please wait.', { code: 'rate_limited', headers: { 'Retry-After': String(bucket.retryAfterSec) } })
  }

  const { reference: paramReference } = await params
  const reference = String(paramReference ?? '').slice(0, 64)
  if (!REFERENCE_PATTERN.test(reference)) {
    return fail(400, 'That payment reference was not issued by this site.', { code: 'bad_reference' })
  }

  const secretKey = env('PAYSTACK_SECRET_KEY')
  if (!secretKey) {
    return fail(503, 'Payment verification is not configured on this deployment.', { code: 'paystack_unconfigured' })
  }

  try {
    const upstream = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    const payload = (await upstream.json().catch(() => null)) as PaystackVerify | null
    if (!upstream.ok || !payload?.status || !payload.data) {
      // A 404 from Paystack means "no such charge" — that is an honest "not paid", not a 502.
      if (upstream.status === 404) return json({ ok: true, paid: false, status: 'not_found', reference })
      return fail(502, 'The payment provider could not be reached. Please try again in a moment.', { code: 'paystack_verify_failed' })
    }

    const tx = payload.data
    if (tx.status !== 'success') {
      const pending = tx.status === 'pending' || tx.status === 'failed' || tx.status === 'abandoned'
      return json({
        ok: true,
        paid: false,
        status: tx.status ?? 'pending',
        reference,
        // `stillPending` keeps the UI polling politely instead of showing a red error for a charge
        // the worker may still be completing on their phone.
        stillPending: pending,
      })
    }

    const payerEmail = normalizeEmail(String(tx.customer?.email ?? ''))
    const expectedEmail = normalizeEmail(email)
    if (!payerEmail || (expectedEmail && payerEmail !== expectedEmail)) {
      await audit({ action: 'PAYMENT_EMAIL_MISMATCH', actorEmail: email, details: { reference, payer: payerEmail.slice(0, 3) + '***' }, req })
      return fail(403, 'This payment was made from a different email address. Contact support to have it applied.', { code: 'email_mismatch' })
    }

    const expectedSubunits = getPaystackAmountSubunits()
    const paidSubunits = Number(tx.amount ?? 0)
    if (!Number.isFinite(paidSubunits) || paidSubunits < expectedSubunits) {
      await audit({ action: 'PAYMENT_UNDERPAID', actorEmail: email, details: { reference, paidSubunits, expectedSubunits }, req })
      return json({
        ok: true,
        paid: false,
        status: 'underpaid',
        reference,
        amountPaidKes: Math.round(paidSubunits / 100),
        amountDueKes: Math.round(expectedSubunits / 100),
        message: `The charge was KES ${Math.round(paidSubunits / 100).toLocaleString()} but training costs KES ${(
          getTrainingFeeKes()
        ).toLocaleString()}. Contact support and we will apply it manually.`,
      })
    }

    const jobId = typeof tx.metadata?.jobId === 'string' ? tx.metadata.jobId.slice(0, 80) : ''
    if (!jobId) return fail(409, 'This charge is not linked to a job card. Contact support.', { code: 'missing_job_id' })

    // Grant to the authenticated member. `metadata.uid` is only used to detect a mis-bound charge.
    const boundUid = typeof tx.metadata?.uid === 'string' ? tx.metadata.uid : ''
    if (boundUid && boundUid !== uid) {
      return fail(403, 'This payment belongs to a different account.', { code: 'uid_mismatch' })
    }

    const firestore = await import('@/lib/firestore-admin')
    await firestore.recordPaidTrainingAdmin(uid, jobId)
    await firestore
      .recordPaymentTransactionAdmin({
        reference: tx.reference || reference,
        email: payerEmail || email,
        userId: uid,
        amountKes: Math.round(paidSubunits / 100),
        currency: tx.currency || 'KES',
        status: 'success',
        jobId,
        metadata: { verifiedAt: new Date().toISOString(), paidAt: tx.paid_at ?? '', source: 'client-verify' },
      })
      .catch((err) => console.warn('[paystack/verify] ledger row not updated:', err))

    await firestore
      .notifyUser(uid, {
        title: 'Training unlocked',
        body: 'Your payment was confirmed and training for this job card is open. Complete the assessment to apply.',
        tone: 'success',
        link: `/training/${encodeURIComponent(jobId)}`,
      })
      .catch(() => undefined)

    await audit({ action: 'PAYMENT_VERIFIED', actorEmail: email, details: { reference, jobId, amountKes: Math.round(paidSubunits / 100) }, req })

    return json({ ok: true, paid: true, status: 'success', reference, jobId, amountKes: Math.round(paidSubunits / 100), currency: tx.currency ?? 'KES' })
  } catch (err) {
    return routeError('paystack/verify', err)
  }
}
