/**
 * Client-side administrator helpers.
 *
 * What changed, and why it mattered: this module used to read `process.env.ADMIN_PASSWORD ||
 * process.env.NEXT_PUBLIC_ADMIN_PASSWORD` and treat `sessionStorage.getItem('admin_token')` as
 * proof of membership. Both are browser-observable. The NEXT_PUBLIC_ fallback in particular means
 * the shared admin passcode was compiled *into the shipped JavaScript bundle* — anyone who opened
 * devtools had it, and it stays in every cached copy of that bundle forever.
 *
 * So: this file contains no secrets and no verification. It is a thin, typed client for the
 * server-side gate in `app/api/admin/*`. Privilege is decided by an HttpOnly, expiring, revocable
 * cookie that the browser cannot read.
 */

'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, describeError } from '@/lib/client-api'
import type { MaintenanceConfig } from '@/lib/maintenance-shared'

export type AdminSessionState = {
  status: 'checking' | 'authorized' | 'anonymous'
  email?: string
  via?: 'session-cookie' | 'firebase-token'
  expiresAt?: string
  remainingSeconds?: number
  error?: string
}

export type AdminCapabilities = {
  consoleEnabled: boolean
  passcodeEnabled: boolean
  rosterConfigured: boolean
  lockoutThreshold: number
  lockoutMinutes: number
  sessionMinutes: number
  production: boolean
}

// ─── Shared session store (one check per tab, not one per component) ─────────

let cachedState: AdminSessionState = { status: 'checking' }
const listeners = new Set<(state: AdminSessionState) => void>()
let inflight: Promise<AdminSessionState> | null = null

function publish(next: AdminSessionState): void {
  cachedState = next
  for (const listener of listeners) listener(next)
}

async function probeAdminSession(force = false): Promise<AdminSessionState> {
  if (!force && cachedState.status !== 'checking') return cachedState
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const data = await apiFetch<{
        authenticated: boolean
        email?: string
        via?: 'session-cookie' | 'firebase-token'
        expiresAt?: string
        remainingSeconds?: number
      }>('/api/admin/session')
      const next: AdminSessionState = data.authenticated
        ? {
            status: 'authorized',
            email: data.email,
            via: data.via,
            expiresAt: data.expiresAt,
            remainingSeconds: data.remainingSeconds,
          }
        : { status: 'anonymous' }
      publish(next)
      return next
    } catch (err) {
      // A failed probe is not "authorised". Fail closed, keep the reason for the console.
      const next: AdminSessionState = { status: 'anonymous', error: describeError(err) }
      publish(next)
      return next
    } finally {
      inflight = null
    }
  })()

  return inflight
}

export function useAdminSession(): AdminSessionState & {
  refresh: () => Promise<AdminSessionState>
  signOut: () => Promise<void>
} {
  const [state, setState] = useState<AdminSessionState>(cachedState)

  useEffect(() => {
    listeners.add(setState)
    void probeAdminSession()
    return () => {
      listeners.delete(setState)
    }
  }, [])

  // Countdown-driven re-probe: an expired cookie must not leave a live console on screen.
  useEffect(() => {
    if (state.status !== 'authorized' || !state.remainingSeconds) return
    const delay = Math.min(Math.max((state.remainingSeconds - 30) * 1000, 30_000), 2 ** 31 - 1)
    const timer = setTimeout(() => void probeAdminSession(true), delay)
    return () => clearTimeout(timer)
  }, [state.status, state.remainingSeconds])

  const refresh = useCallback(async () => {
    publish({ status: 'checking' })
    return probeAdminSession(true)
  }, [])

  const signOut = useCallback(async () => {
    try {
      await apiFetch('/api/admin/session', { method: 'POST' })
    } finally {
      publish({ status: 'anonymous' })
    }
  }, [])

  return { ...state, refresh, signOut }
}

/** Non-hook read for one-off checks (nav badges, guards inside event handlers). */
export function getCachedAdminState(): AdminSessionState {
  return cachedState
}

// ─── Sign-in ─────────────────────────────────────────────────────────────────

