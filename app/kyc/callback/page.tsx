'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react'

function KycCallbackContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [success, setSuccess] = useState(true)

  const device = searchParams.get('device')
  const isMobileInitiated = device === 'mobile'

  useEffect(() => {
    async function processKycCallback() {
      try {
        const sessionId = searchParams.get('session_id') || searchParams.get('sessionId') || searchParams.get('verificationSessionId')
        const statusParam = (searchParams.get('status') || '').toLowerCase()

        // Show immediate UI feedback based on URL status (cosmetic only)
        // Didit docs warn: DO NOT trust URL params for business logic
        if (statusParam === 'declined' || statusParam === 'rejected' || statusParam === 'failed') {
          setSuccess(false)
          setLoading(false)
          return
        }

        // Server-side verification — this is the ONLY trusted source of truth
        if (sessionId) {
          try {
            const { getAuth } = await import('firebase/auth')
            const auth = getAuth()
            // Wait briefly for auth state to be ready
            await new Promise<void>((resolve) => {
              const unsub = auth.onAuthStateChanged(() => {
                unsub()
                resolve()
              })
            })

            const idToken = await auth.currentUser?.getIdToken()
            if (idToken) {
              const res = await fetch(
                `/api/kyc/status?sessionId=${encodeURIComponent(sessionId)}`,
                { headers: { Authorization: `Bearer ${idToken}` } }
              )
              if (res.ok) {
                const data = await res.json()
                if (data.isRejected) {
                  setSuccess(false)
                } else if (data.isApproved) {
                  setSuccess(true)
                } else {
                  // Still pending — show success UX but server will finalize via webhook
                  setSuccess(true)
                }
              }
            }
          } catch (authErr) {
            console.error('Auth check in callback failed:', authErr)
          }
        }

        if (isMobileInitiated) {
          // Redirect back to profile with session ID for final verification
          const sid = sessionId ? `&sid=${encodeURIComponent(sessionId)}` : ''
          setTimeout(() => {
            router.push(`/profile?kyc=success${sid}`)
          }, 3000)
        }
      } catch (err) {
        console.error('KYC Callback error:', err)
      } finally {
        setLoading(false)
      }
    }

    processKycCallback()
  }, [searchParams, isMobileInitiated, router])

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6 text-center">
        <Loader2 className="size-10 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground font-medium">Finalizing identity verification...</p>
      </div>
    )
  }

  if (!success) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-2xl border border-destructive/30 bg-card p-6 text-center shadow-xl sm:p-8">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertCircle className="size-8" />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
            Verification Unsuccessful
          </h1>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Identity verification could not be completed. Please return to your profile to try again.
          </p>
          <button
            onClick={() => router.push('/profile')}
            className="mt-6 w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Return to Profile
          </button>
        </div>
      </div>
    )
  }

  if (isMobileInitiated) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-2xl border border-success/30 bg-card p-6 text-center shadow-xl sm:p-8">
          <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/5 animate-in zoom-in-50">
            <ShieldCheck className="size-12" />
          </div>

          <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Identity Verification Successful!
          </h1>

          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Redirecting to your profile...
          </p>

          <div className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-success">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Updating your profile & dashboard...</span>
          </div>

          <button
            onClick={() => router.push('/profile?kyc=success')}
            className="mt-6 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            Go to Profile
          </button>
        </div>
      </div>
    )
  }

  // Cross-device QR scan flow (Scanned from Laptop / Desktop)
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-success/30 bg-card p-6 text-center shadow-xl sm:p-8">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/5 animate-in zoom-in-50">
          <ShieldCheck className="size-12" />
        </div>

        <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Verification Complete!
        </h1>

        <p className="mt-3 text-sm font-semibold text-foreground">
          Please return to your laptop or desktop computer.
        </p>

        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          Your laptop screen will automatically detect this verification and update your profile & dashboard. You may safely close this browser window.
        </p>

        <button
          onClick={() => {
            try {
              window.close()
            } catch {
              // Ignore if browser blocks window.close
            }
          }}
          className="mt-6 w-full rounded-xl bg-secondary px-4 py-2.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          Done (Close Window)
        </button>
      </div>
    </div>
  )
}

export default function KycCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background p-6">
          <Loader2 className="size-10 animate-spin text-primary" />
        </div>
      }
    >
      <KycCallbackContent />
    </Suspense>
  )
}
