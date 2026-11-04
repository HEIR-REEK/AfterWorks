import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileAudio,
  Fingerprint,
  Gift,
  GraduationCap,
  Image as ImageIcon,
  Languages,
  Lock,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  Table,
  Users,
  Wallet,
} from 'lucide-react'
import { LandingHeader } from '@/components/landing-header'
import { TrainingPushSection } from '@/components/training-push'
import { BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { formatUsd } from '@/lib/afterworks-data'
import { WELCOME_BONUS_USD } from '@/lib/profile-completion'
import { REFERRAL_BONUS_LABEL } from '@/lib/referrals'
import { SITE_FAQ, site } from '@/lib/site'

/**
 * `/` — the public landing page for afterworks.site.
 *
 * Until now `/` was the signed-in dashboard, so the first thing a stranger at the domain name saw
 * was a redirect to a login form. The dashboard now lives at `/dashboard` (`app/dashboard/page.tsx`)
 * and this page is on the public allow-list (`lib/public-routes.ts`), which means it renders with no
 * session and even on a deployment with no Firebase config.
 *
 * Design rules that this page deliberately follows:
 *  • Server-rendered copy. A landing page is the one page that must be readable by a crawler and
 *    by a slow phone on a weak connection; only the header reads auth state.
 *  • Every claim is read from the same module the app uses (`lib/site.ts`,
 *    `lib/profile-completion.ts`, `lib/referrals.ts`) so marketing copy cannot quote a payout
 *    window or a welcome bonus the product does not honour. The numbers in the workspace previews
 *    are labelled illustrations, not live data.
 *  • The two doors are never more than one click away: header, hero and closing section all point
 *    at the existing `/sign-in` and `/sign-up` pages.
 */

export const metadata: Metadata = {
  title: {
    absolute: `${site.name} — Verified microwork, done on your schedule`,
  },
  description:
    'AfterWorks connects verified workers with short, paid data tasks — transcription, labelling, data entry, review and research. Build your profile, verify once, and take work that fits your day.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: `${site.name} — Verified microwork, done on your schedule`,
    description: site.description,
    url: '/',
    images: [
      {
        url: '/brand/opengraph.png',
        width: 1200,
        height: 630,
        alt: `${site.name} — verified microwork`,
      },
    ],
  },
}

type Faq = { q: string; a: string }

const FAQS: Faq[] = [
  { q: SITE_FAQ[0].q, a: SITE_FAQ[0].a },
  {
    q: 'Do I have to pay for the training?',
    a: `Only for the jobs that require it. Those cards show their one-off training fee before checkout — the standard fee is ${formatUsd(
      site.trainingFeeUsd,
    )}, though a job can set its own. You can pay it before identity verification, but that job's training material and assessment unlock only after your ID check is approved. Applying, verifying your identity and requesting a payout do not carry a platform charge.`,
  },
  { q: SITE_FAQ[1].q, a: SITE_FAQ[1].a },
  { q: SITE_FAQ[2].q, a: SITE_FAQ[2].a },
  {
    q: 'Who can join AfterWorks?',
    a: 'Anyone with an email address, a phone number and a valid government ID for verification. Job availability varies by category and client demand.',
  },
  { q: SITE_FAQ[3].q, a: SITE_FAQ[3].a },
  { q: SITE_FAQ[4].q, a: SITE_FAQ[4].a },
]

const STEPS = [
  {
    icon: Sparkles,
    title: 'Create your account',
    body: 'Sign up with email or Google and confirm your address. It takes a couple of minutes and costs nothing.',
  },
  {
    icon: Users,
    title: 'Complete your profile',
    body: `Add your name, phone, location and a short summary. A complete profile unlocks your ${formatUsd(
      WELCOME_BONUS_USD,
    )} welcome bonus.`,
  },
  {
    icon: Fingerprint,
    title: 'Verify your identity',
    body: 'A one-time government-ID and liveness check through our verification partner. We keep the result, not your document. You can pay a job card’s training fee before this check, but training and its assessment open only once it is approved.',
  },
  {
    icon: Briefcase,
    title: 'Take a job',
    body: 'Filter the board by category and pay. Some specialist briefs ask for a short paid training module first; that price is always shown before you pay.',
  },
  {
    icon: Wallet,
    title: 'Submit and get paid',
    body: `Follow the brief and submit before the deadline. Completed work clears a ${site.clearingWindowHours}-hour quality window, then you can withdraw your cleared balance.`,
  },
] as const

