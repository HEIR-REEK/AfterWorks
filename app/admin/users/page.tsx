'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  BadgeCheck,
  CircleSlash,
  KeyRound,
  MailCheck,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { adminApi, useAdminSession, type AdminUserRow } from '@/lib/admin'
import { AdminCard, Field, Pager, ReasonDialog, inputClass, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { formatUsd } from '@/lib/afterworks-data'
import { STATE_LABELS, type AdminMutableState } from '@/lib/admin-domain'
import { cn } from '@/lib/utils'

/**
 * Users & KYC.
 *
 * Previously this table subscribed to the whole `users` collection in the browser and wrote
 * `users/{uid}` (including `isAdmin: true`) straight back — both a privacy leak and a privilege
 * escalation path, since the rules let a member write their own document. Now it reads one
 * redacted, cursor-paginated page from the API and every mutation goes through
 * `PATCH /api/admin/users` where it is authorised, reasoned and audited.
 */

type UserDetail = AdminUserRow & {
  phone?: string
  payoutNumberMasked?: string
  skills?: string[]
  languages?: string[]
  bio?: string
  rating?: number
  jobsApplied?: number
  walletNote?: string
  moderationReason?: string
  kycProvider?: string
  kycLevel?: string
  kycRejectedAt?: string | null
  kycOnHoldAt?: string | null
  career?: string
  bank?: Record<string, unknown> | null
  updatedAt?: string | null
  deletedAt?: string | null
}



export default function AdminUsersPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>}>
      <UsersPageInner />
    </Suspense>
  )
}

