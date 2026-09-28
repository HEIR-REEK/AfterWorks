'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/firebase-auth-provider'

/**
 * Sends an already-signed-in member from a public marketing page into their workspace.
 *
 * Why a client redirect rather than a server one: the session lives in Firebase Auth on the client,
 * so the server has no cookie to inspect and cannot know who is signed in. That is also exactly why
 * the page renders its full public content first — a crawler, which never has a session, gets the
 * real page in the first response, and this component is a no-op for it.
 *
 * It renders nothing and never blocks paint; the landing page is complete without it.
 */
export function WorkspaceRedirect({ to = '/dashboard' }: { to?: string }) {
  const router = useRouter()
  const { user, loading, configured } = useAuth()

  useEffect(() => {
    if (loading || configured === false) return
    // Only members who have confirmed their email have a workspace to land in; everyone else is
    // already held on /verify-email by the gate, so do not fight it here.
    if (user?.emailVerified) router.replace(to)
  }, [user, loading, configured, router, to])

  return null
}
