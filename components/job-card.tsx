import Link from 'next/link'
import { Clock, GraduationCap, MapPin, Users } from 'lucide-react'
import {
  formatDuration,
  formatKes,
  formatUsd,
  type Job,
} from '@/lib/afterworks-data'
import { StatusBadge } from '@/components/status-badge'

function closingLabel(closesAt: string): { text: string; urgent: boolean } {
  const ms = new Date(closesAt).getTime() - Date.now()
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24))
  if (ms <= 0) return { text: 'Closed', urgent: true }
  if (days <= 1) return { text: 'Closes today', urgent: true }
  if (days <= 2) return { text: 'Closes in 2 days', urgent: true }
  return { text: `Closes in ${days} days`, urgent: false }
}

export function JobCard({ job }: { job: Job }) {
  const closing = closingLabel(job.closesAt)
  const isClosed = job.status !== 'open' || job.slotsRemaining <= 0
  const almostFull = !isClosed && job.slotsRemaining <= 3

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <StatusBadge tone="neutral">{job.category}</StatusBadge>
        {isClosed ? (
          <StatusBadge tone="danger">Slots full</StatusBadge>
        ) : almostFull ? (
          <StatusBadge tone="warning">{job.slotsRemaining} slots left</StatusBadge>
        ) : (
          <StatusBadge tone="success">{job.slotsRemaining} slots open</StatusBadge>
        )}
      </div>

      <h3 className="mt-3 text-pretty text-base font-semibold leading-snug text-foreground group-hover:text-primary">
        {job.title}
      </h3>
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
        {job.description}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
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

      {job.trainingRequired && (
        <div className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">
          <GraduationCap className="size-3.5" />
          Training required — $10
        </div>
      )}

      <div className="mt-4 flex items-end justify-between border-t border-border pt-4">
        <div>
          <p className="font-mono text-xl font-semibold text-foreground">
            {formatUsd(job.payAmountUsd)}
          </p>
          <p className="text-xs text-muted-foreground">≈ {formatKes(job.payAmountUsd)}</p>
        </div>
        <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
          View details →
        </span>
      </div>
    </Link>
  )
}
