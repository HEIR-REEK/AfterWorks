import Link from 'next/link'
import { BrandLink } from '@/components/brand'
import { site } from '@/lib/site'

/**
 * Chrome for the pages a signed-out visitor (and therefore a search crawler) can read: `/`, `/jobs`
 * and `/jobs/[id]`.
 *
 * Deliberately a Server Component with no provider and no client state. The app shell in
 * `components/app-shell.tsx` reads the member's wallet, notifications and maintenance view, none of
 * which exist before sign-in — and a crawler must not have to download and run that bundle to see
 * what AfterWorks is. Everything here is real HTML on the first byte.
 *
 * Both halves are skip-link targets so the pages stay navigable by keyboard: `#main` is set by the
 * caller's content wrapper.
 */

const HEADER_LINKS = [
  { href: '/jobs', label: 'Browse jobs' },
  { href: '/status', label: 'Platform status' },
] as const

export function PublicHeader({ currentPath }: { currentPath?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:h-16 sm:gap-6 sm:px-6">
        <BrandLink href="/" label={site.name} size={40} wordmarkClass="sm:text-base" />

        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Primary">
          {HEADER_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={currentPath?.startsWith(item.href) ? 'page' : undefined}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Link
            href="/sign-in"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Create free account
          </Link>
        </div>
      </div>

      <nav
        className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden"
        aria-label="Primary mobile"
      >
        {HEADER_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-card/40">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <BrandLink href="/" label={site.name} size={36} />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {site.description}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {site.payoutSla}
          </p>
        </div>

        <nav aria-label="Platform">
          <h2 className="text-sm font-semibold">Platform</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
            <li><Link className="hover:text-foreground hover:underline" href="/jobs">Browse jobs</Link></li>
            <li><Link className="hover:text-foreground hover:underline" href="/sign-up">Create an account</Link></li>
            <li><Link className="hover:text-foreground hover:underline" href="/sign-in">Sign in</Link></li>
            <li><Link className="hover:text-foreground hover:underline" href="/status">Platform status</Link></li>
          </ul>
        </nav>

        <nav aria-label="Contact">
          <h2 className="text-sm font-semibold">Contact</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
            <li>
              <a className="hover:text-foreground hover:underline" href={`mailto:${site.supportEmail}`}>
                {site.supportEmail}
              </a>
            </li>
            <li>
              <a className="hover:text-foreground hover:underline" href={`mailto:${site.pressEmail}`}>
                Press
              </a>
            </li>
            <li>
              <a className="hover:text-foreground hover:underline" href={site.twitter} rel="noopener noreferrer">
                Twitter
              </a>
            </li>
            <li>
              <a className="hover:text-foreground hover:underline" href={site.linkedin} rel="noopener noreferrer">
                LinkedIn
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} {site.legalName}. Browsing and applying are always free.
          </p>
          <p>{site.legalName} · {site.supportEmail}</p>
        </div>
      </div>
    </footer>
  )
}
