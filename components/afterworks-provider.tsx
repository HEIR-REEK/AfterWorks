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
  readCatalogue,
  subscribeToJobs,
  getJobSnapshot,
} from '@/lib/firestore'
import { profileCompletion, type ProfileCompletion } from '@/lib/profile-completion'
import { guessCountryFromE164 } from '@/lib/countries'
import type { PayoutDestinationState, PayoutRequestRow, WalletEntry, WelcomeBonusState } from '@/lib/payouts'
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

export type ProfileSaveResult =
  | {
      ok: true
      saved: string[]
      dropped: string[]
      completion: ProfileCompletion
      /** Present when this save released the $5 welcome reward. */
      grantedBonus: { amountUsd: number } | null
      bonusAlreadyGranted: boolean
      /**
       * Present when this save completed a profile for somebody who was referred — the $3 went to
       * *their* referrer, not to this member, so the UI says so rather than showing a balance that
       * did not move.
       */
      releasedReferral: { referrerName: string; bonusUsd: number } | null
    }
  | { ok: false; error: string }

export type PayoutEligibility = {
  kycVerified: boolean
  accountState: string
  destinationReady: boolean
  destinationProblem: string | null
  minWithdrawalUsd: number
  withdrawableUsd: number
  heldUsd: number
  openPayoutId: string | null
  openPayoutStatus: PayoutRequestRow['status'] | null
  canRequest: boolean
}

/**
 * The onboarding layer the popups are driven from — one state machine, used by the app shell, the
 * dashboard and the profile page, so "the prompt and the congratulations never both appear, and
 * neither appears twice" is a property of the state, not of three components agreeing.
 */
export type OnboardingState = {
  /** Server-scored profile progress for the signed-in member. */
  completion: ProfileCompletion
  /** True while the member still owes a profile and has not dismissed the prompt this session. */
  promptOpen: boolean
  /** Set when the reward has just been paid (or was paid elsewhere) and should be celebrated. */
  reward: { open: boolean; amountUsd: number; alreadyPaid: boolean } | null
  /** Member dismissed the reminder for now (the profile tab still re-opens it). */
  dismissPrompt: () => void
  /** The profile page (or any explicit CTA) asks for the prompt again. */
  requestPrompt: () => void
  dismissReward: () => void
}

type AfterWorksContextValue = {
  worker: WorkerProfile
  wallet: Wallet
  walletMeta: WalletMeta
  /** Server-computed wallet snapshot: held amount, withdrawable balance, payout state. */
  payouts: PayoutState
  onboarding: OnboardingState
  /** Save profile fields through PATCH /api/profile (server-validated; may release the $5). */
  saveProfile: (fields: Record<string, unknown>) => Promise<ProfileSaveResult>
  /** Ask the server to settle the $5 reward (used when the profile is already complete). */
  claimWelcomeBonus: () => Promise<{ ok: boolean; granted: boolean; error?: string }>
  requestPayout: (amountUsd: number) => Promise<{ ok: boolean; error?: string }>
  cancelPayout: (requestId: string) => Promise<{ ok: boolean; error?: string }>
  refreshPayouts: () => Promise<void>
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
  submitWork: (applicationId: string, note?: string) => Promise<ApplyResult>
  withdrawApplication: (applicationId: string) => Promise<ApplyResult>
  refreshWallet: () => Promise<void>
  refreshApplications: () => Promise<void>
}

type WalletMeta = {
  entries: WalletEntry[]
  nextClearingAt: string | null
  clearingHours: number
  minWithdrawalUsd: number
  availableKes: number
  asOf: string | null
}

/**
 * Everything the wallet panel needs that the legacy `wallet` object does not carry: the hold, what
 * is genuinely withdrawable, where a payout would go, the open request and the reward state. All of
 * it is computed by the server (`lib/wallet-server.ts`) and copied here verbatim.
 */
