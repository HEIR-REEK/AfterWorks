'use client'

/**
 * AfterWorks application state (worker side).
 *
 * This is where the product stopped being a mock. Previously:
 *  • applications lived in `localStorage` only — invisible to the console, per-device, and fully
 *    editable by the worker (status, history, what they had been paid for);
 *  • "paid training" was granted by writing `aw_training_paid_<jobId>` into localStorage, i.e. the
 *    paywall was decorative;
 *  • profile edits were cached unfiltered, so privileged fields could round-trip through storage.
 *
 * Now the server owns every decision. Reads come from `/api/applications` and the member's own
 * Firestore document; writes go through routes that re-check eligibility (KYC, account state,
 * training entitlement, slot capacity, ownership). Where the platform is not configured — a fresh
 * clone, or an offline demo — `mode` reports `'demo'` and the UI says so, instead of inventing
 * balances and a fake "Applied" history.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  seedJobs,
  seedWorker,
  type Application,
  type Job,
  type Wallet,
  type WorkerProfile,
} from '@/lib/afterworks-data'
import {
  getUserDocument,
  subscribeToUserDocument,
  updateUserProfile,
  updateUserWallet,
  subscribeToJobs,
} from '@/lib/firestore'
import { useAuth } from '@/components/firebase-auth-provider'
import { isUserAdmin } from '@/lib/admin'
import { authedFetch, describeError } from '@/lib/client-api'

export type ApplyResult = { ok: true; applicationId: string } | { ok: false; reason: string }

type AfterWorksContextValue = {
  worker: WorkerProfile
  wallet: Wallet
  walletMeta: WalletMeta
  jobs: Job[]
  applications: Application[]
  paidTrainings: string[]
  profileLoaded: boolean
  mode: 'live' | 'demo'
  /** True while a mutation is in flight, keyed by `job:<id>` / `app:<id>` — drives per-card spinners. */
  pending: Record<string, boolean>
  error: string | null
  clearError: () => void
  getJob: (id: string) => Job | undefined
  getApplicationForJob: (jobId: string) => Application | undefined
  isJobPaid: (jobId: string) => boolean
  verifyTrainingPayment: (
    jobId: string,
    reference: string,
  ) => Promise<{ ok: boolean; paid: boolean; status?: string; message?: string; error?: string }>
  applyToJob: (jobId: string) => Promise<ApplyResult>
  submitWork: (applicationId: string, note?: string) => Promise<ApplyResult>
  withdrawApplication: (applicationId: string) => Promise<ApplyResult>
  refreshWallet: () => Promise<void>
  refreshApplications: () => Promise<void>
  updateProfile: (updatedFields: Partial<WorkerProfile>) => Promise<void>
}

type WalletMeta = {
  entries: { id: string; kind: string; amountUsd: number; status: string; createdAt: string; clearedAt: string | null; jobTitle?: string }[]
  nextClearingAt: string | null
  clearingHours: number
  minWithdrawalUsd: number
  availableKes: number
  asOf: string | null
}

const BLANK_WALLET: Wallet = { pendingUsd: 0, availableUsd: 0, payoutNumber: '' }
const BLANK_META: WalletMeta = {
  entries: [],
  nextClearingAt: null,
  clearingHours: 72,
  minWithdrawalUsd: 10,
  availableKes: 0,
  asOf: null,
}

const AfterWorksContext = createContext<AfterWorksContextValue | null>(null)

/** Optimistic rows shown before the server has persisted them; keyed so a refresh cannot duplicate. */
type PendingApplication = Application & { _pending?: boolean }

