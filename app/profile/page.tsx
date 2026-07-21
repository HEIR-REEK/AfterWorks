'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAfterWorks } from '@/components/afterworks-provider'
import { useAuth } from '@/components/firebase-auth-provider'
import { Button } from '@/components/ui/button'
import {
  Award,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  CreditCard,
  Edit3,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCircle,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatKes, formatUsd } from '@/lib/afterworks-data'
import { KENYAN_BANKS } from '@/lib/banks'
import { Building2, Smartphone, Landmark, AlertCircle } from 'lucide-react'

export default function ProfilePage() {
  const { worker, wallet, applications, getJob, updateProfile } = useAfterWorks()
  const { user } = useAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showToast, setShowToast] = useState(false)
  const [startingKyc, setStartingKyc] = useState(false)
  const [kycError, setKycError] = useState<string | null>(null)

  const handleStartKyc = async () => {
    if (!user) {
      setKycError('You must be signed in to verify your identity.')
      return
    }
    setStartingKyc(true)
    setKycError(null)
    try {
      const res = await fetch('/api/kyc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start KYC session.')
      }

      if (data.verificationUrl) {
        window.location.href = data.verificationUrl
      } else {
        throw new Error('No verification URL returned from Didit.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('[KYC]', msg)
      setKycError(msg)
    } finally {
      setStartingKyc(false)
    }
  }

  // Form state for editing profile
  const [formData, setFormData] = useState({
    name: worker.name || '',
    phone: worker.phone || wallet.payoutNumber || '',
    country: worker.country || '',
    zipCode: worker.zipCode || '',
    location: worker.location || '',
    bio: worker.bio || '',
    preferredPayoutMethod: worker.preferredPayoutMethod || 'M-Pesa',
    bankName: worker.bankName || '',
    bankBranch: worker.bankBranch || '',
    bankAccountNumber: worker.bankAccountNumber || '',
    skillsStr: (worker.skills || []).join(', '),
    languagesStr: (worker.languages || []).join(', '),
  })

  // Open edit modal & sync form data
  const handleOpenEdit = () => {
    setFormData({
      name: worker.name || '',
      phone: worker.phone || wallet.payoutNumber || '',
      country: worker.country || '',
      zipCode: worker.zipCode || '',
      location: worker.location || '',
      bio: worker.bio || '',
      preferredPayoutMethod: worker.preferredPayoutMethod || 'M-Pesa',
      bankName: worker.bankName || '',
      bankBranch: worker.bankBranch || '',
      bankAccountNumber: worker.bankAccountNumber || '',
      skillsStr: (worker.skills || []).join(', '),
      languagesStr: (worker.languages || []).join(', '),
    })
    setIsEditing(true)
  }

  // Handle saving profile changes
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const skills = formData.skillsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const languages = formData.languagesStr
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean)

    await updateProfile({
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      country: formData.country.trim(),
      zipCode: formData.zipCode.trim(),
      location: formData.location.trim(),
      bio: formData.bio.trim(),
      preferredPayoutMethod: formData.preferredPayoutMethod,
      bankName: formData.preferredPayoutMethod === 'Bank Transfer' ? formData.bankName : '',
      bankBranch: formData.preferredPayoutMethod === 'Bank Transfer' ? formData.bankBranch : '',
      bankAccountNumber: formData.preferredPayoutMethod === 'Bank Transfer' ? formData.bankAccountNumber.trim() : '',
      skills: skills.length > 0 ? skills : worker.skills,
      languages: languages.length > 0 ? languages : worker.languages,
    })

    setSaving(false)
    setIsEditing(false)

    // Show temporary success toast
    setShowToast(true)
    setTimeout(() => setShowToast(false), 4000)
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-20 right-4 z-50 flex items-center gap-3 rounded-xl border border-success/30 bg-success/15 px-5 py-3 text-sm font-medium text-success shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-3">
          <CheckCircle2 className="size-5 shrink-0" />
          <span>Profile updated successfully!</span>
        </div>
      )}

      {/* Page Header */}
      <section className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Worker Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your personal credentials, skills, verification status, and payout details.
          </p>
        </div>
        <Button onClick={handleOpenEdit} className="self-start sm:self-auto gap-2">
          <Edit3 className="size-4" />
          Update Profile
        </Button>
      </section>

      {/* Main Profile Hero Card */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-6 p-6 sm:p-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
            {/* Avatar with Status Badge */}
            <div className="relative">
              <div className="flex size-24 items-center justify-center rounded-full bg-primary/10 text-primary border-2 border-primary/20 shadow-inner">
                <UserCircle className="size-16" />
              </div>
              {worker.kycVerified && (
                <div
                  className="absolute bottom-0 right-0 flex size-7 items-center justify-center rounded-full bg-success text-success-foreground border-2 border-card shadow-sm"
                  title="KYC Verified Worker"
                >
                  <Check className="size-4 stroke-[3]" />
                </div>
              )}
            </div>

            {/* Basic Info */}
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h2 className="text-2xl font-bold tracking-tight">{worker.name}</h2>
                {worker.kycVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
                    <ShieldCheck className="size-3.5" />
                    Verified Worker
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                    <ShieldAlert className="size-3.5" />
                    Unverified
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground sm:justify-start">
                <div className="flex items-center gap-1.5">
                  <Mail className="size-4 text-muted-foreground/70" />
                  <span>{worker.email || 'No email set'}</span>
                </div>
                {worker.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="size-4 text-muted-foreground/70" />
                    <span>{worker.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <MapPin className="size-4 text-muted-foreground/70" />
                  <span>{worker.location || 'Nairobi, Kenya'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 divide-x divide-y sm:divide-y-0 sm:grid-cols-4 border-t border-border bg-muted/20">
          <div className="flex flex-col p-4 sm:p-5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Calendar className="size-3.5 text-primary" />
              Member Since
            </div>
            <span className="mt-1 text-base font-semibold">{worker.memberSince || 'Jul 2026'}</span>
          </div>

          <div className="flex flex-col p-4 sm:p-5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Briefcase className="size-3.5 text-primary" />
              Jobs Completed
            </div>
            <span className="mt-1 text-base font-semibold">{worker.jobsCompleted} tasks</span>
          </div>

          <div className="flex flex-col p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Award className="size-3.5 text-primary" />
                Quality Score
              </span>
              <span className="font-semibold text-foreground">{worker.qualityScore}%</span>
            </div>
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${worker.qualityScore}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col p-4 sm:p-5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CreditCard className="size-3.5 text-primary" />
              Payout Channel
            </div>
            <span className="mt-1 text-base font-semibold">{worker.preferredPayoutMethod || 'M-Pesa'}</span>
          </div>
        </div>
      </section>

      {/* Bio / Summary Section */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Professional Overview
          </h3>
          <Button variant="ghost" size="sm" onClick={handleOpenEdit} className="h-8 gap-1 text-xs">
            <Edit3 className="size-3.5" /> Edit
          </Button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {worker.bio ||
            'Experienced digital task professional with expertise in data entry, Swahili transcription, and content validation.'}
        </p>
      </section>

      {/* Two Column Layout: Skills & Languages / Didit KYC */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Skills & Badges */}
        <section className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Award className="size-4 text-primary" />
                Verified Skills & Capabilities
              </h3>
              <Button variant="ghost" size="sm" onClick={handleOpenEdit} className="h-8 gap-1 text-xs">
                <Edit3 className="size-3.5" /> Edit
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Skills used to match you with high-value micro-task opportunities.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(worker.skills || ['Data Entry', 'Transcription', 'Swahili Translation']).map((skill, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary"
                >
                  <Check className="size-3.5 stroke-[2.5]" />
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Globe className="size-3.5" />
              Spoken & Written Languages
            </h4>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {(worker.languages || ['English (Fluent)', 'Swahili (Native)']).map((lang, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                >
                  {lang}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Didit KYC Verification Card */}
        <section className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex size-10 items-center justify-center rounded-full',
                    worker.kycVerified ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
                  )}
                >
                  {worker.kycVerified ? <ShieldCheck className="size-6" /> : <ShieldAlert className="size-6" />}
                </div>
                <div>
                  <h3 className="text-base font-semibold">Didit KYC Identity Verification</h3>
                  <p className="text-xs text-muted-foreground">
                    {worker.kycVerified ? 'Level 2 Biometric Verified' : 'Verification Required'}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Verification Method:</span>
                <span className="font-semibold text-foreground">Didit Protocol (National ID / Passport)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span
                  className={cn(
                    'font-semibold',
                    worker.kycVerified ? 'text-success' : 'text-warning',
                  )}
                >
                  {worker.kycVerified ? 'Verified & Active' : 'Action Required'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payout Limit:</span>
                <span className="font-semibold text-foreground">
                  {worker.kycVerified ? 'Unlimited Instant Payouts' : '$50 / week'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 pt-2">
            {kycError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <p>{kycError}</p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {worker.kycVerified
                  ? 'Your identity is fully verified on the Didit decentralized network.'
                  : 'Complete verification to unlock premium high-paying tasks.'}
              </p>
              {!worker.kycVerified ? (
                <Button
                  onClick={handleStartKyc}
                  disabled={startingKyc}
                  size="sm"
                  className="shrink-0 gap-1.5"
                >
                  <ShieldCheck className="size-4" />
                  {startingKyc ? 'Starting...' : 'Verify Now'}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => alert('Viewing Didit KYC Certificate...')} className="gap-1.5">
                  <ExternalLink className="size-3.5" />
                  View Status
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Applied Jobs & Activity Track */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Briefcase className="size-4 text-primary" />
            Recent Applications & Activity
          </h3>
          <Link
            href="/applications"
            className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
          >
            View all ({applications.length})
          </Link>
        </div>

        {applications.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No active job applications found. Explore open jobs to start earning!
          </p>
        ) : (
          <div className="divide-y divide-border">
            {applications.slice(0, 3).map((app) => {
              const job = getJob(app.jobId)
              return (
                <div key={app.id} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-sm font-medium">{job?.title || app.jobId}</h4>
                    <p className="text-xs text-muted-foreground">
                      Applied on {new Date(app.appliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <span className="text-xs font-semibold text-primary">
                      {job ? `${formatUsd(job.payAmountUsd)} (${formatKes(job.payAmountUsd)})` : ''}
                    </span>
                    <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary capitalize">
                      {app.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── EDIT PROFILE MODAL DIALOG ────────────────────────────────────────── */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border p-5">
              <div className="flex items-center gap-2">
                <Edit3 className="size-5 text-primary" />
                <h3 className="text-lg font-semibold">Update Worker Profile</h3>
              </div>
              <button
                onClick={() => setIsEditing(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Form Fields */}
            <form onSubmit={handleSaveProfile} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Full Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g. Amara Okoro"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Country</label>
                  <input
                    type="text"
                    required
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g. Kenya"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">City / Region</label>
                  <input
                    type="text"
                    required
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g. Nairobi"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Zip / Postal Code (Optional)</label>
                <input
                  type="text"
                  value={formData.zipCode}
                  onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g. 00100"
                />
              </div>

              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium flex items-center gap-1.5">
                    <CreditCard className="size-3.5 text-primary" />
                    Payment Method
                  </label>
                  <select
                    value={formData.preferredPayoutMethod}
                    onChange={(e) => setFormData({ ...formData, preferredPayoutMethod: e.target.value })}
                    className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="M-Pesa">M-Pesa (+254 Mobile Money)</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>

                {formData.preferredPayoutMethod === 'Bank Transfer' ? (
                  <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <Building2 className="size-3.5" />
                        Bank Name
                      </label>
                      <select
                        value={formData.bankName}
                        onChange={(e) => {
                          setFormData({ ...formData, bankName: e.target.value, bankBranch: '' })
                        }}
                        className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select a Bank</option>
                        {KENYAN_BANKS.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <Landmark className="size-3.5" />
                        Bank Branch
                      </label>
                      <select
                        value={formData.bankBranch}
                        onChange={(e) => setFormData({ ...formData, bankBranch: e.target.value })}
                        disabled={!formData.bankName}
                        className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                      >
                        <option value="">Select a Branch</option>
                        {KENYAN_BANKS.find((b) => b.name === formData.bankName)?.branches.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Bank Account Number — full width below the 2-col row */}
                    <div className="col-span-2 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <CreditCard className="size-3.5" />
                        Bank Account Number
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required={formData.preferredPayoutMethod === 'Bank Transfer'}
                        value={formData.bankAccountNumber}
                        onChange={(e) => setFormData({ ...formData, bankAccountNumber: e.target.value })}
                        className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                        placeholder="e.g. 1234567890"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Smartphone className="size-3.5 text-green-600" />
                      M-Pesa Mobile Number
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary focus:ring-green-500/50"
                      placeholder="+254 712 345 678"
                    />
                  </div>
                )}

                <div className="flex gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning">
                  <AlertCircle className="size-4 shrink-0" />
                  <p>
                    <strong>NB:</strong> Bad account information will lead to loss of money. Please double-check your payment details.
                  </p>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold flex items-center gap-2">
                      <ShieldCheck className="size-4 text-primary" />
                      Didit KYC Verification
                    </label>
                    <span className="text-xs text-muted-foreground">Required to withdraw funds.</span>
                  </div>
                  {!worker.kycVerified ? (
                    <Button type="button" disabled={startingKyc} onClick={handleStartKyc} size="sm" variant="default" className="h-8 gap-1.5">
                      <ShieldCheck className="size-3.5" />
                      {startingKyc ? 'Starting...' : 'Verify Now'}
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                      <CheckCircle2 className="size-3.5" /> Verified
                    </span>
                  )}
                </div>
                {kycError && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <p>{kycError}</p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Professional Summary / Bio</label>
                <textarea
                  rows={3}
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  className="w-full rounded-lg border border-input bg-card p-3 text-sm outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="Tell employers about your microwork background..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Skills (comma-separated)</label>
                <input
                  type="text"
                  value={formData.skillsStr}
                  onChange={(e) => setFormData({ ...formData, skillsStr: e.target.value })}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Swahili Transcription, Data Entry, Image Labeling"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Languages (comma-separated)</label>
                <input
                  type="text"
                  value={formData.languagesStr}
                  onChange={(e) => setFormData({ ...formData, languagesStr: e.target.value })}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                  placeholder="English (Fluent), Swahili (Native)"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Profile'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
