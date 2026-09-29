'use client'

/**
 * The withdrawal request panel.
 *
 * This is the piece the platform was missing: before it, `availableUsd` could only ever grow. The
 * panel shows the true position (pending → clears → held → withdrawable), why a request may be
 * blocked, and takes the amount. Every number here comes from the server snapshot; the client only
 * validates for *speed*, and the same rules run again in `POST /api/payouts` before a cent moves.
 *
 * The one-request-at-a-time rule is deliberate and visible: an open request claims the amount it
 * asked for, so the withdrawable figure drops by exactly that much and the form explains who is
 * holding what. That is friendlier than letting a member queue five requests and then discovering
 * the last four cannot be paid.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock,
  Hourglass,
  Loader2,
  Landmark,
  Smartphone,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { useAfterWorks } from '@/components/afterworks-provider'
import { formatKesValue, formatUsd } from '@/lib/afterworks-data'
import {
  PAYOUT_STATUS_SHORT,
  PAYOUT_STATUS_TONE,
  isCancellablePayoutStatus,
  payoutStatusCopy,
  validateWithdrawalAmount,
  withdrawalQuote,
} from '@/lib/payouts'
import { site } from '@/lib/site'
import { cn } from '@/lib/utils'

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function WithdrawPanel() {
  const { wallet, walletMeta, payouts, requestPayout, cancelPayout, pending, refreshPayouts } = useAfterWorks()
  const [amount, setAmount] = useState('')
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null)

  const quote = useMemo(
    () =>
      withdrawalQuote({
        availableUsd: wallet.availableUsd,
        heldUsd: payouts.heldUsd,
        amountUsd: Number(amount) || 0,
        minWithdrawalUsd: payouts.minWithdrawalUsd || walletMeta.minWithdrawalUsd || 50,
        usdToKes: payouts.usdToKes,
      }),
    [amount, payouts.heldUsd, payouts.minWithdrawalUsd, payouts.usdToKes, wallet.availableUsd, walletMeta.minWithdrawalUsd],
  )

  const minUsd = quote.minWithdrawalUsd
  const openPayout = payouts.openPayout
  const busy = Boolean(pending['payout:new'])

  const validation = amount
    ? validateWithdrawalAmount(Number(amount), quote.withdrawableUsd, minUsd)
    : { ok: false as const, error: '' }

  const blockers: string[] = []
  if (!payouts.kycVerified) blockers.push('Identity verification (KYC) must be complete.')
  if (payouts.accountState && payouts.accountState !== 'active') blockers.push(`Your account is ${payouts.accountState.replace(/_/g, ' ')} — withdrawals are paused.`)
  if (!payouts.destination.ready) blockers.push(payouts.destination.problem || 'Add your payout details on the profile page.')
  if (openPayout) blockers.push('You already have a payout request in progress.')
  if (quote.withdrawableUsd < minUsd && !openPayout) {
    blockers.push(
      quote.withdrawableUsd > 0
        ? `You can withdraw ${formatUsd(quote.withdrawableUsd)} — the minimum is ${formatUsd(minUsd)}.`
        : `Nothing is withdrawable yet. Cleared earnings appear here after the ${walletMeta.clearingHours}h clearing window.`,
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setNotice(null)
    if (!validation.ok) {
      setNotice({ tone: 'error', text: validation.error || 'Enter an amount to withdraw.' })
      return
    }
    const result = await requestPayout(validation.amountUsd)
    if (result.ok) {
      setAmount('')
      setNotice({
        tone: 'success',
        text: `Request received for ${formatUsd(validation.amountUsd)}. The amount is held until it is paid out.`,
      })
    } else {
      setNotice({ tone: 'error', text: result.error || 'The request could not be submitted.' })
    }
  }

  async function cancel(id: string) {
    setNotice(null)
    const result = await cancelPayout(id)
    setNotice(
      result.ok
        ? { tone: 'info', text: 'Request cancelled — the money is back in your available balance.' }
        : { tone: 'error', text: result.error || 'That request could not be cancelled.' },
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Banknote className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Withdraw your earnings</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Request a payout to your saved {payouts.destination.method === 'Bank Transfer' ? 'bank account' : 'M-Pesa number'}.
              {site.payoutSla ? ` ${site.payoutSla}` : ''}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Ready to withdraw</p>
          <p className="font-mono text-xl font-semibold tabular-nums">{formatUsd(quote.withdrawableUsd)}</p>
          <p className="text-[11px] text-muted-foreground">≈ {formatKesValue(quote.withdrawableKes)}</p>
        </div>
      </header>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.1fr_1fr]">
        {/* ── Form ─────────────────────────────────────────────────────────── */}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-border bg-muted/25 p-2.5">
              <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Hourglass className="size-3" /> Pending
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{formatUsd(wallet.pendingUsd)}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/25 p-2.5">
              <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Clock className="size-3" /> Held
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{formatUsd(quote.heldUsd)}</p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-2.5">
              <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <CheckCircle2 className="size-3" /> Available
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{formatUsd(quote.withdrawableUsd)}</p>
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold">Amount to withdraw (USD)</span>
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={minUsd.toFixed(2)}
                  disabled={Boolean(openPayout) || busy}
                  aria-describedby="withdraw-help"
                  className="h-11 w-full rounded-xl border border-input bg-background pl-7 pr-3 text-sm font-medium tabular-nums outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={quote.withdrawableUsd <= 0 || Boolean(openPayout)}
                onClick={() => setAmount(quote.withdrawableUsd.toFixed(2))}
              >
                Max
              </Button>
            </div>
            <span id="withdraw-help" className="mt-1 block text-[11px] text-muted-foreground">
              {amount && validation.ok
                ? `≈ ${formatKesValue(quote.amountKes)} at today's rate (${quote.usdToKes.toFixed(2)} KES/USD).`
                : `Minimum ${formatUsd(minUsd)}. You can request up to ${formatUsd(quote.withdrawableUsd)} right now.`}
            </span>
          </label>

          {/* Destination + how it is paid */}
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/25 p-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                {payouts.destination.method === 'Bank Transfer' ? <Landmark className="size-3.5" /> : <Smartphone className="size-3.5 text-success" />}
                {payouts.destination.label}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {payouts.destination.ready
                  ? `Payouts are sent to the account name on your profile (${payouts.destination.accountName || 'name on file'}).`
                  : payouts.destination.problem}
              </p>
            </div>
            <Link href="/profile?complete=1" className="shrink-0 text-[11px] font-medium text-primary underline-offset-2 hover:underline">
              Change
            </Link>
          </div>

          {blockers.length > 0 && !openPayout ? (
            <ul className="flex flex-col gap-1 rounded-xl border border-warning/30 bg-warning/10 p-3 text-[11px] text-warning-foreground">
              {blockers.map((blocker) => (
                <li key={blocker} className="flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{blocker}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {notice ? (
            <p
              className={cn(
                'flex items-start gap-1.5 rounded-xl border px-3 py-2 text-[11px]',
                notice.tone === 'success' && 'border-success/30 bg-success/10 text-success',
                notice.tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
                notice.tone === 'info' && 'border-border bg-muted/40 text-foreground',
              )}
              role="status"
            >
              {notice.tone === 'error' ? <XCircle className="mt-0.5 size-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
              {notice.text}
            </p>
          ) : null}

          <Button type="submit" className="gap-2" disabled={busy || Boolean(openPayout) || blockers.length > 0 || !amount}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
            {busy ? 'Submitting…' : 'Request withdrawal'}
          </Button>
        </form>

        {/* ── Current + recent requests ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          {openPayout ? (
            <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">Open request</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">{formatUsd(openPayout.amountUsd)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    ≈ {formatKesValue(openPayout.amountKes)} · requested {formatWhen(openPayout.requestedAt)}
                  </p>
                </div>
                <StatusBadge tone={PAYOUT_STATUS_TONE[openPayout.status]}>{PAYOUT_STATUS_SHORT[openPayout.status]}</StatusBadge>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {payoutStatusCopy(openPayout, { payoutSla: site.payoutSla })}
              </p>
              {isCancellablePayoutStatus(openPayout.status) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={Boolean(pending[`payout:${openPayout.id}`])}
                  onClick={() => void cancel(openPayout.id)}
                >
                  {pending[`payout:${openPayout.id}`] ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Cancel request
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent requests</h3>
            <button
              type="button"
              onClick={() => void refreshPayouts()}
              className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
            >
              Refresh
            </button>
          </div>

          {payouts.requests.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-[11px] leading-relaxed text-muted-foreground">
              No withdrawal requests yet. Completed work clears in {walletMeta.clearingHours} hours, then it shows up here as
              withdrawable.
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {payouts.requests.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold tabular-nums">{formatUsd(row.amountUsd)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {formatWhen(row.requestedAt)}
                      {row.payoutReference ? ` · ref ${row.payoutReference}` : ''}
                    </p>
                    {row.reason && (row.status === 'rejected' || row.status === 'failed') ? (
                      <p className="mt-0.5 truncate text-[11px] text-destructive">{row.reason}</p>
                    ) : null}
                  </div>
                  <StatusBadge tone={PAYOUT_STATUS_TONE[row.status]}>{PAYOUT_STATUS_SHORT[row.status]}</StatusBadge>
                </li>
              ))}
            </ul>
          )}

          <Link href="/profile" className="inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline">
            Manage payout details
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
    </section>
  )
}
