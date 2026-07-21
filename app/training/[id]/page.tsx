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
import { useAuth } from '@/components/firebase-auth-provider'
import { Button } from '@/components/ui/button'
import { formatUsd } from '@/lib/afterworks-data'

const TRAINING_FEE = 10
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
  const { getJob, worker, applyToJob, refreshWallet } = useAfterWorks()
  const { user } = useAuth()

  const userEmail = (worker?.email && worker.email.trim().length > 0)
    ? worker.email
    : (user?.email || '')

  const paystackConfig = {
    reference: `aw_training_${new Date().getTime()}`,
    email: userEmail,
    amount: TRAINING_FEE * 100,
    publicKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
    currency: 'KES',
    metadata: {
      custom_fields: [
        {
          display_name: 'Job ID',
          variable_name: 'jobId',
          value: id
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
        localStorage.setItem(paidStorageKey, 'true')
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
  }, [refreshWallet, paidStorageKey])

  // ── On mount: check if paid previously or returning from Paystack ────────
  useEffect(() => {
    // Check if training has already been unlocked & paid
    if (typeof window !== 'undefined' && localStorage.getItem(paidStorageKey) === 'true') {
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
  }, [searchParams, verifyReference, paidStorageKey])

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
        verifyReference(reference.reference || reference.trxref || reference)
      },
      onClose: () => {
        setPayState('idle')
      }
    })
  }

  // ── Apply after training ─────────────────────────────────────────────────
  function handleApplyAfterTraining() {
    const result = applyToJob(job!.id)
    if (!result.ok) {
      setApplyError(result.reason)
      return
    }
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

  // ── Render helpers ───────────────────────────────────────────────────────
  const isLoading =
    payState === 'initializing' ||
    payState === 'verifying' ||
    payState === 'awaiting_payment'

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link
        href={`/jobs/${job.id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to job
      </Link>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <GraduationCap className="size-5" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {job.category} training
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This job requires a short training module. A one-time{' '}
          <span className="font-medium text-foreground">$10 fee unlocks the content</span>{' '}
          and grants unlimited assessment retries. This is for training access only — never
          a job-application or verification fee.
        </p>

        {/* ── UNPAID STATE ── */}
        {payState !== 'paid' && (
          <div className="mt-6 flex flex-col gap-4">
            {/* Pricing summary */}
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Training access (one-time)</span>
                <span className="font-mono font-semibold">{formatUsd(TRAINING_FEE)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                You will be redirected to Paystack&apos;s secure checkout page to complete your payment.
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
                <Loader2 className="size-4 animate-spin" />
                Waiting for payment confirmation from Paystack…
              </div>
            )}

            {payState === 'verifying' && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Verifying your payment…
              </div>
            )}

            {/* Pay button */}
            <Button
              onClick={handlePay}
              size="lg"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {payState === 'initializing' ? 'Redirecting to Paystack…' : 'Processing…'}
                </>
              ) : (
                `Pay ${formatUsd(TRAINING_FEE)} with Paystack`
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Content unlocks once payment is confirmed. Closing this page won&apos;t lose your
              access — your access is saved automatically.
            </p>
          </div>
        )}

        {/* ── PAID / MODULES UNLOCKED ── */}
        {payState === 'paid' && (
          <div className="mt-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-xl bg-green-500/12 p-3 text-sm font-medium text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-4" />
              Payment Confirmed — All Training Modules Unlocked
            </div>

            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-500" />
                    <span className="font-medium text-sm">Module 1: Guidelines &amp; Scope</span>
                  </div>
                  <span className="text-xs text-muted-foreground bg-accent px-2 py-0.5 rounded">Unlocked</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Review the primary task instructions, formatting rules, and guidelines for {job.title}.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-500" />
                    <span className="font-medium text-sm">Module 2: Quality &amp; Accuracy Standards</span>
                  </div>
                  <span className="text-xs text-muted-foreground bg-accent px-2 py-0.5 rounded">Unlocked</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Learn about acceptable error thresholds, QA scoring, and common pitfalls to avoid.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-accent/20 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-500" />
                    <span className="font-medium text-sm">Assessment &amp; Qualification</span>
                  </div>
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium bg-green-500/10 px-2 py-0.5 rounded">Passed</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  You have completed training requirements for this role.
                </p>
              </div>
            </div>

            <Button onClick={handleApplyAfterTraining} size="lg" className="w-full">
              Complete Training &amp; Apply for Job
            </Button>
            {applyError && (
              <p className="text-center text-xs text-destructive">{applyError}</p>
            )}
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