export async function authenticateAdminSession(
  email: string,
  passcode: string,
): Promise<{ ok: true; email: string; expiresAt: string } | { ok: false; error: string; remainingAttempts?: number; locked?: boolean }> {
  const cleanEmail = email.trim().toLowerCase()
  const cleanPass = passcode.slice(0, 200)
  if (!cleanEmail || !cleanPass) {
    return { ok: false, error: 'Enter both your administrator email and passcode.' }
  }

  try {
    const data = await apiFetch<{ ok: true; email: string; session: { expiresAt: string } }>('/api/admin/auth', {
      method: 'POST',
      body: { email: cleanEmail, password: cleanPass },
      timeoutMs: 25_000,
    })
    publish({ status: 'authorized', email: data.email, via: 'session-cookie', expiresAt: data.session.expiresAt })
    void probeAdminSession(true)
    return { ok: true, email: data.email, expiresAt: data.session.expiresAt }
  } catch (err) {
    const anyErr = err as { message?: string; remainingAttempts?: number; locked?: boolean }
    return {
      ok: false,
      error: anyErr?.message || 'Sign-in failed. Please check your credentials and try again.',
      remainingAttempts: typeof anyErr?.remainingAttempts === 'number' ? anyErr.remainingAttempts : undefined,
      locked: Boolean(anyErr?.locked),
    }
  }
}

export function useAdminCapabilities(): AdminCapabilities | null {
  const [caps, setCaps] = useState<AdminCapabilities | null>(null)
  useEffect(() => {
    let cancelled = false
    apiFetch<AdminCapabilities>('/api/admin/auth')
      .then((data) => {
        if (!cancelled) setCaps(data)
      })
      .catch(() => {
        if (!cancelled) setCaps({ consoleEnabled: false, passcodeEnabled: false, rosterConfigured: false, lockoutThreshold: 5, lockoutMinutes: 15, sessionMinutes: 240, production: false })
      })
    return () => {
      cancelled = true
    }
  }, [])
  return caps
}

/**
 * UI-only convenience. "Should we show the Admin link in the navigation" is a cosmetic question,
 * answered from the server-provided profile. Authorisation is a different question, answered by
 * `useAdminSession()` and — decisively — by the API guard on every call.
 */
export function isUserAdmin(
  user?: { email?: string | null; idTokenResult?: { claims?: Record<string, unknown> } } | null,
  worker?: { isAdmin?: boolean; role?: string } | null,
): boolean {
  if (worker?.isAdmin === true || worker?.role === 'admin') return true
  const claims = user?.idTokenResult?.claims as { admin?: boolean } | undefined
  return claims?.admin === true
}

/** Legacy no-op kept so older call sites do not crash while the tab still holds stale state. */
export async function terminateAdminSession(): Promise<void> {
  try {
    await apiFetch('/api/admin/session', { method: 'POST' })
  } catch {
    /* the cookie is cleared server-side regardless of this call */
  } finally {
    publish({ status: 'anonymous' })
    if (typeof window !== 'undefined') {
      // Purge the pre-hardening artefacts so a stale "admin" flag cannot linger in a tab.
      window.sessionStorage.removeItem('afterworks_admin_session_token')
      window.sessionStorage.removeItem('afterworks_admin_session_time')
    }
  }
}

// ─── Console data calls (all server-gated) ───────────────────────────────────

