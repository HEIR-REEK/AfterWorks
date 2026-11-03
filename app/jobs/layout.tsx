import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Browse Paid Microwork Jobs & Tasks',
  description: 'Explore verified microwork tasks on AfterWorks — transcription, data labeling, content review, and data entry with mobile money payouts.',
  alternates: {
    canonical: '/jobs',
  },
  // The board is a signed-in workspace. A crawler would only see the AppGate redirect to the
  // sign-in form, so keep this URL out of the index rather than competing with `/` for the brand.
  robots: { index: false, follow: false },
}

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return children
}
