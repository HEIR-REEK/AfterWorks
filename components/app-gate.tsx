'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/components/firebase-auth-provider'
import { AfterWorksProvider } from '@/components/afterworks-provider'
import { AppShell } from '@/components/app-shell'
import { MaintenanceScreen } from '@/components/maintenance-screen'
import {
  subscribeToMaintenanceConfig,
  DEFAULT_MAINTENANCE_CONFIG,
  type MaintenanceConfig,
  getUserDocument,
} from '@/lib/firestore'
import { isUserAdmin, getAdminEmails } from '@/lib/admin'

const PUBLIC_ROUTES = ['/sign-in', '/sign-up', '/kyc/callback']

export function AppGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()
  const [maintenance, setMaintenance] = useState<MaintenanceConfig>(DEFAULT_MAINTENANCE_CONFIG)
  const [isAdminUser, setIsAdminUser] = useState(false)
  const [checkingRole, setCheckingRole] = useState(false)

  const isPublic = PUBLIC_ROUTES.includes(pathname)
  const isAdminRoute = pathname.startsWith('/admin')

  // Real-time subscription to Maintenance Mode config
  useEffect(() => {
    const unsubscribe = subscribeToMaintenanceConfig((cfg) => {
      setMaintenance(cfg)
    })
    return () => unsubscribe()
  }, [])

  // Check if current user has Admin privileges
  useEffect(() => {
    if (!user) {
      setIsAdminUser(false)
      return
    }

    const email = user.email?.toLowerCase() || ''
    const adminEmails = getAdminEmails()
    const isAllowedEmail =
      adminEmails.includes(email) ||
      (maintenance.allowedEmails && maintenance.allowedEmails.map((e) => e.toLowerCase()).includes(email))

    if (isAllowedEmail) {
      setIsAdminUser(true)
      return
    }

    setCheckingRole(true)
    getUserDocument(user.uid)
      .then((doc) => {
        if (doc?.role === 'admin' || doc?.isAdmin === true || isUserAdmin(user, doc)) {
          setIsAdminUser(true)
        } else {
          setIsAdminUser(false)
        }
      })
      .catch(() => setIsAdminUser(false))
      .finally(() => setCheckingRole(false))
  }, [user, maintenance.allowedEmails])

  useEffect(() => {
    if (loading) return
    if (!user && !isPublic && !isAdminRoute && !maintenance.enabled) {
      router.replace('/sign-in')
    }
  }, [loading, user, isPublic, isAdminRoute, maintenance.enabled, router])

  // If maintenance mode is active
  if (maintenance.enabled) {
    const isBypassed =
      isAdminUser ||
      (user?.email && maintenance.allowedEmails?.some((e) => e.toLowerCase() === user.email?.toLowerCase())) ||
      isAdminRoute

    // If user is not an admin and not accessing an allowed admin path, show maintenance screen
    if (!isBypassed && !isPublic) {
      return (
        <MaintenanceScreen
          config={maintenance}
          isAdmin={isAdminUser}
          onCheckStatus={() => {
            // Refreshes maintenance check
            window.location.reload()
          }}
        />
      )
    }
  }

  // Auth screens render bare, without the app chrome.
  if (isPublic) return <>{children}</>

  if (loading || checkingRole || (!user && !isAdminRoute && !maintenance.enabled)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  // Admin Portal now renders inside the main AppShell to match the site theme.

  return (
    <AfterWorksProvider>
      <AppShell>{children}</AppShell>
    </AfterWorksProvider>
  )
}
