'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Check, CircleDollarSign, Clock3, FileCheck2, Inbox, Loader2, Play, RotateCcw, Search, X } from 'lucide-react'
import { adminApi, useAdminSession, type AdminApplicationRow } from '@/lib/admin'
import { AdminCard, LiveDot, Pager, ReasonDialog, inputClass, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import type { StatusTone } from '@/lib/afterworks-data'
import { formatUsd } from '@/lib/afterworks-data'
import {
  APPLICATION_ACTION_LABELS,
  APPLICATION_ACTION_SIDE_EFFECTS,
  REQUIRED_REASON,
  type ApplicationAction,
} from '@/lib/admin-domain'
import { cn } from '@/lib/utils'

/**
 * Applications & QA desk.
 *
 * The queue is read one page at a time from the server, and every decision goes through
 * `PATCH /api/admin/applications`, where the transition is validated against the application
 * lifecycle, the slot counter and payout credit are updated inside Firestore transactions, the
 * worker is notified, and the action is audited. The browser no longer holds a Firestore write path
 * to other people's applications — that used to be the whole of the risk.
 */

const FILTERS = [
  ['under_review', 'To triage'],
  ['submitted_for_review', 'In QA'],
  ['revision_requested', 'Awaiting resubmit'],
  ['approved', 'Approved'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['rejected', 'Declined'],
  ['all', 'Everything'],
] as const

const TONE: Record<string, StatusTone> = {
  under_review: 'info',
  draft: 'neutral',
  approved: 'info',
  in_progress: 'info',
  submitted_for_review: 'warning',
  revision_requested: 'warning',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  failed_qa: 'danger',
}

const ACTIONS_BY_STATUS: Record<string, { action: ApplicationAction; icon: typeof Check }[]> = {
  under_review: [
    { action: 'approve', icon: Check },
    { action: 'reject', icon: X },
  ],
  approved: [
    { action: 'start', icon: Play },
    { action: 'reject', icon: X },
  ],
  in_progress: [{ action: 'request_revision', icon: RotateCcw }],
  submitted_for_review: [
    { action: 'approve_qa', icon: FileCheck2 },
    { action: 'request_revision', icon: RotateCcw },
    { action: 'fail_qa', icon: X },
  ],
  revision_requested: [
    { action: 'start', icon: Play },
    { action: 'fail_qa', icon: X },
  ],
  failed_qa: [{ action: 'request_revision', icon: RotateCcw }],
}

export default function AdminApplicationsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>}>
      <ApplicationsPageInner />
    </Suspense>
  )
}

