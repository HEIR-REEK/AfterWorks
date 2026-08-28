'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Lock, ScrollText, Search, ShieldCheck } from 'lucide-react'
import { adminApi, useAdminSession } from '@/lib/admin'
import { AdminCard, inputClass, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'

/**
 * Audit log.
 *
 * Read from `admin_logs` through the server, filtered there rather than by pulling everything into
 * the tab, with CSV export for compliance. `details` arrive already redacted: `lib/security.ts`
 * strips token/secret/password/cookie keys on write, so a leaked export cannot become a session.
 */

type Row = {
  id: string
  action: string
  details?: Record<string, unknown>
  actorEmail?: string
  timestamp: string
  serverWritten?: boolean
}

const GROUPS = [
  ['all', 'Everything'],
  ['ADMIN_LOGIN_FAILED', 'Failed sign-ins'],
  ['ADMIN_LOGIN', 'Sign-ins'],
  ['MAINTENANCE', 'Maintenance'],
  ['APPLICATION', 'QA decisions'],
  ['WALLET', 'Wallet'],
  ['KYC', 'KYC'],
  ['USER', 'Accounts'],
] as const

export default function AdminAuditLogPage() {
  const session = useAdminSession()
  const { push, toasts } = useToasts()

  const [rows, setRows] = useState<Row[]>([])
  const [actions, setActions] = useState<string[]>([])
  const [exportUrl, setExportUrl] = useState<string>('/api/admin/audit?format=csv&limit=200')
  const [group, setGroup] = useState<string>('all')
  const [limit, setLimit] = useState(80)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set())

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(id)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminApi.auditLogs({ limit, action: group, search })
      setRows(data.logs as Row[])
      setActions(data.actions)
      setExportUrl(data.exportUrl)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The audit ledger is not reachable.')
    } finally {
      setLoading(false)
    }
  }, [limit, group, search])

  useEffect(() => {
    if (session.status === 'authorized') void load()
  }, [session.status, load])

  const stats = useMemo(() => {
    const failures = rows.filter((row) => row.action === 'ADMIN_LOGIN_FAILED').length
    const moneyish = rows.filter((row) => /WALLET|PAYOUT|CREDIT|APPROVE_QA|COMPLET/i.test(row.action)).length
    const notServer = rows.filter((row) => row.serverWritten !== true).length
    return { failures, moneyish, notServer }
  }, [rows])

  const unlock = async (fragment: string) => {
    try {
      await adminApi.operatorAction({ action: 'unlock', fragment })
      setUnlocked((prev) => new Set(prev).add(fragment))
      push('success', `Lockout counters touching “${fragment}” were cleared.`)
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Could not clear the lockout.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {toasts}

      <AdminCard
        title="Audit log"
        description="Append-only record of console actions: who did what, when, and why."
        icon={<ScrollText className="size-4" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="uid, job, email…"
                aria-label="Search audit log"
                className={cn(inputClass, 'h-8 w-40 pl-8 text-xs sm:w-52')}
              />
            </div>
            <select value={group} onChange={(event) => setGroup(event.target.value)} className={cn(inputClass, 'h-8 w-auto py-1 text-xs')} aria-label="Filter by action">
              {GROUPS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))} className={cn(inputClass, 'h-8 w-auto py-1 text-xs')} aria-label="Rows to read">
              {[40, 80, 150, 200].map((value) => (
                <option key={value} value={value}>
                  {value} rows
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <Loader2 className={cn('size-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <a href={exportUrl} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted">
              <Download className="size-3.5" />
              CSV
            </a>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <StatusBadge tone={stats.failures ? 'danger' : 'success'}>{stats.failures} failed sign-ins in view</StatusBadge>
          <StatusBadge tone="info">{stats.moneyish} money-moving entries</StatusBadge>
          {stats.notServer > 0 && <StatusBadge tone="warning">{stats.notServer} legacy rows written before the server guard</StatusBadge>}
          <span className="ml-auto">{actions.length} distinct actions in this page</span>
        </div>

        {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>}

        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading the ledger…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">No entries match. Actions appear here the moment they are taken.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {rows.map((row) => {
              const danger = /FAIL|REJECT|BAN|SUSPEND|LOCK|REVOK/i.test(row.action)
              const good = /APPROV|COMPLET|RESTORE|GRANT|ENABLE/i.test(row.action)
              const isOpen = expanded === row.id
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : row.id)}
                    className="flex w-full flex-wrap items-start gap-2 py-2.5 text-left transition-colors hover:bg-muted/40"
                    aria-expanded={isOpen}
                  >
                    <span className={cn('mt-1 size-2 shrink-0 rounded-full', danger ? 'bg-destructive' : good ? 'bg-success' : 'bg-primary/60')} />
                    <span className="shrink-0 font-mono text-[11px] font-semibold uppercase tracking-tight text-foreground">{row.action}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summarise(row.details)}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{row.actorEmail?.split('@')[0] || 'system'}</span>
                    <time className="shrink-0 font-mono text-[11px] text-muted-foreground/80">{row.timestamp ? new Date(row.timestamp).toLocaleString() : ''}</time>
                  </button>
                  {isOpen && (
                    <div className="mb-2.5 rounded-xl border border-border/70 bg-background/60 p-3">
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
{JSON.stringify(row.details ?? {}, null, 2)}
                      </pre>
                      {row.action === 'ADMIN_LOGIN_FAILED' && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/70 pt-2">
                          <p className="text-[11px] text-muted-foreground">
                            Clear the in-memory lockout counters for any address or IP fragment mentioned above.
                          </p>
                          {unlocked.has(row.id) ? (
                            <StatusBadge tone="success">
                              <ShieldCheck className="size-3" />
                              Cleared
                            </StatusBadge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 text-[11px]"
                              onClick={async (event) => {
                                event.stopPropagation()
                                const hint = String((row.details as { emailFragment?: string; ipFragment?: string } | undefined)?.emailFragment ?? (row.details as { ipFragment?: string } | undefined)?.ipFragment ?? row.actorEmail ?? '')
                                if (hint.length < 3) {
                                  push('error', 'This entry does not carry a usable fragment (older log format).')
                                  return
                                }
                                await unlock(hint)
                              }}
                            >
                              <Lock className="size-3" />
                              Clear lockout
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </AdminCard>
    </div>
  )
}

function summarise(details?: Record<string, unknown>): string {
  if (!details) return '—'
  const parts: string[] = []
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'object') continue
    parts.push(`${key}=${String(value).slice(0, 60)}`)
    if (parts.length >= 4) break
  }
  return parts.length ? parts.join(' · ') : '—'
}
