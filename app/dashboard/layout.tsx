import type { Metadata } from 'next'

/**
 * `/dashboard` is the signed-in worker home — the page that used to live at `/`.
 *
 * It is personal (balance, quality score, the member's own applications), so it is `noindex` and
 * disallowed in `robots.txt`. Keeping it out of the index is also what makes `/` free to be a real
 * public page: a crawler that follows the sitemap never lands on somebody's wallet.
 */
export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your AfterWorks workspace: available balance, clearing earnings, quality score and active applications.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/dashboard' },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
