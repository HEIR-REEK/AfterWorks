import Link from 'next/link'
import { ArrowRight, Clock, GraduationCap, MapPin, Users } from 'lucide-react'
import { StatusBadge } from '@/components/status-badge'
import { formatDuration, formatKes, formatUsd, trainingFeeUsdFor } from '@/lib/afterworks-data'
import { publicClosingLabel, type PublicJob } from '@/lib/public-job'

/**
 * The job card a signed-out visitor sees.
 *
 * `components/job-card.tsx` is the member's card: it reads `useAfterWorks()` for "already applied"
 * and "training unlocked", which only exist inside a session. This one takes a `PublicJob` and
 * renders the same information from plain props, so it is a Server Component and its HTML is in the
 * first response — the part a crawler can actually read.
 *
 * Every figure shown here is on the public side of the paywall: pay, duration, capacity, slots,
 * closing date and the *price* of training. The training material itself and the assessment answers
 * are stripped server-side by `toPublicJob` and are never in these props.
 */

export function PublicJobCard({ job }: { job: PublicJob }) {
  const closing = publicClosingLabel(job.closesAt)
  const isClosed = job.status !== 'open' || job.slotsRemaining <= 0
  const almostFull = !isClosed && job.slotsRemaining <= 3
  const trainingFee = formatUsd(trainingFeeUsdFor(job.trainingFeeUsd))

  return (
    <article className="group relative flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
      <Link
        href={`/jobs/${job.id}`}
        className="absolute inset-0 z-0"
        aria-label={`${job.title} — view job details`}
      />

      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
        <StatusBadge tone="neutral">{job.category}</StatusBadge>
        {isClosed ? (
          <StatusBadge tone="danger">Slots full</StatusBadge>
        ) : almostFull ? (
          <StatusBadge tone="warning">{job.slotsRemaining} slots left</StatusBadge>
        ) : (
          <StatusBadge tone="success">{job.slotsRemaining} slots open</StatusBadge>
        )}
      </div>

      <h3 className="pointer-events-none relative z-10 mt-3 text-pretty text-base font-semibold leading-snug text-foreground group-hover:text-primary">
        {job.title}
      </h3>
      <p className="pointer-events-none relative z-10 mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
        {job.description}
      </p>

      <div className="pointer-events-none relative z-10 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3.5" />
          {formatDuration(job.estimatedMinutes)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" />
          {job.capacity} workers
        </span>
        <span className={`inline-flex items-center gap-1.5 ${closing.urgent ? 'text-warning-foreground' : ''}`}>
          <MapPin className="size-3.5" />
          {closing.text}
        </span>
      </div>

      {job.trainingRequired ? (
        <p className="pointer-events-none relative z-10 mt-3 inline-flex w-fit items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
          <GraduationCap className="size-3.5" />
          Training {trainingFee} · one-off
        </p>
      ) : (
        <p className="pointer-events-none relative z-10 mt-3 inline-flex w-fit items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          <GraduationCap className="size-3.5" />
          No training fee
        </p>
      )}

      <div className="relative z-10 mt-4 flex flex-col gap-3 border-t border-border pt-4">
        <div className="pointer-events-none flex items-end justify-between">
          <p className="font-mono text-xl font-semibold text-foreground">
            {formatUsd(job.payAmountUsd)}
            <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
              ≈ {formatKes(job.payAmountUsd)}
            </span>
          </p>
          <span className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            View details <ArrowRight className="size-3" />
          </span>
        </div>

        <span className="relative z-20 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-secondary px-2.5 text-sm font-medium text-secondary-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <GraduationCap className="size-4" />
          {job.trainingRequired ? 'View job & training' : 'View job details'}
        </span>
      </div>
    </article>
  )
}
