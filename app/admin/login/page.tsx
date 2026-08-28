'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Shield,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authenticateAdminSession } from '@/lib/admin'
import logo from '@/components/logo.png'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await authenticateAdminSession(email, password)
      if (result.ok) {
        setSuccess(true)
        setTimeout(() => {
          router.replace('/admin')
          router.refresh()
        }, 500)
      } else {
        setError(result.error)
        if (typeof result.remainingAttempts === 'number') {
          setRemainingAttempts(result.remainingAttempts)
        }
      }
    } catch (err) {
      console.error('[AdminLogin] Error:', err)
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md">
        {/* Brand & Portal Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <Link href="/" className="mb-4 inline-flex items-center justify-center transition-transform hover:scale-105">
            <Image
              src={logo}
              alt="AfterWorks"
              width={80}
              height={80}
              priority
              className="h-20 w-20 object-contain drop-shadow-sm"
            />
          </Link>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-0.5 text-xs font-semibold text-primary mb-2">
            <Shield className="size-3.5" />
            OPERATIONS & MANAGEMENT
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            AfterWorks Admin Portal
          </h1>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Sign in with authorized administrator credentials to manage platform operations.
          </p>
        </div>

        {/* Login Card Matching Site Theme */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {error && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive animate-in fade-in">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{error}</p>
                {remainingAttempts !== null && remainingAttempts < 5 && (
                  <p className="mt-1 text-[11px] text-destructive/90">
                    Security Notice: {remainingAttempts} {remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining before temporary IP lockout.
                  </p>
                )}
              </div>
            </div>
          )}

          {success && (
            <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-success/30 bg-success/10 p-3.5 text-xs text-success animate-in fade-in">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>Credentials verified. Redirecting to Management Console...</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" autoComplete="off">
            {/* Email Input */}
            <div className="space-y-1.5">
              <label htmlFor="admin-email" className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Mail className="size-3.5 text-primary" />
                Administrator Email
              </label>
              <input
                id="admin-email"
                type="email"
                required
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label htmlFor="admin-password" className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Lock className="size-3.5 text-primary" />
                Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter administrator password"
                  className="h-11 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              size="lg"
              disabled={loading || success}
              className="mt-2 h-11 w-full font-semibold shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Verifying...
                </>
              ) : (
                <>
                  <KeyRound className="size-4 mr-2" />
                  Sign In to Management Console
                </>
              )}
            </Button>
          </form>

          {/* Security Compliance Footer */}
          <div className="mt-6 border-t border-border/80 pt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-success shrink-0" />
            <span>Protected by rate limiting & encrypted audit logging</span>
          </div>
        </div>

        {/* Back Link */}
        <div className="mt-6 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            ← Exit to Public Platform
          </Link>
        </div>
      </div>
    </div>
  )
}
