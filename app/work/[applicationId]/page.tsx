'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { use } from 'react'
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  CircleDashed,
  ExternalLink,
  Loader2,
  PenLine,
  Play,
  Plus,
  Send,
  AlertTriangle,
  X,
} from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { APPLICATION_LABELS, APPLICATION_TONE, formatDuration, formatUsd } from '@/lib/afterworks-data'

type LinkRow = { label: string; url: string }

function fmt(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** The work form: deliverable note + up to three links (Drive, Sheet, file host…). */
function WorkForm({
  note,
  links,
  busy,
  onSubmit,
  cta,
}: {
  note: string
  links: LinkRow[]
  busy: boolean
  cta: string
  onSubmit: (note: string, links: LinkRow[]) => Promise<void>
}) {
  const [text, setText] = useState(note)
  const [rows, setRows] = useState<LinkRow[]>(links.length ? links : [{ label: '', url: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const clean = rows.filter((r) => r.url.trim())
      await onSubmit(text, clean)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your deliverable
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          rows={5}
          placeholder="Describe what you did, where the file lives, or paste the result directly (transcribed text, labels, corrections…)."
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary"
        />
        <span className="text-right font-mono text-[11px] text-muted-foreground">{text.length}/2000</span>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Deliverable links <span className="normal-case text-muted-foreground/70">(optional, up to 3)</span>
        </span>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={row.label}
              onChange={(e) =>
                setRows((prev) => prev.map((r, j) => (j === i ? { ...r, label: e.target.value.slice(0, 60) } : r)))
              }
              placeholder="Label (e.g. Transcription doc)"
              className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary sm:w-48"
            />
            <input
              value={row.url}
              onChange={(e) =>
                setRows((prev) => prev.map((r, j) => (j === i ? { ...r, url: e.target.value.slice(0, 500) } : r)))
              }
              placeholder="https://…"
              inputMode="url"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Remove link"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        {rows.length < 3 && (
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { label: '', url: '' }])}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-secondary"
          >
            <Plus className="size-3.5" /> Add a link
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="size-3.5" /> {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSubmit} disabled={submitting || busy} size="lg">
          {submitting || busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {cta}
        </Button>
        <p className="text-xs text-muted-foreground">
          QA usually responds within 48 hours. You can withdraw until you submit.
        </p>
      </div>
    </div>
  )
}

export default function WorkPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = use(params)
  const { applications, profileLoaded, getJob, ensureJob, startWork, submitWork, pending, walletMeta } = useAfterWorks()

  const app = useMemo(() => applications.find((a) => a.id === applicationId), [applications, applicationId])
  const job = app ? getJob(app.jobId) : undefined

  // Deep link: the card may be outside the bounded catalogue read, so pull it directly once.
  const jobChecked = useRef(false)
  const [jobKnown, setJobKnown] = useState(false)
  useEffect(() => {
    if (!app) return
    if (job) {
      setJobKnown(true)
      return
    }
    if (jobChecked.current) return
    jobChecked.current = true
    void ensureJob(app.jobId).then((fetched) => setJobKnown(Boolean(fetched)))
  }, [app, job, ensureJob])

  const busy = app ? Boolean(pending[`app:${app.id}`]) : false
  const paymentEntry = app ? walletMeta.entries.find((e) => e.applicationId === app.id && e.kind === 'earning') : undefined

  if (!app) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-sm text-muted-foreground">
          {profileLoaded ? 'This assignment does not exist or is no longer active.' : 'Loading your assignment…'}
        </p>
        <Button render={<Link href="/work" />} variant="outline">
          <ArrowLeft className="size-4" /> Back to My work
        </Button>
      </div>
    )
  }

  const title = job?.title || app.jobTitle || 'Assigned work'
  const pay = job?.payAmountUsd ?? app.payAmountUsd ?? 0
  const history = [...app.history].sort((a, b) => a.at.localeCompare(b.at)).slice(-10)

  async function handleStart() {
    await startWork(app!.id)
  }

  async function handleSubmit(note: string, links: LinkRow[]) {
    const result = await submitWork(app!.id, note, links)
    if (!result.ok) throw new Error(result.reason)
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/work"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to My work
      </Link>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={APPLICATION_TONE[app.status]}>{APPLICATION_LABELS[app.status]}</StatusBadge>
            {job && <StatusBadge tone="neutral">{job.category}</StatusBadge>}
          </div>
          <h1 className="mt-2 text-pretty text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assigned {app.appliedAt ? new Date(app.appliedAt).toLocaleDateString() : ''} · Est.{' '}
            {job ? formatDuration(job.estimatedMinutes) : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Payment on approval</p>
          <p className="font-mono text-2xl font-semibold">{formatUsd(pay)}</p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Task briefing */}
          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <PenLine className="size-4 text-primary" /> Task briefing
            </h2>
            {job ? (
              <>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{job.description}</p>
                <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What you&apos;ll do
                </h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {job.responsibilities.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                      {r}
                    </li>
                  ))}
                </ul>
              </>
            ) : jobKnown ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Task details are no longer available for this assignment.
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading task details…
              </p>
            )}
          </section>

          {/* State-specific panel */}
          {app.status === 'approved' && (
            <section className="rounded-2xl border border-primary/30 bg-primary/[0.04] p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Play className="size-4 text-primary" /> Ready to start
              </h2>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                Your application was approved and your slot is reserved. Read the briefing above, do
                the work, then submit it here when it is ready.
              </p>
              <div className="mt-4">
                <Button size="lg" onClick={handleStart} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  Start work
                </Button>
              </div>
            </section>
          )}

          {(app.status === 'in_progress' || app.status === 'revision_requested') && (
            <section
              className={`rounded-2xl border p-5 sm:p-6 ${
                app.status === 'revision_requested' ? 'border-warning/40 bg-warning/[0.06]' : 'border-border bg-card'
              }`}
            >
              {app.status === 'revision_requested' && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-background/60 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium">Revision requested</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {app.revisionNote || 'The reviewer asked for changes before accepting the work.'}
                    </p>
                  </div>
                </div>
              )}
              <WorkForm
                note={app.workerNote ?? ''}
                links={app.workLinks ?? []}
                busy={busy}
                cta={app.status === 'revision_requested' ? 'Resubmit work' : 'Submit work'}
                onSubmit={handleSubmit}
              />
            </section>
          )}

          {app.status === 'submitted_for_review' && (
            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4 text-warning" /> Submitted — waiting for QA
              </h2>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                Your work is in the review queue{app.workSubmittedAt ? ` since ${fmt(app.workSubmittedAt)}` : ''}. QA
                usually responds within 48 hours — you do not need to do anything while it is
                reviewed.
              </p>
              {(app.workerNote || (app.workLinks && app.workLinks.length > 0)) && (
                <div className="mt-4 rounded-lg border border-border bg-background/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your submission</p>
                  {app.workerNote && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{app.workerNote}</p>}
                  {app.workLinks && app.workLinks.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {app.workLinks.map((l) =>
                        /^https?:\/\//i.test(l.url) ? (
                          <li key={l.url}>
                            <a
                              href={l.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                            >
                              <ExternalLink className="size-3.5" /> {l.label || l.url}
                            </a>
                          </li>
                        ) : (
                          <li key={l.url} className="text-sm text-muted-foreground">
                            {l.label || l.url}
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </div>
              )}
              <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                <Banknote className="mt-0.5 size-4 shrink-0 text-success" />
                If the work is approved, {formatUsd(pay)} is issued to your pending balance and clears
                into your available balance after the clearing window.
              </p>
            </section>
          )}

          {app.status === 'completed' && (
            <section className="rounded-2xl border border-success/30 bg-success/[0.06] p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="size-4 text-success" /> Completed — you have been paid
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {formatUsd(pay)} was issued for this work
                {paymentEntry?.status === 'pending'
                  ? ` and is currently in the clearing window${paymentEntry.clearedAt ? ` — it clears on ${fmt(paymentEntry.clearedAt)}` : ''}.`
                  : paymentEntry?.status === 'cleared'
                    ? ' and has cleared into your available balance.'
                    : '.'}
              </p>
              {paymentEntry && (
                <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs font-medium">
                  <StatusBadge tone={paymentEntry.status === 'cleared' ? 'success' : 'warning'}>
                    {paymentEntry.status === 'cleared' ? 'In available balance' : 'Pending · clearing'}
                  </StatusBadge>
                  <span className="font-mono">{formatUsd(paymentEntry.amountUsd)}</span>
                </p>
              )}
            </section>
          )}

          {(app.status === 'rejected' || app.status === 'failed_qa') && (
            <section className="rounded-2xl border border-destructive/30 bg-destructive/[0.05] p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4 text-destructive" />
                {APPLICATION_LABELS[app.status]}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {app.rejectionReason ||
                  (app.status === 'failed_qa'
                    ? 'The submission did not meet the quality bar, so no payment was issued.'
                    : 'This application was not approved.')}
              </p>
            </section>
          )}
        </div>

        {/* Timeline column */}
        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Progress</h2>
            <ol className="mt-4 flex flex-col">
              {history.map((step, i) => {
                const isLast = i === history.length - 1
                const label =
                  step.status === 'in_progress' && step.by?.includes('auto-started')
                    ? 'Work started (on submission)'
                    : APPLICATION_LABELS[step.status as keyof typeof APPLICATION_LABELS] ?? step.status
                return (
                  <li key={`${step.status}-${step.at}`} className="relative flex gap-3 pb-5 last:pb-0">
                    {i < history.length - 1 && (
                      <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden />
                    )}
                    <span className="relative z-10 mt-0.5 flex size-4 shrink-0 items-center justify-center">
                      {isLast ? (
                        <CircleDashed className="size-4 animate-spin text-primary" />
                      ) : (
                        <CheckCircle2 className="size-4 text-success" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-sm ${isLast ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                        {label}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {fmt(step.at)}
                        {step.by ? ` · ${step.by}` : ''}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 text-xs leading-relaxed text-muted-foreground">
            <h2 className="text-xs font-semibold uppercase tracking-wide">How payment works</h2>
            <p className="mt-2">
              1. Submit your work here. 2. QA reviews it (usually 48h). 3. On approval,{' '}
              {formatUsd(pay)} lands in your pending balance. 4. After the clearing window it moves
              to your available balance, from where you can withdraw to mobile money.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
