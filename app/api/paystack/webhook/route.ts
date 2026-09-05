import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { env, normalizeEmail } from '@/lib/security-core'
import { getPaystackAmountSubunits } from '@/lib/afterworks-data'
import { NO_STORE_HEADERS } from '@/lib/security-core'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/paystack/webhook — the authoritative "money arrived" signal.
 *
 * What changed:
 *  • the signature is compared with `crypto.timingSafeEqual` (a `!==` on a hex string leaks bytes
 *    through comparison timing and is the classic HMAC-check bug) and the raw body is hashed exactly
 *    as received, capped at 64 KB before parsing;
 *  • a charge only grants training if the amount covers the configured price and the reference was
 *    minted by this server;
 *  • the entitlement is written to the uid recorded on the pending transaction row (server-authored
 *    at /initialize), not to whatever the event body claims;
 *  • processing is idempotent, so Paystack's retries cannot double-apply anything, and every outcome
 *    is logged to the audit ledger.
 */

type ChargeEvent = {
  event?: string
  data?: {
    reference?: string
    status?: string
    amount?: number
    currency?: string
    paid_at?: string
    customer?: { email?: string }
    metadata?: Record<string, unknown>
  }
}

export async function POST(req: NextRequest) {
  const secretKey = env('PAYSTACK_WEBHOOK_SECRET') ?? env('PAYSTACK_SECRET_KEY')
  if (!secretKey) return ack(503, 'webhook not configured')

  const raw = await req.text().catch(() => '')
  if (!raw || raw.length > 64 * 1024) return ack(413, 'payload too large')

  const signature = req.headers.get('x-paystack-signature') ?? ''
  const digest = crypto.createHmac('sha512', secretKey).update(raw).digest('hex')
  if (!signaturesMatch(signature, digest)) return ack(401, 'invalid signature')

  let event: ChargeEvent
  try {
    event = JSON.parse(raw) as ChargeEvent
  } catch {
    return ack(400, 'malformed body')
  }

  if (event.event !== 'charge.success' && event.event !== 'transfer.success') {
    // Acknowledge irrelevant events so Paystack does not retry them forever.
    return NextResponse.json({ status: true, ignored: event.event ?? 'unknown' }, { headers: NO_STORE_HEADERS })
  }

  const tx = event.data ?? {}
  const reference = String(tx.reference ?? '').slice(0, 64)
  if (!/^aw_tr_[A-Za-z0-9]{4,32}$/.test(reference)) return ack(400, 'unknown reference format')

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return ack(503, 'storage unavailable')

    const { dbOrNull } = firestore
    const db = dbOrNull()
    if (!db) return ack(503, 'storage unavailable')

    const txRef = db.collection('transactions').doc(`tx_${reference}`)
    const row = await txRef.get()
    const stored = (row.data() ?? {}) as Record<string, unknown>

    if (stored.status === 'success' && stored.grantedAt) {
      return NextResponse.json({ status: true, duplicate: true }, { headers: NO_STORE_HEADERS })
    }

    // Re-read the transaction from Paystack: a webhook body alone is a bearer-less POST anyone can
    // forge if the signing key ever leaks, and this also catches amount edits.
    const secret = env('PAYSTACK_SECRET_KEY')
    if (!secret) return ack(503, 'verification not configured')
    const verify = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    const verified = (await verify.json().catch(() => null)) as {
    status?: boolean
    data?: {
      status?: string
      amount?: number
      currency?: string
      paid_at?: string
      customer?: { email?: string }
      metadata?: Record<string, unknown>
    }
  } | null
    if (!verify.ok || !verified?.status || verified.data?.status !== 'success') return ack(409, 'charge not settled')

    const paidSubunits = Number(verified.data.amount ?? tx.amount ?? 0)
    // Per-job training prices: the pending row written at /initialize carries the exact subunit
    // price this charge was opened for; the Paystack metadata is the fallback, global fee last.
    const storedMeta = (stored.metadata ?? {}) as { expectedSubunits?: unknown }
    const expectedFromRow = Number(storedMeta.expectedSubunits ?? 0)
    const expectedFromEvent = Number(verified.data.metadata?.expectedAmountKes ?? 0)
    const expected =
      Number.isFinite(expectedFromRow) && expectedFromRow > 0
        ? Math.round(expectedFromRow)
        : Number.isFinite(expectedFromEvent) && expectedFromEvent > 0
          ? Math.round(expectedFromEvent) * 100
          : getPaystackAmountSubunits()
    const uid = String(stored.userId ?? verified.data.metadata?.uid ?? '')
    const jobId = String(stored.jobId ?? verified.data.metadata?.jobId ?? '')
    const payer = normalizeEmail(String(verified.data.customer?.email ?? tx.customer?.email ?? ''))

    if (paidSubunits < expected) {
      await txRef.set({ status: 'underpaid', paidSubunits, expectedSubunits: expected, checkedAt: new Date().toISOString() }, { merge: true })
      await firestore.createAuditEntry('PAYMENT_WEBHOOK_UNDERPAID', { reference, paidSubunits, expected, payer: payer.slice(0, 3) + '***' }, 'Paystack Webhook')
      return NextResponse.json({ status: true, recorded: 'underpaid' }, { headers: NO_STORE_HEADERS })
    }

    if (!uid || !jobId) {
      await firestore.createAuditEntry('PAYMENT_WEBHOOK_UNBOUND', { reference, payer }, 'Paystack Webhook')
      return NextResponse.json({ status: true, recorded: 'unbound' }, { headers: NO_STORE_HEADERS })
    }

    await firestore.recordPaidTrainingAdmin(uid, jobId)
    await txRef.set(
      {
        status: 'success',
        amountKes: Math.round(paidSubunits / 100),
        currency: verified.data.currency ?? tx.currency ?? 'KES',
        email: payer || String(stored.email ?? ''),
        userId: uid,
        jobId,
        grantedAt: new Date().toISOString(),
        source: 'webhook',
        paidAt: tx.paid_at ?? verified.data.paid_at ?? '',
      },
      { merge: true },
    )

    await firestore
      .notifyUser(uid, {
        title: 'Training unlocked',
        body: 'We confirmed your payment. Your training and assessment are open — complete them to apply for the job card.',
        tone: 'success',
        link: `/training/${encodeURIComponent(jobId)}`,
      })
      .catch(() => undefined)

    await firestore.createAuditEntry('PAYMENT_WEBHOOK_GRANTED', { reference, jobId, amountKes: Math.round(paidSubunits / 100) }, 'Paystack Webhook')

    return NextResponse.json({ status: true, granted: true }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    console.error('[paystack/webhook] processing failed:', err)
    // 200 + recorded failure: returning 500 makes Paystack retry a poisoned event every few minutes.
    return NextResponse.json({ status: true, deferred: true }, { headers: NO_STORE_HEADERS })
  }
}

function signaturesMatch(provided: string, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

function ack(status: number, reason: string) {
  return NextResponse.json({ status: status < 300, reason }, { status: status === 503 ? 503 : status, headers: NO_STORE_HEADERS })
}
