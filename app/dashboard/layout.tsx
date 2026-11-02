import type { Metadata } from 'next'

/**
 * The worker dashboard moved from `/` to `/dashboard` when `/` became the public landing page.
 *
 * The page itself is a client component (it reads the live wallet, applications and job board from
 * the provider), so its metadata lives here. It stays out of search results in three places:
 * `robots.txt`, the `X-Robots-Tag` header set by the edge, and this declaration — because a
 * private workspace appearing in a search result looks like a public page and confuses the people
 * who click it.
 */

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your AfterWorks workspace: open jobs, active applications, earnings and payouts.',
  alternates: { canonical: '/dashboard' },
  robots: { index: false, follow: false },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
