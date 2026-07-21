'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  GraduationCap,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  APPLICATION_LABELS,
  APPLICATION_TONE,
  formatDuration,
  formatKes,
  formatUsd,
  Application,
} from '../../../lib/afterworks-data'

export default function JobDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params
  const router = useRouter()
  const { getJob, getApplicationForJob, applyToJob, worker } = useAfterWorks()
  const [error, setError] = useState<string | null>(null)

  const job = getJob(id)
  const application = getApplicationForJob(id) as Application | null

  if (!job) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-sm text-muted-foreground">This job could not be found.</p>
        <Button render={<Link href="/jobs" />} variant="outline">
          Back to jobs
        </Button>
      </div>
    )
  }

  const isClosed = job.status !== 'open' || job.slotsRemaining <= 0
  const filled = job.capacity - job.slotsRemaining
  const fillPct = Math.round((filled / job.capacity) * 100)

  function handleApply() {
    setError(null)
    if (!worker.kycVerified) {
      setError('Identity verification (KYC) is required before applying for jobs.')
      return
    }
    if (job!.trainingRequired) {
      router.push(`/training/${job!.id}`)
      return
    }
    const result = applyToJob(job!.id)
    if (!result.ok) {
      setError(result.reason)
      return
    }
    router.push('/applications')
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/jobs"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to jobs
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="neutral">{job.category}</StatusBadge>
              {isClosed ? (
                <StatusBadge tone="danger">Slots full</StatusBadge>
              ) : job.slotsRemaining <= 3 ? (
                <StatusBadge tone="warning">{job.slotsRemaining} slots left</StatusBadge>
              ) : (
                <StatusBadge tone="success">{job.slotsRemaining} slots open</StatusBadge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                Posted {job.postedAgo}
              </span>
            </div>

            <h1 className="mt-4 text-pretty text-2xl font-semibold leading-tight">
              {job.title}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {job.description}
            </p>

            <h2 className="mt-6 text-sm font-semibold">What you&apos;ll do</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {job.responsibilities.map((r: string) => (
                <li key={r} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  {r}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-sm font-semibold">Requirements</h2>
            <ul className="mt-3 flex flex-col gap-3 text-sm">
              <li className="flex items-center gap-2.5 text-muted-foreground">
                {worker.kycVerified ? (
                  <>
                    <ShieldCheck className="size-4 shrink-0 text-success" />
                    <span>Verified account (KYC) — <strong className="text-success font-medium">Verified</strong></span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="size-4 shrink-0 text-warning" />
                    <span>Identity verification (KYC) — <strong className="text-warning font-medium">Action required</strong></span>
                  </>
                )}
              </li>
              {job.trainingRequired ? (
                <li className="flex items-center gap-2.5 text-muted-foreground">
                  <GraduationCap className="size-4 shrink-0 text-primary" />
                  Category training required — one-time $10 for content access
                </li>
              ) : (
                <li className="flex items-center gap-2.5 text-muted-foreground">
                  <GraduationCap className="size-4 shrink-0 text-muted-foreground" />
                  No training required for this job
                </li>
              )}
            </ul>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:h-fit">
          <div className="rounded-2xl border border-border bg-card p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Payment on completion
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold">
              {formatUsd(job.payAmountUsd)}
            </p>
            <p className="text-sm text-muted-foreground">≈ {formatKes(job.payAmountUsd)}</p>

            <dl className="mt-5 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4" /> Estimated time
                </dt>
                <dd className="font-medium">{formatDuration(job.estimatedMinutes)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Users className="size-4" /> Slots filled
                </dt>
                <dd className="font-medium">
                  {filled} / {job.capacity}
                </dd>
              </div>
            </dl>

            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </div>

            {job.trainingRequired && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-accent p-3 text-xs text-accent-foreground">
                <GraduationCap className="mt-0.5 size-4 shrink-0" />
                <span>
                  This job needs training. Applying takes you to the $10 training first —
                  paid from your wallet if you have a balance.
                </span>
              </div>
            )}

            <div className="mt-5">
              {application ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <span className="text-xs text-muted-foreground">
                    Your application status
                  </span>
                  <StatusBadge tone={APPLICATION_TONE[application.status]}>
                    {APPLICATION_LABELS[application.status]}
                  </StatusBadge>
                  <Button
                    render={<Link href="/applications" />}
                    variant="outline"
                    className="mt-1 w-full"
                  >
                    Track application
                  </Button>
                </div>
              ) : !worker.kycVerified ? (
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={handleApply}
                    disabled={isClosed}
                    size="lg"
                    className="w-full"
                  >
                    {isClosed ? 'Slots full' : 'Apply now — free'}
                  </Button>
                  <Button
                    render={<Link href="/profile" />}
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 border-warning/40 text-warning hover:bg-warning/10"
                  >
                    <ShieldAlert className="size-4" />
                    Verify KYC in Profile
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={handleApply}
                  disabled={isClosed}
                  size="lg"
                  className="w-full"
                >
                  {isClosed
                    ? 'Slots full'
                    : job.trainingRequired
                      ? 'Start training to apply'
                      : 'Apply now — free'}
                </Button>
              )}

              {error && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="size-3.5" />
                  {error}
                </p>
              )}

              {!application && !isClosed && (
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  No fee to apply. Your saved profile & CV are attached automatically.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
