'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  UserCog,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react'
import { adminApi, useAdminSession, type AdminUserRow } from '@/lib/admin'
import { AdminCard, Field, inputClass, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'

/**
 * Staff Management — shows all accounts with role === 'admin' and lets a super-admin
 * grant or revoke the admin role by email via the existing /api/admin/users API.
 *
 * Every mutation routes through the server-side PATCH endpoint which:
 *  • verifies the session cookie
 *  • syncs the Firebase custom claim
 *  • writes an audit log entry
 */

export default function AdminStaffPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      }
    >
      <StaffPageInner />
    </Suspense>
  )
}

// ─── Grant-role dialog ────────────────────────────────────────────────────────

function GrantDialog({
  onClose,
  onGrant,
  busy,
}: {
  onClose: () => void
  onGrant: (email: string) => void
  busy: boolean
}) {
  const [email, setEmail] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-sm">Grant staff role</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The user must already have a worker account. Their Firebase claim will be updated
              automatically and every change is written to the audit log.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="grant-email" className="text-xs font-medium">
              Account email
            </label>
            <input
              id="grant-email"
              type="email"
              required
              placeholder="staff@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(inputClass, 'h-9 text-xs')}
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={busy || !email.trim()}
              onClick={() => onGrant(email.trim())}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
              Grant staff role
            </Button>
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Staff member row detail panel ────────────────────────────────────────────

function StaffDetail({
  member,
  onRevoke,
  onClose,
  busy,
}: {
  member: AdminUserRow
  onRevoke: (uid: string) => void
  onClose: () => void
  busy: boolean
}) {
  const auth = member.auth
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-background/60 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-sm flex-col overflow-y-auto border-l border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-semibold text-sm">{member.name}</p>
            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Details */}
        <div className="flex flex-col gap-4 px-5 py-4 text-xs">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Role &amp; status
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Role">
                <StatusBadge tone="info">
                  <ShieldCheck className="size-3" />
                  {member.role}
                </StatusBadge>
              </Field>
              <Field label="Account state">
                <StatusBadge
                  tone={member.accountState === 'active' ? 'success' : 'warning'}
                >
                  {member.accountState}
                </StatusBadge>
              </Field>
              <Field label="Email verified">
                {auth?.emailVerified ? (
                  <StatusBadge tone="success">
                    <CheckCircle2 className="size-3" />
                    Verified
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warning">
                    <AlertCircle className="size-3" />
                    Unverified
                  </StatusBadge>
                )}
              </Field>
              <Field label="Sign-in credential">
                {auth?.disabled ? (
                  <StatusBadge tone="danger">Disabled</StatusBadge>
                ) : (
                  <StatusBadge tone="success">Enabled</StatusBadge>
                )}
              </Field>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Account info
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Member since">{member.memberSince ?? '—'}</Field>
              <Field label="Last sign-in">
                {auth?.lastSignInAt ? new Date(auth.lastSignInAt).toLocaleDateString() : '—'}
              </Field>
              <Field label="Auth providers">
                {auth?.providers?.join(', ') || '—'}
              </Field>
              <Field label="Country">{member.country ?? '—'}</Field>
            </div>
          </div>

          {/* Revoke action */}
          <div className="mt-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="mb-1 font-semibold text-destructive text-[11px] uppercase tracking-wider">
              Danger zone
            </p>
            <p className="mb-3 text-[11px] text-muted-foreground leading-relaxed">
              Revoking the staff role removes the Firebase admin claim immediately. The user keeps
              their worker account but loses all console access. This action is logged.
            </p>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => onRevoke(member.uid)}
              className="w-full gap-1.5"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <UserMinus className="size-3.5" />
              )}
              Revoke staff role
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main staff page ──────────────────────────────────────────────────────────

function StaffPageInner() {
  const session = useAdminSession()
  const { push, toasts } = useToasts()

  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminUserRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [showGrant, setShowGrant] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Re-use the existing users API with state=admins which filters role === 'admin'
      const data = await adminApi.users({ pageSize: 100, state: 'admins' })
      setRows(data.rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load staff list.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session.status !== 'authorized') return
    void load()
  }, [session.status, load])

  async function handleGrant(email: string) {
    setBusy(true)
    try {
      await adminApi.userAction({
        uid: '_by_email',           // uid ignored by 'role' branch — server looks up by email
        action: 'role',
        payload: { isAdmin: true, email },
      })
      push('success', `Staff role granted to ${email}. Audit log updated.`)
      setShowGrant(false)
      await load()
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Failed to grant role.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(uid: string) {
    const member = rows.find((r) => r.uid === uid)
    if (!member) return
    setBusy(true)
    try {
      await adminApi.userAction({
        uid,
        action: 'role',
        payload: { isAdmin: false, email: member.email },
      })
      push('success', 'Staff role revoked. Audit log updated.')
      setSelected(null)
      await load()
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Failed to revoke role.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {toasts}

      {showGrant && (
        <GrantDialog
          onClose={() => setShowGrant(false)}
          onGrant={handleGrant}
          busy={busy}
        />
      )}

      {selected && (
        <StaffDetail
          member={selected}
          onRevoke={handleRevoke}
          onClose={() => setSelected(null)}
          busy={busy}
        />
      )}

      <AdminCard
        title="Staff Management"
        description="All accounts with the admin role. Every grant or revoke is verified server-side, syncs the Firebase custom claim, and is written to the audit log."
        icon={<UserCog className="size-4" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setShowGrant(true)}
              className="gap-1.5 text-xs"
            >
              <UserPlus className="size-3.5" />
              Grant staff role
            </Button>
          </div>
        }
      >
        {/* Info callout */}
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-3 text-[11px] text-primary/90">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Staff accounts have full console access. Keep this list minimal — grant only to people
            who genuinely need operations access. Use <strong>Revoke staff role</strong> to remove
            access instantly without deleting the worker account.
          </span>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <ShieldOff className="size-8 opacity-40" />
            <p className="text-sm font-medium">No staff accounts yet</p>
            <p className="text-xs">
              Grant the staff role to a worker account using the button above.
            </p>
          </div>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[36rem] border-collapse text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Verified</th>
                  <th className="px-3 py-2 font-semibold">Last sign-in</th>
                  <th className="py-2 pl-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row) => {
                  const auth = row.auth
                  return (
                    <tr key={row.uid} className="hover:bg-muted/40 transition-colors">
                      <td className="py-2.5 pr-3 font-medium">{row.name}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                          <Mail className="size-3 shrink-0" />
                          {row.email}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge
                          tone={row.accountState === 'active' ? 'success' : 'warning'}
                        >
                          {row.accountState}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2.5">
                        {auth?.emailVerified ? (
                          <StatusBadge tone="success">
                            <CheckCircle2 className="size-3" />
                            Yes
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="warning">
                            <AlertCircle className="size-3" />
                            No
                          </StatusBadge>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {auth?.lastSignInAt
                          ? new Date(auth.lastSignInAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="py-2.5 pl-3">
                        <button
                          type="button"
                          onClick={() => setSelected(row)}
                          className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {rows.length} staff account{rows.length !== 1 ? 's' : ''} total
            </p>
          </div>
        )}
      </AdminCard>
    </div>
  )
}
