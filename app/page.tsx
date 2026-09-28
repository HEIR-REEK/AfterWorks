import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Search,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { PublicFooter, PublicHeader } from '@/components/public-shell'
import { PublicJobCard } from '@/components/public-job-card'
import { WorkspaceRedirect } from '@/components/workspace-redirect'
import { StatusBadge } from '@/components/status-badge'
import {
  JOB_CATEGORY_LIST,
  formatDuration,
  formatKes,
  formatUsd,
} from '@/lib/afterworks-data'
import { getPublicCatalogue } from '@/lib/public-catalogue'
import { openPublicJobs, publicCategoryCounts } from '@/lib/public-job'
import { SITE_FAQ, TRUST_POINTS, site } from '@/lib/site'

/**
 * The public front door — and the page a search engine can actually read.
 *
 * Before this, `/` was the signed-in dashboard: `AppGate` bounced anyone without a session to
 * `/sign-in`, so Googlebot's only view of afterworks.site was a login form. Everything on this page
 * is rendered on the server from the live catalogue, with no provider, no Firestore client SDK and no
 * JavaScript required to see it.
 *
 * Members are moved to `/dashboard` by `<WorkspaceRedirect/>` *after* this HTML is served, which is
 * the ordering that matters: the crawler never has a session, so it always gets the full page.
 */

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: BadgeCheck,
    title: 'Create a free account',
    body: 'Sign up with email or Google and confirm your address. There is no fee to join, no fee to browse and no fee to apply.',
  },
  {
    step: '02',
    icon: ShieldCheck,
    title: 'Verify your identity once',
    body: 'A government ID plus a liveness check, run by our KYC provider. The document itself never touches AfterWorks servers — we store only the outcome.',
  },
  {
    step: '03',
    icon: GraduationCap,
    title: 'Train and pass the assessment',
    body: 'Some job cards ask for a one-off paid training module. The price is shown before you pay, and it unlocks training and the assessment for that card only.',
  },
  {
    step: '04',
    icon: Banknote,
    title: 'Work, submit, get paid',
    body: `Completed work clears in ${site.clearingWindowHours} hours, then lands in your wallet. Withdraw to mobile money from ${formatUsd(site.minWithdrawalUsd)}.`,
  },
] as const

