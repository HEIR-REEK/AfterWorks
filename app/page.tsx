'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  Star,
  Wallet as WalletIcon,
} from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { JobCard } from '@/components/job-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { BalanceToggle, MaskedValue } from '@/components/balance-privacy'
import {
  APPLICATION_LABELS,
  APPLICATION_TONE,
  formatKes,
  formatUsd,
} from '@/lib/afterworks-data'

export default function DashboardPage() {
  const { worker, wallet, walletMeta, payouts, onboarding, jobs, applications, getJob } = useAfterWorks()
  // Completion and the reward are server-scored (`lib/profile-completion.ts`) and celebrated by the
  // shared reward dialog, so this page never has to guess — or store — whether the $5 was paid.
  const profileCompletion = onboarding.completion.percent
  const welcomeRewardPaid = payouts.welcomeBonus.granted

  const openJobs = jobs.filter((j) => j.status === 'open' && j.slotsRemaining > 0)
  const activeApps = applications.filter(
    (a) => !['completed', 'rejected', 'failed_qa'].includes(a.status),
  )

  const stats = [
    {
      label: 'Withdrawable',
      value: formatUsd(payouts.withdrawableUsd),
      sub: payouts.heldUsd > 0 ? `${formatUsd(payouts.heldUsd)} held by a request` : `≈ ${formatKes(payouts.withdrawableUsd)}`,
      icon: WalletIcon,
      money: true,
      subMoney: true,
    },
    {
      label: 'Pending (clearing)',
      value: formatUsd(wallet.pendingUsd),
      sub: walletMeta.nextClearingAt
        ? `Next clears ${new Date(walletMeta.nextClearingAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
        : `Clears after ${walletMeta.clearingHours}h`,
      icon: CheckCircle2,
      money: true,
      subMoney: false,
    },
    {
      label: 'Quality score',
      value: `${worker.qualityScore}`,
      sub: 'Good standing',
      icon: Star,
      money: false,
      subMoney: false,
    },
  ]

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

      {/* Hero / wallet summary */}
      <section className="overflow-hidden rounded-2xl bg-primary text-primary-foreground">
        <div className="flex flex-col gap-6 p-5 sm:p-8 md:grid md:grid-cols-2">
          <div className="flex flex-col justify-center">
            <p className="text-sm font-medium text-primary-foreground/70">
              Welcome back, {worker.name && worker.name !== 'Loading…' ? worker.name.split(' ')[0] : 'there'}
            </p>
            <h1 className="mt-2 text-pretty text-2xl font-semibold leading-tight sm:text-4xl">
              Real, verified work. Paid to your mobile money.
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-primary-foreground/80">
              Browsing and applying is always free. You only ever get paid — never
              charged to apply or verify your identity.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
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
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {/* The switch that hides every balance on the site, so the numbers can be covered
                without hunting for it in a menu. */}
            <div className="flex justify-end">
              <BalanceToggle className="bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {stats.map((s) => {
                const Icon = s.icon
                return (
                  <div
                    key={s.label}
                    className="rounded-xl bg-primary-foreground/10 p-4 backdrop-blur first:col-span-2"
                  >
                    <Icon className="size-5 text-primary-foreground/70" />
                    <p className="mt-3 font-mono text-2xl font-semibold">
                      {s.money ? <MaskedValue value={s.value} /> : s.value}
                    </p>
                    <p className="text-xs text-primary-foreground/70">{s.label}</p>
                    <p className="mt-0.5 text-xs text-primary-foreground/60">
                      {s.subMoney ? <MaskedValue value={s.sub} /> : s.sub}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

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
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {openJobs.slice(0, 3).map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      </section>
    </div>
  )
}
