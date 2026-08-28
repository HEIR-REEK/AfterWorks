'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/components/firebase-auth-provider'
import { AfterWorksProvider } from '@/components/afterworks-provider'
import { AppShell } from '@/components/app-shell'
import { MaintenanceScreen } from '@/components/maintenance-screen'
import { MaintenanceProvider, useMaintenance } from '@/components/maintenance-provider'
import { useAdminSession } from '@/lib/admin'

/**
 * The application gate: auth requirement, maintenance interception and chrome selection.
 *
 * Two behavioural rules that used to be wrong here:
 *  • Maintenance was enforced *only* in this component, i.e. only for visitors who downloaded and
 *    ran the React bundle. The authoritative gate is now the middleware (503 + Retry-After); this
 *    remains as the "tab already open when the switch was flipped" layer, so a live session freezes
 *    rather than half-working.
 *  • Admin bypass was decided from `sessionStorage`, so any tab that could set a key could walk
 *    through the outage and into the console. Bypass now comes from a signed HttpOnly cookie
 *    verified by `useAdminSession()`, plus the server-side allow-list check.
 */

const PUBLIC_ROUTES = ['/sign-in', '/sign-up', '/kyc/callback', '/maintenance', '/status']

export function AppGate({ children }: { children: React.ReactNode }) {
  return (
    <MaintenanceProvider>
      <Gate>{children}</Gate>
    </MaintenanceProvider>
  )
}

function Gate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, configured } = useAuth()
  const { view, bypassed } = useMaintenance()
  const admin = useAdminSession()
  const [redirectArmed, setRedirectArmed] = useState(false)

  const isPublic = useMemo(() => PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`)), [pathname])
  const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  const blackout = view.blocking && !bypassed && admin.status !== 'authorized'

  // Redirect to sign-in only for routes that genuinely need a session, and never while an outage
  // is up (the maintenance screen is the correct terminal state, not a redirect loop).
  useEffect(() => {
    if (loading || configured === false) return
    if (isPublic || isAdminRoute || blackout) return
    if (!user) router.replace('/sign-in')
  }, [loading, user, isPublic, isAdminRoute, blackout, router, configured])

  // Flip the "loading" screen off only once we know what we are rendering.
  useEffect(() => {
    const id = setTimeout(() => setRedirectArmed(true), 2500)
    return () => clearTimeout(id)
  }, [])

  if (blackout && !isAdminRoute) {
    return <MaintenanceScreen config={view} onRefresh={() => admin.refresh()} />
  }

  if (isPublic) return <>{children}</>

  if (loading || (admin.status === 'checking' && view.unknown && !redirectArmed)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3" role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-primary" />
        <span className="text-xs font-medium text-muted-foreground">Loading your workspace…</span>
      </div>
    )
  }

  // /admin has its own layout + session gate; it renders without the worker chrome (see admin/layout).
  if (isAdminRoute) return <>{children}</>

  return (
    <AfterWorksProvider>
      <AppShell>{children}</AppShell>
    </AfterWorksProvider>
  )
}
