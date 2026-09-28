'use client'

/**
 * Idle session guard — "if the tab is left open on a device nobody is using, close it down".
 *
 * The failure this exists for is not a stolen password; it is a phone left face-up on a matatu
 * bench, a laptop left signed in at a cyber, a tablet handed to the next person. AfterWorks holds
 * a wallet, a KYC record and a payout destination, so an unattended *signed-in* tab is a real
 * exposure, and a plain session cookie is not enough: the Firebase ID token lives in IndexedDB
 * and is replayed for a month.
 *
 * The rule: ten minutes without a keystroke, a tap, a scroll or a wheel ends the session — sign
 * out, then a full page load so nothing survives in memory. The page genuinely reloads, rather
 * than only refreshing data, because a half-rehydrated app shell on someone else's screen is still
 * a window into somebody's account.
 *
 * Three deliberate decisions:
 *
 *  • **A warning, not a cliff.** At `TIMEOUT - WARNING_MS` a countdown appears. Whoever is there
 *    presses "Stay signed in" and the clock resets; whoever is not gets signed out, which is the
 *    outcome they were never going to be awake for anyway. A guard that logs people out mid-task
 *    without a countdown would be reported as a bug within a day.
 *  • **Visibility is not activity.** A tab in the background does not reset the clock — a tab
 *    sitting idle on a charger for an hour must time out, which is the entire scenario. Only a
 *    real interaction counts, so coming back to the tab and touching it is enough to stay in.
 *  • **Signed out is a no-op.** The timer only runs with a session, so public pages (the job
 *    board's marketing, the sign-in form) are never touched.
 *
 * `IDLE_TIMEOUT_MINUTES` is overridable per deployment via `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES`,
 * clamped to a sane band, and `0` disables the guard entirely for an operator who would rather
 * manage long sessions manually.
 *
 * It deliberately does not run on `/admin`. The console has its own session — a signed HttpOnly
 * cookie with its own visible countdown — and this guard ends the *member's* Firebase session, so
 * running both would reload an operator's screen out from under them without ending the session
 * they were actually working in.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Clock3 } from 'lucide-react'
import { useAuth } from '@/components/firebase-auth-provider'
import { Button } from '@/components/ui/button'

/** How long a tab may sit untouched before the session ends. */
export const IDLE_TIMEOUT_MINUTES = 10
/** The countdown the member gets to prove they are still there. */
export const IDLE_WARNING_MS = 60_000
/** How often the clock is recomputed. One second, because the UI counts down in seconds. */
const TICK_MS = 1_000

export type IdleGuardConfig = {
  /** Total idle budget in ms. */
  timeoutMs: number
  /** How long before the budget expires the warning appears. */
  warningMs: number
  /** False when the deployment has switched the guard off. */
  enabled: boolean
}

const MIN_MINUTES = 1
const MAX_MINUTES = 120

/**
 * Reads the override from the environment.
 *
 * Exported (and pure) so it can be tested without a bundler, and so the "switch it off" story is
 * one documented value rather than a branch spread across the component. Anything unparseable,
 * zero or out of band falls back to the default rather than locking people out on a typo.
 */
export function resolveIdleGuardConfig(raw: string | undefined | null = null): IdleGuardConfig {
  const source = String(
    raw ?? (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES : '') ?? '',
  ).trim()
  const minutes = Number(source)
  const defaults = { timeoutMs: IDLE_TIMEOUT_MINUTES * 60_000, warningMs: IDLE_WARNING_MS }
  // `Number('')` is 0, so an unset value lands here alongside nonsense — and both mean "default".
  if (!Number.isFinite(minutes) || minutes <= 0) {
    // The one value that is a *decision* rather than an absence: 0 switches the guard off.
    return source === '0' ? { ...defaults, enabled: false } : { ...defaults, enabled: true }
  }
  const clamped = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)))
  return {
    timeoutMs: clamped * 60_000,
    // A long window must still leave room for the countdown to be readable.
    warningMs: Math.min(IDLE_WARNING_MS, Math.floor((clamped * 60_000) / 2)),
    enabled: true,
  }
}

export function IdleSessionGuard() {
  const { user, signOut } = useAuth()
  const pathname = usePathname()
  const config = resolveIdleGuardConfig()
  const inConsole = pathname.startsWith('/admin')
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const lastActivity = useRef<number>(Date.now())
  // `signOut` is recreated on every auth-state change, so the timer reads it through a ref rather
  // than re-subscribing (and resetting the clock) each time the provider re-renders.
  const signOutRef = useRef(signOut)
  signOutRef.current = signOut

  const touch = useCallback(() => {
    lastActivity.current = Date.now()
    setRemainingMs(null)
  }, [])

  const signOutAndReload = useCallback(() => {
    void (async () => {
      try {
        await signOutRef.current()
      } catch {
        /* the reload below is the backstop either way */
      }
      // Full navigation, not a soft refresh: every in-memory copy of the worker's wallet, KYC
      // state and profile is discarded with the document.
      const here = `${window.location.pathname}${window.location.search}`
      const next = here.startsWith('/sign-in') ? here : '/sign-in?reason=idle'
      window.location.replace(next)
    })()
  }, [])

  // Activity listeners. `passive` so a scroll handler can never delay a scroll on a low-end phone.
  useEffect(() => {
    if (!user || !config.enabled || inConsole) return
    // Start the budget at the moment the session starts, not at mount. The guard is mounted for
    // the whole app — including the pages a visitor reads *before* signing in — so without this,
    // somebody who left the sign-in page open for ten minutes and only then signed in would be
    // signed straight back out. The click that signed them in happened before any listener existed.
    lastActivity.current = Date.now()
    setRemainingMs(null)
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove']
    for (const event of events) window.addEventListener(event, touch, { passive: true })

    const interval = setInterval(() => {
      const idleFor = Date.now() - lastActivity.current
      if (idleFor >= config.timeoutMs) {
        clearInterval(interval)
        signOutAndReload()
        return
      }
      setRemainingMs(idleFor >= config.timeoutMs - config.warningMs ? Math.max(0, config.timeoutMs - idleFor) : null)
    }, TICK_MS)

    return () => {
      clearInterval(interval)
      for (const event of events) window.removeEventListener(event, touch)
    }
  }, [user, config.enabled, config.timeoutMs, config.warningMs, inConsole, touch, signOutAndReload])

  // Put the keyboard on the button that cancels the sign-out the moment the warning appears, and
  // let Escape mean the same thing. Anything less and a keyboard user has to hunt for the control
  // during a one-minute countdown.
  const stayRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (remainingMs === null) return
    stayRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') touch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [remainingMs === null, touch])

  if (remainingMs === null) return null

  const seconds = Math.ceil(remainingMs / 1000)
  const minutesLeft = Math.floor(seconds / 60)
  const secondsLeft = String(seconds % 60).padStart(2, '0')

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-guard-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-warning/15">
          <Clock3 className="size-5 text-warning" aria-hidden="true" />
        </div>
        <h2 id="idle-guard-title" className="text-base font-semibold tracking-tight">
          Still there?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          AfterWorks signs you out after {Math.round(config.timeoutMs / 60_000)} minutes of inactivity, so nobody
          else can use this device while it is unattended.
        </p>
        <p className="mt-3 font-mono text-2xl font-semibold tabular-nums text-foreground" aria-live="polite">
          {minutesLeft}:{secondsLeft}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button ref={stayRef} size="lg" className="w-full" onClick={touch}>
            Stay signed in
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="w-full"
            onClick={async () => {
              touch()
              await signOut()
            }}
          >
            Sign out now
          </Button>
        </div>
      </div>
    </div>
  )
}
