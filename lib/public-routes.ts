/**
 * The routes that must render for a visitor with no session.
 *
 * This list is a single source of truth because two separate gates in `components/app-gate.tsx`
 * read it, and each one fails in its own way when a route is left out:
 *
 *  • the redirect effect sends a signed-out visitor to `/sign-in`, so a missing entry turns a page
 *    that is public *by design* into a bounce back to the sign-in form. That is what happened to
 *    the legal documents: `/terms` and `/privacy` were rendered by the server, then the client
 *    pulled the visitor off them a moment later.
 *  • the configuration wall (`<ConfigurationRequired />`) replaces every non-public page on a
 *    deployment with no Firebase config — a page that needs no datastore at all, like a legal
 *    document, was hidden behind a notice about the datastore.
 *
 * The legal documents belong on this list and not behind a session: the sign-up form links to them
 * *before* an account exists, `app/sitemap.ts` asks search engines to index them, the acceptance
 * record is written by `POST /api/auth/terms` (which never required a session), and a person
 * deciding whether to accept these Terms has to be able to read them first. A Terms & Conditions
 * you have to sign in to read is not a Terms & Conditions anybody agreed to.
 */
export const PUBLIC_ROUTES = [
  // Authentication — the way in.
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/verify-email',
  // The identity-verification provider redirects the browser here, often in a fresh tab.
  '/kyc/callback',
  // Legal documents. Public, indexable and linked from the sign-up form.
  '/terms',
  '/privacy',
  // Outage and service status: these have to answer when the app behind them cannot.
  '/maintenance',
  '/status',
] as const

/**
 * Segment-aware match, so `/sign-in` covers `/sign-in/anything` but `/term` never matches
 * `/terms`. Kept here rather than inline in the gate so the edge layer and the tests can ask the
 * same question and get the same answer.
 *
 * A query string or a `#section` fragment is stripped first: the gate hands over `usePathname()`,
 * which never carries either, but the deep links the product renders (`/terms#referrals`) are the
 * ones that get passed around, and a predicate that answers "private" for a link the sign-up form
 * itself renders is exactly how the legal pages went missing.
 */
export function isPublicRoute(pathname: string): boolean {
  const [path] = pathname.split(/[?#]/, 1)
  const clean = path.startsWith('/') ? path : `/${path}`
  return PUBLIC_ROUTES.some((route) => clean === route || clean.startsWith(`${route}/`))
}
