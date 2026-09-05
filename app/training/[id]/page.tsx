'use client'

import { Suspense, useCallback, useEffect, useRef, useState, use } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  GraduationCap,
  Lock,
  Loader2,
  XCircle,
  CreditCard,
  SlidersHorizontal,
} from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import emailjs from '@emailjs/browser'
import { useAuth } from '@/components/firebase-auth-provider'
import { Button } from '@/components/ui/button'
import { AssessmentQuiz } from '@/components/assessment-quiz'
import { TrainingModules } from '@/components/training-modules'
import { formatKesValue, getTrainingFeeKes } from '@/lib/afterworks-data'
import { authedFetch, describeError } from '@/lib/client-api'

// Kept per-tab and short-lived: it is only a pointer to a pending Paystack charge that the server
// can re-verify at any time, so it does not belong in localStorage where it would outlive the session.
const LS_REF_KEY = 'aw_training_paystack_ref'

function rememberReference(value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(LS_REF_KEY, value)
    else window.sessionStorage.removeItem(LS_REF_KEY)
  } catch {
    /* private mode — the URL parameter still carries the reference home */
  }
}

function recalledReference(): string | null {
  try {
    return window.sessionStorage.getItem(LS_REF_KEY)
  } catch {
    return null
  }
}

type PayState =
  | 'idle'
  | 'initializing'
  | 'awaiting_payment'
  | 'verifying'
  | 'paid'
  | 'error'

/**
 * Paystack Checkout Section — mounted purely client-side to prevent SSR 500 errors.
 */
