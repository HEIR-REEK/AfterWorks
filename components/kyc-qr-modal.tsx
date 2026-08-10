'use client'

/**
 * KycQrModal
 *
 * Binary KYC flow:
 *   • PASS  → onVerified() called, modal closes, profile updates to Verified
 *   • FAIL  → onFailed() called, modal shows "Unsuccessful, try again"
 *             User is sent back to profile to start a fresh session
 *
 * Polling runs every 4 seconds for up to MAX_POLL_ATTEMPTS (6 min).
 */

import { useEffect, useState, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ShieldCheck,
  Smartphone,
  CheckCircle2,
  X,
  Loader2,
  ExternalLink,
  AlertCircle,
  RefreshCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

type ModalStatus = 'verifying' | 'approved' | 'failed'

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
  status?: string
}

type KycQrModalProps = {
  isOpen: boolean
  onClose: () => void
  sessionId: string | null
  verificationUrl: string | null
  userId: string | undefined
  /** Called when Didit confirms the user is approved. */
  onVerified: () => void
  /** Called when any non-approved terminal outcome is reached. */
  onFailed?: () => void
}

/** Maximum poll attempts before giving up (6 minutes at 4-second intervals). */
const MAX_POLL_ATTEMPTS = 90

export function KycQrModal({
  isOpen,
  onClose,
  sessionId,
  verificationUrl,
  userId,
  onVerified,
  onFailed,
}: KycQrModalProps) {
  const [modalStatus, setModalStatus] = useState<ModalStatus>('verifying')
  const [phoneConnected, setPhoneConnected] = useState(false)
  const pollCountRef = useRef(0)

  // ── Polling loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !sessionId || !userId) return
    if (modalStatus !== 'verifying') return

    pollCountRef.current = 0

    const interval = setInterval(async () => {
      pollCountRef.current++

      // Timed out → treat as failed
      if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
        clearInterval(interval)
        setModalStatus('failed')
        onFailed?.()
        return
      }

      try {
        const { getAuth } = await import('firebase/auth')
        const auth = getAuth()
        const idToken = await auth.currentUser?.getIdToken()
        if (!idToken) return

        const res = await fetch(
          `/api/kyc/status?sessionId=${encodeURIComponent(sessionId)}&t=${Date.now()}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        )

        if (!res.ok) return // Network hiccup — retry next tick

        const data: StatusApiResponse = await res.json()

        // ── PASS ──────────────────────────────────────────────────────────────
        if (data.isApproved || data.diditApproved) {
          clearInterval(interval)
          setModalStatus('approved')
          onVerified()
          setTimeout(onClose, 2500)
          return
        }

        // ── FAIL (any non-approved terminal outcome) ───────────────────────────
        const isFailed =
          data.isRejected ||
          data.isOnHold ||
          data.needsResubmission ||
          data.diditExpired ||
          data.diditAbandoned

        if (isFailed) {
          clearInterval(interval)
          setModalStatus('failed')
          onFailed?.()
          return
        }

        // Phone has connected (InProgress) — update the indicator
        if (data.status === 'InProgress' && !phoneConnected) {
          setPhoneConnected(true)
        }

        // Otherwise still verifying — keep polling
      } catch (err) {
        console.error('[KycQrModal] Polling error:', err)
      }
    }, 4000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sessionId, userId])

  // Reset when modal reopens
  useEffect(() => {
    if (isOpen) {
      setModalStatus('verifying')
      setPhoneConnected(false)
      pollCountRef.current = 0
    }
  }, [isOpen])

  if (!isOpen || !sessionId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="relative flex w-full max-w-md flex-col items-center rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 sm:p-8">

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </button>

        {/* ── APPROVED ── */}
        {modalStatus === 'approved' && (
          <div className="flex flex-col items-center text-center py-6 animate-in zoom-in-50">
            <div className="flex size-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/5">
              <CheckCircle2 className="size-12" />
            </div>
            <h3 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
              Identity Verified!
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Your verification was successful. Updating your profile…
            </p>
          </div>
        )}

        {/* ── FAILED ── */}
        {modalStatus === 'failed' && (
          <div className="flex flex-col items-center text-center py-4 gap-4 w-full animate-in zoom-in-95">
            <div className="flex size-20 items-center justify-center rounded-full bg-destructive/15 text-destructive ring-8 ring-destructive/5">
              <AlertCircle className="size-12" />
            </div>
            <div>
              <h3 className="text-xl font-bold tracking-tight text-foreground">
                KYC Unsuccessful
              </h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-[280px]">
                We were unable to verify your identity. Please try again — make
                sure your document is clear, unexpired, and well-lit.
              </p>
            </div>
            <Button
              onClick={() => {
                onClose()
                onFailed?.()
              }}
              className="w-full gap-2"
            >
              <RefreshCcw className="size-4" />
              Try Again
            </Button>
          </div>
        )}

        {/* ── VERIFYING (QR + spinner) ── */}
        {modalStatus === 'verifying' && (
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
                {verificationUrl
                  ? 'Scan the QR code with your phone and complete the steps there.'
                  : 'Your verification session is in progress. Please complete it on your phone.'}
              </p>
            </div>

            {/* QR Code or "check your phone" */}
            {verificationUrl ? (
              <div className="mt-5 flex flex-col items-center gap-2 rounded-2xl border border-border bg-muted/30 p-4 shadow-inner">
                <QRCodeSVG
                  value={verificationUrl}
                  size={190}
                  level="M"
                  includeMargin
                  className="rounded-xl border border-border bg-white p-2 shadow-sm"
                />
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Smartphone className="size-3.5 text-primary" />
                  Scan using iPhone or Android camera
                </div>
              </div>
            ) : (
              <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-border bg-muted/30 p-6 shadow-inner text-center">
                <Smartphone className="size-10 text-primary" />
                <p className="text-sm font-medium text-foreground">Check your phone</p>
                <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
                  Open the Didit link you received to continue your verification.
                </p>
              </div>
            )}

            {/* Status indicator */}
            <div className="mt-5 flex flex-col items-center justify-center gap-1 rounded-xl bg-primary/10 px-4 py-3 text-xs font-medium text-primary w-full">
              <div className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                <span className="text-sm font-semibold">
                  {phoneConnected ? 'Verification in progress on phone…' : 'Waiting for verification…'}
                </span>
              </div>
              <span className="text-primary/70 mt-1">
                {phoneConnected
                  ? 'Do not close this window.'
                  : 'This page updates automatically. Keep this window open.'}
              </span>
              {pollCountRef.current > 0 && (
                <span className="text-[10px] text-primary/50 mt-0.5">
                  Checking… ({Math.min(pollCountRef.current, MAX_POLL_ATTEMPTS)}/{MAX_POLL_ATTEMPTS})
                </span>
              )}
            </div>

            {/* Direct link fallback */}
            {verificationUrl && (
              <div className="mt-4 border-t border-border pt-4 w-full text-center">
                <a
                  href={verificationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary hover:underline"
                >
                  <span>Or verify directly on this device</span>
                  <ExternalLink className="size-3" />
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
