'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Crown,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlock,
  UserCog,
  UserPlus,
  X,
} from 'lucide-react'
import { adminApi, useAdminSession, type AdminStaffAccountRow, type AdminUserRow } from '@/lib/admin'
import { AdminCard, Field, OwnerOnlyNotice, ReasonDialog, inputClass, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'
import { OWNER_ONLY_SUMMARY, STAFF_CAPABILITY_SUMMARY } from '@/lib/admin-domain'

/**
 * Staff Management — OWNER ONLY.
 *
 * The main administrator (ADMIN_EMAILS roster) is the only role that can create console staff,
 * and the owner chooses each staff member's password here. Two independent doors:
 *
 *   • worker app  → the member's Firebase Auth password (untouched by anything on this page)
 *   • admin panel → the staff password minted here, stored only as an scrypt hash
 *
 * So when a staff member's email matches an existing worker account, both keep working with
 * their own separate passwords.
 */

export default function AdminStaffPage() {
  const session = useAdminSession()
  if (session.status === 'authorized' && session.role !== 'owner') {
    return <OwnerOnlyNotice area="Staff management" />
  }
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

// ─── Password policy mirror (the server has the authoritative copy) ──────────

const MIN_PASSCODE_LENGTH = 10

function passcodeIssue(passcode: string): string | null {
  if (passcode.length < MIN_PASSCODE_LENGTH) return `Use at least ${MIN_PASSCODE_LENGTH} characters.`
  if (passcode.length > 200) return 'That password is too long.'
  const hasUpper = /[A-Z]/.test(passcode)
  const hasLower = /[a-z]/.test(passcode)
  const hasDigitOrSymbol = /\d/.test(passcode) || /[^A-Za-z0-9]/.test(passcode)
  if (!(hasUpper && hasLower) || !hasDigitOrSymbol) return 'Mix upper and lower case, and add a digit or symbol.'
  const common = ['password', 'admin', 'afterworks', '12345', 'qwerty', 'letmein', 'welcome']
  if (common.some((c) => passcode.toLowerCase().includes(c))) return 'Avoid common words like "password" or "admin".'
  return null
}

// ─── Add / reset-password dialog ─────────────────────────────────────────────

function PasswordDialog({
  mode,
  email,
  busy,
  onClose,
  onSubmit,
}: {
  mode: 'add' | 'reset'
  email: string
  busy: boolean
  onClose: () => void
  onSubmit: (email: string, passcode: string) => void
}) {
  const [emailDraft, setEmailDraft] = useState(email)
  const [passcode, setPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)

  const issue = passcode ? passcodeIssue(passcode) : null
  const mismatch = confirm.length > 0 && confirm !== passcode
  const canSubmit =
    (mode === 'reset' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailDraft.trim())) &&
    passcode.length >= MIN_PASSCODE_LENGTH &&
    !issue &&
    passcode === confirm

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-3 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              {mode === 'add' ? 'Add a staff member' : `Set a new password — ${email}`}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {mode === 'add'
                ? 'They sign in to the admin panel with this email and the password you choose. If they also have a worker account with the same email, that account keeps its own password — the two never mix.'
                : 'The old password stops working immediately. Share the new one securely.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {mode === 'add' && (
            <Field label="Staff email">
              <input
                type="email"
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                placeholder="staff@example.com"
                className={inputClass}
                autoFocus
                autoComplete="off"
              />
            </Field>
          )}
          <Field label="Console password" hint="You decide it — they cannot change it themselves. Stored only as an scrypt hash.">
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                className={cn(inputClass, 'pr-10 font-mono')}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShow((value) => !value)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                {show ? <Lock className="size-3.5" /> : <KeyRound className="size-3.5" />}
              </button>
            </div>
          </Field>
          {passcode && issue && <p className="text-[11px] font-medium text-destructive">{issue}</p>}
          <Field label="Repeat password">
            <input
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={cn(inputClass, 'font-mono')}
              autoComplete="new-password"
            />
          </Field>
          {mismatch && <p className="text-[11px] font-medium text-destructive">The two passwords do not match.</p>}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={busy || !canSubmit}
            onClick={() => onSubmit(emailDraft.trim().toLowerCase(), passcode)}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : mode === 'add' ? <UserPlus className="size-3.5" /> : <KeyRound className="size-3.5" />}
            {mode === 'add' ? 'Create staff account' : 'Update password'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function StaffPageInner() {
  const session = useAdminSession()
  const { push, toasts } = useToasts()

  const [owners, setOwners] = useState<string[]>([])
  const [staff, setStaff] = useState<AdminStaffAccountRow[]>([])
  const [legacy, setLegacy] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [degraded, setDegraded] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<{ mode: 'add' | 'reset'; email: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<AdminStaffAccountRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminApi.staff()
      setOwners(data.owners)
      setStaff(data.staff)
      setDegraded(data.degraded)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load staff accounts.')
    } finally {
      setLoading(false)
    }
    // Legacy grants (users collection) are best-effort: storage-less deployments just show none.
    try {
      const users = await adminApi.users({ pageSize: 100, state: 'admins' })
      setLegacy(users.rows)
    } catch {
      setLegacy([])
    }
  }, [])

  useEffect(() => {
    if (session.status === 'authorized') void load()
  }, [session.status, load])

  const knownEmails = useMemo(
    () => new Set([...owners, ...staff.map((row) => row.email)].map((email) => email.toLowerCase())),
    [owners, staff],
  )
  const legacyOnly = useMemo(() => legacy.filter((row) => !knownEmails.has(row.email.toLowerCase())), [legacy, knownEmails])

  const submitPassword = async (email: string, passcode: string) => {
    if (!dialog) return
    setBusy(true)
    try {
      if (dialog.mode === 'add') {
        await adminApi.staffAdd({ email, passcode })
        push('success', `Staff account created for ${email}. Share the password securely — it cannot be shown again.`)
      } else {
        await adminApi.staffUpdate({ email, action: 'password', passcode })
        push('success', `Password updated for ${email}.`)
      }
      setDialog(null)
      await load()
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'The staff desk rejected that change.')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (row: AdminStaffAccountRow, status: 'active' | 'disabled') => {
    setBusy(true)
    try {
      await adminApi.staffUpdate({ email: row.email, action: 'status', status })
      push('success', status === 'disabled' ? `${row.email} can no longer open the console.` : `${row.email} restored.`)
      await load()
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Could not change that account.')
    } finally {
      setBusy(false)
    }
  }

  const convertLegacy = (row: AdminUserRow) => setDialog({ mode: 'add', email: row.email })

  const revokeLegacy = async (row: AdminUserRow) => {
    setBusy(true)
    try {
      await adminApi.userAction({ uid: row.uid, action: 'role', payload: { isAdmin: false, email: row.email } })
      push('success', `Legacy console access revoked for ${row.email}.`)
      await load()
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Could not revoke that grant.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {toasts}

      {dialog && (
        <PasswordDialog mode={dialog.mode} email={dialog.email} busy={busy} onClose={() => setDialog(null)} onSubmit={(email, passcode) => void submitPassword(email, passcode)} />
      )}

      <ReasonDialog
        open={!!confirmRemove}
        title={`Remove ${confirmRemove?.email ?? ''}?`}
        description="Console access ends on their next request. If they have a worker account with the same email, it is not touched — only the staff login is deleted. The removal is written to the audit log."
        confirmLabel="Remove staff account"
        tone="destructive"
        busy={busy}
        requireReason
        onCancel={() => setConfirmRemove(null)}
        onConfirm={async () => {
          if (!confirmRemove) return
          setBusy(true)
          try {
            await adminApi.staffRemove(confirmRemove.email)
            push('success', `${confirmRemove.email} removed from the staff desk.`)
            setConfirmRemove(null)
            await load()
          } catch (err) {
            push('error', err instanceof Error ? err.message : 'Could not remove that account.')
          } finally {
            setBusy(false)
          }
        }}
      />

      {/* How the two roles work */}
      <AdminCard
        title="Staff Management"
        description="Who can open the operations console, and with which password."
        icon={<UserCog className="size-4" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={loading} onClick={() => void load()}>
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setDialog({ mode: 'add', email: '' })}>
              <UserPlus className="size-3.5" />
              Add staff member
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Crown className="size-3.5 text-primary" />
              Main administrator (owner)
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Full authority: staff, money, maintenance, audit log, security, user moderation and the
              job catalogue. Configured via the <code className="font-mono">ADMIN_EMAILS</code> server
              variable and the shared master passcode — owners cannot be added or removed from this page.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/30 p-3.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <ShieldCheck className="size-3.5 text-muted-foreground" />
              Staff (limited)
            </p>
            <ul className="flex flex-col gap-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {STAFF_CAPABILITY_SUMMARY.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Not for staff: {OWNER_ONLY_SUMMARY.map((line) => line.toLowerCase()).join('; ')}. Each staff
              member gets an individual password that <strong>you</strong> choose — the worker-side
              password for the same email stays separate and untouched.
            </p>
          </div>
        </div>

        {error && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>}
        {degraded && <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning-foreground">{degraded}</p>}
      </AdminCard>

      {/* Owners (read-only, from env) */}
      <AdminCard title="Main administrators" description="From the ADMIN_EMAILS server variable. Edit the deployment env to change this list." icon={<Crown className="size-4" />}>
        {owners.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">ADMIN_EMAILS is not configured on this deployment.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {owners.map((email) => (
              <li key={email} className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-xs">
                <Mail className="size-3.5 shrink-0 text-primary" />
                <span className="font-mono text-foreground">{email}</span>
                <StatusBadge tone="info">owner</StatusBadge>
                {email.toLowerCase() === session.email?.toLowerCase() && <span className="ml-auto text-[10px] text-muted-foreground">you</span>}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      {/* Managed staff accounts */}
      <AdminCard title="Staff accounts" description="Console logins you created, each with its own password. Disabled accounts are rejected on their next request." icon={<ShieldCheck className="size-4" />}>
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : staff.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No staff accounts yet. Use “Add staff member” to create one.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[44rem] border-collapse text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Created by</th>
                  <th className="px-3 py-2 font-semibold">Created</th>
                  <th className="px-3 py-2 font-semibold">Last sign-in</th>
                  <th className="py-2 pl-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {staff.map((row) => (
                  <tr key={row.email} className="transition-colors hover:bg-muted/40">
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-1.5 font-mono text-[11px] text-foreground">
                        <Mail className="size-3 shrink-0 text-muted-foreground" />
                        {row.email}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge tone={row.status === 'active' ? 'success' : 'danger'}>{row.status}</StatusBadge>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.createdBy || '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.lastSignInAt ? new Date(row.lastSignInAt).toLocaleString() : 'never'}</td>
                    <td className="py-2.5 pl-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={busy} onClick={() => setDialog({ mode: 'reset', email: row.email })}>
                          <KeyRound className="size-3" />
                          Password
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={busy} onClick={() => void setStatus(row, row.status === 'active' ? 'disabled' : 'active')}>
                          {row.status === 'active' ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                          {row.status === 'active' ? 'Disable' : 'Enable'}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => setConfirmRemove(row)}>
                          <Trash2 className="size-3" />
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {staff.length} staff account{staff.length !== 1 ? 's' : ''} · passwords are stored as scrypt hashes and can only be reset, never read.
            </p>
          </div>
        )}
      </AdminCard>

      {/* Legacy grants predating managed staff accounts */}
      <AdminCard
        title="Legacy console grants"
        description="Worker accounts flagged isAdmin before staff accounts existed. They can still sign in with the master passcode at staff level — convert them to a managed account with their own password, or revoke access."
        icon={<ShieldCheck className="size-4" />}
      >
        {legacyOnly.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No legacy grants — every console login is managed here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {legacyOnly.map((row) => (
              <li key={row.uid} className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
                <span className="font-mono text-[11px] text-foreground">{row.email}</span>
                <StatusBadge tone="warning">legacy grant</StatusBadge>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={busy} onClick={() => convertLegacy(row)}>
                    <KeyRound className="size-3" />
                    Set own password
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => void revokeLegacy(row)}>
                    Revoke access
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  )
}