export type PayoutState = {
  heldUsd: number
  minWithdrawalUsd: number
  withdrawableUsd: number
  withdrawableKes: number
  pendingKes: number
  usdToKes: number
  destination: PayoutDestinationState
  openPayout: PayoutRequestRow | null
  requests: PayoutRequestRow[]
  welcomeBonus: WelcomeBonusState
  kycVerified: boolean
  accountState: string
  loaded: boolean
}

const BLANK_WALLET: Wallet = { pendingUsd: 0, availableUsd: 0, payoutNumber: '' }
const BLANK_META: WalletMeta = {
  entries: [],
  nextClearingAt: null,
  clearingHours: 72,
  minWithdrawalUsd: 50,
  availableKes: 0,
  asOf: null,
}
const BLANK_PAYOUTS: PayoutState = {
  heldUsd: 0,
  minWithdrawalUsd: 50,
  withdrawableUsd: 0,
  withdrawableKes: 0,
  pendingKes: 0,
  usdToKes: 0,
  destination: { ready: false, method: 'M-Pesa', label: 'No payout details saved', accountName: '', problem: 'Add your payout details on the profile page.' },
  openPayout: null,
  requests: [],
  welcomeBonus: { amountUsd: 5, granted: false, grantedAt: null, pendingFromStaff: false },
  kycVerified: false,
  accountState: 'active',
  loaded: false,
}

/**
 * Cosmetic acknowledgement marker for the congratulations popup.
 *
 * Deliberately browser-local and per-uid: it records "this person has seen the celebration in this
 * browser", which is a display concern, not a financial one. Whether the $5 was actually paid is
 * decided by `wallet_ledger/signup_bonus_<uid>` on the server — never by this key.
 */
function celebrationKey(uid: string): string {
  return `afterworks:celebrated:${uid}`
}

function hasCelebrated(uid: string): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(celebrationKey(uid)) === '1'
  } catch {
    return true // storage blocked (private mode) — better to miss a popup than to loop it
  }
}

