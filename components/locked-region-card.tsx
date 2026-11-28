'use client'

import { Lock, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A region board this member cannot open, rendered as a blurred panel.
 *
 * What is blurred is generated here — the region name, its blurb and a row of grey card shapes.
 * The locked cards themselves are **not** in the payload: the server sends a name and a count, so
 * there is nothing behind the blur to read. That is the difference between a lock and a curtain.
 *
 * The copy names the region and tells the member how to open it, because "you cannot see this" is
 * only acceptable when "here is why" comes with it. It deliberately does not say "turn off your
 * VPN" or "your connection looks unusual" — connecting from a region IS how a member chooses that
 * board, and a member on a VPN in the Americas gets the Americas board by design.
 */
export function LockedRegionCard({
  region,
  label,
  blurb,
  count,
  currentRegion,
}: {
  region: string
  label: string
  blurb: string
  count: number
  /** The region the member is currently on, for the "you are here" line. */
  currentRegion?: string | null
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border bg-card p-5"
      aria-label={`${label} job board, locked`}
    >
      {/* The blur is decorative: a real card will never render behind it. */}
      <div className="pointer-events-none select-none blur-[3px]" aria-hidden="true">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {count} {count === 1 ? 'card' : 'cards'}
          </span>
        </div>
        <div className="mt-3 h-4 w-3/4 rounded bg-muted" />
        <div className="mt-2 h-3 w-full rounded bg-muted/80" />
        <div className="mt-1.5 h-3 w-5/6 rounded bg-muted/80" />
        <div className="mt-4 flex gap-3">
          <div className="h-3 w-16 rounded bg-muted/70" />
          <div className="h-3 w-16 rounded bg-muted/70" />
          <div className="h-3 w-20 rounded bg-muted/70" />
        </div>
        <div className="mt-4 h-9 w-full rounded-lg bg-muted/70" />
      </div>

      {/* The readable layer. Sits on top of the blur, not under it. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/70 p-5 text-center backdrop-blur-[2px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" />
          {label} board
        </span>
        <p className="max-w-[24ch] text-pretty text-xs leading-snug text-muted-foreground">{blurb}</p>
        <p className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
          <MapPin className="size-3" aria-hidden="true" />
          {currentRegion ? `You are on the ${currentRegion} board` : 'Connect from this region to open it'}
        </p>
      </div>
    </div>
  )
}

/** A single strip rather than a grid of panels — used when several regions are locked at once. */
export function LockedRegionStrip({
  regions,
  currentRegion,
  className,
}: {
  regions: { region: string; label: string; blurb: string; count: number }[]
  currentRegion?: string | null
  className?: string
}) {
  if (regions.length === 0) return null
  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label="Boards locked to other regions">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Other regions</h2>
        <p className="text-[11px] text-muted-foreground">
          Each region has its own job cards and its own rates. Yours is decided by where you connect from.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {regions.map((entry) => (
          <LockedRegionCard
            key={entry.region}
            region={entry.region}
            label={entry.label}
            blurb={entry.blurb}
            count={entry.count}
            currentRegion={currentRegion}
          />
        ))}
      </div>
    </section>
  )
}
