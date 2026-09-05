'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  ArrowUpRight,
  Briefcase,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  ScrollText,
  Shield,
  ShieldCheck,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'
import { useAdminSession } from '@/lib/admin'
import { useMaintenance } from '@/components/maintenance-provider'
import { BrandMark } from '@/components/brand'
import AdminLoginPage from './login/page'

// `ownerOnly` sections are hidden from staff sessions — the API guards enforce the same split,
// this just keeps the console honest about what each role can reach.
const adminNavItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Users & KYC', icon: Users },
  { href: '/admin/jobs', label: 'Jobs Catalogue', icon: Briefcase },
  { href: '/admin/applications', label: 'Applications & QA', icon: ListChecks },
  { href: '/admin/staff', label: 'Staff', icon: UserCog, ownerOnly: true },
  { href: '/admin/money', label: 'Money Ledger', icon: Landmark, ownerOnly: true },
  { href: '/admin/maintenance', label: 'Maintenance Mode', icon: Wrench, ownerOnly: true },
  { href: '/admin/audit-log', label: 'Audit Log', icon: ScrollText, ownerOnly: true },
  { href: '/admin/security', label: 'Security', icon: Shield, ownerOnly: true },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const session = useAdminSession()
  const { view } = useMaintenance()
  const [mounted, setMounted] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)

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

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Console header — same visual language as the worker shell, one notch denser. */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2.5">
            <BrandMark size={32} />
            <span className="text-sm font-semibold tracking-tight">
              AfterWorks
              <span className="ml-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                Ops
              </span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {view.blocking && (
              <StatusBadge tone="warning" className="hidden sm:inline-flex">
                <Wrench className="size-3" />
                Maintenance live
              </StatusBadge>
            )}
            {remaining !== null && (
              <span
                className={cn(
                  'hidden font-mono text-[11px] font-medium tabular sm:inline',
                  remaining < 300 ? 'text-destructive' : 'text-muted-foreground',
                )}
                title="Administrator sessions expire on their own; this one renews when you sign in again."
              >
                session {formatDuration(remaining)}
              </span>
            )}
            <span
              className={cn(
                'hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:inline',
                session.role === 'owner' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}
              title={session.role === 'owner' ? 'Main administrator — full console authority' : 'Staff — limited operations access'}
            >
              {session.role === 'owner' ? 'Owner' : 'Staff'}
            </span>
            <span className="hidden max-w-[16ch] truncate text-xs font-medium text-muted-foreground md:inline" title={session.email}>
              {session.email}
            </span>
            <Button render={<Link href="/" />} variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              Worker app
              <ArrowUpRight className="size-3.5" />
            </Button>
            <Button render={<Link href="/status" />} variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <Activity className="size-3.5" />
              <span className="hidden lg:inline">Status</span>
            </Button>
            <Button onClick={() => void session.signOut()} variant="outline" size="sm" className="gap-1.5">
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Sign out</span>
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

        <nav className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto border-b border-border px-1 pb-2.5 sm:gap-2" aria-label="Console sections">
          {adminNavItems.filter((item) => !item.ownerOnly || session.role === 'owner').map((item) => {
            const Icon = item.icon
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all sm:text-sm',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'border border-border/70 bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </main>
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
