'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  UserCheck,
  UserX,
  Users,
  XCircle,
} from 'lucide-react'
import {
  subscribeToAllUsers,
  updateUserAdmin,
  deleteUserDocument,
  createAdminAuditLog,
  type UserDocument,
  type AccountState,
} from '@/lib/firestore'
import { formatUsd, formatKes } from '@/lib/afterworks-data'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/firebase-auth-provider'
import { cn } from '@/lib/utils'

const ACCOUNT_STATES: { value: AccountState; label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }[] = [
  { value: 'active', label: 'Active', tone: 'success' },
  { value: 'kyc_rejected', label: 'KYC Rejected', tone: 'danger' },
  { value: 'kyc_resubmission', label: 'KYC Resubmission Required', tone: 'warning' },
  { value: 'kyc_on_hold', label: 'KYC On Hold', tone: 'warning' },
  { value: 'kyc_abandoned', label: 'KYC Abandoned', tone: 'neutral' },
  { value: 'kyc_expired', label: 'KYC Expired', tone: 'neutral' },
  { value: 'suspended', label: 'Suspended', tone: 'danger' },
  { value: 'banned', label: 'Banned', tone: 'danger' },
]

export default function AdminUsersPage() {
  const { user: currentAdmin } = useAuth()
  const [users, setUsers] = useState<UserDocument[]>([])
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<string>('all')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [selectedUid, setSelectedUid] = useState<string | null>(null)

  // Edit states for the selected user
  const [editState, setEditState] = useState<AccountState>('active')
  const [editPendingUsd, setEditPendingUsd] = useState<string>('0')
  const [editAvailableUsd, setEditAvailableUsd] = useState<string>('0')
  const [editPayoutNumber, setEditPayoutNumber] = useState<string>('')
  const [editIsAdmin, setEditIsAdmin] = useState<boolean>(false)
  const [editQualityScore, setEditQualityScore] = useState<string>('100')
  const [editJobsCompleted, setEditJobsCompleted] = useState<string>('0')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    const unsub = subscribeToAllUsers(setUsers)
    return () => unsub()
  }, [])

  const selectedUser = useMemo(
    () => users.find((u) => u.uid === selectedUid) || null,
    [users, selectedUid],
  )

  // Populate edit fields when selectedUser changes
  useEffect(() => {
    if (selectedUser) {
      setEditState(selectedUser.accountState || 'active')
      setEditPendingUsd(String(selectedUser.wallet?.pendingUsd ?? 0))
      setEditAvailableUsd(String(selectedUser.wallet?.availableUsd ?? 0))
      setEditPayoutNumber(selectedUser.wallet?.payoutNumber || selectedUser.phone || '')
      setEditIsAdmin(Boolean(selectedUser.isAdmin || selectedUser.role === 'admin'))
      setEditQualityScore(String(selectedUser.qualityScore ?? 100))
      setEditJobsCompleted(String(selectedUser.jobsCompleted ?? 0))
      setMessage(null)
    }
  }, [selectedUser])

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = search.toLowerCase()
      const matchSearch =
        !search ||
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.location?.toLowerCase().includes(q) ||
        u.phone?.toLowerCase().includes(q) ||
        u.bankAccountNumber?.toLowerCase().includes(q)

      const matchState = stateFilter === 'all' || u.accountState === stateFilter
      const matchRole =
        roleFilter === 'all' ||
        (roleFilter === 'admin' && (u.isAdmin || u.role === 'admin')) ||
        (roleFilter === 'user' && !u.isAdmin && u.role !== 'admin')

      return matchSearch && matchState && matchRole
    })
  }, [users, search, stateFilter, roleFilter])

  const handleSaveState = async () => {
    if (!selectedUser) return
    setSaving(true)
    try {
      await updateUserAdmin(selectedUser.uid, { accountState: editState })
      await createAdminAuditLog(
        'UPDATE_USER_ACCOUNT_STATE',
        { targetUid: selectedUser.uid, targetEmail: selectedUser.email, newState: editState },
        currentAdmin?.email || 'Admin',
      )
      setMessage({ text: 'Account state updated successfully.', type: 'success' })
    } catch (err) {
      setMessage({ text: 'Failed to update account state.', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveWallet = async () => {
    if (!selectedUser) return
    setSaving(true)
    try {
      const pendingNum = parseFloat(editPendingUsd) || 0
      const availableNum = parseFloat(editAvailableUsd) || 0
      const newWallet = {
        pendingUsd: pendingNum,
        availableUsd: availableNum,
        payoutNumber: editPayoutNumber,
      }
      await updateUserAdmin(selectedUser.uid, { wallet: newWallet })
      await createAdminAuditLog(
        'UPDATE_USER_WALLET',
        { targetUid: selectedUser.uid, targetEmail: selectedUser.email, wallet: newWallet },
        currentAdmin?.email || 'Admin',
      )
      setMessage({ text: 'Wallet balances updated successfully.', type: 'success' })
    } catch (err) {
      setMessage({ text: 'Failed to update wallet balances.', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAdminRole = async () => {
    if (!selectedUser) return
    setSaving(true)
    try {
      const role = editIsAdmin ? 'admin' : 'user'
      await updateUserAdmin(selectedUser.uid, { isAdmin: editIsAdmin, role })
      await createAdminAuditLog(
        editIsAdmin ? 'GRANT_ADMIN_ROLE' : 'REVOKE_ADMIN_ROLE',
        { targetUid: selectedUser.uid, targetEmail: selectedUser.email, isAdmin: editIsAdmin },
        currentAdmin?.email || 'Admin',
      )
      setMessage({
        text: `Admin privileges ${editIsAdmin ? 'granted' : 'revoked'} successfully.`,
        type: 'success',
      })
    } catch (err) {
      setMessage({ text: 'Failed to update role privileges.', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveScoreAndJobs = async () => {
    if (!selectedUser) return
    setSaving(true)
    try {
      const qScore = Math.min(100, Math.max(0, parseInt(editQualityScore, 10) || 100))
      const jobsCount = Math.max(0, parseInt(editJobsCompleted, 10) || 0)
      await updateUserAdmin(selectedUser.uid, {
        qualityScore: qScore,
        jobsCompleted: jobsCount,
      })
      await createAdminAuditLog(
        'UPDATE_USER_PERFORMANCE',
        { targetUid: selectedUser.uid, qualityScore: qScore, jobsCompleted: jobsCount },
        currentAdmin?.email || 'Admin',
      )
      setMessage({ text: 'Worker metrics updated successfully.', type: 'success' })
    } catch (err) {
      setMessage({ text: 'Failed to update worker metrics.', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!selectedUser) return
    const confirm = window.confirm(
      `Are you sure you want to permanently delete user "${selectedUser.name || selectedUser.email}"? This action cannot be undone.`,
    )
    if (!confirm) return

    setSaving(true)
    try {
      await deleteUserDocument(selectedUser.uid)
      await createAdminAuditLog(
        'DELETE_USER_DOCUMENT',
        { targetUid: selectedUser.uid, targetEmail: selectedUser.email },
        currentAdmin?.email || 'Admin',
      )
      setSelectedUid(null)
    } catch (err) {
      setMessage({ text: 'Failed to delete user document.', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const getStateBadge = (state?: AccountState) => {
    const s = state || 'active'
    if (s === 'active') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
          <CheckCircle2 className="size-3" /> Active
        </span>
      )
    }
    if (s === 'suspended' || s === 'banned') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-semibold text-destructive">
          <UserX className="size-3" /> {s.toUpperCase()}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
        <AlertTriangle className="size-3" /> {s.replace(/_/g, ' ')}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header with Search & Filters */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">User Management</h2>
            <p className="text-xs text-muted-foreground">
              Total registered users: <span className="font-mono font-semibold text-foreground">{users.length}</span> (showing {filteredUsers.length})
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search name, email, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-4 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60 text-xs">
          <span className="text-muted-foreground font-medium mr-1">Filter state:</span>
          <button
            type="button"
            onClick={() => setStateFilter('all')}
            className={cn(
              'rounded-lg px-2.5 py-1 font-medium transition-colors',
              stateFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            All States
          </button>
          {ACCOUNT_STATES.slice(0, 4).map((st) => (
            <button
              key={st.value}
              type="button"
              onClick={() => setStateFilter(st.value)}
              className={cn(
                'rounded-lg px-2.5 py-1 font-medium transition-colors',
                stateFilter === st.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {st.label}
            </button>
          ))}

          <span className="text-muted-foreground font-medium ml-3 mr-1">Role:</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="all">All Roles</option>
            <option value="user">Worker Users</option>
            <option value="admin">Admins Only</option>
          </select>
        </div>
      </div>

      {/* Main Grid: User List & Detail Panel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* User Table/List (7 cols on lg) */}
        <div className={cn('flex flex-col gap-3', selectedUser ? 'lg:col-span-6' : 'lg:col-span-12')}>
          {filteredUsers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground bg-card">
              No users found matching the filter criteria.
            </div>
          ) : (
            filteredUsers.map((u) => {
              const isSelected = selectedUid === u.uid
              const isAdmin = u.isAdmin || u.role === 'admin'
              return (
                <div
                  key={u.uid}
                  onClick={() => setSelectedUid(isSelected ? null : u.uid)}
                  className={cn(
                    'cursor-pointer rounded-2xl border p-4 transition-all bg-card shadow-sm hover:border-primary/50',
                    isSelected ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-foreground">
                        {(u.name?.[0] || u.email?.[0] || 'U').toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-bold text-foreground text-sm">
                            {u.name || 'Unnamed Worker'}
                          </p>
                          {isAdmin && (
                            <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-bold text-primary">
                              ADMIN
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="size-3" /> {u.email}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {getStateBadge(u.accountState)}
                      {u.kycVerified ? (
                        <span className="text-[11px] font-medium text-success flex items-center gap-1">
                          <ShieldCheck className="size-3" /> KYC Verified
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Unverified KYC</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
                    <div>
                      <span className="block text-[10px] uppercase">Available</span>
                      <span className="font-mono font-semibold text-foreground">
                        {formatUsd(u.wallet?.availableUsd || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase">Pending</span>
                      <span className="font-mono font-semibold text-foreground">
                        {formatUsd(u.wallet?.pendingUsd || 0)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[10px] uppercase">Score</span>
                      <span className="font-semibold text-foreground">{u.qualityScore ?? 100} / 100</span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Selected User Management Panel (6 cols on lg) */}
        {selectedUser && (
          <div className="flex flex-col gap-5 rounded-2xl border border-primary/30 bg-card p-5 shadow-md lg:col-span-6 sticky top-20 self-start">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Inspect & Edit Worker</h3>
                <p className="text-xs font-mono text-muted-foreground truncate max-w-xs">
                  UID: {selectedUser.uid}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedUid(null)}
                className="text-muted-foreground"
              >
                Close
              </Button>
            </div>

            {message && (
              <div
                className={cn(
                  'rounded-xl p-3 text-xs font-medium',
                  message.type === 'success'
                    ? 'bg-success/15 text-success border border-success/30'
                    : 'bg-destructive/15 text-destructive border border-destructive/30',
                )}
              >
                {message.text}
              </div>
            )}

            {/* Profile Overview Chips */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-muted/40 p-2.5">
                <span className="text-[10px] text-muted-foreground block">Country / Location</span>
                <span className="font-medium text-foreground">
                  {selectedUser.country || selectedUser.location || 'Not provided'}
                </span>
              </div>
              <div className="rounded-xl bg-muted/40 p-2.5">
                <span className="text-[10px] text-muted-foreground block">Phone</span>
                <span className="font-medium text-foreground font-mono">
                  {selectedUser.phone || selectedUser.wallet?.payoutNumber || 'Not provided'}
                </span>
              </div>
              <div className="rounded-xl bg-muted/40 p-2.5">
                <span className="text-[10px] text-muted-foreground block">Bank Name</span>
                <span className="font-medium text-foreground">
                  {selectedUser.bankName || 'Not provided'}
                </span>
              </div>
              <div className="rounded-xl bg-muted/40 p-2.5">
                <span className="text-[10px] text-muted-foreground block">Bank Account #</span>
                <span className="font-medium text-foreground font-mono">
                  {selectedUser.bankAccountNumber || 'Not provided'}
                </span>
              </div>
            </div>

            {/* Account State Control */}
            <div className="rounded-xl border border-border/80 bg-muted/20 p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                Account Lifecycle State
              </h4>
              <div className="flex items-center gap-2">
                <select
                  value={editState}
                  onChange={(e) => setEditState(e.target.value as AccountState)}
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
                >
                  {ACCOUNT_STATES.map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
                <Button onClick={handleSaveState} disabled={saving} size="sm">
                  {saving ? 'Saving...' : 'Update State'}
                </Button>
              </div>
            </div>

            {/* Wallet Balances Adjustment */}
            <div className="rounded-xl border border-border/80 bg-muted/20 p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                Wallet & Payout Balances (USD)
              </h4>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground block mb-1">
                    Available USD
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editAvailableUsd}
                    onChange={(e) => setEditAvailableUsd(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-mono font-bold text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground block mb-1">
                    Pending USD (Clearing)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editPendingUsd}
                    onChange={(e) => setEditPendingUsd(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-mono font-bold text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
              <div className="mb-3">
                <label className="text-[10px] font-semibold text-muted-foreground block mb-1">
                  Payout Phone Number / M-Pesa
                </label>
                <input
                  type="text"
                  value={editPayoutNumber}
                  onChange={(e) => setEditPayoutNumber(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                  placeholder="+254 7XX XXX XXX"
                />
              </div>
              <Button onClick={handleSaveWallet} disabled={saving} size="sm" className="w-full">
                {saving ? 'Saving...' : 'Save Wallet Adjustments'}
              </Button>
            </div>

            {/* Quality Score & Jobs Completed */}
            <div className="rounded-xl border border-border/80 bg-muted/20 p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                Worker Quality & Statistics
              </h4>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground block mb-1">
                    Quality Score (0–100)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={editQualityScore}
                    onChange={(e) => setEditQualityScore(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-mono font-bold text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground block mb-1">
                    Jobs Completed Count
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editJobsCompleted}
                    onChange={(e) => setEditJobsCompleted(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-mono font-bold text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
              <Button onClick={handleSaveScoreAndJobs} disabled={saving} variant="outline" size="sm" className="w-full">
                Save Performance Metrics
              </Button>
            </div>

            {/* Admin Role Permission */}
            <div className="rounded-xl border border-border/80 bg-muted/20 p-4 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-foreground block">Administrator Privileges</span>
                <span className="text-[11px] text-muted-foreground">
                  Grants full access to this admin console & maintenance bypass.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="adminToggle"
                  checked={editIsAdmin}
                  onChange={(e) => setEditIsAdmin(e.target.checked)}
                  className="size-4 rounded border-border accent-primary cursor-pointer"
                />
                <Button onClick={handleSaveAdminRole} disabled={saving} size="sm" variant="outline">
                  Apply Role
                </Button>
              </div>
            </div>

            {/* Danger Zone: Delete user */}
            <div className="mt-2 border-t border-destructive/20 pt-4">
              <Button
                onClick={handleDeleteUser}
                disabled={saving}
                variant="destructive"
                size="sm"
                className="w-full gap-1.5"
              >
                <Trash2 className="size-3.5" />
                Permanently Delete User Record
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
