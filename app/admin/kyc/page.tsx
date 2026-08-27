'use client'

import { useState } from 'react'
import {
  BadgeCheck,
  XCircle,
  Clock,
  Hourglass,
  ScanFace,
  RotateCcw,
  ShieldQuestion,
} from 'lucide-react'
import { useAdminKyc } from '@/components/admin/data-hooks'
import {
  AdminCard,
  AdminSectionHeader,
  EmptyState,
  ReasonInput,
  StatCard,
} from '@/components/admin/ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import type { StatusTone } from '@/lib/afterworks-data'
import {
  KYC_STATUS_LABELS,
  KYC_STATUS_TONES,
  formatDateTime,
  kycNeedsAction,
  timeAgo,
  type AdminKycItem,
} from '@/lib/admin-data'
import { cn } from '@/lib/utils'

type Tab = 'action' | 'all'

function KycCard({
  item,
  onDecide,
}: {
  item: AdminKycItem
  onDecide: (
    uid: string,
    action: 'approve' | 'reject' | 'hold' | 'resubmission',
    reason?: string,
  ) => Promise<{ ok: boolean }>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function decide(action: 'approve' | 'reject' | 'hold' | 'resubmission') {
    setError(null)
    if (action === 'reject' && !reason.trim()) {
      setError('A rejection reason is required.')
      return
    }
    setBusy(action)
    const res = await onDecide(item.uid, action, reason.trim() || undefined)
    setBusy(null)
    if (res.ok) setDone(action)
    else setError(res.ok ? null : 'Action failed — try again.')
  }

  if (done) {
    return (
      <AdminCard className="border-success/40 bg-success/5">
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <BadgeCheck className="size-4" />
          Decision recorded ({done}) for {item.userName}.
        </p>
      </AdminCard>
    )
  }

  return (
    <AdminCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <ScanFace className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{item.userName}</p>
            <p className="truncate text-xs text-muted-foreground">{item.userEmail}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              session {item.sessionId || '—'} · attempt {item.attemptCount}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge tone={KYC_STATUS_TONES[item.status] as StatusTone}>
            {KYC_STATUS_LABELS[item.status]}
          </StatusBadge>
          <span className="text-[11px] text-muted-foreground">
            updated {timeAgo(item.updatedAt)}
          </span>
        </div>
      </div>

      {(item.rejectionReason || (item.failedChecks && item.failedChecks.length > 0)) && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {item.rejectionReason && <p>Reason: {item.rejectionReason}</p>}
          {item.failedChecks && item.failedChecks.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1">
              Failed checks:
              {item.failedChecks.map((c) => (
                <span key={c} className="rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                  {c}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <ReasonInput
          value={reason}
          onChange={setReason}
          error={error}
          placeholder="Reason (required for rejection) — e.g. blurry ID, face mismatch…"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => decide('approve')}>
            <BadgeCheck className="size-3.5" />
            {busy === 'approve' ? 'Approving…' : 'Approve & activate'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => decide('resubmission')}
          >
            <RotateCcw className="size-3.5" />
            Request resubmission
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide('hold')}>
            <Hourglass className="size-3.5" />
            Hold for review
          </Button>
          <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => decide('reject')}>
            <XCircle className="size-3.5" />
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </Button>
        </div>
      </div>
    </AdminCard>
  )
}

export default function AdminKycPage() {
  const { items, loading, error, demo, decide } = useAdminKyc()
  const [tab, setTab] = useState<Tab>('action')

  const needsAction = items.filter((k) => kycNeedsAction(k.status))
  const shown = tab === 'action' ? needsAction : items

  const stats = {
    pending: items.filter((k) => k.status === 'Pending' || k.status === 'InProgress').length,
    hold: items.filter((k) => k.status === 'OnHold').length,
    resubmission: items.filter((k) => k.status === 'Resubmission').length,
    approved: items.filter((k) => k.status === 'Approved').length,
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title="KYC reviews"
        description="Verification sessions that need a manual decision. Approving activates the worker's account."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Awaiting review" value={loading ? '…' : stats.pending} icon={Clock} tone="warning" />
        <StatCard label="On hold" value={loading ? '…' : stats.hold} icon={ShieldQuestion} tone="warning" />
        <StatCard label="Resubmission" value={loading ? '…' : stats.resubmission} icon={RotateCcw} />
        <StatCard label="Approved" value={loading ? '…' : stats.approved} icon={BadgeCheck} tone="success" />
      </div>

      <div className="flex w-fit rounded-lg border border-border bg-card p-1">
        {(
          [
            ['action', `Needs action (${needsAction.length})`],
            ['all', `All records (${items.length})`],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading KYC records…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={BadgeCheck}
          title={tab === 'action' ? 'Queue is clear 🎉' : 'No KYC records'}
          description={
            tab === 'action'
              ? 'Every verification has been reviewed. New submissions appear here automatically.'
              : 'Records appear when workers start a verification session.'
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((k) => (
            <KycCard key={k.uid} item={k} onDecide={decide} />
          ))}
        </div>
      )}

      {demo && (
        <p className="text-xs text-muted-foreground">
          Demo mode — decisions update the seeded records in this browser. With
          Firebase configured, decisions write to kyc_records and flip the
          worker&apos;s account state via the Admin SDK.
        </p>
      )}
    </div>
  )
}
