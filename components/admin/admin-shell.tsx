'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Briefcase,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  UserCog,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/firebase-auth-provider'
import { useAdmin, clearDemoRole } from '@/components/admin-provider'
import { useMaintenance } from '@/components/maintenance-provider'
import logo from '@/components/logo.png'

const adminNav = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Users', icon: UserCog },
  { href: '/admin/kyc', label: 'KYC reviews', icon: ShieldCheck },
  { href: '/admin/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/admin/applications', label: 'Applications', icon: ClipboardList },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut, configured } = useAuth()
  const { isAdmin, demo } = useAdmin()
  const { maintenance } = useMaintenance()

  const displayName =
    user?.displayName || user?.email?.split('@')[0] || 'Admin'

  async function handleSignOut() {
    if (demo) clearDemoRole()
    else await signOut()
    router.replace('/sign-in')
  }

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href
    return pathname === href || pathname.startsWith(href + '/')
  }

  // Defensive: non-admins should never reach this shell (AppGate blocks first).
  if (!isAdmin) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <AlertTriangle className="size-10 text-warning" />
        <h1 className="text-xl font-semibold">Admin access required</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          You do not have permission to view the admin panel. If you believe this
          is a mistake, ask an existing admin to grant you access.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ArrowLeft className="size-4" />
          Back to AfterWorks
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh bg-muted/40">
      {/* ── Sidebar (desktop) ─────────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <Image src={logo} alt="AfterWorks" width={32} height={32} className="size-8 object-contain" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-tight">AfterWorks</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
              Admin panel
            </span>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Admin">
          {adminNav.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href, item.exact)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-border p-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to app
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Content column ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <Image src={logo} alt="AfterWorks" width={28} height={28} className="size-7 object-contain" />
            <span className="text-sm font-semibold">Admin panel</span>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary" aria-label="Back to app">
                <ArrowLeft className="size-4" />
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"
                aria-label="Sign out"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Admin mobile">
            {adminNav.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href, item.exact)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </header>

        {/* Banners */}
        {maintenance.enabled && (
          <div className="flex items-center justify-center gap-2 bg-warning/20 px-4 py-2 text-center text-xs font-medium text-warning-foreground">
            <AlertTriangle className="size-3.5 shrink-0" />
            Maintenance mode is ON — workers currently see the maintenance page.{' '}
            <Link href="/admin/settings" className="underline underline-offset-2">
              Manage
            </Link>
          </div>
        )}
        {demo && (
          <div className="flex items-center justify-center gap-2 bg-accent px-4 py-2 text-center text-xs font-medium text-accent-foreground">
            Demo mode — Firebase is not configured, so the panel runs on seeded
            data saved in this browser.
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {/* Admin identity chip */}
          <div className="mb-5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 font-medium text-success">
              <ShieldCheck className="size-3.5" />
              Signed in as admin
            </span>
            <span className="truncate">
              {configured ? user?.email ?? displayName : 'admin@afterworks.demo'}
            </span>
          </div>

          {children}
        </main>
      </div>
    </div>
  )
}