function UsersPageInner() {
  const session = useAdminSession()
  const searchParams = useSearchParams()
  const { push, toasts } = useToasts()
  // Role split: staff run the KYC queue; moderation, credentials, wallets and deletion are
  // owner-only (the API enforces the same line — this just keeps the drawer honest).
  const isOwner = session.role === 'owner'

  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [degraded, setDegraded] = useState<string | undefined>()

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [state, setState] = useState(searchParams.get('state') ?? 'all')
  const [selected, setSelected] = useState<UserDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{
    action: string
    title: string
    description: string
    tone: 'destructive' | 'default'
    confirmLabel: string
    minReasonLength?: number
    requireReason?: boolean
  } | null>(null)
  // `null` = not loaded yet (or Auth unreachable); a loaded record always exists as an object.
  const [account, setAccount] = useState<NonNullable<AdminUserRow['auth']> | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(id)
  }, [searchInput])

  const pageIndex = cursors.length - 1

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true)
    try {
      const data = await adminApi.users({ cursor: cursor ?? undefined, pageSize: 25, search, state })
      setRows(data.rows)
      setNextCursor((data.nextCursor as string | null) ?? null)
      setHasMore(data.hasMore === true)
      setDegraded(data.degraded as string | undefined)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the directory.')
    } finally {
      setLoading(false)
    }
  }, [search, state])

  useEffect(() => {
    if (session.status !== 'authorized') return
    void load(cursors[cursors.length - 1] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status, load, cursors.length])

  const openDetail = async (uid: string) => {
    setBusy(true)
    try {
      const data = await adminApi.userDetail(uid)
      setSelected(data.user as UserDetail)
      setAccount((data.account as NonNullable<AdminUserRow['auth']> | undefined) ?? { exists: false, disabled: false, emailVerified: false, createdAt: null, lastSignInAt: null, providers: [], orphaned: true })
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Could not load that profile.')
    } finally {
      setBusy(false)
    }
  }

  const act = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const result = await adminApi.userAction(body as { uid: string; action: string })
      // Some results are only ever shown once (a temporary password) or are a link to relay by hand.
      if (typeof result.temporaryPassword === 'string') {
        const secret = result.temporaryPassword
        try {
          await navigator.clipboard.writeText(secret)
          push('warning', `Temporary password copied to your clipboard: ${secret}. It is not stored anywhere — paste it to the member now.`, 45_000)
        } catch {
          push('warning', `Temporary password (copy it now, it will not be shown again): ${secret}`, 45_000)
        }
      } else if (typeof result.link === 'string') {
        push('info', `Verification link generated — send it yourself: ${result.link}`, 45_000)
      } else if (result.credentialDisabled !== undefined) {
        push(result.credentialDisabled ? 'warning' : 'success', result.note ?? (result.credentialDisabled ? 'Sign-in credential disabled.' : 'Sign-in credential enabled.'))
      } else {
        push('success', typeof result.note === 'string' ? result.note : 'Saved and written to the audit log.')
      }
      setConfirm(null)
      setSelected(null)
      setAccount(null)
      await load(cursors[cursors.length - 1] ?? null)
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'The action failed; nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  // Lockout counters live in the security store, not on the user document, so this goes through the
  // operator-actions endpoint rather than PATCH /api/admin/users.
  const clearLockout = async (email: string, reason: string) => {
    setBusy(true)
    try {
      const result = await adminApi.operatorAction({ action: 'unlock', email, reason })
      push(result.removed ? 'success' : 'info', result.note ?? 'Lockouts cleared.')
      setConfirm(null)
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'The lockout could not be cleared.')
    } finally {
      setBusy(false)
    }
  }

  const summary = useMemo(
    () => ({
      verified: rows.filter((row) => row.kycVerified).length,
      flagged: rows.filter((row) => row.accountState !== 'active').length,
      admins: rows.filter((row) => row.role === 'admin').length,
    }),
    [rows],
  )

  return (
    <div className="flex flex-col gap-4">
      {toasts}

      <AdminCard
        title="Members & KYC"
        description="Paged, redacted directory. Payout numbers stay masked — the console never needs the full value to do its job."
        icon={<Users className="size-4" />}
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
                placeholder="Name or email…"
                className={cn(inputClass, 'h-8 w-44 pl-8 text-xs sm:w-56')}
                aria-label="Search members"
              />
            </div>
            <select value={state} onChange={(event) => { setState(event.target.value); setCursors([null]) }} className={cn(inputClass, 'h-8 w-auto py-1 text-xs')} aria-label="Filter by state">
              <option value="all">All states</option>
              <option value="kyc_pending">KYC pending</option>
              <option value="kyc_rejected">KYC declined</option>
              <option value="restricted">Restricted</option>
              <option value="admins">Admins</option>
            </select>
          </div>
        }
      >
        {degraded && (
          <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning-foreground">
            Directory is running without server pagination support: {degraded}.
          </p>
        )}
        {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>}

        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[46rem] border-collapse text-xs">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-2 font-semibold">Member</th>
                <th className="px-2 py-2 font-semibold">State</th>
                <th className="px-2 py-2 font-semibold">KYC</th>
                <th className="px-2 py-2 font-semibold">Quality</th>
                <th className="px-2 py-2 font-semibold">Completed</th>
                <th className="px-2 py-2 font-semibold">Wallet</th>
                <th className="px-2 py-2 text-right font-semibold">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground">
                    <Loader2 className="mr-1 inline size-4 animate-spin" />
                    Loading directory…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground">No members match this filter.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.uid} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => void openDetail(row.uid)}>
                    <td className="py-2.5 pr-2">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-[11px] font-semibold">
                          {row.name ? row.name.slice(0, 2).toUpperCase() : row.email.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{row.name || row.email}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{row.email}</p>
                        </div>
                        {row.role === 'admin' && <StatusBadge tone="info"><ShieldCheck className="size-3" />Staff</StatusBadge>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusBadge tone={row.accountState === 'active' ? 'success' : row.accountState === 'suspended' ? 'warning' : 'danger'}>
                        {STATE_LABELS[row.accountState as AdminMutableState] ?? row.accountState}
                      </StatusBadge>
                    </td>
                    <td className="px-2 py-2.5">
                      {row.kycVerified ? (
                        <StatusBadge tone="success"><BadgeCheck className="size-3" />Verified</StatusBadge>
                      ) : (
                        <StatusBadge tone={row.kycStatus === 'rejected' ? 'danger' : 'warning'}>{row.kycStatus ?? 'not started'}</StatusBadge>
                      )}
                    </td>
                    <td className="px-2 py-2.5 font-mono tabular">{row.qualityScore}</td>
                    <td className="px-2 py-2.5 font-mono tabular">{row.jobsCompleted}</td>
                    <td className="px-2 py-2.5">
                      <span className="font-mono tabular text-foreground">{formatUsd(row.wallet.availableUsd)}</span>
                      <span className="block text-[10px] text-muted-foreground">+{formatUsd(row.wallet.pendingUsd)} pending</span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[11px] text-muted-foreground">
                      {row.lastActiveAt ? new Date(row.lastActiveAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pager
          hasMore={hasMore}
          loading={loading}
          pageLabel={`Page ${pageIndex + 1} · ${rows.length} rows · ${summary.verified} verified · ${summary.flagged} flagged · ${summary.admins} staff`}
          onPrev={() => setCursors((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
          onNext={() => setCursors((prev) => (nextCursor ? [...prev, nextCursor] : prev))}
        />
      </AdminCard>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-foreground/40 backdrop-blur-sm" onMouseDown={() => setSelected(null)}>
          <aside
            className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-border bg-background p-4 shadow-2xl sm:p-5"
            onMouseDown={(event) => event.stopPropagation()}
            aria-label={`${selected.name || selected.email} details`}
          >
            <header className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold tracking-tight">{selected.name || 'Unnamed member'}</h2>
                  {selected.role === 'admin' && <StatusBadge tone="info">Staff</StatusBadge>}
                </div>
                <p className="truncate text-xs text-muted-foreground">{selected.email}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">uid {selected.uid.slice(0, 24)}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close">
                <X className="size-4" />
              </button>
            </header>

            <div className="grid grid-cols-2 gap-2.5">
              <Fact label="State" value={STATE_LABELS[selected.accountState as AdminMutableState] ?? selected.accountState} />
              <Fact label="KYC" value={selected.kycVerified ? 'Verified' : selected.kycStatus ?? 'Not started'} tone={selected.kycVerified ? 'success' : 'warning'} />
              <Fact label="Quality" value={String(selected.qualityScore)} />
              <Fact label="Completed jobs" value={String(selected.jobsCompleted)} />
              <Fact label="Available" value={formatUsd(selected.wallet.availableUsd)} />
              <Fact label="Pending" value={formatUsd(selected.wallet.pendingUsd)} />
              <Fact label="Payout handle" value={selected.wallet.payoutNumberMasked || selected.payoutNumberMasked || '—'} />
              <Fact label="Paid trainings" value={String(selected.paidTrainingsCount)} />
              <Fact label="Joined" value={selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : '—'} />
              <Fact label="Provider" value={selected.kycProvider || '—'} />
            </div>

            {/* Auth is the credential; the profile is only our description of it. Show both, and show
                the disagreement — that is where "banned but still signing in" and ghost accounts live. */}
            <div className="rounded-xl border border-border/70 bg-background/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Firebase Auth account</p>
              {account === null ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Auth state not loaded — this deployment cannot reach the Admin SDK, so credential actions are unavailable.</p>
              ) : !account.exists ? (
                <p className="mt-1 text-[11px] font-medium text-destructive">No Auth account for this uid. The profile exists but nobody can sign in to it; treat this as a data artifact and erase it.</p>
              ) : (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Fact label="Credential" value={account.disabled ? 'Disabled' : 'Active'} tone={account.disabled ? 'warning' : 'success'} />
                    <Fact label="Email verified" value={account.emailVerified ? 'Yes' : 'Not verified'} tone={account.emailVerified ? 'success' : 'warning'} />
                    <Fact label="Last sign-in" value={account.lastSignInAt ? new Date(account.lastSignInAt).toLocaleString() : 'never'} />
                    <Fact label="Providers" value={account.providers.length ? account.providers.join(', ').replace('.com', '') : '—'} />
                  </div>
                  {account.disabled && selected.accountState === 'active' ? (
                    <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Profile says active while the credential is disabled. Restore access below, or ban the profile so the two agree.
                    </p>
                  ) : null}
                  {!account.disabled && ['suspended', 'banned'].includes(selected.accountState) ? (
                    <p className="mt-2 text-[11px] font-medium text-destructive">
                      This member is restricted on paper but can still sign in. Disable the credential below.
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {selected.moderationReason && (
              <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning-foreground">
                <strong className="font-semibold">Moderation note:</strong> {selected.moderationReason}
              </p>
            )}
            {selected.walletNote && (
              <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                <strong className="font-semibold text-foreground">Wallet note:</strong> {selected.walletNote}
              </p>
            )}

            <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</p>
              <div className="grid grid-cols-2 gap-2">
                {!selected.kycVerified && (
                  <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => setConfirm({ action: 'kyc-approve', title: 'Approve identity', description: 'Marks this worker verified for job applications requiring KYC. Use only after checking the provider report.', confirmLabel: 'Approve KYC', tone: 'default' })}>
                    <UserCheck className="size-3.5" />
                    Approve KYC
                  </Button>
                )}
                {selected.kycVerified && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm({ action: 'kyc-reject', title: 'Revoke identity verification', description: 'The worker loses access to jobs that require verification and is notified.', confirmLabel: 'Revoke verification', tone: 'destructive' })}>
                    Revoke KYC
                  </Button>
                )}
                {selected.accountState === 'active' ? (
                  isOwner && (
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setConfirm({ action: 'suspend', title: 'Suspend account', description: 'The member cannot apply or withdraw funds until restored. They are notified with your reason.', confirmLabel: 'Suspend', tone: 'destructive' })}>
                      <Lock className="size-3.5" />
                      Suspend
                    </Button>
                  )
                ) : (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setConfirm({ action: 'restore', title: 'Restore account', description: 'Returns this member to good standing, keeping their earnings and applications. The sign-in credential is re-enabled at the same time.', confirmLabel: 'Restore access', tone: 'default' })}>
                    <Unlock className="size-3.5" />
                    Restore
                  </Button>
                )}
                {isOwner && (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setConfirm({ action: 'wallet', title: 'Adjust wallet balances', description: 'Manual ledger correction. Recorded against your account with the reason you give.', confirmLabel: 'Apply adjustment', tone: 'destructive' })}>
                    <Wallet className="size-3.5" />
                    Adjust wallet
                  </Button>
                )}
                {isOwner && (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setConfirm({ action: 'role', title: selected.role === 'admin' ? 'Revoke staff access' : 'Grant staff access', description: 'Role changes are immediate, always audited, and cannot be applied to your own account.', confirmLabel: selected.role === 'admin' ? 'Revoke role' : 'Grant role', tone: selected.role === 'admin' ? 'destructive' : 'default' })}>
                    <ShieldCheck className="size-3.5" />
                    {selected.role === 'admin' ? 'Revoke staff' : 'Make staff'}
                  </Button>
                )}
                {(isOwner || account?.disabled) && (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || account === null} onClick={() => setConfirm({
                    action: account?.disabled ? 'credential-enable' : 'credential-disable',
                    title: account?.disabled ? 'Re-enable sign-in' : 'Disable sign-in credential',
                    description: account?.disabled
                      ? 'The member can sign in again immediately. Their profile state is set back to active as well, so the two systems agree.'
                      : 'Ends access now: existing sessions stop working at the next token refresh. Use this, not suspension alone, when a credential must die today.',
                    confirmLabel: account?.disabled ? 'Enable credential' : 'Disable credential',
                    tone: account?.disabled ? 'default' : 'destructive',
                    requireReason: false,
                  })}>
                    <KeyRound className="size-3.5" />
                    {account?.disabled ? 'Enable sign-in' : 'Disable sign-in'}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setConfirm({
                  action: 'temp-password',
                  title: 'Issue a temporary password',
                  description: 'For a locked-out member who cannot receive a reset email. The password is shown once, is never stored, and this action is audited. Members who can still read their inbox should use "Forgot password" on the sign-in page instead.',
                  confirmLabel: 'Generate password',
                  tone: 'destructive',
                  minReasonLength: 4,
                })}>
                  <KeyRound className="size-3.5" />
                  Temporary password
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setConfirm({
                  action: 'clear-lockout',
                  title: 'Clear sign-in lockouts',
                  description: 'Removes the brute-force counters for this email — console sign-in, password-reset requests and reset-code guesses — so the member can try again now instead of waiting out the lockout. Audited as ADMIN_LOCKOUT_CLEARED.',
                  confirmLabel: 'Clear lockouts',
                  tone: 'default',
                  minReasonLength: 4,
                })}>
                  <Unlock className="size-3.5" />
                  Clear lockout
                </Button>
                {isOwner && (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || account?.emailVerified === true} onClick={() => setConfirm({
                    action: 'verification-link',
                    title: 'Mint an email-verification link',
                    description: 'The link is generated server-side and handed to you to send — nothing is emailed from this app. Valid one hour.',
                    confirmLabel: 'Generate link',
                    tone: 'default',
                    requireReason: false,
                  })}>
                    <MailCheck className="size-3.5" />
                    Verification link
                  </Button>
                )}
                {isOwner && (
                  <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => setConfirm({
                    action: 'erase',
                    title: 'Erase this account completely',
                    description: 'Deletes the profile, the Firebase Auth credential, the notifications and any pending applications. Money rows are kept with names redacted unless you tick the box — a payout with no counterparty is worse for everybody.',
                    confirmLabel: 'Erase permanently',
                    tone: 'destructive',
                    minReasonLength: 12,
                  })}>
                    <Trash2 className="size-3.5" />
                    Erase account
                  </Button>
                )}
                {isOwner && (
                  <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => setConfirm({ action: 'delete', title: 'Flag for deletion', description: 'Bans the account and marks it for the retention job. Records are kept for financial audit; this is not an instant erase.', confirmLabel: 'Ban & flag', tone: 'destructive' })}>
                    <Trash2 className="size-3.5" />
                    Flag for deletion
                  </Button>
                )}
                {isOwner && (
                  <Button size="sm" variant="ghost" className="gap-1.5" disabled={busy} onClick={() => setConfirm({ action: 'restrict', title: 'Mark under review', description: 'Keeps the account signed in but holds it for manual review; use instead of suspending when you are still gathering facts.', confirmLabel: 'Set under review', tone: 'destructive' })}>
                    <CircleSlash className="size-3.5" />
                    Under review
                  </Button>
                )}
              </div>
              {isOwner ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Every action below is sent to <code className="font-mono">PATCH /api/admin/users</code> with a reason, checked against the allowed state transitions, and appended to
                  <code className="font-mono"> admin_logs</code>.
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Staff accounts can approve or reject KYC, issue a temporary password, restore a suspended account, re-enable a disabled sign-in and clear lockouts. Suspending, banning, wallets, roles and deletion are restricted to the main administrator.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      <ReasonDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        tone={confirm?.tone}
        busy={busy}
        requireReason={confirm?.requireReason ?? confirm?.action !== 'restore'}
        minReasonLength={confirm?.minReasonLength ?? 4}
        onCancel={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (!selected || !confirm) return
          const base = { uid: selected.uid, reason }
          switch (confirm.action) {
            case 'kyc-approve':
              return act({ ...base, action: 'kyc', payload: { approve: true } })
            case 'kyc-reject':
              return act({ ...base, action: 'kyc', payload: { approve: false } })
            case 'suspend':
              return act({ ...base, action: 'moderate', payload: { accountState: 'suspended' } })
            case 'restore':
              return act({ ...base, action: 'moderate', payload: { accountState: 'active' } })
            case 'restrict':
              return act({ ...base, action: 'moderate', payload: { accountState: 'under_review' } })
            case 'delete':
              return act({ ...base, action: 'delete' })
            case 'credential-disable':
              return act({ ...base, action: 'account', payload: { enable: false } })
            case 'credential-enable':
              return act({ ...base, action: 'account', payload: { enable: true } })
            case 'temp-password':
              return act({ ...base, action: 'temp-password' })
            case 'clear-lockout':
              return clearLockout(selected.email, reason)
            case 'verification-link':
              return act({ ...base, action: 'verification-link', payload: { email: selected.email } })
            case 'erase': {
              const typed = (document.getElementById('erase-uid') as HTMLInputElement | null)?.value.trim() ?? ''
              if (typed !== selected.uid) {
                push('error', `Type the uid exactly (${selected.uid.slice(0, 12)}…) to confirm.`)
                return undefined
              }
              const eraseLedger = (document.getElementById('erase-ledger') as HTMLInputElement | null)?.checked === true
              return act({ ...base, action: 'erase', payload: { confirm: typed, eraseLedger } })
            }
            case 'role':
              return act({ ...base, action: 'role', payload: { isAdmin: selected.role !== 'admin', email: selected.email } })
            case 'wallet': {
              const pending = Number((document.getElementById('adj-pending') as HTMLInputElement | null)?.value)
              const available = Number((document.getElementById('adj-available') as HTMLInputElement | null)?.value)
              if (!Number.isFinite(pending) || !Number.isFinite(available)) {
                push('error', 'Enter both balances as numbers.')
                return undefined
              }
              return act({ ...base, action: 'wallet', payload: { pendingUsd: pending, availableUsd: available } })
            }
            default:
              return undefined
          }
        }}
        extra={
          confirm?.action === 'erase' && selected ? (
            <div className="mt-3 flex flex-col gap-3">
              <Field label="Type the uid to confirm" hint={`${selected.uid} — this cannot be undone from the console.`}>
                <input id="erase-uid" className={cn(inputClass, 'font-mono text-[11px]')} placeholder={selected.uid} autoComplete="off" />
              </Field>
              <label className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-background/50 p-3">
                <input id="erase-ledger" type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" />
                <span>
                  <span className="block text-xs font-semibold text-foreground">Also delete the ledger rows</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    Off by default: amounts stay with the personal fields redacted, so a past payout can still be reconciled.
                  </span>
                </span>
              </label>
            </div>
          ) : confirm?.action === 'wallet' && selected ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Pending (USD)">
                <input id="adj-pending" type="number" step="0.01" min="0" defaultValue={selected.wallet.pendingUsd} className={inputClass} />
              </Field>
              <Field label="Available (USD)">
                <input id="adj-available" type="number" step="0.01" min="0" defaultValue={selected.wallet.availableUsd} className={inputClass} />
              </Field>
            </div>
          ) : undefined
        }
      />
    </div>
  )
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 truncate text-xs font-medium', tone === 'success' && 'text-success', tone === 'warning' && 'text-amber-600 dark:text-amber-400')}>{value}</p>
    </div>
  )
}
