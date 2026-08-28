'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authenticateAdminSession, useAdminCapabilities, useAdminSession } from '@/lib/admin'
import { useMaintenance } from '@/components/maintenance-provider'
import { site } from '@/lib/site'
import logo from '@/components/logo.png'

/**
 * Administrator sign-in.
 *
 * Deliberately minimal about what it reveals: the roster is not listed (no "did you mean…"), the
 * error text is identical for "not an admin" and "wrong passcode" (no account enumeration), and the
 * lockout countdown mirrors the server so the form cannot be spammed while locked. Nothing about
 * the deployment — passcode, emails, session secret — is read in this file any more.
 */

export default function AdminLoginPage() {
  const router = useRouter()
  const { refresh } = useAdminSession()
  const capabilities = useAdminCapabilities()
  const { view } = useMaintenance()

  const [email, setEmail] = useState('')
  const [passcode, setPasscode] = useState('')
  const [showPasscode, setShowPasscode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null)
  const [lockSeconds, setLockSeconds] = useState(0)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (lockSeconds <= 0) return
    const id = setInterval(() => setLockSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(id)
  }, [lockSeconds])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loading || lockSeconds > 0) return
    setError(null)
    setLoading(true)

    const result = await authenticateAdminSession(email, passcode)
    if (result.ok) {
      setSuccess(true)
      setPasscode('')
      await refresh()
      setTimeout(() => router.replace('/admin'), 350)
      return
    }

    setError(result.error)
    setRemainingAttempts(result.remainingAttempts ?? null)
    if (result.locked) setLockSeconds((capabilities?.lockoutMinutes ?? 15) * 60)
    setLoading(false)
  }

  const consoleDisabled = capabilities ? !capabilities.consoleEnabled : false
  const passcodeDisabled = capabilities ? !capabilities.passcodeEnabled : false

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10 text-foreground sm:py-14">
      <div className="w-full max-w-md">
        <div className="mb-7 flex flex-col items-center text-center">
          <Link href="/" className="mb-4 inline-flex items-center justify-center transition-transform hover:scale-[1.03]" aria-label={`${site.name} home`}>
            <Image src={logo} alt="" width={76} height={76} priority className="h-19 w-19 object-contain drop-shadow-sm sm:h-20 sm:w-20" />
          </Link>
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <ShieldCheck className="size-3.5" />
            Operations & management
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">Administrator sign-in</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Staff accounts on the approved roster, verified server-side. Not a worker login.
          </p>
        </div>

        {view.blocking && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <Wrench className="mt-0.5 size-4 shrink-0" />
            <span>
              A maintenance blackout is active. Staff sessions bypass it automatically once you sign in.
            </span>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          {consoleDisabled && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>
                The console is disabled on this deployment: <code className="font-mono">ADMIN_SESSION_SECRET</code> is not configured, so
                sessions cannot be signed. Set it in the server environment.
              </span>
            </div>
          )}

          {!consoleDisabled && passcodeDisabled && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>
                No master passcode is configured here. Sign in through the worker app with a staff Firebase account that carries the{' '}
                <code className="font-mono">admin</code> claim.
              </span>
            </div>
          )}

          {error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">{error}</p>
                {remainingAttempts !== null && remainingAttempts > 0 && (
                  <p className="mt-1 text-[11px] opacity-90">
                    {remainingAttempts} {remainingAttempts === 1 ? 'attempt' : 'attempts'} left before this address is locked.
                  </p>
                )}
              </div>
            </div>
          )}

          {success && (
            <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-success/30 bg-success/10 p-3 text-xs text-success">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>Session established. Opening the console…</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" autoComplete="off">
            <div className="space-y-1.5">
              <label htmlFor="admin-email" className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Mail className="size-3.5 text-primary" />
                Administrator email
              </label>
              <input
                id="admin-email"
                name="admin-email"
                type="email"
                required
                maxLength={254}
                autoComplete="username"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={capabilities?.rosterConfigured ? 'your@staff-domain.com' : 'your@staff-domain.com'}
                className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-passcode" className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Lock className="size-3.5 text-primary" />
                Passcode
              </label>
              <div className="relative">
                <input
                  id="admin-passcode"
                  name="admin-passcode"
                  type={showPasscode ? 'text' : 'password'}
                  required
                  maxLength={200}
                  autoComplete="off"
                  value={passcode}
                  onChange={(event) => setPasscode(event.target.value)}
                  placeholder="Enter your administrator passcode"
                  className="h-11 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPasscode((value) => !value)}
                  tabIndex={-1}
                  aria-label={showPasscode ? 'Hide passcode' : 'Show passcode'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPasscode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" size="lg" disabled={loading || success || lockSeconds > 0 || consoleDisabled} className="mt-1 h-11 w-full font-semibold shadow-sm">
              {lockSeconds > 0 ? (
                `Locked — retry in ${Math.floor(lockSeconds / 60)}:${String(lockSeconds % 60).padStart(2, '0')}`
              ) : loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Verifying…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="size-4" />
                  Enter management console
                </span>
              )}
            </Button>
          </form>

          <ul className="mt-6 space-y-1.5 border-t border-border/80 pt-4 text-[11px] leading-relaxed text-muted-foreground">
            <li className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
              Sessions are HttpOnly, same-site, expire automatically and can be revoked from Security → Sessions.
            </li>
            <li className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
              Every sign-in and console action is written to an append-only audit ledger.
            </li>
            <li className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
              Repeated failures lock this address; the lockout is shared per account and per IP.
            </li>
          </ul>
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline">
            ← Back to {site.name}
          </Link>
        </div>
      </div>
    </div>
  )
}
