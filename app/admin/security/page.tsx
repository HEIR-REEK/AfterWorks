'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  Cookie,
  KeyRound,
  Loader2,
  Lock,
  MonitorX,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Unlock,
  UserCheck,
  XCircle,
} from 'lucide-react'
import { adminApi, terminateAdminSession, useAdminCapabilities, useAdminSession, type ActiveAdminSession } from '@/lib/admin'
import { AdminCard, LiveDot, ReasonDialog, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'

/**
 * Security Centre.
 *
 * The console previously had no answer to "who can get in, for how long, and how do I stop them".
 * This page reads the same state the guards use — session validity and expiry, the roster and passcode
 * configuration, live lockouts, and the server's own posture checklist — and gives an operator two
 * real levers: revoke this session, or revoke every session issued before now.
 *
 * Nothing here edits secrets. Roster and passcode live in the deployment environment on purpose: a
 * database-editable allow-list turns one SQL/Firestore write into admin access.
 */

type Check = { id: string; label: string; severity: 'pass' | 'warn' | 'fail'; detail: string; fix?: string; docs?: string }
type Lockout = { key: string; until: number }

export default function AdminSecurityPage() {
  const session = useAdminSession()
  const capabilities = useAdminCapabilities()
  const { push, toasts } = useToasts()

  const [info, setInfo] = useState<Awaited<ReturnType<typeof adminApi.sessionInfo>> | null>(null)
  const [posture, setPosture] = useState<Check[]>([])
  const [lockouts, setLockouts] = useState<{ tracked: number; totalAttempts: number; totalBlocked: number; locked: Lockout[] } | null>(null)
  const [failures, setFailures] = useState<{ action: string; details?: Record<string, unknown>; actorEmail?: string; timestamp: string }[]>([])
  const [sessions, setSessions] = useState<ActiveAdminSession[]>([])
  const [sessionsDegraded, setSessionsDegraded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const [unlockTarget, setUnlockTarget] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ActiveAdminSession | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sessionInfo, stats, audit, liveSessions] = await Promise.all([
        adminApi.sessionInfo(),
        adminApi.stats(true).catch(() => null),
        adminApi.auditLogs({ limit: 40, action: 'ADMIN_LOGIN_FAILED' }).catch(() => null),
        adminApi.sessions().catch((err) => err),
      ])
      setInfo(sessionInfo)
      const security = ((stats as Record<string, unknown> | null)?.security ?? {}) as {
        posture?: Check[]
        lockouts?: { tracked: number; totalAttempts: number; totalBlocked: number; locked: Lockout[] }
      }
      setPosture(security.posture ?? [])
      setLockouts(security.lockouts ?? null)
      setFailures((audit?.logs as typeof failures) ?? [])
      if (liveSessions && Array.isArray((liveSessions as { sessions?: unknown }).sessions)) {
        setSessions((liveSessions as { sessions: ActiveAdminSession[] }).sessions)
        setSessionsDegraded(false)
      } else {
        setSessions([])
        setSessionsDegraded(true)
      }
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Security state is not readable right now.')
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    if (session.status === 'authorized') void load()
  }, [session.status, load])

  const fails = posture.filter((c) => c.severity === 'fail')
  const warns = posture.filter((c) => c.severity === 'warn')

  return (
    <div className="flex flex-col gap-4">
      {toasts}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Current session */}
        <AdminCard
          title="Your session"
          description="What the guard sees when you call a privileged endpoint."
          icon={<Cookie className="size-4" />}
          actions={
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              Reload
            </Button>
          }
        >
          {info?.authenticated ? (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Row label="Operator" value={info.email ?? '—'} mono />
                <Row label="Carrier" value={info.via === 'firebase-token' ? 'Firebase ID token' : 'HttpOnly cookie'} />
                <Row label="Expires" value={info.expiresAt ? new Date(info.expiresAt).toLocaleTimeString() : '—'} mono />
                <Row label="Time left" value={formatLeft(info.remainingSeconds ?? 0)} mono />
                <Row label="Session TTL" value={`${info.sessionMinutes ?? capabilities?.sessionMinutes ?? '—'} min`} />
                <Row label="SameSite" value="strict" />
              </dl>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The privilege lives only in a <code className="font-mono">HttpOnly</code>, <code className="font-mono">SameSite=strict</code> cookie, so page scripts cannot read
                it and a cross-site form cannot send it. Signing out revokes the token id server-side, which is why a copied token dies too.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await terminateAdminSession()
                      push('info', 'This session was revoked and the cookie cleared. Sign in again to continue.')
                      await session.refresh()
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Sign out this session
                </Button>
                <Button variant="destructive" size="sm" disabled={busy} onClick={() => setShowRevoked(true)}>
                  Revoke all console sessions
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No valid session could be resolved. Sign in at /admin/login.</p>
          )}
        </AdminCard>

        {/* Configuration */}
        <AdminCard title="Access configuration" description="How accounts are allowed in at all." icon={<KeyRound className="size-4" />}>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Row label="Roster (ADMIN_EMAILS)" value={capabilities?.rosterConfigured ? 'Configured' : 'Not set — passcode sign-in is off'} tone={capabilities?.rosterConfigured ? 'ok' : 'warn'} />
            <Row label="Passcode" value={capabilities?.passcodeEnabled ? 'Verifier configured' : 'Fallback: Firebase claim only'} tone={capabilities?.passcodeEnabled ? 'ok' : 'warn'} />
            <Row label="Console" value={capabilities?.consoleEnabled ? 'Enabled' : 'Disabled — no session secret'} tone={capabilities?.consoleEnabled ? 'ok' : 'fail'} />
            <Row label="Failures before lock" value={`${capabilities?.lockoutThreshold ?? '—'} per ${capabilities?.lockoutMinutes ?? '—'} min`} />
            <Row label="Bypass cookie" value="aw_ops_bypass · 12 h · maintenance only" mono />
            <Row label="Client-side admin truth" value="none — server decides" tone="ok" />
          </dl>

          <div className="mt-3 rounded-xl border border-border/70 bg-background/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Terminal className="size-3.5" />
              Rotate the passcode
            </p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
{`node scripts/hash-admin-password.mjs
# prints ADMIN_PASSWORD_SCRYPT="scrypt$16384$8$1$<salt>$<hash>"
# set it in the deploy env, redeploy, then revoke all sessions`}
            </pre>
          </div>
        </AdminCard>
      </div>

      {/* Active sessions — who is currently inside the console */}
      <AdminCard
        title="Active console sessions"
        description="Every signed, unexpired admin cookie issued on this deployment. Revoking one device kills only that token."
        icon={<MonitorX className="size-4" />}
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      >
        {sessionsDegraded ? (
          <p className="text-xs text-muted-foreground">
            Live sessions are unavailable on this deployment (the Admin SDK is not connected). Revocation still works;
            only the listing is off.
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No active sessions recorded. New sign-ins appear here; records expire with the cookie.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-muted-foreground">
              {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} · “idle” is time since the last verified
              request · addresses are stored only as HMAC/FNV digests.
            </p>
            <ul className="flex flex-col gap-1.5">
              {sessions.slice(0, 20).map((s) => (
                <li
                  key={s.jti}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border px-3 py-2',
                    s.current ? 'border-primary/40 bg-primary/[0.06]' : 'border-border/70 bg-background/50',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">
                      <span className="truncate">{s.email}</span>
                      {s.current && (
                        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                          this device
                        </span>
                      )}
                      {s.idleSeconds > 30 * 60 && !s.current && (
                        <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning-foreground">
                          idle
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {describeUA(s.userAgent)} · ip {s.ipHash || '—'}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      signed {new Date(s.issuedAt).toLocaleString()} · last seen {formatAgo(s.idleSeconds)} ago · expires in {formatLeft(s.remainingSeconds)}
                    </p>
                  </div>
                  {!s.current && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRevokeTarget(s)}
                      className="shrink-0 rounded-lg border border-destructive/30 px-2 py-1 text-[11px] font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </AdminCard>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Posture */}
        <AdminCard
          title="Server posture"
          description="Recomputed on every metrics refresh — the checks the guard actually relies on."
          icon={<Shield className="size-4" />}
          actions={
            <div className="flex items-center gap-2">
              {fails.length > 0 && <StatusBadge tone="danger">{fails.length} blocking</StatusBadge>}
              {warns.length > 0 && <StatusBadge tone="warning">{warns.length} to review</StatusBadge>}
              {fails.length === 0 && warns.length === 0 && <StatusBadge tone="success">All clear</StatusBadge>}
            </div>
          }
        >
          <ul className="flex flex-col gap-1.5">
            {posture.length === 0 ? (
              <li className="text-xs text-muted-foreground">No checks returned — the metrics endpoint may be unavailable on this deployment.</li>
            ) : (
              posture.map((check) => (
                <li key={check.id} className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-background/50 px-3 py-2">
                  {check.severity === 'pass' ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : check.severity === 'fail' ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  ) : (
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{check.label}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{check.detail}</p>
                    {check.fix && (
                      <p className="mt-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                        <strong className="font-semibold">Fix:</strong> {check.fix}
                      </p>
                    )}
                  </div>
                </li>
              ))
            )}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5">
            <LiveDot tone={loading ? 'warning' : 'success'} label={loading ? 'reloading…' : 'current'} />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  setHealth(await adminApi.health())
                } catch {
                  push('error', 'The health endpoint did not answer.')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <UserCheck className="size-3.5" />
              Run live self-test
            </Button>
          </div>
          {health && (
            <pre className="mt-2 max-h-52 overflow-auto rounded-xl border border-border/70 bg-background/70 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
{JSON.stringify(health, null, 2)}
            </pre>
          )}
        </AdminCard>

        <div className="flex flex-col gap-4">
          {/* Lockouts */}
          <AdminCard title="Live lockouts" description="Sign-in budgets currently in the shade, per IP and per account." icon={<Lock className="size-4" />}>
            {!lockouts || lockouts.tracked === 0 ? (
              <p className="text-xs text-muted-foreground">Nobody is throttled. {lockouts?.totalBlocked ?? 0} blocked attempts recorded since this process started.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {lockouts.tracked} tracked · {lockouts.totalAttempts} attempts · {lockouts.totalBlocked} blocked · {lockouts.locked.length} locked out
                </p>
                <ul className="flex flex-col gap-1.5">
                  {lockouts.locked.slice(0, 6).map((entry) => (
                    <li key={entry.key} className="flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{entry.key}</span>
                      <span className="font-mono text-[11px] text-destructive">{Math.max(0, Math.round((entry.until - Date.now()) / 1000))}s</span>
                      <button type="button" onClick={() => setUnlockTarget(entry.key)} className="text-[11px] font-semibold text-primary hover:underline">
                        Clear
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Keys are HMAC digests of the IP or normalised email — the ledger never stores the raw address. Clearing is audited as{' '}
                  <code className="font-mono">ADMIN_LOCKOUT_CLEARED</code>.
                </p>
              </div>
            )}
          </AdminCard>

          {/* Failures */}
          <AdminCard
            title="Recent sign-in failures"
            description="Last attempts the server refused."
            icon={<ShieldAlert className="size-4" />}
            actions={
              <Button render={<Link href="/admin/audit-log" />} variant="ghost" size="sm" className="text-[11px]">
                Full log
              </Button>
            }
          >
            {failures.length === 0 ? (
              <p className="text-xs text-muted-foreground">No failed attempts in the ledger. That is the normal state.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border/60">
                {failures.slice(0, 8).map((row, index) => (
                  <li key={`${row.timestamp}-${index}`} className="flex items-center gap-2 py-1.5 text-[11px]">
                    <Lock className="size-3 shrink-0 text-destructive" />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {String(row.details?.reason ?? 'rejected')}
                      {row.details?.emailFragment ? ` · ${String(row.details.emailFragment)}` : ''}
                    </span>
                    <time className="shrink-0 font-mono text-muted-foreground/80">{row.timestamp ? new Date(row.timestamp).toLocaleString() : ''}</time>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          {/* Static guarantees */}
          <AdminCard title="What the guards enforce" icon={<ShieldCheck className="size-4" />} description="Not configurable from this page — by design.">
            <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <li>• Every privileged route re-verifies signature, expiry, revocation and roster membership; a valid session alone is not enough.</li>
              <li>• Mutating requests must be same-site (Sec-Fetch-Site, then Origin/Referer); cross-site fetches are rejected before any write.</li>
              <li>• Audit entries are redacted and size-capped on write, and members cannot write <code className="font-mono">admin_logs</code> from a client.</li>
              <li>• Maintenance blackout returns 503 with Retry-After everywhere except the console, so the switch-off is always reachable.</li>
              <li>• Wallet and payout math is server-derived; the browser never sends an amount that gets trusted.</li>
            </ul>
          </AdminCard>
        </div>
      </div>

      <ReasonDialog
        open={!!unlockTarget}
        title="Clear a lockout"
        description="Removes the throttling counters matching this key. Do it when a legitimate operator locked themselves out; the action is audited."
        confirmLabel="Clear lockout"
        tone="default"
        busy={busy}
        requireReason
        onCancel={() => setUnlockTarget(null)}
        onConfirm={async (reason) => {
          if (!unlockTarget) return
          setBusy(true)
          try {
            await adminApi.operatorAction({ action: 'unlock', fragment: unlockTarget.slice(-8), reason })
            push('success', 'Lockout cleared.')
            setUnlockTarget(null)
            await load()
          } catch (err) {
            push('error', err instanceof Error ? err.message : 'Could not clear it.')
          } finally {
            setBusy(false)
          }
        }}
      />

      <ReasonDialog
        open={showRevoked}
        title="Revoke every console session"
        description="Immediately invalidates all administrator sessions issued before now — including yours. Use it after a suspected token leak, a departed operator, or a machine that may have held a copy. The bypass cookie for maintenance is also revoked. Your reason is written to the audit ledger."
        confirmLabel="Revoke all sessions"
        tone="destructive"
        busy={busy}
        requireReason
        onCancel={() => setShowRevoked(false)}
        onConfirm={async (reason) => {
          setBusy(true)
          try {
            const result = await adminApi.operatorAction({ action: 'revoke-sessions', reason })
            push('success', (result as { note?: string }).note ?? 'All previous sessions are invalid.')
            setShowRevoked(false)
            await session.refresh()
            await load()
          } catch (err) {
            push('error', err instanceof Error ? err.message : 'Revocation failed — nobody was locked out.')
          } finally {
            setBusy(false)
          }
        }}
      />

      <ReasonDialog
        open={!!revokeTarget}
        title="Revoke this session"
        description={
          revokeTarget
            ? `Immediately signs out ${revokeTarget.email} on ${describeUA(revokeTarget.userAgent) || 'that device'} (signed in ${new Date(revokeTarget.issuedAt).toLocaleString()}). Their current cookie stops working on the next request; other sessions are unaffected. Your reason is audited.`
            : ''
        }
        confirmLabel="Revoke session"
        tone="destructive"
        busy={busy}
        requireReason
        onCancel={() => setRevokeTarget(null)}
        onConfirm={async (reason) => {
          if (!revokeTarget) return
          setBusy(true)
          try {
            await adminApi.operatorAction({ action: 'revoke-session', jti: revokeTarget.jti, reason })
            push('success', 'That session was revoked.')
            setRevokeTarget(null)
            await load()
          } catch (err) {
            push('error', err instanceof Error ? err.message : 'Could not revoke that session.')
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

function describeUA(ua: string): string {
  if (!ua) return 'unknown device'
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua)
  let browser = 'browser'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua)) browser = 'Safari'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'device'
  return `${browser} on ${os}${isMobile ? ' (mobile)' : ''}`
}

function formatAgo(seconds: number): string {
  if (!seconds || seconds <= 0) return 'just now'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d`
}

function Row({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: 'ok' | 'warn' | 'fail' }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/50 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-xs font-medium',
          mono && 'font-mono text-[11px]',
          tone === 'ok' && 'text-success',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
          tone === 'fail' && 'text-destructive',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function formatLeft(seconds: number): string {
  if (!seconds || seconds <= 0) return 'expired'
  const m = Math.floor(seconds / 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m ${String(seconds % 60).padStart(2, '0')}s`
}
