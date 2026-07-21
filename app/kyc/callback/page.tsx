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
        const sessionToken = searchParams.get('session_token') || searchParams.get('sessionToken') || searchParams.get('token')
        const statusParam = searchParams.get('status')
        const vendorData = searchParams.get('vendor_data') || searchParams.get('userId')

        // If status is explicit decline
        if (statusParam === 'Declined' || statusParam === 'Rejected') {
          setSuccess(false)
          setLoading(false)
          return
        }

        // Send status check/update to backend
        if (sessionToken && vendorData) {
          await fetch(`/api/kyc/status?sessionToken=${sessionToken}&userId=${vendorData}`).catch(() => {})
        }

        if (isMobileInitiated) {
          setTimeout(() => {
            router.push('/profile?kyc=success')
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
            Identity verification could not be completed. Please return to your original device to try again.
          </p>
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
            Identity verification completed successfully.
          </h1>

          <p className="mt-3 text-sm font-semibold text-muted-foreground">
            Redirecting you back to the application...
          </p>

          <button
            onClick={() => router.push('/profile?kyc=success')}
            className="mt-6 w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to Profile
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-success/30 bg-card p-6 text-center shadow-xl sm:p-8">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/5 animate-in zoom-in-50">
          <ShieldCheck className="size-12" />
        </div>

        <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Identity verification completed successfully.
        </h1>

        <p className="mt-3 text-sm font-semibold text-muted-foreground">
          Please return to your original device.
        </p>

        <p className="mt-1 text-xs text-muted-foreground/80">
          Your account will update automatically.
        </p>
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
