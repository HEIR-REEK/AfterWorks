'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import {
  Briefcase,
  ChevronLeft,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  ScrollText,
  Shield,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { useAuth } from '@/components/firebase-auth-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isUserAdmin, terminateAdminSession } from '@/lib/admin'
import logo from '@/components/logo.png'
import AdminLoginPage from './login/page'

const adminNavItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Users & KYC', icon: Users },
  { href: '/admin/jobs', label: 'Jobs Catalogue', icon: Briefcase },
  { href: '/admin/applications', label: 'Applications & QA', icon: ListChecks },
  { href: '/admin/maintenance', label: 'Maintenance Mode', icon: Wrench },
  { href: '/admin/audit-log', label: 'Audit Log', icon: ScrollText },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { worker, profileLoaded } = useAfterWorks()
  const [sessionChecked, setSessionChecked] = useState(false)

  useEffect(() => {
    setSessionChecked(true)
  }, [])

  const isAdmin = isUserAdmin(user, worker)
  const isLoginPage = pathname === '/admin/login'

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  const handleAdminLogout = async () => {
    await terminateAdminSession()
    router.replace('/admin/login')
    router.refresh()
  }

  // 1. If user explicitly navigated to /admin/login, render it cleanly
  if (isLoginPage) {
    return <>{children}</>
  }

  // 2. Loading state while checking auth matching site theme
  if (!sessionChecked || (authLoading && !isAdmin)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-foreground">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-xs font-medium text-muted-foreground">Verifying administrator credentials...</p>
      </div>
    )
  }

  // 3. If not authorized as admin, render the dedicated Admin Login Screen directly
  if (!isAdmin) {
    return <AdminLoginPage />
  }



  // 4. Authorized: Render the Full Standalone Admin Console matching Site Theme
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">


      {/* Admin Content Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6 flex flex-col gap-6">
        {/* Navigation Tabs */}
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto border-b border-border pb-2.5 px-1 sm:gap-2">
          {adminNavItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href, item.exact)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all sm:text-sm',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground border border-border/70',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            )
          })}
        </div>

        {/* Child Subpage Content */}
        <div className="min-w-0 flex-1">{children}</div>
      </main>
    </div>
  )
}
