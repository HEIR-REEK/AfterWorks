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
  type Application,
  type ApplicationStatus,
  type Job,
  type Wallet,
  type WorkerProfile,
} from '@/lib/afterworks-data'
import {
  subscribeToUserDocument,
  getUserDocument,
  updateUserProfile as fsUpdateUserProfile,
  updateUserWallet,
  recordPaidTrainingInFirestore,
  createApplicationDocument,
  subscribeToUserApplications,
  submitApplicationForReview,
} from '@/lib/firestore'

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
  applyToJob: (jobId: string) => Promise<ApplyResult>
  submitWork: (applicationId: string) => void
  // Refresh wallet data from Firestore
  refreshWallet: () => Promise<void>
  // Update worker profile details (persisted to Firestore + local state)
  updateProfile: (updatedFields: Partial<WorkerProfile>) => Promise<void>
}

const AfterWorksContext = createContext<AfterWorksContextValue | null>(null)

/** Blank worker — placeholder until the Firestore profile document arrives. */
const BLANK_WORKER: WorkerProfile = {
  name: '',
  email: '',
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
  const [worker, setWorker] = useState<WorkerProfile>(BLANK_WORKER)
  const [wallet, setWallet] = useState<Wallet>(BLANK_WALLET)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [paidTrainings, setPaidTrainings] = useState<string[]>([])
  const [applications, setApplications] = useState<Application[]>([])

  // ── Load job listings from the server (Firestore `jobs` collection) ───────
  useEffect(() => {
    let cancelled = false

    async function loadJobs() {
      try {
        const res = await fetch('/api/jobs', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { source: string; jobs: Job[] }
        if (cancelled) return
        if (Array.isArray(data.jobs)) setJobs(data.jobs)
      } catch {
        // Network error — keep current listings; retried on next page load.
      }
    }

    void loadJobs()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Load the signed-in worker's profile, wallet and applications ──────────
  useEffect(() => {
    if (!user) {
      setWorker(BLANK_WORKER)
      setWallet(BLANK_WALLET)
      setApplications([])
      setProfileLoaded(true)
      return
    }

    // Firestore is the source of truth for all worker data.
    const unsubscribeProfile = subscribeToUserDocument(user.uid, (userDoc) => {
      if (userDoc) {
        setWorker({
          name: userDoc.name || user.displayName || user.email?.split('@')[0] || 'Worker',
          email: user.email || userDoc.email || '',
          location: userDoc.location || '',
          accountState: userDoc.accountState,
          kycVerified: userDoc.kycVerified,
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
          phone: userDoc.phone || userDoc.wallet?.payoutNumber || '',
          bio: userDoc.bio || '',
          skills: userDoc.skills || [],
          languages: userDoc.languages || [],
          preferredPayoutMethod: userDoc.preferredPayoutMethod || '',
        })
        setWallet({
          pendingUsd: userDoc.wallet?.pendingUsd ?? 0,
          availableUsd: userDoc.wallet?.availableUsd ?? 0,
          payoutNumber: userDoc.wallet?.payoutNumber ?? userDoc.phone ?? '',
        })
        if (userDoc.paidTrainings && Array.isArray(userDoc.paidTrainings)) {
          setPaidTrainings(userDoc.paidTrainings)
        }
      } else {
        // No Firestore document yet — use Firebase Auth details + defaults.
        setWorker({
          ...BLANK_WORKER,
          name: user.displayName || user.email?.split('@')[0] || 'Worker',
          email: user.email || '',
        })
        setWallet(BLANK_WALLET)
      }
      setProfileLoaded(true)
    })

    const unsubscribeApplications = subscribeToUserApplications(
      user.uid,
      (apps) => setApplications(apps),
    )

    return () => {
      unsubscribeProfile()
      unsubscribeApplications()
    }
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
      return paidTrainings.includes(jobId)
    }

    async function markJobAsPaid(jobId: string): Promise<void> {
      setPaidTrainings((prev) => Array.from(new Set([...prev, jobId])))
      if (user?.uid) {
        try {
          await recordPaidTrainingInFirestore(user.uid, jobId)
        } catch (err) {
          console.error('Failed to save paid training to Firestore:', err)
        }
      }
    }

    async function applyToJob(jobId: string): Promise<ApplyResult> {
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
      if (!user?.uid) return { ok: false, reason: 'You need to sign in first.' }

      const appliedAt = now()
      const application: Application = {
        id: `local-${Date.now()}`,
        jobId,
        // Capacity is NOT decremented here — only on approval (spec 4.3).
        status: 'under_review',
        appliedAt,
        reviewExpiresAt: in48h(),
        history: [{ status: 'under_review', at: appliedAt }],
      }

      // Persist to Firestore — the live snapshot confirms/reconciles.
      const id = await createApplicationDocument(user.uid, application)
      if (!id) {
        return { ok: false, reason: 'Could not submit your application. Check your connection and try again.' }
      }

      const persisted = { ...application, id }
      // Optimistic add; de-duped against the Firestore snapshot by id.
      setApplications((prev) =>
        prev.some((a) => a.id === id) ? prev : [persisted, ...prev],
      )
      return { ok: true, applicationId: id }
    }

    function submitWork(applicationId: string) {
      // Optimistic local transition; Firestore snapshot reconciles.
      setApplications((prev) =>
        prev.map((a) =>
          a.id === applicationId &&
          (a.status === 'in_progress' || a.status === 'revision_requested')
            ? push(a, 'submitted_for_review')
            : a,
        ),
      )
      void submitApplicationForReview(applicationId)
    }

    // Refresh wallet from Firestore
    async function refreshWallet() {
      try {
        if (!user?.uid) return
        const userDoc = await getUserDocument(user.uid)
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

    // Update profile in local state + Firestore
    async function updateProfile(fields: Partial<WorkerProfile>) {
      setWorker((prev) => ({ ...prev, ...fields }))

      if (fields.phone) {
        setWallet((w) => ({ ...w, payoutNumber: fields.phone ?? w.payoutNumber }))
      }

      if (user?.uid) {
        try {
          await fsUpdateUserProfile(user.uid, fields)
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
      updateProfile,
    }
  }, [worker, wallet, jobs, applications, paidTrainings, profileLoaded, user])

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
