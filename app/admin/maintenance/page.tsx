'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  Eye,
  Info,
  Mail,
  MonitorPlay,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Wrench,
  Zap,
} from 'lucide-react'
import { adminApi, useAdminSession } from '@/lib/admin'
import { AdminCard, Field, LiveDot, useToasts, inputClass } from '@/components/admin-ui'
import { MaintenanceScreen } from '@/components/maintenance-screen'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'
import { site } from '@/lib/site'
import type { MaintenanceConfig, MaintenanceService, MaintenanceView } from '@/lib/maintenance-shared'
import { INERT_MAINTENANCE_VIEW } from '@/lib/maintenance-shared'

/**
 * Maintenance mode control.
 *
 * Three things changed versus the previous version of this page:
 *  • It saves through `PUT /api/admin/maintenance` instead of writing the Firestore document from the
 *    browser, so the change is validated, permission-checked and audited in one place.
 *  • A blackout now means something: the middleware answers gated traffic with 503 + Retry-After.
 *    "Banner" mode exists for the common case where the site is usable but degraded, and does not
 *    lock workers out of jobs they are mid-way through.
 *  • Windows can be scheduled and auto-resolve on the ETA, so an upgrade at 02:00 does not require
 *    someone to remember to switch it back off at 04:00.
 */

const SERVICE_LABELS: Record<string, string> = {
  jobs: 'Jobs & applications',
  wallet: 'Wallet & payouts',
  kyc: 'ID verification',
  training: 'Training & payments',
}

const SERVICE_STATUSES = ['operational', 'degraded', 'maintenance', 'outage'] as const