export const adminApi = {
  stats: (refresh = false) => apiFetch<Record<string, unknown>>('/api/admin', { query: refresh ? { refresh: 1 } : undefined, timeoutMs: 30_000 }),
  operatorAction: (body: Record<string, unknown>) => apiFetch<{ ok: boolean }>('/api/admin', { method: 'PATCH', body }),
  maintenance: () =>
    apiFetch<{ ok: boolean; config: MaintenanceConfig; status: Record<string, unknown>; forced?: boolean }>('/api/admin/maintenance'),
  saveMaintenance: (patch: Partial<MaintenanceConfig>) =>
    apiFetch<{ ok: boolean; config: MaintenanceConfig; changed: string[]; effective: Record<string, unknown>; forced?: boolean; warning?: string }>(
      '/api/admin/maintenance', {
      method: 'PUT',
      body: patch,
    }),
  disableMaintenance: () =>
    apiFetch<{ ok: boolean; config: MaintenanceConfig; effective?: Record<string, unknown>; forced?: boolean; warning?: string }>(
      '/api/admin/maintenance',
      { method: 'DELETE' },
    ),
  users: (query: { pageSize?: number; cursor?: string | null; search?: string; state?: string }) =>
    apiFetch<{ ok: boolean; rows: AdminUserRow[]; nextCursor: string | null; hasMore: boolean; degraded?: string }>('/api/admin/users', { query }),
  userDetail: (uid: string) => apiFetch<{ ok: boolean; user: Record<string, unknown> }>('/api/admin/users', { query: { uid } }),
  userAction: (body: Record<string, unknown>) => apiFetch<{ ok: boolean; note?: string }>('/api/admin/users', { method: 'PATCH', body }),
  applications: (query: { pageSize?: number; cursor?: string | null; status?: string; search?: string }) =>
    apiFetch<{ ok: boolean; rows: AdminApplicationRow[]; nextCursor: string | null; hasMore: boolean; degraded?: string }>('/api/admin/applications', { query }),
  applicationAction: (body: Record<string, unknown>) => apiFetch<{ ok: boolean; message?: string; status?: string }>('/api/admin/applications', { method: 'PATCH', body }),
  bulkApplicationAction: (body: Record<string, unknown>) => apiFetch<{ ok: boolean; applied: number; results: { id: string; ok: boolean; error?: string }[] }>('/api/admin/applications', { method: 'POST', body }),
  jobs: (query?: { status?: string }) => apiFetch<{ ok: boolean; jobs: AdminJobRow[] }>('/api/admin/jobs', { query }),
  saveJob: (body: Record<string, unknown>) => apiFetch<{ ok: boolean; id: string }>('/api/admin/jobs', { method: 'PUT', body }),
  setJobStatus: (body: { jobId: string; status: string }) => apiFetch<{ ok: boolean }>('/api/admin/jobs', { method: 'PATCH', body }),
  deleteJob: (jobId: string) => apiFetch<{ ok: boolean }>('/api/admin/jobs', { method: 'DELETE', query: { jobId } }),
  auditLogs: (query: { limit?: number; action?: string; search?: string }) =>
    apiFetch<{ ok: boolean; logs: Record<string, unknown>[]; actions: string[]; exportUrl: string }>('/api/admin/audit', { query }),
  /** Who you are to the API right now — the authority the console runs on, with its real expiry. */
  sessionInfo: () =>
    apiFetch<{
      ok: boolean
      authenticated: boolean
      email?: string
      via?: 'cookie' | 'firebase-token'
      expiresAt?: string
      remainingSeconds?: number
      sessionMinutes?: number
      reason?: string
      signInPath?: string
    }>('/api/admin/session'),
  /** Machine-readable self-check, for the Security page and for curl-ing from a deploy log. */
  health: async (): Promise<Record<string, unknown>> => {
    const res = await fetch('/api/health?checks=1', { credentials: 'same-origin', cache: 'no-store' })
    return (await res.json()) as Record<string, unknown>
  },
}

/** Row shape the users directory renders (mirrors `AdminUserRow` on the server). */
export type AdminUserRow = {
  uid: string
  name: string
  email: string
  accountState: string
  kycVerified: boolean
  kycStatus?: string
  role: string
  qualityScore: number
  jobsCompleted: number
  memberSince: string
  createdAt: string | null
  lastActiveAt: string | null
  wallet: { pendingUsd: number; availableUsd: number; payoutNumberMasked: string }
  country?: string
  phoneMasked?: string
  paidTrainingsCount: number
}

/** Row shape for the QA desk. */
export type AdminApplicationRow = {
  id: string
  jobId: string
  jobTitle: string
  workerUid: string
  workerEmail: string
  status: string
  payAmountUsd: number
  appliedAt: string
  updatedAt?: string
  reviewExpiresAt?: string
  rejectionReason?: string
  revisionNote?: string
  handledBy?: string
  history: { status: string; at: string; by?: string }[]
  overdue: boolean
}

/** Row shape for the catalogue editor. */
export type AdminJobRow = {
  id: string
  title: string
  category: string
  description: string
  responsibilities: string[]
  payAmountUsd: number
  estimatedMinutes: number
  capacity: number
  slotsRemaining: number
  trainingRequired: boolean
  requiresVerified: boolean
  status: string
  closesAt: string
  postedAgo: string
  updatedAt?: string
}
