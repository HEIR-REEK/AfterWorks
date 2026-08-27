'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth, type FirebaseConfig } from '@/components/firebase-auth-provider'
import { useAdmin } from '@/components/admin-provider'
import { useMaintenance } from '@/components/maintenance-provider'
import { AfterWorksProvider } from '@/components/afterworks-provider'
import { AppShell } from '@/components/app-shell'
import { AdminShell } from '@/components/admin/admin-shell'
import { MaintenanceScreen } from '@/components/maintenance-screen'

const PUBLIC_ROUTES = ['/sign-in', '/sign-up', '/kyc/callback', '/maintenance']

/**
 * A minimal stand-in for the Firebase `User` type used when Firebase auth is
 * not configured (demo mode). The rest of the app treats it like any user —
 * Firestore calls no-op gracefully, and the AfterWorks provider serves the
 * seeded demo profile.
 */
type DemoUser = {
  uid: string
  displayName: string | null
  email: string | null
}

export function AppGate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()
  const { isAdmin, demo, demoRole, demoResolved } = useAdmin()
  const { maintenance } = useMaintenance()

  const isPublic = PUBLIC_ROUTES.includes(pathname)
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/')

  // In demo mode (Firebase unconfigured) the localStorage role acts as the
  // signed-in user; without a role everyone is routed to sign-in.
  const demoUser = useMemo<DemoUser | null>(() => {
    if (!demo || !demoRole) return null
    if (demoRole === 'admin') {
      return {
        uid: 'demo-admin',
        displayName: 'Demo Admin',
        email: 'admin@afterworks.demo',
      }
    }
    return {
      uid: 'demo-worker',
      displayName: 'Amara Okoro',
      email: 'amara.okoro@afterworks.demo',
    }
  }, [demo, demoRole])


  // ── Routing guards ────────────────────────────────────────────────────────
  useEffect(() => {
    // While the maintenance screen is up, don't redirect anyone anywhere —
    // signed-out visitors stay on the page they opened and watch it recover.
    if (maintenance.enabled && !isAdmin) return
    // Wait for the demo role to be read before making redirect decisions.
    if (demo && !demoResolved) return

    if (demo) {
      if (!demoRole && !isPublic) {
        router.replace('/sign-in')
      }
      if (demoRole && pathname === '/sign-up') {
        router.replace('/')
      }
      return
    }
    if (loading) return
    if (!user && !isPublic) {
      router.replace('/sign-in')
    }
  }, [demo, demoResolved, demoRole, loading, user, isPublic, pathname, router, maintenance.enabled, isAdmin])

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
    return <MaintenanceScreen />
  }

  // ── Auth unresolved → spinner ─────────────────────────────────────────────
  const authUnresolved = demo ? false : loading
  if (authUnresolved || (!demo && !user)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  // ── Demo mode without a role → on the way to sign-in ──────────────────────
  if (demo && (!demoResolved || !demoUser)) {
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
      <AfterWorksProvider key={`admin-${user?.uid ?? demoRole ?? "anon"}`}>
        <AdminShell>{children}</AdminShell>
      </AfterWorksProvider>
    )
  }

  // ── Regular worker app ────────────────────────────────────────────────────
  return (
    <AfterWorksProvider key={user?.uid ?? demoRole ?? "anon"}>
      <AppShell>{children}</AppShell>
    </AfterWorksProvider>
  )
}

export type { FirebaseConfig }
