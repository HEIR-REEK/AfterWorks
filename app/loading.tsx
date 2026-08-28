import { Loader2 } from 'lucide-react'

/**
 * Route-level suspense fallback.
 *
 * Every page in this app reads from Firestore or an API, so a route change used to render a blank
 * white gap until data arrived. The shape below deliberately mirrors the card geometry the real
 * pages use — the swap is a fade, not a jump.
 */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        Loading…
      </div>
      <div className="h-24 animate-pulse rounded-2xl border border-border bg-card" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-border/80 bg-card" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-card" />
        ))}
      </div>
    </div>
  )
}
