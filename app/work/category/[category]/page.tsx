import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
import { PublicJobCard } from '@/components/public-job-card'
import { PublicPage } from '@/components/public-shell'
import { listPublicJobs } from '@/lib/public-jobs-server'
import { PUBLIC_JOB_CATEGORIES, publicCategory, publicCategoryPath } from '@/lib/public-jobs'
import { site } from '@/lib/site'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ category: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params
  const category = publicCategory(slug)
  if (!category) notFound()
  return {
    title: category.title,
    description: category.description,
    alternates: { canonical: publicCategoryPath(category.slug) },
    openGraph: {
      type: 'website',
      siteName: site.name,
      title: `${category.title} · ${site.name}`,
      description: category.description,
      url: publicCategoryPath(category.slug),
      images: [{ url: '/brand/opengraph.png', width: 1200, height: 630, alt: category.title }],
    },
  }
}

export default async function WorkCategoryPage({ params }: Props) {
  const { category: slug } = await params
  const category = publicCategory(slug)
  if (!category) notFound()

  const jobs = (await listPublicJobs()).filter((job) => job.category === category.category)
  const related = PUBLIC_JOB_CATEGORIES.filter((entry) => entry.slug !== category.slug).slice(0, 3)

  return (
    <PublicPage>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <Link href="/work" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All open work
        </Link>

        <header className="mt-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{category.category}</p>
          <h1 className="mt-3 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">{category.title}</h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{category.description}</p>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex flex-col gap-8">
            <section aria-labelledby="open-cards">
              <div className="flex items-end justify-between gap-3">
                <h2 id="open-cards" className="text-xl font-semibold">Open {category.category.toLowerCase()} cards</h2>
                <span className="text-xs text-muted-foreground">{jobs.length} open</span>
              </div>
              {jobs.length > 0 ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {jobs.map((job) => <PublicJobCard key={job.id} job={job} />)}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No {category.category.toLowerCase()} cards are open right now. New cards are added as briefs arrive.
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="about-category">
              <h2 id="about-category" className="text-xl font-semibold">What this work involves</h2>
              <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                {category.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              <h3 className="mt-6 text-sm font-semibold">Useful skills</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {category.skills.map((skill) => (
                  <li key={skill} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> {skill}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5">
              <h2 className="text-sm font-semibold">Ready to apply?</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Create an account, complete your profile and verify your identity once. You can then
                take the assessment for any card you choose.
              </p>
              <Link href="/sign-up" className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Create an account <ArrowRight className="size-4" />
              </Link>
              <Link href="/sign-in" className="mt-2 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
                I already have an account
              </Link>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Other categories</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {related.map((entry) => (
                  <li key={entry.slug}>
                    <Link href={publicCategoryPath(entry.slug)} className="text-muted-foreground hover:text-primary">{entry.category}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </PublicPage>
  )
}
