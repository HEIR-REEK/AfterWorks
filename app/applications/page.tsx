'use client'

import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  Upload,
} from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  APPLICATION_LABELS,
  APPLICATION_TONE,
  formatUsd,
  type Application,
  type ApplicationStatus,
} from '@/lib/afterworks-data'

// Ordered pipeline of the "happy path" for the visual tracker.
const PIPELINE: ApplicationStatus[] = [
  'under_review',
  'approved',
  'in_progress',
  'submitted_for_review',
  'completed',
]

function pipelineIndex(status: ApplicationStatus): number {
  // Map terminal/branch states onto the closest pipeline step.
  if (status === 'rejected') return 0
  if (status === 'revision_requested') return 2
  if (status === 'failed_qa') return 3
  return PIPELINE.indexOf(status)
}

function reviewCountdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expiring soon'
  const hrs = Math.round(ms / (1000 * 60 * 60))
  return `auto-expires in ~${hrs}h`
}

function ApplicationRow({ app }: { app: Application }) {
  const { getJob, submitWork, advanceApplication } = useAfterWorks()
  const job = getJob(app.jobId)
  if (!job) return null

  const activeIndex = pipelineIndex(app.status)
  const canSimulate = ['under_review', 'approved', 'submitted_for_review'].includes(
    app.status,
  )

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/jobs/${job.id}`}
            className="text-pretty text-base font-semibold leading-snug hover:text-primary"
          >
            {job.title}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">
            {job.category} · <span className="font-mono">{formatUsd(job.payAmountUsd)}</span>
          </p>
        </div>
        <StatusBadge tone={APPLICATION_TONE[app.status]}>
          {APPLICATION_LABELS[app.status]}
        </StatusBadge>
      </div>

      {/* Pipeline */}
      <ol className="mt-5 flex items-center">
        {PIPELINE.map((step, i) => {
          const done = i < activeIndex
          const current = i === activeIndex
          return (
            <li key={step} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                {done ? (
                  <CheckCircle2 className="size-5 text-success" />
                ) : current ? (
                  <Circle className="size-5 fill-primary/15 text-primary" />
                ) : (
                  <Circle className="size-5 text-muted-foreground/40" />
                )}
                <span
                  className={`hidden text-center text-[11px] leading-tight sm:block ${
                    current
                      ? 'font-medium text-foreground'
                      : done
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/50'
                  }`}
                >
                  {APPLICATION_LABELS[step]}
                </span>
              </div>
              {i < PIPELINE.length - 1 && (
                <div
                  className={`mx-1 h-0.5 flex-1 rounded-full ${
                    i < activeIndex ? 'bg-success' : 'bg-border'
                  }`}
                />
              )}
            </li>
          )
        })}
      </ol>

      {/* Contextual footer per state */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {app.status === 'under_review' && (
            <>
              <Clock className="size-3.5" />
              Reviewing your application — {reviewCountdown(app.reviewExpiresAt)}
            </>
          )}
          {app.status === 'approved' && 'Slot reserved. Start the work when ready.'}
          {app.status === 'in_progress' && 'Submit your completed work for QA review.'}
          {app.status === 'submitted_for_review' && 'In QA review. Payment queues on approval.'}
          {app.status === 'revision_requested' &&
            (app.revisionNote ?? 'Reviewer requested a revision. Resubmit within 24–48h.')}
          {app.status === 'completed' && (
            <>
              <CheckCircle2 className="size-3.5 text-success" />
              Paid to your pending balance — clears in 48–72h.
            </>
          )}
          {app.status === 'rejected' && (app.rejectionReason ?? 'Application not approved.')}
          {app.status === 'failed_qa' && 'Work did not pass QA. No payment issued.'}
        </p>

        <div className="flex items-center gap-2">
          {(app.status === 'in_progress' || app.status === 'revision_requested') && (
            <Button size="sm" onClick={() => submitWork(app.id)}>
              <Upload className="size-3.5" />
              Submit work
            </Button>
          )}
          {canSimulate && (
            <Button size="sm" variant="outline" onClick={() => advanceApplication(app.id)}>
              {app.status === 'under_review' && 'Simulate approval'}
              {app.status === 'approved' && 'Start work'}
              {app.status === 'submitted_for_review' && 'Simulate QA pass'}
              <ArrowRight className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ApplicationsPage() {
  const { applications } = useAfterWorks()

  const active = applications.filter(
    (a) => !['completed', 'rejected', 'failed_qa'].includes(a.status),
  )
  const past = applications.filter((a) =>
    ['completed', 'rejected', 'failed_qa'].includes(a.status),
  )

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My applications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track every application from review through QA to payment. Use the simulate
          buttons to preview the lifecycle.
        </p>
      </header>

      {applications.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            You haven&apos;t applied to any jobs yet.
          </p>
          <Button render={<Link href="/jobs" />}>Browse jobs</Button>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold text-muted-foreground">Active</h2>
              {active.map((app) => (
                <ApplicationRow key={app.id} app={app} />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold text-muted-foreground">History</h2>
              {past.map((app) => (
                <ApplicationRow key={app.id} app={app} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
