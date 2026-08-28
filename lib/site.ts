/**
 * Site-wide public configuration.
 *
 * One module, one truth. Before this, contact addresses, payout promises and SLA copy were
 * scattered across eight components (including a `support@example.com` in the maintenance screen,
 * which is exactly the kind of thing a worker emails when a payout is late). Anything user-facing
 * that an operator might need to change belongs here and is read from env on the server, then
 * handed to the client through `NEXT_PUBLIC_*` — never the other way round.
 */

import { env, envInt, isEmailLike, sanitizeLine } from '@/lib/security-core'

export type SiteService = { id: string; label: string; description: string }

export const site = {
  name: 'AfterWorks',
  legalName: 'AfterWorks Inc.',
  tagline: 'Real, verified microwork. Paid to your mobile money.',
  description:
    'AfterWorks connects verified workers with paid microwork — transcription, labelling, content review and data entry. Browsing and applying are always free.',
  url: sanitizeLine(env('NEXT_PUBLIC_APP_URL') || env('APP_URL') || 'http://localhost:3000', 200).replace(/\/$/, ''),
  supportEmail: (isEmailLike(env('NEXT_PUBLIC_SUPPORT_EMAIL')) ? env('NEXT_PUBLIC_SUPPORT_EMAIL') : 'support@afterworks.io').trim().toLowerCase(),
  opsEmail: (isEmailLike(env('NEXT_PUBLIC_OPS_EMAIL')) ? env('NEXT_PUBLIC_OPS_EMAIL') : 'payouts@afterworks.io').trim().toLowerCase(),
  pressEmail: 'press@afterworks.io',
  twitter: 'https://twitter.com/afterworks',
  linkedin: 'https://www.linkedin.com/company/afterworks',
  statusUrl: '/status',
  /** Hours a completed job sits in clearing before it becomes withdrawable. */
  clearingWindowHours: envInt('PAYOUT_CLEARING_WINDOW_HOURS', 72),
  /** Minimum withdrawable balance in USD. */
  minWithdrawalUsd: envInt('MIN_WITHDRAWAL_USD', 10),
  /** SLA shown on the status page and inside the app shell. */
  payoutSla: 'Mobile money payouts are sent within 24 hours of a completed job clearing.',
  /** How long a worker has to hear back on an application. */
  reviewSlaHours: 48,
  /** Commission the platform keeps on a completed job (shown honestly in the FAQ). */
  workerFeePercent: 0,
  trainingFeeUsd: envInt('TRAINING_FEE_USD', 10),
  services: [
    { id: 'jobs', label: 'Jobs & applications', description: 'Browsing, applying and the review queue.' },
    { id: 'wallet', label: 'Wallet & payouts', description: 'Balances, clearing and mobile money transfers.' },
    { id: 'kyc', label: 'ID verification', description: 'Didit-powered identity checks and callbacks.' },
    { id: 'training', label: 'Training & payments', description: 'Paid training modules and Paystack checkout.' },
  ] satisfies SiteService[],
} as const

export type Site = typeof site

export const SITE_FAQ = [
  {
    q: 'Does it cost anything to apply for a job?',
    a: 'No. Browsing, applying, verifying your identity and withdrawing earnings are free. Some job categories ask for a paid training module before your first assignment; the price is shown before you pay.',
  },
  {
    q: 'When do I get paid?',
    a: `Completed work enters a ${site.clearingWindowHours}-hour clearing window so the client can confirm quality. After that it becomes available in your wallet, and mobile money transfers are sent within 24 hours.`,
  },
  {
    q: 'Why do I need ID verification?',
    a: 'Clients pay for work they can trust and regulators require it for paying out. Verification runs through our KYC provider, the document itself never touches AfterWorks servers, and we store only the outcome.',
  },
  {
    q: 'What happens if my submission is rejected?',
    a: 'You get the reason in writing and a revision window. Two clean revisions before QA failure affects your quality score, and one failed QA never affects your wallet balance for work you already completed.',
  },
  {
    q: 'Is my balance safe during maintenance?',
    a: 'Yes. Maintenance blocks the app from taking new actions — it never rolls back data. Balances, applications and verification state live in the same transactional store and are untouched by a maintenance window.',
  },
] as const

/** Trust strip on the dashboard — all figures come from live data at render time. */
export const TRUST_POINTS = [
  { label: 'Zero fees to apply', detail: 'You are never charged to browse or apply.' },
  { label: 'Escrowed payouts', detail: `${site.clearingWindowHours}h clearing, then mobile money in 24h.` },
  { label: 'Verified workers only', detail: 'Government ID + liveness check.' },
] as const
