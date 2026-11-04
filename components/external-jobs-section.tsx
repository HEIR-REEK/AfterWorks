'use client'

import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { ExternalAdvertCard } from '@/components/external-job-card'
import { apiFetch } from '@/lib/client-api'
import type { ExternalJobView } from '@/lib/adzuna'

/**
 * Company-hiring section on the member job board.
 *
 * The section fetches the stored feed from our own route (never Adzuna directly) and places these
 * roles below the AfterWorks cards, visually separated. They are not applications or payments that
 * AfterWorks can process, so the copy says that plainly and the cards do not offer an apply button.
 *
 * If the feed is empty or unavailable the whole section is omitted: an empty "external jobs" block
 * on every visit would be noise, and it must never fall back to sample data.
 */
export function ExternalJobsSection() {
  const [jobs, setJobs] = useState<ExternalJobView[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void apiFetch<{ ok: boolean; jobs?: ExternalJobView[] }>('/api/external-jobs')
      .then((data) => {
        if (cancelled) return
        setJobs(Array.isArray(data.jobs) ? data.jobs : [])
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed || !jobs || jobs.length === 0) return null

  return (
    <section aria-labelledby="company-hiring" className="border-t border-border pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Building2 className="size-3.5 text-primary" /> Company hiring
          </p>
          <h2 id="company-hiring" className="mt-1 text-xl font-semibold tracking-tight">
            More roles from companies hiring now
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Company, location and advertised pay. These are not AfterWorks tasks: applications and
            pay are handled by the employer, not through AfterWorks or your wallet.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {jobs.length} advertised role{jobs.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {jobs.map((job) => (
          <ExternalAdvertCard key={job.id} job={job} />
        ))}
      </div>
    </section>
  )
}
