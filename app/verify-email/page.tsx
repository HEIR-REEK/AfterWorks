'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, MailCheck, RefreshCw, ShieldCheck, UserCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLockup } from '@/components/brand'
import { useAuth } from '@/components/firebase-auth-provider'
import { apiFetch, describeError } from '@/lib/client-api'

type Phase = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'error'

function Step({ n, label, state }: { n: number; label: string; state: 'done' | 'current' | 'todo' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={
          state === 'done'
            ? 'flex size-6 items-center justify-center rounded-full bg-success text-success-foreground'
            : state === 'current'
              ? 'flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold'
              : 'flex size-6 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground'
        }
      >
        {state === 'done' ? <CheckCircle2 className="size-4" /> : n}
      </span>
      <span className={state === 'todo' ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>{label}</span>
    </div>
  )
}

function VerifyEmailInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading, configured, resendVerification, reloadUser, signOut } = useAuth()

  const token = searchParams.get('token')
  const justSent = searchParams.get('sent') === '1'

  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : justSent ? 'sent' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [resendNote, setResendNote] = useState<string | null>(null)
  const consumed = useRef(false)

  const consume = useCallback(async (value: string) => {
    setPhase('verifying')
    setError(null)
    try {
      await apiFetch('/api/auth/verify-email', { method: 'POST', body: { token: value } })
      await reloadUser()
      setPhase('verified')
    } catch (err) {
      setPhase('error')
      setError(describeError(err))
    }
  }, [reloadUser])

  useEffect(() => {
    if (!token || consumed.current) return
    consumed.current = true
    void consume(token)
  }, [token, consume])

  // The worker often clicks the mail on their phone. This tab notices when Auth flips.
  useEffect(() => {
    if (loading || !user || user.emailVerified || phase === 'verifying') return
    const tick = async () => {
      await reloadUser()
    }
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void tick()
    }, 5000)
    return () => clearInterval(id)
  }, [loading, user, phase, reloadUser])

  useEffect(() => {
    if (user?.emailVerified && phase !== 'verified') setPhase('verified')
  }, [user, phase])

  async function handleResend() {
    setPhase('sending')
    setError(null)
    setResendNote(null)
    const result = await resendVerification()
    if (result.ok) {
      setPhase('sent')
      setResendNote(result.alreadyVerified ? 'This address is already verified.' : 'Verification email sent. Check your inbox and spam folder.')
    } else {
      setPhase('error')
      setError(result.error ?? 'Could not send the email.')
    }
  }

  const verified = phase === 'verified' || Boolean(user?.emailVerified)
  const email = user?.email || ''

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandLockup width={210} className="mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {verified ? 'Email verified' : 'Verify your email'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          {verified
            ? 'Your inbox is confirmed. Next, complete your profile and identity check.'
            : 'We need a real inbox before you can update your profile or start KYC.'}
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
        <Step n={1} label="Create account" state="done" />
        <Step n={2} label="Verify email" state={verified ? 'done' : 'current'} />
        <Step n={3} label="Complete profile" state="todo" />
        <Step n={4} label="Identity verification" state="todo" />
      </div>

      {phase === 'verifying' && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-4 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" />
          Confirming your email…
        </div>
      )}

      {verified && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>{email || 'Your email'}</strong> is verified. You can now set up your profile and start identity verification.
            </span>
          </div>
          {user ? (
            <Button size="lg" className="w-full" onClick={() => router.push('/profile?new=1')}>
              <UserCircle className="size-4" />
              Continue to profile
            </Button>
          ) : (
            <Button size="lg" className="w-full" onClick={() => router.push('/sign-in?verified=1')}>
              Sign in to continue
            </Button>
          )}
        </div>
      )}

      {!verified && phase !== 'verifying' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
            <MailCheck className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Check your inbox</p>
              <p className="mt-0.5 text-xs opacity-90">
                {email ? (
                  <>
                    We sent a verification link to <strong>{email}</strong>. Open it to unlock profile setup and KYC.
                  </>
                ) : (
                  <>Sign in with the account you just created so we can send the link to the right inbox.</>
                )}
              </p>
            </div>
          </div>

          {resendNote && (
            <p className="text-xs font-medium text-success">{resendNote}</p>
          )}
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          {user ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              disabled={phase === 'sending' || !configured}
              onClick={handleResend}
            >
              {phase === 'sending' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {phase === 'sending' ? 'Sending…' : 'Resend verification email'}
            </Button>
          ) : (
            <Button size="lg" className="w-full" onClick={() => router.push('/sign-in')}>
              Sign in to resend
            </Button>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Wrong address?{' '}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={async () => {
                await signOut()
                router.push('/sign-up')
              }}
            >
              Create a different account
            </button>
          </p>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" />
        Disposable inboxes are blocked. The link expires and can be used once.
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  )
}
