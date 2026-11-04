'use client'

/**
 * The signed-in dashboard. It used to live at `/`; when `/` became the public landing page this
 * moved here, and every link that used to mean "home" in the worker app (`app-shell`, the sign-in
 * form's post-login redirect, the console's "Worker app" button) now points at `/dashboard`.
 */

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Banknote,
  Clock,
  Eye,
  EyeOff,
  Hourglass,
  Sparkles,
  Star,
  Wallet as WalletIcon,
} from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { JobCard } from '@/components/job-card'
import { TrainingPushBanner } from '@/components/training-push'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { jobHasTraining,
  APPLICATION_LABELS,
  APPLICATION_TONE,
  formatKes,
  formatUsd,
} from '@/lib/afterworks-data'
import { formatTimestamp } from '@/lib/datetime'

function HiddenMoney({ value, hidden, className }: { value: string; hidden: boolean; className: string }) {
  if (!hidden) return <span className={className}>{value}</span>
  return (
    <span className={className}>
      <span aria-hidden="true" className="select-none blur-[7px] transition-all duration-150">{value}</span>
      <span className="sr-only">Balance hidden</span>
    </span>
  )
}

export default function DashboardPage() {
  const {
    worker,
    wallet,
    walletMeta,
    payouts,
    onboarding,
    jobs,
    applications,
    getJob,
    catalogueLive,
    claimWelcomeBonus,
    pending,
    mode,
  } = useAfterWorks()
  const [balanceHidden, setBalanceHidden] = useState(false)
  const [bonusNotice, setBonusNotice] = useState<string | null>(null)
  // Completion and the reward are server-scored (`lib/profile-completion.ts`) and celebrated by the
  // shared reward dialog, so this page never has to guess — or store — whether the $5 was paid.
  const profileCompletion = onboarding.completion.percent
  const welcomeRewardPaid = payouts.welcomeBonus.granted

  const openJobs = jobs.filter((j) => j.status === 'open' && j.slotsRemaining > 0)
  const activeApps = applications.filter(
    (a) => !['completed', 'rejected', 'failed_qa'].includes(a.status),
  )
  const trainingJobs = openJobs.filter((job) => jobHasTraining(job))
  const topTrainingPay = trainingJobs.reduce((highest, job) => Math.max(highest, job.payAmountUsd), 0)

  // The server sums available + pending. Held money is already inside available (a payout request
  // claims it rather than moving it), so it must not be added a second time. The welcome reward is
  // part of available once the server has credited it — this total never counts money that has only
  // been promised.
  const totalBalance = payouts.totalUsd || wallet.availableUsd + wallet.pendingUsd

  async function claimWelcomeReward() {
    setBonusNotice(null)
    const result = await claimWelcomeBonus()
    if (result.granted) {
      setBonusNotice(`${formatUsd(payouts.welcomeBonus.amountUsd)} has been added to your total.`)
      return
    }
    setBonusNotice(result.error || 'The welcome reward could not be claimed yet.')
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {!welcomeRewardPaid && profileCompletion < 100 && (
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-5" aria-label="Welcome reward profile progress">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Complete your profile to unlock {formatUsd(payouts.welcomeBonus.amountUsd)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {onboarding.completion.missing.length > 0
                  ? `Still missing: ${onboarding.completion.missingLabels.join(', ')}.`
                  : 'Everything is filled in — open your profile to claim the reward.'}
              </p>
            </div>
            <span className="font-mono text-lg font-semibold text-primary">{profileCompletion}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={profileCompletion} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${profileCompletion}%` }} />
          </div>
          <Link href="/profile" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">Finish updating your profile →</Link>
        </section>
      )}

      {/* Hero */}
      <section className="overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground sm:p-8">
        <p className="text-sm font-medium text-primary-foreground/70">
          Welcome back, {worker.name && worker.name !== 'Loading…' ? worker.name.split(' ')[0] : 'there'}
        </p>
        <h1 className="mt-2 max-w-2xl text-pretty text-2xl font-semibold leading-tight sm:text-4xl">
          Real, verified work. Paid to your mobile money.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-primary-foreground/80">
          Browsing and applying is always free. You only ever get paid — never
          charged to apply or verify your identity.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            render={<Link href="/jobs" />}
            size="lg"
            className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
          >
            Browse open jobs
            <ArrowRight className="size-4" />
          </Button>
          <Button
            render={<Link href="/wallet" />}
            size="lg"
            variant="outline"
            className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <Banknote className="size-4" />
            {payouts.withdrawableUsd >= (payouts.minWithdrawalUsd || 50) ? 'Withdraw earnings' : 'Wallet & payouts'}
          </Button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/10 px-3 py-1.5 text-xs font-medium text-primary-foreground/85">
            <Star className="size-3.5" />
            Quality score {worker.qualityScore} · Good standing
          </span>
        </div>
      </section>

      {/* Balances — one container for every dollar in the account, not only what can be withdrawn. */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Balances">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <WalletIcon className="size-3.5 text-primary" />
              Total balance
            </p>
            <HiddenMoney
              value={formatUsd(totalBalance)}
              hidden={balanceHidden}
              className="mt-2 block font-mono text-3xl font-semibold tabular-nums sm:text-4xl"
            />
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Everything in your account — withdrawable money, earnings still clearing, amounts on hold,
              referral bonuses and any welcome reward already credited. It all counts here, even when it
              is not ready to withdraw.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBalanceHidden((hidden) => !hidden)}
            aria-label={balanceHidden ? 'Show balances' : 'Hide balances'}
            aria-pressed={balanceHidden}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {balanceHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            {balanceHidden ? 'Show balances' : 'Hide balances'}
          </button>
        </div>

        <div className="grid grid-cols-1 border-t border-border sm:grid-cols-3">
          <div className="border-b border-border p-4 sm:border-b-0 sm:border-r">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Banknote className="size-3.5" />
              Withdrawable
            </p>
            <HiddenMoney
              value={formatUsd(payouts.withdrawableUsd)}
              hidden={balanceHidden}
              className="mt-1.5 block font-mono text-xl font-semibold tabular-nums"
            />
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {balanceHidden ? 'Balance hidden' : `≈ ${formatKes(payouts.withdrawableUsd)}`}
            </p>
          </div>
          <div className="border-b border-border p-4 sm:border-b-0 sm:border-r">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Hourglass className="size-3.5" />
              Pending (clearing)
            </p>
            <HiddenMoney
              value={formatUsd(wallet.pendingUsd)}
              hidden={balanceHidden}
              className="mt-1.5 block font-mono text-xl font-semibold tabular-nums"
            />
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {balanceHidden
                ? 'Balance hidden'
                : walletMeta.nextClearingAt
                  ? `Next clears ${formatTimestamp(walletMeta.nextClearingAt, { day: '2-digit', month: 'short' })}`
                  : `Clears after ${walletMeta.clearingHours}h`}
            </p>
          </div>
          <div className="p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="size-3.5" />
              Held by a request
            </p>
            <HiddenMoney
              value={formatUsd(payouts.heldUsd)}
              hidden={balanceHidden}
              className="mt-1.5 block font-mono text-xl font-semibold tabular-nums"
            />
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {balanceHidden ? 'Balance hidden' : payouts.openPayout ? 'Claimed by your open payout' : 'Nothing held right now'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Welcome reward</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {welcomeRewardPaid
                  ? `${formatUsd(payouts.welcomeBonus.amountUsd)} is credited and already included in your total.`
                  : onboarding.completion.complete
                    ? `${formatUsd(payouts.welcomeBonus.amountUsd)} is earned but not yet in your total — claim it to add it.`
                    : `${formatUsd(payouts.welcomeBonus.amountUsd)} unlocks at 100% profile completion. It joins your total once it is credited.`}
              </p>
              {bonusNotice ? (
                <p className="mt-1 text-xs font-medium text-primary" role="status">{bonusNotice}</p>
              ) : null}
            </div>
          </div>
          {welcomeRewardPaid ? (
            <Button render={<Link href="/wallet" />} size="sm" variant="outline">
              View in wallet
            </Button>
          ) : onboarding.completion.complete ? (
            <Button
              size="sm"
              onClick={() => void claimWelcomeReward()}
              disabled={pending['bonus'] === true || mode === 'demo'}
              className="gap-1.5"
            >
              <Sparkles className="size-3.5" />
              {pending['bonus'] ? 'Claiming…' : `Claim ${formatUsd(payouts.welcomeBonus.amountUsd)}`}
            </Button>
          ) : (
            <Button render={<Link href="/profile" />} size="sm" variant="outline">
              Finish profile
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-5 py-3 text-xs">
          <span className="text-muted-foreground">Referral bonuses are included once credited.</span>
          <div className="flex gap-3">
            <Link href="/referrals" className="font-medium text-primary hover:underline">Referral earnings →</Link>
            <Link href="/wallet" className="font-medium text-primary hover:underline">Wallet & payouts →</Link>
          </div>
        </div>
      </section>

      <TrainingPushBanner trainingJobs={trainingJobs.length} topPayUsd={topTrainingPay} live={catalogueLive} />

      {/* Active applications */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Active applications</h2>
          <Link
            href="/applications"
            className="text-sm font-medium text-primary hover:underline"
          >
            View all
          </Link>
        </div>

        {activeApps.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No active applications yet. Browse jobs to get started.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {activeApps.map((app) => {
              const job = getJob(app.jobId)
              if (!job) return null
              return (
                <Link
                  key={app.id}
                  href="/applications"
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {job.title}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {formatUsd(job.payAmountUsd)}
                    </p>
                  </div>
                  <StatusBadge tone={APPLICATION_TONE[app.status]}>
                    {APPLICATION_LABELS[app.status]}
                  </StatusBadge>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Recommended jobs */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Recommended for you</h2>
          <Link href="/jobs" className="text-sm font-medium text-primary hover:underline">
            See all jobs
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {openJobs.slice(0, 3).map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      </section>
    </div>
  )
}
