'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { useAuth } from '@/components/firebase-auth-provider'
import {
  loadDemoUsers,
  saveDemoUsers,
  loadDemoKyc,
  saveDemoKyc,
  loadDemoJobsOverride,
  saveDemoJobsOverride,
  type AdminUser,
  type AdminKycItem,
  type AdminApplication,
} from '@/lib/admin-data'
import { seedJobs, type Job, type JobStatus } from '@/lib/afterworks-data'

/**
 * Data hooks for the admin panel. Each hook transparently operates in two
 * modes:
 *  - Firestore mode — authenticated calls to /api/admin/* (Admin SDK).
 *  - Demo mode      — seeded data persisted to localStorage (Firebase not
 *                     configured), shared with the worker app.
 */

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
  const { user, configured } = useAuth()
  const demo = !configured

  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (demo) {
      setUsers(loadDemoUsers())
      setLoading(false)
      return
    }
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
  }, [demo, user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setUserState = useCallback(
    async (uid: string, accountState: string, reason?: string) => {
      if (demo) {
        const next = loadDemoUsers().map((u) =>
          u.uid === uid
            ? {
                ...u,
                accountState,
                kycVerified: accountState === 'active',
              }
            : u,
        )
        saveDemoUsers(next)
        setUsers(next)
        return { ok: true }
      }
      const { ok, data } = await authedFetch(user, '/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_state', uid, accountState, reason }),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [demo, user, refresh],
  )

  const setQuality = useCallback(
    async (uid: string, qualityScore: number) => {
      if (demo) {
        const next = loadDemoUsers().map((u) =>
          u.uid === uid ? { ...u, qualityScore } : u,
        )
        saveDemoUsers(next)
        setUsers(next)
        return { ok: true }
      }
      const { ok, data } = await authedFetch(user, '/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_quality', uid, qualityScore }),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [demo, user, refresh],
  )

  return { users, loading, error, demo, refresh, setUserState, setQuality }
}

// ─── KYC queue ───────────────────────────────────────────────────────────────

