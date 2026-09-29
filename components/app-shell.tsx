'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Briefcase,
  Gift,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  ShieldCheck,
  User,
  Wallet,
  Wrench,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/firebase-auth-provider'
import { useAfterWorks } from '@/components/afterworks-provider'
import { NotificationsBell } from '@/components/notifications-bell'
import { useMaintenance } from '@/components/maintenance-provider'
import { BrandLink } from '@/components/brand'
import { OnboardingGate } from '@/components/onboarding-gate'
import { RewardDialog } from '@/components/reward-dialog'
import { site } from '@/lib/site'

function initials(nameOrEmail: string) {
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail
  const parts = base.replace(/[._-]/g, ' ').trim().split(/\s+/)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}

const baseNav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/applications', label: 'Applied', icon: ListChecks },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/referrals', label: 'Referrals', icon: Gift },
  { href: '/profile', label: 'Profile', icon: User },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut, claims } = useAuth()
  const { worker } = useAfterWorks()
  const { view } = useMaintenance()

  const displayName = user?.displayName || user?.email || 'Worker'
  const avatar = initials(displayName).toUpperCase() || 'W'

  // Three states worth a strip: banner mode, and a scoped blackout (only some areas are down).
  const scopedBlackout = view.blocking && !view.blocksAll
  const bannerVisible = (view.bannerOnly || scopedBlackout) && !view.unknown

  const nav = baseNav

  // Mobile navigation: the same side panel opens as an overlay drawer from the header hamburger.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Close the drawer whenever the route changes — every link inside it navigates.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  // While open, the drawer behaves like a modal: Escape closes it, page scroll is frozen so the
  // menu and the page behind it cannot move together, and widening past the sidebar breakpoint
  // closes it rather than leaving an invisible drawer that keeps the page scroll-locked.
  useEffect(() => {
    if (!mobileNavOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    const onResize = () => {
      if (window.innerWidth >= 768) setMobileNavOpen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [mobileNavOpen])

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

  // Shared between the desktop rail and the mobile drawer so both offer exactly the same menu.
  const sideNav = (
    <>
      <nav className="flex flex-col gap-1" aria-label="Primary">
        {nav.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              onClick={() => setMobileNavOpen(false)}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="mt-auto border-t border-border pt-4">
        <Link href="/profile" onClick={() => setMobileNavOpen(false)} className="mb-3 flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 hover:bg-secondary">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{avatar}</span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold">{displayName}</span>
            <span className="block text-[10px] text-muted-foreground">Your profile</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Onboarding: the profile prompt and the welcome-reward celebration live here so they can
          appear over any worker route, and are driven by one state machine in the provider. */}
      <OnboardingGate />
      <RewardDialog />

      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:h-16 sm:gap-6 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav-drawer"
            className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
          >
            <Menu className="size-5" />
          </button>
          <BrandLink href="/" label={site.name} size={40} wordmarkClass="sm:text-base" />

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
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:px-2.5 sm:py-2 md:hidden"
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

      {/* Desktop navigation lives in a persistent left rail; on mobile the same panel opens from
          the header hamburger, and the compact bottom bar stays for one-tap jumps. */}
      <div className="mx-auto flex w-full max-w-[90rem] flex-1">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-48 shrink-0 flex-col border-r border-border bg-card/30 px-3 py-5 md:flex">
          <p className="px-3 pb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace</p>
          {sideNav}
        </aside>

        {/* Page content — extra bottom padding on mobile to clear the bottom nav */}
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5 pb-24 sm:px-6 sm:py-8 md:pb-8 sm:pb-8">
        {children}
        </main>
      </div>

      {/* Desktop / tablet footer */}
      <footer className="mt-auto hidden border-t border-border/60 bg-card/40 py-6 md:block">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 text-xs text-muted-foreground sm:px-6">
          <p>
            © {new Date().getFullYear()} {site.legalName}. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
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
          // One column per destination, always. With six items a fixed 5-column grid would
          // overflow rather than adapt, so the count follows the nav rather than the other way round.
          'grid-cols-6',
        )}
        aria-label="Primary mobile"
      >
        {nav.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 px-0.5 py-2.5 text-[9px] font-medium transition-colors sm:text-[10px]',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className={cn('size-5 mb-0.5', active && 'stroke-[2.25]')} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Mobile drawer — the side panel's form on small screens, opened by the header hamburger. */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div
            aria-hidden="true"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-in fade-in"
          />
          <div
            id="mobile-nav-drawer"
            className="absolute inset-y-0 left-0 flex w-64 max-w-[82vw] flex-col border-r border-border bg-card shadow-2xl animate-in slide-in-from-left-4"
          >
            <div className="flex items-center justify-between px-3 pb-2 pt-4">
              <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace</p>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-6">{sideNav}</div>
          </div>
        </div>
      )}
    </div>
  )
}
