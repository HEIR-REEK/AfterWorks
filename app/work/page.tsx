import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Briefcase, Clock3, Globe2, ShieldCheck } from 'lucide-react'
import { PublicJobCard } from '@/components/public-job-card'
import { PublicPage } from '@/components/public-shell'
import { listPublicJobs } from '@/lib/public-jobs-server'
import { PUBLIC_JOB_CATEGORIES, jsonLd, publicCategoryPath } from '@/lib/public-jobs'
import { site } from '@/lib/site'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Open Microwork Jobs & Tasks',
  description:
    'Browse open AfterWorks microwork jobs: transcription, data entry, image labelling, content review, translation and research. See the pay, time and requirements before you apply.',
  alternates: { canonical: '/work' },
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: `Open microwork jobs · ${site.name}`,
    description: 'Real, reviewed microwork with the pay and requirements shown before you apply.',
    url: '/work',
    images: [{ url: '/brand/opengraph.png', width: 1200, height: 630, alt: `${site.name} open work` }],
  },
}

export default async function WorkPage() {
  const jobs = await listPublicJobs()
  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Open microwork jobs · ${site.name}`,
    description: 'Open transcription, data entry, labelling, review, translation and research tasks.',
    url: `${site.url}/work`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: jobs.length,
      itemListElement: jobs.slice(0, 50).map((job, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${site.url}/work/${encodeURIComponent(job.id)}`,
        name: job.title,
      })),
    },
  }

  return (
    <PublicPage>
      <section className="border-b border-border bg-secondary/25">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Open work</p>
          <h1 className="mt-3 max-w-3xl text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
            Find a task that fits your day.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Every card below shows the pay, the expected time and what the work involves before you
            create an account. Applying is free. Identity verification is required before a payout,
            and some specialist cards include a paid training module.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/sign-up" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              Create an account <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/#how-it-works" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:border-primary/40">
              How AfterWorks works
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Briefcase className="size-3.5 text-primary" /> {jobs.length} open {jobs.length === 1 ? 'card' : 'cards'} right now</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5 text-primary" /> Short, timed tasks</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-success" /> Reviewed work, clear payout path</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="open-jobs" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="open-jobs" className="text-xl font-semibold tracking-tight">Open job cards</h2>
            <p className="mt-1 text-sm text-muted-foreground">Only cards with a free slot and an open deadline appear here.</p>
          </div>
          <Link href="/jobs" className="text-xs font-medium text-muted-foreground hover:text-foreground">Already a member? Open the workspace →</Link>
        </div>

        {jobs.length > 0 ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => <PublicJobCard key={job.id} job={job} />)}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-semibold">No open cards at this moment.</p>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              New work is posted as clients send briefs. You can still read the category guides
              below, or create an account and we will show the board as soon as a card opens.
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="external-work" className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Globe2 className="size-4" />
            </span>
            <div>
              <h2 id="external-work" className="text-base font-semibold tracking-tight">Looking further afield?</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                We also show selected third-party adverts from Adzuna. They are clearly labelled,
                you apply on Adzuna, and they are separate from AfterWorks work and payouts.
              </p>
            </div>
          </div>
          <Link
            href="/work/external"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2.5 text-xs font-semibold hover:border-primary/40"
          >
            Browse external roles <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </section>

      <section aria-labelledby="categories" className="border-t border-border bg-secondary/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <h2 id="categories" className="text-xl font-semibold tracking-tight">Work by category</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Each category explains what the task involves and what a good submission looks like.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PUBLIC_JOB_CATEGORIES.map((category) => (
              <Link
                key={category.slug}
                href={publicCategoryPath(category.slug)}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <p className="text-sm font-semibold">{category.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{category.summary}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">Read the guide <ArrowRight className="size-3.5" /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionJsonLd) }} />
    </PublicPage>
  )
}
