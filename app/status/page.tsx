'use client'

/**
 * /status — the public operational page.
 *
 * Public status pages are usually either a lie ("always green") or a Firebase console screenshot.
 * This one reads the same `/api/health` feed the on-call team uses, refreshes itself, and keeps a
 * local 60-sample history so a worker can see whether the platform has been flaky today rather than
 * being told it is fine. It is deliberately reachable without signing in (AppGate allow-list).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock3,
  Mail,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { site } from '@/lib/site'
import { cn } from '@/lib/utils'
import logo from '@/components/logo.png'

type Check = { id: string; label: string; status: 'operational' | 'degraded' | 'maintenance' | 'outage'; detail: string; latencyMs?: number }
type Health = {
  ok: boolean
  status: 'operational' | 'degraded' | 'maintenance' | 'outage'
  now: string
  uptimeSeconds: number
  checks: Check[]
  version: string
  environment: string
  maintenance: {
    enabled: boolean
    blocking: boolean
    title: string
    message: string
    estimatedEnd: string | null
    remainingMs: number | null
  }
}

const TONE = {
  operational: 'success',
  degraded: 'warning',
  maintenance: 'info',
  outage: 'danger',
} as const

const REFRESH_MS = 30_000

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<{ at: number; ok: boolean }[]>([])
  const [updatedAt, setUpdatedAt] = useState<number>(() => Date.now())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store', headers: { accept: 'application/json' } })
      const data = (await res.json()) as Health
      if (!mounted.current) return
      setHealth(data)
      setError(null)
      setUpdatedAt(Date.now())
      setHistory((prev) => [...prev.slice(-119), { at: Date.now(), ok: data.status === 'operational' || data.status === 'maintenance' }])
    } catch {
      if (mounted.current) setError('We could not reach the status feed.')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const overall = health?.status ?? (error ? 'outage' : 'operational')

  const headline = useMemo(() => {
    if (!health) return error ? 'Status feed unreachable' : 'Checking platform services…'
    if (health.status === 'maintenance') return 'Scheduled maintenance in progress'
    if (health.status === 'outage') return 'Some services are unavailable'
    if (health.status === 'degraded') return 'Some services are running slow'
    return 'All systems operational'
  }, [health, error])

  const seconds = health?.uptimeSeconds ?? 0
  const uptimeLabel =
    seconds > 86_400
      ? `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`
      : seconds > 3600
        ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
        : `${Math.floor(seconds / 60)}m ${seconds % 60}s`

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src={logo} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
            <span className="text-sm font-semibold tracking-tight">{site.name} status</span>
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div
          className={cn(
            'flex flex-col gap-4 rounded-2xl border p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between',
            overall === 'operational' && 'border-success/30 bg-success/[0.07]',
            overall === 'degraded' && 'border-warning/40 bg-warning/10',
            overall === 'maintenance' && 'border-amber-500/35 bg-amber-500/10',
            overall === 'outage' && 'border-destructive/35 bg-destructive/[0.07]',
          )}
        >
          <div className="flex items-start gap-3">
            <div className={cn('rounded-xl p-2.5', overall === 'operational' ? 'bg-success/15 text-success' : overall === 'outage' ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-600')}>
              {overall === 'operational' ? <ShieldCheck className="size-6" /> : overall === 'outage' ? <AlertCircle className="size-6" /> : <Wrench className="size-6" />}
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-pretty sm:text-xl">{headline}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {health
                  ? `Updated ${new Date(health.now).toLocaleTimeString()} · feed refreshed every ${REFRESH_MS / 1000}s`
                  : 'Live feed unavailable'}
              </p>
            </div>
          </div>
          <StatusBadge tone={TONE[overall]} className="w-fit">
            {overall === 'operational' ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {overall}
          </StatusBadge>
        </div>

        {health?.maintenance.enabled && health.maintenance.blocking && (
          <section className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <Wrench className="size-4" />
              {health.maintenance.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{health.maintenance.message}</p>
            {health.maintenance.estimatedEnd && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-background/70 px-2.5 py-1.5 text-xs font-medium text-foreground">
                <Clock3 className="size-3.5 text-amber-600" />
                Expected back {new Date(health.maintenance.estimatedEnd).toLocaleString()}
              </p>
            )}
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4 text-primary" />
            Service checks
          </h2>
          <ul className="mt-3 divide-y divide-border/70">
            {(health?.checks ?? []).length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">{error ?? 'Loading checks…'}</li>
            )}
            {(health?.checks ?? []).map((check) => (
              <li key={check.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{check.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
                </div>
                <div className="flex items-center gap-2">
                  {typeof check.latencyMs === 'number' && (
                    <span className="font-mono text-[11px] text-muted-foreground">{check.latencyMs}ms</span>
                  )}
                  <StatusBadge tone={TONE[check.status]}>
                    {check.status === 'operational' ? 'Operational' : check.status === 'degraded' ? 'Degraded' : check.status === 'maintenance' ? 'Maintenance' : 'Outage'}
                  </StatusBadge>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          <Stat label="Uptime this session" value={uptimeLabel} />
          <Stat label="Environment" value={health?.environment ?? '—'} />
          <Stat label="Build" value={health?.version ?? '—'} />
        </section>

        {history.length > 1 && (
          <section className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Last {history.length} checks</h2>
              <span className="text-[11px] text-muted-foreground">
                {history.filter((h) => h.ok).length}/{history.length} healthy
              </span>
            </div>
            <div className="mt-3 flex h-9 items-end gap-[3px]" role="img" aria-label="Recent health samples">
              {history.map((sample, index) => (
                <span
                  key={`${sample.at}-${index}`}
                  title={`${new Date(sample.at).toLocaleTimeString()} · ${sample.ok ? 'healthy' : 'issue reported'}`}
                  className={cn('w-full flex-1 rounded-sm', sample.ok ? 'bg-success/70' : 'bg-destructive/70')}
                  style={{ height: sample.ok ? '55%' : '100%' }}
                />
              ))}
            </div>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Payouts and verification</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{site.payoutSla}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Maintenance windows pause new actions only. Balances, applications and verification results
            are stored transactionally and are never reset by an upgrade.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Button render={<Link href="/" />} size="sm" className="gap-1.5">
              Back to the app
              <ArrowRight className="size-3.5" />
            </Button>
            <Button render={<a href={`mailto:${site.supportEmail}`} />} variant="outline" size="sm" className="gap-1.5">
              <Mail className="size-3.5" />
              {site.supportEmail}
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>
            © {new Date().getFullYear()} {site.legalName}
          </p>
          <p className="font-mono">
            {health ? `${health.checks.length} checks · ${overall}` : 'offline'}
          </p>
        </div>
      </footer>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}
