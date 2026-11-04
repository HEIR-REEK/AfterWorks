import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Globe2, Info, RefreshCw } from 'lucide-react'
import { ExternalAdvertCard } from '@/components/external-job-card'
import { PublicPage } from '@/components/public-shell'
import { listExternalJobs, getExternalFeedMeta } from '@/lib/external-jobs-server'
import { adzunaConfiguration } from '@/lib/adzuna-server'
import { ADZUNA_COUNTRY_LABELS } from '@/lib/adzuna'
import { site } from '@/lib/site'

/**
 * External feed page.
 *
 * This page is intentionally `noindex, follow` and is absent from the sitemap. The adverts are
 * third-party snippets that already exist on Adzuna; indexing them here would create a thin
 * duplicate of another site's inventory. Workers can still reach and use the page.
 *
 * There is no JobPosting JSON-LD here: these are not AfterWorks vacancies, and marking them up as
 * ours would be a false claim to Google (and to the worker).
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'External roles from Adzuna',
  description:
    'Selected third-party job adverts from Adzuna. AfterWorks is not the employer and does not handle these applications.',
  alternates: { canonical: '/work/external' },
  robots: { index: false, follow: true },
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: `External roles from Adzuna · ${site.name}`,
    description: 'Third-party adverts, clearly separated from AfterWorks microwork.',
    url: '/work/external',
  },
}

function when(iso: string): string {
  if (!iso) return ''
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default async function ExternalJobsPage() {
  const [jobs, meta, configuration] = await Promise.all([
    listExternalJobs(),
    getExternalFeedMeta(),
    Promise.resolve(adzunaConfiguration()),
  ])
  const country = meta?.country ?? configuration.country

  return (
    <PublicPage>
      <section className="border-b border-border bg-secondary/25">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <Link href="/work" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to AfterWorks work
          </Link>
          <p className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Globe2 className="size-3.5 text-primary" /> External listings
          </p>
          <h1 className="mt-3 max-w-3xl text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
            More roles, from Adzuna.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            These adverts come from Adzuna, a separate job search service. They are not AfterWorks
            tasks: there is no assessment, training fee or AfterWorks payout, and applications and
            pay are handled by the employer. We list the company hiring details and advertised pay
            for workers who want to look beyond the microwork board.
          </p>
          <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
            Listings supplied by Adzuna
            {meta ? ` · ${ADZUNA_COUNTRY_LABELS[country]}` : ''}
            {meta?.syncedAt ? ` · refreshed ${when(meta.syncedAt)}` : ''}
          </p>
        </div>
      </section>

      <section aria-labelledby="external-jobs" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="external-jobs" className="text-xl font-semibold tracking-tight">
              Adzuna adverts
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Company, location, contract and advertised pay. AfterWorks does not receive or manage
              applications for these roles.
            </p>
          </div>
          {jobs.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {jobs.length} advert{jobs.length === 1 ? '' : 's'} shown
            </span>
          )}
        </div>

        {!configuration.configured ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-10 text-center">
            <Info className="size-5 text-muted-foreground" />
            <p className="text-sm font-semibold">External listings are not switched on yet.</p>
            <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground">
              The Adzuna feed needs to be configured and imported by an administrator. Nothing is
              shown here until real adverts have been stored — AfterWorks does not use sample ads.
            </p>
            <Link href="/work" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              Browse AfterWorks jobs <ArrowRight className="size-3.5" />
            </Link>
          </div>
        ) : jobs.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-10 text-center">
            <RefreshCw className="size-5 text-muted-foreground" />
            <p className="text-sm font-semibold">No external adverts are imported right now.</p>
            <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground">
              The feed may be between refreshes, or the import may have found nothing for the chosen
              market and keyword. The AfterWorks board is unaffected.
            </p>
            <Link href="/work" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              Browse AfterWorks jobs <ArrowRight className="size-3.5" />
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {jobs.map((job) => (
                <ExternalAdvertCard key={job.id} job={job} />
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <p className="max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                External adverts are provided by Adzuna. AfterWorks does not control their content,
                does not receive an application made on Adzuna and cannot support a dispute about
                one. For AfterWorks work, with an assessment, training and a tracked payout, use the
                main board.
              </p>
              <Link href="/work" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                AfterWorks jobs <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </>
        )}
      </section>
    </PublicPage>
  )
}
