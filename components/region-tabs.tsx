'use client'

import { Lock, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

export type BoardRegion = {
  region: string
  label: string
  blurb: string
  count: number
  open: boolean
  /** The board's cards, for the blurred preview. `locked` marks ones the server will refuse. */
  cards?: { id: string; title: string; category: string; description: string; payAmountUsd: number; locked?: boolean }[]
}

/**
 * The four region boards as tabs on Browse jobs.
 *
 * A member's own board is a normal tab; every other board is a **blurred, locked** tab, because the
 * cards on it are not in their payload. Pressing a locked tab switches the panel to an explanation
 * rather than to a card grid, so the lock is honest at every step: nothing appears, blurred or
 * otherwise, that the member is not allowed to open.
 *
 * The current tab is derived from the resolved region — `selected ?? current` — so a member cannot
 * "select" a locked board by editing state, and the locked tabs stay visible and legible because a
 * member needs to know the other boards exist and why they are closed.
 *
 * When the region could not be resolved at all (`regions: []`), the component renders nothing and
 * the page keeps its plain single board. Failing open, as everywhere else in this feature.
 */
export function RegionTabs({
  regions,
  current,
  selected,
  onSelect,
}: {
  regions: BoardRegion[]
  /** The region this member's connection resolved to, or null. */
  current: string | null
  /** The board being viewed. Only ever an open one. */
  selected: string | null
  onSelect: (region: string) => void
}) {
  if (regions.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Job boards by region">
        {regions.map((entry) => {
          const active = entry.region === selected
          return (
            <button
              key={entry.region}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(entry.region)}
              title={entry.open ? entry.blurb : `${entry.label} board — ${entry.blurb}`}
              className={cn(
                'group relative shrink-0 overflow-hidden rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : entry.open
                    ? 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    : 'border-border/60 bg-muted/40 text-muted-foreground/70',
              )}
            >
              <span className={cn('inline-flex items-center gap-1.5', !entry.open && 'blur-[2px]')}>
                {!entry.open ? <Lock className="size-3" aria-hidden="true" /> : null}
                {entry.label}
                <span className="text-[11px] opacity-70">{entry.count}</span>
              </span>
              {entry.region === current ? (
                <MapPin className="ml-1 inline size-3 align-[-2px] text-primary-foreground/80" aria-hidden="true" />
              ) : null}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {current
          ? `Your board is ${current}, from your connection. Boards for other regions are locked.`
          : 'Your region could not be detected, so every board is open.'}
      </p>
    </div>
  )
}

/**
 * The panel shown when a locked region tab is pressed.
 *
 * The cards ARE rendered — the platform asked to see the other regions' work, prices and detail —
 * but blurred, unclickable and inert. Nothing here is a lock in the security sense: anyone can
 * delete the `blur` class. The real refusal is on the server (`lib/job-region-gate.ts`), so the
 * assessment will not open, the training fee will not charge and the apply button is not rendered
 * at all on a locked card. The blur is a courtesy; the API is the wall.
 */
export function LockedRegionPanel({
  entry,
  current,
  formatPay,
}: {
  entry: BoardRegion
  current: string | null
  /** Money formatter from the caller, so this component owns no pricing rules. */
  formatPay: (amount: number) => string
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {entry.label} board — {entry.count} {entry.count === 1 ? 'card' : 'cards'}
        </span>
        <p className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
          <MapPin className="size-3" aria-hidden="true" />
          {current ? `You are on the ${current} board` : 'Connect from this region to open it'}
        </p>
      </div>

      {entry.cards && entry.cards.length > 0 ? (
        // `inert` removes the whole subtree from Tab order, pointer events and accessibility — so
        // even with the blur removed there is nothing to click.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {entry.cards.map((card) => (
            <div
              key={card.id}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              {...({ inert: '' } as any)}
              className="pointer-events-none select-none rounded-xl border border-border bg-card p-5 blur-[3px]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {card.category}
                </span>
                <span className="font-mono text-sm font-semibold">{formatPay(card.payAmountUsd)}</span>
              </div>
              <h3 className="mt-3 line-clamp-2 text-base font-semibold leading-snug text-foreground">{card.title}</h3>
              <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
              <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-center text-xs font-medium text-muted-foreground">
                <Lock className="mr-1 inline size-3 align-[-2px]" aria-hidden="true" />
                Locked on the {entry.label} board
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No cards published on the {entry.label} board yet.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">{entry.blurb}</p>
    </div>
  )
}