function PaystackCheckoutSection({
  jobId,
  userEmail,
  onVerifySuccess,
  payState,
  setPayState,
  errorMsg,
  setErrorMsg,
}: {
  jobId: string
  userEmail: string
  onVerifySuccess: (ref: string) => Promise<boolean>
  payState: PayState
  setPayState: (st: PayState) => void
  errorMsg: string | null
  setErrorMsg: (msg: string | null) => void
}) {
  const amountKes = getTrainingFeeKes()
  const popupRef = useRef<Window | null>(null)
  // True when the server said there is no browser-reachable callback URL, so this tab must stay
  // put and confirm the charge itself while Paystack runs in a separate window.
  const [popupCheckout, setPopupCheckout] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [refDraft, setRefDraft] = useState('')

  const isLoading = payState === 'initializing' || payState === 'verifying' || payState === 'awaiting_payment'

  /**
   * Ask the server to open the charge, then hand the browser to Paystack's hosted page.
   *
   * The amount, the payer email and the reference all come back from `/api/paystack/initialize`
   * rather than being assembled here, so the price cannot be edited in devtools and the charge is
   * reconcilable when the worker returns to this page.
   *
   * Two ways to Paystack:
   *  • normal: the whole tab navigates to the hosted checkout and Paystack redirects it back to
   *    this training page (carrying `reference`/`trxref`) once the charge settles;
   *  • `popupMode` (server flag): no browser-reachable callback exists on this deployment (e.g. a
   *    preview tunnel whose host is a bind address like `0.0.0.0`), so navigating would strand the
   *    worker on an unreachable page after paying. Instead Paystack opens in a new window and this
   *    tab keeps polling `/api/paystack/verify` until the charge is confirmed.
   */
  async function handlePay() {
    if (isLoading) return
    setErrorMsg(null)

    if (!userEmail) {
      setPayState('error')
      setErrorMsg('Please sign in with the email you want charged before paying.')
      return
    }

    setPayState('initializing')
    try {
      const data = await authedFetch<{ authorizationUrl: string; reference: string; amountKes: number; popupMode?: boolean }>(
        '/api/paystack/initialize',
        { method: 'POST', body: { jobId }, timeoutMs: 20_000 },
      )
      rememberReference(data.reference)
      setPayState('awaiting_payment')
      if (data.popupMode === true) {
        // No noopener here on purpose: the handle is how we detect a blocked popup and how we
        // notice the window closing so verification runs immediately. Paystack's checkout is the
        // only page that ever gets this handle, and it cannot read this tab's session storage.
        const popup = window.open(data.authorizationUrl, '_blank', 'width=480,height=720')
        if (!popup) {
          rememberReference(null)
          setPopupCheckout(false)
          setPayState('error')
          setErrorMsg('The secure payment window could not open. Please allow pop-ups for this site, then try again.')
          return
        }
        popupRef.current = popup
        setPopupCheckout(true)
      } else {
        window.location.assign(data.authorizationUrl)
      }
    } catch (err) {
      setPayState('error')
      setErrorMsg(describeError(err))
    }
  }

  async function handleCheckNow() {
    const ref = recalledReference()
    if (!ref) {
      setErrorMsg('No pending payment was found in this tab. Reload the page if you have just paid.')
      return
    }
    await onVerifySuccess(ref)
  }

  async function handleConfirmReference() {
    const ref = refDraft.trim()
    if (!ref) return
    setErrorMsg(null)
    const paid = await onVerifySuccess(ref)
    if (paid) setConfirmOpen(false)
  }

  // When the checkout runs in a separate window, confirm the charge the moment that window closes
  // (a fast path — the 4-second poll below is the safety net that keeps checking either way).
  useEffect(() => {
    if (payState !== 'awaiting_payment') return
    const id = window.setInterval(() => {
      const popup = popupRef.current
      if (popup && popup.closed) {
        popupRef.current = null
        const ref = recalledReference()
        if (ref) void onVerifySuccess(ref)
      }
    }, 800)
    return () => window.clearInterval(id)
  }, [payState, onVerifySuccess])

  return (
    <div className="mt-8 flex flex-col gap-6">
      {/* Lock Notice */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-warning/40 bg-warning/5 p-6 text-center shadow-xs">
        <div className="rounded-full bg-warning/15 p-3 mb-3 text-warning">
          <Lock className="size-6" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Training Access Checkout
          </h2>
          <p className="mt-1 text-xs text-muted-foreground max-w-md leading-relaxed">
            Each job card requires its own payment detection. Complete payment below to unlock training and assessment specifically for this job card.
          </p>
        </div>
      </div>

      {/* Pricing summary */}
      <div className="rounded-xl border border-border p-5 bg-muted/20 flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">Job Card Training Access Fee</span>
          <div className="flex flex-col items-end">
            <span className="font-mono text-lg font-bold text-primary">{formatKesValue(amountKes)}</span>
            <span className="text-[11px] text-muted-foreground">≈ $10 · one job card</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-2.5">
          Payment is charged in <strong>Kenyan Shillings (KES {amountKes.toLocaleString()})</strong>. Supports <strong>M-Pesa / Mobile Money</strong>, <strong>Bank Transfers</strong>, and <strong>Cards</strong>.
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
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          <span className="flex items-start gap-2">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
            <span>
              {popupCheckout
                ? 'Waiting for Paystack to confirm the charge… Complete the payment in the window that just opened (or on your phone with M-Pesa). You can close that window once it shows a receipt — this page unlocks itself automatically.'
                : 'Waiting for Paystack to confirm the charge…'}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2 text-xs">
            Back already?
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void handleCheckNow()}>
              Check payment now
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { rememberReference(null); setPayState('idle'); setPopupCheckout(false) }}>
              Start over
            </Button>
          </span>
        </div>
      )}

      {payState === 'verifying' && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          Verifying payment status…
        </div>
      )}

      {/* Pay button */}
      <Button
        onClick={handlePay}
        size="lg"
        className="w-full font-semibold gap-2 py-6 text-base"
        disabled={isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            {payState === 'initializing' ? 'Opening secure checkout…' : 'Confirming payment…'}
          </>
        ) : (
          <>
            <CreditCard className="size-5" />
            Pay {formatKesValue(amountKes)} for training and assessment
          </>
        )}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        M-Pesa, Mobile Money, Bank Transfer &amp; Card are supported. Training unlocks instantly upon payment detection.
      </p>

      {/* Last resort for a charge that settled while the redirect never made it home: let the
          worker paste the reference from their receipt and re-run server-side verification. */}
      <div className="flex flex-col items-center gap-2">
        {!confirmOpen ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="text-xs font-medium text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground"
          >
            Paid already? Confirm your payment
          </button>
        ) : (
          <div className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 text-left">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Enter the <strong className="font-mono text-foreground">aw_tr_…</strong> reference from
              your Paystack receipt or the link you were sent after paying. We will re-check it
              against Paystack and unlock this job card if the charge went through.
            </p>
            <div className="flex gap-2">
              <input
                value={refDraft}
                onChange={(event) => setRefDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleConfirmReference()
                }}
                placeholder="aw_tr_…"
                spellCheck={false}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 shrink-0 text-xs"
                disabled={!refDraft.trim() || payState === 'verifying'}
                onClick={() => void handleConfirmReference()}
              >
                {payState === 'verifying' ? 'Checking…' : 'Check payment'}
              </Button>
            </div>
            {payState === 'error' && errorMsg && (
              <p className="text-xs font-medium text-destructive">{errorMsg}</p>
            )}
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); if (payState === 'error') setErrorMsg(null) }}
              className="w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TrainingPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { getJob, worker, applyToJob, getApplicationForJob, isJobPaid, verifyTrainingPayment } = useAfterWorks()
  const { user } = useAuth()

  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const userEmail = (worker?.email && worker.email.trim().length > 0)
    ? worker.email
    : (user?.email || '')

  const [payState, setPayState] = useState<PayState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const job = getJob(id)

  // ── Verify a reference and unlock training ──────────────────────────────
  // The server (not this component) decides whether the course is paid: /api/paystack/verify
  // confirms the reference against Paystack and writes the entitlement to the profile document.
  // Returns true when the charge was confirmed, false otherwise (the caller can then decide
  // whether to keep waiting, show the checkout again, or stop).
  const verifyReference = useCallback(async (ref: string): Promise<boolean> => {
    setPayState('verifying')
    const result = await verifyTrainingPayment(id, ref)
    if (result.ok && result.paid) {
      rememberReference(null)
      setPayState('paid')
      return true
    }
    if (result.ok && !result.paid) {
      // "Still pending on Paystack's side" keeps polling instead of failing the worker; a
      // terminal status (no such charge / abandoned / failed / underpaid) stops and explains.
      const terminal =
        typeof result.status === 'string' &&
        ['not_found', 'failed', 'abandoned', 'reversed', 'underpaid'].includes(result.status)
      if (terminal) {
        rememberReference(null)
        setPayState('error')
        setErrorMsg(
          result.message ??
            (result.status === 'not_found'
              ? 'We could not find a charge for that reference. It may have never reached Paystack — you can start a new payment below.'
              : 'That payment did not complete on Paystack’s side. You can start a new payment below, or contact support if money was deducted.'),
        )
        return false
      }
      rememberReference(ref)
      setPayState('awaiting_payment')
      return false
    }
    setPayState('error')
    setErrorMsg(result.error ?? 'Could not verify payment. Please refresh the page.')
    return false
  }, [id, verifyTrainingPayment])

  // ── On mount: check if paid previously or returning from Paystack ────────
  useEffect(() => {
    if (isJobPaid(id)) {
      setPayState('paid')
      return
    }

    const urlRef = searchParams.get('reference') ?? searchParams.get('trxref')

    if (urlRef) {
      const clean = new URL(window.location.href)
      clean.searchParams.delete('reference')
      clean.searchParams.delete('trxref')
      window.history.replaceState({}, '', clean.toString())

      // Remember it so the poller below can keep checking while the charge is still pending.
      rememberReference(urlRef)
      void verifyReference(urlRef)
    }
  }, [id, searchParams, isJobPaid, verifyReference])

  // ── Auto-recover a charge that settled but never unlocked this page ─────
  // When the Paystack redirect could not reach the app (unreachable callback URL, closed tab,
  // webhook not configured), /initialize still wrote a server-side `pending` row. Ask the server
  // for this member's pending references for this job card and re-verify each one: a charge that
  // actually went through is then confirmed, recorded as `success` in the admin ledger and the
  // training unlocks — with no reference for the worker to hunt down.
  useEffect(() => {
    if (payState !== 'idle' || !job?.trainingRequired || isJobPaid(id)) return
    let cancelled = false
    void (async () => {
      try {
        const data = await authedFetch<{ refs: string[] }>(
          `/api/paystack/pending?jobId=${encodeURIComponent(id)}`,
          { timeoutMs: 10_000 },
        )
        if (cancelled) return
        for (const ref of Array.isArray(data.refs) ? data.refs : []) {
          if (cancelled) return
          if (await verifyReference(ref)) return
          if (cancelled) return
        }
      } catch {
        /* demo mode / storage offline — the checkout below still works normally */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [payState, id, isJobPaid, job?.trainingRequired, verifyReference])

  // ── Poll for payment while awaiting ─────────────────────────────────────
  useEffect(() => {
    if (payState === 'awaiting_payment') {
      const ref = recalledReference()
      if (!ref) return

      pollingRef.current = setInterval(() => verifyReference(ref), 4000)
      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current)
      }
    }
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [payState, verifyReference])

  // ── Apply after training ─────────────────────────────────────────────────
  async function handleApplyAfterTraining() {
    if (isApplying) return
    setIsApplying(true)
    const result = await applyToJob(job!.id)
    if (!result.ok) {
      setApplyError(result.reason)
      setIsApplying(false)
      return
    }

    try {
      // Receipt email. Configured in .env.local; absence is not an error — the application record
      // is already written server-side and the worker also gets an in-app notification.
      const serviceId = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID ?? 'service_8qxbsyi'
      const templateId = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID ?? 'template_8g1egki'
      const publicKey = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY ?? 'Juc_jABykXhGr_WPK'
      await emailjs.send(
        serviceId,
        templateId,
        {
          to_name: worker.name || 'Applicant',
          to_email: worker.email,
          job_title: job!.title,
          message: 'Your application is under review. You will be contacted shortly for an online interview.',
        },
        publicKey
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
            <span>1. Complete Payment</span>
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
            ? `Follow the required sequence: Each job card with training & assessment requires its own independent payment. Paying for one job card does not open other job cards. Once payment is detected for this job card, its training modules unlock, followed by the skill assessment quiz and application.`
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
          isMounted ? (
            <PaystackCheckoutSection
              jobId={job.id}
              userEmail={userEmail}
              onVerifySuccess={verifyReference}
              payState={payState}
              setPayState={setPayState}
              errorMsg={errorMsg}
              setErrorMsg={setErrorMsg}
            />
          ) : (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )
        )}

        {/* ── PAID JOB (Paid State - Unlocked Sequence: Training -> Assessment -> Apply) ── */}
        {job.trainingRequired && isPaid && (
          <div className="mt-8 flex flex-col gap-8">
            <div className="flex items-center gap-2 rounded-xl bg-success/15 p-4 text-sm font-medium text-success border border-success/30">
              <CheckCircle2 className="size-5 shrink-0" />
              <span>Payment Detected &amp; Confirmed — Training &amp; Assessment Unlocked!</span>
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

export default function TrainingPage(props: { params: Promise<{ id: string }> }) {
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
