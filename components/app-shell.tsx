'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Briefcase,
  ChevronRight,
  Gift,
  Info,
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
import { BalanceToggle } from '@/components/balance-privacy'
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

/** Width of the fixed left rail; the content column is padded by exactly this. */
const RAIL_WIDTH = 'md:pl-64'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut, claims } = useAuth()
  const { worker, mode } = useAfterWorks()
  const { view } = useMaintenance()
  const [navOpen, setNavOpen] = useState(false)

  const displayName = user?.displayName || user?.email || 'Worker'
  const avatar = initials(displayName).toUpperCase() || 'W'

  // Three states worth a strip: banner mode, and a scoped blackout (only some areas are down).
  const scopedBlackout = view.blocking && !view.blocksAll
  const bannerVisible = (view.bannerOnly || scopedBlackout) && !view.unknown

  const nav = baseNav
  const activeItem = nav.find((item) => (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)))

  // Navigating from inside the drawer must close it — otherwise the rail covers the page just
  // opened, which reads as a broken link on a phone.
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  // Escape closes the drawer, the same way it dismisses any other overlay.
  useEffect(() => {
    if (!navOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  async function handleSignOut() {
    setNavOpen(false)
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
    <div className="min-h-dvh">
      {/* Onboarding: the profile prompt and the welcome-reward celebration live here so they can
          appear over any worker route, and are driven by one state machine in the provider. */}
      <OnboardingGate />
      <RewardDialog />

      {/* Scrim behind the drawer on small screens. A plain button so it is reachable by keyboard. */}
      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
        />
      )}

      {/* ── Left rail: the whole menu, vertical ─────────────────────────────────── */}
      <aside
        aria-label="Sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform duration-200 ease-out',
          // `invisible` as well as translated away: an off-screen rail is still in the tab order,
          // which would send a keyboard user through six invisible links on a phone.
          'md:visible md:translate-x-0',
          navOpen ? 'visible translate-x-0' : 'invisible -translate-x-full',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 sm:h-16">
          <BrandLink href="/" label={site.name} size={36} wordmarkClass="text-sm" />
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto p-3">
          <ul className="flex flex-col gap-1">
            {nav.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href)

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                    {active && <ChevronRight className="ml-auto size-3.5 opacity-60" />}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Bottom of the rail: who you are, the balance switch and the way out. */}
        <div className="shrink-0 border-t border-border p-3">
          <Link
            href="/profile"
            className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-secondary"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
              aria-hidden="true"
            >
              {avatar}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{displayName}</span>
              <span className="block truncate text-xs text-muted-foreground">View profile</span>
            </span>
          </Link>

          <div className="mt-2 flex items-center gap-2 rounded-xl border border-border/70 bg-muted/40 px-2 py-1.5">
            <BalanceToggle />
            <span className="text-[11px] leading-tight text-muted-foreground">Balances</span>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Content column ──────────────────────────────────────────────────────── */}
      <div className={cn('flex min-h-dvh flex-col', RAIL_WIDTH)}>
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:h-16 sm:gap-4 sm:px-6">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
            >
              <Menu className="size-5" />
            </button>

            <span className="text-sm font-semibold tracking-tight sm:text-base md:hidden">{site.name}</span>

            {/* On desktop the rail already carries the brand, so the bar carries the section. */}
            <span className="hidden text-sm font-semibold tracking-tight md:inline">
              {activeItem?.label ?? site.name}
            </span>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {worker?.kycVerified && worker?.phone && worker?.country && (
                <span className="hidden items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-xs font-medium text-success sm:inline-flex">
                  <ShieldCheck className="size-3.5" />
                  Verified
                </span>
              )}
              <span className="md:hidden">
                <BalanceToggle compact />
              </span>
              <NotificationsBell />
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

        {/* Page content */}
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 sm:py-8">
          {mode === 'demo' && (
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                Preview — the jobs shown here are examples and applications are not saved, so nothing you do on this
                site reaches your account.
              </span>
            </div>
          )}
          {children}
        </main>

        {/* Footer */}
        <footer className="mt-auto border-t border-border/60 bg-card/40 py-6">
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
      </div>
    </div>
  )
}