const CATEGORIES = [
  {
    icon: FileAudio,
    title: 'Transcription',
    body: 'Turn interviews, calls and field recordings into clean, readable text — with a style sheet and word-count guide.',
    examples: 'Interviews · calls · podcasts',
  },
  {
    icon: Table,
    title: 'Data Entry',
    body: 'Move records from documents, PDFs and images into a structured sheet with a schema you can follow.',
    examples: 'Catalogues · registers · invoices',
  },
  {
    icon: ImageIcon,
    title: 'Image Labeling',
    body: 'Tag, sort and classify photos against a short guide. Most cards need no specialist knowledge.',
    examples: 'Products · signs · scenes',
  },
  {
    icon: MessageSquare,
    title: 'Content Review',
    body: 'Moderate comments and submissions against a rubric, recording a reason for every decision you make.',
    examples: 'Comments · listings · captions',
  },
  {
    icon: Languages,
    title: 'Translation',
    body: 'Work between English and Swahili or other local languages, with a glossary and reference translations.',
    examples: 'Product copy · UI strings · contracts',
  },
  {
    icon: Search,
    title: 'Research',
    body: 'Find and verify business details, prices or listings from public sources, citing a source for every field.',
    examples: 'Contact checks · price checks · listings',
  },
] as const

const WORK_PHOTOS = [
  {
    src: '/photos/worker-at-desktop.jpg',
    width: 1400,
    height: 1050,
    alt: 'A man working at a desktop monitor with a laptop open in front of him',
  },
  {
    src: '/photos/worker-at-laptop.jpg',
    width: 1000,
    height: 750,
    alt: 'A smiling man working on a laptop at a wooden table',
  },
  {
    src: '/photos/team-at-laptop.jpg',
    width: 1400,
    height: 1050,
    alt: 'Two women collaborating over a laptop in a shared workspace',
  },
] as const

const TRUST = [
  {
    icon: ShieldCheck,
    title: 'Support you can reach',
    body: `Task, payout or verification questions go to a real inbox at ${site.supportEmail}. It is monitored by the team that runs the board.`,
  },
  {
    icon: Fingerprint,
    title: 'Identity, checked once',
    body: 'A government ID and liveness check through our verification partner. The document is not stored on AfterWorks servers — the outcome is.',
  },
  {
    icon: CheckCircle2,
    title: 'QA you can respond to',
    body: 'If a submission misses the brief you get the reason in writing and a revision window before it can affect your quality score.',
  },
  {
    icon: Users,
    title: 'One person, one account',
    body: 'Email and phone uniqueness plus identity checks keep duplicate accounts and referral farming off the board.',
  },
] as const

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{children}</p>
  )
}

