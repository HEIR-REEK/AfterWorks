import Link from 'next/link'
import { ArrowRight, Clock, GraduationCap, MapPin, ShieldCheck, Users } from 'lucide-react'
import { StatusBadge } from '@/components/status-badge'
import { formatDuration, formatUsd, formatTrainingFeeLabel } from '@/lib/afterworks-data'
import { publicJobPath, type PublicJob } from '@/lib/public-jobs'

function closingLabel(closesAt: string): string {
  if (!closesAt) return 'Open until filled'
  const days = Math.ceil((Date.parse(closesAt) - Date.now()) / 86_400_000)
  if (!Number.isFinite(days)) return 'Open until filled'
  if (days <= 0) return 'Closes today'
  if (days === 1) return 'Closes tomorrow'
  return `Closes in ${days} days`
}

/** Server-rendered card used by the public catalogue; it has no auth or provider dependency. */
export function PublicJobCard({ job }: { job: PublicJob }) {
  return (
    <article className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="neutral">{job.category}</StatusBadge>
        {job.slotsRemaining <= 3 ? (
          <StatusBadge tone="warning">{job.slotsRemaining} slots left</StatusBadge>
        ) : (
          <StatusBadge tone="success">{job.slotsRemaining} slots open</StatusBadge>
        )}
        {job.requiresVerified && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            <ShieldCheck className="size-3" /> KYC required
          </span>
        )}
      </div>

      <h2 className="mt-3 text-pretty text-base font-semibold leading-snug text-foreground group-hover:text-primary">
        <Link href={publicJobPath(job.id)} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {job.title}
        </Link>
      </h2>
      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{job.description}</p>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" /> {formatDuration(job.estimatedMinutes)}</span>
        <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" /> {job.capacity} worker slots</span>
        <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" /> {closingLabel(job.closesAt)}</span>
      </div>

      {job.trainingRequired && (
        <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
          <GraduationCap className="size-3.5" /> Training {formatTrainingFeeLabel(job.trainingFeeUsd)}
        </p>
      )}

      <div className="mt-auto flex items-end justify-between gap-3 border-t border-border pt-4">
        <div>
          <p className="font-mono text-xl font-semibold">{formatUsd(job.payAmountUsd)}</p>
          <p className="text-[11px] text-muted-foreground">on completion, after review</p>
        </div>
        <Link href={publicJobPath(job.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          View job <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </article>
  )
}
