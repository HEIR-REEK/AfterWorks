'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/components/firebase-auth-provider'
import { AfterWorksProvider } from '@/components/afterworks-provider'
import { AppShell } from '@/components/app-shell'
import { MaintenanceScreen } from '@/components/maintenance-screen'
import { MaintenanceProvider, useMaintenance } from '@/components/maintenance-provider'
import { IdleSessionGuard } from '@/components/idle-session-guard'
import { useAdminSession } from '@/lib/admin'
import { matchesBlockedPath } from '@/lib/maintenance-shared'
import { isPublicRoute } from '@/lib/public-routes'
import { ConfigurationRequired, DemoModeBanner, demoModeAllowed } from '@/components/app-mode-notices'

/**
 * Sample-data mode is opt-in, and never a production default.
 *
 * Read statically so Next inlines it into the client bundle. With it off, a deployment that is
 * missing its Firebase config shows the configuration wall instead of a dashboard built from
 * `seedWorker()` — see `components/app-mode-notices.tsx` for the report that prompted this.
 */
const ALLOW_DEMO_MODE = demoModeAllowed(process.env.NEXT_PUBLIC_ALLOW_DEMO_MODE)

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
 *  • "Public" was a list written inline here, and it was missing the legal documents — so a
 *    signed-out visitor who opened `/terms` from the sign-up form was server-rendered the whole
 *    document and then pulled off it to `/sign-in`, and the same pages were replaced by the
 *    configuration wall on a deployment that had no Firebase. The list now lives in
 *    `lib/public-routes.ts` with the reasoning for each entry, and is covered by a test.
 */

export function AppGate({ children }: { children: React.ReactNode }) {
  return (
    <MaintenanceProvider>
      <Gate>{children}</Gate>
      {/* Ten minutes without input ends the session and reloads the page — see the component for
          why an idle *signed-in* tab is the thing worth closing. Mounted at the top of the tree
          rather than inside the shell so it also covers the public routes a signed-in member can
          wander onto (/verify-email, /kyc/callback), and it is a no-op while signed out. */}
      <IdleSessionGuard />
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

  const isPublic = useMemo(() => isPublicRoute(pathname), [pathname])
  const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  // Nothing below the gate can show a real account when there is no Firebase, and the console brings
  // its own (server-side) session. Public routes still render — they explain the situation themselves.
  const unconfigured = configured === false
  const wallOff = unconfigured && !ALLOW_DEMO_MODE && !isPublic && !isAdminRoute
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

  if (wallOff) return <ConfigurationRequired />

  if (isPublic) return <>{children}</>

  if (loading || (admin.status === 'checking' && view.unknown && !redirectArmed)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3" role="status" aria-live="polite">
        <h1 className="sr-only">AfterWorks — Verified Microwork Platform</h1>
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
        <h1 className="sr-only">Verify your email — AfterWorks</h1>
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
      <AppShell>{ALLOW_DEMO_MODE && unconfigured ? <DemoModeBanner /> : null}{children}</AppShell>
    </AfterWorksProvider>
  )
}
