import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Browse Paid Microwork Jobs & Tasks',
  description: 'Explore verified microwork tasks on AfterWorks — transcription, data labeling, content review, and data entry with mobile money payouts.',
  alternates: {
    canonical: '/jobs',
  },
}

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return children
}
