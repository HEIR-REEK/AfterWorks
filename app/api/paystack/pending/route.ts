import { NextRequest } from 'next/server'
import { fail, json, requireUser } from '@/lib/guards'

export const dynamic = 'force-dynamic'

const REFERENCE_PATTERN = /^aw_tr_[A-Za-z0-9]{4,32}$/

/**
 * GET /api/paystack/pending?jobId=… — references this member started for this job card that the
 * server still holds as `pending`.
 *
 * Why this exists: when the Paystack redirect cannot reach the app (a preview tunnel whose Host is
 * a bind address, a closed tab, a missing webhook), a real charge can settle while the worker is
 * stuck outside the paywall. /initialize wrote the pending row server-side before sending the
 * payer to Paystack, so the training page can ask for those rows and re-run each reference through
 * /api/paystack/verify — which confirms the charge against Paystack, records it as `success` in the
 * `transactions` ledger (visible in the admin money ledger) and unlocks training. No reference from
 * the user is needed; the row is bound to the authenticated uid.
 *
 * The query filters on `userId` only (single-field, no composite index required) and the remaining
 * filters are applied in memory over a small recent slice.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response
  const { uid } = guard.value

  const jobId = String(req.nextUrl.searchParams.get('jobId') ?? '').slice(0, 80)
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(jobId)) return fail(400, 'Unknown job reference.', { code: 'bad_job_id' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return json({ ok: true, refs: [] })
    const db = firestore.dbOrNull()
    if (!db) return json({ ok: true, refs: [] })

    const snap = await db.collection('transactions').where('userId', '==', uid).limit(40).get()
    const refs = snap.docs
      .map((doc) => (doc.data() ?? {}) as { status?: unknown; jobId?: unknown; reference?: unknown; createdAt?: unknown })
      .filter((row) => row.status === 'pending' && row.jobId === jobId)
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      .map((row) => String(row.reference ?? '').slice(0, 64))
      .filter((ref) => REFERENCE_PATTERN.test(ref))
    return json({ ok: true, refs: refs.slice(0, 5) })
  } catch (err) {
    // A ledger read must never break the paywall: with no rows the worker just sees the checkout.
    console.warn('[paystack/pending] could not list pending rows:', err instanceof Error ? err.message : err)
    return json({ ok: true, refs: [] })
  }
}
