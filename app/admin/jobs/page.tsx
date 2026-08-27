'use client'

import { useMemo, useState } from 'react'
import {
  Briefcase,
  XCircle,
  Pencil,
  Play,
  Plus,
  Pause,
  Trash2,
} from 'lucide-react'
import { useAdminJobs } from '@/components/admin/data-hooks'
import { useAfterWorks } from '@/components/afterworks-provider'
import {
  AdminCard,
  AdminSectionHeader,
  EmptyState,
  Field,
  Select,
  StatCard,
  Td,
  TextArea,
  Th,
  TextInput,
  AdminTable,
} from '@/components/admin/ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import {
  formatDuration,
  formatUsd,
  type Job,
  type JobCategory,
  type JobStatus,
  type StatusTone,
} from '@/lib/afterworks-data'

const CATEGORIES: JobCategory[] = [
  'Data Entry',
  'Transcription',
  'Image Labeling',
  'Content Review',
  'Translation',
  'Research',
]

const JOB_TONES: Record<JobStatus, StatusTone> = {
  open: 'success',
  paused: 'warning',
  closed: 'danger',
}

type Draft = Partial<Job> & { id?: string }

function jobToDraft(job: Job): Draft {
  return { ...job }
}

function emptyDraft(): Draft {
  return {
    title: '',
    category: 'Data Entry',
    description: '',
    responsibilities: [],
    payAmountUsd: 10,
    estimatedMinutes: 60,
    capacity: 20,
    slotsRemaining: 20,
    trainingRequired: false,
    requiresVerified: true,
    status: 'open',
    closesAt: new Date(Date.now() + 30 * 864e5).toISOString(),
  }
}

