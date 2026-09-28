import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { JobDetail } from '@/components/job-detail'
import { formatDuration, formatUsd, trainingFeeUsdFor } from '@/lib/afterworks-data'
import { getPublicJob } from '@/lib/public-catalogue'
import { publicPostedDate } from '@/lib/public-job'
import { absoluteUrl, site } from '@/lib/site'

/**
 * One job card as a public, indexable page.
 *
 * Every card is a real landing page for a real search: "swahili transcription jobs", "paid image
 * labelling work kenya". Before this the route was a client component with a fixed layout-level title
 * ("Job Details &amp; Requirements") for every card, behind the sign-in gate — so there was nothing
 * for a crawler to distinguish one job from another, and nothing to rank.
 *
 * Two things are emitted here rather than in the client component, because they have to be in the
 * first response: the per-card `<title>`/description/canonical, and the `JobPosting` +
 * `BreadcrumbList` JSON-LD. Google reads structured data from the served HTML; a script injected
 * after hydration may never be seen.
 *
 * The card itself is read with the Admin SDK (`lib/public-catalogue.ts`), so `firestore.rules` still
 * requires a session for client reads — publishing the board does not open the database.
 */

type Params = Promise<{ id: string }>

function clampId(raw: string): string {
  return String(raw ?? '').trim().slice(0, 80)
}

/** Plain-text description for meta tags: one line, no markup, bounded to a sane snippet length. */
function metaDescription(job: { description: string; responsibilities: string[]; category: string }): string {
  const base = job.description.replace(/\s+/g, ' ').trim()
  const firstTask = job.responsibilities[0]?.replace(/\s+/g, ' ').trim() ?? ''
  const text = firstTask && !base.toLowerCase().includes(firstTask.toLowerCase().slice(0, 40))
    ? `${base} Includes: ${firstTask}.`
    : base
  const suffix = ` ${job.category} microwork on ${site.name}, paid to mobile money.`
  const budget = 158 - suffix.length
  const body = text.length > budget ? `${text.slice(0, Math.max(0, budget - 1)).trimEnd()}…` : text
  return `${body}${suffix}`.trim()
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params
  const job = await getPublicJob(clampId(id))
  if (!job) {
    // The route answers 404 (see `notFound()` below), which is what tells a crawler the card is
    // gone — no `robots` here on purpose. Adding one made Next emit *two* conflicting meta robots
    // tags on the same document (this page's `noindex` plus the root layout's `index, follow`), and
    // a 404 does not need noindex: Google drops non-200 responses from the index by itself.
    return { title: 'Job not found' }
  }

  const url = `/jobs/${job.id}`
  const pay = `${formatUsd(job.payAmountUsd)} · ${formatDuration(job.estimatedMinutes)}`
  const title = `${job.title} (${pay})`
  const description = metaDescription(job)

  return {
    title,
    description,
    alternates: { canonical: url },
    keywords: [job.category, 'microwork Kenya', 'remote work Kenya', 'mobile money payout', site.name],
    openGraph: {
      type: 'article',
      url: absoluteUrl(url),
      title: `${job.title} · ${site.name}`,
      description,
      images: [{ url: '/brand/opengraph.png', width: 1200, height: 630, alt: `${site.name} — verified microwork` }],
      locale: 'en_KE',
    },
    twitter: { card: 'summary_large_image', title: `${job.title} · ${site.name}`, description },
  }
}

export default async function JobDetailPage({ params }: { params: Params }) {
  const { id } = await params
  const job = await getPublicJob(clampId(id))
  if (!job) notFound()

  const postedDate = publicPostedDate(job)
  const closesAt = Date.parse(job.closesAt)

  const descriptionHtml = [
    `<p>${escapeHtml(job.description)}</p>`,
    job.responsibilities.length
      ? `<h3>What you'll do</h3><ul>${job.responsibilities.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`
      : '',
    `<h3>How the work is paid</h3><p>${escapeHtml(
      `${formatUsd(job.payAmountUsd)} on completion, estimated ${formatDuration(job.estimatedMinutes)}. ` +
        `Earnings clear in ${site.clearingWindowHours} hours and are withdrawable to mobile money from ${formatUsd(site.minWithdrawalUsd)}. ` +
        (job.trainingRequired
          ? `This card requires a one-off training module of ${formatUsd(trainingFeeUsdFor(job.trainingFeeUsd))} plus a short assessment before you can apply.`
          : 'No training fee is required for this card.'),
    )}</p>`,
    `<h3>Requirements</h3><p>${escapeHtml(
      job.requiresVerified
        ? 'A free AfterWorks account, a confirmed email address and a one-time government ID verification with a liveness check.'
        : 'A free AfterWorks account and a confirmed email address.',
    )}</p>`,
  ].join('')

  /**
   * `JobPosting` per Google's required fields: title, description, datePosted, hiringOrganization
   * name, and — because this work is remote — `jobLocationType: TELECOMMUTE` together with
   * `applicantLocationRequirements`. `datePosted` is omitted rather than faked when the document
   * carries no usable timestamp: an invented date is the kind of thing that gets structured data
   * discounted. The real fix is a `postedAt` field written by the console when a card is published.
   */
  const jobPosting = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    headline: job.title.slice(0, 100),
    title: job.title,
    description: descriptionHtml,
    ...(postedDate ? { datePosted: postedDate } : {}),
    ...(Number.isFinite(closesAt) ? { validThrough: new Date(closesAt).toISOString() } : {}),
    employmentType: ['CONTRACT', 'PART_TIME'],
    jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: site.areaServed.map((country) => ({ '@type': 'Country', name: country })),
    hiringOrganization: {
      '@type': 'Organization',
      name: site.name,
      legalName: site.legalName,
      url: absoluteUrl('/'),
      sameAs: [site.twitter, site.linkedin],
    },
    baseSalary: {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: { '@type': 'QuantitativeValue', value: job.payAmountUsd, unitText: 'JOB' },
    },
    industry: 'Information Services',
    occupationalCategory: job.category,
    responsibilities: job.responsibilities.join(', '),
    qualifications: job.requiresVerified
      ? 'Government ID verification with a liveness check; confirmed email address.'
      : 'Confirmed email address.',
    url: absoluteUrl(`/jobs/${job.id}`),
  }

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
      { '@type': 'ListItem', position: 2, name: 'Jobs', item: absoluteUrl('/jobs') },
      { '@type': 'ListItem', position: 3, name: job.title, item: absoluteUrl(`/jobs/${job.id}`) },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPosting) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      <JobDetail publicJob={job} />
    </>
  )
}

/** Structured data is HTML, so the authored copy has to be escaped on the way in. */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
