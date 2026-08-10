'use client'

/**
 * KycQrModal
 *
 * Shown on desktop when the user initiates a cross-device KYC flow.
 * The user scans the QR code with their phone, completes verification there,
 * and this modal polls the server every 4 seconds to detect completion.
 *
 * ── Polling behaviour ────────────────────────────────────────────────────────
 *  • Polls every 4 seconds for up to MAX_POLL_ATTEMPTS (90 × 4 s = 6 minutes).
 *  • Stops early on any terminal outcome (approved, declined, expired, etc.).
 *  • After timeout, switches to a "session expired / timed out" UI.
 *
 * ── Modal states ─────────────────────────────────────────────────────────────
 *  pending        → QR code + spinner (waiting)
 *  approved       → Success checkmark + auto-close
 *  declined       → Error screen + retry CTA
 *  resubmission   → Warning screen + retry CTA
 *  on_hold        → Info screen (manual review)
 *  expired        → Neutral screen (session timed out)
 *  timed_out      → Neutral screen (polling limit reached)
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
  Clock,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

type ModalStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'resubmission'
  | 'on_hold'
  | 'expired'
  | 'timed_out'

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

type KycQrModalProps = {
  isOpen: boolean
  onClose: () => void
  sessionId: string | null
  verificationUrl: string | null
  userId: string | undefined
  /** Called when Didit confirms the user is approved. */
  onVerified: () => void
  /** Optional: called when a non-approved terminal state is reached. */
  onFailed?: (reason: 'declined' | 'resubmission' | 'on_hold' | 'expired' | 'timed_out') => void
}

