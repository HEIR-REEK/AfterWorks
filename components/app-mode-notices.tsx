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
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">This deployment is not connected yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          AfterWorks has no Firebase configuration on this host, so there are no accounts, jobs or balances to
          show — and nothing here would be saved. The screens stay locked until the deployment is configured
          rather than showing sample data that looks like a real account.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-left text-xs leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground">For whoever deploys this:</p>
        <p className="mt-1">
          Set <code className="font-mono">FIREBASE_WEB_API_KEY</code>, <code className="font-mono">FIREBASE_AUTH_DOMAIN</code>,{' '}
          <code className="font-mono">FIREBASE_PROJECT_ID</code> and <code className="font-mono">FIREBASE_APP_ID</code> in the host&rsquo;s
          environment, then redeploy. The operations console needs <code className="font-mono">ADMIN_SESSION_SECRET</code> as well.
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
          <strong className="font-semibold">Demo mode</strong> — Firebase is not configured on this deployment, so this is
          sample data. Nothing you do here is stored, and no sign-in is possible.
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
        {what} is unavailable because this deployment has no Firebase configuration.{' '}
        <Link href="/status" className="font-semibold underline">
          Check status
        </Link>
        .
      </span>
    </p>
  )
}
