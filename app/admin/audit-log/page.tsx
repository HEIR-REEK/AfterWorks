'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  RefreshCw,
  ScrollText,
  Search,
  Shield,
  User,
} from 'lucide-react'
import { subscribeToAdminAuditLogs, type AdminAuditLog } from '@/lib/firestore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState<AdminAuditLog[]>([])
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)

  useEffect(() => {
    const unsub = subscribeToAdminAuditLogs(setLogs)
    return () => unsub()
  }, [])

  const uniqueActions = useMemo(() => {
    const set = new Set<string>()
    logs.forEach((l) => {
      if (l.action) set.add(l.action)
    })
    return Array.from(set)
  }, [logs])

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const q = search.toLowerCase()
      const matchSearch =
        !search ||
        log.action?.toLowerCase().includes(q) ||
        log.actorEmail?.toLowerCase().includes(q) ||
        JSON.stringify(log.details || {}).toLowerCase().includes(q)

      const matchAction = actionFilter === 'all' || log.action === actionFilter
      return matchSearch && matchAction
    })
  }, [logs, search, actionFilter])

  const getActionColor = (action: string) => {
    if (action.includes('DELETE') || action.includes('BANNED') || action.includes('FAILED')) {
      return 'bg-destructive/15 text-destructive border-destructive/30'
    }
    if (action.includes('ENABLE') || action.includes('UPDATE') || action.includes('GRANT')) {
      return 'bg-primary/15 text-primary border-primary/30'
    }
    if (action.includes('MAINTENANCE')) {
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
    }
    return 'bg-secondary text-secondary-foreground border-border'
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Search & Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Immutable Audit Logs</h2>
            <p className="text-xs text-muted-foreground">
              Real-time administrative ledger: <span className="font-mono font-semibold text-foreground">{logs.length}</span> events captured
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search action or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-4 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Action Type Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3 text-xs">
          <span className="text-muted-foreground font-medium mr-1">Filter action:</span>
          <button
            type="button"
            onClick={() => setActionFilter('all')}
            className={cn(
              'rounded-lg px-2.5 py-1 font-medium transition-colors',
              actionFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            All Actions
          </button>
          {uniqueActions.map((act) => (
            <button
              key={act}
              type="button"
              onClick={() => setActionFilter(act)}
              className={cn(
                'rounded-lg px-2.5 py-1 font-mono text-[11px] font-medium transition-colors',
                actionFilter === act
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {act}
            </button>
          ))}
        </div>
      </div>

      {/* Audit Log Timeline Feed */}
      {filteredLogs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground bg-card">
          No audit log records match your search criteria.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredLogs.map((log) => {
            const isExpanded = expandedLogId === log.id
            const hasDetails = log.details && Object.keys(log.details).length > 0

            return (
              <div
                key={log.id}
                className={cn(
                  'rounded-2xl border bg-card p-4 sm:p-5 shadow-sm transition-all',
                  isExpanded ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border',
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span
                      className={cn(
                        'rounded-lg border px-2.5 py-1 font-mono text-xs font-bold',
                        getActionColor(log.action),
                      )}
                    >
                      {log.action}
                    </span>

                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      by <strong className="text-foreground">{log.actorEmail || 'System Admin'}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5 text-primary" />
                      {new Date(log.timestamp).toLocaleString()}
                    </span>

                    {hasDetails && (
                      <button
                        type="button"
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        className="inline-flex items-center gap-1 font-sans text-primary hover:underline text-xs font-semibold"
                      >
                        {isExpanded ? 'Hide Payload' : 'View Payload'}
                        {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded JSON Inspector */}
                {isExpanded && hasDetails && (
                  <div className="mt-3.5 rounded-xl border border-border/80 bg-muted/40 p-3.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground mb-1.5">
                      <span>EVENT METADATA & PAYLOAD</span>
                      <span className="font-mono">{log.id}</span>
                    </div>
                    <pre className="overflow-x-auto rounded-lg bg-background p-3 font-mono text-[11px] text-foreground">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