export default function AdminMaintenancePage() {
  const session = useAdminSession()
  const { push, toasts } = useToasts()

  const [config, setConfig] = useState<MaintenanceConfig | null>(null)
  const [status, setStatus] = useState<{ active: boolean; bannerOnly: boolean; pending: boolean; retryAfterSec: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [forced, setForced] = useState(false)

  // Editable copy of the config.
  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<'blackout' | 'banner'>('blackout')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [banner, setBanner] = useState('')
  const [reason, setReason] = useState('scheduled_upgrade')
  const [estimatedEnd, setEstimatedEnd] = useState('')
  const [scheduledStart, setScheduledStart] = useState('')
  const [autoResolve, setAutoResolve] = useState(true)
  const [allowSignIn, setAllowSignIn] = useState(true)
  const [contactEmail, setContactEmail] = useState('')
  const [allowedEmailsText, setAllowedEmailsText] = useState('')
  const [services, setServices] = useState<MaintenanceService[]>([])

  const load = useCallback(async () => {
    try {
      const data = await adminApi.maintenance()
      const cfg = data.config
      setForced(data.forced === true)
      setConfig(cfg)
      setStatus(data.status as typeof status)
      setEnabled(cfg.enabled)
      setMode(cfg.mode)
      setTitle(cfg.title)
      setMessage(cfg.message)
      setBanner(cfg.banner)
      setReason(cfg.reason)
      setEstimatedEnd(cfg.estimatedEnd ? toLocalInput(cfg.estimatedEnd) : '')
      setScheduledStart(cfg.scheduledStart ? toLocalInput(cfg.scheduledStart) : '')
      setAutoResolve(cfg.autoResolve)
      setAllowSignIn(cfg.allowSignIn)
      setContactEmail(cfg.contactEmail)
      setAllowedEmailsText((cfg.allowedEmails ?? []).join('\n'))
      setServices(cfg.affectedServices ?? [])
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Could not load maintenance settings.')
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    if (session.status === 'authorized') void load()
  }, [session.status, load])

  const dirty = useMemo(() => {
    if (!config) return false
    const emails = parseEmails(allowedEmailsText)
    return (
      enabled !== config.enabled ||
      mode !== config.mode ||
      title.trim() !== config.title ||
      message.trim() !== config.message ||
      banner.trim() !== config.banner ||
      reason !== config.reason ||
      toUtc(estimatedEnd) !== config.estimatedEnd ||
      toUtc(scheduledStart) !== config.scheduledStart ||
      autoResolve !== config.autoResolve ||
      allowSignIn !== config.allowSignIn ||
      contactEmail.trim().toLowerCase() !== (config.contactEmail ?? '') ||
      emails.join(',') !== (config.allowedEmails ?? []).join(',') ||
      JSON.stringify(services) !== JSON.stringify(config.affectedServices ?? [])
    )
  }, [config, enabled, mode, title, message, banner, reason, estimatedEnd, scheduledStart, autoResolve, allowSignIn, contactEmail, allowedEmailsText, services])

  const previewView: MaintenanceView = useMemo(
    () => ({
      ...INERT_MAINTENANCE_VIEW,
      enabled: true,
      blocking: enabled && mode === 'blackout',
      bannerOnly: enabled && mode === 'banner',
      mode,
      title: title || INERT_MAINTENANCE_VIEW.title,
      message: message || '',
      banner,
      estimatedEnd: toUtc(estimatedEnd),
      remainingMs: toUtc(estimatedEnd) ? Math.max(0, new Date(toUtc(estimatedEnd) as string).getTime() - Date.now()) : null,
      contactEmail: contactEmail || site.supportEmail,
      services,
      version: config?.version ?? 0,
      raw: config ?? INERT_MAINTENANCE_VIEW.raw,
      unknown: false,
    }),
    [enabled, mode, title, message, banner, estimatedEnd, contactEmail, services, config],
  )

  const save = async () => {
    setSaving(true)
    try {
      const result = await adminApi.saveMaintenance({
        enabled,
        mode,
        title: title.trim(),
        message: message.trim(),
        banner: banner.trim(),
        reason: reason as MaintenanceConfig['reason'],
        estimatedEnd: toUtc(estimatedEnd),
        scheduledStart: toUtc(scheduledStart),
        autoResolve,
        allowSignIn,
        contactEmail: contactEmail.trim(),
        allowedEmails: parseEmails(allowedEmailsText),
        affectedServices: services,
      })
      setConfig(result.config)
      setStatus(result.effective as typeof status)
      if (result.warning) push('warning', result.warning, 9000)
      push(
        'success',
        `${enabled ? 'Maintenance saved' : 'Settings saved'}${result.changed?.length ? ` · ${result.changed.length} field${result.changed.length === 1 ? '' : 's'} updated` : ''} · live immediately for all sessions.`,
      )
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Save failed — nothing was changed.')
    } finally {
      setSaving(false)
    }
  }

  const applyPreset = async (minutes: number | null) => {
    if (minutes === null) {
      setEnabled(false)
      setEstimatedEnd('')
      setScheduledStart('')
      return
    }
    const target = new Date(Date.now() + minutes * 60_000)
    setEnabled(true)
    setMode('blackout')
    setEstimatedEnd(toLocalInput(target.toISOString()))
    setAutoResolve(true)
  }

  const setServiceStatus = (id: string, next: (typeof SERVICE_STATUSES)[number]) => {
    setServices((prev) => {
      const exists = prev.some((s) => s.id === id)
      const base = exists ? prev : Object.entries(SERVICE_LABELS).map(([key, label]) => ({ id: key, label, status: 'operational' as const }))
      return base.map((s) => (s.id === id ? { ...s, status: next } : s))
    })
  }

  const servicesForPreview = services.length ? services : Object.entries(SERVICE_LABELS).map(([id, label]) => ({ id, label, status: 'operational' as const }))

  return (
    <div className="flex flex-col gap-5">
      {toasts}

      {forced && (
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/35 bg-destructive/[0.07] p-3.5 text-xs text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            An emergency override is active: <code className="font-mono">MAINTENANCE_FORCE</code> is set in the deployment environment and takes precedence over everything on
            this page. Saving changes the stored settings, but traffic stays gated until that variable is removed in the platform’s environment settings.
          </span>
        </div>
      )}

      {/* Hero switch */}
      <div
        className={cn(
          'flex flex-col gap-4 rounded-2xl border p-4 shadow-sm transition-colors sm:flex-row sm:items-center sm:justify-between sm:p-5',
          status?.active ? 'border-amber-500/40 bg-amber-500/[0.09]' : status?.bannerOnly ? 'border-warning/40 bg-warning/[0.08]' : 'border-success/30 bg-success/[0.07]',
        )}
      >
        <div className="flex items-start gap-3.5">
          <div className={cn('shrink-0 rounded-xl p-2.5', status?.active ? 'bg-amber-500/20 text-amber-600' : 'bg-success/15 text-success')}>
            {status?.active ? <Wrench className="size-6 animate-pulse" /> : <CheckCircle2 className="size-6" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">
                {status?.active ? 'Blackout window active' : status?.bannerOnly ? 'Banner mode active' : 'Platform fully open'}
              </h1>
              {status?.pending && <StatusBadge tone="info">Scheduled, not started</StatusBadge>}
              {status?.active && <StatusBadge tone="warning">Traffic rejected with 503</StatusBadge>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {status?.active
                ? `Workers see the maintenance screen. Console access and staff bypass stay open${
                    status.retryAfterSec ? `; clients are told to retry in ${Math.round(status.retryAfterSec / 60)} min` : ''
                  }.`
                : 'Members can sign in, browse jobs, submit work and receive payouts normally.'}
            </p>
            {config && (
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <LiveDot tone={enabled ? 'warning' : 'success'} />
                v{config.version} · last saved {config.updatedAt ? new Date(config.updatedAt).toLocaleString() : 'never'} by {config.updatedBy || 'System'}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2.5">
            <span className="text-xs font-semibold text-foreground">{enabled ? 'On' : 'Off'}</span>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="sr-only peer" />
            <span className="relative h-7 w-14 rounded-full bg-muted transition-colors after:absolute after:left-[3px] after:top-[3px] after:size-[22px] after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:bg-amber-500 peer-checked:after:translate-x-[26px]" />
          </label>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            Reload
          </Button>
        </div>
      </div>

      {/* Quick presets */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Zap className="size-3.5 text-primary" />
          Presets
        </span>
        {(
          [
            ['30 minute window', 30],
            ['2 hour window', 120],
            ['Overnight (8h)', 480],
          ] as const
        ).map(([label, minutes]) => (
          <button
            key={label}
            type="button"
            onClick={() => void applyPreset(minutes)}
            className="rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void applyPreset(null)}
          className="rounded-lg border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success transition-colors hover:bg-success/20"
        >
          Clear window
        </button>
        {status?.active && (
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto gap-1.5"
            onClick={async () => {
              try {
                const result = await adminApi.disableMaintenance()
                if (result.warning) push('warning', result.warning, 9000)
                else push('success', 'Maintenance disabled — traffic is flowing again.')
                await load()
              } catch (err) {
                push('error', err instanceof Error ? err.message : 'Could not disable maintenance.')
              }
            }}
          >
            <Power className="size-3.5" />
            Emergency: switch off now
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        {/* Copy + timing */}
        <div className="flex flex-col gap-4">
          <AdminCard title="Public notice" description="What workers read during the window. Keep it specific: what, when, and what to do." icon={<BellRing className="size-4" />}>
            <div className="flex flex-col gap-4">
              <Field label="Heading" hint="Shown as the page title — state the reason, not the word “maintenance”.">
                <input value={title} maxLength={90} onChange={(event) => setTitle(event.target.value)} placeholder="Upgrading payout settlement" className={inputClass} />
              </Field>

              <Field label="Explanation" hint={`${message.length}/900 characters.`}>
                <textarea rows={4} value={message} maxLength={900} onChange={(event) => setMessage(event.target.value)} placeholder="We are rebalancing the payout queue…" className={cn(inputClass, 'leading-relaxed')} />
              </Field>

              <Field label="Banner copy (used in banner mode)" hint="One line for the in-app strip; the platform stays usable in banner mode.">
                <input value={banner} maxLength={200} onChange={(event) => setBanner(event.target.value)} placeholder="Payouts are delayed by ~1 hour today." className={inputClass} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Reason code">
                  <select value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass}>
                    <option value="scheduled_upgrade">Scheduled upgrade</option>
                    <option value="payment_settlement">Payment settlement run</option>
                    <option value="fraud_review">Fraud / QA review</option>
                    <option value="security_patch">Security patching</option>
                    <option value="outage">Unplanned outage</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Mode" hint="Blackout blocks everything but the console; banner warns and keeps working.">
                  <div className="flex gap-2">
                    {(['blackout', 'banner'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        className={cn(
                          'flex-1 rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition-colors',
                          mode === value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </div>
          </AdminCard>

          <AdminCard title="Timing & access" description="Scheduled start, ETA, and who gets through." icon={<Clock3 className="size-4" />}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start at (optional)" hint="Leave empty to switch on immediately when you save.">
                  <input type="datetime-local" value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} className={cn(inputClass, 'font-mono')} />
                </Field>
                <Field label="Expected back online" hint="Drives the countdown, Retry-After and auto-resolve.">
                  <input type="datetime-local" value={estimatedEnd} onChange={(event) => setEstimatedEnd(event.target.value)} className={cn(inputClass, 'font-mono')} />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-background/50 p-3">
                  <input type="checkbox" checked={autoResolve} onChange={(event) => setAutoResolve(event.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
                  <span>
                    <span className="block text-xs font-semibold text-foreground">Auto-resolve at the ETA</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">The gate lifts itself when the expected end time passes — no 3am pager for the switch-back.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-background/50 p-3">
                  <input type="checkbox" checked={allowSignIn} onChange={(event) => setAllowSignIn(event.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
                  <span>
                    <span className="block text-xs font-semibold text-foreground">Keep sign-in & KYC callbacks open</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Lets verification flows finish mid-window instead of stranding a session.</span>
                  </span>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Support contact shown on the screen" hint={`Defaults to ${site.supportEmail} when blank.`}>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                    <input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder={site.supportEmail} className={cn(inputClass, 'pl-9')} />
                  </div>
                </Field>
                <Field label="Bypass list (one email per line)" hint="These members keep full access during a blackout and are minted a signed bypass cookie.">
                  <textarea
                    rows={3}
                    value={allowedEmailsText}
                    onChange={(event) => setAllowedEmailsText(event.target.value)}
                    placeholder={'ops@afterworks.io\noncall@afterworks.io'}
                    className={cn(inputClass, 'font-mono text-[11px]')}
                  />
                </Field>
              </div>
            </div>
          </AdminCard>

          <AdminCard title="Service states" description="Shown on the maintenance screen and /status, so people see what is affected." icon={<ShieldCheck className="size-4" />}>
            <ul className="flex flex-col gap-2">
              {Object.entries(SERVICE_LABELS).map(([id, label]) => {
                const current = services.find((s) => s.id === id)?.status ?? 'operational'
                return (
                  <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/50 px-3 py-2">
                    <span className="text-xs font-medium text-foreground">{label}</span>
                    <div className="flex gap-1">
                      {SERVICE_STATUSES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setServiceStatus(id, value)}
                          className={cn(
                            'rounded-lg px-2 py-1 text-[11px] font-medium capitalize transition-colors',
                            current === value
                              ? value === 'operational'
                                ? 'bg-success/15 text-success'
                                : value === 'outage'
                                  ? 'bg-destructive/15 text-destructive'
                                  : 'bg-warning/20 text-warning-foreground'
                              : 'text-muted-foreground hover:bg-muted',
                          )}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          </AdminCard>
        </div>

        {/* Preview + save rail */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <AdminCard
            title="Preview"
            description="Exactly what a worker sees, rendered from the unsaved form."
            icon={<Eye className="size-4" />}
            actions={
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPreview((value) => !value)}>
                <MonitorPlay className="size-3.5" />
                {preview ? 'Hide' : 'Show'}
              </Button>
            }
          >
            {preview ? (
              <div className="overflow-hidden rounded-xl border border-border">
                <MaintenanceScreen config={{ ...previewView, services: servicesForPreview }} embedded />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Preview is hidden. Nothing here affects live traffic until you save.</p>
            )}
          </AdminCard>

          <AdminCard title="Save" description="Writes through the audited admin API — the browser never touches the config document directly." icon={<Save className="size-4" />}>
            <div className="flex flex-col gap-3">
              {!dirty ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Info className="size-3.5" />
                  No unsaved changes.
                </p>
              ) : (
                <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Unsaved changes will apply to every visitor the moment you save.
                </p>
              )}
              {enabled && mode === 'blackout' && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Blackout rejects page loads with <code className="font-mono">503</code> and a <code className="font-mono">Retry-After</code>, so queues, monitors and crawlers back
                  off instead of hammering the app.
                </p>
              )}
              <Button onClick={() => void save()} disabled={saving || !dirty || !config} size="lg" className="w-full gap-2">
                {saving ? <Loader /> : <Save className="size-4" />}
                {saving ? 'Saving…' : 'Save maintenance settings'}
              </Button>
              <Button render={<Link href="/status" />} variant="outline" size="sm" className="w-full justify-center gap-1.5">
                <ActivityIcon />
                Open public status page
              </Button>
            </div>
          </AdminCard>

          <AdminCard title="How the guard works" icon={<Info className="size-4" />} description="Useful when someone asks “why can I still get in?”">
            <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <li>• Middleware rejects gated document requests with 503 + Retry-After and rewrites to /maintenance.</li>
              <li>• /api routes return a retryable 503 so clients show a banner instead of a stack trace.</li>
              <li>• Console paths (/admin, /api/admin) are never blocked, so you can always switch it back off.</li>
              <li>• Staff with a valid session cookie, or an email on the bypass list, pass through.</li>
              <li>• Data is untouched: applications, wallets and KYC records keep their state.</li>
            </ul>
          </AdminCard>
        </div>
      </div>
    </div>
  )
}

function Loader() {
  return <RefreshCw className="size-4 animate-spin" />
}

function ActivityIcon() {
  return <Info className="size-3.5" />
}

function parseEmails(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

function toUtc(localValue: string): string | null {
  if (!localValue) return null
  const date = new Date(localValue)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
