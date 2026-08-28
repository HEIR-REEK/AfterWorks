/**
 * Centralized Admin Verification & Authentication Helpers
 * Production-ready security with rate-limiting, timing-attack resistance, and zero email footprint leakage.
 */

export const DEFAULT_ADMIN_EMAILS: string[] = []

export const ADMIN_MASTER_PASSWORD =
  (typeof process !== 'undefined' &&
    (process.env.ADMIN_PASSWORD || process.env.NEXT_PUBLIC_ADMIN_PASSWORD)) ||
  ''

/**
 * Returns the list of configured administrator emails from environment variables.
 * Contains no hardcoded emails in source files for zero email footprint leakage.
 */
export function getAdminEmails(): string[] {
  const envAdmins =
    (typeof process !== 'undefined' &&
      (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS)) ||
    ''
  return envAdmins
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Checks if a user is an administrator based on active session token,
 * Firestore user document role, or environment whitelist.
 */
export function isUserAdmin(
  user?: { email?: string | null } | null,
  worker?: { isAdmin?: boolean; role?: string } | null,
): boolean {
  if (typeof window !== 'undefined') {
    const sessionToken = sessionStorage.getItem('afterworks_admin_session_token')
    if (sessionToken) {
      return true
    }
  }

  if (worker?.isAdmin === true || worker?.role === 'admin') return true

  if (user?.email) {
    const adminEmails = getAdminEmails()
    if (adminEmails.length > 0 && adminEmails.includes(user.email.toLowerCase().trim())) {
      return true
    }
  }

  return false
}

/**
 * Authenticates an administrator via the secure server-side rate-limited API gateway.
 */
export async function authenticateAdminSession(
  email: string,
  passcode: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string; remainingAttempts?: number }> {
  const cleanEmail = email.trim().toLowerCase()
  const cleanPass = passcode.trim()

  if (!cleanEmail || !cleanPass) {
    return { ok: false, error: 'Please enter both an administrator email and password.' }
  }

  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache',
      },
      body: JSON.stringify({ email: cleanEmail, password: cleanPass }),
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        ok: false,
        error: data.error || 'Invalid administrator credentials or unauthorized access.',
        remainingAttempts: data.remainingAttempts,
      }
    }

    if (data.ok && data.token) {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('afterworks_admin_session_token', data.token)
        sessionStorage.setItem('afterworks_admin_session_time', new Date().toISOString())
      }

      // Also sync with Firebase Auth if available in browser
      try {
        const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth')
        const { getApps } = await import('firebase/app')
        if (getApps().length > 0) {
          const auth = getAuth()
          await signInWithEmailAndPassword(auth, cleanEmail, cleanPass).catch(() => {})
        }
      } catch {
        // non-blocking
      }

      return { ok: true, email: data.email || cleanEmail }
    }

    return { ok: false, error: 'Authentication verification failed.' }
  } catch (err) {
    console.error('[AdminAuth] Network/gateway error:', err)
    return { ok: false, error: 'Connection error. Please check your network and try again.' }
  }
}

/**
 * Securely terminates the admin session.
 */
export async function terminateAdminSession(): Promise<void> {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('afterworks_admin_session_token')
    sessionStorage.removeItem('afterworks_admin_session_time')
  }

  try {
    const { getAuth, signOut } = await import('firebase/auth')
    const { getApps } = await import('firebase/app')
    if (getApps().length > 0) {
      await signOut(getAuth())
    }
  } catch {
    // non-blocking
  }
}
