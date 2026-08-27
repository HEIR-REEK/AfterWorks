'use client'

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import {
  seedJobs,
  seedWorker,
  type Application,
  type ApplicationStatus,
  type Job,
  type Wallet,
  type WorkerProfile,
} from '@/lib/afterworks-data'
import { subscribeToUserDocument, getUserDocument } from '@/lib/firestore'
import { loadDemoJobsOverride, DEMO_DATA_EVENT } from '@/lib/admin-data'

import { useAuth } from '@/components/firebase-auth-provider'

type ApplyResult =
  | { ok: true; applicationId: string }
  | { ok: false; reason: string }

type AfterWorksContextValue = {
  worker: WorkerProfile
  wallet: Wallet
  jobs: Job[]
  applications: Application[]
  paidTrainings: string[]
  profileLoaded: boolean
  getJob: (id: string) => Job | undefined
  getApplicationForJob: (jobId: string) => Application | undefined
  isJobPaid: (jobId: string) => boolean
  markJobAsPaid: (jobId: string) => Promise<void>
  applyToJob: (jobId: string) => ApplyResult
  submitWork: (applicationId: string) => void
  // Refresh wallet data from Firestore
  refreshWallet: () => Promise<void>
  // Re-fetch jobs (e.g. after the admin panel edits them)
  reloadJobs: () => Promise<void>
  // Re-read applications from localStorage (after admin actions in demo mode)
  reloadApplications: () => void
  // Update worker profile details (persisted to Firestore + local state)
  updateProfile: (updatedFields: Partial<WorkerProfile>) => Promise<void>
}

const AfterWorksContext = createContext<AfterWorksContextValue | null>(null)

/** Default blank worker — used as loading placeholder until real data arrives. */
/** Default blank worker — used as loading placeholder until real data arrives. */
const BLANK_WORKER: WorkerProfile = {
  name: 'Amara Okoro',
  email: 'amara.okoro@afterworks.io',
  location: '',
  accountState: 'active',
  kycVerified: false,
  qualityScore: 100,
  jobsCompleted: 0,
  memberSince: '',
  phone: '',
  bio: '',
  skills: [],
  languages: [],
  preferredPayoutMethod: '',
}

const BLANK_WALLET: Wallet = {
  pendingUsd: 0,
  availableUsd: 0,
  payoutNumber: '',
}

