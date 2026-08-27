'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Clock,
  ExternalLink,
  KeyRound,
  Loader2,
  Save,
  ShieldCheck,
  AlertTriangle,
  Wrench,
} from 'lucide-react'
import { useMaintenance } from '@/components/maintenance-provider'
import { useAdmin } from '@/components/admin-provider'
import {
  AdminCard,
  AdminSectionHeader,
  Field,
  ReasonInput,
  TextInput,
  Toggle,
} from '@/components/admin/ui'
import { Button } from '@/components/ui/button'
import { DEFAULT_MAINTENANCE_MESSAGE } from '@/lib/admin-data'
import { formatDateTime } from '@/lib/admin-data'

export default function AdminSettingsPage() {
  const { maintenance, updateMaintenance } = useMaintenance()
  const { isAdmin, checking, refresh } = useAdmin()

  const [enabled, setEnabled] = useState(maintenance.enabled)
  const [message, setMessage] = useState(maintenance.message)
  const [estimatedUntil, setEstimatedUntil] = useState(maintenance.estimatedUntil ?? '')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)

  // Sync local form when the server state changes (e.g. another admin).
  useEffect(() => {
    setEnabled(maintenance.enabled)
    setMessage(maintenance.message)
    setEstimatedUntil(maintenance.estimatedUntil ?? '')
  }, [maintenance.enabled, maintenance.message, maintenance.estimatedUntil])

  const dirty =
    enabled !== maintenance.enabled ||
    message !== maintenance.message ||
    estimatedUntil !== (maintenance.estimatedUntil ?? '')

  async function handleSave() {
    setSaving(true)
    setFeedback(null)
    const res = await updateMaintenance({
      enabled,
      message: message.trim() || DEFAULT_MAINTENANCE_MESSAGE,
      estimatedUntil: estimatedUntil.trim() || undefined,
    })
    setSaving(false)
    setFeedback(
      res.ok
        ? {
            ok: true,
            text: enabled
              ? 'Maintenance mode is now ON — all workers see the maintenance page.'
              : 'Maintenance mode is OFF — the site is live for everyone.',
          }
        : { ok: false, text: res.error ?? 'Failed to save.' },
    )
    setConfirming(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title="Settings"
        description="Platform-wide controls."
      />

      {/* ── Maintenance mode ─────────────────────────────────────────────── */}
      <AdminCard className={enabled ? 'border-warning/50' : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <span
              className={
                'flex size-10 shrink-0 items-center justify-center rounded-xl ' +
                (enabled ? 'bg-warning/20 text-warning-foreground' : 'bg-muted text-muted-foreground')
              }
            >
              <Wrench className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold">Maintenance mode</h2>
              <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
                When enabled, every signed-out visitor and worker sees the
                maintenance page. Admins keep full access, and worker-facing
                APIs (KYC, payments, wallet) start rejecting requests with 503.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={
                'text-sm font-semibold ' + (enabled ? 'text-warning-foreground' : 'text-muted-foreground')
              }
            >
              {enabled ? 'ON' : 'OFF'}
            </span>
            <Toggle
              checked={enabled}
              onChange={(next) => {
                setEnabled(next)
                setFeedback(null)
                if (next) setConfirming(true)
              }}
              label="Toggle maintenance mode"
            />
          </div>
        </div>

        {enabled && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              The site is currently in maintenance. Workers see{' '}
              <Link href="/maintenance" target="_blank" className="font-semibold underline underline-offset-2">
                the maintenance page
              </Link>
              .
            </span>
          </div>
        )}

        <div className="mt-5 grid gap-4">
          <Field label="Message shown to visitors" hint="Keep it friendly and reassure workers about their earnings.">
            <ReasonInput value={message} onChange={setMessage} placeholder={DEFAULT_MAINTENANCE_MESSAGE} />
          </Field>
          <Field label="Estimated back at (optional)" hint='Free text, e.g. "Today, 9 PM EAT" or "Sunday morning".'>
            <TextInput
              value={estimatedUntil}
              onChange={(e) => setEstimatedUntil(e.target.value)}
              placeholder="Today, 9 PM EAT"
            />
          </Field>
        </div>

        {confirming && (
          <div className="mt-4 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
            <p className="font-semibold">Enable maintenance mode?</p>
            <p className="mt-1 text-xs">
              Workers will immediately lose access to jobs, applications and wallets.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="destructive" onClick={handleSave} disabled={saving}>
                {saving ? 'Enabling…' : 'Yes, take the site down'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirming(false)
                  setEnabled(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!confirming && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Link
              href="/maintenance"
              target="_blank"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" />
              Preview maintenance page
            </Link>
            {!dirty && !saving && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-success" />
                All changes saved
              </span>
            )}
          </div>
        )}

        {feedback && (
          <p
            className={
              'mt-4 rounded-lg px-3 py-2 text-sm ' +
              (feedback.ok
                ? 'bg-success/10 text-success'
                : 'bg-destructive/10 text-destructive')
            }
          >
            {feedback.text}
          </p>
        )}

        <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          Last updated: {maintenance.updatedAt ? formatDateTime(maintenance.updatedAt) : 'never'}
          {maintenance.updatedBy ? ` by ${maintenance.updatedBy}` : ''}
        </p>
      </AdminCard>

      {/* ── Admin access ─────────────────────────────────────────────────── */}
      <AdminCard>
        <div className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <KeyRound className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Admin access</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {checking
                ? 'Checking your admin status…'
                : isAdmin
                  ? 'You have admin access. Admins are stored in the Firestore admins/{uid} collection and via the { admin: true } custom claim.'
                  : 'You do not currently have admin access.'}
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
              <li>
                Add emails to the <code className="rounded bg-muted px-1 py-0.5 font-mono">ADMIN_EMAILS</code>{' '}
                environment variable — anyone on the allowlist is promoted
                automatically the first time they open the admin panel.
              </li>
              <li>
                To grant access without the env var, create a Firestore document at{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">admins/&lt;uid&gt;</code> with{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">{`{ email, role: "admin" }`}</code>.
              </li>
              <li>Admin API routes verify the caller&apos;s Firebase ID token server-side on every request.</li>
            </ul>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => refresh()}>
              Re-check my admin status
            </Button>
          </div>
        </div>
      </AdminCard>

      {/* ── Quick reference ──────────────────────────────────────────────── */}
      <AdminCard>
        <h2 className="text-base font-semibold">Maintenance checklist</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
            Announce downtime to workers ahead of time where possible.
          </li>
          <li className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
            Payments confirmed by webhooks during maintenance are still processed.
          </li>
          <li className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
            Turn maintenance off from this page — workers regain access instantly.
          </li>
        </ul>
      </AdminCard>
    </div>
  )
}
