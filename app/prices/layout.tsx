import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Job Prices by Region',
  description: 'Unlock another region’s task prices on AfterWorks — one payment per region, for good.',
  alternates: { canonical: '/prices' },
  // Signed-in workspace, like the board itself: a crawler only sees the sign-in gate.
  robots: { index: false, follow: false },
}

export default function PricesLayout({ children }: { children: React.ReactNode }) {
  return children
}
