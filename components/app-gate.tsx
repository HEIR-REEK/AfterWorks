'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/components/firebase-auth-provider'
import { useAdmin } from '@/components/admin-provider'
import { useMaintenance } from '@/components/maintenance-provider'
import { AfterWorksProvider } from '@/components/afterworks-provider'
import { AppShell } from '@/components/app-shell'
import { AdminShell } from '@/components/admin/admin-shell'
import { MaintenanceScreen } from '@/components/maintenance-screen'

const PUBLIC_ROUTES = ['/sign-in', '/sign-up', '/kyc/callback', '/maintenance']

export function AppGate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()
  const { isAdmin, checking } = useAdmin()
  const { maintenance } = useMaintenance()

  const isPublic = PUBLIC_ROUTES.includes(pathname)
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/')

  // ── Routing guards ────────────────────────────────────────────────────────
  useEffect(() => {
    // While the maintenance screen is up, don't redirect anyone anywhere —
    // signed-out visitors stay on the page they opened and watch it recover.
    if (maintenance.enabled && !isAdmin) return
    if (loading) return
    if (!user && !isPublic) {
      router.replace('/sign-in')
    }
  }, [loading, user, isPublic, pathname, router, maintenance.enabled, isAdmin])

  // ── Public screens render bare (no app chrome) ────────────────────────────
  if (isPublic) {
    // Direct visits to /maintenance always show the maintenance screen.
    if (pathname === '/maintenance') {
      return <MaintenanceScreen />
    }
    return <>{children}</>
  }

  // ── Maintenance gate: everyone except admins sees the maintenance screen ──
  // (Covers signed-out visitors and signed-in workers on all app routes.)
  if (maintenance.enabled && !isAdmin) {
    if (checking && user) {
      // Signed-in user whose admin status is still being verified — avoid
      // flashing the maintenance screen at admins.
      return (
        <div className="flex min-h-dvh items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading</span>
        </div>
      )
    }
    return <MaintenanceScreen />
  }

  // ── Auth unresolved or signed-out (on the way to /sign-in) → spinner ──────
  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  // ── Admin area uses its own shell ─────────────────────────────────────────
  if (isAdminRoute) {
    return (
      <AfterWorksProvider key={`admin-${user.uid}`}>
        <AdminShell>{children}</AdminShell>
      </AfterWorksProvider>
    )
  }

  // ── Regular worker app ────────────────────────────────────────────────────
  return (
    <AfterWorksProvider key={user.uid}>
      <AppShell>{children}</AppShell>
    </AfterWorksProvider>
  )
}
