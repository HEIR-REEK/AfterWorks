/**
 * Profile completion — one scoring rule, read by the popup, the profile page, the dashboard and the
 * server that actually pays the welcome reward.
 *
 * The reward used to depend on a hand-written list inside `/api/wallet/welcome-bonus` while the
 * dashboard drew its own progress bar from a *different* list, so a member could see "100%" on the
 * dashboard and still be told their profile was incomplete. Both now read this module, and the
 * popup keeps naming the exact fields still missing.
 */

import { sanitizeLine } from '@/lib/security-core'

/** Fields that must be present before the welcome reward is released. */
export const PROFILE_REQUIRED_FIELDS = ['name', 'phone', 'location', 'bio', 'skills', 'languages'] as const

export type ProfileRequiredField = (typeof PROFILE_REQUIRED_FIELDS)[number]

export const PROFILE_FIELD_LABELS: Record<ProfileRequiredField, string> = {
  name: 'Full name',
  phone: 'Mobile money phone number',
  location: 'City / region',
  bio: 'Professional summary',
  skills: 'Skills',
  languages: 'Languages',
}

/** The reward for a complete profile. Server-owned: the member cannot ask for a different amount. */
export const WELCOME_BONUS_USD = 5

/**
 * Fields a member may write about themselves. Privileges (`role`, `kycVerified`, `wallet`, …) are
 * absent on purpose — the API rejects anything outside this list, and so do the Firestore rules.
 */
export const MEMBER_PROFILE_FIELDS = [
  'name',
  'phone',
  'location',
  'country',
  'zipCode',
  'bio',
  'skills',
  'languages',
  'preferredPayoutMethod',
  'bankName',
  'bankBranch',
  'bankAccountNumber',
  'school',
  'course',
  'jobExperience',
  'career',
] as const

export type MemberProfileField = (typeof MEMBER_PROFILE_FIELDS)[number]

export type ProfileCompletion = {
  /** 0–100, rounded. */
  percent: number
  checks: Record<ProfileRequiredField, boolean>
  /** Fields still empty, in form order — what the popup lists. */
  missing: ProfileRequiredField[]
  missingLabels: string[]
  complete: boolean
}

function hasText(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return false
}

/** Scores a user document (or any partial profile object) against the required fields. */
export function profileCompletion(data: Record<string, unknown> | null | undefined): ProfileCompletion {
  const source = data ?? {}
  const checks = PROFILE_REQUIRED_FIELDS.reduce(
    (acc, key) => {
      acc[key] = hasText(source[key])
      return acc
    },
    {} as Record<ProfileRequiredField, boolean>,
  )
  const missing = PROFILE_REQUIRED_FIELDS.filter((key) => !checks[key])
  const percent = Math.round(((PROFILE_REQUIRED_FIELDS.length - missing.length) / PROFILE_REQUIRED_FIELDS.length) * 100)
  return {
    percent,
    checks,
    missing,
    missingLabels: missing.map((key) => PROFILE_FIELD_LABELS[key]),
    complete: missing.length === 0,
  }
}

export type ProfileFieldPatch = Partial<Record<MemberProfileField, string | string[]>>

/**
 * Normalises an untrusted profile patch into the exact document update to write.
 *
 * Only `MEMBER_PROFILE_FIELDS` survive, every string is length-capped and control-character
 * stripped, list fields are de-duplicated, and an M-Pesa member never keeps a stale bank account
 * that a later payout could pick up. Unknown keys are reported so the UI can say what was ignored
 * instead of silently dropping a member's edit.
 */
export function sanitiseProfilePatch(
  input: Record<string, unknown>,
  { method }: { method?: unknown } = {},
): { patch: ProfileFieldPatch; dropped: string[] } {
  const patch: ProfileFieldPatch = {}
  const dropped: string[] = []

  for (const [key, raw] of Object.entries(input)) {
    if (!(MEMBER_PROFILE_FIELDS as readonly string[]).includes(key)) {
      dropped.push(key)
      continue
    }
    if (raw === undefined) continue
    if (Array.isArray(raw)) {
      const list = Array.from(
        new Set(
          raw
            .map((entry) => sanitizeLine(entry, 48))
            .filter((entry) => entry.length > 0),
        ),
      ).slice(0, 25)
      patch[key as MemberProfileField] = list
      continue
    }
    if (typeof raw !== 'string') {
      dropped.push(key)
      continue
    }
    const max = key === 'bio' ? 800 : key === 'jobExperience' ? 600 : 160
    patch[key as MemberProfileField] = sanitizeLine(raw, max)
  }

  // "M-Pesa" members must not carry bank details around: a payout that reads a stale account
  // number after a method switch is a support ticket at best and a mis-payment at worst.
  const nextMethod = typeof method === 'string' ? method : (patch.preferredPayoutMethod as string | undefined)
  if (nextMethod && nextMethod !== 'Bank Transfer') {
    patch.bankName = ''
    patch.bankBranch = ''
    patch.bankAccountNumber = ''
  } else if (nextMethod === 'Bank Transfer') {
    // The reverse also holds: a bank payer has no M-Pesa number to fall back to.
    patch.phone = patch.phone ?? undefined
  }

  return { patch, dropped }
}

/** The completion of a save result, for the reward decision the server makes. */
export function profilePatchCompletes(merged: Record<string, unknown>): ProfileCompletion {
  return profileCompletion(merged)
}