export function useAdminKyc() {
  const { user, configured } = useAuth()
  const demo = !configured

  const [items, setItems] = useState<AdminKycItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (demo) {
      setItems(loadDemoKyc())
      setLoading(false)
      return
    }
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
  }, [demo, user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const decide = useCallback(
    async (
      uid: string,
      action: 'approve' | 'reject' | 'hold' | 'resubmission',
      reason?: string,
    ) => {
      if (demo) {
        const nowIso = new Date().toISOString()
        const statusMap = {
          approve: 'Approved',
          reject: 'Declined',
          hold: 'OnHold',
          resubmission: 'Resubmission',
        } as const
        const nextKyc = loadDemoKyc().map((k) =>
          k.uid === uid
            ? {
                ...k,
                status: statusMap[action],
                rejectionReason: reason || (action === 'approve' ? null : k.rejectionReason),
                updatedAt: nowIso,
              }
            : k,
        )
        saveDemoKyc(nextKyc)
        // Mirror the decision onto the demo user record.
        const stateMap = {
          approve: 'active',
          reject: 'kyc_rejected',
          hold: 'kyc_on_hold',
          resubmission: 'kyc_resubmission',
        } as const
        const nextUsers = loadDemoUsers().map((u) =>
          u.uid === uid
            ? {
                ...u,
                accountState: stateMap[action],
                kycVerified: action === 'approve',
              }
            : u,
        )
        saveDemoUsers(nextUsers)
        setItems(nextKyc)
        return { ok: true }
      }
      const { ok, data } = await authedFetch(user, '/api/admin/kyc', {
        method: 'POST',
        body: JSON.stringify({ uid, action, reason }),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [demo, user, refresh],
  )

  return { items, loading, error, demo, refresh, decide }
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export function useAdminJobs() {
  const { user, configured } = useAuth()
  const demo = !configured

  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (demo) {
      const override = loadDemoJobsOverride()
      setJobs(override?.jobs?.length ? override.jobs : seedJobs())
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/jobs', { cache: 'no-store' })
      const data = (await res.json()) as { source: string; jobs: Job[] }
      setJobs(Array.isArray(data.jobs) ? data.jobs : [])
    } catch {
      setError('Network error while loading jobs.')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const mutate = useCallback(
    async (body: {
      action: 'create' | 'update' | 'delete' | 'set_status'
      id?: string
      status?: JobStatus
      job?: Partial<Job>
    }) => {
      if (demo) {
        const override = loadDemoJobsOverride()
        const current = override?.jobs?.length ? [...override.jobs] : seedJobs()
        let next: Job[] = current
        if (body.action === 'create' && body.job) {
          const id = body.id ?? `job-${Date.now().toString(36)}`
          next = [
            {
              responsibilities: [],
              requiresVerified: true,
              status: 'open',
              closesAt: new Date(Date.now() + 30 * 864e5).toISOString(),
              postedAgo: 'just now',
              ...body.job,
              id,
            } as Job,
            ...current,
          ]
        } else if (body.action === 'update' && body.id && body.job) {
          next = current.map((j) => (j.id === body.id ? { ...j, ...body.job, id: j.id } : j))
        } else if (body.action === 'set_status' && body.id && body.status) {
          next = current.map((j) => (j.id === body.id ? { ...j, status: body.status! } : j))
        } else if (body.action === 'delete' && body.id) {
          next = current.filter((j) => j.id !== body.id)
        }
        saveDemoJobsOverride(next)
        setJobs(next)
        return { ok: true }
      }

      const { ok, data } = await authedFetch(user, '/api/admin/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [demo, user, refresh],
  )

  return { jobs, loading, error, demo, refresh, mutate }
}

// ─── Applications ────────────────────────────────────────────────────────────

const WORKER_APPS_KEY = 'afterworks_applications_v2'

function loadWorkerApplications(userId: string): AdminApplication[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(WORKER_APPS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
    return parsed.map((a) => ({
      id: String(a.id),
      userId,
      userName: 'You (demo worker)',
      jobId: String(a.jobId),
      status: a.status as AdminApplication['status'],
      appliedAt: String(a.appliedAt ?? ''),
      reviewExpiresAt: String(a.reviewExpiresAt ?? ''),
      rejectionReason: a.rejectionReason as string | undefined,
      revisionNote: a.revisionNote as string | undefined,
      history: Array.isArray(a.history)
        ? (a.history as AdminApplication['history'])
        : [],
    }))
  } catch {
    return []
  }
}

function saveWorkerApplications(apps: AdminApplication[]) {
  if (typeof window === 'undefined') return
  const minimal = apps.map(({ id, jobId, status, appliedAt, reviewExpiresAt, rejectionReason, revisionNote, history }) => ({
    id,
    jobId,
    status,
    appliedAt,
    reviewExpiresAt,
    ...(rejectionReason ? { rejectionReason } : {}),
    ...(revisionNote ? { revisionNote } : {}),
    history,
  }))
  window.localStorage.setItem(WORKER_APPS_KEY, JSON.stringify(minimal))
  window.dispatchEvent(new CustomEvent('aw-applications-changed'))
}

const NEXT_STATUS: Record<string, AdminApplication['status']> = {
  approve: 'approved',
  reject: 'rejected',
  start_work: 'in_progress',
  submit_review: 'submitted_for_review',
  complete: 'completed',
  request_revision: 'revision_requested',
  fail_qa: 'failed_qa',
}

export function useAdminApplications() {
  const { user, configured } = useAuth()
  const demo = !configured

  const [items, setItems] = useState<AdminApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (demo) {
      setItems(loadWorkerApplications('demo-worker'))
      setLoading(false)
      return
    }
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
  }, [demo, user])

  useEffect(() => {
    void refresh()
    if (!demo) return
    const handler = () => setItems(loadWorkerApplications('demo-worker'))
    window.addEventListener('aw-applications-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('aw-applications-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [refresh, demo])

  const act = useCallback(
    async (id: string, action: string, note?: string) => {
      const nextStatus = NEXT_STATUS[action]
      if (!nextStatus) return { ok: false, error: 'Unknown action.' }

      if (demo) {
        const apps = loadWorkerApplications('demo-worker')
        const target = apps.find((a) => a.id === id)
        if (!target) return { ok: false, error: 'Application not found.' }

        // Demo slot accounting mirrors the server rules: approve decrements
        // the job's slots, reject refunds a held slot.
        const override = loadDemoJobsOverride()
        const jobs = override?.jobs?.length ? [...override.jobs] : seedJobs()
        let nextJobs = jobs
        if (action === 'approve') {
          nextJobs = jobs.map((j) =>
            j.id === target.jobId
              ? { ...j, slotsRemaining: Math.max(0, j.slotsRemaining - 1) }
              : j,
          )
        } else if (action === 'reject' && ['approved', 'in_progress', 'submitted_for_review', 'revision_requested'].includes(target.status)) {
          nextJobs = jobs.map((j) =>
            j.id === target.jobId ? { ...j, slotsRemaining: j.slotsRemaining + 1 } : j,
          )
        }
        if (nextJobs !== jobs) saveDemoJobsOverride(nextJobs)

        const nowIso = new Date().toISOString()
        const next = apps.map((a) =>
          a.id === id
            ? {
                ...a,
                status: nextStatus,
                rejectionReason: action === 'reject' ? note : a.rejectionReason,
                revisionNote: action === 'request_revision' ? note : a.revisionNote,
                history: [...a.history, { status: nextStatus, at: nowIso }],
              }
            : a,
        )
        saveWorkerApplications(next)
        setItems(next)
        return { ok: true }
      }

      const { ok, data } = await authedFetch(user, '/api/admin/applications', {
        method: 'POST',
        body: JSON.stringify({ id, action, note }),
      })
      if (ok) await refresh()
      return { ok, error: (data.error as string) ?? undefined }
    },
    [demo, user, refresh],
  )

  return { items, loading, error, demo, refresh, act }
}
