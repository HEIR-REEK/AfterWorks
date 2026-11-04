import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  GraduationCap,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { PublicPage } from '@/components/public-shell'
import { getPublicJob, listPublicJobs } from '@/lib/public-jobs-server'
import { jsonLd, publicCategoryFor, publicCategoryPath, publicJobPath, type PublicJob } from '@/lib/public-jobs'
import { formatDuration, formatUsd, formatTrainingFeeLabel } from '@/lib/afterworks-data'
import { site } from '@/lib/site'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

function closingDate(value: string): string {
  if (!value) return 'Open until filled'
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return 'Open until filled'
  return new Date(date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const job = await getPublicJob(id)
  if (!job) notFound()
  const description = job.description || `${job.title} — a paid ${job.category.toLowerCase()} task on AfterWorks.`
  return {
    title: job.title,
    description: description.slice(0, 300),
    alternates: { canonical: publicJobPath(job.id) },
    openGraph: {
      type: 'website',
      siteName: site.name,
      title: `${job.title} · ${site.name}`,
      description: description.slice(0, 300),
      url: publicJobPath(job.id),
      images: [{ url: '/brand/opengraph.png', width: 1200, height: 630, alt: job.title }],
    },
    robots: { index: true, follow: true },
  }
}

function jobJsonLd(job: PublicJob) {
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description,
    identifier: { '@type': 'PropertyValue', name: 'AfterWorks', value: job.id },
    url: `${site.url}${publicJobPath(job.id)}`,
    ...(job.postedAt ? { datePosted: job.postedAt } : {}),
    ...(job.closesAt ? { validThrough: job.closesAt } : {}),
    employmentType: 'CONTRACTOR',
    hiringOrganization: {
      '@type': 'Organization',
      name: site.name,
      sameAs: site.url,
      logo: `${site.url}/brand/icon-512.png`,
    },
    jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: { '@type': 'Country', name: 'Kenya' },
    ...(job.responsibilities.length > 0 ? { responsibilities: job.responsibilities.join('\n') } : {}),
    directApply: false,
  }
}

export default async function PublicJobPage({ params }: Props) {
  const { id } = await params
  const job = await getPublicJob(id)
  if (!job) notFound()

  const category = publicCategoryFor(job.category)
  const related = (await listPublicJobs())
    .filter((entry) => entry.category === job.category && entry.id !== job.id)
    .slice(0, 3)
  const trainingFee = formatTrainingFeeLabel(job.trainingFeeUsd)
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'AfterWorks', item: site.url },
      { '@type': 'ListItem', position: 2, name: 'Open work', item: `${site.url}/work` },
      { '@type': 'ListItem', position: 3, name: job.title, item: `${site.url}${publicJobPath(job.id)}` },
    ],
  }

  return (
    <PublicPage>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/work" className="hover:text-foreground">Open work</Link>
          <span aria-hidden>/</span>
          <Link href={publicCategoryPath(category.slug)} className="hover:text-foreground">{job.category}</Link>
          <span aria-hidden>/</span>
          <span className="truncate text-foreground">{job.title}</span>
        </nav>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <article className="flex flex-col gap-5">
            <header className="rounded-2xl border border-border bg-card p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium">{job.category}</span>
                {job.slotsRemaining <= 3 ? (
                  <span className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning-foreground">{job.slotsRemaining} slots left</span>
                ) : (
                  <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">{job.slotsRemaining} slots open</span>
                )}
                {job.requiresVerified && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="size-3.5 text-success" /> KYC required</span>
                )}
              </div>
              <h1 className="mt-4 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">{job.title}</h1>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{job.description}</p>

              {job.responsibilities.length > 0 && (
                <>
                  <h2 className="mt-7 text-base font-semibold">What you&apos;ll do</h2>
                  <ul className="mt-3 flex flex-col gap-2">
                    {job.responsibilities.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> {item}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </header>

            <section className="rounded-2xl border border-border bg-card p-5 sm:p-7" aria-labelledby="requirements">
              <h2 id="requirements" className="text-base font-semibold">Requirements and application flow</h2>
              <ol className="mt-4 flex flex-col gap-4 text-sm">
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">1</span>
                  <div><p className="font-medium">Create an account and complete your profile</p><p className="mt-1 text-muted-foreground">Name, phone, location and a short summary. This is also where you can claim the welcome reward.</p></div>
                </li>
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">2</span>
                  <div><p className="font-medium">Request identity verification</p><p className="mt-1 text-muted-foreground">Ask from your profile and our team reviews it. Once approved it applies everywhere on the platform.</p></div>
                </li>
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">3</span>
                  <div>
                    <p className="font-medium">{job.trainingRequired ? 'Complete the full training course for this card' : 'No training course — this card is assessment-only'}</p>
                    <p className="mt-1 text-muted-foreground">
                      {job.trainingRequired
                        ? `The one-off training fee is ${trainingFee}. The course and assessment unlock after the required identity check is approved.`
                        : 'This card has no training, so there is nothing to pay. The assessment unlocks once your identity check is approved.'}
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">4</span>
                  <div><p className="font-medium">Pass the job assessment</p><p className="mt-1 text-muted-foreground">The applied assessment is scored on the server and you need 80% to pass. A pass is required before you can apply for this card.</p></div>
                </li>
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">5</span>
                  <div><p className="font-medium">Apply, do approved work and submit</p><p className="mt-1 text-muted-foreground">The client brief is released after approval. Completed work enters the quality review and clearing window before it becomes withdrawable.</p></div>
                </li>
              </ol>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 sm:p-7" aria-labelledby="category-guide">
              <h2 id="category-guide" className="text-base font-semibold">About {job.category.toLowerCase()} work</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{category.summary}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{category.paragraphs[0]}</p>
              <Link href={publicCategoryPath(category.slug)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                Read the {job.category} guide <ArrowRight className="size-4" />
              </Link>
            </section>
          </article>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:h-fit">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pay on completion</p>
              <p className="mt-1 font-mono text-3xl font-semibold">{formatUsd(job.payAmountUsd)}</p>
              <dl className="mt-5 flex flex-col gap-3 text-sm">
                <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-muted-foreground"><Clock className="size-4" /> Estimated time</dt><dd className="font-medium">{formatDuration(job.estimatedMinutes)}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-muted-foreground"><Users className="size-4" /> Slots</dt><dd className="font-medium">{job.slotsRemaining} of {job.capacity} open</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Closes</dt><dd className="font-medium">{closingDate(job.closesAt)}</dd></div>
                {job.trainingRequired && (
                  <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-muted-foreground"><GraduationCap className="size-4" /> Training</dt><dd className="font-medium">{trainingFee}</dd></div>
                )}
              </dl>
              <Link href="/sign-up" className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Create an account to apply <ArrowRight className="size-4" />
              </Link>
              <Link href="/sign-in" className="mt-2 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
                I already have an account
              </Link>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">Applying is free. Payment is made after the work is reviewed and cleared.</p>
            </div>

            {related.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold">More {job.category.toLowerCase()} cards</h2>
                <ul className="mt-3 space-y-3">
                  {related.map((entry) => (
                    <li key={entry.id}>
                      <Link href={publicJobPath(entry.id)} className="text-sm font-medium hover:text-primary">{entry.title}</Link>
                      <p className="text-xs text-muted-foreground">{formatUsd(entry.payAmountUsd)} · {formatDuration(entry.estimatedMinutes)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link href="/work" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> Back to all open work
            </Link>
          </aside>
        </div>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(jobJsonLd(job)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumb) }} />
    </PublicPage>
  )
}
