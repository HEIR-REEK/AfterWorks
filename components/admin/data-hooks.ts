'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { useAuth } from '@/components/firebase-auth-provider'
import type {
  AdminUser,
  AdminKycItem,
  AdminApplication,
} from '@/lib/admin-data'
import type { Job, JobStatus } from '@/lib/afterworks-data'

/**
 * Data hooks for the admin panel — production data-flow only.
 *
 * Every hook calls the /api/admin/* routes with the signed-in admin's
 * Firebase ID token. The server verifies the token and admin status with the
 * Firebase Admin SDK before touching Firestore. When Firebase credentials are
 * missing the APIs respond with `configured: false` and the hook surfaces the
 * error message to the UI.
 */

export type ActionResult = { ok: boolean; error?: string }

async function authedFetch(
  user: User | null,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const idToken = user ? await user.getIdToken() : null
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  let data: Record<string, unknown> = {}
  try {
    data = await res.json()
  } catch {
    // non-JSON response
  }
  return { ok: res.ok, status: res.status, data }
}

// ─── Users ───────────────────────────────────────────────────────────────────

export function useAdminUsers() {
  const { user } = useAuth()

  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const { ok, data } = await authedFetch(user, '/api/admin/users')
      if (ok && Array.isArray(data.users)) {
        setUsers(data.users as AdminUser[])
      } else {
        setError((data.error as string) ?? 'Failed to load users.')
      }
    } catch {
      setError('Network error while loading users.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setUserState = useCallback(
    async (uid: string, accountState: string, reason?: string): Promise<ActionResult> => {
      const { ok, data } = await authedFetch(user, '/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_state', uid, accountState, reason }),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [user, refresh],
  )

  const setQuality = useCallback(
    async (uid: string, qualityScore: number): Promise<ActionResult> => {
      const { ok, data } = await authedFetch(user, '/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_quality', uid, qualityScore }),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [user, refresh],
  )

  return { users, loading, error, refresh, setUserState, setQuality }
}

// ─── KYC queue ───────────────────────────────────────────────────────────────

export function useAdminKyc() {
  const { user } = useAuth()

  const [items, setItems] = useState<AdminKycItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const { ok, data } = await authedFetch(user, '/api/admin/kyc')
      if (ok && Array.isArray(data.items)) {
        setItems(data.items as AdminKycItem[])
      } else {
        setError((data.error as string) ?? 'Failed to load KYC records.')
      }
    } catch {
      setError('Network error while loading KYC records.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const decide = useCallback(
    async (
      uid: string,
      action: 'approve' | 'reject' | 'hold' | 'resubmission',
      reason?: string,
    ): Promise<ActionResult> => {
      const { ok, data } = await authedFetch(user, '/api/admin/kyc', {
        method: 'POST',
        body: JSON.stringify({ uid, action, reason }),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [user, refresh],
  )

  return { items, loading, error, refresh, decide }
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export function useAdminJobs() {
  const { user } = useAuth()

  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/jobs', { cache: 'no-store' })
      const data = (await res.json()) as { source: string; jobs: Job[]; error?: string }
      setJobs(Array.isArray(data.jobs) ? data.jobs : [])
      if (data.error) setError(data.error)
    } catch {
      setError('Network error while loading jobs.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const mutate = useCallback(
    async (body: {
      action: 'create' | 'update' | 'delete' | 'set_status'
      id?: string
      status?: JobStatus
      job?: Partial<Job>
    }): Promise<ActionResult> => {
      const { ok, data } = await authedFetch(user, '/api/admin/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [user, refresh],
  )

  return { jobs, loading, error, refresh, mutate }
}

// ─── Applications ────────────────────────────────────────────────────────────

export function useAdminApplications() {
  const { user } = useAuth()

  const [items, setItems] = useState<AdminApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const { ok, data } = await authedFetch(user, '/api/admin/applications')
      if (ok && Array.isArray(data.items)) {
        setItems(data.items as AdminApplication[])
      } else {
        setError((data.error as string) ?? 'Failed to load applications.')
      }
    } catch {
      setError('Network error while loading applications.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const act = useCallback(
    async (id: string, action: string, note?: string): Promise<ActionResult> => {
      const { ok, data } = await authedFetch(user, '/api/admin/applications', {
        method: 'POST',
        body: JSON.stringify({ id, action, note }),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [user, refresh],
  )

  return { items, loading, error, refresh, act }
}
