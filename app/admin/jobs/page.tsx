'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Eye,
  GraduationCap,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  Pause,
  Play,
  Plus,
  Save,
  Settings2,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react'
import { adminApi, useAdminSession, type AdminJobRow } from '@/lib/admin'
import { AdminCard, Field, ReasonDialog, inputClass, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { assessmentPassMark, formatUsd, trainingFeeKesFor, JOB_CATEGORY_LIST } from '@/lib/afterworks-data'
import { cn } from '@/lib/utils'

/**
 * Job catalogue.
 *
 * The catalogue used to be published by writing `jobs/{id}` straight from the browser, with a
 * client-side `confirm()` and no authorisation beyond a token in localStorage. It now goes through
 * `/api/admin/jobs`, where the payload is validated and normalised server-side (pay bounds, capacity,
 * category whitelist, slot accounting) and every write is attributed and audited.
 *
 * The editor also authors the learning experience attached to a card: the per-job training price,
 * the training sections workers step through, and the assessment questions they answer. Empty
 * notes/questions fall back to the built-in per-category content.
 */

type DraftCheck = {
  question: string
  options: [string, string, string, string]
  correctIndex: number
  explanation: string
}
type DraftSection = {
  title: string
  content: string
  image: string
  imageAlt: string
  imageCaption: string
  /** Blank means "estimate from the lesson length", the same fallback the reader uses. */
  durationMinutes: string
  /** Optional end-of-lesson check; the next lesson unlocks only after it is passed. */
  check: DraftCheck | null
}
type DraftQuestion = {
  question: string
  options: [string, string, string, string]
  correctIndex: number
  image: string
  imageAlt: string
  explanation: string
}

const EMPTY: Draft = {
  title: '',
  category: 'Data Entry',
  description: '',
  responsibilities: '',
  payAmountUsd: 40,
  estimatedMinutes: 90,
  capacity: 10,
  slotsRemaining: 10,
  trainingRequired: false,
  trainingFeeUsd: 10,
  trainingNotes: [],
  assessmentQuestions: [],
  requiresVerified: true,
  status: 'open',
  closesAt: '',
}

const EMPTY_CHECK: DraftCheck = {
  question: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  explanation: '',
}

const EMPTY_SECTION: DraftSection = {
  title: '',
  content: '',
  image: '',
  imageAlt: '',
  imageCaption: '',
  durationMinutes: '',
  check: null,
}

const EMPTY_QUESTION: DraftQuestion = {
  question: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  image: '',
  imageAlt: '',
  explanation: '',
}

type Draft = {
  id?: string
  title: string
  category: string
  description: string
  responsibilities: string
  payAmountUsd: number
  estimatedMinutes: number
  capacity: number
  slotsRemaining: number
  trainingRequired: boolean
  trainingFeeUsd: number
  trainingNotes: DraftSection[]
  assessmentQuestions: DraftQuestion[]
  requiresVerified: boolean
  status: string
  closesAt: string
}

const STATUSES = ['open', 'paused', 'closed'] as const

export default function AdminJobsPage() {
  const session = useAdminSession()
  const { push, toasts } = useToasts()
  // Authoring (create/edit/delete, pay, training content) is owner authority; staff can still
  // pause or reopen a card when operations require it. The API enforces the same split.
  const isOwner = session.role === 'owner'

  const [jobs, setJobs] = useState<AdminJobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [editing, setEditing] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<AdminJobRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminApi.jobs(filter === 'all' ? undefined : { status: filter })
      setJobs(data.jobs)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the catalogue.')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    if (session.status === 'authorized') void load()
  }, [session.status, load])

  const totals = useMemo(
    () => ({
      slots: jobs.reduce((sum, job) => sum + job.capacity, 0),
      filled: jobs.reduce((sum, job) => sum + (job.capacity - job.slotsRemaining), 0),
      openValue: jobs.filter((job) => job.status === 'open').reduce((sum, job) => sum + job.payAmountUsd * job.slotsRemaining, 0),
    }),
    [jobs],
  )

  const openEditor = (job?: AdminJobRow) => {
    if (!job) {
      setEditing({ ...EMPTY })
      return
    }
    setEditing({
      id: job.id,
      title: job.title,
      category: job.category,
      description: job.description,
      responsibilities: (job.responsibilities ?? []).join('\n'),
      payAmountUsd: job.payAmountUsd,
      estimatedMinutes: job.estimatedMinutes,
      capacity: job.capacity,
      slotsRemaining: job.slotsRemaining,
      trainingRequired: job.trainingRequired,
      trainingFeeUsd: job.trainingFeeUsd && job.trainingFeeUsd > 0 ? job.trainingFeeUsd : 10,
      trainingNotes: (job.trainingNotes ?? []).map((section) => ({
        title: section.title,
        content: section.content,
        image: section.image ?? '',
        imageAlt: section.imageAlt ?? '',
        imageCaption: section.imageCaption ?? '',
        durationMinutes: section.durationMinutes ? String(section.durationMinutes) : '',
        check: section.check
          ? {
              question: section.check.question,
              options: [
                section.check.options?.[0] ?? '',
                section.check.options?.[1] ?? '',
                section.check.options?.[2] ?? '',
                section.check.options?.[3] ?? '',
              ],
              correctIndex: section.check.correctIndex ?? 0,
              explanation: section.check.explanation ?? '',
            }
          : null,
      })),
      assessmentQuestions: (job.assessmentQuestions ?? []).map((question) => ({
        question: question.question,
        options: [question.options?.[0] ?? '', question.options?.[1] ?? '', question.options?.[2] ?? '', question.options?.[3] ?? ''] as [string, string, string, string],
        correctIndex: question.correctIndex ?? 0,
        image: question.image ?? '',
        imageAlt: question.imageAlt ?? '',
        explanation: question.explanation ?? '',
      })),
      requiresVerified: job.requiresVerified,
      status: job.status,
      closesAt: job.closesAt ? toLocalDate(job.closesAt) : '',
    })
  }

  const updateSection = (index: number, patch: Partial<DraftSection>) => {
    if (!editing) return
    setEditing({
      ...editing,
      trainingNotes: editing.trainingNotes.map((section, i) =>
        i === index ? { ...section, ...patch } : section,
      ),
    })
  }

  const updateCheck = (index: number, patch: Partial<DraftCheck>) => {
    if (!editing) return
    const section = editing.trainingNotes[index]
    if (!section?.check) return
    updateSection(index, { check: { ...section.check, ...patch } })
  }

  const save = async () => {
    if (!editing) return

    // ── Validate the learning content before it leaves the browser ──────────
    const fee = Number(editing.trainingFeeUsd)
    if (editing.trainingRequired && !(Number.isFinite(fee) && fee >= 0.0001 && fee <= 1000)) {
      push('error', 'Set a training fee between $0.0001 and $1,000 — amounts under $1 are fine, the KES charge is rounded — or switch the card to assessment-only.')
      return
    }
    const cleanedQuestions = editing.assessmentQuestions.map((question, index) => {
      const options = question.options.map((option) => option.trim())
      const chosen = options[question.correctIndex] ?? ''
      const filled = options.filter(Boolean)
      if (!question.question.trim() || filled.length < 2 || !chosen) {
        throw new Error(
          `Question ${index + 1} is incomplete — it needs text, at least two answer options, and the correct answer must be one of the filled options.`,
        )
      }
      return {
        question: question.question.trim(),
        options: filled,
        // The saved options are the non-empty ones, so re-point the correct answer at its new index.
        correctIndex: options.slice(0, question.correctIndex).filter(Boolean).length,
        ...(question.image.trim() ? { image: question.image.trim() } : {}),
        ...(question.image.trim() && question.imageAlt.trim() ? { imageAlt: question.imageAlt.trim() } : {}),
        ...(question.explanation.trim() ? { explanation: question.explanation.trim() } : {}),
      }
    })

    const cleanedNotes = editing.trainingNotes
      .filter((section) => section.title.trim() || section.content.trim())
      .map((section, index) => {
        const duration = Number(section.durationMinutes)
        if (
          section.durationMinutes.trim() &&
          (!Number.isFinite(duration) || duration < 1 || duration > 120)
        ) {
          throw new Error(`Section ${index + 1}: reading time must be between 1 and 120 minutes, or left blank to estimate.`)
        }
        let check: { question: string; options: string[]; correctIndex: number; explanation?: string } | undefined
        if (section.check) {
          const options = section.check.options.map((option) => option.trim())
          const chosen = options[section.check.correctIndex] ?? ''
          const filled = options.filter(Boolean)
          if (!section.check.question.trim() || filled.length < 2 || !chosen) {
            throw new Error(
              `Section ${index + 1}: the quick check needs a question, at least two answer options, and the correct answer must be one of the filled options.`,
            )
          }
          check = {
            question: section.check.question.trim(),
            options: filled,
            correctIndex: options.slice(0, section.check.correctIndex).filter(Boolean).length,
            ...(section.check.explanation.trim() ? { explanation: section.check.explanation.trim() } : {}),
          }
        }
        return {
          title: section.title.trim() || 'Untitled section',
          content: section.content.trim(),
          ...(section.image.trim() ? { image: section.image.trim() } : {}),
          ...(section.image.trim() && section.imageAlt.trim() ? { imageAlt: section.imageAlt.trim() } : {}),
          ...(section.image.trim() && section.imageCaption.trim() ? { imageCaption: section.imageCaption.trim() } : {}),
          ...(section.durationMinutes.trim() ? { durationMinutes: Math.round(duration) } : {}),
          ...(check ? { check } : {}),
        }
      })

    setSaving(true)
    try {
      const result = await adminApi.saveJob({
        id: editing.id,
        title: editing.title,
        category: editing.category,
        description: editing.description,
        responsibilities: editing.responsibilities.split('\n').map((line) => line.trim()).filter(Boolean),
        payAmountUsd: Number(editing.payAmountUsd),
        estimatedMinutes: Number(editing.estimatedMinutes),
        capacity: Number(editing.capacity),
        slotsRemaining: Number(editing.slotsRemaining),
        trainingRequired: editing.trainingRequired,
        trainingFeeUsd: editing.trainingRequired ? fee : 0,
        trainingNotes: cleanedNotes,
        assessmentQuestions: cleanedQuestions,
        requiresVerified: editing.requiresVerified,
        status: editing.status,
        closesAt: editing.closesAt ? new Date(editing.closesAt).toISOString() : undefined,
      })
      // Worker dashboards are fed by a live listener on `jobs`, so a save lands there within about a
      // second (a poll covers blocked sockets). Saying so turns "did my edit go through?" into a
      // non-question for whoever made the change.
      push(
        'success',
        editing.id
          ? `Saved ${result.id}. Open worker dashboards show this within a second.`
          : `Published as ${result.id}. Workers can see it immediately.`,
      )
      setEditing(null)
      await load()
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'The catalogue rejected this job.')
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (job: AdminJobRow, status: string) => {
    setBusy(true)
    try {
      await adminApi.setJobStatus({ jobId: job.id, status })
      push('success', `${job.title} is now ${status}.`)
      await load()
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Could not change that status.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {toasts}

      <AdminCard
        title="Job catalogue"
        description="What workers see on the board, and what QA can expect to receive."
        icon={<Briefcase className="size-4" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className={cn(inputClass, 'h-8 w-auto py-1 text-xs')} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {isOwner && (
              <Button size="sm" className="gap-1.5" onClick={() => openEditor()}>
                <Plus className="size-3.5" />
                New job
              </Button>
            )}
          </div>
        }
      >
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-border/70 bg-background/60 p-2.5">
            <p className="font-mono text-base font-semibold tabular">{jobs.length}</p>
            <p className="text-[11px] text-muted-foreground">in view</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/60 p-2.5">
            <p className="font-mono text-base font-semibold tabular">
              {totals.filled}/{totals.slots}
            </p>
            <p className="text-[11px] text-muted-foreground">slots taken</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/60 p-2.5">
            <p className="font-mono text-base font-semibold tabular text-success">{formatUsd(totals.openValue)}</p>
            <p className="text-[11px] text-muted-foreground">committed on open jobs</p>
          </div>
        </div>

        {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>}

        {loading && jobs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading catalogue…
          </div>
        ) : jobs.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">No jobs with that status. Publish one to put work on the board.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-border/80 bg-card p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{job.title}</p>
                    <StatusBadge tone={job.status === 'open' ? 'success' : job.status === 'paused' ? 'warning' : 'neutral'}>{job.status}</StatusBadge>
                    <StatusBadge tone="info">{job.category}</StatusBadge>
                    {job.trainingRequired ? (
                      <StatusBadge tone="warning">training · {formatUsd(job.trainingFeeUsd && job.trainingFeeUsd > 0 ? job.trainingFeeUsd : 10)}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">assessment only</StatusBadge>
                    )}
                    {job.requiresVerified && <StatusBadge tone="info">KYC required</StatusBadge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{job.description}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {formatUsd(job.payAmountUsd)} · {job.estimatedMinutes} min · {job.slotsRemaining}/{job.capacity} slots open · closes{' '}
                    {job.closesAt ? new Date(job.closesAt).toLocaleDateString() : '—'}
                    {(job.trainingNotes?.length ?? 0) > 0 && (() => {
                      const sections = job.trainingNotes!
                      const minutes = sections.reduce((sum, section) => sum + (section.durationMinutes ?? 0), 0)
                      const checks = sections.filter((section) => section.check).length
                      return ` · ${sections.length} section${sections.length === 1 ? '' : 's'}${minutes > 0 ? ` · ${minutes} min` : ''}${checks > 0 ? ` · ${checks} quick check${checks === 1 ? '' : 's'}` : ''}`
                    })()}
                    {(job.assessmentQuestions?.length ?? 0) > 0 && ` · ${job.assessmentQuestions!.length} custom question${job.assessmentQuestions!.length === 1 ? '' : 's'} · pass ${assessmentPassMark(job.assessmentQuestions!.length)}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {isOwner && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => openEditor(job)}>
                      <Settings2 className="size-3.5" />
                      Edit
                    </Button>
                  )}
                  {job.status === 'open' ? (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={() => void setStatus(job, 'paused')}>
                      <Pause className="size-3.5" />
                      Pause
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={() => void setStatus(job, 'open')}>
                      <Play className="size-3.5" />
                      Open
                    </Button>
                  )}
                  {isOwner && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={busy}
                      onClick={() => setConfirmDelete(job)}
                    >
                      <Trash2 className="size-3.5" />
                      Close
                    </Button>
                  )}
                  <Button render={<a href={`/training/${encodeURIComponent(job.id)}`} target="_blank" rel="noreferrer" />} size="sm" variant="ghost" className="h-8 gap-1.5 text-xs">
                    <Eye className="size-3.5" />
                    Preview
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      {/* Editor drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-foreground/40 backdrop-blur-sm" onMouseDown={() => setEditing(null)}>
          <aside className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-l border-border bg-background p-4 shadow-2xl sm:p-5" onMouseDown={(e) => e.stopPropagation()}>
            <header className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">{editing.id ? 'Edit job' : 'Publish a new job'}</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {editing.id ? `id ${editing.id}` : 'The id is generated from the title; workers see it in the URL.'}
                </p>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close editor" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>

            <div className="flex flex-col gap-3.5">
              <Field label="Title">
                <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={120} className={inputClass} />
              </Field>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Category">
                  <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className={inputClass}>
                    {JOB_CATEGORY_LIST.map((value: string) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className={inputClass}>
                    {STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Pay per job (USD)">
                  <input type="number" min="0.5" max="10000" step="0.5" value={editing.payAmountUsd} onChange={(e) => setEditing({ ...editing, payAmountUsd: Number(e.target.value) })} className={cn(inputClass, 'font-mono')} />
                </Field>
                <Field label="Estimated minutes">
                  <input type="number" min="5" max="10080" step="5" value={editing.estimatedMinutes} onChange={(e) => setEditing({ ...editing, estimatedMinutes: Number(e.target.value) })} className={cn(inputClass, 'font-mono')} />
                </Field>
                <Field label="Capacity" hint="Total slots. Approving an application reserves one; declining releases it.">
                  <input type="number" min="1" max="100000" value={editing.capacity} onChange={(e) => setEditing({ ...editing, capacity: Number(e.target.value) })} className={cn(inputClass, 'font-mono')} />
                </Field>
                <Field label="Slots remaining">
                  <input type="number" min="0" max={Math.max(1, editing.capacity)} value={editing.slotsRemaining} onChange={(e) => setEditing({ ...editing, slotsRemaining: Number(e.target.value) })} className={cn(inputClass, 'font-mono')} />
                </Field>
                <Field label="Closes at">
                  <input type="date" value={editing.closesAt} onChange={(e) => setEditing({ ...editing, closesAt: e.target.value })} className={cn(inputClass, 'font-mono')} />
                </Field>
                <div className="flex flex-col justify-end gap-2 pb-0.5">
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <input type="checkbox" checked={editing.requiresVerified} onChange={(e) => setEditing({ ...editing, requiresVerified: e.target.checked })} className="size-3.5 accent-[var(--primary)]" />
                    Verified identity required
                  </label>
                </div>
              </div>
              <Field label="Description" hint={`${editing.description.length}/4000`}>
                <textarea rows={5} value={editing.description} maxLength={4000} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={cn(inputClass, 'leading-relaxed')} />
              </Field>
              <Field label="Responsibilities" hint="One per line, max 12. Shown verbatim on the job page.">
                <textarea rows={4} value={editing.responsibilities} onChange={(e) => setEditing({ ...editing, responsibilities: e.target.value })} className={cn(inputClass, 'leading-relaxed')} />
              </Field>

              {/* ── Training & assessment authoring ── */}
              <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-3.5">
                <header>
                  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
                    <GraduationCap className="size-4 text-primary" />
                    Training &amp; assessment
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Decide how this card gates applicants, what training costs, and what they study and answer on the user side.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-medium text-muted-foreground">
                    <span className="rounded-full border border-border bg-background px-2 py-0.5">
                      Course · {editing.trainingNotes.length > 0 ? `${editing.trainingNotes.length} authored section${editing.trainingNotes.length === 1 ? '' : 's'}` : `built-in ${editing.category}`}
                    </span>
                    <span className="rounded-full border border-border bg-background px-2 py-0.5">
                      Assessment · {editing.assessmentQuestions.length > 0
                        ? `${editing.assessmentQuestions.length} question${editing.assessmentQuestions.length === 1 ? '' : 's'} · pass ${assessmentPassMark(editing.assessmentQuestions.length)}`
                        : 'built-in 15 · pass 10'}
                    </span>
                  </div>
                </header>

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setEditing({ ...editing, trainingRequired: true })}
                    className={cn(
                      'flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors',
                      editing.trainingRequired ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border bg-background hover:border-primary/40',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <GraduationCap className="size-3.5 text-primary" />
                      Paid training + assessment
                    </span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      Workers pay your fee first, then step through the training sections, then pass the assessment.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing({ ...editing, trainingRequired: false })}
                    className={cn(
                      'flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors',
                      !editing.trainingRequired ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border bg-background hover:border-primary/40',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <HelpCircle className="size-3.5 text-primary" />
                      Assessment only (free)
                    </span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      No payment. Workers see your preparation notes (if any) and must pass the assessment to apply.
                    </span>
                  </button>
                </div>

                {editing.trainingRequired && (
                  <Field
                    label="Training fee (USD)"
                    hint={`Charged once per worker for this card only — ≈ KES ${trainingFeeKesFor(editing.trainingFeeUsd).toLocaleString()} at the current rate.`}
                  >
                    <input
                      type="number"
                      min="0.0001"
                      max="1000"
                      step="0.0001"
                      value={editing.trainingFeeUsd}
                      onChange={(e) => setEditing({ ...editing, trainingFeeUsd: Number(e.target.value) })}
                      className={cn(inputClass, 'font-mono')}
                    />
                  </Field>
                )}

                {/* Training sections */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <StickyNote className="size-3.5 text-primary" />
                      Training notes / sections
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-[11px]"
                      onClick={() => setEditing({ ...editing, trainingNotes: [...editing.trainingNotes, { ...EMPTY_SECTION }] })}
                    >
                      <Plus className="size-3" />
                      Add section
                    </Button>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Workers open one section at a time and press “next” until the course is done. Each section can carry a reading time and an optional quick check that must be passed before the next lesson unlocks. Leave empty to use the built-in {editing.category} course. A few notes are added to that course as a job-specific briefing; five or more replace it.
                  </p>
                  {editing.trainingNotes.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] text-muted-foreground">
                      No sections yet — the built-in {editing.category} training will be shown.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {editing.trainingNotes.map((section, index) => (
                        <li key={index} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-semibold text-primary">
                              {index + 1}
                            </span>
                            <input
                              value={section.title}
                              onChange={(e) => {
                                const next = [...editing.trainingNotes]
                                next[index] = { ...section, title: e.target.value }
                                setEditing({ ...editing, trainingNotes: next })
                              }}
                              placeholder={`Section ${index + 1} title`}
                              maxLength={140}
                              className={cn(inputClass, 'h-8')}
                            />
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                aria-label="Move section up"
                                disabled={index === 0}
                                onClick={() => {
                                  const next = [...editing.trainingNotes]
                                  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                                  setEditing({ ...editing, trainingNotes: next })
                                }}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                              >
                                <ArrowUp className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Move section down"
                                disabled={index === editing.trainingNotes.length - 1}
                                onClick={() => {
                                  const next = [...editing.trainingNotes]
                                  ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                                  setEditing({ ...editing, trainingNotes: next })
                                }}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                              >
                                <ArrowDown className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete section"
                                onClick={() => setEditing({ ...editing, trainingNotes: editing.trainingNotes.filter((_, i) => i !== index) })}
                                className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>
                          <textarea
                            rows={4}
                            value={section.content}
                            maxLength={8000}
                            onChange={(e) => {
                              const next = [...editing.trainingNotes]
                              next[index] = { ...section, content: e.target.value }
                              setEditing({ ...editing, trainingNotes: next })
                            }}
                            placeholder="What the worker should learn in this section… Use blank lines for paragraphs, - for bullets, **bold** for emphasis."
                            className={cn(inputClass, 'leading-relaxed')}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                              Reading time
                              <input
                                type="number"
                                min={1}
                                max={120}
                                step={1}
                                value={section.durationMinutes}
                                onChange={(e) => updateSection(index, { durationMinutes: e.target.value })}
                                placeholder="auto"
                                className={cn(inputClass, 'h-8 w-20 font-mono text-[11px]')}
                                aria-label={`Section ${index + 1} reading time in minutes`}
                              />
                              min
                            </label>
                            <p className="text-[10px] leading-snug text-muted-foreground">
                              Leave blank to estimate from the lesson length. The course header adds these up.
                            </p>
                          </div>
                          <details className="rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                <ImageIcon className="size-3.5 text-primary" />
                                Figure, alt text and caption
                              </span>
                              <span className="font-mono text-[10px]">
                                {section.image ? 'added' : 'optional'}
                              </span>
                            </summary>
                            <div className="mt-2 grid gap-1.5">
                              <input
                                value={section.image}
                                onChange={(e) => {
                                  const next = [...editing.trainingNotes]
                                  next[index] = { ...section, image: e.target.value }
                                  setEditing({ ...editing, trainingNotes: next })
                                }}
                                placeholder="/training/transcription-quality.svg or https://…"
                                maxLength={500}
                                className={cn(inputClass, 'h-8 font-mono text-[11px]')}
                              />
                              <input
                                value={section.imageAlt}
                                onChange={(e) => {
                                  const next = [...editing.trainingNotes]
                                  next[index] = { ...section, imageAlt: e.target.value }
                                  setEditing({ ...editing, trainingNotes: next })
                                }}
                                placeholder="Alt text for screen readers — describe the figure"
                                maxLength={240}
                                className={cn(inputClass, 'h-8')}
                              />
                              <input
                                value={section.imageCaption}
                                onChange={(e) => {
                                  const next = [...editing.trainingNotes]
                                  next[index] = { ...section, imageCaption: e.target.value }
                                  setEditing({ ...editing, trainingNotes: next })
                                }}
                                placeholder="Caption shown below the figure"
                                maxLength={300}
                                className={cn(inputClass, 'h-8')}
                              />
                              <p className="text-[10px] leading-snug text-muted-foreground">
                                Same-origin paths and plain https URLs only. Figures are rendered inline; a bad URL is omitted rather than shown broken.
                              </p>
                            </div>
                          </details>

                          {/* End-of-lesson knowledge check */}
                          <div className="rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                                <HelpCircle className="size-3.5 text-primary" />
                                End-of-lesson quick check
                                <span className="font-mono text-[10px]">
                                  {section.check ? 'required to continue' : 'optional'}
                                </span>
                              </p>
                              {section.check ? (
                                <button
                                  type="button"
                                  onClick={() => updateSection(index, { check: null })}
                                  className="text-[11px] font-medium text-destructive hover:underline"
                                >
                                  Remove
                                </button>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-[11px]"
                                  onClick={() =>
                                    updateSection(index, {
                                      check: { ...EMPTY_CHECK, options: [...EMPTY_CHECK.options] },
                                    })
                                  }
                                >
                                  <Plus className="size-3" />
                                  Add check
                                </Button>
                              )}
                            </div>
                            {section.check ? (
                              <div className="mt-2 grid gap-1.5">
                                <input
                                  value={section.check.question}
                                  onChange={(e) => updateCheck(index, { question: e.target.value })}
                                  placeholder="One question that proves the lesson landed"
                                  maxLength={400}
                                  className={cn(inputClass, 'h-8')}
                                />
                                {section.check.options.map((option, optionIndex) => (
                                  <label key={optionIndex} className="flex items-center gap-2 text-xs text-foreground">
                                    <input
                                      type="radio"
                                      name={`section-check-${index}`}
                                      checked={section.check!.correctIndex === optionIndex}
                                      onChange={() => updateCheck(index, { correctIndex: optionIndex })}
                                      className="size-3.5 shrink-0 accent-[var(--primary)]"
                                      aria-label={`Mark option ${optionIndex + 1} correct`}
                                    />
                                    <input
                                      value={option}
                                      onChange={(e) =>
                                        updateCheck(index, {
                                          options: section.check!.options.map((value, i) =>
                                            i === optionIndex ? e.target.value : value,
                                          ) as [string, string, string, string],
                                        })
                                      }
                                      placeholder={`Option ${optionIndex + 1}${optionIndex >= 2 ? ' (optional)' : ''}`}
                                      maxLength={300}
                                      className={cn(inputClass, 'h-8')}
                                    />
                                  </label>
                                ))}
                                <p className="text-[10px] text-muted-foreground">
                                  At least two options are required. Workers answer this before the next lesson unlocks.
                                </p>
                                <textarea
                                  rows={2}
                                  value={section.check.explanation}
                                  onChange={(e) => updateCheck(index, { explanation: e.target.value })}
                                  placeholder="Optional feedback shown after the worker answers."
                                  maxLength={500}
                                  className={cn(inputClass, 'leading-relaxed')}
                                />
                              </div>
                            ) : (
                              <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                                Optional. Add one question to gate the next lesson; leave it off for a reading-only section.
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Assessment questions */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <HelpCircle className="size-3.5 text-primary" />
                      Assessment questions
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-[11px]"
                      onClick={() => setEditing({ ...editing, assessmentQuestions: [...editing.assessmentQuestions, { ...EMPTY_QUESTION }] })}
                    >
                      <Plus className="size-3" />
                      Add question
                    </Button>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Shown in the assessment on the user side — workers need two-thirds correct. Leave empty to use the built-in {editing.category} question bank.{' '}
                    {editing.assessmentQuestions.length > 0 && (
                      <span className="font-medium text-foreground">
                        Pass mark: {assessmentPassMark(editing.assessmentQuestions.length)} of {editing.assessmentQuestions.length}.
                      </span>
                    )}
                  </p>
                  {editing.assessmentQuestions.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] text-muted-foreground">
                      No custom questions — the built-in {editing.category} bank (15 questions, pass 10) will be used.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {editing.assessmentQuestions.map((question, qIndex) => (
                        <li key={qIndex} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-semibold text-primary">
                              Q{qIndex + 1}
                            </span>
                            <input
                              value={question.question}
                              onChange={(e) => {
                                const next = [...editing.assessmentQuestions]
                                next[qIndex] = { ...question, question: e.target.value }
                                setEditing({ ...editing, assessmentQuestions: next })
                              }}
                              placeholder="Question text"
                              maxLength={500}
                              className={inputClass}
                            />
                            <button
                              type="button"
                              aria-label="Delete question"
                              onClick={() => setEditing({ ...editing, assessmentQuestions: editing.assessmentQuestions.filter((_, i) => i !== qIndex) })}
                              className="shrink-0 rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                          <div className="grid gap-1.5 pl-6.5">
                            {question.options.map((option, oIndex) => (
                              <label key={oIndex} className="flex items-center gap-2 text-xs text-foreground">
                                <input
                                  type="radio"
                                  name={`correct-${qIndex}`}
                                  checked={question.correctIndex === oIndex}
                                  onChange={() => {
                                    const next = [...editing.assessmentQuestions]
                                    next[qIndex] = { ...question, correctIndex: oIndex }
                                    setEditing({ ...editing, assessmentQuestions: next })
                                  }}
                                  className="size-3.5 shrink-0 accent-[var(--primary)]"
                                  aria-label={`Mark option ${oIndex + 1} correct`}
                                />
                                <input
                                  value={option}
                                  onChange={(e) => {
                                    const next = [...editing.assessmentQuestions]
                                    const options = [...question.options] as [string, string, string, string]
                                    options[oIndex] = e.target.value
                                    next[qIndex] = { ...question, options }
                                    setEditing({ ...editing, assessmentQuestions: next })
                                  }}
                                  placeholder={`Option ${oIndex + 1}${oIndex >= 2 ? ' (optional)' : ''}`}
                                  maxLength={400}
                                  className={cn(inputClass, 'h-8')}
                                />
                              </label>
                            ))}
                            <p className="text-[10px] text-muted-foreground">Select the radio next to the correct answer. At least two options are required.</p>
                          </div>
                          <details className="ml-6.5 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                <ImageIcon className="size-3.5 text-primary" />
                                Figure and answer explanation
                              </span>
                              <span className="font-mono text-[10px]">
                                {question.image || question.explanation ? 'added' : 'optional'}
                              </span>
                            </summary>
                            <div className="mt-2 grid gap-1.5">
                              <input
                                value={question.image}
                                onChange={(e) => {
                                  const next = [...editing.assessmentQuestions]
                                  next[qIndex] = { ...question, image: e.target.value }
                                  setEditing({ ...editing, assessmentQuestions: next })
                                }}
                                placeholder="/training/labeling-boxes.svg or https://…"
                                maxLength={500}
                                className={cn(inputClass, 'h-8 font-mono text-[11px]')}
                              />
                              <input
                                value={question.imageAlt}
                                onChange={(e) => {
                                  const next = [...editing.assessmentQuestions]
                                  next[qIndex] = { ...question, imageAlt: e.target.value }
                                  setEditing({ ...editing, assessmentQuestions: next })
                                }}
                                placeholder="Alt text for the question figure"
                                maxLength={240}
                                className={cn(inputClass, 'h-8')}
                              />
                              <textarea
                                rows={2}
                                value={question.explanation}
                                onChange={(e) => {
                                  const next = [...editing.assessmentQuestions]
                                  next[qIndex] = { ...question, explanation: e.target.value }
                                  setEditing({ ...editing, assessmentQuestions: next })
                                }}
                                placeholder="Shown after the worker submits — explain why the correct answer is right."
                                maxLength={600}
                                className={cn(inputClass, 'leading-relaxed')}
                              />
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <footer className="mt-auto flex items-center gap-2 border-t border-border pt-3">
              <p className="flex-1 text-[11px] leading-snug text-muted-foreground">Saving publishes immediately to the board and writes an audit entry against your account.</p>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" className="gap-1.5" disabled={saving || editing.title.trim().length < 4} onClick={() => void save()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                {editing.id ? 'Save changes' : 'Publish job'}
              </Button>
            </footer>
          </aside>
        </div>
      )}

      <ReasonDialog
        open={!!confirmDelete}
        title={`Close “${confirmDelete?.title ?? ''}”`}
        description="Closing hides the job from the board and stops new applications. Existing applications and payouts are untouched — that is what Pause is for if you only need a break."
        confirmLabel="Close job"
        tone="destructive"
        busy={busy}
        requireReason
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async (reason) => {
          if (!confirmDelete) return
          setBusy(true)
          try {
            await adminApi.setJobStatus({ jobId: confirmDelete.id, status: 'closed' })
            await adminApi.operatorAction({ action: 'note', target: `job:${confirmDelete.id}`, reason })
            push('success', `${confirmDelete.title} closed.`)
            setConfirmDelete(null)
            await load()
          } catch (err) {
            push('error', err instanceof Error ? err.message : 'Could not close that job.')
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

function toLocalDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}
