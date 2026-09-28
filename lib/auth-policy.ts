/**
 * How long a signed-in session is allowed to live — the rules, in one testable place.
 *
 * Reported as: *"I closed Chrome and opened it again and the dashboards are still displaying
 * without a login process, both for admin and user."* Two separate defaults produced that, and
 * neither was deliberate:
 *
 *  • **The member app** never chose a persistence mode, so the Firebase SDK used its default
 *    (`browserLocalPersistence` — IndexedDB), whose entire purpose is to survive a browser
 *    restart. Combined with a refresh token that renews itself, closing the browser stopped
 *    meaning anything.
 *  • **The console** set an explicit `Max-Age` on its session cookie, so the cookie outlived the
 *    browser too, for up to `ADMIN_SESSION_TTL_MINUTES`.
 *
 * The policy below is the decision, stated once:
 *
 *  • `AUTH_PERSISTENCE` (default **`session`**) — a signed-in member is remembered for the life of
 *    the browser session, not forever. Closing the browser ends it. Set `local` to go back to
 *    "stay signed in on this device"; the app already expires idle tabs after
 *    `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` either way.
 *  • The console's cookie is a *browser-session* cookie by default; `ADMIN_SESSION_PERSIST=true`
 *    restores a durable one. The server-side expiry and revocation list are unchanged — they are
 *    the authority either way, this only decides whether the browser throws the key away when it
 *    closes.
 *
 * Nothing here is a secret. The cookie marker is a "was this browser session signed in
 * deliberately?" note, shared by every tab (a sessionStorage marker would force a sign-in in every
 * new tab) and dropped by the browser when it closes.
 */

export type AuthPersistence = 'session' | 'local'

/**
 * Name of the browser-session marker cookie.
 *
 * Not HttpOnly, and it does not need to be: it carries no credential and grants nothing by itself.
 * It exists so a session *restored from durable storage* can be told apart from one started in
 * this browser session, which is what `shouldEndRestoredSession` decides.
 */
export const AUTH_SESSION_MARKER = 'afterworks_auth_session'

/** Default is the strict one: a closed browser is a signed-out browser. */
export function resolveAuthPersistence(raw: string | undefined | null = null): AuthPersistence {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'local' || value === 'persist' || value === 'persistent') return 'local'
  return 'session'
}

export type RestoredSessionInput = {
  persistence: AuthPersistence
  /** Did the auth SDK hand us a user without anyone signing in during this browser session? */
  hasUser: boolean
  /** Is the browser-session marker cookie present? */
  hasSessionMarker: boolean
}

/**
 * Should a session that came out of durable storage be ended on sight?
 *
 * Yes when the policy is `session`, a user was restored, and this browser session never signed in.
 * That is the migration path as much as the security rule: a credential written by an older build
 * (or by `AUTH_PERSISTENCE=local`) is exactly the thing that keeps somebody signed in after they
 * close the browser, and `setPersistence` alone cannot remove it — the SDK keeps serving the user
 * it restored until the credential is deleted, which `signOut()` does.
 */
export function shouldEndRestoredSession({ persistence, hasUser, hasSessionMarker }: RestoredSessionInput): boolean {
  if (!hasUser) return false
  if (persistence === 'local') return false
  return !hasSessionMarker
}

// ─── The marker cookie (browser-side helpers, no-ops on the server) ───────────

export function hasAuthSessionMarker(): boolean {
  if (typeof document === 'undefined') return false
  try {
    return document.cookie.split(';').some((part) => part.trim().startsWith(`${AUTH_SESSION_MARKER}=`))
  } catch {
    return false
  }
}

export function markAuthSession(): void {
  if (typeof document === 'undefined') return
  try {
    // Deliberately *without* Max-Age or Expires: a browser-session cookie. Every tab in this
    // browser session shares it (so a second tab does not look like a restored session), and the
    // browser drops it when the last window closes — which is the moment the policy says the
    // session is over.
    document.cookie = `${AUTH_SESSION_MARKER}=1; path=/; SameSite=Lax`
  } catch {
    /* storage blocked (private mode): the next load simply asks for a sign-in again */
  }
}

export function clearAuthSessionMarker(): void {
  if (typeof document === 'undefined') return
  try {
    document.cookie = `${AUTH_SESSION_MARKER}=; path=/; SameSite=Lax; Max-Age=0`
  } catch {
    /* nothing to clear */
  }
}
