import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Briefcase } from 'lucide-react'
import { PublicPage } from '@/components/public-shell'

export const metadata: Metadata = {
  title: 'Job not found',
  description: 'This job card is no longer open. Browse the current public catalogue on AfterWorks.',
  robots: { index: false, follow: false },
}

export default function PublicWorkNotFound() {
  return (
    <PublicPage>
      <div className="mx-auto flex min-h-[55vh] w-full max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
        <div className="grid size-14 place-items-center rounded-2xl border border-border bg-card text-primary shadow-sm">
          <Briefcase className="size-7" />
        </div>
        <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">404 — card closed</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">This job is no longer open</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The card may have been filled, paused or closed. Nothing was lost: your applications and
          earnings live in your account, not in this URL.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/work" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <ArrowLeft className="size-4" /> Browse open work
          </Link>
          <Link href="/" className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/40">
            AfterWorks home
          </Link>
        </div>
      </div>
    </PublicPage>
  )
}