function ApplicationsPageInner() {
  const session = useAdminSession()
  const searchParams = useSearchParams()
  const { push, toasts } = useToasts()

  const [rows, setRows] = useState<AdminApplicationRow[]>([])
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<string>(searchParams.get('status') ?? 'under_review')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<{ row: AdminApplicationRow; action: ApplicationAction; bulk?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(id)
  }, [searchInput])

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true)
    try {
      const data = await adminApi.applications({ status, search, cursor: cursor ?? undefined, pageSize: 25 })
      setRows(data.rows)
      setNextCursor(data.nextCursor)
      setHasMore(data.hasMore)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the queue.')
    } finally {
      setLoading(false)
    }
  }, [status, search])

  useEffect(() => {
    if (session.status !== 'authorized') return
    void load(cursors[cursors.length - 1] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status, load, cursors.length])

  const toggle = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))

  const applyAction = async (reason: string) => {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.bulk) {
        const result = await adminApi.bulkApplicationAction({ applicationIds: selectedIds, action: pending.action, reason })
        const failed = result.results.filter((r) => !r.ok)
        push(failed.length ? 'warning' : 'success', `${result.applied} updated${failed.length ? ` · ${failed.length} refused (${failed[0]?.error ?? 'see log'})` : ''}.`)
        setSelectedIds([])
      } else {
        const result = await adminApi.applicationAction({
          applicationId: pending.row.id,
          action: pending.action,
          note: reason || undefined,
          reason: REQUIRED_REASON.includes(pending.action) ? reason : undefined,
        })
        push('success', result.message ?? 'Saved and written to the audit log.')
      }
      setPending(null)
      await load(cursors[cursors.length - 1] ?? null)
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'The decision failed; nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  const overdue = rows.filter((row) => row.overdue)
  const actionable = rows.filter((row) => (ACTIONS_BY_STATUS[row.status] ?? []).length > 0)

  return (
    <div className="flex flex-col gap-4">
      {toasts}

      <AdminCard
        title="Applications & QA"
        description="Triage, QA decisions and payouts — one transition at a time, always reasoned, always audited."
        icon={<Inbox className="size-4" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <input
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value)
                  setCursors([null])
                }}
                placeholder="Worker or job…"
                aria-label="Search applications"
                className={cn(inputClass, 'h-8 w-40 pl-8 text-xs sm:w-52')}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => void load(cursors[cursors.length - 1] ?? null)} disabled={loading} className="gap-1.5">
              <Loader2 className={cn('size-3.5', loading && 'animate-spin')} />
              Reload
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setStatus(value)
                setSelectedIds([])
                setCursors([null])
              }}
              className={cn(
                'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
                status === value ? 'bg-primary text-primary-foreground' : 'border border-border/70 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
          {overdue.length > 0 && (
            <StatusBadge tone="warning" className="ml-auto">
              <Clock3 className="size-3" />
              {overdue.length} overdue in this page
            </StatusBadge>
          )}
        </div>

        {error && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>}

        {selectedIds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2">
            <span className="text-xs font-semibold text-foreground">{selectedIds.length} selected</span>
            {(['approve', 'approve_qa', 'reject'] as ApplicationAction[]).map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === 'reject' ? 'outline' : 'default'}
                className={cn('h-7 text-[11px]', action === 'reject' && 'text-destructive')}
                onClick={() => setPending({ row: rows[0], action, bulk: true })}
              >
                {APPLICATION_ACTION_LABELS[action]}
              </Button>
            ))}
            <button type="button" onClick={() => setSelectedIds([])} className="ml-auto text-[11px] text-muted-foreground hover:underline">
              Clear
            </button>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading the queue…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Check className="size-7 text-success" />
              <p className="text-sm font-medium text-foreground">Nothing in “{FILTERS.find(([v]) => v === status)?.[1] ?? status}”.</p>
              <p className="text-xs text-muted-foreground">The queue is genuinely empty — no seed data, no placeholders.</p>
            </div>
          ) : (
            rows.map((row) => {
              const actions = ACTIONS_BY_STATUS[row.status] ?? []
              const isOpen = expanded === row.id
              return (
                <article key={row.id} className={cn('rounded-xl border p-3 transition-colors', row.overdue ? 'border-warning/50 bg-warning/[0.06]' : 'border-border/80 bg-card', isOpen && 'shadow-sm')}>
                  <div className="flex flex-wrap items-start gap-3">
                    <label className="mt-1 flex shrink-0 items-center" title="Select for bulk action">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={() => toggle(row.id)}
                        disabled={actions.length === 0}
                        className="size-3.5 accent-[var(--primary)]"
                        aria-label={`Select ${row.jobTitle}`}
                      />
                    </label>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{row.jobTitle}</p>
                        <StatusBadge tone={TONE[row.status] ?? 'neutral'}>{row.status.replace(/_/g, ' ')}</StatusBadge>
                        {row.overdue && <StatusBadge tone="warning">SLA breach</StatusBadge>}
                        {row.handledBy && <StatusBadge tone="info">by {row.handledBy.split('@')[0]}</StatusBadge>}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{row.workerEmail}</span>
                        <span className="inline-flex items-center gap-1">
                          <CircleDollarSign className="size-3" />
                          {formatUsd(row.payAmountUsd)}
                        </span>
                        <span className="font-mono text-[11px]">applied {relative(row.appliedAt)}</span>
                        {row.reviewExpiresAt && <span className="font-mono text-[11px]">due {relative(row.reviewExpiresAt)}</span>}
                      </p>
                      {(row.rejectionReason || row.revisionNote) && (
                        <p className="mt-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                          <strong className="font-semibold text-foreground">{row.rejectionReason ? 'Reason' : 'Revision note'}:</strong>{' '}
                          {row.rejectionReason || row.revisionNote}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {actions.map(({ action, icon: Icon }) => (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === 'reject' || action === 'fail_qa' ? 'outline' : 'default'}
                          className={cn('h-8 gap-1.5 text-xs', (action === 'reject' || action === 'fail_qa') && 'text-destructive hover:bg-destructive/10')}
                          title={APPLICATION_ACTION_SIDE_EFFECTS[action]}
                          onClick={() => setPending({ row, action })}
                        >
                          <Icon className="size-3.5" />
                          {APPLICATION_ACTION_LABELS[action]}
                        </Button>
                      ))}
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setExpanded(isOpen ? null : row.id)}>
                        {isOpen ? 'Hide' : 'History'}
                      </Button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lifecycle</p>
                        <ol className="mt-1.5 flex flex-col gap-1.5">
                          {row.history.length === 0 ? (
                            <li className="text-xs text-muted-foreground">No transitions recorded yet.</li>
                          ) : (
                            row.history.map((event, index) => (
                              <li key={`${event.status}-${index}`} className="flex items-center gap-2 text-xs">
                                <span className={cn('size-1.5 shrink-0 rounded-full', index === row.history.length - 1 ? 'bg-primary' : 'bg-muted-foreground/40')} />
                                <span className="font-medium text-foreground">{event.status.replace(/_/g, ' ')}</span>
                                <span className="text-muted-foreground">{event.by ?? ''}</span>
                                <time className="ml-auto font-mono text-[11px] text-muted-foreground">{event.at ? new Date(event.at).toLocaleString() : ''}</time>
                              </li>
                            ))
                          )}
                        </ol>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/60 p-3 text-xs">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Context</p>
                        <dl className="mt-1.5 grid grid-cols-2 gap-y-1.5">
                          <dt className="text-muted-foreground">Application</dt>
                          <dd className="truncate font-mono text-[11px]">{row.id}</dd>
                          <dt className="text-muted-foreground">Job</dt>
                          <dd className="truncate font-mono text-[11px]">{row.jobId}</dd>
                          <dt className="text-muted-foreground">Worker</dt>
                          <dd className="truncate font-mono text-[11px]">{row.workerUid}</dd>
                          <dt className="text-muted-foreground">Updated</dt>
                          <dd className="font-mono text-[11px]">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}</dd>
                        </dl>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Button render={<Link href={`/training/${encodeURIComponent(row.jobId)}`} target="_blank" />} variant="outline" size="sm" className="h-7 text-[11px]">
                            Open job
                          </Button>
                          <Button render={<Link href={`/admin/users?q=${encodeURIComponent(row.workerEmail)}`} />} variant="ghost" size="sm" className="h-7 text-[11px]">
                            View worker
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              )
            })
          )}
        </div>

        <div className="mt-3">
          <Pager
            hasMore={hasMore}
            loading={loading}
            pageLabel={`Page ${cursors.length} · ${rows.length} shown · ${actionable.length} actionable`}
            onPrev={() => setCursors((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
            onNext={() => setCursors((prev) => (nextCursor ? [...prev, nextCursor] : prev))}
          />
        </div>
      </AdminCard>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <LiveDot tone={loading ? 'warning' : 'success'} />
        Approving a submission credits the worker’s pending balance idempotently; declining releases the reserved slot. Both notify the worker.
      </div>

      <ReasonDialog
        open={!!pending}
        title={pending ? `${APPLICATION_ACTION_LABELS[pending.action]}${pending.bulk ? ` ${selectedIds.length} applications` : ''}` : ''}
        tone={pending && ['reject', 'fail_qa', 'request_revision'].includes(pending.action) ? 'destructive' : 'default'}
        confirmLabel={pending ? APPLICATION_ACTION_LABELS[pending.action] : 'Confirm'}
        busy={busy}
        requireReason={!!pending && REQUIRED_REASON.includes(pending.action)}
        description={
          pending ? (
            <span>
              {pending.bulk ? `${selectedIds.length} selected · ` : `${pending.row.jobTitle} · ${pending.row.workerEmail} · `}
              {APPLICATION_ACTION_SIDE_EFFECTS[pending.action] ?? 'Moves the application to the next state and notifies the worker.'}
            </span>
          ) : undefined
        }
        onCancel={() => setPending(null)}
        onConfirm={(reason) => void applyAction(reason)}
      />
    </div>
  )
}

function relative(iso: string): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const diff = ms - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60_000)
  const label = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`
  return diff < 0 ? `${label} ago` : `in ${label}`
}
