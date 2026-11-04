import { ArrowUpRight, Briefcase, Building2, CalendarClock, MapPin } from 'lucide-react'
import { StatusBadge } from '@/components/status-badge'
import type { ExternalJobView } from '@/lib/adzuna'

/**
 * A third-party advert as a company-hiring card.
 *
 * The card intentionally shows the company, role, location, contract, advertised pay and a short
 * description, without a per-advert "apply" link. These roles are not AfterWorks tasks: there is no
 * assessment, training fee or AfterWorks payout attached to them.
 *
 * Adzuna's terms require every displayed advert to carry an "Adzuna" label of at least 116×23 px,
 * hyperlinked to the relevant local Adzuna domain. That attribution is a licensing requirement and
 * must stay visible on every card. The label is the only outbound link on this card.
 */
export function ExternalAdvertCard({ job }: { job: ExternalJobView }) {
  return (
    <article className="flex flex-col rounded-2xl border border-dashed border-border bg-card p-5 transition-colors hover:border-primary/40">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="neutral">Company hiring</StatusBadge>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          <Building2 className="size-3" />
          {job.company}
        </span>
      </div>

      <h3 className="mt-3 text-pretty text-base font-semibold leading-snug text-foreground">{job.title}</h3>

      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{job.description}</p>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Briefcase className="size-3.5" /> {job.category}
        </span>
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

      <div className="mt-4 rounded-lg border border-border/70 bg-secondary/30 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Advertised pay</p>
        <p className="mt-0.5 text-sm font-semibold text-foreground">{job.salaryLabel || 'Not disclosed'}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Paid by the employer, not through your AfterWorks wallet.
        </p>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        This role is advertised by {job.company}. AfterWorks does not handle applications or pay for
        it.
      </p>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
        <span className="text-[11px] leading-snug text-muted-foreground">
          Company hiring details
          <br />
          Advertised on Adzuna
        </span>
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
