'use client'

import { useState, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from './ui/button'
import { useAuth } from './firebase-auth-provider'
import logo from '@/components/logo.png'

// Inner component that reads search params (must be inside Suspense)
function AuthFormInner({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { signIn, signUp, configured } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isSignUp = mode === 'sign-up'
  // Show a success banner on sign-in page when coming from sign-up
  const justRegistered = !isSignUp && searchParams.get('registered') === '1'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const result = isSignUp
      ? await signUp(email.trim(), password, name.trim())
      : await signIn(email.trim(), password)
    setSubmitting(false)
    if (result.ok) {
      if (isSignUp) {
        // After registration, send user to sign-in with a success flag
        router.push('/sign-in?registered=1')
      } else {
        router.push('/')
        router.refresh()
      }
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <Image
          src={logo}
          alt="AfterWorks"
          width={96}
          height={96}
          className="mb-4 h-24 w-24 object-contain"
        />
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
            <strong>Account created!</strong> Sign in with the email and password you just used.
          </span>
        </div>
      )}

      {!configured && (
        <div className="mb-5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          Firebase is not fully configured yet. Add your Firebase web config
          (apiKey, authDomain, projectId, appId) to enable sign in.
        </div>
      )}

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
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="you@example.com"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={isSignUp ? 'At least 6 characters' : 'Your password'}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={submitting || !configured} className="mt-1">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {isSignUp ? 'Create account' : 'Sign in'}
        </Button>
      </form>

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

      <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" />
        Your data is protected. AfterWorks never charges to apply.
      </div>
    </div>
  )
}

// Wrap in Suspense because useSearchParams requires it in Next.js App Router
export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return (
    <Suspense fallback={null}>
      <AuthFormInner mode={mode} />
    </Suspense>
  )
}
