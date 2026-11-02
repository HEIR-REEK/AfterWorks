'use client'

/**
 * The referral panel.
 *
 * Everything on screen is fetched from `GET /api/referrals`, which computes it on the server
 * from the attribution documents and the wallet ledger. The page never derives a total, a status
 * or a bonus from anything it was told — if the panel says $3, it is because the server wrote
 * $3 into a ledger row, and the same row is what the wallet panel and the clearing pass read.
 *
 * The terms are shown here in full, not behind a link, because "what does this link actually do
 * to my friend" is the question a member is asking when they open this page. They come from the
 * same `REFERRAL_TERMS` the terms page and the server render.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  Info,
  Loader2,
  RefreshCw,
  Share2,
  UserPlus,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { useAuth } from '@/components/firebase-auth-provider'
import { formatUsd } from '@/lib/afterworks-data'
import { authedFetch, describeError } from '@/lib/client-api'
import { site } from '@/lib/site'
import { cn } from '@/lib/utils'
import {
  REFERRAL_ATTACH_WINDOW_DAYS,
  REFERRAL_STATUS_HINT,
  REFERRAL_STATUS_LABEL,
  normaliseReferralCode,
  type ReferralDashboard,
  type ReferralRow,
} from '@/lib/referrals'

type DashboardResponse = ReferralDashboard & { terms?: { title: string; body: string }[] }

function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ReferralRowItem({ row }: { row: ReferralRow }) {
  const qualified = row.status === 'qualified'
  return (
    <li className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.referredName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Signed up {when(row.createdAt)}
          {qualified ? ` · qualified ${when(row.qualifiedAt)}` : ' · has not finished their profile'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <StatusBadge tone={qualified ? 'success' : 'warning'}>{REFERRAL_STATUS_LABEL[row.status]}</StatusBadge>
        <span
          className={cn(
            'w-16 text-right text-sm font-semibold tabular-nums',
            qualified ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {qualified ? `+${formatUsd(row.bonusUsd)}` : `—`}
        </span>
      </div>
    </li>
  )
}

function claimErrorMessage(reason: string | undefined): string {
  switch (reason) {
    case 'unknown_referral_code':
      return 'That referral code was not found. Check the letters and try again.'
    case 'already_referred':
      return 'This account is already linked to a referrer. A referral cannot be moved to someone else.'
    case 'self_referral':
      return 'You cannot use your own referral code.'
    case 'referrer_restricted':
      return 'That referrer\'s account is not active, so their code cannot be accepted right now.'
    case 'referral_rate_limited':
      return 'That referrer has reached their weekly invitation limit. Try again next week.'
    case 'referral_window_closed':
      return `Referral codes can only be added within ${REFERRAL_ATTACH_WINDOW_DAYS} days of creating your account.`
    case 'rate_limited':
      return 'Too many attempts. Wait a minute and try again.'
    case 'rate_limit_unavailable':
      return 'We could not check that code safely just now. Please try again in a minute.'
    default:
      return 'That code could not be attached. Check it and try again, or contact support if it keeps failing.'
  }
}

export default function ReferralsPage() {
  const { user, configured } = useAuth()
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!user || !configured) {
      setLoading(false)
      return
    }
    if (!quiet) setLoading(true)
    try {
      const res = await authedFetch<DashboardResponse>('/api/referrals')
      setData(res)
      setError(null)
    } catch (err) {
      setError(describeError(err))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [user, configured])

  useEffect(() => {
    void load()
  }, [load])

  // Referral qualification and wallet credits are written server-side. Refresh this summary when
  // the member returns to the tab and periodically while it stays open so a completed referral is
  // reflected without requiring a manual reload.
  useEffect(() => {
    if (!user || !configured) return
    const sync = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load(true)
    }
    const timer = setInterval(sync, 45_000)
    if (typeof window !== 'undefined') window.addEventListener('focus', sync)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync)
    return () => {
      clearInterval(timer)
      if (typeof window !== 'undefined') window.removeEventListener('focus', sync)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync)
    }
  }, [user, configured, load])

  async function copyLink() {
    // A code that cannot be shared must not be copyable either: otherwise a member who has not
    // finished KYC can share a link that will only be paid after they do, which is exactly the
    // "I used their link and nobody got $3" confusion this screen has to prevent.
    if (!data?.canShare) return
    try {
      await navigator.clipboard.writeText(data.shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard blocked (no permission, insecure context). The link is on screen and selectable,
      // which is enough — do not turn a copy failure into an error state.
      setCopied(false)
    }
  }

  async function shareLink() {
    if (!data) return
    const payload = {
      title: `Earn on AfterWorks with me`,
      text: `Join me on AfterWorks — paid microwork, paid to your mobile money. Use my link and we both get started: ${data.shareUrl}`,
      url: data.shareUrl,
    }
    try {
      if (navigator.share) {
        await navigator.share(payload)
        return
      }
    } catch {
      // The member dismissed the share sheet, or it is unavailable. Fall through to copying.
    }
    await copyLink()
  }

  async function attachInviteCode(e: React.FormEvent) {
    e.preventDefault()
    const code = normaliseReferralCode(inviteCode)
    if (!code) {
      setClaimError('That does not look like an AfterWorks referral code. Check it and try again.')
      return
    }
    setClaiming(true)
    setClaimError(null)
    try {
      const result = await authedFetch<{ attached?: boolean; reason?: string }>('/api/referrals/claim', {
        method: 'POST',
        body: { code },
      })
      if (!result.attached) {
        setClaimError(claimErrorMessage(result.reason))
        return
      }
      setInviteCode('')
      // Reload the panel so the attribution card replaces this form and, when the profile and
      // referrer were already eligible, so the qualified status is shown immediately.
      await load(true)
    } catch (err) {
      setClaimError(describeError(err))
    } finally {
      setClaiming(false)
    }
  }

  if (!configured || !user) {
    return (
      <div className="rounded-2xl border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        Sign in to see your referral code. Referrals are tied to the account the money would be paid
        to, so there is nothing to show before then.
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading your referrals…
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/[0.06] p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()} className="gap-1.5">
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      </div>
    )
  }

  if (!data) return null

  const terms = data.terms ?? []

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">Referrals</h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:mt-1 sm:text-sm">
            Earn {formatUsd(data.bonusUsd)} for every person you invite who completes their profile.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </header>

      {/* ── Attribution / recovery ───────────────────────────────────────────── */}
      {data.attribution ? (
        <section
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4',
            data.attribution.status === 'qualified'
              ? 'border-success/30 bg-success/[0.06]'
              : 'border-warning/30 bg-warning/[0.06]',
          )}
          aria-label="Your referral"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">You joined with {data.attribution.referrerName}'s code</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.attribution.status === 'qualified'
                ? `Their ${formatUsd(data.bonusUsd)} bonus has been credited to their pending balance.`
                : `The ${formatUsd(data.bonusUsd)} is released when your profile is complete and their identity verification is approved.`}
            </p>
          </div>
          <StatusBadge tone={data.attribution.status === 'qualified' ? 'success' : 'warning'}>
            {data.attribution.status === 'qualified' ? 'Bonus credited' : 'Awaiting release'}
          </StatusBadge>
        </section>
      ) : data.canAttachReferral ? (
        <section className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-4" aria-label="Add a referral code">
          <div className="flex items-start gap-2.5">
            <UserPlus className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Were you invited by someone?</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                If you signed up with an invite code but it did not attach, add it here within{' '}
                {data.attachWindowDays ?? REFERRAL_ATTACH_WINDOW_DAYS} days of creating your account.
                One account can only ever have one referrer.
              </p>
            </div>
          </div>
          <form onSubmit={attachInviteCode} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="AWK7MNPQ"
              aria-label="Referral code"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-sm uppercase tracking-[0.12em] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button type="submit" disabled={claiming || inviteCode.trim().length === 0} className="gap-1.5">
              {claiming ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
              {claiming ? 'Attaching…' : 'Attach code'}
            </Button>
          </form>
          {claimError ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive" role="alert">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              {claimError}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── The link ─────────────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/30 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Your referral code
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.18em] sm:text-3xl">{data.code}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Earned to date</p>
              <p className="text-2xl font-semibold tabular-nums text-success sm:text-3xl">
                {formatUsd(data.stats.earnedUsd)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 py-2.5">
            <code className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{data.shareUrl}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={copyLink}
              disabled={!data.canShare}
              title={data.canShare ? undefined : 'Finish your own verification and profile before sharing this link.'}
              className="shrink-0 gap-1.5"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <Button size="lg" onClick={shareLink} disabled={!data.canShare} className="w-full gap-2">
            <Share2 className="size-4" />
            Share your link
          </Button>

          {/* The block is stated, not hidden: a member whose code is not live deserves to know
              what is missing and where to fix it, not an unexplained dead button. */}
          {data.blockedReason && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {data.blockedReason}{' '}
                <Link href="/profile" className="font-medium underline underline-offset-2">
                  Finish it here
                </Link>
                .
              </span>
            </p>
          )}
        </div>
      </section>

      {/* ── Totals ───────────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="People invited" value={data.stats.total} icon={Users} />
        <Stat label="Qualified" value={data.stats.qualified} icon={CheckCircle2} tone="success" />
        <Stat label="Awaiting profile" value={data.stats.pending} icon={Clock} tone="warning" />
        <Stat
          label="Still to earn"
          value={formatUsd(data.stats.pendingUsd)}
          icon={Gift}
          hint={`${data.stats.pending} × ${formatUsd(data.bonusUsd)}`}
        />
      </section>

      {/* ── History ──────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold tracking-tight">Your referrals</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {REFERRAL_STATUS_HINT.pending}
        </p>
        {data.rows.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
            <Gift className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Nobody has used your link yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Share it with people who would be good at this work. When they sign up with your code and
              finish their profile, {formatUsd(data.bonusUsd)} lands in your pending balance.
            </p>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {data.rows.map((row) => (
              <ReferralRowItem key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>

      {/* ── The terms, in full, on the page ──────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-muted/25 p-5">
        <h2 className="text-base font-semibold tracking-tight">Referral program terms</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The same rules apply to anyone you invite. They are part of our{' '}
          <Link href="/terms#referrals" className="font-medium text-primary hover:underline">
            Terms &amp; Conditions
          </Link>
          .
        </p>
        <ol className="mt-3 flex list-decimal flex-col gap-3 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary">
          {terms.map((term) => (
            <li key={term.title}>
              <span className="font-medium text-foreground">{term.title}.</span> {term.body}
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-lg bg-background/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Referral credit is paid after the {site.clearingWindowHours}-hour clearing window, like any
          other earning, and can be withdrawn once your balance reaches{' '}
          {formatUsd(site.minWithdrawalUsd)}.
        </p>
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: string | number
  icon: typeof Users
  tone?: 'neutral' | 'success' | 'warning'
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 text-primary" />
        {label}
      </div>
      <p
        className={cn(
          'mt-1.5 text-xl font-semibold tabular-nums sm:text-2xl',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
