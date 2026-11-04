'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  adminApi,
  useAdminSession,
  type AdminExternalFeedMeta,
} from '@/lib/admin'
import { describeError } from '@/lib/client-api'
import {
  AdminCard,
  Field,
  OwnerOnlyNotice,
  ReasonDialog,
  inputClass,
  useToasts,
} from '@/components/admin-ui'
import { Button } from '@/components/ui/button'
import {
  ADZUNA_COUNTRIES,
  ADZUNA_COUNTRY_LABELS,
  type AdzunaCountry,
  type ExternalJobCard,
} from '@/lib/adzuna'
import { cn } from '@/lib/utils'

/**
 * Adzuna import desk.
 *
 * This page never calls Adzuna from the browser. It asks the owner-only route to run one import,
 * then re-reads the stored feed. The console can therefore show an honest state — configured or
 * not, imported or empty, current or stale — without ever shipping an app key to a client.
 */

type Snapshot = {
  configured: boolean
  configuration: { configured: boolean; appIdPresent: boolean; appKeyPresent: boolean; country: AdzunaCountry }
  storageAvailable: boolean
  meta: AdminExternalFeedMeta | null
  count: number
  preview: ExternalJobCard[]
}

function when(iso: string): string {
  if (!iso) return 'Never'
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return 'Unknown'
  return new Date(parsed).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function sourceCountry(country: AdzunaCountry): string {
  return ADZUNA_COUNTRY_LABELS[country] ?? country.toUpperCase()
}

export default function ExternalJobsPage() {
  const session = useAdminSession()
  const isOwner = session.role === 'owner'
  const { push, toasts } = useToasts()

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [country, setCountry] = useState<AdzunaCountry>('gb')
  const [what, setWhat] = useState('')
  const [where, setWhere] = useState('')
  const [pages, setPages] = useState(2)
  const [syncing, setSyncing] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const initialised = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminApi.externalJobs()
      setSnapshot(data)
      if (!initialised.current) {
        setCountry(data.configuration.country)
        setWhat(data.meta?.what ?? '')
        setWhere(data.meta?.where ?? '')
        setPages(data.meta?.pages || 2)
        initialised.current = true
      }
    } catch (err) {
      setError(describeError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session.status === 'authorized') void load()
  }, [session.status, load])

  const sync = async () => {
    if (!snapshot?.configured) {
      push('error', 'Add ADZUNA_APP_ID and ADZUNA_APP_KEY to the server environment first.')
      return
    }
    setSyncing(true)
    try {
      const result = await adminApi.syncExternalJobs({ country, what, where, pages })
      push(
        'success',
        `Imported ${result.stored} advert${result.stored === 1 ? '' : 's'} from Adzuna ${sourceCountry(result.country)}` +
          (result.removed ? `, replacing ${result.removed} stale one${result.removed === 1 ? '' : 's'}.` : '.'),
      )
      await load()
    } catch (err) {
      push('error', describeError(err))
    } finally {
      setSyncing(false)
    }
  }

  const clear = async (reason: string) => {
    setClearing(true)
    try {
      const result = await adminApi.clearExternalJobs(reason)
      push('success', `Removed ${result.removed} external advert${result.removed === 1 ? '' : 's'} and the feed metadata.`)
      setClearOpen(false)
      await load()
    } catch (err) {
      push('error', describeError(err))
    } finally {
      setClearing(false)
    }
  }

  const configured = snapshot?.configured === true
  const storageReady = snapshot?.storageAvailable === true
  const meta = snapshot?.meta ?? null

  return (
    <div className="flex flex-col gap-4">
      {toasts}

      <AdminCard
        title="External jobs from Adzuna"
        description="A separately labelled feed of third-party adverts. These are not AfterWorks jobs: they have no assessment, training or payout, and the worker applies on Adzuna."
        icon={<Globe2 className="size-4" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load()} disabled={loading || syncing}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh status
            </Button>
            <Button render={<Link href="/work/external" target="_blank" rel="noreferrer" />} size="sm" variant="ghost" className="gap-1.5">
              Public page <ExternalLink className="size-3.5" />
            </Button>
          </div>
        }
      >
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Check the Adzuna plan before importing.</p>
            <p className="mt-1">
              Adzuna&apos;s free key is for evaluation. Publishing adverts is permitted with the
              required &ldquo;Adzuna&rdquo; attribution, but commercial or revenue-generating use needs a
              written licence agreement. Every imported advert is labelled and links out to Adzuna.
              Adzuna has <strong>no Kenya country code</strong> — choose a supported market below.
            </p>
          </div>
        </div>

        {loading && !snapshot ? (
          <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Reading the current feed…
          </div>
        ) : error ? (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatusTile
                label="Adzuna credentials"
                value={configured ? 'Configured' : 'Not configured'}
                detail={
                  configured
                    ? `App id and key present · default market ${sourceCountry(snapshot?.configuration.country ?? 'gb')}`
                    : `${snapshot?.configuration.appIdPresent ? 'App id present' : 'App id missing'} · ${
                        snapshot?.configuration.appKeyPresent ? 'app key present' : 'app key missing'
                      }`
                }
                tone={configured ? 'success' : 'warning'}
              />
              <StatusTile
                label="Storage"
                value={storageReady ? 'Available' : 'Unavailable'}
                detail={storageReady ? 'Feed can be written and read.' : 'Firebase Admin SDK is not configured.'}
                tone={storageReady ? 'success' : 'danger'}
              />
              <StatusTile
                label="Imported adverts"
                value={snapshot?.count ?? 0}
                detail={meta ? `${sourceCountry(meta.country)} · ${meta.fetched} in last import` : 'No import recorded'}
                tone={snapshot?.count ? 'success' : 'muted'}
              />
              <StatusTile
                label="Last import"
                value={meta ? when(meta.syncedAt) : 'Never'}
                detail={meta?.syncedBy ? `by ${meta.syncedBy}` : 'Owner action required'}
                tone={meta ? 'success' : 'muted'}
              />
            </div>

            {meta && (
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Current feed: <strong>{sourceCountry(meta.country)}</strong>
                {meta.what ? ` · keyword “${meta.what}”` : ' · no keyword filter'}
                {meta.where ? ` · location “${meta.where}”` : ' · whole market'}
                {` · ${meta.pages} page${meta.pages === 1 ? '' : 's'}`}
                {` · expires ${when(meta.expiresAt)}`}
              </p>
            )}
          </>
        )}

        {!isOwner && <div className="mt-4"><OwnerOnlyNotice area="Adzuna import" /></div>}
      </AdminCard>

      {isOwner && (
        <AdminCard
          title="Import a feed"
          description="The import replaces the previous feed, so an advert Adzuna no longer returns disappears instead of lingering."
          icon={<ShieldCheck className="size-4" />}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Adzuna market" hint="No Kenya feed exists; pick the market you want to surface.">
              <select
                value={country}
                onChange={(event) => setCountry(event.target.value as AdzunaCountry)}
                className={inputClass}
                disabled={syncing}
              >
                {ADZUNA_COUNTRIES.map((code) => (
                  <option key={code} value={code}>
                    {ADZUNA_COUNTRY_LABELS[code]} ({code.toUpperCase()})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Keyword" hint="Optional. Try “remote data entry” or “transcription”.">
              <input
                value={what}
                onChange={(event) => setWhat(event.target.value)}
                className={inputClass}
                maxLength={80}
                placeholder="e.g. remote data entry"
                disabled={syncing}
              />
            </Field>
            <Field label="Location" hint="Optional. Adzuna's where filter; blank scans the whole market.">
              <input
                value={where}
                onChange={(event) => setWhere(event.target.value)}
                className={inputClass}
                maxLength={80}
                placeholder="e.g. London"
                disabled={syncing}
              />
            </Field>
            <Field label="Pages" hint="50 adverts per page. Five pages is the API and sync maximum.">
              <select
                value={pages}
                onChange={(event) => setPages(Number(event.target.value))}
                className={inputClass}
                disabled={syncing}
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value} page{value === 1 ? '' : 's'} · up to {value * 50} adverts
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="gap-1.5" onClick={() => void sync()} disabled={syncing || !configured || !storageReady}>
              {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {syncing ? 'Importing…' : 'Import / refresh feed'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setClearOpen(true)}
              disabled={syncing || clearing || !storageReady || (snapshot?.count ?? 0) === 0}
            >
              <Trash2 className="size-3.5" />
              Remove imported feed
            </Button>
            {!configured && (
              <span className="text-[11px] text-muted-foreground">
                Set <code className="font-mono">ADZUNA_APP_ID</code> and <code className="font-mono">ADZUNA_APP_KEY</code> in the server environment.
              </span>
            )}
          </div>
        </AdminCard>
      )}

      <AdminCard
        title="Imported preview"
        description="What the public external-jobs page will show. Adverts are sorted newest first and expire after 14 days unless a new import refreshes them."
        icon={<Globe2 className="size-4" />}
        actions={
          <span className="text-[11px] text-muted-foreground">
            {snapshot?.count ?? 0} live advert{(snapshot?.count ?? 0) === 1 ? '' : 's'}
          </span>
        }
      >
        {snapshot && snapshot.preview.length > 0 ? (
          <div className="divide-y divide-border/70">
            {snapshot.preview.map((job) => (
              <div key={job.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <a
                    href={job.redirectUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow sponsored"
                    className="text-xs font-semibold text-foreground hover:text-primary hover:underline"
                  >
                    {job.title}
                  </a>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {job.company} · {job.location} · {sourceCountry(job.country)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{job.description}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground sm:justify-end">
                  {job.salaryLabel && <span>{job.salaryLabel}</span>}
                  <span>{job.postedLabel}</span>
                  <a
                    href={job.attributionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[23px] min-w-[116px] items-center justify-center rounded-md border border-border bg-background px-2 text-[11px] font-semibold text-foreground hover:border-primary/40"
                  >
                    Adzuna
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm font-semibold">No external adverts imported yet.</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
              Nothing is shown on the public page until an owner runs an import with working Adzuna
              credentials. AfterWorks does not seed or invent external adverts.
            </p>
          </div>
        )}
      </AdminCard>

      <ReasonDialog
        open={clearOpen}
        title="Remove every imported external advert?"
        description="This deletes the stored Adzuna feed and its metadata immediately. Use it when the licence ends or the feed must be withdrawn. The action is audited."
        confirmLabel="Remove feed"
        busy={clearing}
        onCancel={() => setClearOpen(false)}
        onConfirm={(reason) => void clear(reason)}
      />
    </div>
  )
}

function StatusTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string | number
  detail: string
  tone: 'success' | 'warning' | 'danger' | 'muted'
}) {
  const toneClass = {
    success: 'text-success',
    warning: 'text-amber-700 dark:text-amber-300',
    danger: 'text-destructive',
    muted: 'text-muted-foreground',
  }[tone]
  return (
    <div className="rounded-xl border border-border/80 bg-background p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {tone === 'success' ? (
          <CheckCircle2 className="size-3.5 text-success" />
        ) : tone === 'danger' ? (
          <AlertTriangle className="size-3.5 text-destructive" />
        ) : (
          <Globe2 className="size-3.5 text-muted-foreground" />
        )}
      </div>
      <p className={cn('mt-1 font-mono text-lg font-semibold leading-none tabular', toneClass)}>{value}</p>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{detail}</p>
    </div>
  )
}
