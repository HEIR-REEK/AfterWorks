import { MetadataRoute } from 'next'
import { JOB_CATEGORY_LIST } from '@/lib/afterworks-data'
import { getPublicCatalogue } from '@/lib/public-catalogue'
import { publicPostedDate } from '@/lib/public-job'
import { absoluteUrl } from '@/lib/site'

/**
 * The sitemap, generated from the live catalogue.
 *
 * Two rules this file follows that a hand-written list would break:
 *  • **Only public URLs are listed.** `/dashboard`, `/profile`, `/applications`, `/kyc` and the
 *    console are personal or privileged; listing them invites a crawler to hit a redirect and report
 *    it as an error in Search Console. They are also `Disallow`ed in `app/robots.ts`.
 *  • **Every job card gets its own entry, with a real `lastmod`.** The cards are the pages that can
 *    actually rank ("swahili transcription jobs"), and `lastmod` from the document's timestamp is
 *    what tells a crawler which ones are worth re-fetching. A static five-URL sitemap told Google
 *    that the whole site was one page that never changed.
 */

/**
 * Generated per request, not at build time. Next prerenders a metadata route with no dynamic API in
 * it, which would freeze the job list into the deploy — a card published an hour later would not
 * appear until the next build, and `lastmod` would claim the build date for everything. The read is
 * one bounded query behind a short in-process cache, so doing it live is cheap.
 */
export const dynamic = 'force-dynamic'

const baseUrl = absoluteUrl('').replace(/\/$/, '')

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${baseUrl}/jobs`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/sign-up`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/sign-in`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${baseUrl}/status`, lastModified: now, changeFrequency: 'daily', priority: 0.3 },
  ]

  // One crawlable URL per category, matching the filter links the board actually renders.
  const categoryRoutes: MetadataRoute.Sitemap = JOB_CATEGORY_LIST.map((category) => ({
    url: `${baseUrl}/jobs?category=${encodeURIComponent(category)}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7,
  }))

  let jobRoutes: MetadataRoute.Sitemap = []
  try {
    const { jobs } = await getPublicCatalogue()
    jobRoutes = jobs.map((job) => {
      const posted = publicPostedDate(job)
      const closing = Date.parse(job.closesAt)
      // `lastmod` should mean "the content changed", so prefer the operator's last save and fall
      // back to the posting estimate. Closed cards drop in priority: still real pages, still worth
      // a crawl, but not the ones we want competing with open work.
      const isOpen = job.status === 'open' && job.slotsRemaining > 0
      return {
        url: `${baseUrl}/jobs/${job.id}`,
        lastModified: posted ? new Date(posted) : Number.isFinite(closing) ? new Date(closing) : now,
        changeFrequency: isOpen ? ('daily' as const) : ('monthly' as const),
        priority: isOpen ? 0.8 : 0.3,
      }
    })
  } catch (err) {
    // A sitemap that 500s is worse than a short one: the static routes are always worth submitting.
    console.warn('[sitemap] job entries skipped:', err)
  }

  return [...staticRoutes, ...categoryRoutes, ...jobRoutes]
}
