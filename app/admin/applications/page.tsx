'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileCheck,
  FileText,
  Filter,
  History,
  ListChecks,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  XCircle,
} from 'lucide-react'
import {
  subscribeToAllApplications,
  subscribeToJobs,
  updateApplicationInFirestore,
  createAdminAuditLog,
} from '@/lib/firestore'
import {
  formatUsd,
  formatKes,
  APPLICATION_LABELS,
  type Application,
  type ApplicationStatus,
  type Job,
} from '@/lib/afterworks-data'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/firebase-auth-provider'
import { cn } from '@/lib/utils'

const STATUSES: { value: ApplicationStatus; label: string; tone: string }[] = [
  { value: 'under_review', label: 'Under Review', tone: 'text-info bg-info/10' },
  { value: 'approved', label: 'Approved', tone: 'text-primary bg-primary/10' },
  { value: 'in_progress', label: 'In Progress', tone: 'text-primary bg-primary/10' },
  { value: 'submitted_for_review', label: 'Submitted for QA', tone: 'text-amber-600 bg-amber-500/10' },
  { value: 'revision_requested', label: 'Revision Requested', tone: 'text-amber-600 bg-amber-500/10' },
  { value: 'completed', label: 'Completed & Paid', tone: 'text-success bg-success/15' },
  { value: 'rejected', label: 'Rejected', tone: 'text-destructive bg-destructive/15' },
  { value: 'failed_qa', label: 'Failed QA', tone: 'text-destructive bg-destructive/15' },
]

