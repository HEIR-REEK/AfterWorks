/**
 * Referral program — the rules, in one place.
 *
 * Deliberately isomorphic: the referral panel, the sign-up form, the API route and the server
 * that moves the money all import *this* file, so the copy the member reads and the rule the
 * server enforces cannot drift apart.
 *
 * The trigger, chosen on purpose:
 *
 *   A referral is **qualified** when the person you referred completes their profile.
 *   At that moment $3 is credited to *your* pending balance.
 *
 * Not at signup, not at KYC, not at the first paid job. Those are all free to fake — an
 * attacker can sign up and can usually get as far as submitting a document. Completing the
 * profile is the first point at which the referral has cost the referred person real effort, and
 * it is the same event that already pays the $5 welcome reward, so there is one thing to check
 * rather than a second, subtly different rule.
 *
 * The credit goes to **pending**, not to available, for the same reason job earnings do: it sits
 * through the clearing window, so a referral bonus can be reversed if the account behind it is
 * found to be fraudulent, exactly like the earnings it rewarded.
 *
 * The four things that make this an anti-abuse control rather than a money printer, all enforced
 * server-side and none of them client-side:
 *   • a member cannot refer themselves, by uid or by email;
 *   • a referred account is bound to one referrer, permanently;
 *   • a referrer's own KYC must be complete before their code works (a rejected identity account
 *     must not be able to farm signups);
 *   • signups per referrer are capped per week.
 */

import { formatUsd } from '@/lib/afterworks-data'

// ─── The reward ──────────────────────────────────────────────────────────────

/**
 * What a referrer is paid per qualified referral. Server-owned: the member cannot ask for a
 * different amount, and the browser never computes it.
 */
export const REFERRAL_BONUS_USD = 3

/** Human copy used by the panel and by the notification, so both read the same figure. */
export const REFERRAL_BONUS_LABEL = formatUsd(REFERRAL_BONUS_USD)

// ─── Codes ───────────────────────────────────────────────────────────────────

/**
 * Code shape: `AW` + 6 characters from an alphabet with no `0/O/1/I/L` in it.
 *
 * Deliberately not a hash of the uid (that leaks whether two codes are the same person's) and
 * deliberately not sequential (that lets anyone enumerate other members' codes). It is a random
 * draw, checked for collisions at write time, and the mapping lives in a server-only collection.
 */
const CODE_PREFIX = 'AW'
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LENGTH = 6
/** Firestore document id ceiling; the code is short, this is just belt-and-braces for the join. */
export const REFERRAL_CODE_RE = /^AW[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/

/**
 * Accepts anything a person might paste — lowercase, spaces, a copied URL — and returns the
 * canonical code, or `null` when it cannot be one.
 *
 * This runs on untrusted input from a query string, so it normalises and bounds rather than
 * "fixing" what it was given: there is no repair path that could turn one person's typo into
 * another person's code.
 */
export function normaliseReferralCode(input: unknown): string | null {
  // Strip a pasted share link down to its code: ".../sign-up?ref=AWABC123".
  const raw = String(input ?? '')
  const fromUrl = raw.match(/[?&]ref=([A-Za-z0-9_-]{1,32})/)?.[1] ?? raw
  const cleaned = fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (cleaned.length === CODE_PREFIX.length + CODE_LENGTH) return REFERRAL_CODE_RE.test(cleaned) ? cleaned : null
  // Tolerate a missing prefix (people retype these) but never guess the rest.
  if (cleaned.length === CODE_LENGTH && REFERRAL_CODE_RE.test(CODE_PREFIX + cleaned)) return CODE_PREFIX + cleaned
  return null
}

/** A fresh random code. Pure — the caller checks the collection for a collision. */
export function generateReferralCode(random: () => number = Math.random): string {
  let body = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length
    body += CODE_ALPHABET[index]
  }
  return `${CODE_PREFIX}${body}`
}

/** The link a member shares. `baseUrl` is the server's configured origin, never the browser's. */
export function referralShareUrl(baseUrl: string, code: string): string {
  const clean = normaliseReferralCode(code) ?? code.trim().toUpperCase()
  const origin = String(baseUrl ?? '').replace(/\/+$/, '')
  return `${origin}/sign-up?ref=${encodeURIComponent(clean)}`
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * `pending`  — the referred person signed up with your code but has not finished their profile.
 *              Nothing is owed yet and nothing is shown as earned.
 * `qualified`— they completed their profile and the $3 was credited to your pending balance.
 *
 * There is no "rejected" state. A referral that fails to qualify simply stays `pending`, which
 * means "not yet", and an operator reversing the credit writes the reversal to the ledger rather
 * than rewriting history — the same rule the payout queue follows.
 */
export const REFERRAL_STATUSES = ['pending', 'qualified'] as const
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number]

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: 'Awaiting profile',
  qualified: 'Qualified — bonus credited',
}

export const REFERRAL_STATUS_HINT: Record<ReferralStatus, string> = {
  pending: 'They still need to finish their profile. The bonus is released the moment they do.',
  qualified: 'Their profile is complete, so the bonus is in your pending balance and clears with your other earnings.',
}

export type ReferralRow = {
  id: string
  code: string
  referrerUid: string
  /** Snapshot of the referrer at the time of the signup — the panel is a receipt, not a live join. */
  referrerName: string
  referrerEmail: string
  referredUid: string
  referredName: string
  /** The referred person's email is never shown to the referrer — only whether it is verified. */
  referredEmailVerified: boolean
  status: ReferralStatus
  bonusUsd: number
  createdAt: string
  qualifiedAt: string | null
  /** Ledger row that holds the money, so a duplicate release is a no-op rather than a second credit. */
  ledgerId: string | null
}

