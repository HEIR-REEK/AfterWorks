import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Platform Status & System Health',
  description: 'Live operational status, uptime metrics, and service availability for AfterWorks microwork services.',
  alternates: {
    canonical: '/status',
  },
}

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children
}
