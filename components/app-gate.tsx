'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/components/firebase-auth-provider'
import { AfterWorksProvider } from '@/components/afterworks-provider'
import { AppShell } from '@/components/app-shell'

const PUBLIC_ROUTES = ['/sign-in', '/sign-up']

export function AppGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()

  const isPublic = PUBLIC_ROUTES.includes(pathname)

  useEffect(() => {
    if (loading) return
    if (!user && !isPublic) {
      router.replace('/sign-in')
    }
  }, [loading, user, isPublic, router])

  // Auth screens render bare, without the app chrome.
  if (isPublic) return <>{children}</>

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  return (
    <AfterWorksProvider>
      <AppShell>{children}</AppShell>
    </AfterWorksProvider>
  )
}
