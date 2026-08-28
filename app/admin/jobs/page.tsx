'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Clock,
  Edit2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  StopCircle,
  Trash2,
  X,
} from 'lucide-react'
import {
  subscribeToJobs,
  saveJobToFirestore,
  deleteJobFromFirestore,
  createAdminAuditLog,
} from '@/lib/firestore'
import {
  seedJobs,
  formatUsd,
  formatKes,
  formatDuration,
  type Job,
  type JobCategory,
  type JobStatus,
} from '@/lib/afterworks-data'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/firebase-auth-provider'
import { cn } from '@/lib/utils'

const CATEGORIES: JobCategory[] = [
  'Data Entry',
  'Transcription',
  'Image Labeling',
  'Content Review',
  'Translation',
  'Research',
]

const emptyJobForm = {
  id: '',
  title: '',
  category: 'Data Entry' as JobCategory,
  description: '',
  responsibilitiesText: '',
  payAmountUsd: 25,
  estimatedMinutes: 120,
  capacity: 50,
  slotsRemaining: 50,
  trainingRequired: false,
  requiresVerified: true,
  status: 'open' as JobStatus,
  closesInDays: 7,
}

export default function AdminJobsPage() {
  const { user } = useAuth()
  const [jobs, setJobs] = useState<Job[]>([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Form modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState(emptyJobForm)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const unsub = subscribeToJobs(setJobs)
    return () => unsub()
  }, [])

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      const q = search.toLowerCase()
      const matchSearch =
        !search ||
        j.title?.toLowerCase().includes(q) ||
        j.description?.toLowerCase().includes(q) ||
        j.category?.toLowerCase().includes(q)
      const matchCategory = categoryFilter === 'all' || j.category === categoryFilter
      const matchStatus = statusFilter === 'all' || j.status === statusFilter
      return matchSearch && matchCategory && matchStatus
    })
  }, [jobs, search, categoryFilter, statusFilter])

  const handleOpenCreateModal = () => {
    setIsEditing(false)
    setFormData({
      ...emptyJobForm,
      id: `job-${Date.now()}`,
    })
    setIsModalOpen(true)
  }

  const handleOpenEditModal = (job: Job) => {
    setIsEditing(true)
    setFormData({
      id: job.id,
      title: job.title,
      category: job.category,
      description: job.description,
      responsibilitiesText: (job.responsibilities || []).join('\n'),
      payAmountUsd: job.payAmountUsd,
      estimatedMinutes: job.estimatedMinutes,
      capacity: job.capacity,
      slotsRemaining: job.slotsRemaining,
      trainingRequired: job.trainingRequired,
      requiresVerified: job.requiresVerified,
      status: job.status,
      closesInDays: 7,
    })
    setIsModalOpen(true)
  }

  const handleSaveJob = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const closesAtDate = new Date()
      closesAtDate.setDate(closesAtDate.getDate() + (formData.closesInDays || 7))

      const responsibilities = formData.responsibilitiesText
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean)

      const jobPayload: Job = {
        id: formData.id || `job-${Date.now()}`,
        title: formData.title,
        category: formData.category,
        description: formData.description,
        responsibilities: responsibilities.length > 0 ? responsibilities : ['Complete assigned microtasks accurately'],
        payAmountUsd: Number(formData.payAmountUsd) || 10,
        estimatedMinutes: Number(formData.estimatedMinutes) || 60,
        capacity: Number(formData.capacity) || 50,
        slotsRemaining: Number(formData.slotsRemaining) || 50,
        trainingRequired: Boolean(formData.trainingRequired),
        requiresVerified: Boolean(formData.requiresVerified),
        status: formData.status,
        closesAt: closesAtDate.toISOString(),
        postedAgo: isEditing ? 'Updated recently' : 'Just now',
      }

      await saveJobToFirestore(jobPayload)
      await createAdminAuditLog(
        isEditing ? 'UPDATE_JOB' : 'CREATE_JOB',
        { jobId: jobPayload.id, title: jobPayload.title, status: jobPayload.status },
        user?.email || 'Admin',
      )

      setIsModalOpen(false)
    } catch (err) {
      console.error('Failed to save job:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleStatus = async (job: Job) => {
    const nextStatus: JobStatus = job.status === 'open' ? 'paused' : 'open'
    try {
      await saveJobToFirestore({ ...job, status: nextStatus })
      await createAdminAuditLog(
        'TOGGLE_JOB_STATUS',
        { jobId: job.id, from: job.status, to: nextStatus },
        user?.email || 'Admin',
      )
    } catch (err) {
      console.error('Failed to toggle job status:', err)
    }
  }

  const handleDeleteJob = async (job: Job) => {
    const confirm = window.confirm(`Are you sure you want to delete job "${job.title}"?`)
    if (!confirm) return

    try {
      await deleteJobFromFirestore(job.id)
      await createAdminAuditLog(
        'DELETE_JOB',
        { jobId: job.id, title: job.title },
        user?.email || 'Admin',
      )
    } catch (err) {
      console.error('Failed to delete job:', err)
    }
  }

  const handleSeedJobs = async () => {
    const confirm = window.confirm('Seed all default catalog jobs to Firestore?')
    if (!confirm) return

    for (const j of seedJobs()) {
      await saveJobToFirestore(j)
    }
    await createAdminAuditLog('SEED_DEFAULT_JOBS', { count: seedJobs().length }, user?.email || 'Admin')
  }

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case 'open':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
            <PlayCircle className="size-3" /> Open
          </span>
        )
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <PauseCircle className="size-3" /> Paused
          </span>
        )
      case 'closed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            <StopCircle className="size-3" /> Closed
          </span>
        )
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header Controls */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Jobs & Tasks Catalog</h2>
            <p className="text-xs text-muted-foreground">
              Total jobs: <span className="font-mono font-semibold text-foreground">{jobs.length}</span> (showing {filteredJobs.length})
            </p>
          </div>

          <div className="flex items-center gap-2">
            {jobs.length === 0 && (
              <Button onClick={handleSeedJobs} variant="outline" size="sm" className="gap-1.5 text-xs">
                <Sparkles className="size-3.5 text-primary" />
                Seed Standard Catalog
              </Button>
            )}
            <Button onClick={handleOpenCreateModal} size="sm" className="gap-1.5">
              <Plus className="size-4" />
              Create New Job
            </Button>
          </div>
        </div>

        {/* Filters and search */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground font-medium">Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="all">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <span className="text-muted-foreground font-medium ml-2">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="paused">Paused</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search job title or desc..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Jobs Grid */}
      {filteredJobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground bg-card">
          No jobs found. Click &quot;Create New Job&quot; or &quot;Seed Standard Catalog&quot; to populate.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredJobs.map((job) => (
            <div
              key={job.id}
              className="flex flex-col justify-between rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm transition-all hover:border-primary/40"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                    {job.category}
                  </span>
                  {getStatusBadge(job.status)}
                </div>

                <h3 className="mt-2.5 text-sm font-bold text-foreground leading-snug line-clamp-2">
                  {job.title}
                </h3>
                <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                  {job.description}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 border-y border-border/60 py-2.5 text-xs">
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase block">Pay (USD)</span>
                    <span className="font-mono font-bold text-foreground text-sm">
                      {formatUsd(job.payAmountUsd)}
                    </span>
                    <span className="text-[10px] text-muted-foreground block">
                      ≈ {formatKes(job.payAmountUsd)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase block">Available Slots</span>
                    <span className="font-mono font-bold text-foreground text-sm">
                      {job.slotsRemaining} <span className="text-xs font-normal text-muted-foreground">/ {job.capacity}</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground block flex items-center gap-1 mt-0.5">
                      <Clock className="size-2.5" /> {formatDuration(job.estimatedMinutes)}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  {job.trainingRequired && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-400">
                      Training Module
                    </span>
                  )}
                  {job.requiresVerified && (
                    <span className="rounded bg-success/10 px-1.5 py-0.5 font-medium text-success">
                      KYC Required
                    </span>
                  )}
                </div>
              </div>

              {/* Card Actions */}
              <div className="mt-4 flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                <Button
                  onClick={() => handleToggleStatus(job)}
                  variant="outline"
                  size="xs"
                  className={cn(
                    'gap-1 text-[11px]',
                    job.status === 'open' ? 'text-amber-600' : 'text-success',
                  )}
                >
                  {job.status === 'open' ? (
                    <>
                      <PauseCircle className="size-3" /> Pause
                    </>
                  ) : (
                    <>
                      <PlayCircle className="size-3" /> Activate
                    </>
                  )}
                </Button>

                <div className="flex items-center gap-1">
                  <Button
                    onClick={() => handleOpenEditModal(job)}
                    variant="ghost"
                    size="xs"
                    className="size-7 p-0"
                    title="Edit Job"
                  >
                    <Edit2 className="size-3.5 text-muted-foreground" />
                  </Button>
                  <Button
                    onClick={() => handleDeleteJob(job)}
                    variant="ghost"
                    size="xs"
                    className="size-7 p-0 hover:text-destructive"
                    title="Delete Job"
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Job Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <h3 className="text-base font-bold text-foreground">
                {isEditing ? 'Edit Job Posting' : 'Create New Job Posting'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSaveJob} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Job Title *
                </label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. Transcribe Swahili Audio Recordings"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Category *
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value as JobCategory })
                    }
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Initial Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({ ...formData, status: e.target.value as JobStatus })
                    }
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="open">Open</option>
                    <option value="paused">Paused</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Short Description *
                </label>
                <textarea
                  required
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief overview of tasks and requirements..."
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Responsibilities & Instructions (one item per line)
                </label>
                <textarea
                  rows={3}
                  value={formData.responsibilitiesText}
                  onChange={(e) =>
                    setFormData({ ...formData, responsibilitiesText: e.target.value })
                  }
                  placeholder="Listen to 20 audio clips&#10;Add speaker labels&#10;Flag unclear sections"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    Pay (USD)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formData.payAmountUsd}
                    onChange={(e) =>
                      setFormData({ ...formData, payAmountUsd: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-border bg-background px-2.5 py-1.5 text-xs font-mono font-bold text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    Est. Minutes
                  </label>
                  <input
                    type="number"
                    min="5"
                    required
                    value={formData.estimatedMinutes}
                    onChange={(e) =>
                      setFormData({ ...formData, estimatedMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    Capacity
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formData.capacity}
                    onChange={(e) =>
                      setFormData({ ...formData, capacity: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    Slots Left
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={formData.slotsRemaining}
                    onChange={(e) =>
                      setFormData({ ...formData, slotsRemaining: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.trainingRequired}
                    onChange={(e) =>
                      setFormData({ ...formData, trainingRequired: e.target.checked })
                    }
                    className="size-4 rounded border-border accent-primary"
                  />
                  Requires Paid Training Module
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requiresVerified}
                    onChange={(e) =>
                      setFormData({ ...formData, requiresVerified: e.target.checked })
                    }
                    className="size-4 rounded border-border accent-primary"
                  />
                  Requires Verified KYC
                </label>
              </div>

              <div className="mt-2 flex items-center justify-end gap-2 border-t border-border/80 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} size="sm">
                  {saving ? 'Saving Job...' : isEditing ? 'Save Changes' : 'Create Job'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