export function AfterWorksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [worker, setWorker] = useState<WorkerProfile>(() => seedWorker())
  const [wallet, setWallet] = useState<Wallet>(BLANK_WALLET)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [jobs, setJobs] = useState<Job[]>(() => {
    // Demo job overrides (saved by the admin panel) win over the seed data.
    const override = typeof window !== 'undefined' ? loadDemoJobsOverride() : null
    if (override?.jobs?.length) return override.jobs
    return seedJobs()
  })
  const [paidTrainings, setPaidTrainings] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('afterworks_paid_trainings_v1')
      if (saved) {
        try {
          return JSON.parse(saved)
        } catch {
          // ignore
        }
      }
    }
    return []
  })
  const [applications, setApplications] = useState<Application[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('afterworks_applications_v2')
      if (saved) {
        try {
          return JSON.parse(saved)
        } catch {
          // fallback to empty
        }
      }
    }
    return []
  })

  // ── Persist applications to localStorage ───────────────────────────────────
  useEffect(() => {
    localStorage.setItem('afterworks_applications_v2', JSON.stringify(applications))
  }, [applications])

  // ── Persist paidTrainings to localStorage ──────────────────────────────────
  useEffect(() => {
    localStorage.setItem('afterworks_paid_trainings_v1', JSON.stringify(paidTrainings))
  }, [paidTrainings])

  // ── Load jobs: Firestore (via /api/jobs) with demo/local overrides ────────
  useEffect(() => {
    let cancelled = false

    async function loadJobs() {
      try {
        const res = await fetch('/api/jobs', { cache: 'no-store' })
        if (res.ok) {
          const data = (await res.json()) as { source: string; jobs: Job[] }
          if (cancelled) return
          if (data.source === 'firestore' && Array.isArray(data.jobs) && data.jobs.length > 0) {
            // Firestore is the source of truth — clear any stale local override.
            setJobs(data.jobs)
            return
          }
        }
      } catch {
        // network error — fall through to demo overrides / seed data
      }
      if (cancelled) return
      const override = loadDemoJobsOverride()
      if (override?.jobs?.length) setJobs(override.jobs)
    }

    void loadJobs()
    return () => {
      cancelled = true
    }
  }, [])

  // ── React to admin-panel changes (demo mode) ───────────────────────────────
  useEffect(() => {
    function handleDemoChange() {
      const override = loadDemoJobsOverride()
      if (override?.jobs?.length) setJobs(override.jobs)
    }
    // The admin panel can also advance this browser's applications (approve,
    // QA, etc.) — re-read them so the worker tracker stays in sync.
    function handleApplicationsChanged() {
      try {
        const saved = localStorage.getItem('afterworks_applications_v2')
        if (saved) setApplications(JSON.parse(saved))
      } catch {
        // ignore malformed cache
      }
    }
    window.addEventListener(DEMO_DATA_EVENT, handleDemoChange)
    window.addEventListener('aw-applications-changed', handleApplicationsChanged)
    window.addEventListener('storage', handleDemoChange)
    return () => {
      window.removeEventListener(DEMO_DATA_EVENT, handleDemoChange)
      window.removeEventListener('aw-applications-changed', handleApplicationsChanged)
      window.removeEventListener('storage', handleDemoChange)
    }
  }, [])

  // ── Load real user profile + wallet + paidTrainings from Firestore ───────
  useEffect(() => {
    async function loadUserData() {
      // Demo-mode users get the seeded profile — no Firestore involved.
      if (user && user.uid.startsWith('demo-')) {
        const seed = seedWorker()
        setWorker({
          ...seed,
          name: user.displayName || seed.name,
          email: user.email || seed.email,
        })
        setProfileLoaded(true)
        return
      }

      if (!user) {
        // Look for local demo override
        const localSaved = typeof window !== 'undefined' ? localStorage.getItem('afterworks_profile_demo') : null
        if (localSaved) {
          try {
            setWorker({ ...seedWorker(), ...JSON.parse(localSaved) })
          } catch {
            setWorker(seedWorker())
          }
        } else {
          setWorker(seedWorker())
        }
        setWallet({
          pendingUsd: 0,
          availableUsd: 0,
          payoutNumber: '',
        })
        setProfileLoaded(true)
        return
      }

      try {
        const unsubscribe = subscribeToUserDocument(user.uid, (userDoc) => {
          // Local storage cached edits fallback
          const localSaved = typeof window !== 'undefined' ? localStorage.getItem(`afterworks_profile_${user.uid}`) : null
          const localData = localSaved ? JSON.parse(localSaved) : {}

          if (userDoc) {
            setWorker({
              name: userDoc.name || user.displayName || user.email?.split('@')[0] || 'Worker',
              email: user.email || userDoc.email || '',
              location: userDoc.location || localData.location || '',
              // Security-critical fields — ALWAYS from Firestore, never from localStorage
              accountState: userDoc.accountState || 'active',
              kycVerified: userDoc.kycVerified ?? false,
              kycVerifiedAt: userDoc.kycVerifiedAt,
              kycRejectedAt: userDoc.kycRejectedAt,
              kycOnHoldAt: userDoc.kycOnHoldAt,
              kycProvider: userDoc.kycProvider,
              kycLevel: userDoc.kycLevel,
              kycStatus: userDoc.kycStatus,
              kycRejectionReason: userDoc.kycRejectionReason ?? null,
              kycFailedChecks: userDoc.kycFailedChecks ?? null,
              qualityScore: userDoc.qualityScore ?? 100,
              jobsCompleted: userDoc.jobsCompleted ?? 0,
              memberSince: userDoc.memberSince || '',
              phone: userDoc.phone || userDoc.wallet?.payoutNumber || localData.phone || '',
              bio: userDoc.bio || localData.bio || '',
              skills: userDoc.skills || localData.skills || [],
              languages: userDoc.languages || localData.languages || [],
              preferredPayoutMethod: userDoc.preferredPayoutMethod || localData.preferredPayoutMethod || '',
            })
            setWallet({
              pendingUsd: userDoc.wallet?.pendingUsd ?? 0,
              availableUsd: userDoc.wallet?.availableUsd ?? 0,
              payoutNumber: userDoc.wallet?.payoutNumber ?? userDoc.phone ?? localData.phone ?? '',
            })
            if (userDoc.paidTrainings && Array.isArray(userDoc.paidTrainings)) {
              setPaidTrainings((prev) => Array.from(new Set([...prev, ...userDoc.paidTrainings!])))
            }
          } else {
            // No Firestore document yet — use Firebase Auth details + defaults
            setWorker({
              name: user.displayName || user.email?.split('@')[0] || 'Worker',
              email: user.email || '',
              location: '',
              accountState: 'active',
              kycVerified: false,
              qualityScore: 100,
              jobsCompleted: 0,
              memberSince: '',
              phone: localData.phone || '',
              bio: localData.bio || '',
              skills: localData.skills || [],
              languages: localData.languages || [],
              preferredPayoutMethod: localData.preferredPayoutMethod || '',
            })
            setWallet({
              pendingUsd: 0,
              availableUsd: 0,
              payoutNumber: '',
            })
          }
          setProfileLoaded(true)
        })

        return () => unsubscribe()
      } catch (err) {
        console.error('Failed to load user profile:', err)
        setProfileLoaded(true)
      }
    }

    loadUserData()
  }, [user])

  const value = useMemo<AfterWorksContextValue>(() => {
    const now = () => new Date().toISOString()
    const in48h = () => {
      const d = new Date()
      d.setHours(d.getHours() + 48)
      return d.toISOString()
    }

    const push = (app: Application, status: ApplicationStatus): Application => ({
      ...app,
      status,
      history: [...app.history, { status, at: now() }],
    })

    function getJob(id: string) {
      return jobs.find((j) => j.id === id)
    }

    function getApplicationForJob(jobId: string) {
      return applications.find((a) => a.jobId === jobId)
    }

    function isJobPaid(jobId: string): boolean {
      if (paidTrainings.includes(jobId)) return true
      if (typeof window !== 'undefined') {
        if (localStorage.getItem(`aw_training_paid_${jobId}`) === 'true') return true
      }
      return false
    }

    async function markJobAsPaid(jobId: string): Promise<void> {
      setPaidTrainings((prev) => Array.from(new Set([...prev, jobId])))
      if (typeof window !== 'undefined') {
        localStorage.setItem(`aw_training_paid_${jobId}`, 'true')
      }
      if (user?.uid) {
        try {
          const { recordPaidTrainingInFirestore } = await import('@/lib/firestore')
          await recordPaidTrainingInFirestore(user.uid, jobId)
        } catch (err) {
          console.error('Failed to save paid training to Firestore:', err)
        }
      }
    }

    function applyToJob(jobId: string): ApplyResult {
      if (!worker.kycVerified) {
        return {
          ok: false,
          reason: 'Identity verification (KYC) is required before applying for jobs. Please complete verification in your profile.',
        }
      }
      const job = jobs.find((j) => j.id === jobId)
      if (!job) return { ok: false, reason: 'Job not found.' }
      if (job.status !== 'open')
        return { ok: false, reason: 'This job is no longer open.' }
      if (job.slotsRemaining <= 0)
        return { ok: false, reason: 'All slots for this job are full.' }
      if (applications.some((a) => a.jobId === jobId))
        return { ok: false, reason: 'You have already applied to this job.' }

      const id = `app-${Date.now()}`
      const newApp: Application = {
        id,
        jobId,
        // Capacity is NOT decremented here — only on approval (spec 4.3).
        status: 'under_review',
        appliedAt: now(),
        reviewExpiresAt: in48h(),
        history: [{ status: 'under_review', at: now() }],
      }
      setApplications((prev) => [newApp, ...prev])

      // Best-effort mirror to Firestore so the admin panel can see and manage
      // real applications (silently skipped in demo mode).
      if (user?.uid && !user.uid.startsWith('demo-')) {
        import('@/lib/firestore')
          .then(({ mirrorApplicationToFirestore }) =>
            mirrorApplicationToFirestore(user.uid, id, newApp),
          )
          .catch(() => {})
      }

      return { ok: true, applicationId: id }
    }

    function submitWork(applicationId: string) {
      setApplications((prev) =>
        prev.map((a) =>
          a.id === applicationId &&
          (a.status === 'in_progress' || a.status === 'revision_requested')
            ? push(a, 'submitted_for_review')
            : a,
        ),
      )
    }

    // Re-fetch jobs — used by the admin panel after editing jobs.
    async function reloadJobs() {
      try {
        const res = await fetch('/api/jobs', { cache: 'no-store' })
        if (res.ok) {
          const data = (await res.json()) as { source: string; jobs: Job[] }
          if (data.source === 'firestore' && Array.isArray(data.jobs) && data.jobs.length > 0) {
            setJobs(data.jobs)
            return
          }
        }
      } catch {
        // ignore — keep current jobs
      }
      const override = loadDemoJobsOverride()
      if (override?.jobs?.length) setJobs(override.jobs)
    }

    // Re-read applications from localStorage — used after admin actions in
    // demo mode modify the shared store behind our back.
    function reloadApplications() {
      if (typeof window === 'undefined') return
      try {
        const saved = localStorage.getItem('afterworks_applications_v2')
        if (saved) setApplications(JSON.parse(saved))
      } catch {
        // ignore malformed cache
      }
    }

    // Refresh wallet from Firestore
    async function refreshWallet() {
      try {
        const { getAuth } = await import('firebase/auth')
        const auth = getAuth()
        if (!auth.currentUser) return

        const userDoc = await getUserDocument(auth.currentUser.uid)
        if (userDoc?.wallet) {
          setWallet({
            pendingUsd: userDoc.wallet.pendingUsd ?? 0,
            availableUsd: userDoc.wallet.availableUsd ?? 0,
            payoutNumber: userDoc.wallet.payoutNumber ?? '',
          })
        }
      } catch (error) {
        console.error('Failed to refresh wallet:', error)
      }
    }

    // Update profile in local state, localStorage, and Firestore
    async function updateProfile(fields: Partial<WorkerProfile>) {
      setWorker((prev) => {
        const updated = { ...prev, ...fields }
        if (typeof window !== 'undefined') {
          const key = user?.uid ? `afterworks_profile_${user.uid}` : 'afterworks_profile_demo'
          // Strip security-critical fields before caching to localStorage
          const { kycVerified, accountState, qualityScore, jobsCompleted, ...safeToCache } = updated
          localStorage.setItem(key, JSON.stringify(safeToCache))
        }
        return updated
      })

      if (fields.phone) {
        setWallet((w) => ({ ...w, payoutNumber: fields.phone ?? w.payoutNumber }))
      }

      if (user?.uid) {
        try {
          const { updateUserProfile, updateUserWallet } = await import('@/lib/firestore')
          await updateUserProfile(user.uid, fields)
          if (fields.phone) {
            await updateUserWallet(user.uid, { payoutNumber: fields.phone })
          }
        } catch (err) {
          console.error('Failed to sync profile updates to Firestore:', err)
        }
      }
    }

    return {
      worker,
      wallet,
      jobs,
      applications,
      paidTrainings,
      profileLoaded,
      getJob,
      getApplicationForJob,
      isJobPaid,
      markJobAsPaid,
      applyToJob,
      submitWork,
      refreshWallet,
      reloadJobs,
      reloadApplications,
      updateProfile,
    }
  }, [worker, wallet, jobs, applications, paidTrainings, profileLoaded, user, setWallet])

  return (
    <AfterWorksContext.Provider value={value}>
      {children}
    </AfterWorksContext.Provider>
  )
}

export function useAfterWorks() {
  const ctx = useContext(AfterWorksContext)
  if (!ctx)
    throw new Error('useAfterWorks must be used within an AfterWorksProvider')
  return ctx
}
