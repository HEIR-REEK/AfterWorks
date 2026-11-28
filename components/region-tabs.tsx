'use client'

import { Lock, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

export type BoardRegion = {
  region: string
  label: string
  blurb: string
  count: number
  open: boolean
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
              aria-disabled={!entry.open}
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
 * Deliberately not a blurred card grid: a grid implies something is there. The honest answer is
 * that the cards belong to another board, plus how many there are so the member can see there is
 * work — just not theirs from here.
 */
export function LockedRegionPanel({ entry, current }: { entry: BoardRegion; current: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
        <Lock className="size-3" aria-hidden="true" />
        {entry.label} board
      </span>
      <p className="max-w-[42ch] text-sm leading-relaxed text-muted-foreground">{entry.blurb}</p>
      <p className="text-xs text-muted-foreground">
        {entry.count} {entry.count === 1 ? 'card is' : 'cards are'} open on this board.
      </p>
      <p className="inline-flex items-center gap-1 text-xs font-medium text-primary">
        <MapPin className="size-3" aria-hidden="true" />
        {current ? `You are on the ${current} board` : 'Connect from this region to open it'}
      </p>
    </div>
  )
}