export default async function HomePage() {
  const { jobs, live } = await getPublicCatalogue()
  const open = openPublicJobs(jobs)
  const counts = publicCategoryCounts(jobs)
  const featured = open.slice(0, 6)

  const pays = open.map((job) => job.payAmountUsd).filter((value) => value > 0)
  const lowestPay = pays.length ? Math.min(...pays) : 0
  const highestPay = pays.length ? Math.max(...pays) : 0
  const totalSlots = open.reduce((sum, job) => sum + job.slotsRemaining, 0)

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: SITE_FAQ.map((entry) => ({
      '@type': 'Question',
      name: entry.q,
      acceptedAnswer: { '@type': 'Answer', text: entry.a },
    })),
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <WorkspaceRedirect />
      <PublicHeader currentPath="/" />

      <main id="main" className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="border-b border-border bg-card/40">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="size-3.5 text-primary" />
                Verified microwork for Kenya and East Africa
              </p>

              <h1 className="mt-5 text-pretty text-3xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
                {site.tagline}
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Transcription, data entry, image labelling, content review and translation — short,
                paid tasks from clients who need work they can trust. Browsing and applying are
                always free, and you are never charged to verify your identity.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/jobs"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Browse {open.length > 0 ? `${open.length} open ` : ''}jobs
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/sign-up"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-6 text-sm font-medium transition-colors hover:bg-muted"
                >
                  Create a free account
                </Link>
              </div>

              <p className="mt-5 text-xs text-muted-foreground">
                Payouts go to M-Pesa and other mobile money wallets. {site.payoutSla}
              </p>
            </div>

            {/* Live figures — real numbers from the catalogue, not marketing placeholders. */}
            <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-background p-5">
              <div className="col-span-2 rounded-xl bg-primary/5 p-4">
                <dt className="text-xs font-medium text-muted-foreground">Open job cards right now</dt>
                <dd className="mt-1 font-mono text-3xl font-semibold">{open.length}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {totalSlots} worker slots available across {Object.keys(counts).length || 0} categories
                </dd>
              </div>
              <div className="rounded-xl border border-border p-4">
                <dt className="text-xs font-medium text-muted-foreground">Pay per task</dt>
                <dd className="mt-1 font-mono text-lg font-semibold">
                  {pays.length ? `${formatUsd(lowestPay)}–${formatUsd(highestPay)}` : '—'}
                </dd>
                <dd className="mt-0.5 text-[11px] text-muted-foreground">
                  {pays.length ? `≈ ${formatKes(lowestPay)}–${formatKes(highestPay)}` : 'No open cards yet'}
                </dd>
              </div>
              <div className="rounded-xl border border-border p-4">
                <dt className="text-xs font-medium text-muted-foreground">Clearing window</dt>
                <dd className="mt-1 font-mono text-lg font-semibold">{site.clearingWindowHours}h</dd>
                <dd className="mt-0.5 text-[11px] text-muted-foreground">then mobile money in 24h</dd>
              </div>
              <div className="col-span-2 rounded-xl border border-border p-4">
                <dt className="text-xs font-medium text-muted-foreground">Fee to apply</dt>
                <dd className="mt-1 font-mono text-lg font-semibold">{site.workerFeePercent}%</dd>
                <dd className="mt-0.5 text-[11px] text-muted-foreground">
                  We never take a cut of what you earn on a completed task.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* ── Trust strip ──────────────────────────────────────────────── */}
        <section aria-label="Why workers trust AfterWorks" className="border-b border-border">
          <ul className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8 sm:grid-cols-3 sm:px-6">
            {TRUST_POINTS.map((point) => (
              <li key={point.label} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                <div>
                  <p className="text-sm font-semibold">{point.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{point.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Categories ───────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Browse by category</h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Each card is a real, funded task with a fixed price and a slot count. Pick a category
                to see what is open.
              </p>
            </div>
            <Link
              href="/jobs"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              All jobs <ArrowRight className="size-4" />
            </Link>
          </div>

          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {JOB_CATEGORY_LIST.map((category) => {
              const count = counts[category] ?? 0
              return (
                <li key={category}>
                  <Link
                    href={`/jobs?category=${encodeURIComponent(category)}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <span className="flex items-center gap-2.5 text-sm font-medium">
                      <Search className="size-4 shrink-0 text-muted-foreground" />
                      {category}
                    </span>
                    <StatusBadge tone={count > 0 ? 'success' : 'neutral'}>
                      {count > 0 ? `${count} open` : 'None open'}
                    </StatusBadge>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>

        {/* ── Featured jobs ────────────────────────────────────────────── */}
        <section className="border-y border-border bg-card/30">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Open job cards</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Pay, duration and slot counts are live from the catalogue.
                </p>
              </div>
              {!live ? (
                <StatusBadge tone="warning">Sample catalogue — this deployment is not serving live jobs yet</StatusBadge>
              ) : null}
            </div>

            {featured.length === 0 ? (
              <p className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No open cards at this moment. New work is posted regularly — create an account and
                you will see the board as soon as it fills.
              </p>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((job) => (
                  <PublicJobCard key={job.id} job={job} />
                ))}
              </div>
            )}

            <div className="mt-8 flex justify-center">
              <Link
                href="/jobs"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-5 text-sm font-medium transition-colors hover:bg-muted"
              >
                See all open jobs <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">How AfterWorks works</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Four steps between signing up and your first mobile money payout. Nothing here costs
            anything except the optional per-card training module, whose price you see before you pay.
          </p>

          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.step} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <Icon className="size-5 text-primary" />
                    <span className="font-mono text-xs text-muted-foreground">{item.step}</span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                </li>
              )
            })}
          </ol>
        </section>

        {/* ── Getting paid ─────────────────────────────────────────────── */}
        <section className="border-y border-border bg-card/30">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Getting paid</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Every completed task enters a clearing window so the client can confirm quality.
                After that the money is yours in the wallet, and a withdrawal is sent to your mobile
                money number. A failed QA never touches the balance for work you already completed —
                you get the reason in writing and a revision window instead.
              </p>
              <ul className="mt-6 flex flex-col gap-3 text-sm">
                <li className="flex items-start gap-2.5">
                  <Wallet className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground">
                    <strong className="font-medium text-foreground">{site.clearingWindowHours}-hour clearing</strong>, then
                    available balance.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Banknote className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground">
                    Withdraw from <strong className="font-medium text-foreground">{formatUsd(site.minWithdrawalUsd)}</strong>{' '}
                    (≈ {formatKes(site.minWithdrawalUsd)}) to M-Pesa and other mobile money wallets.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground">
                    Two clean revisions before a QA failure affects your quality score.
                  </span>
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-border bg-background p-6">
              <h3 className="text-sm font-semibold">What a typical card looks like</h3>
              {featured[0] ? (
                <dl className="mt-4 flex flex-col gap-3 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Job</dt>
                    <dd className="max-w-[60%] text-right font-medium">{featured[0].title}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Pay on completion</dt>
                    <dd className="font-mono font-medium">{formatUsd(featured[0].payAmountUsd)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Estimated time</dt>
                    <dd className="font-medium">{formatDuration(featured[0].estimatedMinutes)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Slots open</dt>
                    <dd className="font-medium">{featured[0].slotsRemaining}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Effective rate</dt>
                    <dd className="font-mono font-medium">
                      {featured[0].estimatedMinutes > 0
                        ? `${formatUsd((featured[0].payAmountUsd / featured[0].estimatedMinutes) * 60)}/hr`
                        : '—'}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Open a card to see its price, duration and slot count before you commit to anything.
                </p>
              )}
              <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
                Figures shown are from the live catalogue and update as the team publishes and fills
                cards.
              </p>
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Frequently asked questions</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The honest answers, including what we charge and what happens when work is rejected.
          </p>

          <dl className="mt-8 flex flex-col gap-3">
            {SITE_FAQ.map((entry) => (
              <div key={entry.q} className="rounded-xl border border-border bg-card p-5">
                <dt className="text-sm font-semibold">{entry.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{entry.a}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-6 text-sm text-muted-foreground">
            Something not covered here? Write to{' '}
            <a className="font-medium text-primary hover:underline" href={`mailto:${site.supportEmail}`}>
              {site.supportEmail}
            </a>{' '}
            — a person answers, in English or Swahili.
          </p>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────────────── */}
        <section className="border-t border-border bg-primary text-primary-foreground">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Start with the board. It costs nothing.
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-primary-foreground/80">
                Browse every open card before you create an account, then sign up when you find work
                you want. Verification takes a few minutes and pays out to your mobile money number.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary-foreground px-6 text-sm font-medium text-primary transition-colors hover:bg-primary-foreground/90"
              >
                Create free account <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/jobs"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-primary-foreground/30 px-6 text-sm font-medium transition-colors hover:bg-primary-foreground/10"
              >
                Browse jobs first
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </div>
  )
}
