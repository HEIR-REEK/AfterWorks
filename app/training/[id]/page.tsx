'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { usePaystackPayment } from 'react-paystack'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  GraduationCap,
  Lock,
  Loader2,
  XCircle,
} from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import emailjs from '@emailjs/browser'
import { useAuth } from '@/components/firebase-auth-provider'
import { Button } from '@/components/ui/button'
import { AssessmentQuiz } from '@/components/assessment-quiz'
import { TrainingModules } from '@/components/training-modules'
import { formatUsd, getTrainingFeeUsd, getTrainingFeeCents } from '@/lib/afterworks-data'

// localStorage key — persists across page navigations so the popup redirect
// can carry the reference back to this page.
const LS_REF_KEY = 'aw_training_paystack_ref'

type PayState =
  | 'idle'
  | 'initializing'
  | 'awaiting_payment'
  | 'verifying'
  | 'paid'
  | 'error'

function TrainingPageInner({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params
  const router = useRouter()
  const searchParams = useSearchParams()
  const { getJob, worker, applyToJob, refreshWallet, getApplicationForJob, isJobPaid, markJobAsPaid } = useAfterWorks()
  const { user } = useAuth()

  const TRAINING_FEE = getTrainingFeeUsd()

  const userEmail = (worker?.email && worker.email.trim().length > 0)
    ? worker.email
    : (user?.email || '')

  const paystackConfig = {
    reference: `aw_training_${new Date().getTime()}`,
    email: userEmail,
    amount: getTrainingFeeCents(),
    publicKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
    currency: 'KES',
    metadata: {
      userId: user?.uid || '',
      jobId: id,
      custom_fields: [
        {
          display_name: 'Job ID',
          variable_name: 'jobId',
          value: id
        },
        {
          display_name: 'User ID',
          variable_name: 'userId',
          value: user?.uid || ''
        },
        {
          display_name: 'Purpose',
          variable_name: 'purpose',
          value: 'training_access'
        }
      ]
    }
  }

  const initializePayment = usePaystackPayment(paystackConfig as any)

  const [payState, setPayState] = useState<PayState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const job = getJob(id)
  const paidStorageKey = `aw_training_paid_${id}`

  // ── Verify a reference and unlock training ──────────────────────────────
  const verifyReference = useCallback(async (ref: string) => {
    setPayState('verifying')
    try {
      const res = await fetch(`/api/paystack/verify/${encodeURIComponent(ref)}`)
      const data = await res.json()
      if (data.paid) {
        localStorage.removeItem(LS_REF_KEY)
        await markJobAsPaid(id)
        setPayState('paid')
        // Refresh wallet after successful payment
        await refreshWallet()
      } else if (data.status === 'abandoned' || data.status === 'failed') {
        localStorage.removeItem(LS_REF_KEY)
        setPayState('error')
        setErrorMsg('Payment was not completed. Please try again.')
      } else {
        // Still pending — keep polling
        setPayState('awaiting_payment')
      }
    } catch {
      setPayState('error')
      setErrorMsg('Could not verify payment. Please refresh the page.')
    }
  }, [id, markJobAsPaid, refreshWallet])

  // ── On mount: check if paid previously or returning from Paystack ────────
  useEffect(() => {
    // Check if training has already been unlocked & paid via context or localStorage
    if (isJobPaid(id)) {
      setPayState('paid')
      return
    }

    const urlRef = searchParams.get('reference') ?? searchParams.get('trxref')

    if (urlRef) {
      // Clean the URL so it looks tidy
      const clean = new URL(window.location.href)
      clean.searchParams.delete('reference')
      clean.searchParams.delete('trxref')
      window.history.replaceState({}, '', clean.toString())
      
      // Verify returning reference from Paystack
      verifyReference(urlRef)
    }
  }, [id, searchParams, isJobPaid, verifyReference])

  // ── Poll for payment while awaiting ─────────────────────────────────────
  useEffect(() => {
    if (payState === 'awaiting_payment') {
      const ref = localStorage.getItem(LS_REF_KEY)
      if (!ref) return

      pollingRef.current = setInterval(() => verifyReference(ref), 4000)
      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current)
      }
    }
    // Clean up any previous poll when state changes away
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [payState, verifyReference])

  // ── Initiate payment ─────────────────────────────────────────────────────
  async function handlePay() {
    setErrorMsg(null)

    if (!userEmail) {
      setPayState('error')
      setErrorMsg('Please sign in to complete your payment.')
      return
    }

    setPayState('awaiting_payment')

    initializePayment({
      onSuccess: (reference: any) => {
        const refStr = reference.reference || reference.trxref || reference
        if (typeof refStr === 'string') {
          localStorage.setItem(LS_REF_KEY, refStr)
        }
        verifyReference(refStr)
      },
      onClose: () => {
        setPayState('idle')
      }
    })
  }

  // ── Apply after training ─────────────────────────────────────────────────
  async function handleApplyAfterTraining() {
    if (isApplying) return
    setIsApplying(true)
    const result = applyToJob(job!.id)
    if (!result.ok) {
      setApplyError(result.reason)
      setIsApplying(false)
      return
    }

    try {
      await emailjs.send(
        'service_8qxbsyi',
        'template_8g1egki',
        {
          to_name: worker.name || 'Applicant',
          to_email: worker.email,
          job_title: job!.title,
          message: 'Your application is under review. You will be contacted shortly for an online interview.',
        },
        'Juc_jABykXhGr_WPK'
      )
    } catch (err) {
      console.error('Failed to send application email:', err)
    }

    setIsApplying(false)
    router.push('/applications')
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-sm text-muted-foreground">This job could not be found.</p>
        <Button render={<Link href="/jobs" />} variant="outline">
          Back to jobs
        </Button>
      </div>
    )
  }

  const application = getApplicationForJob(job.id)
  if (application) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center mx-auto max-w-md">
        <div className="rounded-full bg-success/10 p-5 mb-2">
          <CheckCircle2 className="size-10 text-success" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">You&apos;ve already applied</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You have already completed the training &amp; assessment and applied for this job card. Your application is currently under review.
        </p>
        <Button render={<Link href="/applications" />} size="lg" className="mt-6 w-full sm:w-auto px-8">
          View Applications
        </Button>
      </div>
    )
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  const isLoading =
    payState === 'initializing' ||
    payState === 'verifying' ||
    payState === 'awaiting_payment'

  const isPaid = !job.trainingRequired || payState === 'paid' || isJobPaid(job.id)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        href={`/jobs/${job.id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to job
      </Link>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <GraduationCap className="size-5" />
        </div>
        
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {job.trainingRequired ? `${job.category} Training & Assessment` : `${job.category} Assessment`}
        </h1>
        
        {/* Step Progression Bar */}
        <div className="mt-6 grid grid-cols-4 gap-2 rounded-xl bg-muted/40 p-3 text-xs font-medium border border-border">
          <div className={`flex flex-col items-center gap-1 text-center p-2 rounded-lg ${
            isPaid ? 'bg-success/15 text-success font-semibold' : 'bg-primary/10 text-primary font-bold ring-1 ring-primary/30'
          }`}>
            <span className="flex size-5 items-center justify-center rounded-full bg-background text-[10px] shadow-xs">1</span>
            <span>1. Paystack Payment</span>
          </div>

          <div className={`flex flex-col items-center gap-1 text-center p-2 rounded-lg ${
            isPaid ? 'bg-accent/80 text-foreground font-semibold' : 'text-muted-foreground opacity-60'
          }`}>
            <span className="flex size-5 items-center justify-center rounded-full bg-background text-[10px] shadow-xs">2</span>
            <span>2. Get Trained</span>
          </div>

          <div className="flex flex-col items-center gap-1 text-center p-2 rounded-lg text-muted-foreground opacity-60">
            <span className="flex size-5 items-center justify-center rounded-full bg-background text-[10px] shadow-xs">3</span>
            <span>3. Assessment</span>
          </div>

          <div className="flex flex-col items-center gap-1 text-center p-2 rounded-lg text-muted-foreground opacity-60">
            <span className="flex size-5 items-center justify-center rounded-full bg-background text-[10px] shadow-xs">4</span>
            <span>4. Apply Job Card</span>
          </div>
        </div>
        
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {job.trainingRequired 
            ? `Follow the required sequence: Each job card with training & assessment requires its own independent $10 payment via Paystack. Paying for one job card does not open other job cards. Once payment is detected for this job card, its training modules unlock, followed by the skill assessment quiz and application.`
            : `This job card requires you to pass a short assessment to prove your skills. There is no training fee required for this category.`}
        </p>

        {/* ── FREE JOB (Assessment Only) ── */}
        {!job.trainingRequired && (
          <div className="mt-8 pt-6 border-t border-border">
            <AssessmentQuiz category={job.category} onPass={handleApplyAfterTraining} />
            {applyError && (
              <p className="mt-4 text-center text-xs text-destructive">{applyError}</p>
            )}
          </div>
        )}

        {/* ── PAID JOB (Unpaid State - Locked Gate) ── */}
        {job.trainingRequired && !isPaid && (
          <div className="mt-8 flex flex-col gap-6">
            {/* Lock Notice */}
            <div className="flex flex-col items-center justify-center rounded-xl border border-warning/40 bg-warning/5 p-6 text-center shadow-xs">
              <div className="rounded-full bg-warning/15 p-3 mb-3 text-warning">
                <Lock className="size-6" />
              </div>
              <h3 className="text-base font-semibold text-foreground">Training & Assessment Locked for this Job Card</h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-md leading-relaxed">
                Each job card requires its own payment detection. Complete the $10 Paystack payment below to unlock training and assessment specifically for this job card.
              </p>
            </div>

            {/* Pricing summary */}
            <div className="rounded-xl border border-border p-5 bg-muted/20">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">Job Card Training Access Fee (Individual)</span>
                <span className="font-mono font-bold text-base text-primary">{formatUsd(TRAINING_FEE)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Payment is integrated and tracked per job card via Paystack. Paying for this job card unlocks training &amp; assessment for this card only.
              </p>
            </div>

            {/* Error banner */}
            {payState === 'error' && errorMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/8 p-3 text-sm text-destructive">
                <XCircle className="mt-0.5 size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Status banners */}
            {payState === 'awaiting_payment' && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                Waiting for payment detection from Paystack…
              </div>
            )}

            {payState === 'verifying' && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                Verifying payment status with Paystack…
              </div>
            )}

            {/* Pay button */}
            <Button
              onClick={handlePay}
              size="lg"
              className="w-full font-semibold"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {payState === 'initializing' ? 'Redirecting to Paystack…' : 'Detecting payment…'}
                </>
              ) : (
                `Pay ${formatUsd(TRAINING_FEE)} with Paystack`
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Payment is tracked automatically. Training & assessment unlock instantly upon Paystack detection.
            </p>
          </div>
        )}

        {/* ── PAID JOB (Paid State - Unlocked Sequence: Training -> Assessment -> Apply) ── */}
        {job.trainingRequired && isPaid && (
          <div className="mt-8 flex flex-col gap-8">
            <div className="flex items-center gap-2 rounded-xl bg-success/15 p-4 text-sm font-medium text-success border border-success/30">
              <CheckCircle2 className="size-5 shrink-0" />
              <span>Payment Detected &amp; Confirmed via Paystack — Training &amp; Assessment Unlocked!</span>
            </div>

            {/* Step 2: Training Modules */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <GraduationCap className="size-5 text-primary" />
                  Step 2: Training Modules
                </h2>
                <span className="text-xs bg-success/15 text-success px-2.5 py-1 rounded-full font-medium">Unlocked</span>
              </div>
              <TrainingModules job={job} />
            </div>

            {/* Step 3: Assessment Quiz */}
            <div className="pt-6 border-t border-border flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-primary" />
                  Step 3 &amp; 4: Skill Assessment &amp; Job Card Application
                </h2>
              </div>
              <p className="text-xs text-muted-foreground">
                After studying the training modules above, complete the assessment quiz below to apply for this job card.
              </p>
              <AssessmentQuiz category={job.category} onPass={handleApplyAfterTraining} />
              {applyError && (
                <p className="mt-4 text-center text-sm font-medium text-destructive bg-destructive/10 p-3 rounded-lg">{applyError}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TrainingPage(props: { params: { id: string } }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <TrainingPageInner {...props} />
    </Suspense>
  )
}
