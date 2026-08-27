'use client'

import { useMemo, useState } from 'react'
import {
  BadgeCheck,
  XCircle,
  ClipboardList,
  Play,
  Redo2,
  Undo2,
} from 'lucide-react'
import { useAdminApplications, useAdminJobs } from '@/components/admin/data-hooks'
import {
  AdminCard,
  AdminSectionHeader,
  EmptyState,
  ReasonInput,
  StatCard,
} from '@/components/admin/ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import {
  APPLICATION_LABELS,
  APPLICATION_TONE,
  formatUsd,
  type StatusTone,
} from '@/lib/afterworks-data'
import { APPLICATION_ACTIONS, formatDateTime, timeAgo, type AdminApplication } from '@/lib/admin-data'

/** Icon + tone per lifecycle action. */
const ACTION_META: Record<string, { icon: React.ComponentType<{ className?: string }>; variant: 'default' | 'outline' | 'destructive' | 'secondary'; label: string }> = {
  approve: { icon: BadgeCheck, variant: 'default', label: 'Approve (reserve slot)' },
  reject: { icon: XCircle, variant: 'destructive', label: 'Reject' },
  start_work: { icon: Play, variant: 'outline', label: 'Mark in progress' },
  submit_review: { icon: Redo2, variant: 'outline', label: 'Submit for QA' },
  complete: { icon: BadgeCheck, variant: 'default', label: 'Pass QA & pay' },
  request_revision: { icon: Undo2, variant: 'outline', label: 'Request revision' },
  fail_qa: { icon: XCircle, variant: 'destructive', label: 'Fail QA' },
}

function ApplicationCard({
  app,
  jobTitle,
  jobPay,
  onAct,
}: {
  app: AdminApplication
  jobTitle: string
  jobPay?: number
  onAct: (id: string, action: string, note?: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [mode, setMode] = useState<'idle' | 'reject' | 'revision'>('idle')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const actions = APPLICATION_ACTIONS[app.status] ?? []

  async function run(action: string) {
    setError(null)
    if ((action === 'reject' || action === 'request_revision') && !note.trim()) {
      setError('Please provide a note.')
      return
    }
    setBusy(true)
    const res = await onAct(app.id, action, note.trim() || undefined)
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Action failed.')
    else {
      setNote('')
      setMode('idle')
    }
  }

  return (
    <AdminCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{jobTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {app.userName || app.userId} · applied {timeAgo(app.appliedAt)}
            {jobPay !== undefined ? ` · ${formatUsd(jobPay)}` : ''}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {app.id} · review window ends {formatDateTime(app.reviewExpiresAt)}
          </p>
        </div>
        <StatusBadge tone={APPLICATION_TONE[app.status] as StatusTone}>
          {APPLICATION_LABELS[app.status]}
        </StatusBadge>
      </div>

      {app.rejectionReason && (
        <p className="mt-3 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Rejection reason: {app.rejectionReason}
        </p>
      )}
      {app.revisionNote && (
        <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
          Revision requested: {app.revisionNote}
        </p>
      )}

      {actions.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {mode !== 'idle' && (
            <ReasonInput
              value={note}
              onChange={setNote}
              error={error}
              placeholder={
                mode === 'reject'
                  ? 'Why is this application rejected? (shown to the worker)'
                  : 'What needs fixing before resubmission?'
              }
            />
          )}
          {mode === 'idle' && error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const meta = ACTION_META[action]
              const Icon = meta.icon
              if ((action === 'reject' || action === 'request_revision') && mode === 'idle') {
                return (
                  <Button
                    key={action}
                    size="sm"
                    variant={meta.variant}
                    disabled={busy}
                    onClick={() => setMode(action as 'reject' | 'revision')}
                  >
                    <Icon className="size-3.5" />
                    {meta.label}
                  </Button>
                )
              }
              if ((action === 'reject' || action === 'request_revision') && mode !== 'idle') {
                const isThis = (mode === 'reject' && action === 'reject') || (mode === 'revision' && action === 'request_revision')
                if (!isThis) return null
                return (
                  <Button key={action} size="sm" variant={meta.variant} disabled={busy} onClick={() => run(action)}>
                    <Icon className="size-3.5" />
                    {busy ? 'Working…' : `Confirm ${meta.label.toLowerCase()}`}
                  </Button>
                )
              }
              return (
                <Button key={action} size="sm" variant={meta.variant} disabled={busy} onClick={() => run(action)}>
                  <Icon className="size-3.5" />
                  {busy ? 'Working…' : meta.label}
                </Button>
              )
            })}
            {mode !== 'idle' && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode('idle')}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </AdminCard>
  )
}

export default function AdminApplicationsPage() {
  const { items, loading, error, act } = useAdminApplications()
  const { jobs } = useAdminJobs()
  const [filter, setFilter] = useState<'active' | 'all'>('active')

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => (b.appliedAt ?? '').localeCompare(a.appliedAt ?? ''))
    if (filter === 'active') {
      return sorted.filter((a) => !['completed', 'rejected', 'failed_qa'].includes(a.status))
    }
    return sorted
  }, [items, filter])

  const stats = useMemo(
    () => ({
      underReview: items.filter((a) => a.status === 'under_review').length,
      inProgress: items.filter((a) => ['approved', 'in_progress'].includes(a.status)).length,
      qa: items.filter((a) => ['submitted_for_review', 'revision_requested'].includes(a.status)).length,
      completed: items.filter((a) => a.status === 'completed').length,
    }),
    [items],
  )

  async function handleAct(id: string, action: string, note?: string) {
    return act(id, action, note)
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title="Applications"
        description="Drive the full review → work → QA lifecycle. Approving reserves a slot; QA pass pays the worker."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Under review" value={loading ? '…' : stats.underReview} icon={ClipboardList} tone="warning" />
        <StatCard label="Approved / working" value={loading ? '…' : stats.inProgress} icon={Play} />
        <StatCard label="In QA" value={loading ? '…' : stats.qa} icon={Redo2} />
        <StatCard label="Completed & paid" value={loading ? '…' : stats.completed} icon={BadgeCheck} tone="success" />
      </div>

      <div className="flex w-fit rounded-lg border border-border bg-card p-1">
        {(
          [
            ['active', 'Active pipeline'],
            ['all', `All (${items.length})`],
          ] as ['active' | 'all', string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ' +
              (filter === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading applications…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={filter === 'active' ? 'No active applications' : 'No applications yet'}
          description="Applications appear here when workers apply to jobs."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((a) => {
            const job = jobs.find((j) => j.id === a.jobId)
            return (
              <ApplicationCard
                key={a.id}
                app={a}
                jobTitle={job?.title ?? a.jobId}
                jobPay={job?.payAmountUsd}
                onAct={handleAct}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
