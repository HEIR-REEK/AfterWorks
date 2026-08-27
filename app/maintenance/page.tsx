import type { Metadata } from 'next'
import { MaintenanceScreen } from '@/components/maintenance-screen'

export const metadata: Metadata = {
  title: 'Down for maintenance — AfterWorks',
  description:
    'AfterWorks is temporarily down for scheduled maintenance. Your account, earnings and applications are safe.',
}

export default function MaintenancePage() {
  return <MaintenanceScreen />
}
