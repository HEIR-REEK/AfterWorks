'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Mail,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react'
import {
  subscribeToMaintenanceConfig,
  updateMaintenanceConfig,
  createAdminAuditLog,
  DEFAULT_MAINTENANCE_CONFIG,
  type MaintenanceConfig,
} from '@/lib/firestore'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/firebase-auth-provider'
import { cn } from '@/lib/utils'

export default function AdminMaintenancePage() {
  const { user } = useAuth()
  const [config, setConfig] = useState<MaintenanceConfig>(DEFAULT_MAINTENANCE_CONFIG)

  // Local form editing states
  const [enabled, setEnabled] = useState(false)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [estimatedEnd, setEstimatedEnd] = useState<string>('')
  const [allowedEmailsText, setAllowedEmailsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const unsub = subscribeToMaintenanceConfig((cfg) => {
      setConfig(cfg)
      setEnabled(cfg.enabled)
      setTitle(cfg.title || DEFAULT_MAINTENANCE_CONFIG.title)
      setMessage(cfg.message || DEFAULT_MAINTENANCE_CONFIG.message)
      setEstimatedEnd(
        cfg.estimatedEnd ? new Date(cfg.estimatedEnd).toISOString().slice(0, 16) : '',
      )
      setAllowedEmailsText((cfg.allowedEmails || []).join('\n'))
    })
    return () => unsub()
  }, [])

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setSaving(true)
    setFeedback(null)

    try {
      const allowedEmails = allowedEmailsText
        .split('\n')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)

      const updatedPayload: Partial<MaintenanceConfig> = {
        enabled,
        title: title.trim(),
        message: message.trim(),
        estimatedEnd: estimatedEnd ? new Date(estimatedEnd).toISOString() : null,
        allowedEmails,
        updatedBy: user?.email || 'Admin',
      }

      await updateMaintenanceConfig(updatedPayload)
      await createAdminAuditLog(
        enabled ? 'ENABLE_MAINTENANCE_MODE' : 'DISABLE_MAINTENANCE_MODE',
        { ...updatedPayload },
        user?.email || 'Admin',
      )

      setFeedback({
        type: 'success',
        text: `Maintenance mode ${enabled ? 'ACTIVATED' : 'DEACTIVATED'} and updated successfully.`,
      })
      setTimeout(() => setFeedback(null), 4000)
    } catch (err) {
      console.error('Failed to update maintenance config:', err)
      setFeedback({ type: 'error', text: 'Failed to update maintenance settings.' })
    } finally {
      setSaving(false)
    }
  }

  // Quick preset handlers
  const applyPreset = async (type: '30m' | '2h' | 'off') => {
    if (type === 'off') {
      setEnabled(false)
      setEstimatedEnd('')
    } else {
      setEnabled(true)
      const targetDate = new Date()
      if (type === '30m') targetDate.setMinutes(targetDate.getMinutes() + 30)
      if (type === '2h') targetDate.setHours(targetDate.getHours() + 2)
      setEstimatedEnd(targetDate.toISOString().slice(0, 16))
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Active State Hero Card */}
      <div
        className={cn(
          'flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border p-5 shadow-sm transition-all',
          enabled
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-200'
            : 'border-success/30 bg-success/10 text-success-foreground',
        )}
      >
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              'rounded-xl p-2.5 shrink-0',
              enabled
                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                : 'bg-success/20 text-success',
            )}
          >
            {enabled ? (
              <Wrench className="size-6 animate-pulse" />
            ) : (
              <CheckCircle2 className="size-6" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold">
                {enabled ? 'MAINTENANCE MODE IS CURRENTLY ACTIVE' : 'PLATFORM IS FULLY OPERATIONAL'}
              </h2>
              <span
                className={cn(
                  'size-2.5 rounded-full',
                  enabled ? 'bg-amber-500 animate-ping' : 'bg-success',
                )}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {enabled
                ? 'Regular worker traffic is intercepted and redirected to the maintenance screen. Admins and whitelisted emails have full bypass access.'
                : 'All users can sign in, browse jobs, complete microtasks, and receive payments normally.'}
            </p>
          </div>
        </div>

        {/* Big Switch Control */}
        <div className="flex items-center gap-3 shrink-0">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-14 h-7 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-amber-500"></div>
          </label>
        </div>
      </div>

      {feedback && (
        <div
          className={cn(
            'rounded-xl p-3.5 text-xs font-semibold flex items-center gap-2',
            feedback.type === 'success'
              ? 'bg-success/15 text-success border border-success/30'
              : 'bg-destructive/15 text-destructive border border-destructive/30',
          )}
        >
          {feedback.type === 'success' ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
          {feedback.text}
        </div>
      )}

      {/* Main Configuration Form */}
      <form onSubmit={handleSave} className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-border/80 pb-3">
          <div>
            <h3 className="text-base font-bold text-foreground">Maintenance Configuration & Criteria</h3>
            <p className="text-xs text-muted-foreground">
              Configure the screen copy, duration, and whitelist filters.
            </p>
          </div>

          <div className="text-right text-[11px] font-mono text-muted-foreground hidden sm:block">
            Last updated by: {config.updatedBy || 'System'}<br />
            {config.updatedAt ? new Date(config.updatedAt).toLocaleString() : ''}
          </div>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
            <Zap className="size-3 text-primary" /> Quick Presets:
          </span>
          <button
            type="button"
            onClick={() => applyPreset('30m')}
            className="rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            +30 Min Window
          </button>
          <button
            type="button"
            onClick={() => applyPreset('2h')}
            className="rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            +2 Hour Window
          </button>
          <button
            type="button"
            onClick={() => applyPreset('off')}
            className="rounded-lg border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success hover:bg-success/20"
          >
            Turn Off Maintenance
          </button>
        </div>

        {/* Title */}
        <div>
          <label className="text-xs font-semibold text-foreground block mb-1">
            Maintenance Screen Heading
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Under Scheduled Maintenance"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {/* Message */}
        <div>
          <label className="text-xs font-semibold text-foreground block mb-1">
            Public Explanation Notice
          </label>
          <textarea
            required
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="We are currently upgrading payment settlement pipelines..."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
          />
          <span className="mt-1 text-[11px] text-muted-foreground block">
            This message will be rendered prominently to any worker who visits the platform during maintenance.
          </span>
        </div>

        {/* Estimated Return Time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-foreground block mb-1 flex items-center gap-1.5">
              <Clock className="size-3.5 text-primary" /> Estimated Return Time (Countdown Timer)
            </label>
            <input
              type="datetime-local"
              value={estimatedEnd}
              onChange={(e) => setEstimatedEnd(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
            />
            <span className="mt-1 text-[11px] text-muted-foreground block">
              Leave blank if no exact ETA is available.
            </span>
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground block mb-1 flex items-center gap-1.5">
              <Mail className="size-3.5 text-primary" /> Whitelisted Bypass Emails (one per line)
            </label>
            <textarea
              rows={3}
              value={allowedEmailsText}
              onChange={(e) => setAllowedEmailsText(e.target.value)}
              placeholder="admin@example.com&#10;support@example.com"
              className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Security / Criteria Note */}
        <div className="rounded-xl border border-border/80 bg-muted/20 p-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 font-bold text-foreground mb-1">
            <Info className="size-4 text-primary" /> Maintenance Guard Criteria
          </div>
          <ul className="list-disc pl-4 space-y-1 text-[11px]">
            <li><strong>Worker State:</strong> All job applications, wallet balances, and KYC submissions remain 100% intact and locked securely.</li>
            <li><strong>Admin Bypass:</strong> Any authenticated user marked with <code>isAdmin: true</code> or whose email is in the allowed list automatically bypasses the screen.</li>
            <li><strong>Real-time Broadcast:</strong> Changes take effect immediately across all active browser sessions without requiring a server reboot.</li>
          </ul>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="submit" disabled={saving} size="lg" className="gap-2 shadow-sm">
            <Save className="size-4" />
            {saving ? 'Saving Changes...' : 'Save Maintenance Settings'}
          </Button>
        </div>
      </form>
    </div>
  )
}
