'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Briefcase,
  LayoutDashboard,
  ListChecks,
  LogOut,
  ShieldCheck,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/firebase-auth-provider'
import { useAfterWorks } from '@/components/afterworks-provider'
import logo from '@/components/logo.png'

function initials(nameOrEmail: string) {
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail
  const parts = base.replace(/[._-]/g, ' ').trim().split(/\s+/)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}

const nav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Browse jobs', icon: Briefcase },
  { href: '/applications', label: 'My applications', icon: ListChecks },
  { href: '/profile', label: 'Profile', icon: User },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { worker } = useAfterWorks()

  const displayName = user?.displayName || user?.email || 'Worker'
  const avatar = initials(displayName).toUpperCase() || 'W'

  async function handleSignOut() {
    await signOut()
    router.replace('/sign-in')
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src={logo}
              alt="AfterWorks"
              width={48}
              height={48}
              className="h-12 w-12 object-contain"
            />
            <span className="text-base font-semibold tracking-tight">AfterWorks</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {nav.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive(item.href)
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {worker?.kycVerified && worker?.phone && worker?.country && (
              <span className="hidden items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-xs font-medium text-success sm:inline-flex">
                <ShieldCheck className="size-3.5" />
                Verified
              </span>
            )}
            <div
              className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
              title={displayName}
              aria-label={`Signed in as ${displayName}`}
            >
              {avatar}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="sticky bottom-0 z-40 grid grid-cols-4 border-t border-border bg-background/95 backdrop-blur md:hidden"
        aria-label="Primary mobile"
      >
        {nav.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors',
                isActive(item.href) ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