function markCelebrated(uid: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(celebrationKey(uid), '1')
  } catch {
    /* storage blocked */
  }
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
  const [payouts, setPayouts] = useState<PayoutState>(BLANK_PAYOUTS)
  const [profileLoaded, setProfileLoaded] = useState(false)
  /** Server copy of the profile document (the listener above keeps the UI fields current). */
  const [profileDoc, setProfileDoc] = useState<Record<string, unknown> | null>(null)
  const [promptDismissed, setPromptDismissed] = useState(false)
  const [reward, setReward] = useState<OnboardingState['reward']>(null)
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
      setProfileDoc(null)
      setPayouts(BLANK_PAYOUTS)
      setPaidTrainings([])
      setApplications([])
      setPromptDismissed(false)
      setReward(null)
      setProfileLoaded(true)
      return
    }

    const applyDocument = (userDoc: Awaited<ReturnType<typeof mapUserDoc>>) => {
      if (!mounted.current) return
      if (userDoc) {
        setWorker(userDoc.worker)
        setWallet(userDoc.wallet)
        setProfileDoc(userDoc.raw)
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
      const fx = (data.fx ?? {}) as Record<string, unknown>
      setWallet({
        pendingUsd: Number(data.pendingUsd ?? 0) || 0,
        availableUsd: Number(data.availableUsd ?? 0) || 0,
        payoutNumber: String(data.payoutNumber ?? ''),
      })
      setWalletMeta({
        entries: Array.isArray(data.entries) ? (data.entries as WalletEntry[]) : [],
        nextClearingAt: (data.nextClearingAt as string | null) ?? null,
        clearingHours: Number(data.clearingHours ?? 72) || 72,
        minWithdrawalUsd: Number(data.minWithdrawalUsd ?? 50) || 50,
        availableKes: Number(fx.availableKes ?? 0) || 0,
        asOf: (data.asOf as string) ?? null,
      })
      const bonus = (data.welcomeBonus ?? {}) as Partial<WelcomeBonusState>
      setPayouts({
        heldUsd: Number(data.heldUsd ?? 0) || 0,
        minWithdrawalUsd: Number(data.minWithdrawalUsd ?? 50) || 50,
        withdrawableUsd: Number(data.withdrawableUsd ?? 0) || 0,
        withdrawableKes: Number(fx.withdrawableKes ?? 0) || 0,
        pendingKes: Number(fx.pendingKes ?? 0) || 0,
        usdToKes: Number(data.usdToKes ?? 0) || 0,
        destination:
          (data.destination as PayoutDestinationState | undefined) ??
          BLANK_PAYOUTS.destination,
        openPayout: (data.openPayout as PayoutRequestRow | null) ?? null,
        requests: Array.isArray(data.payoutRequests) ? (data.payoutRequests as PayoutRequestRow[]) : [],
        welcomeBonus: {
          amountUsd: Number(bonus.amountUsd ?? 5) || 5,
          granted: bonus.granted === true,
          grantedAt: (bonus.grantedAt as string | null) ?? null,
          pendingFromStaff: bonus.pendingFromStaff === true,
        },
        kycVerified: data.kycVerified === true,
        accountState: String(data.accountState ?? 'active'),
        loaded: true,
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

  // ── Profile save (server-validated; can release the welcome reward) ─────────────
  const saveProfile = useCallback(
    async (fields: Record<string, unknown>): Promise<ProfileSaveResult> => {
      if (!user || !configured) {
        // Demo mode keeps the UI honest: the fields stay on screen for the session and the member is
        // told nothing was stored, instead of pretending a write happened.
        setWorker((prev) => ({ ...prev, ...(fields as Partial<WorkerProfile>) }))
        return { ok: false, error: 'Preview — profile changes are not saved on this site.' }
      }
      setBusy('profile', true)
      try {
        const data = await authedFetch<{
          completion: ProfileCompletion
          saved?: string[]
          dropped?: string[]
          grantedBonus?: { amountUsd: number } | null
          bonusAlreadyGranted?: boolean
          releasedReferral?: { referrerName: string; bonusUsd: number } | null
        }>('/api/profile', { method: 'PATCH', body: { fields } })

        // The server is the authority on what was stored; reflect the accepted fields locally so the
        // page does not flicker back to the previous value while the Firestore listener catches up.
        setWorker((prev) => ({ ...prev, ...(fields as Partial<WorkerProfile>) }))
        setProfileDoc((prev) => ({ ...(prev ?? {}), ...fields }))
        if (typeof fields.phone === 'string' && fields.phone) setWallet((w) => ({ ...w, payoutNumber: fields.phone as string }))

        if (data.grantedBonus) {
          setReward({ open: true, amountUsd: data.grantedBonus.amountUsd, alreadyPaid: false })
          markCelebrated(user.uid)
        }

        void refreshWallet()
        return {
          ok: true,
          saved: data.saved ?? Object.keys(fields),
          dropped: data.dropped ?? [],
          completion: data.completion,
          grantedBonus: data.grantedBonus ?? null,
          bonusAlreadyGranted: data.bonusAlreadyGranted === true,
          releasedReferral: data.releasedReferral ?? null,
        }
      } catch (err) {
        const message = describeError(err)
        setError(message)
        return { ok: false, error: message }
      } finally {
        setBusy('profile', false)
      }
    },
    [user, configured, refreshWallet, setBusy],
  )

  const claimWelcomeBonus = useCallback(async () => {
    if (!user || !configured) return { ok: false, granted: false, error: 'Preview — nothing is saved on this site.' }
    setBusy('bonus', true)
    try {
      const data = await authedFetch<{
        granted?: boolean
        amountUsd?: number
        reason?: string
        completion?: ProfileCompletion
      }>('/api/wallet/welcome-bonus', { method: 'POST' })
      void refreshWallet()
      if (data.granted) {
        setReward({ open: true, amountUsd: Number(data.amountUsd ?? 5) || 5, alreadyPaid: false })
        if (user) markCelebrated(user.uid)
        return { ok: true, granted: true }
      }
      return { ok: true, granted: false, error: data.reason || 'The reward is not available yet.' }
    } catch (err) {
      return { ok: false, granted: false, error: describeError(err) }
    } finally {
      setBusy('bonus', false)
    }
  }, [user, configured, refreshWallet, setBusy])

  // ── Withdrawals ────────────────────────────────────────────────────────────────
  const requestPayout = useCallback(
    async (amountUsd: number) => {
      if (!user || !configured) return { ok: false, error: 'Preview — withdrawals are switched off on this site.' }
      setBusy('payout:new', true)
      try {
        await authedFetch('/api/payouts', { method: 'POST', body: { amountUsd } })
        await refreshWallet()
        return { ok: true }
      } catch (err) {
        const message = describeError(err)
        setError(message)
        return { ok: false, error: message }
      } finally {
        setBusy('payout:new', false)
      }
    },
    [user, configured, refreshWallet, setBusy],
  )

  const cancelPayout = useCallback(
    async (requestId: string) => {
      if (!user || !configured) return { ok: false, error: 'Preview — there is no request to cancel on this site.' }
      setBusy(`payout:${requestId}`, true)
      try {
        await authedFetch('/api/payouts', { method: 'PATCH', body: { requestId } })
        await refreshWallet()
        return { ok: true }
      } catch (err) {
        const message = describeError(err)
        setError(message)
        return { ok: false, error: message }
      } finally {
        setBusy(`payout:${requestId}`, false)
      }
    },
    [user, configured, refreshWallet, setBusy],
  )

  const refreshPayouts = useCallback(async () => {
    await refreshWallet()
  }, [refreshWallet])

  // ── Onboarding: profile prompt + reward celebration ─────────────────────────────
  const completion = useMemo<ProfileCompletion>(() => profileCompletion(profileDoc), [profileDoc])

  // The prompt appears once the session is settled and a profile is genuinely owed. It stays away
  // when: the member is in demo mode, the inbox is unproven (the app gate owns that conversation),
  // the profile is complete, or the member already dismissed it *this session*.
  const promptOpen =
    Boolean(configured && user) &&
    profileLoaded &&
    !completion.complete &&
    !payouts.welcomeBonus.granted &&
    !promptDismissed

  const dismissPrompt = useCallback(() => setPromptDismissed(true), [])
  const requestPrompt = useCallback(() => setPromptDismissed(false), [])
  const dismissReward = useCallback(() => setReward(null), [])

  // A reward paid from another device (or by an operator) is celebrated the first time this browser
  // sees it — the marker is cosmetic and per-uid, so a shared device does not re-celebrate for the
  // next person who signs in.
  useEffect(() => {
    if (!configured || !user || !profileLoaded) return
    if (!payouts.welcomeBonus.granted) return
    if (hasCelebrated(user.uid)) return
    setReward({ open: true, amountUsd: payouts.welcomeBonus.amountUsd, alreadyPaid: true })
    markCelebrated(user.uid)
  }, [configured, user, profileLoaded, payouts.welcomeBonus.granted, payouts.welcomeBonus.amountUsd])

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
      submitWork,
      withdrawApplication,
      refreshWallet,
      refreshApplications,
      payouts,
      onboarding: {
        completion,
        promptOpen,
        reward,
        dismissPrompt,
        requestPrompt,
        dismissReward,
      },
      saveProfile,
      claimWelcomeBonus,
      requestPayout,
      cancelPayout,
      refreshPayouts,
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
    submitWork,
    withdrawApplication,
    refreshWallet,
    refreshApplications,
    payouts,
    completion,
    promptOpen,
    reward,
    dismissPrompt,
    requestPrompt,
    dismissReward,
    saveProfile,
    claimWelcomeBonus,
    requestPayout,
    cancelPayout,
    refreshPayouts,
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
    phoneCountry: doc.phoneCountry || guessCountryFromE164(doc.phone || doc.wallet?.payoutNumber || ''),
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
    raw: doc as unknown as Record<string, unknown>,
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
