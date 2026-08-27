'use client'

import { Fragment, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react'
import { useAdminUsers } from '@/components/admin/data-hooks'
import {
  AdminSectionHeader,
  AdminTable,
  EmptyState,
  ReasonInput,
  Select,
  StatCard,
  Td,
  Th,
  TextInput,
} from '@/components/admin/ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { formatUsd, type StatusTone } from '@/lib/afterworks-data'
import {
  ACCOUNT_STATE_LABELS,
  ACCOUNT_STATE_TONES,
  timeAgo,
  type AdminUser,
} from '@/lib/admin-data'

const STATE_FILTERS = ['all', 'active', 'kyc_on_hold', 'kyc_resubmission', 'kyc_rejected', 'kyc_abandoned', 'kyc_expired'] as const

function UserActions({
  user,
  onSetState,
  onSetQuality,
}: {
  user: AdminUser
  onSetState: (uid: string, state: string, reason?: string) => Promise<{ ok: boolean }>
  onSetQuality: (uid: string, score: number) => Promise<{ ok: boolean }>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handle(state: string, needsReason: boolean) {
    setError(null)
    if (needsReason && !reason.trim()) {
      setError('A reason is required.')
      return
    }
    setBusy(state)
    const res = await onSetState(user.uid, state, needsReason ? reason.trim() : undefined)
    setBusy(null)
    if (!res.ok) setError('Action failed — try again.')
    else if (needsReason) setReason('')
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/30 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Moderation actions
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || user.accountState === 'active'}
          onClick={() => handle('active', false)}
        >
          Activate
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || user.accountState === 'kyc_resubmission'}
          onClick={() => handle('kyc_resubmission', false)}
        >
          Request resubmission
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || user.accountState === 'kyc_on_hold'}
          onClick={() => handle('kyc_on_hold', false)}
        >
          Place on hold
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy !== null || user.accountState === 'kyc_rejected'}
          onClick={() => handle('kyc_rejected', true)}
        >
          Reject account
        </Button>
      </div>

      <ReasonInput
        value={reason}
        onChange={setReason}
        error={error}
        placeholder="Reason for rejection (required) — shown to the worker…"
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quality score
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={async () => {
              setBusy('quality')
              await onSetQuality(user.uid, Math.max(0, user.qualityScore - 5))
              setBusy(null)
            }}
          >
            −5
          </Button>
          <span className="w-10 text-center font-mono text-sm font-semibold">{user.qualityScore}</span>
          <Button
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={async () => {
              setBusy('quality')
              await onSetQuality(user.uid, Math.min(100, user.qualityScore + 5))
              setBusy(null)
            }}
          >
            +5
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          Low scores deprioritise workers for high-payout jobs.
        </span>
      </div>
    </div>
  )
}

export default function AdminUsersPage() {
  const { users, loading, error, demo, setUserState, setQuality } = useAdminUsers()
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<(typeof STATE_FILTERS)[number]>('all')
  const [expandedUid, setExpandedUid] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((u) => {
      if (stateFilter !== 'all' && u.accountState !== stateFilter) return false
      if (!q) return true
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone ?? '').toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q)
      )
    })
  }, [users, query, stateFilter])

  const counts = useMemo(
    () => ({
      active: users.filter((u) => u.accountState === 'active').length,
      attention: users.filter((u) => u.accountState !== 'active').length,
      verified: users.filter((u) => u.kycVerified).length,
    }),
    [users],
  )

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title="Users"
        description="Search workers, review account state and moderate access."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total users" value={loading ? '…' : users.length} icon={Users} />
        <StatCard label="Active" value={loading ? '…' : counts.active} icon={ShieldCheck} tone="success" />
        <StatCard label="Need attention" value={loading ? '…' : counts.attention} icon={UserCog} tone="warning" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, phone or UID…"
            className="pl-9"
          />
        </div>
        <Select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}
          className="sm:w-56"
        >
          {STATE_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All account states' : ACCOUNT_STATE_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading users…</p>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No users match" description="Try a different search or filter." />
      ) : (
        <AdminTable>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Account state</Th>
              <Th className="hidden md:table-cell">Quality</Th>
              <Th className="hidden md:table-cell">Jobs done</Th>
              <Th className="hidden lg:table-cell">Wallet</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const expanded = expandedUid === u.uid
              return (
                <Fragment key={u.uid}>
                  <tr
                    onClick={() => setExpandedUid(expanded ? null : u.uid)}
                    className="cursor-pointer transition-colors hover:bg-muted/40"
                  >
                    <Td>
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                          {u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                            {u.name}
                            {u.isAdmin && (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                ADMIN
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge tone={(ACCOUNT_STATE_TONES[u.accountState] ?? 'neutral') as StatusTone}>
                        {ACCOUNT_STATE_LABELS[u.accountState] ?? u.accountState}
                      </StatusBadge>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <span className="font-mono text-sm">{u.qualityScore}</span>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <span className="font-mono text-sm">{u.jobsCompleted}</span>
                    </Td>
                    <Td className="hidden lg:table-cell">
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatUsd(u.wallet?.availableUsd ?? 0)} avail
                        {(u.wallet?.pendingUsd ?? 0) > 0 && (
                          <> · {formatUsd(u.wallet?.pendingUsd ?? 0)} pending</>
                        )}
                      </span>
                    </Td>
                    <Td>
                      {expanded ? (
                        <ChevronUp className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      )}
                    </Td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <UserActions user={u} onSetState={setUserState} onSetQuality={setQuality} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </AdminTable>
      )}

      {demo && (
        <p className="text-xs text-muted-foreground">
          Demo mode — changes are saved to this browser only. With Firebase
          configured, actions write straight to Firestore via the Admin SDK.
        </p>
      )}
    </div>
  )
}
