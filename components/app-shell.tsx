'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Briefcase,
  Info,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Shield,
  ShieldCheck,
  User,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/firebase-auth-provider'
import { useAfterWorks } from '@/components/afterworks-provider'
import { NotificationsBell } from '@/components/notifications-bell'
import { useMaintenance } from '@/components/maintenance-provider'
import { BrandLink } from '@/components/brand'
import { site } from '@/lib/site'

import { isUserAdmin, useAdminSession } from '@/lib/admin'

function initials(nameOrEmail: string) {
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail
  const parts = base.replace(/[._-]/g, ' ').trim().split(/\s+/)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}

const baseNav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/applications', label: 'Applied', icon: ListChecks },
  { href: '/profile', label: 'Profile', icon: User },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut, claims } = useAuth()
  const { worker, mode } = useAfterWorks()
  const { view } = useMaintenance()

  const displayName = user?.displayName || user?.email || 'Worker'
  const avatar = initials(displayName).toUpperCase() || 'W'

  // Shows the Admin link when an admin session is active or user has staff claims.
  // The console itself is gated by useAdminSession() + the API guard.
  const adminSession = useAdminSession()
  const isAdmin =
    adminSession.status === 'authorized' ||
    isUserAdmin({ idTokenResult: { claims: (claims as Record<string, unknown>) ?? null } }, worker)
  // Three states worth a strip: banner mode, and a scoped blackout (only some areas are down).
  const scopedBlackout = view.blocking && !view.blocksAll
  const bannerVisible = (view.bannerOnly || scopedBlackout) && !view.unknown

  const nav = isAdmin
    ? [...baseNav, { href: '/admin', label: 'Admin', icon: Shield, isAdminLink: true }]
    : baseNav

  async function handleSignOut() {
    await signOut()
    // Also drop the signed staff cookie so a shared device does not keep bypassing maintenance.
    try {
      const { terminateAdminSession } = await import('@/lib/admin')
      await terminateAdminSession()
    } catch {
      /* best effort */
    }
    router.replace('/sign-in')
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:h-16 sm:gap-6 sm:px-6">
          <BrandLink href="/" label={site.name} size={40} wordmarkClass="sm:text-base" />

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {nav.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href)
              const isAdminLink = 'isAdminLink' in item && item.isAdminLink

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    isAdminLink &&
                      !active &&
                      'border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10',
                  )}
                >
                  <Icon className={cn('size-4', isAdminLink && 'text-primary')} />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {worker?.kycVerified && worker?.phone && worker?.country && (
              <span className="hidden items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-xs font-medium text-success sm:inline-flex">
                <ShieldCheck className="size-3.5" />
                Verified
              </span>
            )}
            <NotificationsBell />
            <div
              className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground sm:size-9 sm:text-sm"
              title={displayName}
              aria-label={`Signed in as ${displayName}`}
            >
              {avatar}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:px-2.5 sm:py-2"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Maintenance strip: the platform works, but parts of it are paused. */}
      {bannerVisible && (
        <div
          role="status"
          className={cn(
            'px-4 py-2 text-center text-xs font-medium sm:text-sm',
            scopedBlackout
              ? 'border-b border-destructive/30 bg-destructive/[0.07] text-destructive'
              : 'border-b border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
          )}
        >
          <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <Wrench className="size-3.5 shrink-0" />
            {scopedBlackout
              ? `Some parts are under maintenance: ${view.blockedPaths.join(', ')} — everything else works as usual.`
              : view.banner || 'Maintenance in progress.'}
            <Link href="/status" className="underline decoration-amber-500/50 underline-offset-2 hover:decoration-amber-500">
              Details
            </Link>
          </span>
        </div>
      )}

      {/* Page content — extra bottom padding on mobile to clear the bottom nav */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5 pb-24 sm:px-6 sm:py-8 md:pb-8 sm:pb-8">
        {mode === 'demo' && (
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              Demo mode — Firebase is not configured on this deployment, so jobs shown here are sample data and
              applications are not saved. Set the <code className="rounded bg-background px-1 font-mono text-[11px]">FIREBASE_*</code> variables
              to go live.
            </span>
          </div>
        )}
        {children}
      </main>

      {/* Desktop / tablet footer */}
      <footer className="mt-auto hidden border-t border-border/60 bg-card/40 py-6 md:block">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 text-xs text-muted-foreground sm:px-6">
          <p>
            © {new Date().getFullYear()} {site.legalName}. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <a href={`mailto:${site.supportEmail}`} className="transition-colors hover:text-foreground">
              Support
            </a>
          </div>
        </div>
      </footer>

      {/* Mobile bottom nav */}
      <nav
        className={cn(
          'fixed bottom-0 left-0 right-0 z-40 grid border-t border-border bg-background/95 backdrop-blur supports-[padding:max(0px)]:pb-[env(safe-area-inset-bottom)] md:hidden',
          isAdmin ? 'grid-cols-5' : 'grid-cols-4',
        )}
        aria-label="Primary mobile"
      >
        {nav.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          const isAdminLink = 'isAdminLink' in item && item.isAdminLink

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
                isAdminLink && !active && 'text-primary font-semibold',
              )}
            >
              <Icon className={cn('size-5 mb-0.5', active && 'stroke-[2.25]')} />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
