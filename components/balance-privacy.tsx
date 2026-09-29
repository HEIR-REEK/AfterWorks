'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatKesValue, formatUsd } from '@/lib/afterworks-data'

/**
 * Balance visibility, shared across every money surface.
 *
 * This is a module-level store rather than context state on purpose: the member shell, the admin
 * console and the standalone wallet page all render balances, and a toggle in one of them has to
 * reach the others without threading a provider through three different trees. `useSyncExternalStore`
 * gives every consumer the same value with no re-mount penalty.
 */

const STORAGE_KEY = 'afterworks:balances-hidden'
const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'

const listeners = new Set<() => void>()

/** Reading is done once at module load so the first server render and the first client render agree. */
let hidden = false

function readStored(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Private mode / storage disabled: fall back to "visible" rather than locking the numbers away.
    return false
  }
}

function emit() {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  hidden = readStored()
  // A second tab toggling the same switch should not leave this one showing a stale choice.
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return
    const next = readStored()
    if (next !== hidden) {
      hidden = next
      emit()
    }
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Server snapshot: hidden balances are a client-only preference, so SSR always renders values. */
function getServerSnapshot() {
  return false
}

export function useBalanceHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden, getServerSnapshot)
}

export function useBalancePrivacy() {
  const isHidden = useBalanceHidden()

  const toggle = useCallback(() => {
    hidden = !hidden
    try {
      window.localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0')
    } catch {
      /* storage blocked — the in-memory value still drives the UI for this tab */
    }
    emit()
  }, [])

  const show = useCallback(() => {
    if (!hidden) return
    hidden = false
    try {
      window.localStorage.setItem(STORAGE_KEY, '0')
    } catch {
      /* ignore */
    }
    emit()
  }, [])

  const hide = useCallback(() => {
    if (hidden) return
    hidden = true
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
    emit()
  }, [])

  return { hidden: isHidden, toggle, show, hide }
}

/**
 * A dollar amount that turns into dots when balances are hidden.
 *
 * Always renders the masked string with the same `font-mono tabular-nums` treatment the rest of the
 * UI uses, so hiding a balance does not make a tile jump or reflow.
 */
export function Money({ value, className }: { value: number; className?: string }) {
  const isHidden = useBalanceHidden()
  return (
    <span className={cn('tabular-nums', className)} aria-hidden={isHidden || undefined}>
      {isHidden ? `$${MASK}` : formatUsd(value)}
    </span>
  )
}

/** A Kenyan-shilling amount that turns into dots when balances are hidden. */
export function KesMoney({ value, className }: { value: number; className?: string }) {
  const isHidden = useBalanceHidden()
  return (
    <span className={cn('tabular-nums', className)} aria-hidden={isHidden || undefined}>
      {isHidden ? `KSh ${MASK}` : formatKesValue(value)}
    </span>
  )
}

/** Any pre-formatted string (a total, a fee, a count) that should hide with the balances. */
export function MaskedValue({ value, className }: { value: string; className?: string }) {
  const isHidden = useBalanceHidden()
  return (
    <span className={cn('tabular-nums', className)} aria-hidden={isHidden || undefined}>
      {isHidden ? MASK : value}
    </span>
  )
}

/**
 * The eye switch itself. `aria-pressed` plus a live label so the control is legible to a screen
 * reader, which a bare icon toggle is not.
 */
export function BalanceToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { hidden: isHidden, toggle } = useBalancePrivacy()
  const label = isHidden ? 'Show balances' : 'Hide balances'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isHidden}
      aria-label={label}
      title={label}
      data-testid="balance-toggle"
      className={cn(
        'inline-flex items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact ? 'size-8' : 'size-9 gap-1.5 px-2.5 text-xs font-medium',
        isHidden && 'text-primary',
        className,
      )}
    >
      {isHidden ? <EyeOff className={compact ? 'size-4' : 'size-3.5'} /> : <Eye className={compact ? 'size-4' : 'size-3.5'} />}
      {!compact && <span className="hidden sm:inline">{isHidden ? 'Show' : 'Hide'}</span>}
    </button>
  )
}
