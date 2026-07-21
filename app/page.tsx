'use client'

import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle2,
  Star,
  Wallet as WalletIcon,
} from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { JobCard } from '@/components/job-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  APPLICATION_LABELS,
  APPLICATION_TONE,
  formatKes,
  formatUsd,
} from '@/lib/afterworks-data'

export default function DashboardPage() {
  const { worker, wallet, jobs, applications, getJob } = useAfterWorks()

  const openJobs = jobs.filter((j) => j.status === 'open' && j.slotsRemaining > 0)
  const activeApps = applications.filter(
    (a) => !['completed', 'rejected', 'failed_qa'].includes(a.status),
  )

  const stats = [
    {
      label: 'Available balance',
      value: formatUsd(wallet.availableUsd),
      sub: `≈ ${formatKes(wallet.availableUsd)}`,
      icon: WalletIcon,
    },
    {
      label: 'Pending (clearing)',
      value: formatUsd(wallet.pendingUsd),
      sub: 'Clears in 48–72h',
      icon: CheckCircle2,
    },
    {
      label: 'Quality score',
      value: `${worker.qualityScore}`,
      sub: 'Good standing',
      icon: Star,
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      {/* Hero / wallet summary */}
      <section className="overflow-hidden rounded-2xl bg-primary text-primary-foreground">
        <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-2">
          <div className="flex flex-col justify-center">
            <p className="text-sm font-medium text-primary-foreground/70">
              Welcome back, {worker.name && worker.name !== 'Loading…' ? worker.name.split(' ')[0] : 'there'}
            </p>
            <h1 className="mt-2 text-pretty text-3xl font-semibold leading-tight sm:text-4xl">
              Real, verified work. Paid to your mobile money.
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-primary-foreground/80">
              Browsing and applying is always free. You only ever get paid — never
              charged to apply or verify your identity.
            </p>
            <div className="mt-5">
              <Button
                render={<Link href="/jobs" />}
                size="lg"
                className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
              >
                Browse open jobs
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {stats.map((s) => {
              const Icon = s.icon
              return (
                <div
                  key={s.label}
                  className="rounded-xl bg-primary-foreground/10 p-4 backdrop-blur first:col-span-2"
                >
                  <Icon className="size-5 text-primary-foreground/70" />
                  <p className="mt-3 font-mono text-2xl font-semibold">{s.value}</p>
                  <p className="text-xs text-primary-foreground/70">{s.label}</p>
                  <p className="mt-0.5 text-xs text-primary-foreground/60">{s.sub}</p>
                </div>
              )
            })}
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
