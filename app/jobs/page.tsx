'use client'

import { useMemo, useState } from 'react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { JobCard } from '@/components/job-card'
import { cn } from '@/lib/utils'
import type { JobCategory } from '@/lib/afterworks-data'

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
  const { jobs } = useAfterWorks()
  const [category, setCategory] = useState<(typeof categories)[number]>('All')
  const [hideFull, setHideFull] = useState(true)

  const filtered = useMemo(() => {
    return jobs.filter((job) => {
      if (category !== 'All' && job.category !== category) return false
      if (hideFull && (job.status !== 'open' || job.slotsRemaining <= 0)) return false
      return true
    })
  }, [jobs, category, hideFull])

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Browse jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'job' : 'jobs'} available. Applying is
          always free.
        </p>
      </header>

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
          Hide full & closed jobs
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
