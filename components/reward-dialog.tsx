'use client'

/**
 * The congratulations popup.
 *
 * Fires the moment the server confirms the $5 welcome reward was credited — from the profile save
 * that completed the profile, from an explicit claim, or the first time this browser sees a reward an
 * operator granted. It blurs the whole screen so the message cannot be missed and cannot be confused
 * with a toast that scrolls away.
 *
 * The copy is careful about what the money *is*: it is in the member's available balance, spendable
 * through the withdrawal panel once they clear the platform minimum — no claim button, because the
 * server has already written the ledger row by the time this renders.
 */

import { PartyPopper, ShieldCheck, Wallet } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useAfterWorks } from '@/components/afterworks-provider'
import { formatKes, formatUsd } from '@/lib/afterworks-data'

export function RewardDialog() {
  const router = useRouter()
  const { onboarding, wallet, payouts, worker } = useAfterWorks()
  const reward = onboarding.reward

  if (!reward?.open) return null

  const amount = reward.amountUsd || payouts.welcomeBonus.amountUsd || 5
  const first = (worker.name || 'there').split(' ')[0]
  const minUsd = payouts.minWithdrawalUsd || 10
  const canWithdrawNow = payouts.withdrawableUsd >= minUsd && minUsd > 0

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground/45 p-3 backdrop-blur-lg sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reward-title"
      aria-describedby="reward-body"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card text-center shadow-2xl animate-in fade-in zoom-in-95">
        {/* Celebration band. Pure CSS — no image, nothing to load slowly on a phone. */}
        <div className="relative h-28 overflow-hidden bg-primary">
          <div aria-hidden="true" className="absolute inset-0 opacity-30 [background:radial-gradient(circle_at_20%_20%,white_0,transparent_35%),radial-gradient(circle_at_80%_30%,white_0,transparent_30%),radial-gradient(circle_at_50%_100%,white_0,transparent_40%)]" />
          <div className="relative flex h-full items-center justify-center gap-3 text-primary-foreground">
            <PartyPopper className="size-9" aria-hidden="true" />
            <span className="font-mono text-4xl font-bold tabular-nums">{formatUsd(amount)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-6 sm:p-7">
          <div>
            <h2 id="reward-title" className="text-xl font-bold tracking-tight">
              Congratulations, {first}!
            </h2>
            <p id="reward-body" className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Your profile is 100% complete{reward.alreadyPaid ? '' : ''} and we have added{' '}
              <strong className="text-foreground">{formatUsd(amount)}</strong> to your available balance.
              {' '}That is about {formatKes(amount)} at today&apos;s rate.
            </p>
          </div>

          <div className="grid gap-2 rounded-2xl border border-border bg-muted/30 p-4 text-left text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Available balance</span>
              <span className="font-mono font-semibold text-foreground">{formatUsd(wallet.availableUsd)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Ready to withdraw</span>
              <span className="font-mono font-semibold text-foreground">{formatUsd(payouts.withdrawableUsd)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Withdrawal minimum</span>
              <span className="font-mono font-semibold text-foreground">{formatUsd(minUsd)}</span>
            </div>
          </div>

          <p className="flex items-start gap-2 text-left text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
            {canWithdrawNow
              ? 'You can request a withdrawal right now from your wallet.'
              : `Withdrawals open at ${formatUsd(minUsd)} — top this up with your first paid task, or start one now.`}
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              className="gap-2"
              onClick={() => {
                onboarding.dismissReward()
                router.push('/wallet')
              }}
            >
              <Wallet className="size-4" />
              {canWithdrawNow ? 'Withdraw or view wallet' : 'View my wallet'}
            </Button>
            <Button variant="outline" onClick={onboarding.dismissReward}>
              Keep working
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
