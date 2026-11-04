import { ArrowUpRight, Building2, CalendarClock, ExternalLink, MapPin } from 'lucide-react'
import { StatusBadge } from '@/components/status-badge'
import type { ExternalJobCard } from '@/lib/adzuna'

/**
 * A third-party advert.
 *
 * It deliberately does not reuse `PublicJobCard`: an Adzuna advert cannot be applied for, assessed,
 * trained for or paid through AfterWorks. Keeping the card visually distinct is how a worker knows
 * that the link leaves the platform.
 *
 * Adzuna's terms require every displayed advert to carry an "Adzuna" label of at least 116×23 px,
 * hyperlinked to the relevant local Adzuna domain. The `AdzunaAttribution` below is that label —
 * do not hide it on small screens or replace it with plain text.
 */
export function ExternalAdvertCard({ job }: { job: ExternalJobCard }) {
  return (
    <article className="flex flex-col rounded-2xl border border-dashed border-border bg-card p-5 transition-colors hover:border-primary/40">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="neutral">External advert</StatusBadge>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          <Building2 className="size-3" />
          {job.company}
        </span>
      </div>

      <h2 className="mt-3 text-pretty text-base font-semibold leading-snug text-foreground">
        <a
          href={job.redirectUrl}
          target="_blank"
          rel="noopener noreferrer nofollow sponsored"
          className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {job.title}
        </a>
      </h2>

      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{job.description}</p>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5" /> {job.location}
        </span>
        {job.contractLabel && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5" /> {job.contractLabel}
          </span>
        )}
        <span>{job.postedLabel}</span>
      </div>

      {job.salaryLabel && (
        <p className="mt-3 text-sm font-semibold text-foreground">{job.salaryLabel}</p>
      )}

      <p className="mt-4 rounded-lg border border-border/70 bg-secondary/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        This advert is supplied by Adzuna. AfterWorks is not the employer and does not handle
        applications for it — you apply on Adzuna.
      </p>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
        <a
          href={job.redirectUrl}
          target="_blank"
          rel="noopener noreferrer nofollow sponsored"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          View advert on Adzuna <ExternalLink className="size-3.5" />
        </a>
        <AdzunaAttribution href={job.attributionUrl} />
      </div>
    </article>
  )
}

/**
 * The minimum attribution unit. The size is a licence requirement, not a design preference:
 * 116×23 CSS pixels, visible, hyperlinked to the local Adzuna site.
 */
export function AdzunaAttribution({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Adzuna — external job listings"
      className="inline-flex min-h-[23px] min-w-[116px] shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:border-primary/50 hover:text-primary"
    >
      Adzuna <ArrowUpRight className="size-3" />
    </a>
  )
}
