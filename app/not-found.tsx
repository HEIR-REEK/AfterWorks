import Link from 'next/link'
import { Compass, Home, LayoutGrid, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { site } from '@/lib/site'

export default function NotFound() {
  return (
    <div className="relative mx-auto flex min-h-[70dvh] w-full max-w-xl flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-dot-pattern opacity-[0.35]" aria-hidden />
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm">
        <Compass className="size-7" />
      </div>

      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">404 — off the board</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">That page is not here</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          The link may be old, or the job card may have closed. Nothing was lost — your applications,
          earnings and verification status all live on the account, not in this URL.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button render={<Link href="/jobs" />} size="sm" className="gap-1.5">
          <LayoutGrid className="size-3.5" />
          Browse open jobs
        </Button>
        <Button render={<Link href="/applications" />} size="sm" variant="outline" className="gap-1.5">
          <Wallet className="size-3.5" />
          My applications
        </Button>
        <Button render={<Link href="/" />} size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
          <Home className="size-3.5" />
          Home
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Believed this is a bug?{' '}
        <a href={`mailto:${site.supportEmail}`} className="font-medium text-primary hover:underline">
          {site.supportEmail}
        </a>
      </p>
    </div>
  )
}
