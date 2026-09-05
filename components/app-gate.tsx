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
import { matchesBlockedPath } from '@/lib/maintenance-shared'

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

const PUBLIC_ROUTES = ['/sign-in', '/sign-up', '/forgot-password', '/verify-email', '/kyc/callback', '/maintenance', '/status']

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
  // A full blackout replaces the whole app, including /sign-in. A scoped one (`sections`) replaces
  // only the affected route, so a payout run does not take the job board down with it.
  const blackoutAll = view.blocking && view.blocksAll && !bypassed && admin.status !== 'authorized'
  const scopedHit =
    view.blocking && !view.blocksAll && !bypassed && admin.status !== 'authorized' && matchesBlockedPath(pathname, view.blockedPaths)
  const blackout = blackoutAll

  // Redirect to sign-in only for routes that genuinely need a session, and never while an outage
  // is up (the maintenance screen is the correct terminal state, not a redirect loop).
  // Unverified members stay signed in but cannot reach profile/KYC/jobs until they click the
  // Resend link — /verify-email is public so that page still renders when signed out too.
  useEffect(() => {
    if (loading || configured === false) return
    if (isPublic || isAdminRoute || blackout) return
    if (!user) {
      router.replace('/sign-in')
      return
    }
    if (!user.emailVerified) router.replace('/verify-email')
  }, [loading, user, isPublic, isAdminRoute, blackout, router, configured])

  // Flip the "loading" screen off only once we know what we are rendering.
  useEffect(() => {
    const id = setTimeout(() => setRedirectArmed(true), 2500)
    return () => clearTimeout(id)
  }, [])

  if (blackoutAll && !isAdminRoute) {
    // The shell's maintenance subscription polls /api/maintenance on a visibility-aware interval,
    // so the screen lifts itself as soon as the window ends — no button needed.
    return <MaintenanceScreen config={view} />
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

  if (user && !user.emailVerified) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3" role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-primary" />
        <span className="text-xs font-medium text-muted-foreground">Verify your email to continue…</span>
      </div>
    )
  }

  if (scopedHit) {
    return (
      <AfterWorksProvider>
        <AppShell>
          <MaintenanceScreen config={view} embedded />
        </AppShell>
      </AfterWorksProvider>
    )
  }

  return (
    <AfterWorksProvider>
      <AppShell>{children}</AppShell>
    </AfterWorksProvider>
  )
}
