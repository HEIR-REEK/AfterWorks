'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock,
  Loader2,
  PenLine,
  Send,
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
  type ApplicationStatus,
} from '@/lib/afterworks-data'

/** Application states that have (or had) a live work window — these link into the workspace. */
const WORK_STATUSES: ApplicationStatus[] = ['approved', 'in_progress', 'revision_requested', 'submitted_for_review']

function entryMeta(entry: { kind: string; status: string; jobTitle?: string }) {
  if (entry.kind === 'withdrawal') {
    if (entry.status === 'processing')
      return { label: 'Sending to mobile money', tone: 'warning' as const, icon: Send }
    if (entry.status === 'sent')
      return { label: 'Sent to mobile money', tone: 'success' as const, icon: CheckCircle2 }
    if (entry.status === 'failed')
      return { label: 'Returned to your balance', tone: 'neutral' as const, icon: Clock }
    return { label: entry.status.replace(/_/g, ' '), tone: 'neutral' as const, icon: Send }
  }
  if (entry.status === 'pending') return { label: 'Cleared — in clearing window', tone: 'warning' as const, icon: Clock }
  if (entry.status === 'cleared') return { label: 'Cleared into your balance', tone: 'success' as const, icon: Banknote }
  return { label: entry.status.replace(/_/g, ' '), tone: 'neutral' as const, icon: Banknote }
}

