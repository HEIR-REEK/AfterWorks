'use client'

/**
 * Idle sign-out for the operations console.
 *
 * The member app has had `IdleSessionGuard` for a while, and it deliberately skips `/admin` ("the
 * console has its own session"). That was true and incomplete: the console's session was a
 * 240-minute cookie with a visible countdown, which covers "the tab is open and I can see it" and
 * nothing else. An operator who signs in at a cyber, walks away with the console open, and comes
 * back after lunch gets no prompt at all — and there is no equivalent of the member guard to end it.
 *
 * So this is the console's half of the same rule, with its own exit:
 *
 *  • the budget is the shared idle configuration (`NEXT_PUBLIC_ADMIN_IDLE_TIMEOUT_MINUTES`, falling
 *    back to `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES`, then to ten minutes), clamped by the same tested
 *    resolver the member guard uses;
 *  • a countdown appears before it fires, so nobody is thrown out mid-task without warning;
 *  • expiry calls the *console* sign-out — `POST /api/admin/session` clears the cookie and revokes
 *    the session id server-side — and then navigates to `/admin/login?reason=idle`, which explains
 *    what happened.
 *
 * Visibility alone is not activity, exactly as in the member guard: a tab left open overnight is
 * the case this exists for, so only real input resets the clock.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAdminSession } from '@/lib/admin'
import { resolveIdleGuardConfig } from '@/components/idle-session-guard'

const TICK_MS = 1_000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

export function AdminIdleGuard() {
  const session = useAdminSession()
  const config = resolveIdleGuardConfig(
    process.env.NEXT_PUBLIC_ADMIN_IDLE_TIMEOUT_MINUTES ?? process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES,
  )
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const lastActivity = useRef(Date.now())
  const fired = useRef(false)
  // The session object is rebuilt on every probe; read `signOut` through a ref so the timers below
  // are not torn down and restarted (which would silently reset the clock).
  const signOutRef = useRef(session.signOut)
  signOutRef.current = session.signOut

  const authorised = session.status === 'authorized'

  const touch = useCallback(() => {
    lastActivity.current = Date.now()
    setRemainingMs(null)
  }, [])

  useEffect(() => {
    if (!authorised || !config.enabled) return
    const onActivity = () => touch()
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { passive: true })
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity)
    }
  }, [authorised, config.enabled, touch])

  useEffect(() => {
    if (!authorised || !config.enabled) {
      setRemainingMs(null)
      return
    }
    const id = setInterval(() => {
      const idle = Date.now() - lastActivity.current
      const left = config.timeoutMs - idle
      if (left > 0) {
        setRemainingMs(left <= config.warningMs ? left : null)
        return
      }
      if (fired.current) return
      fired.current = true
      void (async () => {
        try {
          await signOutRef.current()
        } catch {
          /* the redirect below is the backstop either way */
        }
        // Full navigation, so no console state (a member's wallet, a payout queue) survives in
        // memory on a machine somebody else is about to use.
        window.location.replace('/admin/login?reason=idle')
      })()
    }, TICK_MS)
    return () => clearInterval(id)
  }, [authorised, config.enabled, config.timeoutMs, config.warningMs])

  if (!authorised || !config.enabled || remainingMs === null) return null

  const seconds = Math.ceil(remainingMs / 1000)
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-[60] flex max-w-xs flex-col gap-2.5 rounded-xl border border-warning/50 bg-card p-3.5 shadow-xl"
    >
      <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Clock3 className="size-4 text-amber-600 dark:text-amber-400" />
        Signing you out in {seconds}s
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The console ends an inactive session so a machine left unattended cannot be used to move money or change
        accounts.
      </p>
      <Button size="sm" className="gap-1.5 self-end" onClick={touch}>
        Stay signed in
      </Button>
    </div>
  )
}
