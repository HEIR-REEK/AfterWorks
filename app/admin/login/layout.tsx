import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/**
 * The console sign-in is not a public page.
 *
 * Nothing in the member app links to it any more — no "Staff login" in the sign-in form footer, none
 * on the status page — and `robots.txt` asks crawlers to stay out of `/admin/`. This is the
 * belt-and-braces for the crawler that ignores robots.txt: the page is never indexed, so the console
 * address does not turn up in a search result either.
 */
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
}

export default function AdminLoginLayout({ children }: { children: ReactNode }) {
  return children
}
