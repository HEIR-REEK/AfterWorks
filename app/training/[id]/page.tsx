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
  ShieldAlert,
} from 'lucide-react'
import { useAfterWorks, useJobDetail } from '@/components/afterworks-provider'
import { useAuth } from '@/components/firebase-auth-provider'
import { Button } from '@/components/ui/button'
import { AssessmentQuiz } from '@/components/assessment-quiz'
import { TrainingModules, readTrainingProgress } from '@/components/training-modules'
import { formatKesValue, formatUsd, jobHasTraining, trainingFeeKesFor, trainingFeeUsdFor } from '@/lib/afterworks-data'
import { authedFetch, describeError } from '@/lib/client-api'

// Kept per-tab and short-lived: it is only a pointer to a pending Paystack charge that the server
// can re-verify at any time, so it does not belong in localStorage where it would outlive the session.
const LS_REF_KEY = 'aw_training_paystack_ref'

/** A reference is scoped to its job card, so card B can never poll card A's charge. */
function referenceKey(jobId: string): string {
  return `${LS_REF_KEY}:${jobId}`
}

function rememberReference(jobId: string, value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(referenceKey(jobId), value)
    else window.sessionStorage.removeItem(referenceKey(jobId))
  } catch {
    /* private mode — the URL parameter still carries the reference home */
  }
}

function recalledReference(jobId: string): string | null {
  try {
    return window.sessionStorage.getItem(referenceKey(jobId))
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
  priceRegion,
  feeUsd,
  userEmail,
  onVerifySuccess,
  payState,
  setPayState,
  errorMsg,
  setErrorMsg,
}: {
  jobId: string
  /** The region whose prices this charge unlocks. */
  priceRegion: string
  /** The tier's price; falls back to the region ceiling when the card states no fee. */
  feeUsd?: number
  userEmail: string
  onVerifySuccess: (ref: string) => Promise<boolean>
  payState: PayState
  setPayState: (st: PayState) => void
  errorMsg: string | null
  setErrorMsg: (msg: string | null) => void
}) {
  const amountKes = trainingFeeKesFor(feeUsd)
  const amountUsd = trainingFeeUsdFor(feeUsd)
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
        // The charge buys a *region's* prices, so the region is what is named. The server decides
        // whether that tier may be sold at all (not the member's own board, not one already held).
        { method: 'POST', body: { priceRegion, jobId, cardId: jobId }, timeoutMs: 20_000 },
      )
      rememberReference(jobId, data.reference)
      setPayState('awaiting_payment')
      if (data.popupMode === true) {
        // No noopener here on purpose: the handle is how we detect a blocked popup and how we
        // notice the window closing so verification runs immediately. Paystack's checkout is the
        // only page that ever gets this handle, and it cannot read this tab's session storage.
        const popup = window.open(data.authorizationUrl, '_blank', 'width=480,height=720')
        if (!popup) {
          rememberReference(jobId, null)
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
    const ref = recalledReference(jobId)
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
      if (!popup) return
      let closed: boolean
      try {
        closed = popup.closed
      } catch {
        // Our COOP header (same-origin-allow-popups) severs the opener handle once the popup
        // navigates to Paystack's cross-origin checkout, so reading .closed throws a SecurityError.
        // The window is no longer observable from here — drop the handle and let the 4-second
        // verify poll below confirm the charge instead.
        popupRef.current = null
        return
      }
      if (closed) {
        popupRef.current = null
        const ref = recalledReference(jobId)
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
            Unlock {priceRegion} Job Prices
          </h2>
          <p className="mt-1 text-xs text-muted-foreground max-w-md leading-relaxed">
            This card is priced for {priceRegion}. Pay once to access {priceRegion} job prices and its
            cards — including this one — pay {priceRegion} rates. No VPN, and no changing where you
            connect from. The course and the task open as soon as the payment is confirmed.
          </p>
        </div>
      </div>

      {/* Pricing summary */}
      <div className="rounded-xl border border-border p-5 bg-muted/20 flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">{priceRegion} Job Price Access</span>
          <div className="flex flex-col items-end">
            <span className="font-mono text-lg font-bold text-primary">{formatKesValue(amountKes)}</span>
            <span className="text-[11px] text-muted-foreground">≈ {formatUsd(amountUsd)} · one region, paid once</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-2.5">
          Payment is processed securely through our payment provider.
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
                ? 'Waiting for Paystack to confirm the charge… Complete the payment in the window that just opened. You can close that window once it shows a receipt — this page unlocks itself automatically.'
                : 'Waiting for Paystack to confirm the charge…'}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2 text-xs">
            Back already?
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void handleCheckNow()}>
              Check payment now
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { rememberReference(jobId, null); setPayState('idle'); setPopupCheckout(false) }}>
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
        className="w-full gap-2 whitespace-normal px-3 py-5 text-center text-base font-semibold leading-snug sm:py-6"
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
            Pay {formatKesValue(amountKes)} to unlock {priceRegion} prices
          </>
        )}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        The course and the task unlock after payment and identity verification are both complete.
        Paying once opens every {priceRegion}-priced card, not only this one.
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
              against Paystack and unlock this job card if the charge went through. A reference
              belongs to the one job card it was paid for — it cannot unlock a different card.
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

