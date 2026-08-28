'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, Home, RefreshCw, LifeBuoy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { site } from '@/lib/site'

/**
 * Route error boundary.
 *
 * Before this, a thrown error inside the provider tree unmounted the app to React's blank page (and
 * in dev, to an unstyled stack trace). Here the worker gets a plain sentence, the reason we can show
 * safely, a retry that does not require a hard reload, and — because money is involved — a note that
 * nothing they typed was lost silently.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server-side logs keep the digest; the console gets enough to report without leaking internals.
    console.error(`[afterworks:error]${error?.digest ? ` ${error.digest}` : ''}`, error?.message)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-lg flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="rounded-2xl border border-destructive/30 bg-destructive/[0.07] p-3.5 text-destructive">
        <AlertTriangle className="size-7" />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">Something broke on our side</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {error?.message && error.message.length < 200
            ? error.message
            : 'The page could not be rendered. Your applications, wallet and submitted work are stored on the server and are unaffected.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => reset()}
        >
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
        <Button render={<Link href="/jobs" />} size="sm" variant="outline" className="gap-1.5">
          <Home className="size-3.5" />
          Back to jobs
        </Button>
        <Button render={<Link href="/status" />} size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
          <LifeBuoy className="size-3.5" />
          Platform status
        </Button>
      </div>

      {error?.digest && <p className="font-mono text-[11px] text-muted-foreground/70">ref {error.digest.slice(0, 24)}</p>}
      <p className="text-[11px] text-muted-foreground">
        Stuck? Email <a href={`mailto:${site.supportEmail}`} className="font-medium text-primary hover:underline">{site.supportEmail}</a> with that reference.
      </p>
    </div>
  )
}
