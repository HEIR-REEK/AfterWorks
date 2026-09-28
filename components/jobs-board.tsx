'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { JobCard } from '@/components/job-card'
import { PublicJobCard } from '@/components/public-job-card'
import { PublicFooter, PublicHeader } from '@/components/public-shell'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { useAfterWorksOptional } from '@/components/afterworks-provider'
import { useAuth } from '@/components/firebase-auth-provider'
import { JOB_CATEGORY_LIST, type JobCategory } from '@/lib/afterworks-data'
import { openPublicJobs, publicCategoryCounts, type PublicJob } from '@/lib/public-job'
import { cn } from '@/lib/utils'
import { site } from '@/lib/site'

/**
 * The job board, in the two shapes it has to take.
 *
 * A visitor with no session — which is what a search crawler is — gets `PublicJobsBoard`: real cards
 * rendered from the server read, filters that are ordinary links (so every category is its own
 * crawlable URL), and no dependency on Firebase being reachable from the browser. A member gets
 * `MemberJobsBoard`, which is the board as it has always worked: the live Firestore listener, the
 * refresh button, "already applied" state and the KYC nudge.
 *
 * The choice is made from `useAfterWorksOptional()`, not from a prop, because the decision has to be
 * identical during server rendering (when nobody is signed in yet) and after hydration. SSR always
 * renders the public board — that is the HTML a crawler indexes — and members upgrade in place once
 * `AppGate` has resolved their session and mounted the provider.
 */

const categories: (JobCategory | 'All')[] = ['All', ...JOB_CATEGORY_LIST]

export function JobsBoard({
  initialJobs,
  live,
  initialCategory = 'All',
  initialShowAll = false,
}: {
  initialJobs: PublicJob[]
  live: boolean
  initialCategory?: JobCategory | 'All'
  initialShowAll?: boolean
}) {
  const ctx = useAfterWorksOptional()
  const { user } = useAuth()

  // Both halves of the condition matter: the provider has to be mounted (AppGate does that for a
  // resolved session) *and* there has to be a user, otherwise a signed-out visitor on a deployment
  // that happens to have a provider would be shown member-only state it cannot load.
  if (ctx && user) {
    return <MemberJobsBoard />
  }
  return (
    <PublicJobsBoard
      jobs={initialJobs}
      live={live}
      category={initialCategory}
      showAll={initialShowAll}
    />
  )
}

// ─── Public board (signed-out visitors and crawlers) ─────────────────────────

