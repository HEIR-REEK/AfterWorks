import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCachedMaintenanceStatus, toMaintenanceView } from '@/lib/maintenance-shared'
import { MaintenanceScreen } from '@/components/maintenance-screen'
import { site } from '@/lib/site'

/**
 * /maintenance — the blackout target.
 *
 * The middleware rewrites gated document requests here (with 503 + Retry-After), so this page must
 * render without a session, without Firebase, and without any client-side decision-making. It is a
 * Server Component by design: the copy is in the HTML that search engines and monitoring tools see.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { status } = await getCachedMaintenanceStatus()
  const title = status.config.enabled ? status.config.title : `${site.name} is temporarily in maintenance`
  return {
    title: `${title}`,
    description: status.config.message || site.description,
    robots: { index: false, follow: false },
  }
}

export default async function MaintenancePage() {
  const { status } = await getCachedMaintenanceStatus()
  // Reached directly with no window active: nothing to show here. (During a real blackout the
  // middleware rewrite always lands with `enabled: true`.)
  if (!status.config.enabled) redirect('/')

  return <MaintenanceScreen config={toMaintenanceView(status)} />
}
