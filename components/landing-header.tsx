'use client'

/**
 * Public header for the marketing page at `/`.
 *
 * Two jobs:
 *  1. Explain where to go — the page itself is a long read, so the section anchors are the
 *     navigation, and the two doors (log in / create account) are always visible.
 *  2. Answer the one question a returning member has before they scroll: *is there a way back into
 *     my workspace?* The header reads the Firebase session (the same provider the app uses) and,
 *     when someone is already signed in, swaps the two auth buttons for a dashboard link. It never
 *     gates anything — the gate still lives in `app-gate` and the route is public.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, LayoutDashboard, MailCheck, Menu, X } from 'lucide-react'
import { BrandLink } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/firebase-auth-provider'
import { cn } from '@/lib/utils'

const SECTION_LINKS = [
  { href: '#what', label: 'What it is' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#work', label: 'The work' },
  { href: '#training', label: 'Training' },
  { href: '#payouts', label: 'Payouts' },
  { href: '#faq', label: 'FAQ' },
] as const

export function LandingHeader() {
  const { user, loading, configured } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  // Auth state is client-only. Rendering the signed-out doors on both the server and the first
  // client render keeps hydration byte-for-byte identical; the session is applied in an effect,
  // once React owns the DOM. This is why a signed-in visitor may see the two doors for one frame
  // before the Dashboard button appears.
  const [mounted, setMounted] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Only trust the session once this component has hydrated and Firebase has finished restoring
  // it. While either is pending we show the signed-out doors, which is the correct answer for
  // almost every visitor to a marketing page.
  const signedIn = mounted && configured && !loading && Boolean(user)
  const needsVerification = signedIn && user?.emailVerified === false

  // A little translucency at the top of the page, then a more solid header once the page moves.
  // This is deliberately a *slight* effect: the header must never become fully transparent.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    // Close on a press anywhere outside the menu. A full-screen click-away layer would be the
    // tidier-looking option, but this header uses `backdrop-blur` — and a backdrop filter makes
    // the header the containing block for `position: fixed` descendants, so a "fixed inset-0"
    // overlay would be clipped to the header instead of covering the page.
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown, { passive: true })
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [menuOpen])

  return (
    <header
      className={cn(
        'sticky top-0 z-50 border-b backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-300',
        scrolled || menuOpen
          ? 'border-border/80 bg-background/95 shadow-sm'
          : 'border-border/45 bg-background/75',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <BrandLink
          href="/"
          label="AfterWorks"
          size={32}
          wordmarkClass="sr-only min-[420px]:not-sr-only"
          className="rounded-lg focus-visible:outline-offset-4"
          markClassName="bg-transparent ring-0"
        />

        <nav aria-label="Page sections" className="ml-6 hidden items-center gap-1 lg:flex">
          {SECTION_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/work"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:block"
          >
            Open work
          </Link>
          {signedIn ? (
            <Button
              render={<Link href={needsVerification ? '/verify-email' : '/dashboard'} />}
              size="sm"
              className="h-9 gap-1.5 px-3.5 text-sm"
            >
              {needsVerification ? <MailCheck className="size-4" /> : <LayoutDashboard className="size-4" />}
              <span className="hidden min-[360px]:inline">{needsVerification ? 'Verify email' : 'Dashboard'}</span>
              <span className="min-[360px]:hidden">{needsVerification ? 'Verify' : 'Open'}</span>
            </Button>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="inline-flex min-h-10 items-center rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:px-3"
              >
                Log in
              </Link>
              <Button render={<Link href="/sign-up" />} size="sm" className="h-9 gap-1.5 px-3.5 text-sm sm:px-4">
                Create account
                <ArrowRight className="hidden size-3.5 sm:block" />
              </Button>
            </>
          )}

          <div ref={menuRef} className="relative lg:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              className="-mr-1 grid size-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9"
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>

            {menuOpen ? (
              <nav
                id="landing-mobile-menu"
                aria-label="Page sections"
                className="absolute right-0 top-11 z-50 w-60 rounded-xl border border-border bg-card p-2 shadow-xl shadow-foreground/10"
              >
                <Link
                  href="/work"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  Open work
                </Link>
                {SECTION_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      'block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors',
                      'hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}
