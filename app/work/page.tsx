'use client'

import Link from 'next/link'
import { ArrowRight, Clock, Loader2, PenLine } from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { APPLICATION_LABELS, APPLICATION_TONE, formatUsd } from '@/lib/afterworks-data'

/**
 * My Work — every assignment that has left the review queue: approved, in progress, awaiting
 * resubmission, or submitted and waiting on QA. Each row opens the workspace where the actual
 * work happens and is submitted.
 */
export default function WorkIndexPage() {
  const { applications, profileLoaded, getJob } = useAfterWorks()

  const workApps = applications.filter((a) =>
    ['approved', 'in_progress', 'revision_requested', 'submitted_for_review'].includes(a.status),
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PenLine className="size-4.5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My work</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Do your assigned tasks, submit them, and track payment here.
          </p>
        </div>
      </header>

      {!profileLoaded && applications.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-12 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" /> Loading your assignments…
        </div>
      ) : workApps.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            You have no assignments in the work queue right now. Once an application is approved,
            it appears here with your task details and a button to start.
          </p>
          <Button render={<Link href="/jobs" />}>
            Browse jobs
            <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {workApps.map((app) => {
            const job = getJob(app.jobId)
            const title = job?.title || app.jobTitle || 'Assigned work'
            const pay = job?.payAmountUsd ?? app.payAmountUsd ?? 0
            const waiting = app.status === 'submitted_for_review'
            return (
              <Link
                key={app.id}
                href={`/work/${app.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground sm:text-base">{title}</p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{formatUsd(pay)}</span>
                    {waiting && app.workSubmittedAt ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" /> Submitted {new Date(app.workSubmittedAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={APPLICATION_TONE[app.status]}>
                    {APPLICATION_LABELS[app.status]}
                  </StatusBadge>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
