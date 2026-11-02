import Link from 'next/link'
import { ArrowRight, ArrowUp, CheckCircle2, GraduationCap, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatUsd } from '@/lib/afterworks-data'
import { cn } from '@/lib/utils'

/**
 * The "higher pay" message.
 *
 * Training is optional on AfterWorks, but it is the difference between the entry-level cards and the
 * specialist cards that pay several times more. That fact was buried in a job card's fee badge and a
 * paragraph on the training page; these two surfaces put it where a member actually looks — under
 * the landing-page hero and directly under the dashboard wallet.
 *
 * Wording is deliberately about *unlocking the work*, not about guaranteed earnings: the fee is
 * shown on the card before checkout, and passing the assessment is what makes the job available.
 */

const TITLE = 'Get trained. Get the higher-paying jobs.'
const BODY =
  'Some of the best-paid cards on the board ask for a short, job-specific training module and a quick assessment. Finish them once, and those higher-paying specialist jobs are open to you.'
const FINE_PRINT = 'A one-off training fee is shown on the card before you pay. Applying is always free.'

/** The compact, high-contrast banner used on the signed-in dashboard. */
export function TrainingPushBanner({
  trainingJobs = 0,
  topPayUsd = 0,
  live = false,
  className,
}: {
  trainingJobs?: number
  topPayUsd?: number
  /** Only quote counts and prices when the board is backed by the live catalogue, not sample rows. */
  live?: boolean
  className?: string
}) {
  return (
    <section
      aria-labelledby="training-push-title"
      className={cn(
        'relative isolate overflow-hidden rounded-2xl border border-warning/40 bg-gradient-to-br from-warning/20 via-card to-primary/[0.06] p-5 shadow-sm sm:p-6',
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 -z-10 size-48 rounded-full bg-warning/25 blur-3xl" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-warning text-warning-foreground shadow-sm">
          <GraduationCap className="size-6" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-warning-foreground/80">
            Skill up · earn more
          </p>
          <h2 id="training-push-title" className="mt-1 text-pretty text-lg font-semibold tracking-tight sm:text-xl">
            {TITLE}
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{BODY}</p>

          {live && trainingJobs > 0 && (
            <p className="mt-2 inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-medium text-foreground">
              <TrendingUp className="size-3.5 text-success" aria-hidden />
              {trainingJobs} training {trainingJobs === 1 ? 'role is' : 'roles are'} open now
              {topPayUsd > 0 ? ` · up to ${formatUsd(topPayUsd)}` : ''}.
            </p>
          )}

          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{FINE_PRINT}</p>
        </div>

        <Button
          render={<Link href="/jobs?training=1" />}
          size="lg"
          className="h-10 shrink-0 gap-1.5 px-4 text-sm sm:self-center"
        >
          Browse training jobs
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </section>
  )
}

/** The full-width landing-page section, with the pay ladder made explicit. */
export function TrainingPushSection() {
  return (
    <section
      id="training"
      className="scroll-mt-24 border-b border-border bg-warning/[0.06] py-16 sm:py-24"
      aria-labelledby="training-section-title"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-warning-foreground">
              Skill up, earn more
            </p>
            <h2
              id="training-section-title"
              className="mt-4 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              {TITLE}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">{BODY}</p>

            <ol className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
              {[
                { n: '01', label: 'Take the short module' },
                { n: '02', label: 'Pass the assessment' },
                { n: '03', label: 'Apply for higher-paying work' },
              ].map((step) => (
                <li key={step.n} className="rounded-xl border border-border/80 bg-card/70 p-3.5">
                  <span className="font-mono text-[10px] font-semibold text-warning-foreground/80">{step.n}</span>
                  <p className="mt-1.5 text-xs font-medium leading-snug text-foreground">{step.label}</p>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button render={<Link href="/sign-up" />} size="lg" className="h-10 gap-1.5 px-4 text-sm">
                Create an account to start
                <ArrowRight className="size-4" aria-hidden />
              </Button>
              <Button
                render={<a href="#how-it-works" />}
                size="lg"
                variant="outline"
                className="h-10 gap-1.5 bg-card px-4 text-sm"
              >
                See how it works
              </Button>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{FINE_PRINT}</p>
          </div>

          <div className="relative mx-auto w-full max-w-md">
            <div aria-hidden className="absolute -inset-4 -z-10 rounded-[2rem] bg-warning/15 blur-2xl" />
            <div className="rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Standard card
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">Entry-level work</p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                  No training
                </span>
              </div>

              <div className="flex justify-center py-2" aria-hidden>
                <span className="grid size-8 place-items-center rounded-full border border-warning/40 bg-warning/15 text-warning-foreground">
                  <ArrowUp className="size-4" />
                </span>
              </div>

              <div className="rounded-xl border border-warning/50 bg-warning/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-warning text-warning-foreground">
                    <GraduationCap className="size-4" aria-hidden />
                  </span>
                  <span className="rounded-full bg-warning/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-warning-foreground">
                    Training + assessment
                  </span>
                </div>
                <p className="mt-3 text-base font-semibold text-foreground">Higher-paying specialist work</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Complete the job card&apos;s module and pass its assessment to unlock the application.
                </p>
              </div>

              <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                Training is job-specific — you only take the module for the work you want.
              </p>
            </div>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              How the board is structured, not a live price quote.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
