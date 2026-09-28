'use client'

/**
 * The onboarding prompt.
 *
 * Appears on top of a blurred app the first time a signed-in member lands after signing in, and
 * again whenever they open the profile tab — until the profile is 100%. "Later" is deliberately
 * available: a worker who just wants to look at the job board before committing their details should
 * be able to, and a popup with no exit is how people learn to hate a product.
 *
 * It is rendered by the app shell (so it is present on every worker route) and driven entirely by
 * `onboarding` state from the provider — the same completion score the server uses to release the
 * $5, so the number on the bar and the number that pays the reward cannot disagree.
 */

import { useRouter } from 'next/navigation'
import { ArrowRight, Check, Clock, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAfterWorks } from '@/components/afterworks-provider'
import { formatUsd } from '@/lib/afterworks-data'

export function OnboardingGate() {
  const router = useRouter()
  const { onboarding, worker } = useAfterWorks()
  const { completion, promptOpen, dismissPrompt } = onboarding

  if (!promptOpen) return null

  const remaining = completion.missingLabels
  const first = (worker.name || 'there').split(' ')[0]
  const reward = formatUsd(5)

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/40 p-3 backdrop-blur-md sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-body"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95">
        <button
          type="button"
          onClick={dismissPrompt}
          aria-label="Close and browse for now"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex flex-col gap-5 p-6 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 id="onboarding-title" className="text-lg font-semibold tracking-tight">
                Finish your profile, {first} — and take the {reward}
              </h2>
              <p id="onboarding-body" className="mt-1 text-sm leading-relaxed text-muted-foreground">
                We add <strong className="text-foreground">{reward}</strong> to your available balance the moment your
                profile hits 100%. It is real money — withdrawable once you reach the {formatUsd(10)} minimum.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-muted-foreground">Profile completion</span>
              <span className="font-mono text-sm font-semibold text-primary">{completion.percent}%</span>
            </div>
            <div
              className="mt-2.5 h-2 overflow-hidden rounded-full bg-background"
              role="progressbar"
              aria-valuenow={completion.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Profile completion"
            >
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${completion.percent}%` }} />
            </div>

            <p className="mt-3 text-xs font-medium text-muted-foreground">Still missing</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {remaining.length === 0 ? (
                <li className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                  <Check className="size-3.5" /> Everything is filled in — claim your reward
                </li>
              ) : (
                remaining.map((label) => (
                  <li key={label} className="inline-flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-1 text-xs font-medium text-foreground">
                    <Clock className="size-3.5 text-warning" />
                    {label}
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={dismissPrompt} className="sm:order-1">
              Later — just browsing
            </Button>
            <Button
              className="gap-2 sm:order-2"
              onClick={() => {
                dismissPrompt()
                router.push('/profile?complete=1')
              }}
            >
              Finish my profile
              <ArrowRight className="size-4" />
            </Button>
          </div>

          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            We ask for your name, mobile money number, city, a short summary, your skills and languages. Bank payouts need
            the account details instead — you can change this any time in your profile.
          </p>
        </div>
      </div>
    </div>
  )
}
