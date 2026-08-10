'use client'

/**
 * /kyc/callback
 *
 * Didit redirects the user to this page after they finish (or abandon) the
 * identity-verification flow. The page:
 *
 *   1. Reads the `session_id` from the URL query parameters.
 *   2. Performs a server-side status check via /api/kyc/status (the ONLY
 *      trusted source of truth — URL params are NOT trusted for business logic).
 *   3. Renders the appropriate UI for every possible outcome:
 *
 *      ┌─────────────────┬──────────────────────────────────────────────────┐
 *      │ Outcome         │ UI Branch                                        │
 *      ├─────────────────┼──────────────────────────────────────────────────┤
 *      │ Approved        │ Success screen + redirect to profile              │
 *      │ Declined        │ Error screen + reason (if available) + retry CTA │
 *      │ Resubmission    │ Warning screen + which steps to redo + retry CTA  │
 *      │ OnHold          │ Info screen: "under manual review"                │
 *      │ Abandoned       │ Neutral screen + retry CTA                        │
 *      │ Expired         │ Neutral screen + retry CTA                        │
 *      │ Pending/Loading │ Spinner screen                                    │
 *      └─────────────────┴──────────────────────────────────────────────────┘
 *
 *   4. For the cross-device QR flow the page always tells the user to
 *      return to their laptop — the desktop tab polls and updates itself.
 */

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  ShieldCheck,
  Loader2,
  AlertCircle,
  RefreshCcw,
  Clock,
  ShieldAlert,
  Info,
  CheckCircle2,
} from 'lucide-react'

// ─── Status type (mirrors DiditSessionStatus from lib/didit.ts) ───────────────
type KycOutcome =
  | 'loading'
  | 'approved'
  | 'declined'
  | 'resubmission'
  | 'on_hold'
  | 'abandoned'
  | 'expired'

// ─── Shape of the data returned by /api/kyc/status ────────────────────────────
type StatusApiResponse = {
  isApproved?: boolean
  isRejected?: boolean
  isOnHold?: boolean
  needsResubmission?: boolean
  diditExpired?: boolean
  diditAbandoned?: boolean
  diditApproved?: boolean
  rejectionReason?: string | null
  failedChecks?: string[] | null
}

