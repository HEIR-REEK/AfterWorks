import { NextRequest } from 'next/server'
import { audit, fail, json, requireAdmin, routeError } from '@/lib/guards'
import {
  PAYOUT_REASON_REQUIRED,
  PAYOUT_STATUSES,
  canTransitionPayout,
  nextPayoutStatuses,
  requiresPayoutReference,
  type PayoutRequestStatus,
} from '@/lib/payouts'
import { WalletError, getPayoutQueueSummary, listPayoutRequests, settlePayoutRequest } from '@/lib/wallet-server'

/**
 * The withdrawal desk.
 *
 * GET   /api/admin/payouts  — the queue: newest first, filterable by status, with a summary.
 * PATCH /api/admin/payouts  — move one request through the payout state machine.
 *
 * Guarded by `requireAdmin`, which is deliberately *not* `requireOwner`: staff run the desk and
 * should be able to approve, send and settle payouts, or mark one failed when M-Pesa bounces it.
 * What keeps that safe is not the role check but the arithmetic — every transition re-reads the
 * member's wallet inside a transaction, so a payout can only debit money that was actually held, and
 * a rejection/failure can only return what is still held.
 *
 * Manual balance edits remain owner-only (`/api/admin/users` action `wallet`); this route never
 * invents a balance, it only settles requests that already exist.
 */

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const params = req.nextUrl.searchParams
  const status = params.get('status') ?? 'all'
  if (status !== 'all' && !(PAYOUT_STATUSES as readonly string[]).includes(status)) {
    return fail(400, `status must be one of ${PAYOUT_STATUSES.join(', ')} or all.`, { code: 'bad_request' })
  }
  const search = params.get('search')?.trim() ?? ''
  const cursor = params.get('cursor')
  const pageSize = Math.min(100, Math.max(5, Number(params.get('pageSize') ?? PAGE_SIZE) || PAGE_SIZE))

  try {
    const page = await listPayoutRequests({ status, search, cursor, pageSize, withSummary: true })
    // The console needs to know which buttons are legal for each row, and the rule lives in the
    // shared domain module so the UI and the API can never disagree.
    const transitions = Object.fromEntries(
      PAYOUT_STATUSES.map((value) => [
        value,
        {
          next: nextPayoutStatuses(value),
          needsReason: PAYOUT_REASON_REQUIRED.includes(value),
          needsReference: requiresPayoutReference(value),
        },
      ]),
    )

    return json({
      ok: true,
      rows: page.rows,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      pageSize: page.pageSize,
      summary: page.summary,
      transitions,
      degraded: page.degraded ?? null,
      payoutSla: (await import('@/lib/site')).site.payoutSla,
    })
  } catch (err) {
    return routeError('admin/payouts:GET', err)
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail(400, 'Send the payout request id and the new status.', { code: 'bad_request' })
  }

  const requestId = String(body.id ?? body.requestId ?? '').trim()
  const to = String(body.status ?? body.to ?? '').trim() as PayoutRequestStatus
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const payoutReference = typeof body.payoutReference === 'string' ? body.payoutReference.trim() : ''

  if (!requestId || !/^[A-Za-z0-9_-]{4,120}$/.test(requestId)) {
    return fail(400, 'Send a valid payout request id.', { code: 'bad_request' })
  }
  if (!(PAYOUT_STATUSES as readonly string[]).includes(to)) {
    return fail(400, `status must be one of ${PAYOUT_STATUSES.join(', ')}.`, { code: 'bad_request' })
  }
  if ((PAYOUT_REASON_REQUIRED as readonly string[]).includes(to) && reason.length < 4) {
    return fail(400, 'Add a short reason (at least 4 characters) — it is shown to the member and kept in the audit log.', { code: 'reason_required' })
  }
  if (requiresPayoutReference(to) && payoutReference.length < 3) {
    return fail(400, 'Add the provider reference (M-Pesa code or bank reference) before marking this paid.', { code: 'reference_required' })
  }

  try {
    const result = await settlePayoutRequest({
      requestId,
      to,
      actorEmail: guard.value.email,
      reason,
      payoutReference,
    })

    await audit({
      action: 'PAYOUT_STATUS_CHANGED',
      actorEmail: guard.value.email,
      details: {
        requestId,
        to,
        from: result.request.status,
        amountUsd: result.request.amountUsd,
        releasedUsd: result.releasedUsd,
        debitedUsd: result.debitedUsd,
        reason: reason.slice(0, 200),
      },
      req,
    })

    const summary = await getPayoutQueueSummary()
    return json({
      ok: true,
      request: result.request,
      releasedUsd: result.releasedUsd,
      debitedUsd: result.debitedUsd,
      summary,
      message:
        to === 'paid'
          ? `Marked paid. ${result.request.destinationLabel}.`
          : result.releasedUsd > 0
            ? `Released ${result.releasedUsd.toFixed(2)} USD back to the member.`
            : 'Request updated.',
    })
  } catch (err) {
    if (err instanceof WalletError) {
      // A state-machine refusal is a 409 for the console to render, not a crash.
      const status = err.code === 'invalid_transition' && !canTransitionPayout('pending', to) ? 409 : err.status
      return fail(status, err.message, { code: err.code })
    }
    return routeError('admin/payouts:PATCH', err)
  }
}
