'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ShieldCheck,
  Smartphone,
  CheckCircle2,
  X,
  Loader2,
  ExternalLink,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

type KycQrModalProps = {
  isOpen: boolean
  onClose: () => void
  sessionId: string | null
  verificationUrl: string | null
  userId: string | undefined
  onVerified: () => void
}

export function KycQrModal({
  isOpen,
  onClose,
  sessionId,
  verificationUrl,
  userId,
  onVerified,
}: KycQrModalProps) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'failed'>('pending')

  useEffect(() => {
    if (!isOpen || !sessionId || !userId || status === 'approved') return

    setStatus('pending')

    // Poll backend status every 3 seconds to detect when phone completes verification
    const interval = setInterval(async () => {
      try {
        // Get fresh Firebase ID token for authenticated status check
        const { getAuth } = await import('firebase/auth')
        const auth = getAuth()
        const idToken = await auth.currentUser?.getIdToken()
        if (!idToken) return

        const res = await fetch(
          `/api/kyc/status?sessionId=${encodeURIComponent(sessionId)}`,
          { headers: { Authorization: `Bearer ${idToken}` } }
        )
        const data = await res.json()

        if (data.isApproved) {
          setStatus('approved')
          clearInterval(interval)
          onVerified()
          setTimeout(() => {
            onClose()
          }, 2000)
        }
      } catch (err) {
        console.error('KYC Status Polling Error:', err)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [isOpen, sessionId, userId, status, onVerified, onClose])

  if (!isOpen || !verificationUrl) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="relative flex w-full max-w-md flex-col items-center rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 sm:p-8">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </button>

        {status === 'approved' ? (
          <div className="flex flex-col items-center text-center py-6 animate-in zoom-in-50">
            <div className="flex size-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/5">
              <CheckCircle2 className="size-12" />
            </div>
            <h3 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
              Identity Verified!
            </h3>
            <p className="mt-2 text-xs text-muted-foreground">
              Your mobile verification was successful. Updating your profile...
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex flex-col items-center text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="size-6" />
              </div>
              <h3 className="mt-3 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                Identity Verification
              </h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                Please complete verification on your mobile phone.
              </p>
            </div>

            {/* QR Code */}
            <div className="mt-5 flex flex-col items-center gap-2 rounded-2xl border border-border bg-muted/30 p-4 shadow-inner">
              <QRCodeSVG
                value={verificationUrl}
                size={190}
                level="M"
                includeMargin={true}
                className="rounded-xl border border-border bg-white p-2 shadow-sm"
              />
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Smartphone className="size-3.5 text-primary" />
                Scan using iPhone or Android camera
              </div>
            </div>

            {/* Polling Status Indicator */}
            <div className="mt-5 flex flex-col items-center justify-center gap-1 rounded-xl bg-primary/10 px-4 py-3 text-xs font-medium text-primary">
              <div className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                <span className="text-sm font-semibold">Waiting for verification...</span>
              </div>
              <span className="text-primary/70 mt-1">This page will update automatically.</span>
            </div>

            {/* Fallback Direct Link */}
            <div className="mt-4 border-t border-border pt-4 w-full text-center">
              <a
                href={verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:underline transition-colors"
              >
                <span>Or verify directly on this laptop</span>
                <ExternalLink className="size-3" />
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
