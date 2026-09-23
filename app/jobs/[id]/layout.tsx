import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Job Details & Requirements',
  description: 'View job specifications, qualification requirements, and mobile money payout rates on AfterWorks.',
}

export default function JobDetailLayout({ children }: { children: React.ReactNode }) {
  return children
}
