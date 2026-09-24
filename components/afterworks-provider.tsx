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
  readCatalogue,
  subscribeToJobs,
  getJobSnapshot,
} from '@/lib/firestore'
import {
  applyCatalogueSnapshot,
  CATALOGUE_PAGE_SIZE,
  CATALOGUE_POLL_MS,
  catalogueEntriesEqual,
  EMPTY_CATALOGUE,
  type CatalogueState,
} from '@/lib/job-catalogue'
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
  /** True when the cards on screen are real catalogue rows (not the sample catalogue). */
  catalogueLive: boolean
  /** When the worker-side catalogue last matched Firestore (ISO). null until the first live read. */
  catalogueSyncedAt: string | null
  /** True while a mutation is in flight, keyed by `job:<id>` / `app:<id>` — drives per-card spinners. */
  pending: Record<string, boolean>
  error: string | null
  clearError: () => void
  getJob: (id: string) => Job | undefined
  getApplicationForJob: (jobId: string) => Application | undefined
  isJobPaid: (jobId: string) => boolean
  /** Re-read the catalogue from Firestore now (Jobs page refresh button, tests, manual recovery). */
  refreshJobs: () => Promise<void>
  /**
   * Read one job card straight from Firestore and cache it for `getJob` — used by the job detail
   * and training pages so a deep link resolves even when the card is outside the bounded list read,
   * and so the fee/status shown there is the console's latest.
   */
  ensureJob: (id: string) => Promise<Job | null>
  verifyTrainingPayment: (
    jobId: string,
    reference: string,
  ) => Promise<{ ok: boolean; paid: boolean; status?: string; message?: string; error?: string }>
  applyToJob: (jobId: string) => Promise<ApplyResult>
  /** Worker-initiated: `approved` → `in_progress`. Idempotent. */
  startWork: (applicationId: string) => Promise<ApplyResult>
  submitWork: (
    applicationId: string,
    note?: string,
    links?: { label: string; url: string }[],
  ) => Promise<ApplyResult>
  withdrawApplication: (applicationId: string) => Promise<ApplyResult>
  refreshWallet: () => Promise<void>
  /** Move `amountUsd` from the available balance into a mobile money payout request. */
  requestWithdrawal: (amountUsd: number) => Promise<{ ok: boolean; error?: string }>
  refreshApplications: () => Promise<void>
  updateProfile: (updatedFields: Partial<WorkerProfile>) => Promise<void>
}

