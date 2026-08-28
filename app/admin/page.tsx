'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  FileCheck,
  ListChecks,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react'
import {
  subscribeToAllUsers,
  subscribeToJobs,
  subscribeToAllApplications,
  subscribeToAdminAuditLogs,
  subscribeToMaintenanceConfig,
  subscribeToTransactions,
  saveJobToFirestore,
  createAdminAuditLog,
  type UserDocument,
  type AdminAuditLog,
  type MaintenanceConfig,
  type PaymentTransaction,
  DEFAULT_MAINTENANCE_CONFIG,
} from '@/lib/firestore'
import {
  seedJobs,
  formatUsd,
  formatKes,
  type Job,
  type Application,
} from '@/lib/afterworks-data'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/firebase-auth-provider'

export default function AdminOverviewPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<UserDocument[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([])
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([])
  const [maintenance, setMaintenance] = useState<MaintenanceConfig>(DEFAULT_MAINTENANCE_CONFIG)
  const [seeding, setSeeding] = useState(false)
  const [seedSuccess, setSeedSuccess] = useState(false)

  // Real-time subscriptions
  useEffect(() => {
    const unsubUsers = subscribeToAllUsers(setUsers)
    const unsubJobs = subscribeToJobs(setJobs)
    const unsubApps = subscribeToAllApplications(setApplications)
    const unsubLogs = subscribeToAdminAuditLogs(setAuditLogs)
    const unsubMaint = subscribeToMaintenanceConfig(setMaintenance)
    const unsubTxs = subscribeToTransactions(setTransactions)

    return () => {
      unsubUsers()
      unsubJobs()
      unsubApps()
      unsubLogs()
      unsubMaint()
      unsubTxs()
    }
  }, [])

  // Aggregate metrics
  const totalUsers = users.length
  const kycVerifiedUsers = users.filter((u) => u.kycVerified === true).length
  const kycRate = totalUsers > 0 ? Math.round((kycVerifiedUsers / totalUsers) * 100) : 0
  const activeUsers = users.filter((u) => u.accountState === 'active').length

  const totalPendingUsd = users.reduce((acc, u) => acc + (u.wallet?.pendingUsd || 0), 0)
  const totalAvailableUsd = users.reduce((acc, u) => acc + (u.wallet?.availableUsd || 0), 0)
  const totalPlatformLiability = totalPendingUsd + totalAvailableUsd

  const openJobs = jobs.filter((j) => j.status === 'open').length
  const pausedJobs = jobs.filter((j) => j.status === 'paused').length

  const pendingApps = applications.filter((a) => a.status === 'under_review').length
  const approvedApps = applications.filter((a) => a.status === 'approved' || a.status === 'in_progress').length
  const completedApps = applications.filter((a) => a.status === 'completed').length
  const rejectedApps = applications.filter((a) => a.status === 'rejected' || a.status === 'failed_qa').length

  const totalPaymentsVolumeKes = transactions
    .filter((t) => t.status === 'success')
    .reduce((acc, t) => acc + (t.amountKes || 0), 0)



  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* Maintenance Status Banner */}
      {maintenance.enabled ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-500/20 p-2 text-amber-600 dark:text-amber-400">
              <Wrench className="size-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-700 dark:text-amber-400">
                  SYSTEM MAINTENANCE MODE ACTIVE
                </span>
                <span className="size-2 rounded-full bg-amber-500 animate-ping" />
              </div>
              <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
                Non-admin users are currently seeing the maintenance screen.
                {maintenance.estimatedEnd && ` Estimated return: ${new Date(maintenance.estimatedEnd).toLocaleString()}`}
              </p>
            </div>
          </div>
          <Button
            render={<Link href="/admin/maintenance" />}
            size="sm"
            className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
          >
            Configure Maintenance
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-card p-3.5 px-4 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2.5 rounded-full bg-success animate-pulse" />
            <span>Platform Status: <strong className="text-foreground">Live & Operational</strong></span>
          </div>
          <Link href="/admin/maintenance" className="font-semibold text-primary hover:underline">
            Manage Maintenance Mode →
          </Link>
        </div>
      )}

      {/* Primary KPI Grid */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Users */}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm transition-all hover:border-primary/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Registered Users
            </span>
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <Users className="size-4" />
            </div>
          </div>
          <p className="mt-3 font-mono text-3xl font-bold text-foreground">{totalUsers}</p>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{activeUsers} active accounts</span>
            <Link href="/admin/users" className="text-primary hover:underline font-medium">
              Manage users
            </Link>
          </div>
        </div>

        {/* KYC Verified */}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm transition-all hover:border-primary/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              KYC Verification
            </span>
            <div className="rounded-xl bg-success/15 p-2 text-success">
              <ShieldCheck className="size-4" />
            </div>
          </div>
          <p className="mt-3 font-mono text-3xl font-bold text-foreground">{kycVerifiedUsers}</p>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-success">{kycRate}% of user base verified</span>
            <span>Didit integrated</span>
          </div>
        </div>

        {/* Open Jobs */}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm transition-all hover:border-primary/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Jobs In Catalog
            </span>
            <div className="rounded-xl bg-accent/20 p-2 text-foreground">
              <Briefcase className="size-4" />
            </div>
          </div>
          <p className="mt-3 font-mono text-3xl font-bold text-foreground">{jobs.length}</p>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{openJobs} Open • {pausedJobs} Paused</span>
            <Link href="/admin/jobs" className="text-primary hover:underline font-medium">
              Manage jobs
            </Link>
          </div>
        </div>

        {/* Platform Balances */}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm transition-all hover:border-primary/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Wallet Liability
            </span>
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <DollarSign className="size-4" />
            </div>
          </div>
          <p className="mt-3 font-mono text-2xl sm:text-3xl font-bold text-foreground">
            {formatUsd(totalPlatformLiability)}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Avail: {formatUsd(totalAvailableUsd)}</span>
            <span>Pend: {formatUsd(totalPendingUsd)}</span>
          </div>
        </div>
      </section>

      {/* Applications & Quick Actions Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Applications Breakdown */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ListChecks className="size-5 text-primary" />
                <h2 className="text-base font-bold text-foreground">Applications Lifecycle</h2>
              </div>
              <Link href="/admin/applications" className="text-xs font-semibold text-primary hover:underline">
                View all ({applications.length}) →
              </Link>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5 text-info" />
                  <span>Pending Review</span>
                </div>
                <p className="mt-2 font-mono text-2xl font-bold text-foreground">{pendingApps}</p>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileCheck className="size-3.5 text-primary" />
                  <span>In Progress</span>
                </div>
                <p className="mt-2 font-mono text-2xl font-bold text-foreground">{approvedApps}</p>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-success" />
                  <span>Completed</span>
                </div>
                <p className="mt-2 font-mono text-2xl font-bold text-success">{completedApps}</p>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <XCircle className="size-3.5 text-destructive" />
                  <span>Rejected / Failed</span>
                </div>
                <p className="mt-2 font-mono text-2xl font-bold text-destructive">{rejectedApps}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Admin Actions */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div>
            <h2 className="text-base font-bold text-foreground">Administrative Actions</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Direct access to system operations
            </p>

            <div className="mt-4 flex flex-col gap-2.5">
              <Link
                href="/admin/users"
                className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 p-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <div className="flex items-center gap-2.5">
                  <Users className="size-4 text-primary" />
                  <span>Inspect & Manage Users</span>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </Link>

              <Link
                href="/admin/jobs"
                className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 p-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <div className="flex items-center gap-2.5">
                  <Briefcase className="size-4 text-primary" />
                  <span>Add / Edit Job Postings</span>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </Link>

              <Link
                href="/admin/applications"
                className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 p-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <div className="flex items-center gap-2.5">
                  <ListChecks className="size-4 text-primary" />
                  <span>Review Submissions & QA</span>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </Link>

              <Link
                href="/admin/maintenance"
                className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 p-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <div className="flex items-center gap-2.5">
                  <Wrench className="size-4 text-amber-500" />
                  <span>Maintenance Mode Controls</span>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </Link>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-border/60 bg-muted/10 p-3 text-[11px] text-muted-foreground">
            🔒 All administrative actions are recorded in the immutable audit log.
          </div>
        </div>
      </div>

      {/* Real Payment Transactions Feed */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="size-5 text-primary" />
            <h2 className="text-base font-bold text-foreground">Real Payment Activity (Paystack)</h2>
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            Settled Volume: <strong className="text-foreground font-bold">KES {totalPaymentsVolumeKes.toLocaleString()}</strong>
          </span>
        </div>

        {transactions.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No live payment transactions recorded yet. Real training payments processed via Paystack will stream here live.
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border/60">
            {transactions.slice(0, 5).map((tx) => (
              <div key={tx.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${
                      tx.status === 'success'
                        ? 'bg-success/15 text-success'
                        : tx.status === 'failed'
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-amber-500/15 text-amber-600'
                    }`}
                  >
                    {tx.status.toUpperCase()}
                  </span>
                  <span className="truncate text-muted-foreground">
                    <strong className="text-foreground">{tx.email}</strong> • Ref: <span className="font-mono text-foreground">{tx.reference}</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground shrink-0">
                  <span className="font-bold text-foreground">
                    KES {tx.amountKes?.toLocaleString() ?? 0}
                  </span>
                  <span>{new Date(tx.createdAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Admin Audit Logs Feed */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScrollText className="size-5 text-primary" />
            <h2 className="text-base font-bold text-foreground">Recent Audit Log Activity</h2>
          </div>
          <Link href="/admin/audit-log" className="text-xs font-semibold text-primary hover:underline">
            View full log ({auditLogs.length}) →
          </Link>
        </div>

        {auditLogs.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No audit logs recorded yet. Changes made in the admin console will appear here in real-time.
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border/60">
            {auditLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground shrink-0">
                    {log.action}
                  </span>
                  <span className="truncate text-muted-foreground">
                    by <strong className="text-foreground">{log.actorEmail || 'Admin'}</strong>
                  </span>
                </div>
                <div className="text-[11px] font-mono text-muted-foreground shrink-0">
                  {new Date(log.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
