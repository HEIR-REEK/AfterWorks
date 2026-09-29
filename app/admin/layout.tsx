'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  ArrowUpRight,
  Banknote,
  Briefcase,
  ChevronRight,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  Menu,
  ScrollText,
  Shield,
  ShieldCheck,
  UserCog,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'
import { useAdminSession } from '@/lib/admin'
import { useMaintenance } from '@/components/maintenance-provider'
import { BrandMark } from '@/components/brand'
import { AdminIdleGuard } from '@/components/admin-idle-guard'
import AdminLoginPage from './login/page'

// `ownerOnly` sections are hidden from staff sessions — the API guards enforce the same split,
// this just keeps the console honest about what each role can reach.
const adminNavItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Users & KYC', icon: Users },
  { href: '/admin/jobs', label: 'Jobs Catalogue', icon: Briefcase },
  { href: '/admin/applications', label: 'Applications & QA', icon: ListChecks },
  { href: '/admin/staff', label: 'Staff', icon: UserCog, ownerOnly: true },
  { href: '/admin/payouts', label: 'Withdrawals', icon: Banknote },
  { href: '/admin/money', label: 'Money Ledger', icon: Landmark, ownerOnly: true },
  { href: '/admin/maintenance', label: 'Maintenance Mode', icon: Wrench, ownerOnly: true },
  { href: '/admin/audit-log', label: 'Audit Log', icon: ScrollText, ownerOnly: true },
  { href: '/admin/security', label: 'Security', icon: Shield, ownerOnly: true },
]

/** Width of the fixed left rail; the content column is padded by exactly this. */
const RAIL_WIDTH = 'xl:pl-72'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const session = useAdminSession()
  const { view } = useMaintenance()
  const [mounted, setMounted] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => setMounted(true), [])

  // Live countdown so an operator is not surprised by a mid-task logout.
  useEffect(() => {
    if (session.status !== 'authorized' || !session.remainingSeconds) {
      setRemaining(null)
      return
    }
    setRemaining(session.remainingSeconds)
    const id = setInterval(() => setRemaining((value) => (value === null ? null : Math.max(0, value - 1))), 1000)
    return () => clearInterval(id)
  }, [session.status, session.remainingSeconds])

  const isLoginPage = pathname === '/admin/login'

  // Leaving a section from inside the drawer closes it, so the rail never covers the page opened.
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!navOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  if (isLoginPage) return <>{children}</>

  if (!mounted || session.status === 'checking') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-foreground">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-xs font-medium text-muted-foreground">Verifying administrator session…</p>
      </div>
    )
  }

  if (session.status !== 'authorized') {
    return <AdminLoginPage />
  }

  const visibleNav = adminNavItems.filter((item) => !item.ownerOnly || session.role === 'owner')

  function isActive(href: string, exact = false) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  const activeItem = visibleNav.find((item) => isActive(item.href, item.exact))

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Ends an inactive console session — the console is excluded from the member idle guard, so
          this is its own. See components/admin-idle-guard.tsx. */}
      <AdminIdleGuard />

      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm xl:hidden"
        />
      )}

      {/* ── Left rail: every console section, vertical ──────────────────────────── */}
      <aside
        aria-label="Console sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card transition-transform duration-200 ease-out',
          // `invisible` as well as translated away: an off-screen rail is still in the tab order,
          // which would send a keyboard user through a dozen invisible links on a tablet.
          'xl:visible xl:translate-x-0',
          navOpen ? 'visible translate-x-0' : 'invisible -translate-x-full',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Link href="/admin" className="flex items-center gap-2.5">
            <BrandMark size={32} />
            <span className="text-sm font-semibold tracking-tight">
              AfterWorks
              <span className="ml-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                Ops
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground xl:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav aria-label="Console sections" className="flex-1 overflow-y-auto p-3">
          <ul className="flex flex-col gap-1">
            {visibleNav.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href, item.exact)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                    {active && <ChevronRight className="ml-auto size-3.5 opacity-70" />}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Bottom of the rail: session identity, the way out, and the two exit links. */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                  session.role === 'owner' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {session.role === 'owner' ? 'Owner' : 'Staff'}
              </span>
              {remaining !== null && (
                <span
                  className={cn(
                    'ml-auto font-mono text-[11px] font-medium tabular',
                    remaining < 300 ? 'text-destructive' : 'text-muted-foreground',
                  )}
                  title="Administrator sessions expire on their own; this one renews when you sign in again."
                >
                  {formatDuration(remaining)}
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-xs font-medium text-foreground" title={session.email}>
              {session.email}
            </p>
            {view.blocking && (
              <div className="mt-2">
                <StatusBadge tone="warning">
                  <Wrench className="size-3" />
                  Maintenance live
                </StatusBadge>
              </div>
            )}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Button render={<Link href="/" />} variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              Worker app
              <ArrowUpRight className="size-3.5" />
            </Button>
            <Button render={<Link href="/status" />} variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <Activity className="size-3.5" />
              Status
            </Button>
          </div>

          <Button
            onClick={() => void session.signOut()}
            variant="outline"
            size="sm"
            className="mt-2 w-full gap-1.5"
          >
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* ── Content column ──────────────────────────────────────────────────────── */}
      <div className={cn('flex min-h-dvh flex-col', RAIL_WIDTH)}>
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground xl:hidden"
            >
              <Menu className="size-5" />
            </button>
            <span className="text-sm font-semibold tracking-tight xl:hidden">
              AfterWorks <span className="text-muted-foreground">Ops</span>
            </span>
            <span className="hidden text-sm font-semibold tracking-tight xl:inline">
              {activeItem?.label ?? 'Console'}
            </span>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {view.blocking && (
                <StatusBadge tone="warning" className="sm:hidden">
                  <Wrench className="size-3" />
                  Maintenance
                </StatusBadge>
              )}
              {remaining !== null && (
                <span
                  className={cn(
                    'font-mono text-[11px] font-medium tabular xl:hidden',
                    remaining < 300 ? 'text-destructive' : 'text-muted-foreground',
                  )}
                  title="Administrator sessions expire on their own; this one renews when you sign in again."
                >
                  {formatDuration(remaining)}
                </span>
              )}
              <span
                className={cn(
                  'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider xl:hidden',
                  session.role === 'owner' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {session.role === 'owner' ? 'Owner' : 'Staff'}
              </span>
              <Button render={<Link href="/" />} variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <span className="hidden lg:inline">Worker app</span>
                <ArrowUpRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6">
          {session.via === 'firebase-token' && (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-xs text-warning-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <span>
                You are using a Firebase ID token session (used by tooling). For day-to-day work, sign in at{' '}
                <Link href="/admin/login" className="font-semibold underline">
                  /admin/login
                </Link>{' '}
                so your session is revocable and time-limited.
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1">{children}</div>
        </main>
      </div>
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'expiring'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}
