'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CheckCircle2,
  Info,
  Loader2,
  LogIn,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  UserCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLockup } from '@/components/brand'
import { useAuth } from '@/components/firebase-auth-provider'
import { apiFetch, describeError } from '@/lib/client-api'

type Phase = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'error'

/**
 * What the server said when the link was consumed.
 *
 * `email` is the address the link was *issued for* — not the address of whoever happens to be
 * signed in in this browser. Keeping them apart in the type is what stops the page from ever
 * saying "your email is verified" beside the wrong inbox.
 */
type VerifyResult = {
  ok: true
  verified: true
  alreadyVerified?: boolean
  email: string
  /** null = the browser sent no session, so the page cannot say either way. */
  sessionMatches?: boolean | null
  signedInEmail?: string | null
}

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
  const { user, loading, configured, resendVerification, reloadUser, signOut, getIdToken } = useAuth()

  const token = searchParams.get('token')
  const justSent = searchParams.get('sent') === '1'

  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : justSent ? 'sent' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [resendNote, setResendNote] = useState<string | null>(null)
  /** The address the link was issued for, once the server has told us. */
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null)
  /**
   * Whether *this browser* is signed in as the account the link belongs to. `null` until the
   * server answers, and `false` is a first-class outcome, not an error: the member verified on
   * their phone, and the laptop in front of them is holding somebody else's account.
   */
  const [sessionMatches, setSessionMatches] = useState<boolean | null>(null)
  const consumed = useRef(false)

  const consume = useCallback(async (value: string) => {
    setPhase('verifying')
    setError(null)
    try {
      // Send *this browser's* session when there is one. The link is the credential and the call
      // succeeds without a token, but the server can only tell us "that is not the account you
      // are signed in as" if we tell it who we are — and that answer is what keeps the page from
      // offering to continue into somebody else's account.
      const session = await getIdToken()
      const result = await apiFetch<VerifyResult>('/api/auth/verify-email', {
        method: 'POST',
        body: { token: value },
        ...(session ? { token: session } : {}),
      })
      setVerifiedEmail(result.email ?? null)
      setSessionMatches(typeof result.sessionMatches === 'boolean' ? result.sessionMatches : null)
      await reloadUser()
      setPhase('verified')
    } catch (err) {
      setPhase('error')
      setError(describeError(err))
    }
  }, [reloadUser, getIdToken])

  useEffect(() => {
    if (!token || consumed.current) return
    consumed.current = true
    void consume(token)
  }, [token, consume])

  // The worker often clicks the mail on their phone. This tab notices when Auth flips.
  // Only for the no-token case: with a link in hand the consume above is the source of truth, and
  // polling would just re-refresh an ID token every few seconds for a page that already has its
  // answer.
  useEffect(() => {
    if (token) return
    if (loading || !user || user.emailVerified || phase === 'verifying') return
    const tick = async () => {
      await reloadUser()
    }
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void tick()
    }, 5000)
    return () => clearInterval(id)
  }, [loading, user, phase, reloadUser, token])

  // A verified session, with no link in the URL, is a verified session for *that* address.
  useEffect(() => {
    if (token) return
    if (user?.emailVerified && phase !== 'verified') setPhase('verified')
  }, [user, phase, token])

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

  // Which address the page is talking about. With a link, that is the address in the link; with
  // no link, it is whoever is signed in here.
  const signedInEmail = (user?.email ?? '').toLowerCase()
  const subjectEmail = verifiedEmail ?? (token ? null : signedInEmail || null)
  const verified = phase === 'verified' && Boolean(subjectEmail)
  // "Is the account in this browser the account the link just verified?"
  //
  // The server's answer is the authority, but it is `null` whenever it could not read a session —
  // and "I could not check" must never be rounded up to "they are the same person". So the
  // fallback compares the two addresses directly, and the *absence* of a signed-in account is
  // never treated as a match.
  const accountsMatch = sessionMatches ?? subjectEmail === signedInEmail
  const sameAccount = verified && accountsMatch
  // "The account this browser is holding is not the account the link just verified."
  const crossedAccounts = verified && !accountsMatch && Boolean(signedInEmail)

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandLockup width={210} className="mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {verified ? 'Email verified' : 'Verify your email'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          {verified
            ? crossedAccounts
              ? 'The link worked. Sign in to the account it belongs to and carry on there.'
              : 'Your inbox is confirmed. Next, complete your profile and identity check.'
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
              <strong>{subjectEmail || 'That address'}</strong> is verified. You can now set up the profile and start
              identity verification.
            </span>
          </div>

          {crossedAccounts ? (
            // The link was opened on a device that was signed in as somebody else. Saying
            // "continue to profile" here would drop the member into the *other* account's
            // dashboard and read, to both of them, as though this verification had been that
            // account's.
            <>
              <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
                <Info className="mt-0.5 size-4 shrink-0" />
                <span>
                  You are signed in here as <strong>{signedInEmail || 'a different account'}</strong>. This link
                  verified <strong>{subjectEmail}</strong> — nothing about the account you are signed in as has
                  changed. Sign in as the verified address to continue.
                </span>
              </div>
              <Button
                size="lg"
                className="w-full"
                onClick={async () => {
                  await signOut()
                  router.push(`/sign-in?verified=1&email=${encodeURIComponent(subjectEmail ?? '')}`)
                }}
              >
                <LogIn className="size-4" />
                Sign in as {subjectEmail}
              </Button>
            </>
          ) : user && sameAccount ? (
            <Button size="lg" className="w-full" onClick={() => router.push('/profile?new=1')}>
              <UserCircle className="size-4" />
              Continue to profile
            </Button>
          ) : (
            <Button size="lg" className="w-full" onClick={() => router.push(`/sign-in?verified=1&email=${encodeURIComponent(subjectEmail ?? '')}`)}>
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
                {signedInEmail ? (
                  <>
                    We sent a verification link to <strong>{signedInEmail}</strong>. Open it to unlock profile setup
                    and KYC.
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
