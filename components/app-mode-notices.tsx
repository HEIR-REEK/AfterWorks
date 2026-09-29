'use client'

import Link from 'next/link'
import { AlertTriangle, LifeBuoy, ShieldAlert } from 'lucide-react'
import { site } from '@/lib/site'
import { BrandMark } from '@/components/brand'

/**
 * Notices for the state where the app must not pretend to be somebody's account.
 *
 * This exists because of a real report: *"I closed Chrome and opened it again and the dashboards
 * are still displaying without even a login process."* One of the ways that happens is not a
 * session at all — `FirebaseAuthProvider.configured` is false when the deployment's Firebase web
 * config is missing or incomplete, and the app used to treat exactly that state as "carry on": the
 * gate skipped its sign-in redirect and `AfterWorksProvider` filled the screens with sample data,
 * so a misconfigured deployment served a complete, fake, logged-in-looking dashboard to anybody
 * who opened it.
 *
 * So: unconfigured is a wall. No sample-data mode exists to soften it — a blank-but-honest answer
 * beats a convincing one made of example rows.
 */

/**
 * The wall. Shown instead of any private screen when Firebase is not configured — there is nothing
 * real to show, and nothing a visitor enters would be saved.
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