export default function LandingPage() {
  const year = new Date().getFullYear()
  // The preview balances track the configured withdrawal minimum, so a deployment that raises the
  // minimum never shows a mock wallet that could not exist.
  const previewBalance = formatUsd(site.minWithdrawalUsd + 4)
  const previewWithdrawal = formatUsd(site.minWithdrawalUsd)

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }

  return (
    <div className="landing-backdrop flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <LandingHeader />

      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative isolate overflow-hidden border-b border-border">
          {/* A transparent layer of the desk photograph, faded out under the headline. The original
              light hero, grid pattern and dashboard layout stay exactly as they were; the photograph
              is only a ghosted backdrop on the right, not a dark panel. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <Image
              src="/photos/worker-at-desktop.jpg"
              alt=""
              fill
              priority
              unoptimized
              sizes="100vw"
              className="object-cover object-[68%_45%] opacity-20 [mask-image:linear-gradient(to_left,transparent_4%,black_72%)]"
            />
            <div className="absolute -top-32 right-[-12%] size-[30rem] rounded-full bg-primary/10 blur-3xl" />
            <div className="absolute -bottom-40 left-[-14%] size-[26rem] rounded-full bg-success/10 blur-3xl" />
            <div className="absolute inset-0 bg-grid-pattern opacity-[0.45] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
          </div>

          <div className="mx-auto grid grid-cols-1 w-full max-w-6xl gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
            <div>
              <h1 className="text-pretty text-4xl font-semibold leading-[1.06] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                Do real work.
                <span className="mt-1 block text-primary">
                  Get{' '}
                  <span className="relative inline-block">
                    paid
                    <svg
                      aria-hidden
                      viewBox="0 0 180 12"
                      preserveAspectRatio="none"
                      className="absolute -bottom-1.5 left-0 h-2.5 w-full text-primary/35"
                    >
                      <path
                        d="M2 8c36-6 90-7 176-3"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>{' '}
                  for it.
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                AfterWorks is a microwork platform for short, paid data tasks — transcription,
                labelling, data entry and review. Browse the board, verify once, and track every
                payment in a wallet that shows its working.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  render={<Link href="/sign-up" />}
                  size="lg"
                  className="h-11 gap-2 px-5 text-sm shadow-sm shadow-primary/20"
                >
                  Create an account
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  render={<Link href="/work" />}
                  size="lg"
                  variant="outline"
                  className="h-11 bg-card px-5 text-sm"
                >
                  Browse open work
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              </div>

              <Link
                href="#training"
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning-foreground transition-colors hover:bg-warning/20"
              >
                <GraduationCap className="size-3.5" aria-hidden />
                Get trained for higher-paying jobs
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>

              <p className="mt-3 text-xs text-muted-foreground">
                Fixed fees · No bidding · Reviewed work
              </p>

              <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5 text-xs font-medium text-muted-foreground">
                {[
                  'ID-verified work',
                  `${site.clearingWindowHours}h quality clearing`,
                  'Payouts you can trace',
                ].map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Workspace preview — built in markup rather than a screenshot so it stays sharp,
                themeable and weightless. The caption below says it is an illustration. */}
            <div className="relative mx-auto w-full max-w-md lg:max-w-none">
              <div
                aria-hidden
                className="absolute -inset-3 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/15 via-transparent to-success/15 blur-2xl"
              />
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10">
                <div className="flex items-center gap-2 border-b border-border bg-secondary/60 px-4 py-2.5">
                  <span className="size-2.5 rounded-full bg-destructive/40" aria-hidden />
                  <span className="size-2.5 rounded-full bg-warning/50" aria-hidden />
                  <span className="size-2.5 rounded-full bg-success/50" aria-hidden />
                  <span className="ml-2 truncate rounded-md bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    afterworks.site/dashboard
                  </span>
                  <Lock className="ml-auto size-3 shrink-0 text-muted-foreground" aria-hidden />
                </div>

                <div className="space-y-3 p-4 sm:p-5">
                  <div className="rounded-xl bg-primary p-4 text-primary-foreground">
                    <div className="flex items-center justify-between gap-3 text-[11px] text-primary-foreground/80">
                      <span>Withdrawable balance</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-foreground/15 px-2 py-0.5 font-medium text-primary-foreground">
                        <ShieldCheck className="size-3" aria-hidden />
                        Verified
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-end justify-between gap-3">
                      <p className="font-mono text-3xl font-semibold tracking-tight">{previewBalance}</p>
                      <span className="pb-1 text-[11px] text-primary-foreground/80">
                        minimum ${site.minWithdrawalUsd}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary-foreground px-2.5 py-1.5 text-[11px] font-semibold text-primary">
                        <Banknote className="size-3.5" aria-hidden />
                        Withdraw funds
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary-foreground/30 px-2.5 py-1.5 text-[11px] font-medium">
                        History
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Transcription
                      </span>
                      <span className="font-mono text-lg font-semibold text-foreground">$18.00</span>
                    </div>
                    <p className="mt-2.5 text-sm font-medium leading-snug">
                      Transcribe a 9-minute research call
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="size-3" aria-hidden />
                        25 min
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" aria-hidden />
                        40 slots
                      </span>
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="size-3" aria-hidden />
                        Open
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success/12 text-success">
                      <CheckCircle2 className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">Withdrawal sent</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        Ref QK72X8 · target 24h
                      </p>
                    </div>
                    <span className="ml-auto font-mono text-xs font-semibold text-foreground">−{previewWithdrawal}</span>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                Illustrative preview of the worker workspace.
              </p>
            </div>
          </div>
        </section>

        {/* ── Facts strip ──────────────────────────────────────────────────── */}
        <section aria-label="AfterWorks at a glance" className="border-b border-border bg-card/40">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-border px-0 sm:grid-cols-4">
            {[
              {
                value: `${site.workerFeePercent}%`,
                label: 'Platform fee on earnings',
                note: "The fee on the card is what you're paid.",
              },
              {
                value: `${site.clearingWindowHours}h`,
                label: 'Quality clearing window',
                note: 'Client review before earnings unlock.',
              },
              {
                value: '24h',
                label: 'Payout target',
                note: 'After cleared work.',
              },
              {
                value: formatUsd(WELCOME_BONUS_USD),
                label: 'Welcome bonus',
                note: 'Credited once your profile is complete.',
              },
            ].map((fact) => (
              <div key={fact.label} className="flex flex-col bg-background px-5 py-6 sm:px-6">
                <dt className="order-2 mt-1 text-xs font-semibold text-foreground">{fact.label}</dt>
                <dd className="order-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
                  {fact.value}
                </dd>
                <p className="order-3 mt-1 text-[11px] leading-relaxed text-muted-foreground">{fact.note}</p>
              </div>
            ))}
          </dl>
        </section>

        {/* ── What it is ───────────────────────────────────────────────────── */}
        <section id="what" className="scroll-mt-24 border-b border-border py-16 sm:py-24">
          <div className="mx-auto grid grid-cols-1 w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Eyebrow>What AfterWorks is</Eyebrow>
              <h2 className="mt-4 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
                A microwork platform with the rules written down.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                Companies post a defined task with a fixed fee. Verified workers complete it, a
                reviewer checks it against the brief, and the payment moves into a wallet you can
                see. No bidding, no unpaid trials.
              </p>
              <a
                href="#how-it-works"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                See the five steps
                <ArrowRight className="size-4" aria-hidden />
              </a>
            </div>

            <div className="grid gap-4">
              {[
                {
                  icon: BadgeCheck,
                  title: 'Fixed pay, shown up front',
                  body: 'Every card states the fee, the time estimate and the slots before you apply. There is nothing to negotiate and nothing deducted from the quoted amount.',
                },
                {
                  icon: Fingerprint,
                  title: 'One account, one identity',
                  body: 'Email confirmation and a government-ID check keep duplicate accounts off the board, so the person who did the work is the person who gets paid.',
                },
                {
                  icon: Wallet,
                  title: 'A wallet that shows its working',
                  body: 'Earnings, holds and withdrawals are each timestamped. You always know which part of your balance is available.',
                },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.title}
                    className="flex gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30 sm:p-6"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground sm:text-base">{item.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section id="how-it-works" className="scroll-mt-24 border-b border-border bg-card/40 py-16 sm:py-24">
          <div className="mx-auto grid grid-cols-1 w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="mt-4 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
                From sign-up to a payout, in five steps.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                Most of the setup happens once. After that, every job is the same shape: read the
                brief, do the work, submit it, get paid.
              </p>
              <div className="mt-6 rounded-2xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What you can expect
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Applications get an answer within{' '}
                  <span className="font-semibold text-foreground">{site.reviewSlaHours} hours</span>, and
                  every decision comes with a reason.
                </p>
              </div>
              <Button
                render={<Link href="/sign-up" />}
                size="lg"
                variant="outline"
                className="mt-6 h-10 gap-1.5 bg-card px-4 text-sm"
              >
                Start your account
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>

            <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {STEPS.map((step, index) => {
                const Icon = step.icon
                return (
                  <li key={step.title} className="flex gap-4 p-5 sm:gap-5 sm:p-6">
                    <div className="flex flex-col items-center gap-2">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <h3 className="text-sm font-semibold text-foreground sm:text-base">{step.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>

        {/* ── Real life / photography ──────────────────────────────────────── */}
        <section id="work-life" className="scroll-mt-24 border-b border-border bg-primary/[0.04] py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <Eyebrow>Real work, real schedules</Eyebrow>
                <h2 className="mt-4 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
                  Built around the hours you actually have.
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                  Tasks have deadlines, not office hours. Some members work an hour before a shift;
                  others work late at night. A laptop or phone, a connection and enough time to do the
                  brief properly is all a task asks for.
                </p>
              </div>
              <a
                href="#work"
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                See the task types
                <ArrowRight className="size-4" aria-hidden />
              </a>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {WORK_PHOTOS.map((photo) => (
                <figure
                  key={photo.src}
                  className="group overflow-hidden rounded-2xl border border-border bg-secondary"
                >
                  <div className="aspect-[4/3] overflow-hidden">
                    {/* `unoptimized` matches the rest of the repo: production has no sharp, so
                        /_next/image is unavailable. These files are pre-cropped and compressed. */}
                    <Image
                      src={photo.src}
                      alt={photo.alt}
                      width={photo.width}
                      height={photo.height}
                      unoptimized
                      loading="lazy"
                      sizes="(min-width: 640px) 33vw, 100vw"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  </div>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* ── The work ─────────────────────────────────────────────────────── */}
        <section id="work" className="scroll-mt-24 border-b border-border py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <Eyebrow>The work</Eyebrow>
              <h2 className="mt-4 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
                Six kinds of task. All of them paid.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                Every card tells you what to do, what it pays and how long it should take before you
                commit. Pick what you are good at; skip what you are not.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CATEGORIES.map((category) => {
                const Icon = category.icon
                return (
                  <div
                    key={category.title}
                    className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30"
                  >
                    <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="mt-4 text-base font-semibold text-foreground">{category.title}</h3>
                    <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{category.body}</p>
                    <p className="mt-4 border-t border-border pt-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                      {category.examples}
                    </p>
                  </div>
                )
              })}
            </div>

            <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-secondary/40 p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  Applying carries no platform charge. The only paid step is a job-specific training
                  module where one is required — and its price is on the card before you commit.
                </span>
              </p>
              <a
                href="#faq"
                className="shrink-0 text-sm font-medium text-primary hover:underline"
              >
                Read the FAQ
              </a>
            </div>
          </div>
        </section>

        {/* ── Training → higher pay ─────────────────────────────────────────── */}
        <TrainingPushSection />

        {/* ── Payouts ──────────────────────────────────────────────────────── */}
        <section id="payouts" className="scroll-mt-24 border-b border-border bg-card/40 py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="overflow-hidden rounded-3xl border border-border bg-background shadow-sm">
              <div className="grid grid-cols-1 gap-10 p-6 sm:p-10 lg:grid-cols-2 lg:gap-14 lg:p-12">
                <div>
                  <Eyebrow>Payouts</Eyebrow>
                  <h2 className="mt-4 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
                    Your earnings, in a wallet — not a spreadsheet.
                  </h2>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                    AfterWorks holds your balance and shows every movement. Withdraw when you are
                    ready; every request is tracked from the moment you make it.
                  </p>

                  <ul className="mt-8 space-y-5">
                    {[
                      {
                        title: 'Clearing is visible',
                        body: `New earnings sit in a ${site.clearingWindowHours}-hour quality window before they become withdrawable. Both balances are always on screen.`,
                      },
                      {
                        title: `Withdraw from $${site.minWithdrawalUsd}`,
                        body: 'Request a payout once your available balance reaches the minimum; the amount you request is the amount sent.',
                      },
                      {
                        title: 'The quoted fee is the whole fee',
                        body: 'Nothing is deducted from a completed task — the amount on the card is what lands in your wallet.',
                      },
                      {
                        title: 'Paid in your own name',
                        body: 'Withdrawals go only to payout details in your own name, so a payout cannot be diverted to somebody else.',
                      },
                    ].map((item) => (
                      <li key={item.title} className="flex gap-3">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success/12 text-success">
                          <CheckCircle2 className="size-3.5" aria-hidden />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{item.title}</p>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col justify-center">
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
                    <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Wallet activity</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">Latest activity</p>
                      </div>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Preview
                      </span>
                    </div>

                    <ul className="divide-y divide-border">
                      {[
                        {
                          title: 'Audio transcription',
                          meta: 'Today · 14:32',
                          amount: '+$18.00',
                          status: 'Cleared',
                          tone: 'success' as const,
                        },
                        {
                          title: 'Image labelling',
                          meta: 'Yesterday · 18:05',
                          amount: '+$22.00',
                          status: 'Clearing',
                          tone: 'warning' as const,
                        },
                        {
                          title: 'Referral bonus',
                          meta: 'Mon · 09:12',
                          amount: '+$3.00',
                          status: 'Cleared',
                          tone: 'success' as const,
                        },
                      ].map((row) => (
                        <li key={row.title} className="flex items-center gap-3 py-3.5">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
                            <Wallet className="size-4" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-foreground">{row.title}</p>
                            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{row.meta}</p>
                          </div>
                          <div className="ml-auto text-right">
                            <p className="font-mono text-xs font-semibold text-foreground">{row.amount}</p>
                            <p
                              className={
                                row.tone === 'success'
                                  ? 'text-[10px] font-medium text-success'
                                  : 'text-[10px] font-medium text-warning-foreground'
                              }
                            >
                              {row.status}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-2 flex items-end justify-between gap-3 rounded-xl bg-primary/[0.06] px-4 py-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Available now
                        </p>
                        <p className="font-mono text-xl font-semibold text-foreground">$21.00</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Clearing
                        </p>
                        <p className="font-mono text-sm font-semibold text-muted-foreground">$22.00</p>
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-center text-[11px] text-muted-foreground">
                    Illustrative wallet history — yours only ever shows your own work.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Trust + referrals ────────────────────────────────────────────── */}
        <section id="trust" className="scroll-mt-24 border-b border-border py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <Eyebrow>Trust &amp; safety</Eyebrow>
              <h2 className="mt-4 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
                Built so the money is never the uncertain part.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                Verification, quality review and payouts are operational processes here, not promises
                in a footer. When part of the platform is paused for maintenance, you are told what
                changed and when it comes back.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {TRUST.map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.title} className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <span className="grid size-10 place-items-center rounded-xl bg-success/10 text-success">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="mt-4 text-base font-semibold text-foreground">{item.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                  </div>
                )
              })}
            </div>

            <div className="mt-6 flex flex-col gap-5 rounded-2xl border border-primary/20 bg-primary/[0.04] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
              <div className="flex gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Gift className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    Earn {REFERRAL_BONUS_LABEL} for every qualified referral
                  </h3>
                  <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    When someone you invite creates an account and completes their profile, the bonus
                    lands in your balance. No cap. The full rules live in the{' '}
                    <Link href="/terms#referrals" className="font-medium text-primary hover:underline">
                      Terms
                    </Link>
                    .
                  </p>
                </div>
              </div>
              <Button
                render={<Link href="/sign-up" />}
                size="lg"
                variant="outline"
                className="h-10 shrink-0 gap-1.5 bg-card px-4 text-sm"
              >
                Get your referral code
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        <section id="faq" className="scroll-mt-24 border-b border-border bg-card/40 py-16 sm:py-24">
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
            <div className="text-center">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                Questions
              </p>
              <h2 className="mt-4 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
                The things people ask before signing up.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                Straight answers, including the costs. If yours is not here,{' '}
                <a href={`mailto:${site.supportEmail}`} className="font-medium text-primary hover:underline">
                  email {site.supportEmail}
                </a>
                .
              </p>
            </div>

            <div className="mt-10 rounded-2xl border border-border bg-background px-5 sm:px-6">
              {FAQS.map((item) => (
                <details key={item.q} className="group border-b border-border py-4 last:border-b-0">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden sm:text-base">
                    {item.q}
                    <ChevronDown
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <p className="mt-2.5 pr-6 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────────────────── */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="relative isolate overflow-hidden rounded-3xl bg-primary px-6 py-12 text-center text-primary-foreground sm:px-12 sm:py-16">
              <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
                <div className="absolute -right-16 -top-24 size-72 rounded-full bg-primary-foreground/10 blur-2xl" />
                <div className="absolute -bottom-28 -left-10 size-72 rounded-full bg-primary-foreground/10 blur-2xl" />
                <div className="absolute inset-0 bg-grid-pattern opacity-10" />
              </div>

              <h2 className="mx-auto max-w-2xl text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
                Your first paid task is a few minutes away.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-primary-foreground/80 sm:text-base">
                Create an account, complete your profile and start browsing verified work. Every task
                shows its fee before you accept it.
              </p>

              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:items-center">
                <Button
                  render={<Link href="/sign-up" />}
                  size="lg"
                  className="h-11 gap-2 bg-primary-foreground px-5 text-sm text-primary hover:bg-primary-foreground/90"
                >
                  Create an account
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
                <Button
                  render={<Link href="/sign-in" />}
                  size="lg"
                  variant="outline"
                  className="h-11 border-primary-foreground/40 bg-transparent px-5 text-sm text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                >
                  Log in to your account
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-card/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-14">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5">
                <BrandMark size={36} />
                <span className="text-base font-semibold tracking-tight">AfterWorks</span>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
                A microwork platform for verified workers, with a wallet that shows every movement.
              </p>
              <p className="mt-4 text-xs text-muted-foreground">
                Support:{' '}
                <a href={`mailto:${site.supportEmail}`} className="font-medium text-foreground hover:text-primary">
                  {site.supportEmail}
                </a>
              </p>
            </div>

            <nav aria-label="Product">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Product</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="#how-it-works" className="transition-colors hover:text-foreground">
                    How it works
                  </a>
                </li>
                <li>
                  <Link href="/work" className="transition-colors hover:text-foreground">
                    Open work
                  </Link>
                </li>
                <li>
                  <a href="#work" className="transition-colors hover:text-foreground">
                    The work
                  </a>
                </li>
                <li>
                  <a href="#training" className="transition-colors hover:text-foreground">
                    Training
                  </a>
                </li>
                <li>
                  <a href="#payouts" className="transition-colors hover:text-foreground">
                    Payouts
                  </a>
                </li>
              </ul>
            </nav>

            <nav aria-label="Account">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Account</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link href="/sign-in" className="transition-colors hover:text-foreground">
                    Log in
                  </Link>
                </li>
                <li>
                  <Link href="/sign-up" className="transition-colors hover:text-foreground">
                    Create account
                  </Link>
                </li>
                <li>
                  <Link href="/forgot-password" className="transition-colors hover:text-foreground">
                    Reset password
                  </Link>
                </li>
              </ul>
            </nav>

            <nav aria-label="Legal">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Legal</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link href="/terms" className="transition-colors hover:text-foreground">
                    Terms &amp; Conditions
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="transition-colors hover:text-foreground">
                    Privacy Notice
                  </Link>
                </li>
              </ul>
            </nav>
          </div>

          <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {year} {site.legalName} · afterworks.site
            </p>
          </div>
        </div>
      </footer>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </div>
  )
}
