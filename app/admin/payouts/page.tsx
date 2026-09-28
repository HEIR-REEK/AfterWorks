'use client'

/**
 * Withdrawal desk.
 *
 * The queue the worker side writes into. Every row is a real hold on a real balance, so the page is
 * built around three questions an operator has while looking at one: *who is this and where does the
 * money go*, *what is allowed to happen next*, and *what happened last time*.
 *
 * The legal moves are not decided here — the API sends `transitions` built from the same table the
 * route validates against (`lib/payouts.ts`), so a button is never offered for a move the server
 * would refuse, and a refusal is never hidden when it would have been allowed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react'
import { adminApi, useAdminSession } from '@/lib/admin'
import { AdminCard, AdminStat, LiveDot, Pager, ReasonDialog, inputClass, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'
import { formatKesValue, formatUsd } from '@/lib/afterworks-data'
import {
  PAYOUT_ACTION_HINTS,
  PAYOUT_ACTION_LABELS,
  PAYOUT_REASON_REQUIRED,
  PAYOUT_STATUS_SHORT,
  PAYOUT_STATUS_TONE,
  type PayoutQueueSummary,
  type PayoutRequestRow,
  type PayoutRequestStatus,
} from '@/lib/payouts'
import type { AdminPayoutRow } from '@/lib/admin'

/** Same rows, but the console transport types `history[].status` loosely (it is server text). */
type Transitions = Record<string, { next: PayoutRequestStatus[]; needsReason: boolean; needsReference: boolean }>

const FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'pending', label: 'Awaiting review' },
  { value: 'approved', label: 'Approved' },
  { value: 'processing', label: 'Processing' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
]

function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function ageHours(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 3_600_000) : null
}