type WalletMeta = {
  entries: {
    id: string
    kind: string
    amountUsd: number
    status: string
    createdAt: string
    clearedAt: string | null
    jobTitle?: string
    applicationId?: string
  }[]
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
  const { user, configured } = useAuth()
  const uid = user?.uid ?? null
  const [worker, setWorker] = useState<WorkerProfile>(() => seedWorker())
  const [wallet, setWallet] = useState<Wallet>(BLANK_WALLET)
  const [walletMeta, setWalletMeta] = useState<WalletMeta>(BLANK_META)
  const [profileLoaded, setProfileLoaded] = useState(false)
  /**
   * The catalogue store. A ref mirrors the state because the catalogue callbacks do not re-create
   * on every render (that keeps the Firestore listener from being torn down and re-subscribed).
   */
  const catalogueRef = useRef<CatalogueState>(EMPTY_CATALOGUE)
  const [catalogue, setCatalogue] = useState<CatalogueState>(EMPTY_CATALOGUE)
  const jobs = catalogue.jobs
  /** Cards fetched individually (deep links, cards outside the bounded list). */
  const [jobCards, setJobCards] = useState<Record<string, Job>>({})
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

  // ── Catalogue: live from Firestore, seeded demo data otherwise ────────────────
  //
  // The board used to be read once per session, so anything the console changed afterwards — the
  // training price most visibly — stayed invisible on an open dashboard until a hard reload. Three
  // together now keep it current, in this order of importance:
  //   1. a Firestore listener (an admin save lands on the worker's screen in about a second);
  //   2. a visibility-aware poll, because a listener whose connection died does not reconnect by
  //      itself and some networks never allow the long-lived connection at all;
  //   3. focus/visibility refresh, which covers the everyday "I changed it in the console and
  //      switched back to this tab" flow without waiting for either of the above.
  //
  // The rules for folding a snapshot into the board (which read may remove a card, when sample
  // cards are allowed) live in `applyCatalogueSnapshot`; the ref mirrors the state so the callbacks
  // below — which do not re-create on every render — always read the current board.
  const applyLiveJobs = useCallback((incoming: Job[], authoritative: boolean) => {
    const next = applyCatalogueSnapshot(catalogueRef.current, {
      jobs: incoming,
      authoritative,
      sample: seedJobs,
      at: new Date().toISOString(),
    })
    if (next === catalogueRef.current) return
    catalogueRef.current = next
    setCatalogue(next)
  }, [])

  const refreshJobs = useCallback(async () => {
    if (!configured || !uid) return
    const { jobs: live, ok } = await readCatalogue(CATALOGUE_PAGE_SIZE)
    if (!mounted.current || !ok) return
    applyLiveJobs(live, true)
  }, [configured, uid, applyLiveJobs])

  useEffect(() => {
    if (!configured) {
      applyLiveJobs([], false)
      return
    }
    // The catalogue is readable by signed-in members (firestore.rules). Firing the read before the
    // session is known would be denied, and a denied listener never retries — so wait for the uid,
    // which also re-subscribes on sign-in/sign-out.
    if (!uid) return

    let cancelled = false
    const stopListening = subscribeToJobs(
      (incoming, meta) => {
        // A cached snapshot is a replay of what the browser last saw, so it may add to the board
        // but never take cards off it.
        if (!cancelled) applyLiveJobs(incoming, !meta.fromCache)
      },
      () => {
        // The listener is dead (blocked websocket, denied before the session was restored). The
        // poll below heals it; the board keeps whatever it already had.
      },
    )

    const sync = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void refreshJobs()
    }
    const poll = setInterval(sync, CATALOGUE_POLL_MS)
    if (typeof window !== 'undefined') window.addEventListener('focus', sync)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync)

    // The first read: a project with no catalogue yet stays explorable with the sample cards (the
    // reducer decides that), and an admin edit made while this tab was closed is picked up here.
    void refreshJobs()

    return () => {
      cancelled = true
      stopListening()
      clearInterval(poll)
      if (typeof window !== 'undefined') window.removeEventListener('focus', sync)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync)
    }
  }, [configured, uid, applyLiveJobs, refreshJobs])

  /**
   * Read one card and fold it into whichever store it belongs to, so the live list and a
   * single-document read can never disagree about a price, a slot count or a status.
   *
   * Rows are only ever *replaced*, never appended: a card outside the bounded list is served from
   * `jobCards` (so a deep link works) without growing the board.
   */
  const ensureJob = useCallback(
    async (id: string) => {
      if (!configured || !id) return null
      const { job, missing } = await getJobSnapshot(id)
      if (!mounted.current) return job

      if (job) {
        const before = catalogueRef.current
        if (before.jobs.some((row) => row.id === id)) {
          // Still one of the cards the live read returns: replace it in place, never append (the
          // board must not grow past the bounded read just because a card was opened).
          const rows = before.jobs.map((row) => (row.id === id && !catalogueEntriesEqual(row, job) ? job : row))
          if (rows.some((row, index) => row !== before.jobs[index])) {
            const next = { ...before, jobs: rows }
            catalogueRef.current = next
            setCatalogue(next)
          }
        }
        setJobCards((prev) => {
          const previous = prev[id]
          return previous && catalogueEntriesEqual(previous, job) ? prev : { ...prev, [id]: job }
        })
        return job
      }

      // A failed read reports `missing: false`: keep whatever is on screen rather than dropping a
      // card the worker is reading because the network hiccuped. Sample cards are excluded too —
      // they do not exist in Firestore and must not disappear as workers click them.
      if (!missing || !catalogueRef.current.live) return null

      setJobCards((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      const before = catalogueRef.current
      if (before.jobs.some((row) => row.id === id)) {
        const next = { ...before, jobs: before.jobs.filter((row) => row.id !== id) }
        catalogueRef.current = next
        setCatalogue(next)
      }
      return null
    },
    [configured],
  )

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
  }, [refreshWallet])

  /**
   * Request a payout of part or all of the available balance to the mobile money number on file.
   * The server moves the money into a `processing` withdrawal row inside one transaction; the
   * local state is refreshed straight from `/api/wallet` afterwards (never trusted to be right
   * from the request alone).
   */
  const requestWithdrawal = useCallback(
    async (amountUsd: number): Promise<{ ok: boolean; error?: string }> => {
      if (!user || !configured) return { ok: false, error: 'Sign in to withdraw.' }
      const key = 'wallet:withdraw'
      setBusy(key, true)
      try {
        await authedFetch('/api/wallet/withdraw', {
          method: 'POST',
          body: { amountUsd, method: 'M-Pesa' },
          idempotencyKey: `withdraw:${user.uid}:${Date.now().toString(36)}`,
        })
        await refreshWallet()
        return { ok: true }
      } catch (err) {
        const message = describeError(err)
        setError(message)
        return { ok: false, error: message }
      } finally {
        setBusy(key, false)
      }
    },
    [user, configured, refreshWallet, setBusy],
  )

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
  }, [refreshApplications])

  /**
   * Admin decisions arrive on the worker's dashboard through two server reads: the wallet ledger
   * (payouts, clearing) and the application list (approval, revision request, QA outcome).
   *
   * Refreshing only on mount meant a decision made while the tab was open stayed invisible until a
   * reload. This syncs both whenever the tab is looked at again and once a minute while it is
   * visible — one small GET each, and nothing at all in the background.
   */
  useEffect(() => {
    if (!user || !configured) return
    const sync = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void refreshWallet()
      void refreshApplications()
    }
    const id = setInterval(sync, 60_000)
    if (typeof window !== 'undefined') window.addEventListener('focus', sync)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync)
    return () => {
      clearInterval(id)
      if (typeof window !== 'undefined') window.removeEventListener('focus', sync)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync)
    }
  }, [user, configured, refreshWallet, refreshApplications])

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

  /** Worker starts an approved assignment (slot is already reserved; this only opens the work window). */
  const startWork = useCallback(
    async (applicationId: string): Promise<ApplyResult> => {
      if (!user || !configured) return { ok: false, reason: 'Sign in to start your work.' }
      setBusy(`app:${applicationId}`, true)
      try {
        await authedFetch('/api/applications', { method: 'PATCH', body: { applicationId, action: 'start_work' } })
        setApplications((prev) =>
          prev.map((a) =>
            a.id === applicationId
              ? {
                  ...a,
                  status: 'in_progress',
                  workStartedAt: a.workStartedAt ?? new Date().toISOString(),
                  history: [...a.history, { status: 'in_progress' as const, at: new Date().toISOString(), by: 'worker' }],
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

  const submitWork = useCallback(
    async (applicationId: string, note = '', links: { label: string; url: string }[] = []): Promise<ApplyResult> => {
      if (!user || !configured) return { ok: false, reason: 'Sign in to submit your work.' }
      // Mirror the server's link rules for the optimistic row: only http(s), so an unsanitised
      // href can never be rendered into the UI in the window before the server copy arrives.
      const safeLinks = links.filter((l) => typeof l?.url === 'string' && /^https?:\/\//i.test(l.url))
      setBusy(`app:${applicationId}`, true)
      try {
        await authedFetch('/api/applications', {
          method: 'PATCH',
          body: { applicationId, action: 'submit_work', note, links },
        })
        setApplications((prev) =>
          prev.map((a) =>
            a.id === applicationId
              ? {
                  ...a,
                  status: 'submitted_for_review',
                  workSubmittedAt: new Date().toISOString(),
                  workerNote: note,
                  workLinks: safeLinks,
                  history: [...a.history, { status: 'submitted_for_review' as const, at: new Date().toISOString(), by: 'worker' }],
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
      catalogueLive: catalogue.live,
      catalogueSyncedAt: catalogue.syncedAt,
      pending,
      error,
      clearError: () => setError(null),
      // The live list is the authority (it hears about admin edits first); individually fetched
      // cards fill the gaps for deep links and cards outside the bounded list.
      getJob: (id: string) => byId.get(id) ?? jobCards[id],
      getApplicationForJob: (jobId: string) => applications.find((a) => a.jobId === jobId),
      isJobPaid: (jobId: string) => paidTrainings.includes(jobId),
      refreshJobs,
      ensureJob,
      verifyTrainingPayment,
      applyToJob,
      startWork,
      submitWork,
      withdrawApplication,
      refreshWallet,
      requestWithdrawal,
      refreshApplications,
      updateProfile,
    }
  }, [
    worker,
    wallet,
    walletMeta,
    jobs,
    jobCards,
    applications,
    paidTrainings,
    profileLoaded,
    configured,
    user,
    catalogue,
    pending,
    error,
    refreshJobs,
    ensureJob,
    verifyTrainingPayment,
    applyToJob,
    startWork,
    submitWork,
    withdrawApplication,
    refreshWallet,
    requestWithdrawal,
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

export type JobDetailState = {
  job: Job | undefined
  /** True while a card that is not in the live catalogue is being fetched — render a spinner, not a 404. */
  checking: boolean
}

/**
 * Job detail / training page resolution.
 *
 * Two things have to be true on these pages:
 *  • a deep link works even when the card is outside the bounded list read (`ensureJob` reads the
 *    document directly), and does not flash "This job could not be found" while that read runs;
 *  • the price, slots and authored training content are the console's current ones, which is why
 *    the card is re-read when the tab regains focus instead of only when the page first mounts.
 */
export function useJobDetail(id: string | undefined): JobDetailState {
  const { getJob, ensureJob } = useAfterWorks()
  const job = id ? getJob(id) : undefined
  const [checking, setChecking] = useState(Boolean(id))

  useEffect(() => {
    if (!id) {
      setChecking(false)
      return
    }
    let cancelled = false
    setChecking(true)
    void ensureJob(id).finally(() => {
      if (!cancelled) setChecking(false)
    })
    const onSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void ensureJob(id)
    }
    if (typeof window !== 'undefined') window.addEventListener('focus', onSync)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onSync)
    return () => {
      cancelled = true
      if (typeof window !== 'undefined') window.removeEventListener('focus', onSync)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onSync)
    }
  }, [id, ensureJob])

  // A card already on the board needs no spinner; one that is missing may still be in flight.
  return { job, checking: !job && checking }
}