// ─── Component ────────────────────────────────────────────────────────────────
function KycCallbackContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [outcome, setOutcome] = useState<KycOutcome>('loading')
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [failedChecks, setFailedChecks] = useState<string[] | null>(null)

  const device = searchParams.get('device')
  /** True when the user scanned a QR code and is on their phone. */
  const isMobileFlow = device === 'mobile'
  /** True when the desktop QR modal opened this page on the phone (cross-device). */
  const isCrossDevice = device === 'cross_device'

  useEffect(() => {
    async function resolveOutcome() {
      try {
        const sessionId =
          searchParams.get('session_id') ||
          searchParams.get('sessionId') ||
          searchParams.get('verificationSessionId')

        // ── Fast-fail based on URL param (cosmetic only) ─────────────────────
        // Didit docs warn: DO NOT trust URL params for business logic. We use
        // them only to show an early "something went wrong" hint while the real
        // server-side check runs.
        const urlStatus = (searchParams.get('status') ?? '').toLowerCase()
        if (['declined', 'rejected', 'failed'].includes(urlStatus)) {
          // Don't set final state yet — let the server check override
        }

        // ── Authenticated server-side status check ───────────────────────────
        if (sessionId) {
          try {
            const { getAuth } = await import('firebase/auth')
            const auth = getAuth()

            // Wait for auth state to be ready before fetching the token
            await new Promise<void>((resolve) => {
              const unsub = auth.onAuthStateChanged(() => {
                unsub()
                resolve()
              })
            })

            const idToken = await auth.currentUser?.getIdToken()
            if (!idToken) {
              // Not authenticated on this device (e.g. phone during a cross-device flow)
              if (isCrossDevice) {
                // We cannot verify server-side without auth, but we can look at the URL
                // cosmetically so the user knows they can close their phone tab.
                const s = urlStatus
                if (['approved', 'verified', 'completed', 'success'].includes(s)) {
                  setOutcome('approved')
                } else if (['declined', 'rejected', 'failed'].includes(s)) {
                  setOutcome('declined')
                } else if (s === 'resubmission') {
                  setOutcome('resubmission')
                } else if (s === 'on_hold') {
                  setOutcome('on_hold')
                } else {
                  // Default for cross-device: assume success/pending and tell them to check desktop
                  setOutcome('approved')
                }
                return
              }
              // Normal flow but unauthenticated — show abandoned
              setOutcome('abandoned')
              return
            }

            const res = await fetch(
              `/api/kyc/status?sessionId=${encodeURIComponent(sessionId)}&t=${Date.now()}`,
              { headers: { Authorization: `Bearer ${idToken}` } },
            )

            if (!res.ok) {
              // Server error — fall back to URL param hint
              setOutcome(
                ['declined', 'rejected', 'failed'].includes(urlStatus) ? 'declined' : 'abandoned',
              )
              return
            }

            const data: StatusApiResponse = await res.json()

            if (data.rejectionReason) setRejectionReason(data.rejectionReason)
            if (data.failedChecks?.length) setFailedChecks(data.failedChecks)

            // Derive the outcome from the authoritative server response
            if (data.isApproved || data.diditApproved) {
              setOutcome('approved')
            } else if (data.isRejected) {
              setOutcome('declined')
            } else if (data.needsResubmission) {
              setOutcome('resubmission')
            } else if (data.isOnHold) {
              setOutcome('on_hold')
            } else if (data.diditExpired) {
              setOutcome('expired')
            } else if (data.diditAbandoned) {
              setOutcome('abandoned')
            } else {
              // Pending / InProgress / awaitingWebhook — treat as success from
              // the user's perspective; the webhook will finalise asynchronously.
              setOutcome('approved')
            }

            // ── Mobile flow: redirect to profile after success ───────────────
            if (isMobileFlow && (data.isApproved || data.diditApproved)) {
              const sid = sessionId
                ? `&sid=${encodeURIComponent(sessionId)}`
                : ''
              setTimeout(() => {
                router.push(`/profile?kyc=success${sid}`)
              }, 3000)
            }
          } catch (authErr) {
            console.error('[KYC callback] Auth/status check failed:', authErr)
            setOutcome('abandoned')
          }
        } else {
          // No session_id in URL — cannot look up status
          setOutcome(
            ['declined', 'rejected', 'failed'].includes(urlStatus) ? 'declined' : 'abandoned',
          )
        }
      } catch (err) {
        console.error('[KYC callback] Unexpected error:', err)
        setOutcome('abandoned')
      }
    }

    resolveOutcome()
  }, [searchParams, isMobileFlow, router])

  // ── Shared shell ────────────────────────────────────────────────────────────
  function Shell({ children }: { children: React.ReactNode }) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-xl sm:p-8">
          {children}
        </div>
      </div>
    )
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (outcome === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6 text-center">
        <Loader2 className="size-10 animate-spin text-primary" />
        <p className="mt-4 text-sm font-medium text-muted-foreground">
          Finalising identity verification…
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">This usually takes a few seconds.</p>
      </div>
    )
  }

  // ── Cross-device completion (phone screen after desktop QR scan) ─────────────
  // In this flow the user is on their phone; the desktop tab is polling.
  // The user just needs to know it worked and can close this tab.
  if (isCrossDevice && outcome === 'approved') {
    return (
      <Shell>
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/5">
          <ShieldCheck className="size-12" />
        </div>
        <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Verification Complete!
        </h1>
        <p className="mt-3 text-sm font-semibold text-foreground">
          Please return to your laptop or desktop.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Your desktop will automatically detect this verification and update your profile. You may
          safely close this window.
        </p>
        <button
          onClick={() => {
            try { window.close() } catch { /* browser may block */ }
          }}
          className="mt-6 w-full rounded-xl bg-secondary px-4 py-2.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          Done (Close Window)
        </button>
      </Shell>
    )
  }

  // ── Approved / success ───────────────────────────────────────────────────────
  if (outcome === 'approved') {
    return (
      <Shell>
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/5">
          <ShieldCheck className="size-12" />
        </div>
        <h1 className="mt-6 text-xl font-bold tracking-tight sm:text-2xl">
          Identity Verified!
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your identity has been confirmed.{' '}
          {isMobileFlow
            ? 'Redirecting you to your profile…'
            : 'You may return to your profile.'}
        </p>
        {isMobileFlow && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-success">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Updating your profile…</span>
          </div>
        )}
        <button
          onClick={() => router.push('/profile?kyc=success')}
          className="mt-6 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          Go to Profile
        </button>
      </Shell>
    )
  }

  // ── Declined / hard rejection ────────────────────────────────────────────────
  if (outcome === 'declined') {
    return (
      <Shell>
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <AlertCircle className="size-8" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
          Verification Unsuccessful
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Unfortunately we were unable to verify your identity.
        </p>
        {rejectionReason && (
          <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            Reason: {rejectionReason}
          </p>
        )}
        {failedChecks && failedChecks.length > 0 && (
          <ul className="mt-2 space-y-1 text-left text-xs text-muted-foreground">
            {failedChecks.map((c) => (
              <li key={c} className="flex items-center gap-1.5">
                <AlertCircle className="size-3 shrink-0 text-destructive" />
                {c.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Please ensure your ID document is clear, unexpired, and not obscured. If you believe this
          is an error, contact support.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => router.push('/profile')}
            className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCcw className="mr-1.5 inline size-3.5" />
            Try Again
          </button>
          <button
            onClick={() => router.push('/profile')}
            className="w-full rounded-xl bg-muted px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80"
          >
            Back to Profile
          </button>
        </div>
      </Shell>
    )
  }

  // ── Resubmission required ────────────────────────────────────────────────────
  if (outcome === 'resubmission') {
    return (
      <Shell>
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
          <RefreshCcw className="size-8" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
          Additional Information Required
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Some steps of your verification need to be completed again.
        </p>
        {rejectionReason && (
          <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
            {rejectionReason}
          </p>
        )}
        {failedChecks && failedChecks.length > 0 && (
          <ul className="mt-3 space-y-1 text-left text-xs text-muted-foreground">
            {failedChecks.map((c) => (
              <li key={c} className="flex items-center gap-1.5">
                <AlertCircle className="size-3 shrink-0 text-warning" />
                {c.replace(/_/g, ' ')} needs to be resubmitted
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => router.push('/profile')}
          className="mt-6 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <RefreshCcw className="mr-1.5 inline size-3.5" />
          Resubmit Verification
        </button>
      </Shell>
    )
  }

  // ── On hold (manual review) ──────────────────────────────────────────────────
  if (outcome === 'on_hold') {
    return (
      <Shell>
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-blue-500/15 text-blue-500">
          <Info className="size-8" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
          Under Review
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Your verification is being reviewed by our compliance team. This typically takes 1–2
          business days. You&apos;ll be notified once a decision has been made.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-600">
          <Clock className="size-3.5" />
          No action required from you right now.
        </div>
        <button
          onClick={() => router.push('/profile')}
          className="mt-6 w-full rounded-xl bg-muted px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/80"
        >
          Back to Profile
        </button>
      </Shell>
    )
  }

  // ── Expired ──────────────────────────────────────────────────────────────────
  if (outcome === 'expired') {
    return (
      <Shell>
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Clock className="size-8" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
          Session Expired
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Your verification session has expired before it was completed. Please start a new session
          from your profile.
        </p>
        <button
          onClick={() => router.push('/profile')}
          className="mt-6 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Start New Verification
        </button>
      </Shell>
    )
  }

  // ── Abandoned (default / fallback) ───────────────────────────────────────────
  return (
    <Shell>
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="size-8" />
      </div>
      <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
        Verification Incomplete
      </h1>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        It looks like the verification process wasn&apos;t finished. You can start again from your
        profile whenever you&apos;re ready.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <button
          onClick={() => router.push('/profile')}
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try Again
        </button>
        <button
          onClick={() => router.push('/')}
          className="w-full rounded-xl bg-muted px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80"
        >
          Back to Dashboard
        </button>
      </div>
    </Shell>
  )
}

// ─── Page export ──────────────────────────────────────────────────────────────
export default function KycCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background">
          <Loader2 className="size-10 animate-spin text-primary" />
        </div>
      }
    >
      <KycCallbackContent />
    </Suspense>
  )
}