export function AfterWorksProvider({ children }: { children: ReactNode }) {
  const { user, configured, loading: authLoading } = useAuth()
  // Key catalogue effects off the stable uid — the User object can be re-set (focus reload)
  // without the account actually changing, and that must not tear down live listeners.
  const userId = user?.uid ?? null
  const [worker, setWorker] = useState<WorkerProfile>(() => seedWorker())
  const [wallet, setWallet] = useState<Wallet>(BLANK_WALLET)
  const [walletMeta, setWalletMeta] = useState<WalletMeta>(BLANK_META)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [applications, setApplications] = useState<PendingApplication[]>([])
  const [paidTrainings, setPaidTrainings] = useState<string[]>([])
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const setBusy = useCallback((key: string, value: boolean) => {
    setPending((prev) => {
      if (Boolean(prev[key]) === value) return prev
      const next = { ...prev }
      if (value) next[key] = true
      else delete next[key]
      return next
    })
  }, [])

  // ── Catalogue: live Firestore listener when configured, seeded demo data otherwise ──────
  useEffect(() => {
    if (!configured) {
      setJobs(seedJobs())
      return
    }
    // The rules only let a signed-in member list `jobs`, so wait for auth to settle and
    // re-attach whenever the account changes. The old one-shot load ran on mount regardless:
    // a read fired before `onAuthStateChanged` resolves comes back permission-denied, that
    // failure was swallowed into `[]`, and the board silently fell back to seed data for the
    // whole session — which is why console edits (training fee, pay, slots, copy) never
    // reached the worker side. A live listener also pushes later edits to every open tab.
    if (authLoading) return
    if (!userId) {
      setJobs(seedJobs())
      return
    }

    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const attach = () => {
      if (cancelled) return
      // A listener that errored is already dead; unsubscribe is a safe no-op there but keeps
      // retries from stacking subscriptions if one somehow survives.
      unsubscribe?.()
      unsubscribe = subscribeToJobs(
        (live) => {
          if (cancelled) return
          attempt = 0
          // An empty collection still means "no live listings"; keep the demo catalogue visible
          // so a fresh project is explorable — and because this is a listener, publishing the
          // first real job replaces the sample cards without needing a reload.
          setJobs(live.length ? live : seedJobs())
        },
        () => {
          if (cancelled) return
          // The listener died (rare: token/permission edge or a misconfigured project). Keep
          // what is already on screen and re-attach with a short backoff. Never swap live
          // listings for demo seeds here — silently showing seed data while the banner says
          // "live" is exactly what made console edits look like they never saved.
          attempt += 1
          if (attempt <= 5) {
            retryTimer = setTimeout(attach, Math.min(15_000, 1_000 * 2 ** (attempt - 1)))
          }
        },
      )
    }
    attach()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubscribe?.()
    }
  }, [configured, authLoading, userId])

  // ── Profile + wallet ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      setWorker(seedWorker())
      setWallet(BLANK_WALLET)
      setPaidTrainings([])
      setApplications([])
      setProfileLoaded(true)
      return
    }

    const applyDocument = (userDoc: Awaited<ReturnType<typeof mapUserDoc>>) => {
      if (!mounted.current) return
      if (userDoc) {
        setWorker(userDoc.worker)
        setWallet(userDoc.wallet)
        setPaidTrainings((prev) => Array.from(new Set([...prev, ...userDoc.paidTrainings])))
      }
      setProfileLoaded(true)
    }

    const unsubscribe = subscribeToUserDocument(user.uid, (doc) => {
      void mapUserDoc(doc, user).then(applyDocument)
    })

    // One immediate read so the first paint is not blank while the listener warms up.
    void getUserDocument(user.uid)
      .then((doc) => mapUserDoc(doc, user).then(applyDocument))
      .catch(() => setProfileLoaded(true))

    return () => unsubscribe()
  }, [user])

  // ── Wallet snapshot (server-derived) ────────────────────────────────────────────
  const refreshWallet = useCallback(async () => {
    if (!user || !configured) return
    try {
      const data = await authedFetch<Record<string, unknown>>('/api/wallet')
      if (!mounted.current) return
      setWallet({
        pendingUsd: Number(data.pendingUsd ?? 0) || 0,
        availableUsd: Number(data.availableUsd ?? 0) || 0,
        payoutNumber: String(data.payoutNumber ?? ''),
      })
      setWalletMeta({
        entries: Array.isArray(data.entries) ? (data.entries as WalletMeta['entries']) : [],
        nextClearingAt: (data.nextClearingAt as string | null) ?? null,
        clearingHours: Number(data.clearingHours ?? 72) || 72,
        minWithdrawalUsd: Number(data.minWithdrawalUsd ?? 10) || 10,
        availableKes: Number(((data.fx as Record<string, unknown>)?.availableKes as number) ?? 0) || 0,
        asOf: (data.asOf as string) ?? null,
      })
      if (Array.isArray(data.paidTrainings)) {
        setPaidTrainings((prev) => Array.from(new Set([...prev, ...(data.paidTrainings as string[]).filter(Boolean)])))
      }
    } catch (err) {
      // A wallet read failing must not wipe the numbers already on screen.
      console.warn('[wallet] refresh failed:', describeError(err))
    }
  }, [user, configured])

  useEffect(() => {
    void refreshWallet()
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void refreshWallet()
    }, 90_000)
    return () => clearInterval(id)
  }, [refreshWallet])

  // ── Applications (server-owned) ─────────────────────────────────────────────────
  const refreshApplications = useCallback(async () => {
    if (!user || !configured) return
    try {
      const data = await authedFetch<{ applications: Application[] }>('/api/applications')
      if (!mounted.current) return
      const serverRows = Array.isArray(data.applications) ? data.applications : []
      setApplications((prev) => {
        const serverIds = new Set(serverRows.map((row) => row.id))
        const stillPending = prev.filter((row) => row._pending && !serverIds.has(row.id))
        return [...stillPending, ...serverRows] as PendingApplication[]
      })
    } catch (err) {
      const status = (err as { status?: number })?.status
      if (status === 401 && mounted.current) setError('Your session expired. Sign in again to see your applications.')
    }
  }, [user, configured])

  useEffect(() => {
    void refreshApplications()
    // Admin decisions (approve / reject / QA verdicts) land server-side at any moment; re-read
    // when the worker comes back to the tab so the dashboard is not showing a stale pipeline.
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void refreshApplications()
      }
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined') window.addEventListener('focus', onVisible)
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      if (typeof window !== 'undefined') window.removeEventListener('focus', onVisible)
    }
  }, [refreshApplications])

  // ── Mutations ───────────────────────────────────────────────────────────────────
  const applyToJob = useCallback(
    async (jobId: string): Promise<ApplyResult> => {
      if (!user || !configured) {
        return { ok: false, reason: 'Sign in to apply for jobs.' }
      }
      setBusy(`job:${jobId}`, true)
      try {
        const data = await authedFetch<{ applicationId: string }>('/api/applications', {
          method: 'POST',
          body: { jobId },
          // A retry after a dropped connection must not create a second application.
          idempotencyKey: `apply:${user.uid}:${jobId}`,
        })
        const now = new Date().toISOString()
        const optimistic: PendingApplication = {
          id: data.applicationId,
          jobId,
          status: 'under_review',
          appliedAt: now,
          reviewExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          history: [{ status: 'under_review', at: now }],
          _pending: false,
        }
        setApplications((prev) => [optimistic, ...prev.filter((a) => a.jobId !== jobId)])
        void refreshApplications()
        return { ok: true, applicationId: data.applicationId }
      } catch (err) {
        const message = describeError(err)
        setError(message)
        return { ok: false, reason: message }
      } finally {
        setBusy(`job:${jobId}`, false)
      }
    },
    [user, configured, refreshApplications, setBusy],
  )

  const submitWork = useCallback(
    async (applicationId: string, note = ''): Promise<ApplyResult> => {
      if (!user || !configured) return { ok: false, reason: 'Sign in to submit your work.' }
      setBusy(`app:${applicationId}`, true)
      try {
        await authedFetch('/api/applications', { method: 'PATCH', body: { applicationId, action: 'submit_work', note } })
        setApplications((prev) =>
          prev.map((a) =>
            a.id === applicationId
              ? {
                  ...a,
                  status: 'submitted_for_review',
                  history: [...a.history, { status: 'submitted_for_review' as const, at: new Date().toISOString() }],
                }
              : a,
          ),
        )
        void refreshApplications()
        return { ok: true, applicationId }
      } catch (err) {
        const message = describeError(err)
        setError(message)
        return { ok: false, reason: message }
      } finally {
        setBusy(`app:${applicationId}`, false)
      }
    },
    [user, configured, refreshApplications, setBusy],
  )

  const withdrawApplication = useCallback(
    async (applicationId: string): Promise<ApplyResult> => {
      if (!user || !configured) return { ok: false, reason: 'Sign in first.' }
      setBusy(`app:${applicationId}`, true)
      try {
        await authedFetch('/api/applications', { method: 'PATCH', body: { applicationId, action: 'withdraw' } })
        setApplications((prev) => prev.filter((a) => a.id !== applicationId))
        void refreshApplications()
        return { ok: true, applicationId }
      } catch (err) {
        const message = describeError(err)
        setError(message)
        return { ok: false, reason: message }
      } finally {
        setBusy(`app:${applicationId}`, false)
      }
    },
    [user, configured, refreshApplications, setBusy],
  )

  /**
   * Training entitlement: the *server* confirms the Paystack reference before anything unlocks,
   * and the entitlement is read back from the profile document. The old implementation trusted a
   * `localStorage` flag, so `localStorage.setItem('aw_training_paid_x','true')` bought the course.
   */
  const verifyTrainingPayment = useCallback(
    async (jobId: string, reference: string) => {
      if (!reference) return { ok: false, paid: false, error: 'No payment reference was returned by the checkout.' }
      setBusy(`training:${jobId}`, true)
      try {
        const data = await authedFetch<{ paid: boolean; status?: string; message?: string }>(
          `/api/paystack/verify/${encodeURIComponent(reference)}`,
        )
        const paid = data.paid === true
        if (paid) {
          setPaidTrainings((prev) => (prev.includes(jobId) ? prev : [...prev, jobId]))
          await refreshWallet()
        }
        return {
          ok: true,
          paid,
          status: data.status,
          message: typeof data.message === 'string' ? data.message : undefined,
        }
      } catch (err) {
        return { ok: false, paid: false, error: describeError(err) }
      } finally {
        setBusy(`training:${jobId}`, false)
      }
    },
    [refreshWallet, setBusy],
  )

  const updateProfile = useCallback(
    async (fields: Partial<WorkerProfile>) => {
      // Optimistic UI, but only for the fields a member is actually allowed to set — the rest are
      // dropped here and rejected by both the rules and the API if someone bypasses this code.
      const allowed = new Set([
        'name',
        'location',
        'bio',
        'skills',
        'languages',
        'preferredPayoutMethod',
        'country',
        'zipCode',
        'bankName',
        'bankBranch',
        'bankAccountNumber',
        'school',
        'course',
        'jobExperience',
        'career',
        'phone',
      ])
      const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key)))

      setWorker((prev) => ({ ...prev, ...(safe as Partial<WorkerProfile>) }))
      if (!user || !configured) return

      try {
        await updateUserProfile(user.uid, safe as Record<string, never>)
        if (typeof safe.phone === 'string' && safe.phone) {
          await updateUserWallet(user.uid, { payoutNumber: safe.phone })
          setWallet((w) => ({ ...w, payoutNumber: safe.phone as string }))
        }
      } catch (err) {
        console.error('[profile] update failed:', err)
        setError('Your changes could not be saved. Please try again.')
      }
    },
    [user, configured],
  )

  const value = useMemo<AfterWorksContextValue>(() => {
    const byId = new Map(jobs.map((j) => [j.id, j]))
    return {
      worker,
      wallet,
      walletMeta,
      jobs,
      applications,
      paidTrainings,
      profileLoaded,
      mode: configured && user ? 'live' : 'demo',
      pending,
      error,
      clearError: () => setError(null),
      getJob: (id: string) => byId.get(id),
      getApplicationForJob: (jobId: string) => applications.find((a) => a.jobId === jobId),
      isJobPaid: (jobId: string) => paidTrainings.includes(jobId),
      verifyTrainingPayment,
      applyToJob,
      submitWork,
      withdrawApplication,
      refreshWallet,
      refreshApplications,
      updateProfile,
    }
  }, [
    worker,
    wallet,
    walletMeta,
    jobs,
    applications,
    paidTrainings,
    profileLoaded,
    configured,
    user,
    pending,
    error,
    verifyTrainingPayment,
    applyToJob,
    submitWork,
    withdrawApplication,
    refreshWallet,
    refreshApplications,
    updateProfile,
  ])

  return <AfterWorksContext.Provider value={value}>{children}</AfterWorksContext.Provider>
}