export default function AdminApplicationsPage() {
  const { user: currentAdmin } = useAuth()
  const [applications, setApplications] = useState<Application[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)

  // Transition modal/inline fields
  const [rejectionReason, setRejectionReason] = useState('')
  const [revisionNote, setRevisionNote] = useState('')
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    const unsubApps = subscribeToAllApplications(setApplications)
    const unsubJobs = subscribeToJobs(setJobs)
    return () => {
      unsubApps()
      unsubJobs()
    }
  }, [])

  const jobsMap = useMemo(() => {
    const map = new Map<string, Job>()
    jobs.forEach((j) => map.set(j.id, j))
    return map
  }, [jobs])

  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      const job = jobsMap.get(app.jobId)
      const q = search.toLowerCase()
      const matchSearch =
        !search ||
        app.id.toLowerCase().includes(q) ||
        app.jobId.toLowerCase().includes(q) ||
        job?.title.toLowerCase().includes(q)

      const matchStatus = statusFilter === 'all' || app.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [applications, jobsMap, search, statusFilter])

  const handleUpdateStatus = async (
    appId: string,
    newStatus: ApplicationStatus,
    extras?: { rejectionReason?: string; revisionNote?: string },
  ) => {
    setUpdating(true)
    try {
      await updateApplicationInFirestore(appId, newStatus, extras)
      await createAdminAuditLog(
        'UPDATE_APPLICATION_STATUS',
        { appId, newStatus, ...extras },
        currentAdmin?.email || 'Admin',
      )
      setRejectionReason('')
      setRevisionNote('')
    } catch (err) {
      console.error('Failed to update application status:', err)
    } finally {
      setUpdating(false)
    }
  }

  const getStatusBadge = (status: ApplicationStatus) => {
    const s = STATUSES.find((item) => item.value === status)
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
          s?.tone || 'bg-muted text-muted-foreground',
        )}
      >
        {s?.label || status}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header and Controls */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Worker Applications & QA Review</h2>
            <p className="text-xs text-muted-foreground">
              Total submissions recorded:{' '}
              <span className="font-mono font-semibold text-foreground">{applications.length}</span> (showing {filteredApps.length})
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by ID or job title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-4 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3 text-xs">
          <span className="text-muted-foreground font-medium mr-1">Status:</span>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={cn(
              'rounded-lg px-2.5 py-1 font-medium transition-colors',
              statusFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            All ({applications.length})
          </button>
          {STATUSES.map((st) => {
            const count = applications.filter((a) => a.status === st.value).length
            return (
              <button
                key={st.value}
                type="button"
                onClick={() => setStatusFilter(st.value)}
                className={cn(
                  'rounded-lg px-2.5 py-1 font-medium transition-colors',
                  statusFilter === st.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {st.label} {count > 0 && `(${count})`}
              </button>
            )
          })}
        </div>
      </div>

      {/* Applications List */}
      {filteredApps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground bg-card">
          No applications match the current filter criteria.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredApps.map((app) => {
            const job = jobsMap.get(app.jobId)
            const isSelected = selectedAppId === app.id

            return (
              <div
                key={app.id}
                className={cn(
                  'rounded-2xl border bg-card p-4 sm:p-5 shadow-sm transition-all',
                  isSelected ? 'border-primary ring-1 ring-primary/20' : 'border-border',
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-muted-foreground">
                        {app.id}
                      </span>
                      {getStatusBadge(app.status)}
                    </div>
                    <h3 className="mt-1 text-sm font-bold text-foreground truncate">
                      {job?.title || `Job: ${app.jobId}`}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {job && (
                        <span className="font-mono font-semibold text-foreground">
                          {formatUsd(job.payAmountUsd)}
                        </span>
                      )}
                      <span>Applied: {new Date(app.appliedAt).toLocaleDateString()}</span>
                      {app.reviewExpiresAt && (
                        <span>Expires: {new Date(app.reviewExpiresAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {app.status === 'under_review' && (
                      <>
                        <Button
                          onClick={() => handleUpdateStatus(app.id, 'approved')}
                          disabled={updating}
                          size="xs"
                          className="bg-primary text-primary-foreground gap-1"
                        >
                          <CheckCircle2 className="size-3" /> Approve
                        </Button>
                        <Button
                          onClick={() => {
                            setSelectedAppId(isSelected ? null : app.id)
                          }}
                          variant="destructive"
                          size="xs"
                          className="gap-1"
                        >
                          <XCircle className="size-3" /> Reject...
                        </Button>
                      </>
                    )}

                    {app.status === 'submitted_for_review' && (
                      <>
                        <Button
                          onClick={() => handleUpdateStatus(app.id, 'completed')}
                          disabled={updating}
                          size="xs"
                          className="bg-success text-success-foreground hover:bg-success/90 gap-1"
                        >
                          <CheckCircle2 className="size-3" /> Accept & Pay
                        </Button>
                        <Button
                          onClick={() => setSelectedAppId(isSelected ? null : app.id)}
                          variant="outline"
                          size="xs"
                          className="text-amber-600 gap-1"
                        >
                          <MessageSquare className="size-3" /> Request Revision
                        </Button>
                        <Button
                          onClick={() => handleUpdateStatus(app.id, 'failed_qa')}
                          disabled={updating}
                          variant="destructive"
                          size="xs"
                        >
                          Fail QA
                        </Button>
                      </>
                    )}

                    <Button
                      onClick={() => setSelectedAppId(isSelected ? null : app.id)}
                      variant="outline"
                      size="xs"
                      className="text-xs"
                    >
                      {isSelected ? 'Hide Details' : 'Manage Lifecycle'}
                    </Button>
                  </div>
                </div>

                {/* Expanded Management & History Panel */}
                {isSelected && (
                  <div className="mt-4 rounded-xl border border-border/80 bg-muted/20 p-4 pt-3 flex flex-col gap-4">
                    {/* Status Override Controls */}
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                        Set Exact Application Status
                      </h4>
                      <div className="flex flex-wrap items-center gap-2">
                        {STATUSES.map((st) => (
                          <button
                            key={st.value}
                            type="button"
                            onClick={() =>
                              handleUpdateStatus(app.id, st.value, {
                                rejectionReason: rejectionReason || undefined,
                                revisionNote: revisionNote || undefined,
                              })
                            }
                            disabled={updating || app.status === st.value}
                            className={cn(
                              'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
                              app.status === st.value
                                ? 'bg-primary text-primary-foreground font-bold'
                                : 'bg-background border border-border text-foreground hover:bg-muted',
                            )}
                          >
                            {st.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Reason Notes Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                          Rejection Reason (if rejecting)
                        </label>
                        <input
                          type="text"
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          placeholder="e.g. Incomplete profile or qualifications..."
                          className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                          Revision Feedback Note (if requesting rework)
                        </label>
                        <input
                          type="text"
                          value={revisionNote}
                          onChange={(e) => setRevisionNote(e.target.value)}
                          placeholder="e.g. Please re-check timestamps on section 3..."
                          className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Status History Timeline */}
                    {app.history && app.history.length > 0 && (
                      <div className="border-t border-border/60 pt-3">
                        <span className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 mb-2">
                          <History className="size-3.5" /> State Transition Timeline
                        </span>
                        <div className="flex flex-col gap-1.5 text-xs">
                          {app.history.map((h, idx) => (
                            <div key={idx} className="flex items-center justify-between text-muted-foreground">
                              <span className="font-medium text-foreground">
                                • {APPLICATION_LABELS[h.status] || h.status}
                              </span>
                              <span className="font-mono text-[11px]">
                                {new Date(h.at).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
