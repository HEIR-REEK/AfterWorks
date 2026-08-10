'use client'

/**
 * /kyc/callback
 *
 * Didit redirects here after the verification flow finishes.
 * Binary outcome:
 *   PASS  → show success screen, redirect to /profile?kyc=success
 *   FAIL  → show "unsuccessful, try again" screen, redirect to /profile?kyc=failed
 *
 * Cross-device: user is on their phone — just tell them to close the tab.
 */

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  ShieldCheck,
  Loader2,
  AlertCircle,
  RefreshCcw,
} from 'lucide-react'

type KycOutcome = 'loading' | 'approved' | 'failed'

type StatusApiResponse = {
  isApproved?: boolean
  isRejected?: boolean
  isOnHold?: boolean
  needsResubmission?: boolean
  diditExpired?: boolean
  diditAbandoned?: boolean
  diditApproved?: boolean
}

function KycCallbackContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [outcome, setOutcome] = useState<KycOutcome>('loading')

  const device = searchParams.get('device')
  const isCrossDevice = device === 'cross_device'
  const isMobileFlow = device === 'mobile'

  useEffect(() => {
    async function resolveOutcome() {
      try {
        const sessionId =
          searchParams.get('session_id') ||
          searchParams.get('sessionId') ||
          searchParams.get('verificationSessionId')

        if (!sessionId) {
          setOutcome('failed')
          return
        }

        // Cross-device (phone after QR scan): can't auth server-side.
        // The desktop tab is polling and will detect the outcome.
        if (isCrossDevice) {
          setOutcome('approved') // Just show "go back to your laptop"
          return
        }

        try {
          const { getAuth } = await import('firebase/auth')
          const auth = getAuth()

          await new Promise<void>((resolve) => {
            const unsub = auth.onAuthStateChanged(() => { unsub(); resolve() })
          })

          const idToken = await auth.currentUser?.getIdToken()
          if (!idToken) {
            setOutcome('failed')
            return
          }

          const res = await fetch(
            `/api/kyc/status?sessionId=${encodeURIComponent(sessionId)}&t=${Date.now()}`,
            { headers: { Authorization: `Bearer ${idToken}` } },
          )

          if (!res.ok) {
            setOutcome('failed')
            return
          }

          const data: StatusApiResponse = await res.json()

          if (data.isApproved || data.diditApproved) {
            setOutcome('approved')
            // Mobile same-device: redirect to profile after showing success
            if (isMobileFlow) {
              setTimeout(() => {
                router.push(`/profile?kyc=success&sid=${encodeURIComponent(sessionId)}`)
              }, 3000)
            }
          } else {
            // Any non-approved outcome = failed, go try again
            setOutcome('failed')
          }
        } catch (err) {
          console.error('[KYC callback]', err)
          setOutcome('failed')
        }
      } catch (err) {
        console.error('[KYC callback] Unexpected error:', err)
        setOutcome('failed')
      }
    }

    resolveOutcome()
  }, [searchParams, isMobileFlow, isCrossDevice, router])

  function Shell({ children }: { children: React.ReactNode }) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-xl sm:p-8">
          {children}
        </div>
      </div>
    )
  }

  // Loading
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

  // Cross-device: user is on phone, desktop is polling
  if (isCrossDevice) {
    return (
      <Shell>
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/5">
          <ShieldCheck className="size-12" />
        </div>
        <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Verification Submitted!
        </h1>
        <p className="mt-2 text-sm font-semibold text-foreground">
          Please return to your laptop or desktop.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Your desktop will automatically detect the result and update your profile. You may safely
          close this window.
        </p>
        <button
          onClick={() => { try { window.close() } catch { /* browser may block */ } }}
          className="mt-6 w-full rounded-xl bg-secondary px-4 py-2.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          Done (Close Window)
        </button>
      </Shell>
    )
  }

  // ── APPROVED ──
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
          {isMobileFlow ? 'Redirecting you to your profile…' : 'You may return to your profile.'}
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

  // ── FAILED (all non-approved outcomes) ──
  return (
    <Shell>
      <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-destructive/15 text-destructive ring-8 ring-destructive/5">
        <AlertCircle className="size-12" />
      </div>
      <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        KYC Unsuccessful
      </h1>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
        We were unable to verify your identity. Please try again — make sure your document is
        clear, valid, and well-lit.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <button
          onClick={() => router.push('/profile')}
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <RefreshCcw className="mr-1.5 inline size-3.5" />
          Try Again
        </button>
      </div>
    </Shell>
  )
}

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