/** Maximum number of poll attempts before giving up (6 minutes at 4-second intervals). */
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
  const [modalStatus, setModalStatus] = useState<ModalStatus>('pending')
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [failedChecks, setFailedChecks] = useState<string[] | null>(null)
  const pollCountRef = useRef(0)

  // ── Polling loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !sessionId || !userId) return
    if (modalStatus !== 'pending') return

    pollCountRef.current = 0

    const interval = setInterval(async () => {
      pollCountRef.current++

      // Bail out if we've been polling too long
      if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
        clearInterval(interval)
        setModalStatus('timed_out')
        onFailed?.('timed_out')
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

        if (data.rejectionReason) setRejectionReason(data.rejectionReason)
        if (data.failedChecks?.length) setFailedChecks(data.failedChecks)

        // ── Terminal states ────────────────────────────────────────────────
        if (data.isApproved || data.diditApproved) {
          clearInterval(interval)
          setModalStatus('approved')
          onVerified()
          setTimeout(onClose, 2500)
          return
        }

        if (data.isRejected) {
          clearInterval(interval)
          setModalStatus('declined')
          onFailed?.('declined')
          return
        }

        if (data.needsResubmission) {
          clearInterval(interval)
          setModalStatus('resubmission')
          onFailed?.('resubmission')
          return
        }

        if (data.isOnHold) {
          clearInterval(interval)
          setModalStatus('on_hold')
          onFailed?.('on_hold')
          return
        }

        if (data.diditExpired || data.diditAbandoned) {
          clearInterval(interval)
          setModalStatus('expired')
          onFailed?.('expired')
          return
        }

        // Still pending / in-progress — continue polling
      } catch (err) {
        console.error('[KycQrModal] Polling error:', err)
      }
    }, 4000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sessionId, userId, modalStatus])

  // Reset when modal reopens
  useEffect(() => {
    if (isOpen) {
      setModalStatus('pending')
      setRejectionReason(null)
      setFailedChecks(null)
      pollCountRef.current = 0
    }
  }, [isOpen])

  if (!isOpen || !verificationUrl) return null

  // ── Overlay / container ──────────────────────────────────────────────────────
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

        {/* ── Approved ── */}
        {modalStatus === 'approved' && (
          <div className="flex flex-col items-center text-center py-6 animate-in zoom-in-50">
            <div className="flex size-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/5">
              <CheckCircle2 className="size-12" />
            </div>
            <h3 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
              Identity Verified!
            </h3>
            <p className="mt-2 text-xs text-muted-foreground">
              Your mobile verification was successful. Updating your profile…
            </p>
          </div>
        )}

        {/* ── Declined ── */}
        {modalStatus === 'declined' && (
          <div className="flex flex-col items-center text-center py-4 gap-3 w-full">
            <div className="flex size-16 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <AlertCircle className="size-8" />
            </div>
            <h3 className="text-xl font-bold tracking-tight text-foreground">
              Verification Failed
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We were unable to verify your identity.
            </p>
            {rejectionReason && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive w-full text-left">
                Reason: {rejectionReason}
              </p>
            )}
            {failedChecks && failedChecks.length > 0 && (
              <ul className="w-full space-y-1 text-left text-xs text-muted-foreground">
                {failedChecks.map((c) => (
                  <li key={c} className="flex items-center gap-1.5">
                    <AlertCircle className="size-3 shrink-0 text-destructive" />
                    {c.replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>
            )}
            <Button onClick={onClose} className="mt-2 w-full gap-1.5">
              <RefreshCcw className="size-3.5" />
              Try Again
            </Button>
          </div>
        )}

        {/* ── Resubmission required ── */}
        {modalStatus === 'resubmission' && (
          <div className="flex flex-col items-center text-center py-4 gap-3 w-full">
            <div className="flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
              <RefreshCcw className="size-8" />
            </div>
            <h3 className="text-xl font-bold tracking-tight text-foreground">
              More Information Needed
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Some verification steps need to be completed again.
            </p>
            {rejectionReason && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning w-full text-left">
                {rejectionReason}
              </p>
            )}
            <Button onClick={onClose} className="mt-2 w-full gap-1.5">
              <RefreshCcw className="size-3.5" />
              Resubmit Verification
            </Button>
          </div>
        )}

        {/* ── On hold ── */}
        {modalStatus === 'on_hold' && (
          <div className="flex flex-col items-center text-center py-4 gap-3 w-full">
            <div className="flex size-16 items-center justify-center rounded-full bg-blue-500/15 text-blue-500">
              <Info className="size-8" />
            </div>
            <h3 className="text-xl font-bold tracking-tight text-foreground">Under Review</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your verification is being reviewed by our compliance team. This usually takes 1–2
              business days. No action is needed from you right now.
            </p>
            <Button variant="outline" onClick={onClose} className="mt-2 w-full">
              Close
            </Button>
          </div>
        )}

        {/* ── Expired ── */}
        {(modalStatus === 'expired' || modalStatus === 'timed_out') && (
          <div className="flex flex-col items-center text-center py-4 gap-3 w-full">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Clock className="size-8" />
            </div>
            <h3 className="text-xl font-bold tracking-tight text-foreground">
              {modalStatus === 'timed_out' ? 'Check Timed Out' : 'Session Expired'}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {modalStatus === 'timed_out'
                ? 'We stopped checking for updates. Please refresh your profile to see if your verification was recorded, or start a new session.'
                : 'Your verification session expired before it was completed. Please start a new session from your profile.'}
            </p>
            <Button onClick={onClose} className="mt-2 w-full gap-1.5">
              <RefreshCcw className="size-3.5" />
              Start New Session
            </Button>
          </div>
        )}

        {/* ── Pending (QR code + spinner) ── */}
        {modalStatus === 'pending' && (
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
                Scan the QR code with your phone and complete the verification steps there.
              </p>
            </div>

            {/* QR Code */}
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

            {/* Polling status indicator */}
            <div className="mt-5 flex flex-col items-center justify-center gap-1 rounded-xl bg-primary/10 px-4 py-3 text-xs font-medium text-primary w-full">
              <div className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                <span className="text-sm font-semibold">Waiting for verification…</span>
              </div>
              <span className="text-primary/70 mt-1">
                This page updates automatically. Keep this window open.
              </span>
              {pollCountRef.current > 0 && (
                <span className="text-[10px] text-primary/50 mt-0.5">
                  Checking… ({Math.min(pollCountRef.current, MAX_POLL_ATTEMPTS)}/{MAX_POLL_ATTEMPTS})
                </span>
              )}
            </div>

            {/* Fallback direct link */}
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
          </>
        )}
      </div>
    </div>
  )
}
