import type { Metadata } from 'next'
import { JobsBoard } from '@/components/jobs-board'
import { JOB_CATEGORY_LIST, type JobCategory } from '@/lib/afterworks-data'
import { getPublicCatalogue } from '@/lib/public-catalogue'
import { isPublicCategory, openPublicJobs } from '@/lib/public-job'
import { absoluteUrl, site } from '@/lib/site'

/**
 * The public job board.
 *
 * This page is the main reason afterworks.site can be indexed at all: it is real, server-rendered
 * content about the thing people search for ("data entry jobs Kenya", "paid transcription work"),
 * readable with no session, no JavaScript and no Firebase reachability from the browser. The cards
 * come from the Admin SDK read in `lib/public-catalogue.ts`, which is why `firestore.rules` can keep
 * requiring sign-in for client reads.
 *
 * Filters are query parameters handled here on the server, so `/jobs?category=Transcription` is a
 * distinct URL with its own title, description and canonical — crawlable long-tail pages rather than
 * client-side state a bot never sees.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function readCategory(value: string | string[] | undefined): JobCategory | 'All' {
  const raw = typeof value === 'string' ? value.trim() : ''
  return isPublicCategory(raw, JOB_CATEGORY_LIST) ? (raw as JobCategory) : 'All'
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams
  const category = readCategory(params.category)
  const { jobs } = await getPublicCatalogue()
  const open = openPublicJobs(jobs)
  const inCategory = category === 'All' ? open : open.filter((job) => job.category === category)

  const title = category === 'All'
    ? `${open.length} paid microwork jobs in Kenya — transcription, data entry & labelling`
    : `${inCategory.length} paid ${category} jobs in Kenya`

  const description = category === 'All'
    ? `Browse ${open.length} open microwork cards on ${site.name}: transcription, data entry, image labelling, content review, translation and research. Fixed pay per task, ${site.clearingWindowHours}-hour clearing, payouts to M-Pesa and mobile money. Free to browse and apply.`
    : `Open ${category} microwork on ${site.name}: ${inCategory.length} cards with fixed pay, clear slot counts and mobile money payouts. Free to browse and apply — no fee to join.`

  // Every filter combination canonicalises to itself: the content genuinely differs, and pointing
  // them all at /jobs would throw away the long-tail queries they exist to answer.
  const canonical = category === 'All'
    ? '/jobs'
    : `/jobs?category=${encodeURIComponent(category)}`

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      url: absoluteUrl(canonical),
      title: `${title} · ${site.name}`,
      description,
      images: [{ url: '/brand/opengraph.png', width: 1200, height: 630, alt: `${site.name} — verified microwork` }],
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const category = readCategory(params.category)
  const showAll = params.full === '1' || (Array.isArray(params.full) && params.full.includes('1'))
  const { jobs, live } = await getPublicCatalogue()

  return (
    <JobsBoard
      initialJobs={jobs}
      live={live}
      initialCategory={category}
      initialShowAll={showAll}
    />
  )
}
