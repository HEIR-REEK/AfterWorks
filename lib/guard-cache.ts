/**
 * Guard caches — shared between the route guards and the Admin SDK data layer.
 *
 * Why this exists as its own module: `lib/guards.ts` needs to *read* these caches and
 * `lib/firestore-admin.ts` needs to *invalidate* them after a role change. Importing in either
 * direction would create a cycle, so both depend on this tiny leaf instead.
 *
 * Both caches are intentionally short-lived (tens of seconds). Revoking an admin role takes
 * effect on the next cache miss, which is the trade we accept for not reading a document on
 * every single privileged request.
 */

export type RevocationState = { revokedBefore: number; revokedJtis: Set<string>; expiresAt: number }

/**
 * Cached privilege decision for one email: `'owner'` (full console authority), `'staff'`
 * (limited console access) or `'none'` (no console access at all). Negative answers are cached
 * too, so a spray of random emails does not become a stream of Firestore reads.
 */
export type CachedRole = 'owner' | 'staff' | 'none'

type Store = {
  roles: Map<string, { value: CachedRole; expiresAt: number }>
  revocation: RevocationState | null
}

const globalStore = globalThis as unknown as { __awGuardStore?: Store }

function store(): Store {
  if (!globalStore.__awGuardStore) {
    globalStore.__awGuardStore = { roles: new Map(), revocation: null }
  }
  return globalStore.__awGuardStore
}

const ROLE_CACHE_MAX = 5_000

export function getCachedRole(email: string): CachedRole | null {
  const { roles } = store()
  const hit = roles.get(email)
  if (!hit) return null
  if (hit.expiresAt < Date.now()) {
    roles.delete(email)
    return null
  }
  return hit.value
}

export function setCachedRole(email: string, value: CachedRole, ttlMs: number): void {
  const { roles } = store()
  roles.set(email, { value, expiresAt: Date.now() + ttlMs })
  if (roles.size > ROLE_CACHE_MAX) {
    const oldest = roles.keys().next().value
    if (oldest) roles.delete(oldest)
  }
}

export function getCachedRevocation(): RevocationState | null {
  const { revocation } = store()
  if (!revocation) return null
  if (revocation.expiresAt < Date.now()) {
    store().revocation = null
    return null
  }
  return revocation
}

export function setCachedRevocation(revokedBefore: number, revokedJtis: Set<string>, ttlMs: number): RevocationState {
  const next: RevocationState = { revokedBefore, revokedJtis, expiresAt: Date.now() + ttlMs }
  store().revocation = next
  return next
}

/**
 * Drop cached decisions. Called after a role change, a session revocation, or a maintenance
 * switch so the operator's action is immediately visible on the next request.
 */
export function invalidateGuardCaches(subject?: string): void {
  const s = store()
  if (subject) s.roles.delete(subject.toLowerCase())
  else s.roles.clear()
  // Revocation state is always dropped: it is one cheap document read, and "log everyone out"
  // is precisely the action where a stale cache is the most dangerous.
  s.revocation = null
}

export function guardCacheStats(): { roles: number; revocationCached: boolean } {
  const s = store()
  return { roles: s.roles.size, revocationCached: s.revocation !== null }
}