function JobEditor({
  draft,
  onCancel,
  onSave,
}: {
  draft: Draft
  onCancel: () => void
  onSave: (draft: Draft) => Promise<{ ok: boolean; error?: string }>
}) {
  const [form, setForm] = useState<Draft>(draft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = Boolean(draft.id)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function handleSave() {
    setError(null)
    if (!form.title?.trim()) {
      setError('Title is required.')
      return
    }
    const capacity = Math.max(1, Math.round(Number(form.capacity ?? 1)))
    const payload: Draft = {
      ...form,
      title: form.title?.trim(),
      capacity,
      // Editing a job can never resurrect more slots than capacity.
      slotsRemaining: Math.min(
        Math.max(0, Math.round(Number(form.slotsRemaining ?? capacity))),
        capacity,
      ),
      payAmountUsd: Math.max(0, Number(form.payAmountUsd ?? 0)),
      estimatedMinutes: Math.max(5, Math.round(Number(form.estimatedMinutes ?? 60))),
    }
    setSaving(true)
    const res = await onSave(payload)
    setSaving(false)
    if (!res.ok) setError(res.error ?? 'Failed to save job.')
  }

  return (
    <AdminCard className="border-primary/40">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">{isEdit ? 'Edit job' : 'New job'}</h2>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">
          <TextInput
            value={form.title ?? ''}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Transcribe Swahili customer support calls"
          />
        </Field>

        <Field label="Category">
          <Select
            value={form.category}
            onChange={(e) => set('category', e.target.value as JobCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status">
          <Select
            value={form.status}
            onChange={(e) => set('status', e.target.value as JobStatus)}
          >
            <option value="open">Open</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
          </Select>
        </Field>

        <Field label="Description" className="sm:col-span-2">
          <TextArea
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What the work involves, expectations, and context…"
          />
        </Field>

        <Field label="Responsibilities (one per line)" className="sm:col-span-2">
          <TextArea
            value={(form.responsibilities ?? []).join('\n')}
            onChange={(e) =>
              set(
                'responsibilities',
                e.target.value.split('\n').map((s) => s.trimStart()).filter(Boolean),
              )
            }
            placeholder={'Transcribe 20 audio clips\nAdd speaker labels\nFlag inaudible sections'}
          />
        </Field>

        <Field label="Pay (USD)" hint="Total paid per completed job.">
          <TextInput
            type="number"
            min={0}
            step="0.01"
            value={form.payAmountUsd ?? 0}
            onChange={(e) => set('payAmountUsd', Number(e.target.value))}
          />
        </Field>

        <Field label="Estimated time (minutes)">
          <TextInput
            type="number"
            min={5}
            value={form.estimatedMinutes ?? 60}
            onChange={(e) => set('estimatedMinutes', Number(e.target.value))}
          />
        </Field>

        <Field label="Capacity (total slots)">
          <TextInput
            type="number"
            min={1}
            value={form.capacity ?? 1}
            onChange={(e) => set('capacity', Number(e.target.value))}
          />
        </Field>

        <Field
          label="Slots remaining"
          hint="Decremented when applications are approved — not when applied."
        >
          <TextInput
            type="number"
            min={0}
            max={form.capacity ?? undefined}
            value={form.slotsRemaining ?? 0}
            onChange={(e) => set('slotsRemaining', Number(e.target.value))}
          />
        </Field>

        <Field label="Closes on">
          <TextInput
            type="date"
            value={(form.closesAt ?? '').slice(0, 10)}
            onChange={(e) => {
              const date = e.target.value ? new Date(e.target.value + 'T23:59:59') : undefined
              set('closesAt', date ? date.toISOString() : form.closesAt ?? '')
            }}
          />
        </Field>

        <div className="flex flex-col justify-end gap-2 sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.trainingRequired)}
              onChange={(e) => set('trainingRequired', e.target.checked)}
              className="size-4 rounded border-border accent-primary"
            />
            Training required ($10 fee gates this job)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.requiresVerified !== false}
              onChange={(e) => set('requiresVerified', e.target.checked)}
              className="size-4 rounded border-border accent-primary"
            />
            Requires KYC-verified account
          </label>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create job'}
        </Button>
      </div>
    </AdminCard>
  )
}

export default function AdminJobsPage() {
  const { jobs, loading, error, demo, mutate } = useAdminJobs()
  const { reloadJobs } = useAfterWorks()
  const [editorDraft, setEditorDraft] = useState<Draft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const stats = useMemo(
    () => ({
      open: jobs.filter((j) => j.status === 'open').length,
      slots: jobs.reduce((s, j) => s + (j.status === 'open' ? j.slotsRemaining : 0), 0),
      training: jobs.filter((j) => j.trainingRequired).length,
    }),
    [jobs],
  )

  async function handleSave(draft: Draft): Promise<{ ok: boolean; error?: string }> {
    const isEdit = Boolean(draft.id)
    const res = await mutate(
      isEdit
        ? { action: 'update', id: draft.id, job: draft }
        : { action: 'create', job: draft },
    )
    if (res.ok) {
      setEditorDraft(null)
      await reloadJobs()
    }
    return res
  }

  async function setStatus(job: Job, status: JobStatus) {
    setBusyId(job.id)
    await mutate({ action: 'set_status', id: job.id, status })
    await reloadJobs()
    setBusyId(null)
  }

  async function remove(job: Job) {
    if (!window.confirm(`Delete "${job.title}"? This cannot be undone.`)) return
    setBusyId(job.id)
    await mutate({ action: 'delete', id: job.id })
    await reloadJobs()
    setBusyId(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title="Jobs"
        description="Create, edit and control the job listings workers see."
        actions={
          <Button onClick={() => setEditorDraft(emptyDraft())} disabled={editorDraft !== null}>
            <Plus className="size-4" />
            New job
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open jobs" value={loading ? '…' : stats.open} icon={Briefcase} />
        <StatCard label="Open slots" value={loading ? '…' : stats.slots} icon={Play} />
        <StatCard label="Training-gated" value={loading ? '…' : stats.training} icon={Pause} />
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {editorDraft && (
        <JobEditor
          draft={editorDraft}
          onCancel={() => setEditorDraft(null)}
          onSave={handleSave}
        />
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs yet"
          description="Create the first job listing — it will appear in the worker app immediately."
        />
      ) : (
        <AdminTable>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Pay</Th>
              <Th className="hidden md:table-cell">Slots</Th>
              <Th className="hidden lg:table-cell">Training</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="transition-colors hover:bg-muted/40">
                <Td>
                  <p className="max-w-70 truncate text-sm font-medium text-foreground">{job.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.category} · {formatDuration(job.estimatedMinutes)} · closes{' '}
                    {new Date(job.closesAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                  </p>
                </Td>
                <Td>
                  <StatusBadge tone={JOB_TONES[job.status] ?? 'neutral'}>{job.status}</StatusBadge>
                </Td>
                <Td className="hidden md:table-cell font-mono text-sm">{formatUsd(job.payAmountUsd)}</Td>
                <Td className="hidden md:table-cell font-mono text-sm">
                  {job.slotsRemaining}/{job.capacity}
                </Td>
                <Td className="hidden lg:table-cell text-xs">
                  {job.trainingRequired ? (
                    <span className="rounded bg-accent px-1.5 py-0.5 font-medium text-accent-foreground">
                      $10 required
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="Edit"
                      onClick={() => {
                        setEditorDraft(jobToDraft(job))
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    {job.status !== 'open' && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title="Publish (open)"
                        disabled={busyId === job.id}
                        onClick={() => setStatus(job, 'open')}
                      >
                        <Play className="size-3.5 text-success" />
                      </Button>
                    )}
                    {job.status === 'open' && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title="Pause"
                        disabled={busyId === job.id}
                        onClick={() => setStatus(job, 'paused')}
                      >
                        <Pause className="size-3.5 text-warning-foreground" />
                      </Button>
                    )}
                    {job.status !== 'closed' && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title="Close"
                        disabled={busyId === job.id}
                        onClick={() => setStatus(job, 'closed')}
                      >
                        <XCircle className="size-3.5 text-destructive" />
                      </Button>
                    )}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="Delete"
                      disabled={busyId === job.id}
                      onClick={() => remove(job)}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}

      {demo && (
        <p className="text-xs text-muted-foreground">
          Demo mode — job edits are stored in this browser and reflected
          instantly in the worker app. With Firebase configured, jobs are saved
          to the Firestore `jobs` collection.
        </p>
      )}
    </div>
  )
}
