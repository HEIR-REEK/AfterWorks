'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Eye,
  EyeOff,
  MailCheck,
  RefreshCw,
  Gift,
  Clock3,
} from 'lucide-react'
import { Button } from './ui/button'
import { useAuth } from './firebase-auth-provider'
import { BrandLockup } from '@/components/brand'
import { validateEmailAddress } from '@/lib/email-validation'
import { REFERRAL_BONUS_LABEL, normaliseReferralCode } from '@/lib/referrals'
import { TERMS_VERSION, privacyHref, termsHref } from '@/lib/terms'
import { cn } from '@/lib/utils'

// ─── Email-not-verified banner with resend ─────────────────────────────────────

function UnverifiedEmailBanner({ email }: { email: string }) {
  const { resendVerification } = useAuth()
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [resendError, setResendError] = useState<string | null>(null)

  async function handleResend() {
    setResendState('sending')
    setResendError(null)
    const result = await resendVerification()
    if (result.ok) {
      setResendState('sent')
    } else {
      setResendState('error')
      setResendError(result.error ?? null)
    }
  }

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
      <div className="flex items-start gap-2.5">
        <MailCheck className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0">
          <p className="font-semibold">Email not verified</p>
          <p className="mt-0.5 text-xs opacity-90">
            We sent a verification link to <strong>{email}</strong>. Click it to activate your
            account, then sign in here.
          </p>
        </div>
      </div>

      {resendState === 'sent' ? (
        <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
          <CheckCircle2 className="size-3.5 shrink-0" />
          Verification email sent! Check your inbox (and spam folder).
        </div>
      ) : (
        <button
          type="button"
          onClick={handleResend}
          disabled={resendState === 'sending'}
          className="flex items-center gap-1.5 self-start rounded-md border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:opacity-60 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
        >
          {resendState === 'sending' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {resendState === 'sending' ? 'Sending…' : 'Resend verification email'}
        </button>
      )}

      {resendState === 'error' && resendError && (
        <p className="text-xs text-red-600 dark:text-red-400">{resendError}</p>
      )}
    </div>
  )
}

// ─── Inner form (must be inside Suspense because of useSearchParams) ───────────

