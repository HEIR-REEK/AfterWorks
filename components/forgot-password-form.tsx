'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLockup } from '@/components/brand'
import { apiFetch, describeError, errorCode, type ApiError } from '@/lib/client-api'
import { validateEmailAddress } from '@/lib/email-validation'

/**
 * Forgot password — three screens on one route so the browser back button never strands a
 * half-finished reset:
 *
 *   1. email      → POST { step: 'request' }   (always "if an account exists…")
 *   2. code       → POST { step: 'verify' }    (six digits, attempts counted server-side)
 *   3. password   → POST { step: 'complete' }  (ticket from step 2, never the code again)
 *
 * The ticket lives in component state only. A page refresh drops it, which is the right failure
 * mode for a credential that should not be cached anywhere.
 */

type Phase = 'email' | 'code' | 'password' | 'done'

const CODE_LENGTH = 6
const inputClass =
  'h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

function Step({ n, label, state }: { n: number; label: string; state: 'done' | 'current' | 'todo' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={
          state === 'done'
            ? 'flex size-6 items-center justify-center rounded-full bg-success text-success-foreground'
            : state === 'current'
              ? 'flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground'
              : 'flex size-6 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground'
        }
      >
        {state === 'done' ? <CheckCircle2 className="size-4" /> : n}
      </span>
      <span className={state === 'todo' ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>{label}</span>
    </div>
  )
}

function useCountdown(seconds: number): [number, (s: number) => void] {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    if (left <= 0) return
    const id = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000)
    return () => clearInterval(id)
  }, [left])
  return [left, setLeft]
}

function ForgotPasswordInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [phase, setPhase] = useState<Phase>('email')
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null)
  const [expiresInMinutes, setExpiresInMinutes] = useState(15)
  const [minPasswordLength, setMinPasswordLength] = useState(8)
  const [resendLeft, setResendLeft] = useCountdown(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (phase === 'code') codeRef.current?.focus()
  }, [phase])

  const cleanEmail = email.trim().toLowerCase()
  const cleanCode = useMemo(() => code.replace(/\D+/g, '').slice(0, CODE_LENGTH), [code])

  async function requestCode(resend = false) {
    const fieldError = validateEmailAddress(cleanEmail)
    if (fieldError) {
      setEmailError(fieldError)
      return
    }
    setEmailError(null)
    setError(null)
    setNote(null)
    setBusy(true)
    try {
      const data = await apiFetch<{ message: string; expiresInMinutes?: number; resendAfterSec?: number }>('/api/auth/password-reset', {
        method: 'POST',
        body: { step: 'request', email: cleanEmail },
        timeoutMs: 25_000,
      })
      setExpiresInMinutes(data.expiresInMinutes ?? 15)
      setResendLeft(data.resendAfterSec ?? 60)
      setAttemptsLeft(null)
      setCode('')
      setNote(resend ? 'A fresh code is on its way. The previous one no longer works.' : data.message)
      setPhase('code')
    } catch (err) {
      const apiErr = err as ApiError
      if (errorCode(err) === 'cooldown' && apiErr.retryAfterSec) {
        setResendLeft(apiErr.retryAfterSec)
        if (phase === 'email') setPhase('code')
      }
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode() {
    if (cleanCode.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from the email.`)
      return
    }
    setError(null)
    setNote(null)
    setBusy(true)
    try {
      const data = await apiFetch<{ ticket: string; minPasswordLength?: number }>('/api/auth/password-reset', {
        method: 'POST',
        body: { step: 'verify', email: cleanEmail, code: cleanCode },
      })
      setTicket(data.ticket)
      setMinPasswordLength(data.minPasswordLength ?? 8)
      setPhase('password')
    } catch (err) {
      const apiErr = err as ApiError
      setError(describeError(err))
      setAttemptsLeft(typeof apiErr.attemptsLeft === 'number' ? apiErr.attemptsLeft : null)
      const c = errorCode(err)
      if (c === 'expired' || c === 'burned' || c === 'missing') {
        setCode('')
        setResendLeft(0)
      }
    } finally {
      setBusy(false)
    }
  }

  async function completeReset() {
    if (!ticket) {
      setError('That reset session is gone. Request a new code.')
      setPhase('email')
      return
    }
    if (password.length < minPasswordLength) {
      setError(`Use at least ${minPasswordLength} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await apiFetch('/api/auth/password-reset', { method: 'POST', body: { step: 'complete', ticket, password } })
      setTicket(null)
      setPassword('')
      setConfirm('')
      setPhase('done')
    } catch (err) {
      setError(describeError(err))
      const c = errorCode(err)
      if (c === 'expired' || c === 'invalid_ticket' || c === 'used' || c === 'malformed') {
        setTicket(null)
        setPhase(c === 'used' ? 'done' : 'email')
      }
    } finally {
      setBusy(false)
    }
  }

  const title =
    phase === 'email' ? 'Reset your password' : phase === 'code' ? 'Check your inbox' : phase === 'password' ? 'Choose a new password' : 'Password updated'
  const subtitle =
    phase === 'email'
      ? 'Enter the email you signed up with and we will send you a one-time code.'
      : phase === 'code'
        ? `We emailed a ${CODE_LENGTH}-digit code to ${cleanEmail}. It expires in ${expiresInMinutes} minutes.`
        : phase === 'password'
          ? 'Code accepted. Pick something only you would guess.'
          : 'Other devices have been signed out. Sign in with your new password.'

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandLockup width={210} className="mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">{subtitle}</p>
      </div>

      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
        <Step n={1} label="Your email" state={phase === 'email' ? 'current' : 'done'} />
        <Step n={2} label="Enter the code" state={phase === 'code' ? 'current' : phase === 'email' ? 'todo' : 'done'} />
        <Step n={3} label="New password" state={phase === 'password' ? 'current' : phase === 'done' ? 'done' : 'todo'} />
      </div>

      {note && phase !== 'done' && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          <MailCheck className="mt-0.5 size-4 shrink-0 text-green-600" />
          <span>{note}</span>
        </div>
      )}

      {phase === 'email' && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void requestCode()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-email" className="text-sm font-medium">
              Email address
            </label>
            <input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (emailError) setEmailError(validateEmailAddress(e.target.value))
              }}
              className={`${inputClass} ${emailError ? 'border-destructive focus-visible:ring-destructive/30' : ''}`}
              placeholder="you@example.com"
              disabled={busy}
            />
            {emailError && <p className="text-xs font-medium text-destructive">{emailError}</p>}
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy} className="mt-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
            Send reset code
          </Button>
        </form>
      )}

      {phase === 'code' && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void verifyCode()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-code" className="text-sm font-medium">
              {CODE_LENGTH}-digit code
            </label>
            {/* The pattern accepts the displayed grouping as well as six unspaced digits. */}
            <input
              ref={codeRef}
              id="reset-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{3} ?[0-9]{3}"
              required
              maxLength={CODE_LENGTH + 1}
              value={cleanCode.length > 3 ? `${cleanCode.slice(0, 3)} ${cleanCode.slice(3)}` : cleanCode}
              onChange={(e) => setCode(e.target.value)}
              onPaste={(e) => {
                // Read the whole clipboard before maxLength truncates whitespace copied from mail.
                const pasted = e.clipboardData.getData('text').replace(/\D+/g, '')
                if (pasted.length === CODE_LENGTH) {
                  e.preventDefault()
                  setCode(pasted)
                }
              }}
              className={`${inputClass} text-center font-mono text-2xl tracking-[0.35em]`}
              placeholder="000 000"
              disabled={busy}
              aria-describedby="reset-code-hint"
            />
            <p id="reset-code-hint" className="text-xs text-muted-foreground">
              Look for a message from AfterWorks. AfterWorks staff will never ask you for this code.
              {attemptsLeft !== null && attemptsLeft > 0 ? ` ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left on this code.` : ''}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy || cleanCode.length !== CODE_LENGTH} className="mt-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Verify code
          </Button>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                setPhase('email')
                setError(null)
                setNote(null)
              }}
              className="inline-flex items-center gap-1 font-medium hover:text-foreground hover:underline"
              disabled={busy}
            >
              <ArrowLeft className="size-3.5" />
              Different email
            </button>
            <button
              type="button"
              onClick={() => void requestCode(true)}
              disabled={busy || resendLeft > 0}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              <RefreshCw className="size-3.5" />
              {resendLeft > 0 ? `Resend in ${resendLeft}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      {phase === 'password' && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void completeReset()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-password" className="text-sm font-medium">
              New password
            </label>
            <div className="relative">
              <input
                id="reset-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoFocus
                minLength={minPasswordLength}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-10`}
                placeholder={`At least ${minPasswordLength} characters, letters and numbers`}
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                <span className="sr-only">{showPassword ? 'Hide password' : 'Show password'}</span>
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-confirm" className="text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="reset-confirm"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={minPasswordLength}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
              placeholder="Type it again"
              disabled={busy}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy} className="mt-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Set new password
          </Button>
          <p className="text-xs text-muted-foreground">
            Saving signs out every other device that was using the old password.
          </p>
        </form>
      )}

      {phase === 'done' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>
              The password for <strong>{cleanEmail}</strong> has been changed.
            </span>
          </div>
          <Button size="lg" className="w-full" onClick={() => router.push(`/sign-in?reset=1`)}>
            Sign in
          </Button>
        </div>
      )}

      {phase !== 'done' && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remembered it?{' '}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      )}

      <div className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" />
        Codes work once, expire quickly and are never shown to AfterWorks staff.
      </div>
    </div>
  )
}

export function ForgotPasswordForm() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordInner />
    </Suspense>
  )
}
