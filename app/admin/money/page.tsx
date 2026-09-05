'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, CreditCard, Download, Landmark, Loader2, Search, Wallet } from 'lucide-react'
import { adminApi, useAdminSession, type AdminLedgerRow } from '@/lib/admin'
import { AdminCard, AdminStat, LiveDot, OwnerOnlyNotice, Pager, inputClass, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'
import { formatKesValue, formatUsd } from '@/lib/afterworks-data'

/**
 * Money ledger.
 *
 * Everything about a payout lives in one of two Firestore collections: `wallet_ledger` (work credited,
 * withdrawals requested and settled) and `transactions` (Paystack charges for training). Before this
 * page existed the console could only show counts, so "the worker says the credit never landed" was
 * answered by opening the Firebase console.
 *
 * It is read-only on purpose. Balances change through the application lifecycle and the wallet
 * correction action in `/admin/users`, both of which write an audit entry; a generic "edit row" control
 * here would be a second, unaudited path to somebody's money.
 */

const SOURCES = [
  ['all', 'Everything', Landmark],
  ['wallet', 'Earnings & payouts', Wallet],
  ['payment', 'Card payments', CreditCard],
] as const

const KIND_LABELS: Record<string, string> = {
  earning: 'Work credited',
  withdrawal: 'Withdrawal',
  payout: 'Payout',
  reversal: 'Reversal',
  adjustment: 'Manual adjustment',
  payment: 'Training payment',
  charge: 'Training payment',
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (['cleared', 'success', 'completed', 'paid', 'approved'].includes(status)) return 'success'
  if (['pending', 'processing', 'under_review', 'initiated', 'open'].includes(status)) return 'warning'
  if (['failed', 'reversed', 'rejected', 'cancelled', 'error'].includes(status)) return 'danger'
  return 'info'
}

function money(row: AdminLedgerRow): string {
  if (row.amountKes !== null && row.amountKes !== 0) return formatKesValue(row.amountKes)
  if (row.amountUsd !== null) return formatUsd(row.amountUsd)
  return '—'
}

export default function AdminLedgerPage() {
  const session = useAdminSession()
  if (session.status === 'authorized' && session.role !== 'owner') {
    return <OwnerOnlyNotice area="The money ledger" />
  }
  return <AdminLedgerPageInner />
}

function AdminLedgerPageInner() {
  const session = useAdminSession()
  const { push, toasts } = useToasts()

  const [rows, setRows] = useState<AdminLedgerRow[]>([])
  const [totals, setTotals] = useState<{ entries: number; paidOutUsd: number; pendingUsd: number; revenueKes: number } | null>(null)
  const [degraded, setDegraded] = useState<string | null>(null)
  const [source, setSource] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cursor = cursors[cursors.length - 1] ?? null

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(id)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminApi.ledger({
        source,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(search ? { search } : {}),
        pageSize: 50,
        cursor,
      })
      setRows(data.rows ?? [])
      setTotals(data.totals ?? null)
      setDegraded(data.degraded ?? null)
      setNextCursor(data.nextCursor ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The ledger could not be read.'
      setError(message)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [source, statusFilter, search, cursor])

  useEffect(() => {
    if (session.status === 'authorized') void load()
  }, [session.status, load])

  const pendingCount = useMemo(() => rows.filter((row) => row.status === 'pending').length, [rows])

  const exportCsv = () => {
    if (rows.length === 0) {
      push('info', 'Nothing to export on this page.')
      return
    }
    const header = ['when', 'source', 'kind', 'reference', 'uid', 'email', 'status', 'amount_usd', 'amount_kes', 'label']
    const body = rows.map((row) =>
      [
        row.createdAt ?? '',
        row.source,
        row.kind,
        row.reference,
        row.uid,
        row.email,
        row.status,
        row.amountUsd ?? '',
        row.amountKes ?? '',
        row.label.replace(/[",\n]/g, ' '),
      ].join(','),
    )
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `afterworks-ledger-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    push('success', `${rows.length} rows exported. Amounts only — this file is not a receipt source.`)
  }

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
            <Landmark className="size-5 text-primary" />
            Money ledger
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Every credit, withdrawal and card payment the server has recorded. Read here, corrected in{' '}
            <Link href="/admin/users" className="font-medium text-primary underline-offset-2 hover:underline">
              Users &amp; KYC
            </Link>{' '}
            — a balance edit there is audited with your reason, which is the only supported way to change one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <LiveDot tone={degraded ? 'warning' : 'success'} />
            {degraded ? 'partial feed' : 'live from Firestore'}
          </span>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={exportCsv}>
            <Download className="size-3.5" />
            CSV
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Reload
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStat label="Ledger entries" value={totals?.entries ?? '—'} sub="Earnings + withdrawals + payments" icon={<Landmark className="size-4" />} />
        <AdminStat label="Credited (this page)" value={totals ? formatUsd(totals.paidOutUsd) : '—'} sub="Cleared earnings" icon={<ArrowDownLeft className="size-4" />} />
        <AdminStat
          label="Awaiting settlement"
          value={totals ? formatUsd(totals.pendingUsd) : '—'}
          sub={`${pendingCount} pending row${pendingCount === 1 ? '' : 's'} visible`}
          tone={totals && totals.pendingUsd > 0 ? 'warning' : 'default'}
          icon={<ArrowUpRight className="size-4" />}
        />
        <AdminStat
          label="Training revenue"
          value={totals ? formatKesValue(totals.revenueKes) : '—'}
          sub="Successful Paystack charges on this page"
          icon={<CreditCard className="size-4" />}
        />
      </div>

      <AdminCard title="Filter" description="Server-side: the query is narrowed before the documents are read, not after." icon={<Search className="size-4" />}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {SOURCES.map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setSource(value)
                  setCursors([null])
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  source === value ? 'border-primary bg-primary/[0.08] text-foreground' : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
            <span className="mx-1 hidden w-px bg-border sm:block" />
            {['', 'pending', 'cleared', 'failed'].map((value) => (
              <button
                key={value || 'any'}
                type="button"
                onClick={() => {
                  setStatusFilter(value)
                  setCursors([null])
                }}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs font-medium capitalize transition-colors',
                  statusFilter === value ? 'border-primary bg-primary/[0.08] text-foreground' : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted',
                )}
              >
                {value || 'any status'}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="email, uid, reference or job title"
              className={cn(inputClass, 'pl-9')}
              aria-label="Search the ledger"
            />
          </div>
          {degraded ? <p className="text-[11px] text-amber-700 dark:text-amber-400">{degraded}</p> : null}
          {error ? <p className="text-[11px] font-medium text-destructive">{error}</p> : null}
        </div>
      </AdminCard>

      <AdminCard title="Movements" description={`${rows.length} row${rows.length === 1 ? '' : 's'} on this page.`}>
        {loading && rows.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Reading the ledger…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            {error ? 'The ledger could not be read.' : 'No movements match this filter. A fresh project has none until the first job is marked completed.'}
          </p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 font-semibold">When</th>
                  <th className="px-2 py-2 font-semibold">What</th>
                  <th className="px-2 py-2 font-semibold">Member</th>
                  <th className="px-2 py-2 font-semibold">Reference</th>
                  <th className="px-2 py-2 text-right font-semibold">Amount</th>
                  <th className="px-2 py-2 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.source}-${row.id}`} className="border-t border-border/60 align-top hover:bg-muted/40">
                    <td className="whitespace-nowrap px-2 py-2">
                      {row.createdAt ? (
                        <>
                          <span className="block font-medium text-foreground">{new Date(row.createdAt).toLocaleDateString()}</span>
                          <span className="block font-mono text-[10px] text-muted-foreground tabular-nums">
                            {new Date(row.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">no date</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        {row.kind === 'withdrawal' || row.kind === 'payout' ? (
                          <ArrowUpRight className="size-3.5 text-muted-foreground" />
                        ) : (
                          <ArrowDownLeft className="size-3.5 text-muted-foreground" />
                        )}
                        {KIND_LABELS[row.kind] ?? row.kind}
                      </span>
                      <span className="mt-0.5 block max-w-[26ch] truncate text-[11px] text-muted-foreground">{row.label}</span>
                    </td>
                    <td className="px-2 py-2">
                      {row.email || row.uid ? (
                        <Link href={`/admin/users?q=${encodeURIComponent(row.email || row.uid)}`} className="block max-w-[26ch] truncate text-primary underline-offset-2 hover:underline">
                          {row.email || `${row.uid.slice(0, 10)}…`}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">unlinked</span>
                      )}
                      {row.uid ? <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{row.uid.slice(0, 14)}</span> : null}
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">{row.reference || row.id}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-mono font-semibold tabular-nums text-foreground">{money(row)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <StatusBadge tone={statusTone(row.status)}>{row.status.replace(/_/g, ' ')}</StatusBadge>
                      {row.clearedAt ? (
                        <span className="mt-1 block text-[10px] text-muted-foreground">cleared {new Date(row.clearedAt).toLocaleDateString()}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
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

      {toasts}
    </div>
  )
}