function when(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DashboardPage() {
  const {
    worker,
    wallet,
    walletMeta,
    jobs,
    applications,
    getJob,
    requestWithdrawal,
    pending,
    mode,
  } = useAfterWorks()
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  const openJobs = jobs.filter((j) => j.status === 'open' && j.slotsRemaining > 0)
  const activeApps = applications.filter(
    (a) => !['completed', 'rejected', 'failed_qa', 'withdrawn'].includes(a.status),
  )
  const workApps = activeApps.filter((a) => WORK_STATUSES.includes(a.status))
  const canWithdraw = mode === 'live' && wallet.availableUsd >= walletMeta.minWithdrawalUsd
  const busy = Boolean(pending['wallet:withdraw'])
  const recent = walletMeta.entries.slice(0, 6)
  const lastPayment = recent.find((e) => e.kind === 'earning')

  const pendingSub = walletMeta.nextClearingAt
    ? `Next clearing ${when(walletMeta.nextClearingAt)}`
    : `Clears in up to ${walletMeta.clearingHours}h`

  const stats = [
    {
      label: 'Available balance',
      value: formatUsd(wallet.availableUsd),
      sub: `≈ ${formatKes(wallet.availableUsd)} · withdrawable`,
      icon: WalletIcon,
    },
    {
      label: 'Pending (clearing)',
      value: formatUsd(wallet.pendingUsd),
      sub: pendingSub,
      icon: CheckCircle2,
    },
    {
      label: 'Quality score',
      value: `${worker.qualityScore}`,
      sub: `${worker.jobsCompleted} job${worker.jobsCompleted === 1 ? '' : 's'} completed`,
      icon: Star,
    },
  ]

  async function handleWithdraw() {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setWithdrawError('Enter an amount greater than zero.')
      return
    }
    setWithdrawError(null)
    const result = await requestWithdrawal(value)
    if (result.ok) {
      setWithdrawOpen(false)
      setAmount('')
    } else if (result.error) {
      setWithdrawError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
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
                className="w-full bg-primary-foreground text-primary hover:bg-primary-foreground/90 sm:w-auto"
              >
                Browse open jobs
                <ArrowRight className="size-4" />
              </Button>
              {workApps.length > 0 && (
                <Button
                  render={<Link href="/work" />}
                  size="lg"
                  variant="outline"
                  className="w-full border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 sm:w-auto"
                >
                  <PenLine className="size-4" />
                  My work
                </Button>
              )}
            </div>
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
                  <p className="mt-3 font-mono text-2xl font-semibold">{s.value}</p>
                  <p className="text-xs text-primary-foreground/70">{s.label}</p>
                  <p className="mt-0.5 text-xs text-primary-foreground/60">{s.sub}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Payments & wallet activity */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Payments & activity</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {lastPayment
                ? `Latest payment: ${formatUsd(lastPayment.amountUsd)} · ${when(lastPayment.createdAt)}`
                : 'Payments appear here as soon as your work is approved and paid.'}
            </p>
          </div>
          {canWithdraw && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setWithdrawOpen((v) => !v)}
              disabled={busy}
            >
              {withdrawOpen ? <Clock className="size-3.5" /> : <Send className="size-3.5" />}
              Withdraw to mobile money
            </Button>
          )}
        </div>

        {withdrawOpen && (
          <div className="mt-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Amount (USD)
                <input
                  type="number"
                  inputMode="decimal"
                  min={walletMeta.minWithdrawalUsd}
                  max={wallet.availableUsd}
                  step={0.01}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`Min ${formatUsd(walletMeta.minWithdrawalUsd)}`}
                  className="w-44 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              <Button size="sm" onClick={handleWithdraw} disabled={busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                Request payout
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAmount(String(wallet.availableUsd))}>
                Max {formatUsd(wallet.availableUsd)}
              </Button>
              <p className="basis-full text-xs text-muted-foreground sm:ml-auto sm:basis-auto">
                Paid to <span className="font-mono">{wallet.payoutNumber || 'your mobile money number'}</span> within
                24 hours of processing.
              </p>
            </div>
            {withdrawError && <p className="mt-2 text-xs font-medium text-destructive">{withdrawError}</p>}
          </div>
        )}

        {recent.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No money movements yet. When work passes QA and is paid, the amount lands here and in
            your pending balance.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card">
            {recent.map((entry) => {
              const meta = entryMeta(entry)
              const Icon = meta.icon
              const earning = entry.kind !== 'withdrawal'
              return (
                <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                      earning ? 'bg-success/10 text-success' : 'bg-accent text-accent-foreground'
                    }`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {entry.jobTitle || (earning ? 'Work payment' : 'Withdrawal')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {meta.label} · {when(entry.createdAt)}
                      {entry.status === 'pending' && entry.clearedAt ? ` · clears ${when(entry.clearedAt)}` : ''}
                    </p>
                  </div>
                  <p
                    className={`font-mono text-sm font-semibold tabular-nums ${
                      earning ? 'text-success' : 'text-foreground'
                    }`}
                  >
                    {earning ? '+' : '−'}
                    {formatUsd(entry.amountUsd)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Active work */}
      {workApps.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">My work</h2>
            <Link href="/work" className="text-sm font-medium text-primary hover:underline">
              Open workspace
            </Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {workApps.map((app) => {
              const job = getJob(app.jobId)
              const title = job?.title || app.jobTitle || 'Assigned work'
              const pay = job?.payAmountUsd ?? app.payAmountUsd ?? 0
              return (
                <Link
                  key={app.id}
                  href={`/work/${app.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{title}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{formatUsd(pay)}</p>
                  </div>
                  <StatusBadge tone={APPLICATION_TONE[app.status] ?? 'neutral'}>
                    {APPLICATION_LABELS[app.status]}
                  </StatusBadge>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Active applications (review-stage only — work-stage is above) */}
      {activeApps.length - workApps.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Applications in review</h2>
            <Link href="/applications" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {activeApps
              .filter((app) => !WORK_STATUSES.includes(app.status))
              .map((app) => {
                const job = getJob(app.jobId)
                if (!job) return null
                return (
                  <Link
                    key={app.id}
                    href="/applications"
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{job.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {formatUsd(job.payAmountUsd)}
                      </p>
                    </div>
                    <StatusBadge tone={APPLICATION_TONE[app.status] ?? 'neutral'}>
                      {APPLICATION_LABELS[app.status]}
                    </StatusBadge>
                  </Link>
                )
              })}
          </div>
        </section>
      )}

      {activeApps.length === 0 && (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">My work & applications</h2>
          </div>
          <p className="mt-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing in flight. Browse jobs, and once you are approved the work opens in your
            workspace.
          </p>
        </section>
      )}

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
