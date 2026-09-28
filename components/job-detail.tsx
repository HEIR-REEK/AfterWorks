'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  GraduationCap,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAfterWorks, useAfterWorksOptional, useJobDetail } from '@/components/afterworks-provider'
import { useAuth } from '@/components/firebase-auth-provider'
import { PublicFooter, PublicHeader } from '@/components/public-shell'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  APPLICATION_LABELS,
  APPLICATION_TONE,
  formatDuration,
  formatKes,
  formatUsd,
  trainingFeeUsdFor,
  type Application,
} from '@/lib/afterworks-data'
import { publicClosingLabel, type PublicJob } from '@/lib/public-job'
import { site } from '@/lib/site'

/**
 * One job card, in the two shapes it has to take.
 *
 * A visitor with no session — and therefore a search crawler — gets `PublicJobDetail`: the whole
 * card rendered on the server from the Admin SDK read, including the description, the
 * responsibilities, the pay and the closing date, plus a `JobPosting` block the page adds as
 * JSON-LD. Nothing here needs Firebase to be reachable from the browser.
 *
 * A member gets `MemberJobDetail`, which is the page exactly as it has always behaved: the card is
 * re-read live (`useJobDetail`) so a price or slot count changed in the console is what they see,
 * and the sidebar carries their application status, KYC state and the training checkout.
 *
 * The choice comes from `useAfterWorksOptional()` so that server rendering — when no session is
 * known yet — always produces the public card. That is the HTML a crawler indexes.
 */

export function JobDetail({ publicJob }: { publicJob: PublicJob }) {
  const ctx = useAfterWorksOptional()
  const { user } = useAuth()
  if (ctx && user) return <MemberJobDetail jobId={publicJob.id} />
  return <PublicJobDetail job={publicJob} />
}

// ─── Public card (signed-out visitors and crawlers) ──────────────────────────

