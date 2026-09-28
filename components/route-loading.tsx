import { Loader2 } from 'lucide-react'

/**
 * Route-level suspense fallback for the **private** member routes.
 *
 * This used to live at `app/loading.tsx`, which applied it to every route including `/`, `/jobs` and
 * `/jobs/[id]`. That was an indexing bug hiding in plain sight: a `loading.tsx` creates a Suspense
 * boundary, so React flushed the skeleton first and streamed the real page afterwards into a
 * `<div hidden id="S:0">` plus a swap script. A browser runs the script and sees the page; a crawler
 * that does not — Bing, Yandex, most link unfurlers, every SEO audit tool — sees only
 * "Loading workspace…" and a set of pulsing grey boxes, with the actual copy in a `hidden` node it
 * is entitled to ignore.
 *
 * So the fallback now exists only where nothing is being indexed. The public marketing routes have no
 * `loading.tsx` at all, which is what makes their HTML arrive complete in the first response.
 *
 * It also carries no heading: two `<h1>` elements in one document (the fallback's and the page's)
 * would be a document-outline failure for screen-reader users, and the `aria-live` region below
 * already announces the pending state.
 */
export function RouteLoading({ label = 'Loading your workspace…' }: { label?: string }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <p className="sr-only">{label}</p>
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
