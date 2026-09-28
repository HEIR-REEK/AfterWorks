'use client'

import Link from 'next/link'
import { AlertTriangle, FlaskConical, LifeBuoy, ShieldAlert } from 'lucide-react'
import { site } from '@/lib/site'
import { BrandMark } from '@/components/brand'

/**
 * Notices for the two states where the app must not pretend to be somebody's account.
 *
 * Both exist because of a real report: *"I closed Chrome and opened it again and the dashboards are
 * still displaying without even a login process."* One of the ways that happens is not a session at
 * all — `FirebaseAuthProvider.configured` is false when the deployment's Firebase web config is
 * missing or incomplete, and the app used to treat exactly that state as "carry on": the gate
 * skipped its sign-in redirect, `AfterWorksProvider` filled the screens with `seedWorker()` and the
 * sample catalogue, and so a misconfigured deployment served a complete, fake, logged-in-looking
 * dashboard to anybody who opened it.
 *
 * So: unconfigured is now a wall, unless a developer has explicitly asked for the demo
 * (`NEXT_PUBLIC_ALLOW_DEMO_MODE=true`), and a demo says out loud that it is one.
 */

/** Is the sample-data mode allowed on this deployment? Read statically so Next inlines it. */
export function demoModeAllowed(raw: string | undefined | null = null): boolean {
  const value = String(raw ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

/**
 * The wall. Shown instead of any private screen when Firebase is not configured and the demo is not
 * explicitly enabled — a blank-but-honest answer beats a convincing one made of sample data.
 */
export function ConfigurationRequired() {
  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-lg flex-col items-center justify-center gap-5 px-4 text-center">
      <BrandMark size={44} />
      <div className="rounded-2xl border border-destructive/30 bg-destructive/[0.07] p-3.5 text-destructive">
        <ShieldAlert className="size-7" />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">AfterWorks is not ready on this site yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          There are no jobs, applications or balances to show, and nothing you enter here would be saved. We would
          rather tell you that than show you a dashboard that is not really yours.
        </p>
      </div>
      {/* The setup instructions belong in DEPLOYMENT.md, not on a page every visitor can read. */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-left text-xs leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground">Need help?</p>
        <p className="mt-1">
          Write to <a href={`mailto:${site.supportEmail}`} className="font-medium text-primary hover:underline">{site.supportEmail}</a>{' '}
          and we will get you signed in and working.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/status" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          <LifeBuoy className="size-3.5" />
          Platform status
        </Link>
        <a href={`mailto:${site.supportEmail}`} className="text-xs font-medium text-primary hover:underline">
          {site.supportEmail}
        </a>
      </div>
    </div>
  )
}

/** A permanent, unmissable band across a demo session — sample data is never mistaken for money. */
export function DemoModeBanner() {
  return (
    <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-[11px] text-warning-foreground sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2">
        <FlaskConical className="size-3.5 shrink-0" />
        <span>
          <strong className="font-semibold">Preview</strong> — the jobs, applications and balances on screen are
          examples, not your account. Nothing here is saved and no payments can be made.
        </span>
      </div>
    </div>
  )
}

/** Small inline note for a page that cannot do its job without a datastore. */
export function ConfigMissingNote({ what }: { what: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {what} is unavailable right now.{' '}
        <Link href="/status" className="font-semibold underline">
          Check status
        </Link>
        .
      </span>
    </p>
  )
}
