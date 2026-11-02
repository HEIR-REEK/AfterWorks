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
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAfterWorks, useJobDetail } from '@/components/afterworks-provider'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  APPLICATION_LABELS,
  APPLICATION_TONE,
  formatDuration,
  formatUsd,
  trainingFeeUsdFor,
  Application,
} from '../../../lib/afterworks-data'

import { use } from 'react'

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { getApplicationForJob, isJobPaid, worker } = useAfterWorks()
  const [error, setError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  // Reads the card from the live catalogue, and re-reads the document when the tab regains focus
  // so a price, slot count or status changed in the console is what this page shows.
  const { job, checking } = useJobDetail(id)
  const application = getApplicationForJob(id) as Application | null
  const isPaid = job ? isJobPaid(job.id) : false

  if (!job) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        {checking ? (
          <>
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading this job card…</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">This job could not be found.</p>
            <Button render={<Link href="/jobs" />} variant="outline">
              Back to jobs
            </Button>
          </>
        )}
      </div>
    )
  }

  const isClosed = job.status !== 'open' || job.slotsRemaining <= 0
  const filled = job.capacity - job.slotsRemaining
  const fillPct = Math.round((filled / job.capacity) * 100)
  const trainingFee = formatUsd(trainingFeeUsdFor(job.trainingFeeUsd))
  const trainingRequired = job.trainingRequired

  async function handleApply() {
    setError(null)
    // A training fee may be paid before identity verification — that is the whole point of the
    // checkout on the training page. What verification gates is access to the training material
    // and the assessment, plus the application itself (which the server also enforces).
    if (!worker.kycVerified && (!trainingRequired || isPaid)) {
      setError(
        trainingRequired
          ? 'Your payment is confirmed. Verify your identity in Profile to unlock the training and assessment.'
          : 'Identity verification (KYC) is required before taking the assessment.',
      )
      return
    }
    
    setIsApplying(true)
    router.push(`/training/${job!.id}`)
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
            <h2 className="text-sm font-semibold">Requirements & Flow</h2>
            <ul className="mt-3 flex flex-col gap-3 text-sm">
              <li className="flex items-start gap-2.5 text-muted-foreground">
                {worker.kycVerified ? (
                  <>
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                    <div>
                      <span>Identity Verification (KYC) — <strong className="text-success font-medium">Verified</strong></span>
                    </div>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    <div>
                      <span>Identity Verification (KYC) — <strong className="text-warning font-medium">Action required</strong></span>
                      {job.trainingRequired ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          You can pay this job card’s training fee first. The training material and assessment unlock after this check is approved.
                        </p>
                      ) : null}
                    </div>
                  </>
                )}
              </li>
              {job.trainingRequired ? (
                <li className="flex items-start gap-2.5 text-muted-foreground">
                  <GraduationCap className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <span>Step 1: Pay {trainingFee} → Step 2: Verify Identity → Step 3: Training → Step 4: Assessment → Apply for Job Card</span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isPaid && worker.kycVerified ? (
                        <strong className="text-success font-medium">✓ Payment confirmed. Training &amp; assessment unlocked for this job card!</strong>
                      ) : isPaid ? (
                        <strong className="text-warning font-medium">Payment confirmed. Verify your identity in Profile to unlock training &amp; assessment.</strong>
                      ) : (
                        <span>Each job card requires its own separate {trainingFee} payment. You can pay before identity verification; training &amp; assessment open only after the check is approved for this job card.</span>
                      )}
                    </p>
                  </div>
                </li>
              ) : (
                <li className="flex items-center gap-2.5 text-muted-foreground">
                  <GraduationCap className="size-4 shrink-0 text-muted-foreground" />
                  No training fee required for this job card category
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
              <div className={`mt-4 flex items-start gap-2 rounded-lg p-3 text-xs ${
                isPaid ? 'bg-success/15 text-success border border-success/30' : 'bg-accent text-accent-foreground'
              }`}>
                <GraduationCap className="mt-0.5 size-4 shrink-0" />
                <span>
                  {isPaid && worker.kycVerified
                    ? 'Payment detected! Training modules & assessment are unlocked.'
                    : isPaid
                      ? 'Payment confirmed. Verify your identity in Profile to unlock training and assessment.'
                      : `This job card requires a ${trainingFee} training payment. You can pay before identity verification; training and assessment open once the check is approved.`}
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
                job.trainingRequired && !isPaid ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={handleApply}
                      disabled={isClosed || isApplying}
                      size="lg"
                      className="w-full gap-2"
                    >
                      {isApplying && <Loader2 className="size-4 animate-spin" />}
                      {isApplying ? 'Redirecting...' : isClosed ? 'Slots full' : `Pay ${trainingFee} to Start Training`}
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
                    <p className="text-center text-xs text-muted-foreground">
                      You can pay the training fee first. Training and the assessment unlock after verification.
                    </p>
                  </div>
                ) : (
                  <Button
                    render={<Link href="/profile" />}
                    size="lg"
                    className="w-full gap-2"
                  >
                    <ShieldAlert className="size-4" />
                    {job.trainingRequired ? 'Verify KYC to Start Training' : 'Verify KYC to Take the Assessment'}
                  </Button>
                )
              ) : (
                <Button
                  onClick={handleApply}
                  disabled={isClosed || isApplying}
                  size="lg"
                  className="w-full gap-2"
                >
                  {isApplying && <Loader2 className="size-4 animate-spin" />}
                  {isApplying
                    ? 'Redirecting...'
                    : isClosed
                      ? 'Slots full'
                      : job.trainingRequired
                        ? isPaid
                          ? 'Continue Training & Assessment'
                          : `Pay ${trainingFee} to Unlock Training`
                        : 'Take Assessment to Apply'}
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
                  No fee to submit an application. A training fee, where the job card requires one, is separate. Your saved professional details are attached automatically.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
