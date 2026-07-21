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
  seedApplications,
  seedJobs,
  type Application,
  type ApplicationStatus,
  type Job,
  type Wallet,
  type WorkerProfile,
} from '@/lib/afterworks-data'
import { getUserDocument } from '@/lib/firestore'

import { useAuth } from '@/components/firebase-auth-provider'

type ApplyResult =
  | { ok: true; applicationId: string }
  | { ok: false; reason: string }

type AfterWorksContextValue = {
  worker: WorkerProfile
  wallet: Wallet
  jobs: Job[]
  applications: Application[]
  profileLoaded: boolean
  getJob: (id: string) => Job | undefined
  getApplicationForJob: (jobId: string) => Application | undefined
  applyToJob: (jobId: string) => ApplyResult
  submitWork: (applicationId: string) => void
  // Prototype-only simulator to walk an application through the QA lifecycle.
  advanceApplication: (applicationId: string) => void
  // Refresh wallet data from Firestore
  refreshWallet: () => Promise<void>
  // Update worker profile details (persisted to Firestore + local state)
  updateProfile: (updatedFields: Partial<WorkerProfile>) => Promise<void>
}

const AfterWorksContext = createContext<AfterWorksContextValue | null>(null)

/** Default blank worker — used as loading placeholder until real data arrives. */
/** Default blank worker — used as loading placeholder until real data arrives. */
const BLANK_WORKER: WorkerProfile = {
  name: 'Amara Okoro',
  email: 'amara.okoro@afterworks.io',
  location: 'Nairobi, Kenya',
  accountState: 'active',
  kycVerified: true,
  qualityScore: 98,
  jobsCompleted: 14,
  memberSince: 'Mar 2025',
  phone: '+254 712 345 678',
  bio: 'Experienced data annotator, Swahili/English translator & audio transcription specialist with 2+ years in digital micro-tasking.',
  skills: ['Swahili Transcription', 'Data Entry', 'Image Bounding Box', 'Medical Glossary', 'Content Moderation'],
  languages: ['English (Native/Fluent)', 'Swahili (Native)', 'Kikuyu (Fluent)'],
  preferredPayoutMethod: 'M-Pesa',
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
  const [jobs] = useState<Job[]>(() => seedJobs())
  const [applications, setApplications] = useState<Application[]>(() => seedApplications())

  // ── Load real user profile + wallet from Firestore when user changes ───────
  useEffect(() => {
    async function loadUserData() {
      if (!user) {
        // Look for local demo override
        const localSaved = typeof window !== 'undefined' ? localStorage.getItem('afterworks_profile_demo') : null
        if (localSaved) {
          try {
            setWorker({ ...BLANK_WORKER, ...JSON.parse(localSaved) })
          } catch {
            setWorker(BLANK_WORKER)
          }
        } else {
          setWorker(BLANK_WORKER)
        }
        setWallet({
          pendingUsd: 22,
          availableUsd: 46,
          payoutNumber: '+254 712 345 678',
        })
        setProfileLoaded(true)
        return
      }

      try {
        const userDoc = await getUserDocument(user.uid)

        // Local storage cached edits fallback
        const localSaved = typeof window !== 'undefined' ? localStorage.getItem(`afterworks_profile_${user.uid}`) : null
        const localData = localSaved ? JSON.parse(localSaved) : {}

        if (userDoc) {
          setWorker({
            name: userDoc.name || user.displayName || user.email?.split('@')[0] || 'Worker',
            email: user.email || userDoc.email || '',
            location: userDoc.location || 'Nairobi, Kenya',
            accountState: 'active',
            kycVerified: userDoc.kycVerified ?? false,
            qualityScore: userDoc.qualityScore ?? 100,
            jobsCompleted: userDoc.jobsCompleted ?? 0,
            memberSince: userDoc.memberSince || 'Jul 2026',
            phone: userDoc.phone || userDoc.wallet?.payoutNumber || localData.phone || '+254 700 000 000',
            bio: userDoc.bio || localData.bio || 'Digital task professional specializing in transcription, translation, and data validation.',
            skills: userDoc.skills || localData.skills || ['Data Entry', 'Transcription', 'Swahili Translation'],
            languages: userDoc.languages || localData.languages || ['English', 'Swahili'],
            preferredPayoutMethod: userDoc.preferredPayoutMethod || localData.preferredPayoutMethod || 'M-Pesa',
            ...localData,
          })
          setWallet({
            pendingUsd: userDoc.wallet?.pendingUsd ?? 0,
            availableUsd: userDoc.wallet?.availableUsd ?? 0,
            payoutNumber: userDoc.wallet?.payoutNumber ?? userDoc.phone ?? localData.phone ?? '',
          })
        } else {
          // No Firestore document yet — use Firebase Auth details + defaults
          setWorker({
            name: user.displayName || user.email?.split('@')[0] || 'Worker',
            email: user.email || '',
            location: 'Nairobi, Kenya',
            accountState: 'active',
            kycVerified: false,
            qualityScore: 100,
            jobsCompleted: 0,
            memberSince: new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' }),
            phone: localData.phone || '',
            bio: localData.bio || 'Verified worker account.',
            skills: localData.skills || ['Data Entry', 'Transcription'],
            languages: localData.languages || ['English', 'Swahili'],
            preferredPayoutMethod: localData.preferredPayoutMethod || 'M-Pesa',
            ...localData,
          })
        }
      } catch (error) {
        console.error('Failed to load user data from Firestore:', error)
      } finally {
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

    function applyToJob(jobId: string): ApplyResult {
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

    // Prototype simulator: advance an application to its next lifecycle state.
    function advanceApplication(applicationId: string) {
      setApplications((prev) =>
        prev.map((a) => {
          if (a.id !== applicationId) return a
          switch (a.status) {
            case 'under_review': {
              return push(a, 'approved')
            }
            case 'approved':
              return push(a, 'in_progress')
            case 'submitted_for_review': {
              // QA approves -> payment queued to pending balance (spec 6.1).
              const job = jobs.find((j) => j.id === a.jobId)
              if (job) setWallet((w) => ({ ...w, pendingUsd: w.pendingUsd + job.payAmountUsd }))
              return push(a, 'completed')
            }
            default:
              return a
          }
        }),
      )
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
          localStorage.setItem(key, JSON.stringify(updated))
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
      profileLoaded,
      getJob,
      getApplicationForJob,
      applyToJob,
      submitWork,
      advanceApplication,
      refreshWallet,
      updateProfile,
    }
  }, [worker, wallet, jobs, applications, profileLoaded, setWallet])

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