function PublicJobsBoard({
  jobs,
  live,
  category,
  showAll,
}: {
  jobs: PublicJob[]
  live: boolean
  category: JobCategory | 'All'
  showAll: boolean
}) {
  const counts = useMemo(() => publicCategoryCounts(jobs), [jobs])
  const visible = useMemo(() => {
    return jobs.filter((job) => {
      if (category !== 'All' && job.category !== category) return false
      if (!showAll && (job.status !== 'open' || job.slotsRemaining <= 0)) return false
      return true
    })
  }, [jobs, category, showAll])

  const openCount = openPublicJobs(jobs).length
  // A filter link keeps the other parameter, so `?category=X&full=1` combinations stay reachable
  // without JavaScript and each one is a distinct, canonical URL.
  const filterHref = (next: JobCategory | 'All') => {
    const params = new URLSearchParams()
    if (next !== 'All') params.set('category', next)
    if (showAll) params.set('full', '1')
    const query = params.toString()
    return query ? `/jobs?${query}` : '/jobs'
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicHeader currentPath="/jobs" />

      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <header>
            <h1 className="text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
              Paid microwork jobs in Kenya
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {openCount} {openCount === 1 ? 'job card is' : 'job cards are'} open right now across
              transcription, data entry, image labelling, content review, translation and research.
              Every card shows its pay, how long it takes and how many slots are left. Browsing and
              applying are always free — the only cost is an optional one-off training module on some
              cards, priced before you pay.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!live ? (
                <StatusBadge tone="warning">
                  Sample catalogue — this deployment is not serving live jobs yet
                </StatusBadge>
              ) : (
                <StatusBadge tone="success">Live catalogue</StatusBadge>
              )}
              <StatusBadge tone="neutral">Payouts to mobile money</StatusBadge>
              <StatusBadge tone="neutral">{site.clearingWindowHours}h clearing</StatusBadge>
            </div>
          </header>

          {/* Filters as links: works without JavaScript, and gives each category its own URL. */}
          <nav aria-label="Job categories" className="mt-8">
            <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {categories.map((entry) => {
                const active = category === entry
                const count = entry === 'All' ? openCount : (counts[entry] ?? 0)
                return (
                  <li key={entry}>
                    <Link
                      href={filterHref(entry)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      {entry}
                      <span className={cn('text-xs', active ? 'text-primary-foreground/70' : 'text-muted-foreground/70')}>
                        {count}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              {showAll ? (
                <>
                  Showing open and full cards.{' '}
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={category === 'All' ? '/jobs' : `/jobs?category=${encodeURIComponent(category)}`}
                  >
                    Hide full &amp; closed jobs
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={filterHref(category) + (filterHref(category).includes('?') ? '&' : '?') + 'full=1'}
                  >
                    Show full &amp; closed jobs too
                  </Link>
                </>
              )}
            </p>
          </nav>

          {visible.length === 0 ? (
            <p className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No jobs match this filter right now. New cards are posted regularly —{' '}
              <Link className="font-medium text-primary hover:underline" href="/sign-up">
                create a free account
              </Link>{' '}
              and the board is waiting for you.
            </p>
          ) : (
            <ul className="mt-8 grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((job) => (
                <li key={job.id}>
                  <PublicJobCard job={job} />
                </li>
              ))}
            </ul>
          )}

          {/* Context a crawler and a first-time visitor both need: what this work actually is. */}
          <section className="mt-14 grid gap-6 border-t border-border pt-10 md:grid-cols-2">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">What kind of work is this?</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Microwork is short, well-scoped, paid tasks rather than an employment contract: a
                batch of audio to transcribe, a set of images to label, a list of listings to check
                for accuracy, a document to translate. Each card on this board is one of those
                batches, with a fixed price, an estimated duration and a limited number of slots.
              </p>
              <ul className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
                {JOB_CATEGORY_LIST.map((entry) => (
                  <li key={entry} className="flex items-center gap-2">
                    <Search className="size-3.5 shrink-0 text-primary" />
                    <Link className="hover:text-foreground hover:underline" href={`/jobs?category=${encodeURIComponent(entry)}`}>
                      {entry} jobs
                    </Link>
                    {counts[entry] ? <span className="text-xs">· {counts[entry]} open</span> : null}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-lg font-semibold tracking-tight">Before you apply</h2>
              <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                <li>
                  Create a free account and confirm your email address.
                </li>
                <li>
                  Complete ID verification once — a government ID and a liveness check, handled by our
                  KYC provider. We store the outcome, never the document.
                </li>
                <li>
                  If the card needs training, pay the one-off module fee shown on the card, then pass
                  the short assessment.
                </li>
                <li>
                  Apply, do the work, submit it. It clears in {site.clearingWindowHours} hours and
                  becomes withdrawable to your mobile money number.
                </li>
              </ol>
              <p className="mt-4 text-sm text-muted-foreground">
                AfterWorks never charges you to apply, to verify your identity or to withdraw. If
                anyone asks you to pay for a job offer, it is not us — write to{' '}
                <a className="font-medium text-primary hover:underline" href={`mailto:${site.supportEmail}`}>
                  {site.supportEmail}
                </a>
                .
              </p>
            </div>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  )
}

// ─── Member board (signed in; unchanged behaviour) ───────────────────────────

function MemberJobsBoard() {
  const { jobs, worker, profileLoaded, mode, catalogueLive, catalogueSyncedAt, refreshJobs } =
    useAfterWorksOptional()!
  const [category, setCategory] = useState<(typeof categories)[number]>('All')
  const [hideFull, setHideFull] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // The board is fed by a live Firestore listener (see AfterWorksProvider), so an admin edit —
  // a changed training price, pay, slot count or status — lands here by itself. The button is the
  // manual escape hatch for a worker who has just been told something changed.
  const syncedLabel = catalogueSyncedAt
    ? new Date(catalogueSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshJobs()
    } finally {
      setRefreshing(false)
    }
  }

  const filtered = useMemo(() => {
    return jobs.filter((job) => {
      if (category !== 'All' && job.category !== category) return false
      if (hideFull && (job.status !== 'open' || job.slotsRemaining <= 0)) return false
      return true
    })
  }, [jobs, category, hideFull])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Browse jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'job' : 'jobs'} available. Applying is
            always free.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {catalogueLive ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
              title="The board refreshes automatically when the AfterWorks team changes a job card."
            >
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-success" />
              </span>
              Live{syncedLabel ? ` · updated ${syncedLabel}` : ''}
            </span>
          ) : (
            <span
              className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
              title="These cards are sample data: this deployment is not serving a live catalogue yet."
            >
              Sample catalogue
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={refreshing || mode !== 'live'}
            onClick={() => void onRefresh()}
          >
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </header>

      {profileLoaded && (!worker.kycVerified || !worker.phone || !worker.country || !worker.school || !worker.course || !worker.jobExperience || !worker.career) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-warning/50 bg-warning/10 p-4 shadow-sm">
          <div className="flex gap-3">
            <AlertCircle className="size-5 text-warning shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-warning-foreground">Action Required: Update your profile</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                You must update your profile and complete Didit KYC verification to unlock all jobs and receive payments.
              </p>
            </div>
          </div>
          <Link
            href="/profile"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-warning px-4 py-2 text-xs font-semibold text-warning-foreground hover:bg-warning/90 transition-colors"
          >
            Go to Profile
            <ChevronRight className="size-3.5" />
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                category === c
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={hideFull}
            onChange={(e) => setHideFull(e.target.checked)}
            className="size-4 rounded border-border accent-primary"
          />
          Hide full &amp; closed jobs
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No jobs match your filters right now. Check back soon — new work is posted daily.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}
