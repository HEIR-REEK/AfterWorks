'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  AlertTriangle,
  Clock,
  RefreshCw,
  Shield,
  Wrench,
  CheckCircle2,
  Mail,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MaintenanceConfig } from '@/lib/firestore'
import logo from '@/components/logo.png'

interface MaintenanceScreenProps {
  config: MaintenanceConfig
  isAdmin?: boolean
  onCheckStatus?: () => void
}

export function MaintenanceScreen({
  config,
  isAdmin,
  onCheckStatus,
}: MaintenanceScreenProps) {
  const [timeLeft, setTimeLeft] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!config.estimatedEnd) {
      setTimeLeft(null)
      return
    }

    function calculateTimeLeft() {
      if (!config.estimatedEnd) return
      const diff = new Date(config.estimatedEnd).getTime() - Date.now()
      if (diff <= 0) {
        setTimeLeft('Finalizing updates...')
        return
      }
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m ${seconds}s`)
      } else {
        setTimeLeft(`${minutes}m ${seconds}s`)
      }
    }

    calculateTimeLeft()
    const timer = setInterval(calculateTimeLeft, 1000)
    return () => clearInterval(timer)
  }, [config.estimatedEnd])

  const handleRefresh = async () => {
    setChecking(true)
    if (onCheckStatus) {
      onCheckStatus()
    } else {
      window.location.reload()
    }
    setTimeout(() => setChecking(false), 1000)
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-between bg-gradient-to-b from-background via-muted/30 to-background p-4 sm:p-6 md:p-8">
      {/* Background pattern */}
      <div className="absolute inset-0 bg-grid-pattern opacity-5 pointer-events-none" />

      {/* Header */}
      <header className="z-10 flex w-full max-w-4xl items-center justify-between py-4">
        <div className="flex items-center gap-2.5">
          <Image
            src={logo}
            alt="AfterWorks"
            width={36}
            height={36}
            className="h-8 w-8 object-contain sm:h-9 sm:w-9"
          />
          <span className="text-base font-semibold tracking-tight sm:text-lg">AfterWorks</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
            <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
            Maintenance Mode Active
          </span>
        </div>
      </header>

      {/* Main card */}
      <main className="z-10 my-auto flex w-full max-w-xl flex-col items-center text-center">
        {/* Visual Icon Badge */}
        <div className="relative mb-6 flex size-20 items-center justify-center rounded-3xl border border-amber-500/20 bg-amber-500/10 shadow-lg shadow-amber-500/5 sm:size-24">
          <div className="absolute inset-0 rounded-3xl bg-amber-500/10 animate-ping opacity-30" />
          <Wrench className="size-10 text-amber-600 dark:text-amber-400 sm:size-12" />
        </div>

        <h1 className="text-pretty text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl text-foreground">
          {config.title || 'Under Scheduled Maintenance'}
        </h1>

        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
          {config.message ||
            'We are performing system upgrades and optimizations to enhance your experience. Worker payments, tasks, and balances remain completely secure.'}
        </p>

        {/* Estimated Countdown Timer if available */}
        {timeLeft && (
          <div className="mt-6 flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card/80 p-4 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="size-3.5 text-primary" />
              Estimated Return Time
            </div>
            <p className="font-mono text-xl font-bold tracking-tight text-primary sm:text-2xl">
              {timeLeft}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            onClick={handleRefresh}
            disabled={checking}
            size="lg"
            className="gap-2 shadow-sm"
          >
            <RefreshCw className={`size-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking Status...' : 'Check Status'}
          </Button>

          {isAdmin ? (
            <Button
              render={<Link href="/admin" />}
              variant="outline"
              size="lg"
              className="gap-2 border-primary/30 text-primary hover:bg-primary/5"
            >
              <Shield className="size-4" />
              Admin Console
            </Button>
          ) : (
            <Button
              render={<Link href="/sign-in" />}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              <Shield className="size-4" />
              Admin Sign In
            </Button>
          )}
        </div>

        {/* Assurance Note */}
        <div className="mt-10 grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-left w-full">
          <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-card/50 p-3 text-xs text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-success mt-0.5" />
            <span>All worker account balances and pending payouts are 100% safe.</span>
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-card/50 p-3 text-xs text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-success mt-0.5" />
            <span>Job applications and submissions will resume automatically once complete.</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="z-10 mt-8 flex w-full max-w-4xl flex-col items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground sm:flex-row">
        <p>© {new Date().getFullYear()} AfterWorks Inc. All rights reserved.</p>
        <div className="flex items-center gap-4">
          <a
            href="mailto:support@example.com"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Mail className="size-3.5" />
            Contact Support
          </a>
        </div>
      </footer>
    </div>
  )
}