/**
 * The gate between paying and learning.
 *
 * Payment and identity verification are deliberately separate steps: a worker can settle a job
 * card's training fee before KYC (useful when a slot is open and the identity review is still
 * pending), but the course material and the assessment stay locked until the check is approved.
 * Keeping this gate in one component means every training path — paid or fee-free — uses the same
 * rule instead of each block remembering it separately.
 */
function VerificationGate({ paid }: { paid: boolean }) {
  return (
    <div className="mt-8 flex flex-col items-center rounded-xl border border-warning/40 bg-warning/5 p-6 text-center shadow-xs">
      <div className="mb-3 rounded-full bg-warning/15 p-3 text-warning">
        <ShieldAlert className="size-6" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        Request identity verification to continue
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {paid
          ? 'Your training payment for this job card is confirmed and your place is reserved. The training material and assessment stay locked until your identity check is approved.'
          : 'Identity verification is required before the training course and assessment unlock. Our team reviews it once you ask.'}
      </p>
      <Button render={<Link href="/profile" />} size="lg" className="mt-5 w-full gap-2 sm:w-auto">
        <ShieldAlert className="size-4" />
        Request verification in Profile
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        {paid
          ? 'The course and task unlock once your review is approved; reload this page if it has just been approved.'
          : 'The course and task unlock once your review is approved; reload this page if it has just been approved. There is no fee for this job card.'}
      </p>
    </div>
  )
}

function TrainingPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { worker, applyToJob, getApplicationForJob, isJobPaid, verifyTrainingPayment, profileLoaded, unlockedPriceRegions, jobRegion, refreshWallet } = useAfterWorks()
  const { user } = useAuth()
  const kycVerified = worker.kycVerified

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
  // True once every training section is marked complete — this is what unlocks the assessment.
  const [trainingComplete, setTrainingComplete] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // The card behind this course: live from the catalogue, re-read on focus, hydrated by document
  // id for a deep link. A training price or authored section changed in the console shows up here
  // without a reload — and the charge itself is priced server-side from the same document.
  const { job, checking: loadingJob } = useJobDetail(id)

  // Restore course progress on load so a refresh does not re-lock a finished course.
  useEffect(() => {
    if (!job) return
    setTrainingComplete(readTrainingProgress(job).complete)
  }, [job])

  // ── Verify a reference and unlock training ──────────────────────────────
  // The server (not this component) decides whether the course is paid: /api/paystack/verify
  // confirms the reference against Paystack and writes the entitlement to the profile document.
  // Returns true when the charge was confirmed, false otherwise (the caller can then decide
  // whether to keep waiting, show the checkout again, or stop).
  const verifyReference = useCallback(async (ref: string): Promise<boolean> => {
    setPayState('verifying')
    const result = await verifyTrainingPayment(id, ref)
    if (result.ok && result.paid && result.jobId === id) {
      rememberReference(id, null)
      setPayState('paid')
      // A region-price charge is confirmed as the region, not as this card's `paidTrainings` entry:
      // re-read the profile so the unlock this page is waiting on actually shows up here.
      void refreshWallet()
      return true
    }
    if (result.ok && result.paid && result.jobId !== id) {
      // Fail closed if an older server ever reports "paid" without binding it to this card.
      rememberReference(id, null)
      setPayState('error')
      setErrorMsg('That payment was for a different job card. Each job card needs its own payment.')
      return false
    }
    if (result.ok && !result.paid) {
      // "Still pending on Paystack's side" keeps polling instead of failing the worker; a
      // terminal status (no such charge / abandoned / failed / underpaid / wrong card) stops.
      const terminal =
        typeof result.status === 'string' &&
        ['not_found', 'failed', 'abandoned', 'reversed', 'underpaid', 'job_mismatch'].includes(result.status)
      if (terminal) {
        rememberReference(id, null)
        setPayState('error')
        setErrorMsg(
          result.message ??
            (result.status === 'not_found'
              ? 'We could not find a charge for that reference. It may have never reached Paystack — you can start a new payment below.'
              : 'That payment did not complete on Paystack’s side. You can start a new payment below, or contact support if money was deducted.'),
        )
        return false
      }
      rememberReference(id, ref)
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
      rememberReference(id, urlRef)
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
    if (payState !== 'idle' || !job || !jobHasTraining(job) || isJobPaid(id)) return
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
  }, [payState, id, isJobPaid, job, verifyReference])

  // ── Poll for payment while awaiting ─────────────────────────────────────
  useEffect(() => {
    if (payState === 'awaiting_payment') {
      const ref = recalledReference(id)
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

    // The receipt email is sent server-side from POST /api/applications through Resend. Nothing
    // about that send can block this redirect: the application record is already written.
    setIsApplying(false)
    router.push('/applications')
  }

  if (!isMounted || !profileLoaded) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        {loadingJob ? (
          <>
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading this job card…</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">This job could not be found.</p>
            <Button render={<Link href="/jobs" />} variant="outline">
              Back to jobs
            </Button>
          </>
        )}
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

  // A card that states a price is not open until that price has been paid. This is the gate that
  // makes the fee mean something, and it is checked here on the server-read entitlement (`isJobPaid`
  // comes from `paidTrainings`, which only the verify route and the webhook write) — never from
  // anything the browser could set. `hasTraining` is the old card-level test and still decides
  // whether the card *charges at all*; `needsUnlock` is the new one, and it also covers a card from
  // another region, where the payment is the region's price.
  const hasTraining = jobHasTraining(job)
  const cardRegion = String((job as { region?: string }).region ?? '')
  const unlockedRegion = cardRegion !== '' && unlockedPriceRegions.includes(cardRegion)
  const cardFeeUsd = Number(job.trainingFeeUsd ?? 0) || 0
  // Priced, unpaid, and outside the region the member already works → the fee is the way in.
  const needsUnlock = cardFeeUsd > 0 && !unlockedRegion
  // Priced, unpaid, and a training card → the classic per-card fee gate, unchanged.
  const needsTrainingPayment = hasTraining && !isJobPaid(job.id)
  const isPaid = !needsUnlock && !needsTrainingPayment
  // Which region the checkout sells. For a foreign-priced card that is its own region; for a card on
  // the member's own board the region is already held, so the server refuses the charge rather than
  // taking money for something free — the button then reads as an unlock of that same board, which
  // is honest about why nothing was taken.
  const circleRegion = cardRegion || (jobRegion?.region ?? 'Africa')

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-3xl flex-col gap-6">
      <Link
        href={`/jobs/${job.id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to job
      </Link>

      <div className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <GraduationCap className="size-5" />
        </div>
        
        <h1 className="mt-4 text-xl font-semibold tracking-tight sm:text-2xl">
          {hasTraining ? `${job.category} Training & Assessment` : `${job.category} Assessment & Application`}
        </h1>
        
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {needsUnlock
            ? `This card is priced for ${cardRegion || 'another region'} and is locked until you pay to access ${cardRegion || 'that region'} job prices. Once paid, its course and its paid task open for you — wherever you connect from.`
            : hasTraining
              ? needsTrainingPayment
                ? `Pay this card's ${formatUsd(cardFeeUsd)} fee to open its training course and its paid task. Payment can be made before identity verification; the course and task open once the check is approved.`
                : `Paid — the course and the task are open. Work through the course, then the task: its timer and what it pays are shown on the card.`
              : `This job card has no training — it is assessment and application only. The assessment is a paid task: it runs on a timer, and finishing it credits your balance. Identity verification must be approved before it unlocks.`}
        </p>

        {/* ── ASSESSMENT-ONLY CARD (no training, no fee) ── */}
        {/* Identity verification is the only gate: there is no training to work through and nothing
            to pay, so a verified member goes straight to the assessment and the application. */}
        {!hasTraining && (
          <div className="mt-8 flex flex-col gap-6 border-t border-border pt-6">
            {!kycVerified ? (
              <VerificationGate paid={false} />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h2 className="flex items-center gap-2 text-lg font-bold">
                    <CheckCircle2 className="size-5 text-primary" />
                    Skill Assessment &amp; Job Card Application
                  </h2>
                </div>
                <AssessmentQuiz category={job.category} jobId={job.id} onPass={handleApplyAfterTraining} />
                {applyError && (
                  <p className="text-center text-sm font-medium text-destructive">{applyError}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── A PRICED CARD THE MEMBER HAS NOT PAID FOR: the fee is the gate ── */}
        {/* This is the block that was missing. It covers both priced states: a training card whose
            own fee is unpaid, and a card priced for a region the member has not unlocked. Neither
            may reach the course or the task — the payment comes first. */}
        {!isPaid && (
          <div className="mt-8">
            {isMounted ? (
              <PaystackCheckoutSection
                jobId={job.id}
                priceRegion={circleRegion}
                feeUsd={cardFeeUsd}
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
            )}
          </div>
        )}

        {/* ── A CARD WITH TRAINING: paid (or free), verify, then course → task → apply ── */}
        {hasTraining && isPaid && (
          <div className="mt-8 flex flex-col gap-8">
            {unlockedRegion && (
              <div className="flex items-center gap-2 rounded-xl bg-success/15 p-4 text-sm font-medium text-success border border-success/30">
                <CheckCircle2 className="size-5 shrink-0" />
                <span>{cardRegion} job prices unlocked — this card pays the {cardRegion} rate.</span>
              </div>
            )}

            {!kycVerified ? (
              <VerificationGate paid={false} />
            ) : (
              <>
            {/* Step 2: Training — one section at a time, next unlocks as each is completed */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <GraduationCap className="size-5 text-primary" />
                  Step 2: Training Course
                </h2>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${trainingComplete ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary'}`}>
                  {trainingComplete ? 'Completed' : 'In progress'}
                </span>
              </div>
              <TrainingModules
                job={job}
                onComplete={() => setTrainingComplete(true)}
                onReset={() => setTrainingComplete(false)}
              />
            </div>

            {/* Step 3: Assessment Quiz — unlocks when the last training section is finished */}
            <div className="pt-6 border-t border-border flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-primary" />
                  Step 3 &amp; 4: Skill Assessment &amp; Job Card Application
                </h2>
                {!trainingComplete && (
                  <span className="flex items-center gap-1 text-xs bg-muted px-2.5 py-1 rounded-full font-medium text-muted-foreground">
                    <Lock className="size-3" />
                    Locked
                  </span>
                )}
              </div>
              {trainingComplete ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Training complete — answer the assessment below to apply for this job card.
                  </p>
                  <AssessmentQuiz category={job.category} jobId={job.id} onPass={handleApplyAfterTraining} />
                  {applyError && (
                    <p className="mt-4 text-center text-sm font-medium text-destructive bg-destructive/10 p-3 rounded-lg">{applyError}</p>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Finish every training section above to unlock the assessment. Your progress is saved as you go — you can leave and come back.
                  </span>
                </div>
              )}
            </div>
              </>
            )}
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