export type ReferralStats = {
  /** Everyone who signed up with this member's code. */
  total: number
  /** Of those, how many finished their profile. */
  qualified: number
  pending: number
  /** qualified × the bonus. Includes bonuses still sitting in the clearing window. */
  earnedUsd: number
  /** Bonus not yet released — what a completed profile is still worth. */
  pendingUsd: number
}

export function referralStats(rows: readonly ReferralRow[]): ReferralStats {
  const qualified = rows.filter((row) => row.status === 'qualified')
  const earnedUsd = Math.round(qualified.reduce((sum, row) => sum + row.bonusUsd, 0) * 100) / 100
  return {
    total: rows.length,
    qualified: qualified.length,
    pending: rows.length - qualified.length,
    earnedUsd,
    pendingUsd: Math.round((rows.length - qualified.length) * REFERRAL_BONUS_USD * 100) / 100,
  }
}

export type ReferralDashboard = {
  /** The member's own code. Always present — the panel mints one on first view. */
  code: string
  shareUrl: string
  bonusUsd: number
  stats: ReferralStats
  rows: ReferralRow[]
  /** Why the code cannot be shared yet, phrased for the member. Null when it is ready to use. */
  blockedReason: string | null
  canShare: boolean
  asOf: string
}

// ─── The terms, in the words the member signs up to ──────────────────────────

/** Rolling-week cap on signups attributed to one referrer. */
export const REFERRAL_SIGNUP_WEEKLY_LIMIT = 25
export const REFERRAL_SIGNUP_WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The referral terms, as short rules. Rendered in full on `/terms` and, in short, on the referral
 * panel. Kept here rather than in the page so the same bullets cannot disagree with the numbers
 * and thresholds in the rest of this file.
 */
export const REFERRAL_TERMS: readonly { title: string; body: string }[] = [
  {
    title: `Earn ${REFERRAL_BONUS_LABEL} per qualified referral`,
    body: `When someone signs up with your code and completes their profile, ${REFERRAL_BONUS_LABEL} is added to your pending balance. There is no cap on how many people you can refer.`,
  },
  {
    title: 'A referral qualifies when their profile is complete',
    body:
      'The bonus is released the moment the person you referred fills in their profile — name, phone, location, bio, skills and languages. Until then the referral sits as “awaiting profile” and nothing is owed.',
  },
  {
    title: 'The bonus clears like any other earning',
    body:
      'Referral money goes into your pending balance and clears into your available balance on the same schedule as paid work. It is withdrawable once it has cleared and you have reached the minimum withdrawal amount.',
  },
  {
    title: 'One person, one referrer, forever',
    body:
      'An account can only ever be attached to one referrer, and the attachment cannot be moved. You cannot refer yourself, and neither can anybody else refer you using their own address.',
  },
  {
    title: 'Your identity must be verified',
    body:
      'Your code only works while your own identity verification is complete. If your verification is rejected, suspended or later revoked, referral credit stops and any bonus already released may be reversed.',
  },
  {
    title: 'Fair use',
    body: `Signups are capped at ${REFERRAL_SIGNUP_WEEKLY_LIMIT} per referrer per rolling week. Bulk messaging, purchased lists, spam, or accounts created to farm bonuses are not referrals and will be reversed without notice.`,
  },
  {
    title: 'No guaranteed earnings',
    body:
      'The bonus is a fixed amount per qualified referral. It is not a share of what the person you referred earns, it does not compound, and it cannot be withdrawn before the clearing window ends.',
  },
] as const

// ─── Guards (shared by the route and the tests) ──────────────────────────────

export type ReferralClaimDecision =
  | { ok: true }
  | { ok: false; code: string; message: string }

/**
 * Whether a signup may attach this code.
 *
 * `sameEmail` is compared in the canonical form, so `Amina@Example.com` and `amina@example.com`
 * are one person — which is the whole point of the check.
 */
export function evaluateReferralClaim(input: {
  code: string | null
  referrerUid: string
  referrerEmail: string
  referredUid: string
  referredEmail: string
  /** Signups already attributed to this referrer inside the rolling window. */
  recentSignups: number
  referrerKycVerified: boolean
  referrerAccountState: string
}): ReferralClaimDecision {
  const code = normaliseReferralCode(input.code)
  if (!code) {
    return { ok: false, code: 'invalid_referral_code', message: 'That referral link is not valid.' }
  }
  if (input.referrerUid === input.referredUid) {
    return { ok: false, code: 'self_referral', message: 'You cannot refer yourself.' }
  }
  if (input.referrerEmail.trim().toLowerCase() === input.referredEmail.trim().toLowerCase()) {
    return { ok: false, code: 'self_referral', message: 'You cannot refer yourself.' }
  }
  if (!input.referrerKycVerified) {
    return {
      ok: false,
      code: 'referrer_unverified',
      message: 'That referral code is not active yet — its owner has not completed identity verification.',
    }
  }
  if (input.referrerAccountState && input.referrerAccountState !== 'active') {
    return {
      ok: false,
      code: 'referrer_restricted',
      message: 'That referral code is not active because the account that owns it is restricted.',
    }
  }
  if (input.recentSignups >= REFERRAL_SIGNUP_WEEKLY_LIMIT) {
    return {
      ok: false,
      code: 'referral_rate_limited',
      message: 'That account has reached its weekly referral limit. Try again next week.',
    }
  }
  return { ok: true }
}
