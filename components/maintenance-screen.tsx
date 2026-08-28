'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Mail,
  RefreshCw,
  ShieldAlert,
  AlertTriangle,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { site } from '@/lib/site'
import type { MaintenanceView } from '@/lib/maintenance-shared'
import { BrandMark } from '@/components/brand'

/**
 * The maintenance screen a worker sees during a blackout.
 *
 * Requirements this version meets (the old one failed most of them):
 *  • states *when* we come back, from the same field the server used for `Retry-After`;
 *  • says what is affected and what is not, instead of a generic "we'll be back";
 *  • gives a real contact route (support address from config, not `support@example.com`);
 *  • tells the truth about the outage feed when it cannot be reached — "unknown" is shown rather
 *    than defaulting to "everything is fine";
 *  • keeps the site theme (same tokens, card language and type scale as the rest of the product).
 */

function serviceTone(status: string): 'success' | 'warning' | 'info' | 'danger' {
  if (status === 'operational') return 'success'
  if (status === 'outage') return 'danger'
  if (status === 'degraded') return 'warning'
  return 'info'
}

function useCountdown(remainingMs: number | null): { label: string; expired: boolean } {
  const [state, setState] = useState(() => formatRemaining(remainingMs))

  useEffect(() => {
    if (remainingMs === null) {
      setState({ label: '', expired: false })
      return
    }
    const deadline = Date.now() + remainingMs
    const tick = () => {
      setState(formatRemaining(Math.max(0, deadline - Date.now())))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [remainingMs])

  return { ...state, expired: remainingMs !== null && state.expired }
}

function formatRemaining(ms: number | null): { label: string; expired: boolean } {
  if (ms === null) return { label: '', expired: false }
  if (ms <= 0) return { label: 'Finishing up…', expired: true }
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    label: hours > 0 ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s` : `${minutes}m ${pad(seconds)}s`,
    expired: false,
  }
}

export function MaintenanceScreen({
  config,
  onRefresh,
  embedded = false,
}: {
  config: MaintenanceView
  onRefresh?: () => void
  /** true when rendered inside the app chrome rather than as the full-page takeover. */
  embedded?: boolean
}) {
  const [checking, setChecking] = useState(false)
  const { label: countdown, expired } = useCountdown(config.remainingMs)

  const etaLabel = useMemo(() => {
    if (!config.estimatedEnd) return null
    const date = new Date(config.estimatedEnd)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat('en-KE', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).format(date)
  }, [config.estimatedEnd])

  const contact = config.contactEmail || site.supportEmail
  const unknown = config.unknown

  const handleRefresh = () => {
    setChecking(true)
    if (onRefresh) onRefresh()
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setChecking(false)
        window.location.reload()
      }, 600)
    }
  }

  return (
    <div
      className={
        embedded
          ? 'relative flex min-h-[70dvh] flex-col items-center justify-center p-4'
          : 'relative flex min-h-dvh flex-col items-center justify-between overflow-hidden bg-gradient-to-b from-background via-muted/40 to-background p-4 sm:p-6 md:p-8'
      }
    >
      <div className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-[0.06]" aria-hidden />

      {!embedded && (
        <header className="z-10 flex w-full max-w-4xl items-center justify-between py-3">
          <div className="flex items-center gap-2.5">
            <BrandMark size={40} />
            <span className="text-base font-semibold tracking-tight sm:text-lg">{site.name}</span>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <span className="size-2 rounded-full bg-amber-500 animate-blink" />
            Maintenance in progress
          </span>
        </header>
      )}

      <main className="z-10 my-auto flex w-full max-w-xl flex-col items-center text-center">
        <div className="relative mb-5 flex size-20 items-center justify-center rounded-3xl border border-amber-500/25 bg-amber-500/10 shadow-sm sm:size-24">
          <Wrench className="size-9 text-amber-600 sm:size-11 dark:text-amber-400" />
        </div>

        <h1 className="text-pretty text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">
          {config.blocksAll
            ? config.title || 'Under scheduled maintenance'
            : `This part of ${site.name} is under maintenance`}
        </h1>

        {!config.blocksAll && config.blockedPaths.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider">Paused paths</span>
            {config.blockedPaths.map((path) => (
              <code key={path} className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono">
                {path}
              </code>
            ))}
          </p>
        )}

        <p className="mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
          {config.message ||
            "We're upgrading the AfterWorks platform. Your balance, applications and verification status are untouched."}
        </p>

        {unknown && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning-foreground">
            <AlertTriangle className="size-3.5" />
            We cannot confirm the exact end time right now. Retrying automatically.
          </p>
        )}

        {config.estimatedEnd && !unknown && (
          <div className="mt-6 w-full rounded-2xl border border-border bg-card/80 p-4 text-left shadow-sm backdrop-blur sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Clock3 className="size-3.5 text-primary" />
                Expected back online
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {etaLabel ?? 'Shortly'}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(your time)</span>
              </p>
            </div>
            <p className={`mt-2 font-mono text-2xl font-semibold tabular sm:mt-0 ${expired ? 'text-success' : 'text-primary'}`}>
              {expired ? 'Almost done' : countdown}
            </p>
          </div>
        )}

        {/* What is and isn't affected — the part workers actually need. */}
        {config.services.length > 0 && (
          <ul className="mt-6 w-full space-y-2 text-left">
            {config.services.map((service) => (
              <li key={service.id} className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{service.label}</p>
                  {service.note && <p className="mt-0.5 text-xs text-muted-foreground">{service.note}</p>}
                </div>
                <StatusBadge tone={serviceTone(service.status)}>
                  {service.status === 'operational'
                    ? 'Unaffected'
                    : service.status === 'maintenance'
                      ? 'Paused'
                      : service.status === 'degraded'
                        ? 'Degraded'
                        : 'Down'}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-7 flex w-full flex-wrap items-center justify-center gap-2.5">
          <Button onClick={handleRefresh} disabled={checking} size="lg" className="gap-2">
            <RefreshCw className={`size-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Check if we are back'}
          </Button>
          <Button render={<Link href="/status" />} variant="outline" size="lg" className="gap-2">
            <Activity className="size-4" />
            Live status
          </Button>
          <Button render={<Link href={`mailto:${contact}`} />} variant="ghost" size="lg" className="gap-2 text-muted-foreground">
            <Mail className="size-4" />
            Contact support
          </Button>
        </div>

        <div className="mt-8 grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
          <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 p-3 text-xs text-muted-foreground">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <span>Wallet balances, pending payouts and job history are safe — a maintenance window never rolls data back.</span>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 p-3 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              We will never ask you to “re-verify” over email or WhatsApp during maintenance. Anything claiming otherwise is a scam.
            </span>
          </div>
        </div>

        <Link
          href="/admin/login"
          className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Staff sign in
          <ArrowRight className="size-3.5" />
        </Link>
      </main>

      {!embedded && (
        <footer className="z-10 mt-8 flex w-full max-w-4xl flex-col items-center justify-between gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground sm:flex-row">
          <p>
            © {new Date().getFullYear()} {site.legalName}
          </p>
          <div className="flex items-center gap-4">
            <Link href={site.statusUrl} className="hover:text-foreground">
              Platform status
            </Link>
            <a href={`mailto:${contact}`} className="flex items-center gap-1 hover:text-foreground">
              <Mail className="size-3.5" />
              {contact}
            </a>
          </div>
        </footer>
      )}
    </div>
  )
}
