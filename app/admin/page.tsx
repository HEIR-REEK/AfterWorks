'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Briefcase,
  ClipboardList,
  ShieldQuestion,
  Users,
  Wallet,
} from 'lucide-react'
import { useAdminUsers, useAdminKyc, useAdminJobs, useAdminApplications } from '@/components/admin/data-hooks'
import { useMaintenance } from '@/components/maintenance-provider'
import { AdminCard, AdminSectionHeader, StatCard, EmptyState } from '@/components/admin/ui'
import { StatusBadge } from '@/components/status-badge'
import { APPLICATION_LABELS, APPLICATION_TONE, formatUsd, type StatusTone } from '@/lib/afterworks-data'
import {
  ACCOUNT_STATE_LABELS,
  ACCOUNT_STATE_TONES,
  KYC_STATUS_LABELS,
  KYC_STATUS_TONES,
  kycNeedsAction,
  timeAgo,
} from '@/lib/admin-data'

function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      {label}
      <ArrowRight className="size-3.5" />
    </Link>
  )
}

export default function AdminOverviewPage() {
  const { users, loading: usersLoading } = useAdminUsers()
  const { items: kycItems, loading: kycLoading } = useAdminKyc()
  const { jobs, loading: jobsLoading } = useAdminJobs()
  const { items: apps, loading: appsLoading } = useAdminApplications()
  const { maintenance } = useMaintenance()

  const loading = usersLoading || kycLoading || jobsLoading || appsLoading

  const activeUsers = users.filter((u) => u.accountState === 'active').length
  const pendingKyc = kycItems.filter((k) => kycNeedsAction(k.status)).length
  const openJobs = jobs.filter((j) => j.status === 'open' && j.slotsRemaining > 0).length
  const openSlots = jobs.reduce((sum, j) => sum + (j.status === 'open' ? j.slotsRemaining : 0), 0)
  const activeApps = apps.filter(
    (a) => !['completed', 'rejected', 'failed_qa'].includes(a.status),
  ).length
  const walletTotal = users.reduce(
    (sum, u) => sum + (u.wallet?.availableUsd ?? 0) + (u.wallet?.pendingUsd ?? 0),
    0,
  )

  const recentUsers = [...users]
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 5)
  const kycQueue = kycItems.filter((k) => kycNeedsAction(k.status)).slice(0, 5)
  const recentApps = [...apps]
    .sort((a, b) => (b.appliedAt ?? '').localeCompare(a.appliedAt ?? ''))
    .slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title="Overview"
        description="Platform health at a glance."
      />

      {maintenance.enabled && (
        <div className="rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          ⚠️ Maintenance mode is currently <strong>enabled</strong> — workers see the
          maintenance page. You can turn it off in{' '}
          <Link href="/admin/settings" className="font-semibold underline underline-offset-2">
            Settings
          </Link>
          .
        </div>
      )}

      {/* Stat grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total workers"
          value={loading ? '…' : users.length}
          sub={`${activeUsers} active · ${users.length - activeUsers} need attention`}
          icon={Users}
        />
        <StatCard
          label="KYC awaiting review"
          value={loading ? '…' : pendingKyc}
          sub={pendingKyc > 0 ? 'Action required' : 'Queue is clear'}
          icon={ShieldQuestion}
          tone={pendingKyc > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Open jobs"
          value={loading ? '…' : openJobs}
          sub={`${openSlots} slots available`}
          icon={Briefcase}
        />
        <StatCard
          label="Active applications"
          value={loading ? '…' : activeApps}
          sub="In the review → QA pipeline"
          icon={ClipboardList}
        />
        <StatCard
          label="Worker wallet holdings"
          value={loading ? '…' : formatUsd(walletTotal)}
          sub="Available + pending across all workers"
          icon={Wallet}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* KYC queue */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">KYC needing review</h2>
            <SectionLink href="/admin/kyc" label="Open queue" />
          </div>
          {kycQueue.length === 0 ? (
            <EmptyState icon={ShieldQuestion} title="No KYC sessions waiting" description="New verification submissions will appear here." />
          ) : (
            <div className="flex flex-col gap-2">
              {kycQueue.map((k) => (
                <Link
                  key={k.uid}
                  href="/admin/kyc"
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{k.userName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {k.userEmail} · attempt {k.attemptCount} · {timeAgo(k.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge tone={KYC_STATUS_TONES[k.status]}>{KYC_STATUS_LABELS[k.status]}</StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Recent users */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">Newest workers</h2>
            <SectionLink href="/admin/users" label="All users" />
          </div>
          {recentUsers.length === 0 ? (
            <EmptyState icon={Users} title="No users yet" />
          ) : (
            <div className="flex flex-col gap-2">
              {recentUsers.map((u) => (
                <Link
                  key={u.uid}
                  href="/admin/users"
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                      {u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {u.email} · joined {timeAgo(u.createdAt)}
                      </p>
                    </div>
                  </div>
                  <StatusBadge tone={(ACCOUNT_STATE_TONES[u.accountState] ?? 'neutral') as StatusTone}>
                    {ACCOUNT_STATE_LABELS[u.accountState] ?? u.accountState}
                  </StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Recent applications */}
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">Latest applications</h2>
            <SectionLink href="/admin/applications" label="Manage applications" />
          </div>
          {recentApps.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No applications yet"
              description="When workers apply to jobs, their applications appear here for review."
            />
          ) : (
            <AdminCard className="p-0">
              <div className="divide-y divide-border/60">
                {recentApps.map((a) => {
                  const job = jobs.find((j) => j.id === a.jobId)
                  return (
                    <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{job?.title ?? a.jobId}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.userName || a.userId} · applied {timeAgo(a.appliedAt)}
                          {job ? ` · ${formatUsd(job.payAmountUsd)}` : ''}
                        </p>
                      </div>
                      <StatusBadge tone={APPLICATION_TONE[a.status]}>
                        {APPLICATION_LABELS[a.status]}
                      </StatusBadge>
                    </div>
                  )
                })}
              </div>
            </AdminCard>
          )}
        </section>
      </div>
    </div>
  )
}
