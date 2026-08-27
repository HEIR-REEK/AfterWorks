'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Clock, Loader2, RefreshCw, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useMaintenance } from '@/components/maintenance-provider'
import { useAdmin } from '@/components/admin-provider'
import logo from '@/components/logo.png'

/**
 * Full-screen maintenance page shown to all non-admin users while
 * maintenance mode is enabled. Admins can preview it directly at
 * /maintenance (an exit bar is shown to them).
 */
export function MaintenanceScreen() {
  const router = useRouter()
  const { maintenance, refresh } = useMaintenance()
  const { isAdmin } = useAdmin()
  const [retrying, setRetrying] = useState(false)

  // When maintenance lifts, bring users back into the app automatically.
  useEffect(() => {
    if (!maintenance.enabled && !isAdmin) {
      const t = setTimeout(() => router.replace('/'), 1200)
      return () => clearTimeout(t)
    }
  }, [maintenance.enabled, isAdmin, router])

  async function handleRetry() {
    setRetrying(true)
    await refresh()
    // Small pause so the spinner is perceivable even on fast connections.
    setTimeout(() => setRetrying(false), 600)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Admin preview bar */}
      {isAdmin && (
        <div className="flex items-center justify-center gap-2 bg-primary px-4 py-2 text-center text-xs font-medium text-primary-foreground">
          <span>You are previewing the maintenance page as an admin — visitors see only this screen.</span>
          <Link
            href="/admin/settings"
            className="ml-2 rounded-full bg-primary-foreground/20 px-3 py-0.5 font-semibold hover:bg-primary-foreground/30"
          >
            Exit preview
          </Link>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg text-center">
          <div className="relative mx-auto mb-8 flex size-24 items-center justify-center">
            {/* Soft pulsing halo */}
            <div className="absolute inset-0 animate-ping rounded-full bg-primary/10 [animation-duration:2.5s]" />
            <div className="absolute inset-2 rounded-full bg-primary/10" />
            <div className="relative flex size-20 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <Wrench className="size-9 animate-[wiggle_1.8s_ease-in-out_infinite]" />
            </div>
          </div>

          <Image
            src={logo}
            alt="AfterWorks"
            width={56}
            height={56}
            className="mx-auto mb-4 h-14 w-14 object-contain"
          />

          <h1 className="text-pretty text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Down for maintenance
          </h1>
          <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
            {maintenance.message}
          </p>

          {maintenance.estimatedUntil && (
            <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-foreground">
              <Clock className="size-4 text-primary" />
              <span>
                Expected back by <span className="font-semibold">{maintenance.estimatedUntil}</span>
              </span>
            </div>
          )}

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
            >
              {retrying ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Try again
            </button>
            <p className="text-xs text-muted-foreground">
              This page refreshes automatically — no need to keep retrying.
            </p>
          </div>

          <div className="mt-12 rounded-2xl border border-border bg-card p-5 text-left">
            <h2 className="text-sm font-semibold text-foreground">Your money is safe</h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <li>• Wallet balances, pending earnings and application progress are untouched.</li>
              <li>• Any payments already made (including training fees) are recorded and will apply once we are back.</li>
              <li>• Questions? Reach us at{' '}
                <a href="mailto:support@afterworks.io" className="font-medium text-primary hover:underline">
                  support@afterworks.io
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