/** Maps a Firestore user document onto the profile the UI consumes. */
async function mapUserDoc(
  doc: Awaited<ReturnType<typeof getUserDocument>>,
  user: { email?: string | null; displayName?: string | null } | null,
) {
  if (!doc) return null
  const adminStatus = isUserAdmin({ idTokenResult: { claims: { admin: doc.isAdmin === true || doc.role === 'admin' } } }, doc)
  const worker: WorkerProfile = {
    name: doc.name || user?.displayName || user?.email?.split('@')[0] || '',
    email: user?.email || doc.email || '',
    location: doc.location || '',
    // Security-critical values always come from the document, never from cache or the client.
    accountState: doc.accountState || 'active',
    role: adminStatus ? 'admin' : doc.role || 'user',
    isAdmin: adminStatus,
    kycVerified: doc.kycVerified ?? false,
    kycVerifiedAt: doc.kycVerifiedAt,
    kycRejectedAt: doc.kycRejectedAt,
    kycOnHoldAt: doc.kycOnHoldAt,
    kycProvider: doc.kycProvider,
    kycLevel: doc.kycLevel,
    kycStatus: doc.kycStatus,
    kycRejectionReason: doc.kycRejectionReason ?? null,
    kycFailedChecks: doc.kycFailedChecks ?? null,
    qualityScore: typeof doc.qualityScore === 'number' ? doc.qualityScore : 100,
    jobsCompleted: typeof doc.jobsCompleted === 'number' ? doc.jobsCompleted : 0,
    memberSince: doc.memberSince || '',
    phone: doc.phone || doc.wallet?.payoutNumber || '',
    bio: doc.bio || '',
    skills: doc.skills || [],
    languages: doc.languages || [],
    preferredPayoutMethod: doc.preferredPayoutMethod || 'M-Pesa',
    country: doc.country || '',
    zipCode: doc.zipCode || '',
    bankName: doc.bankName || '',
    bankBranch: doc.bankBranch || '',
    bankAccountNumber: doc.bankAccountNumber || '',
    school: doc.school || '',
    course: doc.course || '',
    jobExperience: doc.jobExperience || '',
    career: doc.career || '',
  }
  return {
    worker,
    wallet: {
      pendingUsd: doc.wallet?.pendingUsd ?? 0,
      availableUsd: doc.wallet?.availableUsd ?? 0,
      payoutNumber: doc.wallet?.payoutNumber ?? doc.phone ?? '',
    },
    paidTrainings: Array.isArray(doc.paidTrainings) ? doc.paidTrainings.filter((v): v is string => typeof v === 'string') : [],
  }
}

export function useAfterWorks() {
  const ctx = useContext(AfterWorksContext)
  if (!ctx) throw new Error('useAfterWorks must be used within an AfterWorksProvider')
  return ctx
}