function PublicJobDetail({ job }: { job: PublicJob }) {
  const isClosed = job.status !== 'open' || job.slotsRemaining <= 0
  const filled = Math.max(0, job.capacity - job.slotsRemaining)
  const fillPct = job.capacity > 0 ? Math.round((filled / job.capacity) * 100) : 0
  const trainingFee = formatUsd(trainingFeeUsdFor(job.trainingFeeUsd))
  const closing = publicClosingLabel(job.closesAt)
  const hourly = job.estimatedMinutes > 0 ? (job.payAmountUsd / job.estimatedMinutes) * 60 : 0

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicHeader currentPath="/jobs" />

      <main id="main" className="flex-1">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
          <Link
            href="/jobs"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to all jobs
          </Link>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <article className="rounded-2xl border border-border bg-card p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="neutral">{job.category}</StatusBadge>
                  {isClosed ? (
                    <StatusBadge tone="danger">Slots full</StatusBadge>
                  ) : job.slotsRemaining <= 3 ? (
                    <StatusBadge tone="warning">{job.slotsRemaining} slots left</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">{job.slotsRemaining} slots open</StatusBadge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">{closing.text}</span>
                </div>

                <h1 className="mt-4 text-pretty text-2xl font-semibold leading-tight sm:text-3xl">
                  {job.title}
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Posted {job.postedAgo} · {job.category} microwork on {site.name}
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {job.description}
                </p>

                {job.responsibilities.length > 0 ? (
                  <>
                    <h2 className="mt-6 text-sm font-semibold">What you&apos;ll do</h2>
                    <ul className="mt-2 flex flex-col gap-2">
                      {job.responsibilities.map((entry) => (
                        <li key={entry} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                          {entry}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </article>

              <section className="rounded-2xl border border-border bg-card p-6">
                <h2 className="text-sm font-semibold">Requirements &amp; flow</h2>
                <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                  <li>Create a free account and confirm your email address.</li>
                  <li>
                    Complete ID verification (KYC) once — a government ID and a liveness check, run by
                    our verification provider. We store the outcome, never the document.
                  </li>
                  {job.trainingRequired ? (
                    <li>
                      Pay the one-off training module ({trainingFee}) for this card, work through the
                      material and pass the short skill assessment.
                    </li>
                  ) : (
                    <li>This card needs no training payment — go straight to the assessment.</li>
                  )}
                  <li>Apply for the job card, do the work and submit it for review.</li>
                  <li>
                    It clears in {site.clearingWindowHours} hours, then becomes withdrawable to your
                    mobile money number.
                  </li>
                </ol>
              </section>
            </div>

            <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:h-fit">
              <div className="rounded-2xl border border-border bg-card p-6">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Payment on completion
                </p>
                <p className="mt-1 font-mono text-3xl font-semibold">{formatUsd(job.payAmountUsd)}</p>
                <p className="mt-1 text-xs text-muted-foreground">≈ {formatKes(job.payAmountUsd)}</p>

                <dl className="mt-5 flex flex-col gap-3 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="size-4" /> Estimated time
                    </dt>
                    <dd className="font-medium">{formatDuration(job.estimatedMinutes)}</dd>
                  </div>
                  {hourly > 0 ? (
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Effective rate</dt>
                      <dd className="font-mono font-medium">{formatUsd(hourly)}/hr</dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-muted-foreground">
                      <Users className="size-4" /> Slots filled
                    </dt>
                    <dd className="font-medium">
                      {filled} / {job.capacity}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Identity check</dt>
                    <dd className="font-medium">{job.requiresVerified ? 'Required' : 'Not required'}</dd>
                  </div>
                </dl>

                <div className="mt-3">
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${fillPct}% of slots filled`}
                  >
                    <div className="h-full rounded-full bg-primary" style={{ width: `${fillPct}%` }} />
                  </div>
                </div>

                {job.trainingRequired ? (
                  <div className="mt-4 flex items-start gap-2 rounded-lg bg-accent p-3 text-xs text-accent-foreground">
                    <GraduationCap className="mt-0.5 size-4 shrink-0" />
                    <span>
                      One-off training module of {trainingFee} unlocks the training material and the
                      assessment for this card only. You see the price before you pay.
                    </span>
                  </div>
                ) : null}

                <div className="mt-5 flex flex-col gap-2">
                  <Button render={<Link href={isClosed ? '/jobs' : '/sign-up'} />} size="lg" className="w-full gap-2" disabled={isClosed}>
                    {isClosed ? 'Slots full' : 'Create free account to apply'}
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button render={<Link href="/sign-in" />} variant="outline" size="sm" className="w-full">
                    Already have an account? Sign in
                  </Button>
                  <p className="mt-1 text-center text-xs text-muted-foreground">
                    No fee to apply, ever. {site.payoutSla}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  )
}

// ─── Member card (signed in; unchanged behaviour) ────────────────────────────

function MemberJobDetail({ jobId }: { jobId: string }) {
  const id = jobId
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

  async function handleApply() {
    setError(null)
    if (!worker.kycVerified) {
      setError('Identity verification (KYC) is required before applying for jobs.')
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
              <li className="flex items-center gap-2.5 text-muted-foreground">
                {worker.kycVerified ? (
                  <>
                    <ShieldCheck className="size-4 shrink-0 text-success" />
                    <span>Identity Verification (KYC) — <strong className="text-success font-medium">Verified</strong></span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="size-4 shrink-0 text-warning" />
                    <span>Identity Verification (KYC) — <strong className="text-warning font-medium">Action required</strong></span>
                  </>
                )}
              </li>
              {job.trainingRequired ? (
                <li className="flex items-start gap-2.5 text-muted-foreground">
                  <GraduationCap className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <span>Step 1: Pay {trainingFee} → Step 2: Access Training → Step 3: Skill Assessment → Step 4: Apply for Job Card</span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isPaid ? (
                        <strong className="text-success font-medium">✓ Payment confirmed. Training &amp; assessment unlocked for this job card!</strong>
                      ) : (
                        <span>Each job card requires its own separate {trainingFee} payment. Completing payment unlocks training &amp; assessment for this specific job card only.</span>
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
                  {isPaid
                    ? 'Payment detected! Training modules & assessment are unlocked.'
                    : `This job card requires payment detection (${trainingFee}) before training and assessment open.`}
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
                    disabled={isClosed || isApplying}
                    size="lg"
                    className="w-full gap-2"
                  >
                    {isApplying && <Loader2 className="size-4 animate-spin" />}
                    {isApplying ? 'Redirecting...' : isClosed ? 'Slots full' : 'Take Assessment to Apply'}
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
                  No fee to apply. Your saved professional details are attached automatically.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
