'use client'

import Link from 'next/link'
import { Clock, GraduationCap, MapPin, Users, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import {
  formatDuration,
  formatUsd,
  type Job,
} from '@/lib/afterworks-data'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'

function closingLabel(closesAt: string): { text: string; urgent: boolean } {
  const ms = new Date(closesAt).getTime() - Date.now()
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24))
  if (ms <= 0) return { text: 'Closed', urgent: true }
  if (days <= 1) return { text: 'Closes today', urgent: true }
  if (days <= 2) return { text: 'Closes in 2 days', urgent: true }
  return { text: `Closes in ${days} days`, urgent: false }
}

export function JobCard({ job }: { job: Job }) {
  const { getApplicationForJob, isJobPaid } = useAfterWorks()
  const application = getApplicationForJob(job.id)
  const hasApplied = !!application
  const isPaid = isJobPaid(job.id)

  const closing = closingLabel(job.closesAt)
  const isClosed = job.status !== 'open' || job.slotsRemaining <= 0
  const almostFull = !isClosed && job.slotsRemaining <= 3

  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40 relative">
      <Link href={`/jobs/${job.id}`} className="absolute inset-0 z-0" aria-label="View job details" />
      
      <div className="flex items-start justify-between gap-3 relative z-10 pointer-events-none">
        <StatusBadge tone="neutral">{job.category}</StatusBadge>
        {isClosed ? (
          <StatusBadge tone="danger">Slots full</StatusBadge>
        ) : almostFull ? (
          <StatusBadge tone="warning">{job.slotsRemaining} slots left</StatusBadge>
        ) : (
          <StatusBadge tone="success">{job.slotsRemaining} slots open</StatusBadge>
        )}
      </div>

      <h3 className="mt-3 text-pretty text-base font-semibold leading-snug text-foreground group-hover:text-primary relative z-10 pointer-events-none">
        {job.title}
      </h3>
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground relative z-10 pointer-events-none">
        {job.description}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground relative z-10 pointer-events-none">
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
        <div className={`mt-3 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium relative z-10 pointer-events-none ${
          isPaid ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary border border-primary/20'
        }`}>
          <GraduationCap className="size-3.5" />
          {isPaid ? 'Training Unlocked ✓' : 'Payment Required — $10'}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4 relative z-10">
        <div className="flex items-end justify-between pointer-events-none">
          <p className="font-mono text-xl font-semibold text-foreground">
            {formatUsd(job.payAmountUsd)}
          </p>
          <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 flex items-center gap-1">
            View details <ArrowRight className="size-3" />
          </span>
        </div>
        
        <div className="relative z-20">
          {hasApplied ? (
            <div className="flex items-center justify-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm font-medium text-muted-foreground w-full border border-border">
              <CheckCircle2 className="size-4" />
              Already applied
            </div>
          ) : job.trainingRequired && !isPaid ? (
            <Button render={<Link href={`/training/${job.id}`} />} variant="default" size="sm" className="w-full gap-2">
              <GraduationCap className="size-4" />
              Pay 10$ to Unlock Training
            </Button>
          ) : (
            <Button render={<Link href={`/training/${job.id}`} />} variant="secondary" size="sm" className="w-full gap-2">
              <GraduationCap className="size-4" />
              {job.trainingRequired ? 'Continue Training & Assessment' : 'Take Assessment'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
