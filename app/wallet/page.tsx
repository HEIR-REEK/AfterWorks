'use client'

/**
 * Wallet — the member's money home.
 *
 * Before this page the only place a balance appeared was a two-tile summary on the dashboard, and
 * there was no route at all for asking for a payout (an `available` figure with no exit). This page
 * answers the three questions a worker actually has, in order:
 *   1. how much is mine right now (with the pending/hold breakdown spelled out);
 *   2. how do I get it (the withdrawal panel);
 *   3. where did the money come from (the ledger, labelled entry by entry).
 */

import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, Banknote, CircleDollarSign, Clock, Hourglass, Info, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { WithdrawPanel } from '@/components/withdraw-panel'
import { useAfterWorks } from '@/components/afterworks-provider'
import { Button } from '@/components/ui/button'
import { BalanceToggle, Money } from '@/components/balance-privacy'
import { formatUsd } from '@/lib/afterworks-data'
import { site } from '@/lib/site'
import { cn } from '@/lib/utils'

const ENTRY_LABELS: Record<string, string> = {
  earning: 'Work completed',
  signup_bonus: 'Welcome reward — profile completed',
  withdrawal: 'Withdrawal paid out',
  adjustment: 'Balance adjustment',
  reversal: 'Reversal',
}

export default function WalletPage() {
  const { worker, wallet, walletMeta, payouts, mode, onboarding } = useAfterWorks()
  const demo = mode === 'demo'

  const entries = walletMeta.entries
  const bonusGranted = payouts.welcomeBonus.granted

  return (
    <div className="flex flex-col gap-6 pb-4 sm:gap-7">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <Wallet className="size-5 text-primary" />
            Wallet
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Earnings, clearing, withdrawals and your payout destination — all in one place.
          </p>
        </div>
        {/* Same switch as the dashboard: one preference covers every balance on the site. */}
        <BalanceToggle />
        {worker.kycVerified ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-3 py-1 text-xs font-medium text-success">
            <ShieldCheck className="size-3.5" />
            Identity verified
          </span>
        ) : (
          <Button render={<Link href="/profile" />} size="sm" variant="outline" className="gap-1.5">
            <ShieldCheck className="size-3.5" />
            Verify identity to withdraw
          </Button>
        )}
      </section>

      {demo ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>
            Preview — the balances on this page are examples and withdrawals are switched off, so you cannot send a
            request from here.
          </span>
        </div>
      ) : null}

      {/* Balance breakdown */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <CircleDollarSign className="size-3.5" />
            Withdrawable
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
            <Money value={payouts.withdrawableUsd} />
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">≈ <Money value={payouts.withdrawableKes} /></p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Hourglass className="size-3.5" />
            Pending (clearing)
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
            <Money value={wallet.pendingUsd} />
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {walletMeta.nextClearingAt ? `Next clears ${new Date(walletMeta.nextClearingAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : `Clears after ${walletMeta.clearingHours}h`}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Clock className="size-3.5" />
            Held by a request
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
            <Money value={payouts.heldUsd} />
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {payouts.openPayout ? 'Claimed by your open payout request' : 'Nothing is held right now'}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5" />
            Welcome reward
          </p>
          <p className={cn('mt-1.5 font-mono text-2xl font-semibold tabular-nums', bonusGranted && 'text-success')}>
            {bonusGranted ? <Money value={payouts.welcomeBonus.amountUsd} /> : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {bonusGranted
              ? 'Paid for completing your profile'
              : onboarding.completion.complete
                ? 'Ready to claim for this profile'
                : `${onboarding.completion.percent}% complete — finish your profile to earn it`}
          </p>
        </div>
      </section>

      {!bonusGranted && !onboarding.completion.complete ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/[0.05] px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">
                <Money value={payouts.welcomeBonus.amountUsd} /> waiting for a 100% profile
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Still missing: {onboarding.completion.missingLabels.join(', ')}.
              </p>
            </div>
          </div>
          <Button render={<Link href="/profile?complete=1" />} size="sm">
            Finish profile
          </Button>
        </section>
      ) : null}

      {/* Withdrawal panel */}
      <WithdrawPanel />

      {/* Ledger */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4 sm:p-5">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Banknote className="size-4 text-primary" />
              Money movements
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every credit, payout and reward recorded against your account.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {walletMeta.asOf ? `As of ${new Date(walletMeta.asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        </header>

        {entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nothing here yet. When your first job is approved, the credit appears instantly and clears {walletMeta.clearingHours} hours
            later.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => {
              const outgoing = entry.kind === 'withdrawal'
              const pendingEntry = entry.status === 'pending'
              return (
                <li key={entry.id} className="flex items-start justify-between gap-3 p-3.5 sm:px-5">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
                        outgoing ? 'bg-primary/10 text-primary' : 'bg-success/12 text-success',
                      )}
                    >
                      {outgoing ? <ArrowUpRight className="size-3.5" /> : <ArrowDownLeft className="size-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{ENTRY_LABELS[entry.kind] ?? entry.kind.replace(/_/g, ' ')}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {entry.jobTitle || entry.description || (entry.reference ? `Ref ${entry.reference}` : '')}
                        {' · '}
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                      </p>
                      {pendingEntry ? (
                        <p className="mt-0.5 text-[11px] text-warning">
                          Clearing{entry.clearedAt ? ` — available ${new Date(entry.clearedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn('font-mono text-sm font-semibold tabular-nums', outgoing ? 'text-foreground' : 'text-success')}>
                      {outgoing ? '−' : '+'}
                      <Money value={entry.amountUsd} />
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{entry.status}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-muted/25 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground">How payouts work</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          <li>• Completed work is credited instantly but sits in <strong>pending</strong> for {site.clearingWindowHours} hours, so a client can raise a quality issue before money leaves.</li>
          <li>• After clearing it moves to <strong>available</strong>. A payout request claims the amount (shown as <strong>held</strong>) while our team sends it.</li>
          <li>• {site.payoutSla}</li>
          <li>• The minimum withdrawal is {formatUsd(payouts.minWithdrawalUsd || 50)}, paid only to payout details in your own name.</li>
        </ul>
      </section>
    </div>
  )
}
