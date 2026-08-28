'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Clock3,
  DollarSign,
  FileCheck2,
  ListChecks,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'
import { adminApi, useAdminSession } from '@/lib/admin'
import { AdminCard, AdminStat, LiveDot } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { formatKes, formatUsd } from '@/lib/afterworks-data'
import { site } from '@/lib/site'
import { cn } from '@/lib/utils'

/**
 * Console overview.
 *
 * This page used to open six live Firestore listeners (every user document, every application, every
 * payment, every log line) to render eight numbers, and then recompute them in the browser on every
 * snapshot tick. That is expensive for the project, slow on a laptop with 20k users, and it ships the
 * entire member table to a browser tab. Now the server aggregates behind a 20s cache and the page
 * polls, so the numbers are consistent between tabs and cost one request.
 */

type Stats = {
  totals: { users: number; kycVerified: number; kycPending: number; suspended: number }
  jobs: { open: number; paused: number; closed: number; totalSlots: number; filledSlots: number }
  applications: { total: number; underReview: number; active: number; completed: number; rejected: number }
  money: { liabilityUsd: number; pendingUsd: number; availableUsd: number; revenueKes: number; paidOutKes: number }
  payments: { successful: number; pending: number; failed: number; last7dVolumeKes: number }
  security: {
    failedLogins24h: number
    lockouts: { tracked: number; totalAttempts: number; totalBlocked: number; locked: { key: string; until: number }[] }
    posture: { id: string; label: string; severity: 'pass' | 'warn' | 'fail'; detail: string; fix?: string }[]
  }
  activity: { id: string; label: string; at: string; tone: string }[]
  maintenance: {
    enabled: boolean
    title: string
    message: string
    estimatedEnd: string | null
    mode: string
    updatedBy?: string
    updatedAt: string | null
  }
  maintenanceStatus: { active: boolean; bannerOnly: boolean; retryAfterSec: number; remainingMs: number | null }
  generatedAt: string
}

const REFRESH_MS = 60_000

