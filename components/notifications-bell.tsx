'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { fetchNotifications, markNotificationsRead, type NotificationRow } from '@/lib/firestore'
import { useAuth } from '@/components/firebase-auth-provider'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const TONE = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
} as const

/**
 * In-app notification centre.
 *
 * Workers previously learned that their KYC passed or that a submission failed QA by refreshing the
 * profile page and eyeballing a badge. Decisions the console makes now arrive here, with the same
 * timestamp the audit log carries, so "I never got the email" has an answer on screen.
 */
export function NotificationsBell({ className }: { className?: string }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(
    async (silent = true) => {
      if (!user) return
      if (!silent) setLoading(true)
      const result = await fetchNotifications(20)
      setItems(result.notifications)
      setUnread(result.unread)
      setLoading(false)
    },
    [user],
  )

  useEffect(() => {
    if (!user) {
      setItems([])
      setUnread(0)
      return
    }
    void load(false)
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 45_000)
    return () => clearInterval(id)
  }, [user, load])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  const markAll = async () => {
    setItems((prev) => prev.map((item) => ({ ...item, read: true })))
    setUnread(0)
    await markNotificationsRead()
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          if (!open) void load()
        }}
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        className={cn(
          'relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9',
          className,
        )}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border/70 px-3.5 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                <CheckCheck className="size-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <Inbox className="size-5 text-muted-foreground/60" />
                <p className="text-xs text-muted-foreground">
                  {loading ? 'Loading…' : 'Nothing yet. Job decisions and payout updates appear here.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {items.map((item) => (
                  <li key={item.id} className={cn('px-3.5 py-3', !item.read && 'bg-primary/[0.04]')}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
                      <StatusBadge tone={TONE[(item.tone ?? 'info') as keyof typeof TONE]} className="shrink-0">
                        {item.read ? 'read' : 'new'}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <time className="text-[11px] text-muted-foreground/80" dateTime={item.createdAt}>
                        {relativeTime(item.createdAt)}
                      </time>
                      {item.link ? (
                        <Link href={item.link} onClick={() => setOpen(false)} className="text-[11px] font-medium text-primary hover:underline">
                          Open
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border/70 p-2.5">
            <Button render={<Link href="/applications" />} variant="ghost" size="sm" className="w-full justify-center" onClick={() => setOpen(false)}>
              View applications
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function relativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
