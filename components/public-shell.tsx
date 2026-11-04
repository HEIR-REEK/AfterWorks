import Link from 'next/link'
import { ArrowRight, Clock3, ShieldCheck } from 'lucide-react'
import { BrandLink } from '@/components/brand'
import { site } from '@/lib/site'

/**
 * Chrome for the public catalogue (`/work`, its category pages and job previews).
 *
 * It is intentionally separate from the signed-in AppShell: a crawler and a signed-out visitor see
 * the same server-rendered header, links and footer, with no auth-dependent markup to hydrate.
 */

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <BrandLink href="/" label="AfterWorks" size={32} wordmarkClass="sr-only min-[420px]:not-sr-only" />
        <nav aria-label="Public pages" className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/work" className="hidden rounded-lg px-3 py-2 font-medium text-foreground hover:bg-secondary sm:block">
            Open work
          </Link>
          <Link href="/#how-it-works" className="hidden rounded-lg px-3 py-2 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground md:block">
            How it works
          </Link>
          <Link href="/#payouts" className="hidden rounded-lg px-3 py-2 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground lg:block">
            Payouts
          </Link>
          <Link href="/sign-in" className="inline-flex min-h-10 items-center rounded-lg px-3 py-2 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
            Log in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Create account <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </nav>
      </div>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-secondary/30">
      <div className="mx-auto grid grid-cols-1 w-full max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <BrandLink href="/" label="AfterWorks" size={32} />
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">{site.description}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Work</p>
          <ul className="mt-3 space-y-2 text-muted-foreground">
            <li><Link href="/work" className="hover:text-foreground">Open work</Link></li>
            <li><Link href="/#how-it-works" className="hover:text-foreground">How it works</Link></li>
            <li><Link href="/#training" className="hover:text-foreground">Training</Link></li>
            <li><Link href="/#faq" className="hover:text-foreground">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Account</p>
          <ul className="mt-3 space-y-2 text-muted-foreground">
            <li><Link href="/sign-in" className="hover:text-foreground">Log in</Link></li>
            <li><Link href="/sign-up" className="hover:text-foreground">Create account</Link></li>
            <li><Link href="/terms" className="hover:text-foreground">Terms &amp; Conditions</Link></li>
            <li><Link href="/privacy" className="hover:text-foreground">Privacy Notice</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Trust</p>
          <ul className="mt-3 space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> KYC before payout</li>
            <li className="flex items-start gap-2"><Clock3 className="mt-0.5 size-4 shrink-0 text-primary" /> Reviewed work, clear reasons</li>
            <li><Link href="/status" className="hover:text-foreground">Platform status</Link></li>
            <li><a href={`mailto:${site.supportEmail}`} className="hover:text-foreground">{site.supportEmail}</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} {site.legalName}. All rights reserved.</p>
          <p>Payments are made in USD and settled to mobile money in KES.</p>
        </div>
      </div>
    </footer>
  )
}

export function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  )
}
