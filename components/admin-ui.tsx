'use client'

/**
 * Shared console primitives.
 *
 * The admin pages previously repeated the same card/section/toast markup in five files with slightly
 * different spacing and copy, which is how "looks like a different product than the site" happens.
 * These compose the same tokens the worker app uses (card, border-border, primary/success/warning),
 * so the console is obviously the same product with a different job.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function AdminCard({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon && <span className="mt-0.5 shrink-0 text-primary">{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">{title}</h2>}
              {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('min-w-0', bodyClassName)}>{children}</div>
    </section>
  )
}

export function AdminStat({
  label,
  value,
  sub,
  icon,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'primary'
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-destructive',
    primary: 'text-primary',
  }[tone]

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/80 bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon && <span className={cn('shrink-0', toneClass)}>{icon}</span>}
      </div>
      <p className={cn('font-mono text-xl font-semibold leading-none tabular', toneClass)}>{value}</p>
      {sub && <p className="text-[11px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  )
}

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export type ToastMessage = { kind: ToastKind; text: string; id: number }

/** Small local toast queue — no new dependency, auto-dismisses, focus-safe. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, text: string, ttlMs = 4500) => {
      const id = ++counter.current
      setToasts((prev) => [...prev.slice(-3), { kind, text, id }])
      if (ttlMs > 0) setTimeout(() => dismiss(id), ttlMs)
      return id
    },
    [dismiss],
  )

  const node = toasts.length ? (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-lg backdrop-blur',
            toast.kind === 'success' && 'border-success/30 bg-success/10 text-success',
            toast.kind === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
            toast.kind === 'warning' && 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
            toast.kind === 'info' && 'border-border bg-card text-foreground',
          )}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : toast.kind === 'error' ? (
            <XCircle className="mt-0.5 size-4 shrink-0" />
          ) : toast.kind === 'warning' ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 whitespace-pre-line leading-relaxed">{toast.text}</span>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="shrink-0 opacity-60 transition-opacity hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  ) : null

  return { push, dismiss, toasts: node }
}

/**
 * Destructive/money actions require a typed reason. This is the cheapest way to make the audit log
 * useful: without it, "ADMIN_BANNED_USER {}" tells the next person nothing.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'destructive',
  requireReason = true,
  minReasonLength = 4,
  busy = false,
  onCancel,
  onConfirm,
  extra,
}: {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  tone?: 'destructive' | 'default'
  requireReason?: boolean
  minReasonLength?: number
  busy?: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
  /** Optional extra fields rendered under the reason box. */
  extra?: ReactNode
}) {
  const [reason, setReason] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (open) {
      setReason('')
      const id = setTimeout(() => inputRef.current?.focus(), 40)
      return () => clearTimeout(id)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const invalid = requireReason && reason.trim().length < minReasonLength

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-foreground/40 p-3 backdrop-blur-sm sm:items-center" onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
        {description && <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</div>}

        <label className="mt-4 block text-xs font-semibold text-foreground">
          {requireReason ? 'Reason (written to the audit log)' : 'Note (optional)'}
        </label>
        <textarea
          ref={inputRef}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={requireReason ? 'e.g. Duplicate audio segments after 04:12, asked for a re-cut' : 'Optional context for the record'}
          className={cn(
            'mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none',
            invalid ? 'border-destructive/50 focus:border-destructive' : 'border-border focus:border-primary',
          )}
        />
        {extra}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            disabled={busy || invalid}
            onClick={() => onConfirm(reason.trim())}
            className="gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-semibold text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60'

export function LiveDot({ tone = 'success', label }: { tone?: 'success' | 'warning' | 'danger' | 'muted'; label?: string }) {
  const dot = {
    success: 'bg-success',
    warning: 'bg-amber-500',
    danger: 'bg-destructive',
    muted: 'bg-muted-foreground/50',
  }[tone]
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className={cn('size-2 rounded-full', dot, tone !== 'muted' && 'animate-blink')} />
      {label}
    </span>
  )
}

export function Pager({
  hasMore,
  loading,
  onPrev,
  onNext,
  pageLabel,
}: {
  hasMore: boolean
  loading?: boolean
  onPrev: () => void
  onNext: () => void
  pageLabel: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
      <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={loading}>
        Previous
      </Button>
      <span className="text-[11px] font-medium text-muted-foreground">
        {loading ? <Loader2 className="inline size-3 animate-spin" /> : pageLabel}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={!hasMore || loading}>
        Next
      </Button>
    </div>
  )
}