function AuthFormInner({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { signIn, signUp, signInWithGoogle, configured } = useAuth()

  const [name, setName] = useState('')
  // Pre-filled when the page is reached from a verification link (`?email=`), so a member who
  // verified on another device does not have to retype the address to sign in as the account that
  // was verified. It is a URL value, so it goes through the same validator as anything typed here
  // before it is allowed near the input.
  const [email, setEmail] = useState(() => {
    const hint = searchParams.get('email')?.trim() ?? ''
    return hint && !validateEmailAddress(hint) ? hint : ''
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [emailFieldError, setEmailFieldError] = useState<string | null>(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)
  const [touchedAccept, setTouchedAccept] = useState(false)

  const isSignUp = mode === 'sign-up'

  /**
   * Both boxes are required before an account may be created — and the button is *blurred*, not
   * just disabled, because a disabled button on a form people have already filled in reads as a
   * broken page. The blur says "there is one more thing", and the text underneath says what.
   *
   * This is a UI gate, deliberately. The real enforcement that matters is the acceptance record
   * written by `POST /api/auth/terms` and the referral rules enforced on the server.
   */
  const canCreate = !isSignUp || (acceptedTerms && acceptedPrivacy)
  const showAcceptHint = isSignUp && touchedAccept && !canCreate

  // The referral code is in the URL when somebody shared their link with this member. Shown here
  // so nobody is surprised later that a name is attached to their signup.
  const incomingReferral = normaliseReferralCode(searchParams.get('ref'))
  // Show a success banner on sign-in page when coming from sign-up or after verifying
  const justRegistered = !isSignUp && searchParams.get('registered') === '1'

  /**
   * Sign-in failures need to point somewhere.
   *
   * Firebase deliberately reports "wrong password" and "no account" with the same code
   * (`auth/invalid-credential`) so an attacker cannot enumerate addresses. The member does not care
   * about that nuance — they care about *their* one account — so the copy covers both possibilities
   * and offers the fix for each: retry, reset the password, or create the account that is missing.
   */
  const credentialFailure =
    !isSignUp && ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(errorCode ?? '')
  const accountExistsFailure = isSignUp && errorCode === 'auth/email-already-in-use'
  const accountMissingFailure = !isSignUp && errorCode === 'auth/user-not-found'
  // Google tried to register a stranger on the sign-in page; the session was dropped, not admitted.
  const googleNeedsAccount = !isSignUp && errorCode === 'auth/account-created-instead-of-signed-in'
  const justVerified = !isSignUp && searchParams.get('verified') === '1'
  const justReset = !isSignUp && searchParams.get('reset') === '1'
  // The idle guard signs people out and drops them back here. Say why, or the reload looks like
  // the site decided to log them out for no reason.
  const idleSignOut = !isSignUp && searchParams.get('reason') === 'idle'

  function handleEmailChange(value: string) {
    setEmail(value)
    // Re-validate on change once an error has been shown
    if (emailFieldError) setEmailFieldError(validateEmailAddress(value))
  }

  function handleEmailBlur() {
    if (email) setEmailFieldError(validateEmailAddress(email))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setErrorCode(null)

    // Belt to the button's braces: the form cannot be submitted without both acceptances even if
    // something (a stale bundle, an autofill, a scripted click) gets past the disabled attribute.
    if (isSignUp && !(acceptedTerms && acceptedPrivacy)) {
      setTouchedAccept(true)
      setError('Please accept the Terms & Conditions and the Privacy Notice to create your account.')
      return
    }

    // Client-side email gate (blocks disposable/fake domains instantly)
    const emailErr = validateEmailAddress(email)
    if (emailErr) {
      setEmailFieldError(emailErr)
      return
    }

    setSubmitting(true)
    const result = isSignUp
      ? await signUp(email.trim(), password, name.trim())
      : await signIn(email.trim(), password)
    setSubmitting(false)

    if (result.ok) {
      if ('needsEmailVerification' in result && result.needsEmailVerification) {
        router.push('/verify-email?sent=1')
        router.refresh()
      } else if ('isNewUser' in result && result.isNewUser) {
        router.push('/profile?new=1')
        router.refresh()
      } else {
        router.push('/')
        router.refresh()
      }
    } else {
      setError(result.error)
      if (!result.ok && 'code' in result) setErrorCode(result.code ?? null)
    }
  }

  async function handleGoogleSignIn() {
    setError(null)
    setErrorCode(null)
    if (isSignUp && !(acceptedTerms && acceptedPrivacy)) {
      setTouchedAccept(true)
      setError('Please accept the Terms & Conditions and the Privacy Notice before continuing with Google.')
      return
    }
    setSubmitting(true)
    // Sign-up may create an account; sign-in may only admit an existing one.
    const result = await signInWithGoogle({ allowSignUp: isSignUp })
    setSubmitting(false)
    if (result.ok) {
      if ('needsEmailVerification' in result && result.needsEmailVerification) {
        router.push('/verify-email?sent=1')
        router.refresh()
      } else if ('isNewUser' in result && result.isNewUser) {
        router.push('/profile?new=1')
        router.refresh()
      } else {
        router.push('/')
        router.refresh()
      }
    } else {
      setError(result.error)
      setErrorCode(result.code ?? null)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandLockup width={210} className="mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {isSignUp ? 'Create your AfterWorks account' : 'Welcome back to AfterWorks'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          {isSignUp
            ? 'Join verified workers earning from real, paid microwork.'
            : 'Sign in to browse jobs, track applications, and get paid.'}
        </p>
      </div>

      {/* Show success message after sign-up redirect */}
      {justRegistered && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
          <span>
            <strong>Account created!</strong> Check your inbox for the AfterWorks verification
            link, then come back here to sign in.
          </span>
        </div>
      )}
      {justVerified && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
          <span>
            <strong>Email verified.</strong> Sign in to complete your profile and identity check.
          </span>
        </div>
      )}
      {justReset && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
          <span>
            <strong>Password updated.</strong> Sign in with your new password — other devices were signed out.
          </span>
        </div>
      )}

      {idleSignOut && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <strong>You were signed out.</strong> AfterWorks closes a session that sits idle for 10 minutes, so a
            device left unattended cannot keep anyone&apos;s account open. Sign in again to carry on where you left
            off — nothing was lost.
          </span>
        </div>
      )}

      {!configured && (
        <div className="mb-5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          Firebase is not fully configured yet. Add your Firebase web config
          (apiKey, authDomain, projectId, appId) to enable sign in.
        </div>
      )}

      {/* Somebody shared their referral link with this member. Said up front, and said exactly
          what it does and when the money moves — a referral nobody asked for is a bad surprise. */}
      {isSignUp && incomingReferral && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/[0.07] px-4 py-3 text-sm">
          <Gift className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="text-muted-foreground">
            You were invited with code <strong className="font-mono text-foreground">{incomingReferral}</strong>. Finish
            your profile and they will get {REFERRAL_BONUS_LABEL} added to their balance. It costs you nothing.
          </span>
        </div>
      )}

      {/* Email-not-verified banner with one-click resend */}
      {errorCode === 'email-not-verified' && <UnverifiedEmailBanner email={email} />}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {isSignUp && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Full name
            </label>
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Amina Otieno"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => handleEmailChange(e.target.value)}
            onBlur={handleEmailBlur}
            className={`h-11 rounded-lg border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              emailFieldError
                ? 'border-destructive focus-visible:ring-destructive/30'
                : 'border-input'
            }`}
            placeholder="you@example.com"
          />
          {emailFieldError && (
            <p className="text-xs font-medium text-destructive">{emailFieldError}</p>
          )}
          {isSignUp && !emailFieldError && (
            <p className="text-xs text-muted-foreground">
              Use a real inbox — we send a verification link before you can update your profile or
              start KYC. Disposable addresses are not allowed.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            {!isSignUp && (
              <Link
                href={email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : '/forgot-password'}
                className="text-xs font-medium text-primary hover:underline"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-card pl-3 pr-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={isSignUp ? 'At least 6 characters' : 'Your password'}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              <span className="sr-only">{showPassword ? 'Hide password' : 'Show password'}</span>
            </button>
          </div>
        </div>

        {/* Only show the generic error when it isn't the verification-specific one (that has its own banner) */}
        {error && errorCode !== 'email-not-verified' && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-3.5 py-3 text-sm">
            <p className="font-medium text-destructive">{error}</p>
            {credentialFailure && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {accountMissingFailure
                  ? 'No AfterWorks account uses this address.'
                  : 'This password does not match — or the account does not exist yet.'}{' '}
                Check the spelling,{' '}
                <Link
                  href={email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : '/forgot-password'}
                  className="font-medium text-primary hover:underline"
                >
                  reset your password
                </Link>
                , or{' '}
                <Link href="/sign-up" className="font-medium text-primary hover:underline">
                  create an account
                </Link>{' '}
                — it takes a minute.
              </p>
            )}
            {googleNeedsAccount && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Nothing was created and you are not signed in. Use{' '}
                <Link href="/sign-up" className="font-medium text-primary hover:underline">
                  Create an account
                </Link>{' '}
                with the same Google button, or sign in with the email and password you registered.
              </p>
            )}
            {accountExistsFailure && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Sign in with your existing account instead, or{' '}
                <Link
                  href={email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : '/forgot-password'}
                  className="font-medium text-primary hover:underline"
                >
                  reset its password
                </Link>
                . Your AfterWorks account and its balance are tied to this address, so a second account is never created for it.
              </p>
            )}
            {errorCode && (
              <p className="mt-1.5 font-mono text-[11px] font-normal text-muted-foreground">Error code: {errorCode}</p>
            )}
          </div>
        )}

        {/* ── Terms & Privacy acceptance ───────────────────────────────────────
            Placed directly above the button it gates, so the thing being asked for and the
            thing being withheld are adjacent rather than at the bottom of a scroll. */}
        {isSignUp && (
          <div className="mt-1 flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Before you create your account
            </p>

            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
              />
              <span className="text-muted-foreground">
                I have read and agree to the{' '}
                <Link href={termsHref()} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                  Terms &amp; Conditions
                </Link>
                , including the referral program rules.
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={acceptedPrivacy}
                onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
              />
              <span className="text-muted-foreground">
                I have read and agree to the{' '}
                <Link href={privacyHref()} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                  Privacy Notice
                </Link>{' '}
                — how AfterWorks stores and uses my data.
              </span>
            </label>

            <p className={cn('text-[11px] leading-relaxed', showAcceptHint ? 'text-warning' : 'text-muted-foreground')}>
              {showAcceptHint
                ? 'Tick both boxes to enable the Create account button.'
                : `Version ${TERMS_VERSION} · one email address and one phone number per account.`}
            </p>
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={submitting || !configured || !canCreate}
          aria-disabled={!canCreate}
          className={cn(
            'mt-1 transition-all',
            // The blur is the whole point: the button is visibly *there* and visibly *not ready*,
            // instead of being a dead control with no explanation.
            isSignUp && !canCreate && 'cursor-not-allowed opacity-55 blur-[2.5px] saturate-50',
          )}
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {isSignUp ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <div className="my-6 flex items-center">
        <div className="flex-1 border-t border-border"></div>
        <span className="px-3 text-xs text-muted-foreground uppercase tracking-wider">or</span>
        <div className="flex-1 border-t border-border"></div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="lg"
        // Held back on sign-up for the same reason the submit button is: Google can create an
        // account, so it is an account-creation path and it owes the same acceptance.
        disabled={submitting || !configured || !canCreate}
        aria-disabled={!canCreate}
        onClick={handleGoogleSignIn}
        className={cn(
          'relative w-full bg-card hover:bg-muted',
          isSignUp && !canCreate && 'cursor-not-allowed opacity-55 blur-[2.5px] saturate-50',
        )}
      >
        <svg className="absolute left-4 size-5" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </Button>

      {isSignUp && !canCreate && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Tick the two boxes above to continue — your account is created once you accept.
        </p>
      )}

      {!isSignUp && (
        <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
          Google sign-in only admits accounts that already exist. First time here? Use{' '}
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
          .
        </p>
      )}

      {!isSignUp && (
        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
          AfterWorks has no guest access: an account is created once, with the email you verify, and
          everything you earn stays attached to it.
        </p>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignUp ? (
          <>
            Already have an account?{' '}
            <Link href="/sign-in" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to AfterWorks?{' '}
            <Link href="/sign-up" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>

      {/* No link to the operations console here, or anywhere else a member can see: the console
          address is not something the member app advertises. Staff sign in from a bookmark. */}
      <div className="mt-8 flex flex-col items-center gap-2.5 text-center text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-success" />
          Your data is protected. AfterWorks never charges to apply.
        </div>
      </div>
    </div>
  )
}

// Wrap in Suspense because useSearchParams requires it in Next.js App Router
export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const isSignUp = mode === 'sign-up'
  const title = isSignUp ? 'Create your AfterWorks account' : 'Welcome back to AfterWorks'
  const subtitle = isSignUp
    ? 'Join verified workers earning from real, paid microwork.'
    : 'Sign in to browse jobs, track applications, and get paid.'

  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
          <div className="mb-8 flex flex-col items-center text-center">
            <BrandLockup width={210} className="mb-4" />
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground text-pretty">{subtitle}</p>
          </div>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      }
    >
      <AuthFormInner mode={mode} />
    </Suspense>
  )
}
