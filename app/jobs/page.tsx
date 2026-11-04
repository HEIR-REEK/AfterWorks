'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useAfterWorks } from '@/components/afterworks-provider'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, ChevronRight, GraduationCap, RefreshCw, Search } from 'lucide-react'
import { JobCard } from '@/components/job-card'
import { ExternalJobsSection } from '@/components/external-jobs-section'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { JobCategory } from '@/lib/afterworks-data'
import { formatTimestamp } from '@/lib/datetime'
import { filterJobs } from '@/lib/admin-search'

const categories: (JobCategory | 'All')[] = [
  'All',
  'Data Entry',
  'Transcription',
  'Image Labeling',
  'Content Review',
  'Translation',
  'Research',
]

export default function JobsPage() {
  return (
    <Suspense fallback={<p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Loading jobs…</p>}>
      <JobsPageInner />
    </Suspense>
  )
}

function JobsPageInner() {
  const { jobs, worker, profileLoaded, mode, catalogueLive, catalogueSyncedAt, refreshJobs } = useAfterWorks()
  const searchParams = useSearchParams()
  const trainingParam = searchParams.get('training') === '1'
  // The training upsell links here with `?training=1`. Keep the toggle in state so the worker can
  // clear it without navigating away, and follow the parameter when a link changes it.
  const [trainingOnly, setTrainingOnly] = useState(trainingParam)
  useEffect(() => {
    setTrainingOnly(trainingParam)
  }, [trainingParam])
  const [category, setCategory] = useState<(typeof categories)[number]>('All')
  const [query, setQuery] = useState('')
  const [hideFull, setHideFull] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // The board is fed by a live Firestore listener (see AfterWorksProvider), so an admin edit —
  // a changed training price, pay, slot count or status — lands here by itself. The button is the
  // manual escape hatch for a worker who has just been told something changed.
  const syncedLabel = catalogueSyncedAt
    ? `${formatTimestamp(catalogueSyncedAt, { hour: '2-digit', minute: '2-digit' })} EAT`
    : null

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshJobs()
    } finally {
      setRefreshing(false)
    }
  }

  const filtered = useMemo(
    () => filterJobs(jobs, { category, trainingOnly, hideFull, search: query }),
    [jobs, category, hideFull, trainingOnly, query],
  )

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
              title="These are example jobs — the live listings are not on this site yet."
            >
              Sample jobs
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
                Complete your profile and Didit KYC verification to start training, take assessments and receive payments. You can pay a job card’s training fee before verification; the training and assessment stay locked until the check is approved.
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
          <button
            type="button"
            onClick={() => setTrainingOnly((value) => !value)}
            aria-pressed={trainingOnly}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
              trainingOnly
                ? 'border-warning bg-warning text-warning-foreground'
                : 'border-warning/50 bg-warning/10 text-warning-foreground hover:bg-warning/20',
            )}
          >
            <GraduationCap className="size-3.5" aria-hidden />
            Training required
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, category or skill…"
              aria-label="Search jobs"
              className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
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

      <ExternalJobsSection />
    </div>
  )
}
