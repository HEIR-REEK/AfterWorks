'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, CheckCheck, Loader2, ShieldCheck } from 'lucide-react'
import { useAdminSession } from '@/lib/admin'
import { apiFetch } from '@/lib/client-api'
import { AdminCard, useToasts } from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'

/**
 * Console notifications — the on-site alert feed for owner and staff.
 *
 * Events like "a member requested verification" land here server-side the moment they happen,
 * so the team does not need email or SMS to notice. The bell in the header polls the unread
 * count; this page lists the feed and lets anyone mark items (or all) read.
 */

type Notice = {
  id: string
  title: string
  body: string
  tone: string
  link: string
  actorEmail: string
  read: boolean
  createdAt: string
}

const TONE: Record<string, 'info' | 'warning' | 'danger' | 'success'> = {
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
}

export default function AdminNotificationsPage() {
  const session = useAdminSession()
  const { push } = useToasts()
  const [loading, setLoading] = useState(true)
  const [notices, setNotices] = useState<Notice[]>([])
  const [unread, setUnread] = useState(0)
  const [available, setAvailable] = useState(true)
  const [marking, setMarking] = useState(false)

  const load = useCallback(async () => {
    if (session.status !== 'authorized') return
    setLoading(true)
    try {
      const data = await apiFetch<{ notifications?: Notice[]; unread?: number; available?: boolean }>('/api/admin/notifications?limit=60')
      setNotices(Array.isArray(data.notifications) ? data.notifications : [])
      setUnread(Number(data.unread) || 0)
      setAvailable(data.available !== false)
    } catch {
      push('error', 'Could not load notifications.')
    } finally {
      setLoading(false)
    }
  }, [session.status, push])

  useEffect(() => {
    void load()
  }, [load])

  const markAllRead = async () => {
    setMarking(true)
    try {
      await apiFetch<{ ok: boolean }>('/api/admin/notifications', { method: 'PATCH', body: { ids: [] } })
      push('success', 'All notifications marked as read.')
      await load()
    } catch {
      push('error', 'Could not mark notifications as read.')
    } finally {
      setMarking(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Bell className="size-5 text-primary" />
            Console notifications
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            On-site alerts for the team — e.g. a member requesting verification. No email or SMS involved.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && <StatusBadge tone="warning">{unread} unread</StatusBadge>}
          <Button size="sm" variant="outline" onClick={() => void markAllRead()} disabled={marking || unread === 0} className="gap-1.5">
            {marking ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
            Mark all read
          </Button>
        </div>
      </div>

      <AdminCard>
        {!available ? (
          <p className="p-4 text-sm text-muted-foreground">Notifications are unavailable (storage not configured).</p>
        ) : loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading notifications…
          </p>
        ) : notices.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No notifications yet. When a member requests verification, it will appear here and on the bell in the header.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {notices.map((n) => (
              <li key={n.id} className={cn('flex items-start gap-3 p-4', !n.read && 'bg-primary/5')}>
                <span className={cn('mt-1 size-2 shrink-0 rounded-full', n.read ? 'bg-muted-foreground/30' : 'bg-primary')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{n.title}</p>
                    <StatusBadge tone={TONE[n.tone] ?? 'info'}>{n.tone || 'info'}</StatusBadge>
                    <span className="text-[11px] text-muted-foreground">
                      {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{n.body}</p>
                  {n.actorEmail && <p className="mt-0.5 text-[11px] text-muted-foreground">from {n.actorEmail}</p>}
                </div>
                {n.link && (
                  <Button render={<Link href={n.link} />} size="sm" variant="outline" className="shrink-0 gap-1.5">
                    <ShieldCheck className="size-3.5" />
                    Open
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  )
}