export default function AdminPayoutsPage() {
  const session = useAdminSession()
  const { push, toasts } = useToasts()

  const [status, setStatus] = useState('pending')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<PayoutRequestRow[]>([])
  const [summary, setSummary] = useState<PayoutQueueSummary | null>(null)
  const [transitions, setTransitions] = useState<Transitions>({})
  const [sla, setSla] = useState('')
  const [degraded, setDegraded] = useState<string | null>(null)
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<PayoutRequestRow | null>(null)
  const [pendingAction, setPendingAction] = useState<{ row: PayoutRequestRow; to: PayoutRequestStatus } | null>(null)
  const [reference, setReference] = useState('')

  const cursor = cursors[cursors.length - 1] ?? null

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(id)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminApi.payouts({ status, search, cursor, pageSize: 25 })
      setRows((data.rows ?? []).map(normaliseRow))
      setSummary(data.summary ?? null)
      setTransitions(normaliseTransitions(data.transitions ?? {}))
      setSla(data.payoutSla ?? '')
      setDegraded(data.degraded ?? null)
      setNextCursor(data.nextCursor ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The payout queue could not be read.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [status, search, cursor])

  useEffect(() => {
    if (session.status === 'authorized') void load()
  }, [session.status, load])

  const runAction = useCallback(
    async (row: PayoutRequestRow, to: PayoutRequestStatus, reason: string, payoutReference: string) => {
      setBusyId(row.id)
      try {
        const data = await adminApi.payoutAction({ id: row.id, status: to, reason, payoutReference })
        push('success', data.message || 'Request updated.')
        setSelected(null)
        setPendingAction(null)
        setReference('')
        await load()
      } catch (err) {
        push('error', err instanceof Error ? err.message : 'That action was refused by the server.')
      } finally {
        setBusyId(null)
      }
    },
    [load, push],
  )

  const headline = useMemo(
    () => [
      { label: 'Awaiting review', value: summary?.pending ?? 0, tone: (summary?.pending ?? 0) > 0 ? ('warning' as const) : ('default' as const) },
      { label: 'In flight', value: (summary?.approved ?? 0) + (summary?.processing ?? 0), tone: 'default' as const },
      { label: 'Held for members', value: formatUsd(summary?.heldUsd ?? 0), tone: 'primary' as const },
      { label: 'Paid out (scanned)', value: formatUsd(summary?.paidUsd ?? 0), tone: 'success' as const },
    ],
    [summary],
  )

  if (session.status !== 'authorized') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" /> Checking your console session…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight sm:text-xl">
            <Banknote className="size-5 text-primary" />
            Withdrawals
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Requests hold the member&apos;s balance while they wait. Approve, send, then mark paid with the provider
            reference — or reject/fail the payout and the held money returns to them automatically. Every move is audited
            and notifies the member.
            {sla ? ` ${sla}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <LiveDot tone={degraded ? 'warning' : 'success'} />
            {degraded ? 'partial read' : 'live queue'}
          </span>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Reload
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {headline.map((item) => (
          <AdminStat key={item.label} label={item.label} value={item.value} tone={item.tone} />
        ))}
      </div>

      {summary?.oldestPendingAt ? (
        <p className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[11px] text-warning-foreground">
          <AlertTriangle className="size-3.5 shrink-0" />
          Oldest request waiting {ageHours(summary.oldestPendingAt) ?? 0}h (since {when(summary.oldestPendingAt)}).
        </p>
      ) : null}

      <AdminCard
        title="Queue"
        description="Filtered server-side; the search box narrows the page you are looking at (email, name, uid or account number)."
        icon={<Search className="size-4" />}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  setStatus(filter.value)
                  setCursors([null])
                }}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  status === filter.value
                    ? 'border-primary bg-primary/[0.08] text-foreground'
                    : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted',
                )}
              >
                {filter.label}
                {summary && filter.value !== 'all' && typeof summary[filter.value as PayoutRequestStatus] === 'number' ? (
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                    {summary[filter.value as PayoutRequestStatus]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="email, name, uid, account number or reference"
              className={cn(inputClass, 'pl-9')}
              aria-label="Search payout requests"
            />
          </div>
          {degraded ? <p className="text-[11px] text-amber-700 dark:text-amber-400">{degraded}</p> : null}
          {error ? <p className="text-[11px] font-medium text-destructive">{error}</p> : null}
        </div>
      </AdminCard>

      <AdminCard title={`Requests (${rows.length})`} description="Newest first.">
        {loading && rows.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Reading the queue…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            {error
              ? 'The queue could not be read.'
              : status === 'pending'
                ? 'Nothing is waiting. New withdrawal requests land here the moment a member asks.'
                : 'No requests match this filter.'}
          </p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 font-semibold">Requested</th>
                  <th className="px-2 py-2 font-semibold">Member</th>
                  <th className="px-2 py-2 font-semibold">Destination</th>
                  <th className="px-2 py-2 text-right font-semibold">Amount</th>
                  <th className="px-2 py-2 text-right font-semibold">Status</th>
                  <th className="px-2 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const moves = transitions[row.status]?.next ?? []
                  return (
                    <tr key={row.id} className="border-t border-border/60 align-top hover:bg-muted/40">
                      <td className="whitespace-nowrap px-2 py-2">
                        <span className="block font-medium text-foreground">{when(row.requestedAt)}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {row.payoutBy ? `due ${when(row.payoutBy)}` : ''}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/admin/users?q=${encodeURIComponent(row.email || row.uid)}`}
                          className="block max-w-[24ch] truncate font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {row.name || row.email || row.uid.slice(0, 10)}
                        </Link>
                        <span className="mt-0.5 block max-w-[24ch] truncate font-mono text-[10px] text-muted-foreground">{row.email || row.uid}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="block max-w-[26ch] truncate">{row.destinationLabel}</span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">Account name: {row.destination.accountName || '—'}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-mono font-semibold tabular-nums">
                        {formatUsd(row.amountUsd)}
                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">≈ {formatKesValue(row.amountKes)}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <StatusBadge tone={PAYOUT_STATUS_TONE[row.status]}>{PAYOUT_STATUS_SHORT[row.status]}</StatusBadge>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setSelected(row)}>
                            Details
                          </Button>
                          {moves.map((to) => (
                            <Button
                              key={to}
                              type="button"
                              size="sm"
                              variant={to === 'paid' ? 'default' : to === 'rejected' || to === 'failed' ? 'destructive' : 'outline'}
                              className="h-7"
                              disabled={busyId === row.id}
                              onClick={() => {
                                setReference('')
                                setPendingAction({ row, to })
                              }}
                            >
                              {to === 'paid' ? <CheckCircle2 className="size-3.5" /> : null}
                              {to === 'processing' ? <Send className="size-3.5" /> : null}
                              {to === 'rejected' || to === 'failed' ? <XCircle className="size-3.5" /> : null}
                              {PAYOUT_ACTION_LABELS[to]}
                            </Button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 || nextCursor ? (
          <div className="mt-3">
            <Pager
              hasMore={Boolean(nextCursor)}
              loading={loading}
              pageLabel={`page ${cursors.length}`}
              onPrev={() => setCursors((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
              onNext={() => setCursors((prev) => (nextCursor ? [...prev, nextCursor] : prev))}
            />
          </div>
        ) : null}
      </AdminCard>

      {/* Row drawer */}
      {selected ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-foreground/40 p-3 backdrop-blur-sm sm:items-center" onMouseDown={() => setSelected(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Payout request"
            className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Request {selected.id}</p>
                <h3 className="mt-1 flex items-center gap-2 font-mono text-2xl font-semibold tabular-nums">
                  {formatUsd(selected.amountUsd)}
                  <span className="text-xs font-normal text-muted-foreground">≈ {formatKesValue(selected.amountKes)}</span>
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Requested {when(selected.requestedAt)}
                  {selected.payoutBy ? ` · expected payout by ${when(selected.payoutBy)}` : ''}
                </p>
              </div>
              <StatusBadge tone={PAYOUT_STATUS_TONE[selected.status]}>{PAYOUT_SHORT(selected.status)}</StatusBadge>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-muted/25 p-3.5 text-xs">
                <p className="flex items-center gap-1.5 font-semibold">
                  <User className="size-3.5" /> Member
                </p>
                <p className="mt-1.5 truncate">{selected.name || '—'}</p>
                <p className="truncate text-muted-foreground">{selected.email || selected.uid}</p>
                <Link href={`/admin/users?q=${encodeURIComponent(selected.email || selected.uid)}`} className="mt-2 inline-block text-[11px] font-medium text-primary hover:underline">
                  Open in Users &amp; KYC →
                </Link>
              </div>
              <div className="rounded-xl border border-border bg-muted/25 p-3.5 text-xs">
                <p className="flex items-center gap-1.5 font-semibold">
                  {selected.method === 'Bank Transfer' ? <CreditCard className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                  Destination
                </p>
                <p className="mt-1.5">{selected.destinationLabel}</p>
                <p className="text-muted-foreground">Account name: {selected.destination.accountName || '—'}</p>
                {selected.method === 'Bank Transfer' ? (
                  <p className="text-muted-foreground">
                    {selected.destination.bankName} · {selected.destination.bankBranch}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  onClick={() => {
                    const value = selected.method === 'Bank Transfer' ? selected.destination.bankAccountNumber : selected.destination.accountNumber
                    void navigator.clipboard?.writeText(value)
                    push('info', 'Account number copied for the provider portal.')
                  }}
                >
                  <Copy className="size-3" /> Copy account number
                </button>
              </div>
            </div>

            {selected.payoutReference ? (
              <p className="mt-3 rounded-xl border border-success/30 bg-success/10 p-3 text-xs text-success">
                Provider reference: <span className="font-mono font-semibold">{selected.payoutReference}</span>
              </p>
            ) : null}
            {selected.reason ? (
              <p className="mt-3 rounded-xl border border-border bg-muted/30 p-3 text-xs">
                <span className="font-semibold">Note on file:</span> {selected.reason}
              </p>
            ) : null}

            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">History</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-xs">
                {selected.history.map((entry, index) => (
                  <li key={`${entry.status}-${index}`} className="flex items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
                    <span className="font-medium">{PAYOUT_SHORT(entry.status)}</span>
                    <span className="text-muted-foreground">
                      {when(entry.at)}
                      {entry.by ? ` · ${entry.by}` : ''}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              {(transitions[selected.status]?.next ?? []).map((to) => (
                <Button
                  key={to}
                  type="button"
                  size="sm"
                  variant={to === 'paid' ? 'default' : to === 'rejected' || to === 'failed' ? 'destructive' : 'outline'}
                  disabled={busyId === selected.id}
                  onClick={() => setPendingAction({ row: selected, to })}
                >
                  {PAYOUT_ACTION_LABELS[to]}
                </Button>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirmation: reason for a refusal, provider reference for a payment */}
      <ReasonDialog
        open={Boolean(pendingAction)}
        title={pendingAction ? `${PAYOUT_ACTION_LABELS[pendingAction.to]} — ${pendingAction.row.name || pendingAction.row.email}` : ''}
        description={
          pendingAction ? (
            <span>
              {PAYOUT_ACTION_HINTS[pendingAction.to] ?? ''}{' '}
              {pendingAction.to === 'paid' || pendingAction.to === 'processing'
                ? `Send ${formatUsd(pendingAction.row.amountUsd)} to ${pendingAction.row.destinationLabel} first, then record it here.`
                : ''}
            </span>
          ) : undefined
        }
        confirmLabel={pendingAction ? PAYOUT_ACTION_LABELS[pendingAction.to] : 'Confirm'}
        tone={pendingAction && (pendingAction.to === 'rejected' || pendingAction.to === 'failed') ? 'destructive' : 'default'}
        requireReason={pendingAction ? PAYOUT_REASON_REQUIRED.includes(pendingAction.to) : true}
        minReasonLength={4}
        busy={busyId === pendingAction?.row.id}
        // Paying money out is not valid until the provider reference is in the box.
        confirmDisabled={pendingAction?.to === 'paid' && reference.trim().length < 3}
        onCancel={() => {
          setPendingAction(null)
          setReference('')
        }}
        onConfirm={(reason) => {
          if (!pendingAction) return
          void runAction(pendingAction.row, pendingAction.to, reason, reference)
        }}
        extra={
          pendingAction?.to === 'paid' ? (
            <label className="mt-3 block text-xs font-semibold">
              Provider reference (required)
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="e.g. QK73H2L9P1"
                className={cn(inputClass, 'mt-1.5 font-mono')}
              />
            </label>
          ) : null
        }
      />

      {toasts}
    </div>
  )
}

function PAYOUT_SHORT(status: PayoutRequestStatus): string {
  return PAYOUT_STATUS_SHORT[status] ?? status
}

/**
 * The console transport types `history[].status` as a plain string (it is whatever the document
 * holds); the domain type narrows it to the known statuses. Normalising here keeps the rest of the
 * page strongly typed without a cast at every use.
 */
function normaliseRow(row: AdminPayoutRow): PayoutRequestRow {
  const known: PayoutRequestStatus[] = ['pending', 'approved', 'processing', 'paid', 'rejected', 'failed', 'cancelled']
  return {
    ...row,
    history: (row.history ?? []).map((entry) => ({
      ...entry,
      status: (known as string[]).includes(entry.status) ? (entry.status as PayoutRequestStatus) : 'pending',
    })),
  }
}

/** Narrows the server's transition map (statuses arrive as plain strings) to the domain type. */
function normaliseTransitions(input: Record<string, { next: string[]; needsReason: boolean; needsReference: boolean }>): Transitions {
  const out: Transitions = {}
  for (const [status, value] of Object.entries(input)) {
    out[status] = {
      needsReason: value.needsReason,
      needsReference: value.needsReference,
      next: (value.next ?? []).map(asPayoutStatus),
    }
  }
  return out
}

function asPayoutStatus(value: string): PayoutRequestStatus {
  const known: PayoutRequestStatus[] = ['pending', 'approved', 'processing', 'paid', 'rejected', 'failed', 'cancelled']
  return (known as string[]).includes(value) ? (value as PayoutRequestStatus) : 'pending'
}