export default function AdminOverviewPage() {
  const session = useAdminSession()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  const load = useCallback(async (refresh = false) => {
    if (!refresh) setLoading(true)
    try {
      const data = await adminApi.stats(refresh)
      setStats(data as unknown as Stats)
      setError(null)
      setUpdatedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Metrics unavailable.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session.status !== 'authorized') return
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [session.status, load])

  const issues = useMemo(() => (stats?.security.posture ?? []).filter((c) => c.severity !== 'pass'), [stats])
  const slotFill = stats && stats.jobs.totalSlots > 0 ? Math.round((stats.jobs.filledSlots / stats.jobs.totalSlots) * 100) : 0

  return (
    <div className="flex flex-col gap-5">
      {/* Status strip */}
      <div
        className={cn(
          'flex flex-col gap-4 rounded-2xl border p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5',
          stats?.maintenanceStatus.active ? 'border-amber-500/40 bg-amber-500/[0.08]' : 'border-border bg-card',
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn('rounded-xl p-2.5', stats?.maintenanceStatus.active ? 'bg-amber-500/20 text-amber-600' : 'bg-success/12 text-success')}>
            {stats?.maintenanceStatus.active ? <Wrench className="size-6 animate-pulse" /> : <CheckCircle2 className="size-6" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              {stats?.maintenanceStatus.active ? 'Maintenance blackout is live' : 'Platform operational'}
            </h1>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {stats?.maintenanceStatus.active
                ? `${stats.maintenance.title}. Traffic outside the console is being answered with 503 + Retry-After${
                    stats.maintenance.estimatedEnd ? ` until ${new Date(stats.maintenance.estimatedEnd).toLocaleString()}` : ''
                  }.`
                : `All members can sign in, apply, submit work and get paid. Signed in as ${session.email ?? 'staff'} — metrics refresh every ${REFRESH_MS / 1000}s.`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone={stats?.maintenanceStatus.active ? 'warning' : 'success'}>
                {stats?.maintenanceStatus.active ? 'Blocking' : 'Live'}
              </StatusBadge>
              {issues.length > 0 && (
                <StatusBadge tone={issues.some((i) => i.severity === 'fail') ? 'danger' : 'warning'}>
                  <ShieldAlert className="size-3" />
                  {issues.length} security {issues.length === 1 ? 'note' : 'notes'}
                </StatusBadge>
              )}
              {updatedAt && <LiveDot tone="success" label={`refreshed ${new Date(updatedAt).toLocaleTimeString()}`} />}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button render={<Link href="/admin/maintenance" />} size="sm" className="gap-1.5">
            <Wrench className="size-3.5" />
            Maintenance
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="mt-1 opacity-90">
              Metrics come from the server. If the datastore is not configured on this deployment, check{' '}
              <code className="font-mono">FIREBASE_SERVICE_ACCOUNT_JSON</code>.
            </p>
          </div>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStat label="Members" value={stats?.totals.users ?? '—'} sub={`${stats?.totals.kycVerified ?? 0} verified · ${stats?.totals.kycPending ?? 0} pending`} icon={<Users className="size-4" />} />
        <AdminStat
          label="Platform liability"
          value={formatUsd(stats?.money.liabilityUsd ?? 0)}
          sub={`≈ ${formatKes(stats?.money.liabilityUsd ?? 0)} owed to workers`}
          icon={<Wallet className="size-4" />}
          tone="primary"
        />
        <AdminStat
          label="In review"
          value={stats?.applications.underReview ?? '—'}
          sub={`${stats?.applications.active ?? 0} active applications`}
          icon={<ListChecks className="size-4" />}
          tone={(stats?.applications.underReview ?? 0) > 25 ? 'warning' : 'default'}
        />
        <AdminStat
          label="Training revenue (7d)"
          value={`KES ${(stats?.payments.last7dVolumeKes ?? 0).toLocaleString()}`}
          sub={`${stats?.payments.successful ?? 0} successful charges total`}
          icon={<DollarSign className="size-4" />}
          tone="success"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Queues */}
        <AdminCard title="Work queues" description="What needs a human decision today." icon={<Clock3 className="size-4" />}>
          <ul className="flex flex-col divide-y divide-border/60">
            <QueueRow
              label="KYC awaiting decision"
              value={stats?.totals.kycPending ?? 0}
              href="/admin/users?state=kyc_on_hold"
              tone={stats && stats.totals.kycPending > 10 ? 'warning' : 'neutral'}
              hint="Verify or decline from Users & KYC."
            />
            <QueueRow label="Applications to triage" value={stats?.applications.underReview ?? 0} href="/admin/applications?status=under_review" tone="neutral" hint="Approve reserves a slot." />
            <QueueRow label="Submissions in QA" value={Math.max(0, (stats?.applications.active ?? 0) - (stats?.applications.underReview ?? 0))} href="/admin/applications" tone="neutral" hint="Approving pays the worker." />
            <QueueRow label="Restricted accounts" value={stats?.totals.suspended ?? 0} href="/admin/users?state=suspended" tone={stats && stats.totals.suspended > 0 ? 'danger' : 'neutral'} hint="Suspended or banned." />
          </ul>
        </AdminCard>

        {/* Catalogue */}
        <AdminCard
          title="Job catalogue"
          description="Live slots and payout exposure."
          icon={<Briefcase className="size-4" />}
          actions={
            <Button render={<Link href="/admin/jobs" />} variant="outline" size="sm">
              Manage
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              {(['open', 'paused', 'closed'] as const).map((key) => (
                <div key={key} className="rounded-xl border border-border/70 bg-background/60 p-2.5">
                  <p className="font-mono text-lg font-semibold tabular">{stats?.jobs[key] ?? 0}</p>
                  <p className="text-[11px] capitalize text-muted-foreground">{key}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Slot fill</span>
                <span className="font-mono">
                  {stats?.jobs.filledSlots ?? 0}/{stats?.jobs.totalSlots ?? 0} · {slotFill}%
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div className={cn('h-full rounded-full transition-all', slotFill > 85 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, slotFill)}%` }} />
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Completed work pays {formatUsd(stats?.money.pendingUsd ?? 0)} pending + {formatUsd(stats?.money.availableUsd ?? 0)} available.{' '}
              {site.payoutSla}
            </p>
          </div>
        </AdminCard>

        {/* Security */}
        <AdminCard
          title="Security notes"
          description="Posture the server can actually verify."
          icon={<ShieldAlert className="size-4" />}
          actions={
            <Button render={<Link href="/admin/security" />} variant="outline" size="sm">
              Open
            </Button>
          }
        >
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="size-4" />
              No outstanding configuration warnings.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {issues.slice(0, 3).map((issue) => (
                <li key={issue.id} className="flex items-start gap-2 rounded-xl border border-border/70 bg-background/50 p-2.5">
                  <span className={cn('mt-1 size-2 shrink-0 rounded-full', issue.severity === 'fail' ? 'bg-destructive' : 'bg-warning')} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{issue.label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{issue.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
            <span>
              Failed sign-ins (ledger): <strong className="font-mono text-foreground">{stats?.security.failedLogins24h ?? 0}</strong>
            </span>
            <span>
              Address lockouts: <strong className="font-mono text-foreground">{stats?.security.lockouts.locked.length ?? 0}</strong>
            </span>
          </div>
        </AdminCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AdminCard
          className="lg:col-span-2"
          title="Payments & training"
          description="Charges verified by Paystack, from the server ledger."
          icon={<FileCheck2 className="size-4" />}
          actions={
            <Button render={<Link href="/status" />} variant="ghost" size="sm" className="gap-1.5">
              <Activity className="size-3.5" />
              Feed
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Successful" value={stats?.payments.successful ?? 0} tone="success" />
            <MiniStat label="Pending" value={stats?.payments.pending ?? 0} tone="warning" />
            <MiniStat label="Failed" value={stats?.payments.failed ?? 0} tone="danger" />
            <MiniStat label="Lifetime" value={`KES ${(stats?.money.revenueKes ?? 0).toLocaleString()}`} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Training revenue is KES-denominated; worker earnings are USD and settle through mobile money. Payouts issued for completed work:{' '}
            <span className="font-mono">KES {(stats?.money.paidOutKes ?? 0).toLocaleString()}</span>.
          </p>
        </AdminCard>

        <AdminCard title="Recent console activity" description="Tail of the audit ledger." icon={<ScrollText className="size-4" />}>
          {(stats?.activity.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">No console actions recorded yet. Every moderation, payout and maintenance change will appear here.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stats!.activity.slice(0, 7).map((row) => (
                <li key={row.id} className="flex items-start gap-2 text-[11px]">
                  <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', row.tone === 'danger' ? 'bg-destructive' : row.tone === 'success' ? 'bg-success' : 'bg-primary/60')} />
                  <div className="min-w-0">
                    <p className="truncate text-foreground">{row.label}</p>
                    <p className="text-muted-foreground">{row.at ? new Date(row.at).toLocaleString() : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button render={<Link href="/admin/audit-log" />} variant="ghost" size="sm" className="mt-3 w-full justify-center gap-1.5">
            Full audit log
            <ArrowRight className="size-3.5" />
          </Button>
        </AdminCard>
      </div>
    </div>
  )
}

function QueueRow({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string
  value: number
  hint: string
  href: string
  tone: 'neutral' | 'warning' | 'danger'
}) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-muted/40">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-lg px-2 py-1 font-mono text-sm font-semibold tabular',
            tone === 'warning' && 'bg-warning/15 text-warning-foreground',
            tone === 'danger' && 'bg-destructive/10 text-destructive',
            tone === 'neutral' && 'bg-secondary text-secondary-foreground',
          )}
        >
          {value}
        </span>
      </Link>
    </li>
  )
}

function MiniStat({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-2.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 font-mono text-base font-semibold tabular',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          tone === 'danger' && 'text-destructive',
        )}
      >
        {value}
      </p>
    </div>
  )
}
