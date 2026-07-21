'use client'

import { useAfterWorks } from '@/components/afterworks-provider'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2,
  Mail,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  UserCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function ProfilePage() {
  const { worker } = useAfterWorks()

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <section>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your personal information and verification status.
        </p>
      </section>

      {/* User Info Card */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col items-center gap-4 border-b border-border p-6 sm:flex-row sm:gap-6">
          <div className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserCircle className="size-12" />
          </div>
          <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
            <h2 className="text-xl font-semibold">{worker.name}</h2>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-4" />
              <span>{worker.email || 'No email provided'}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4" />
              <span>{worker.location || 'Location not set'}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border bg-muted/30">
          <div className="flex flex-col items-center gap-1 p-4 sm:flex-row sm:justify-between sm:px-6">
            <span className="text-xs font-medium text-muted-foreground">Member since</span>
            <span className="text-sm font-semibold">{worker.memberSince || 'N/A'}</span>
          </div>
          <div className="flex flex-col items-center gap-1 p-4 sm:flex-row sm:justify-between sm:px-6">
            <span className="text-xs font-medium text-muted-foreground">Jobs completed</span>
            <span className="text-sm font-semibold">{worker.jobsCompleted}</span>
          </div>
        </div>
      </section>

      {/* Didit KYC Verification */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex size-10 items-center justify-center rounded-full',
                worker.kycVerified ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning',
              )}
            >
              {worker.kycVerified ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
            </div>
            <div>
              <h3 className="text-lg font-semibold">Didit KYC Identity Verification</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Verify your identity with Didit to unlock higher-paying jobs and faster payouts.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl bg-muted/50 p-4 border border-border/50">
            <div className="flex items-center gap-3">
              {worker.kycVerified ? (
                <>
                  <CheckCircle2 className="size-5 text-success" />
                  <div>
                    <p className="text-sm font-medium">Verified</p>
                    <p className="text-xs text-muted-foreground">Your identity has been successfully verified.</p>
                  </div>
                </>
              ) : (
                <>
                  <ShieldAlert className="size-5 text-warning" />
                  <div>
                    <p className="text-sm font-medium">Unverified</p>
                    <p className="text-xs text-muted-foreground">Verification is required for some jobs.</p>
                  </div>
                </>
              )}
            </div>

            {!worker.kycVerified && (
              <Button onClick={() => alert('Didit KYC Flow initialized...')} className="shrink-0">
                Verify with Didit
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
