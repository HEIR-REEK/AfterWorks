/**
 * Withdrawal (payout request) domain — one source of truth.
 *
 * Before this module the platform had a wallet that could only ever go up: work was credited into
 * `pending`, clearing was described in copy but never applied, and there was no way for a member to
 * ask for their money. The admin ledger could display a withdrawal row (`kind: 'withdrawal'`) that
 * nothing in the product could create.
 *
 * The rules below are deliberately isomorphic — the worker form, the wallet panel, the admin payout
 * queue and the API routes all import *this* file, so the UI can never offer a transition the server
 * refuses (or hide one it would have allowed), and the money arithmetic is identical on both sides.
 *
 * Money model, in one place:
 *   pendingUsd     credited by QA approval, inside a clearing window, not withdrawable yet
 *   availableUsd   cleared and withdrawable
 *   payoutHoldUsd  claimed by an open payout request; still shown to the member, not spendable
 *   reserved       held = min(payoutHoldUsd, availableUsd) — the part actually set aside
 *   withdrawable   availableUsd − held
 */

import { formatUsd, getExchangeRateUsdToKes } from '@/lib/afterworks-data'

// ─── Money helpers ───────────────────────────────────────────────────────────

/** Money is stored as USD to the cent. One rounding helper, used by every writer. */
export function roundUsd(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/**
 * Everything the member owns in the wallet: cleared money plus money still clearing.
 *
 * `heldUsd` is deliberately not added again. A payout request claims part of `availableUsd`
 * rather than moving it out, so `available + pending` already includes money that is on hold and
 * not currently withdrawable. Adding held would count the same dollars twice.
 */
export function totalWalletUsd(input: { availableUsd: number; pendingUsd: number }): number {
  return roundUsd(Math.max(0, input.availableUsd || 0) + Math.max(0, input.pendingUsd || 0))
}

/** True when a value is a sane monetary amount (0 … 1,000,000 USD). */
export function isMoney(value: unknown, { min = 0, max = 1_000_000 }: { min?: number; max?: number } = {}): boolean {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max
}

// ─── Status machine ──────────────────────────────────────────────────────────

export const PAYOUT_STATUSES = ['pending', 'approved', 'processing', 'paid', 'rejected', 'failed', 'cancelled'] as const

export type PayoutRequestStatus = (typeof PAYOUT_STATUSES)[number]

/** Statuses that still hold money. `approved`/`processing` are settled steps on the way to `paid`. */
export const OPEN_PAYOUT_STATUSES: readonly PayoutRequestStatus[] = ['pending', 'approved', 'processing']

/** Statuses that release the hold (the money goes back to the member's available balance). */
export const RELEASED_PAYOUT_STATUSES: readonly PayoutRequestStatus[] = ['rejected', 'failed', 'cancelled']

/** Statuses the member may still cancel themselves. Once a transfer is with the provider it is out of their hands. */
export const CANCELLABLE_PAYOUT_STATUSES: readonly PayoutRequestStatus[] = ['pending', 'approved']

export function isCancellablePayoutStatus(status: string): boolean {
  return (CANCELLABLE_PAYOUT_STATUSES as readonly string[]).includes(status)
}

export function isOpenPayoutStatus(status: string): status is PayoutRequestStatus {
  return (OPEN_PAYOUT_STATUSES as readonly string[]).includes(status)
}

export const PAYOUT_STATUS_LABELS: Record<PayoutRequestStatus, string> = {
  pending: 'Awaiting review',
  approved: 'Approved — queued for payout',
  processing: 'Payout in progress',
  paid: 'Paid',
  rejected: 'Rejected — funds returned',
  failed: 'Payout failed — funds returned',
  cancelled: 'Cancelled — funds returned',
}

/** Short labels for dense tables and badges. */
export const PAYOUT_STATUS_SHORT: Record<PayoutRequestStatus, string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  processing: 'Processing',
  paid: 'Paid',
  rejected: 'Rejected',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export const PAYOUT_STATUS_TONE: Record<PayoutRequestStatus, StatusTone> = {
  pending: 'warning',
  approved: 'info',
  processing: 'info',
  paid: 'success',
  rejected: 'danger',
  failed: 'danger',
  cancelled: 'neutral',
}

/**
 * Legal moves for one request. The console renders a button per entry and the API validates against
 * the same table, so "Reject" is simply absent once the queue has already paid the member.
 */
const PAYOUT_TRANSITIONS: Record<PayoutRequestStatus, readonly PayoutRequestStatus[]> = {
  pending: ['approved', 'processing', 'paid', 'rejected', 'cancelled'],
  approved: ['processing', 'paid', 'rejected', 'failed', 'cancelled'],
  // A payout that is in flight can only finish (paid) or bounce (failed).
  processing: ['paid', 'failed'],
  paid: [],
  rejected: [],
  failed: [],
  cancelled: [],
}

export function canTransitionPayout(from: string, to: string): boolean {
  if (from === to) return true
  const allowed = PAYOUT_TRANSITIONS[from as PayoutRequestStatus]
  return Boolean(allowed && allowed.includes(to as PayoutRequestStatus))
}

export function nextPayoutStatuses(from: string): PayoutRequestStatus[] {
  return [...(PAYOUT_TRANSITIONS[from as PayoutRequestStatus] ?? [])]
}

export const PAYOUT_ACTION_LABELS: Record<PayoutRequestStatus, string> = {
  pending: 'Return to review',
  approved: 'Approve request',
  processing: 'Mark as sent to provider',
  paid: 'Mark as paid',
  rejected: 'Reject & refund',
  failed: 'Mark payout failed & refund',
  cancelled: 'Cancel request',
}

export const PAYOUT_ACTION_HINTS: Partial<Record<PayoutRequestStatus, string>> = {
  approved: 'Confirms the destination details look right. The money stays held.',
  processing: 'Use this after the transfer has been handed to M-Pesa / the bank.',
  paid: 'Closes the request and debits the held amount. A payout reference is required.',
  rejected: 'Returns the held amount to the member’s available balance and notifies them.',
  failed: 'Use when the provider bounces the transfer. The hold is released back to the member.',
  cancelled: 'The member asked for their money back before the transfer was sent.',
}

/** Transitions that must carry a written reason (rejections always explain themselves). */
export const PAYOUT_REASON_REQUIRED: readonly PayoutRequestStatus[] = ['rejected', 'failed']

/** Reference is the provider receipt (M-Pesa code, bank ref) — required for `paid`. */
export function requiresPayoutReference(to: PayoutRequestStatus): boolean {
  return to === 'paid'
}

// ─── Destination (where the money goes) ──────────────────────────────────────

export const PAYOUT_METHODS = ['M-Pesa', 'Bank Transfer', 'PayPal'] as const

export type PayoutMethod = (typeof PAYOUT_METHODS)[number]

/**
 * Methods that can actually be *paid* today.
 *
 * PayPal is offered in the wallet and on the profile so members can record where the money should
 * go, but no disbursement integration is wired yet. `PAYOUT_METHODS` drives what may be stored;
 * this list drives what the console may mark as sent. Keeping them separate is what lets the UI be
 * shipped before the logic, without ever letting a PayPal request be quietly marked "paid" by hand.
 */
export const PAYABLE_PAYOUT_METHODS: readonly PayoutMethod[] = ['M-Pesa', 'Bank Transfer']

/** True when this method can be disbursed right now. */
export function isPayoutMethodPayable(method: PayoutMethod): boolean {
  return PAYABLE_PAYOUT_METHODS.includes(method)
}

/** Member-facing explanation for a method that is saved but not yet payable. */
export function payoutMethodPendingNote(method: PayoutMethod): string | null {
  return isPayoutMethodPayable(method)
    ? null
    : 'We have your details saved. PayPal withdrawals are not switched on yet — request a payout to M-Pesa or a bank account, and we will email you when PayPal is live.'
}

export type PayoutDestination = {
  method: PayoutMethod
  /** Account holder name — the KYC name, captured on the request so the receipt is unambiguous. */
  accountName: string
  /** M-Pesa number. Empty for bank payouts. */
  accountNumber: string
  /** Bank fields; empty for M-Pesa payouts. */
  bankName: string
  bankBranch: string
  bankAccountNumber: string
  /** PayPal account email. Empty for M-Pesa and bank payouts. */
  paypalEmail: string
}

export type DestinationValidation =
  | { ok: true; destination: PayoutDestination }
  | { ok: false; error: string; field?: string }

const KE_PHONE = /^(?:\+?254|0)7\d{8}$/
const KE_PHONE_ALT = /^(?:\+?254|0)(?:1\d{8})$/

/** Kenyan mobile money numbers: +254 7XX XXX XXX, 07XX…, 254 1XX… (Safaricom / Airtel / Telkom). */
export function isValidMobileNumber(raw: unknown): boolean {
  const value = String(raw ?? '').replace(/[\s()-]/g, '')
  return KE_PHONE.test(value) || KE_PHONE_ALT.test(value)
}

export function isValidBankAccountNumber(raw: unknown): boolean {
  const value = String(raw ?? '').replace(/[\s-]/g, '')
  return /^\d{6,20}$/.test(value)
}

/**
 * A PayPal account is identified by an email address, so the address *is* the account — a typo
 * means the money lands in a stranger's balance. Deliberately strict: one `@`, a dotted domain, no
 * whitespace, and a bounded length. `isEmailLike` in security-core is the general-purpose check used
 * for form fields; this one is narrower because it protects a payment.
 */
export function isValidPayPalEmail(raw: unknown): boolean {
  const value = String(raw ?? '').trim()
  if (value.length < 6 || value.length > 254) return false
  if (/\s/.test(value)) return false
  return /^[^@]{1,64}@[^@.]+(?:\.[^@.]+)+$/.test(value)
}

/** `+254 7•• ••• 678` — enough for the member to recognise their own number, useless to a stranger. */
export function maskAccountNumber(raw: unknown): string {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 4) return value
  const head = value.slice(0, Math.min(5, value.length - 4))
  const tail = value.slice(-3)
  return `${head}${'•'.repeat(Math.max(3, value.length - head.length - tail.length))}${tail}`
}

/**
 * `a•••••@example.com` — keeps the domain (so the member recognises the account) and reduces the
 * local part to its first character. A one-character local part still yields one bullet.
 */
export function maskEmail(raw: unknown): string {
  const value = String(raw ?? '').trim()
  const at = value.lastIndexOf('@')
  if (at <= 0) return value
  const local = value.slice(0, at)
  const domain = value.slice(at)
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(3, local.length - 1))}${domain}`
}

/**
 * Validates a payout destination. Called by the profile form (immediate feedback), by
 * `PATCH /api/profile` (before it is saved) and again by `POST /api/payouts` (before money moves) —
 * a validation that only runs in the browser is decoration.
 */
export function validatePayoutDestination(input: {
  method?: unknown
  accountName?: unknown
  accountNumber?: unknown
  phone?: unknown
  bankName?: unknown
  bankBranch?: unknown
  bankAccountNumber?: unknown
  paypalEmail?: unknown
}): DestinationValidation {
  const methodValue = String(input.method ?? '').trim()
  // An unrecognised method must never be coerced to a default. This used to read
  // `methodValue === 'Bank Transfer' ? 'Bank Transfer' : 'M-Pesa'`, which would have silently
  // turned every PayPal withdrawal into an M-Pesa transfer to whatever phone number was on file —
  // the member asks for PayPal and the money goes to mobile money instead. Unknown is an error.
  const method = (PAYOUT_METHODS as readonly string[]).includes(methodValue)
    ? (methodValue as PayoutMethod)
    : null
  if (!method) {
    return {
      ok: false,
      error: methodValue
        ? 'Choose how you want to be paid (M-Pesa, bank transfer or PayPal).'
        : 'Choose how you want to be paid before requesting a payout.',
      field: 'method',
    }
  }
  const accountName = String(input.accountName ?? '').trim().slice(0, 120)
  if (accountName.length < 3) {
    return { ok: false, error: 'Add the account holder’s full name (it must match your verified ID).', field: 'accountName' }
  }

  if (method === 'PayPal') {
    const paypalEmail = String(input.paypalEmail ?? '').trim().slice(0, 254)
    if (!paypalEmail) {
      return { ok: false, error: 'Add the email address on your PayPal account.', field: 'paypalEmail' }
    }
    if (!isValidPayPalEmail(paypalEmail)) {
      return { ok: false, error: 'Enter a valid PayPal email, e.g. you@example.com.', field: 'paypalEmail' }
    }
    // Everything else is cleared so a request cannot carry two destinations at once — a stale
    // bank account or M-Pesa number next to a PayPal address is how a payout reaches the wrong place.
    return {
      ok: true,
      destination: {
        method,
        accountName,
        accountNumber: '',
        bankName: '',
        bankBranch: '',
        bankAccountNumber: '',
        paypalEmail: paypalEmail.toLowerCase(),
      },
    }
  }

  if (method === 'Bank Transfer') {
    const bankName = String(input.bankName ?? '').trim().slice(0, 80)
    const bankBranch = String(input.bankBranch ?? '').trim().slice(0, 80)
    const bankAccountNumber = String(input.bankAccountNumber ?? '').trim().slice(0, 32)
    if (!bankName) return { ok: false, error: 'Choose your bank.', field: 'bankName' }
    if (!bankBranch) return { ok: false, error: 'Choose your bank branch.', field: 'bankBranch' }
    if (!isValidBankAccountNumber(bankAccountNumber)) {
      return { ok: false, error: 'Enter a valid bank account number (6–20 digits).', field: 'bankAccountNumber' }
    }
    return {
      ok: true,
      destination: {
        method,
        accountName,
        accountNumber: bankAccountNumber,
        bankName,
        bankBranch,
        bankAccountNumber,
        paypalEmail: '',
      },
    }
  }

  const phone = String(input.phone ?? input.accountNumber ?? '').trim().slice(0, 24)
  if (!isValidMobileNumber(phone)) {
    return { ok: false, error: 'Enter a valid M-Pesa number, e.g. 0712 345 678.', field: 'phone' }
  }
  return {
    ok: true,
    destination: { method, accountName, accountNumber: phone, bankName: '', bankBranch: '', bankAccountNumber: '', paypalEmail: '' },
  }
}

// ─── Presentation (client-safe) ─────────────────────────────────────────────

/**
 * Everything the UI needs to *name* a payout method, in one place.
 *
 * The pages used to branch on `method === 'Bank Transfer' ? … : …` in four different files, which
 * worked while there were two methods and silently mislabels a third (PayPal rendered as M-Pesa).
 * One helper means a fourth method is a one-line change here rather than a hunt.
 */
export type PayoutMethodPresentation = {
  method: PayoutMethod
  /** Short label for a badge or a select option. */
  label: string
  /** Noun for "paid to your …": bank account / M-Pesa number / PayPal account. */
  destinationNoun: string
  /** One line of member-facing copy. */
  description: string
  /** True when money can actually be sent this way today. */
  payable: boolean
}

export const PAYOUT_METHOD_PRESENTATION: Record<PayoutMethod, PayoutMethodPresentation> = {
  'M-Pesa': {
    method: 'M-Pesa',
    label: 'M-Pesa',
    destinationNoun: 'M-Pesa number',
    description: 'Sent to your mobile-money number. It must match the name on your verified ID.',
    payable: true,
  },
  'Bank Transfer': {
    method: 'Bank Transfer',
    label: 'Bank transfer',
    destinationNoun: 'bank account',
    description: 'Sent to your bank account. Transfers can take one working day to appear.',
    payable: true,
  },
  PayPal: {
    method: 'PayPal',
    label: 'PayPal',
    destinationNoun: 'PayPal account',
    description:
      'Sent to the email address on your PayPal account. Withdrawals are not switched on yet — your details are saved and we will email you when they are live.',
    payable: false,
  },
}

/** Presentation for a method value that may have come from a document (so: string). */
export function payoutMethodPresentation(method: unknown): PayoutMethodPresentation {
  const value = String(method ?? '')
  return (PAYOUT_METHOD_PRESENTATION as Record<string, PayoutMethodPresentation>)[value] ??
    PAYOUT_METHOD_PRESENTATION['M-Pesa']
}

/** One-line human description of where a payout is going. */
export function describeDestination(destination: PayoutDestination, { masked = true }: { masked?: boolean } = {}): string {
  if (destination.method === 'PayPal') {
    // Mask the local part: the console and the request receipt both show this string, and a PayPal
    // address is an identifier as well as a contact detail. `maskAccountNumber` is digit-based and
    // would print a short local part in full, so this needs its own reducer.
    const email = destination.paypalEmail || ''
    return `PayPal · ${masked ? maskEmail(email) : email || 'no address saved'}`
  }
  if (destination.method === 'Bank Transfer') {
    const account = masked ? maskAccountNumber(destination.bankAccountNumber) : destination.bankAccountNumber
    return `Bank transfer · ${destination.bankName}${destination.bankBranch ? ` (${destination.bankBranch})` : ''} · ${account}`
  }
  const number = masked ? maskAccountNumber(destination.accountNumber) : destination.accountNumber
  return `M-Pesa · ${number}`
}

// ─── Amount checks ───────────────────────────────────────────────────────────

export type WithdrawalQuote = {
  /** Available balance, before the hold. */
  availableUsd: number
  /** Amount already claimed by open payout requests. */
  heldUsd: number
  /** availableUsd − heldUsd, floored at zero. */
  withdrawableUsd: number
  /** Withdrawable converted to KES at today's displayed rate (not locked at earn time). */
  withdrawableKes: number
  /** Amount in KES for a specific request (0 when nothing is typed yet). */
  amountKes: number
  minWithdrawalUsd: number
  maxWithdrawalUsd: number
  usdToKes: number
}

/** What the member can ask for right now, from the numbers the server computed. */
export function withdrawalQuote(input: {
  availableUsd: number
  heldUsd?: number
  amountUsd?: number
  minWithdrawalUsd: number
  usdToKes?: number
}): WithdrawalQuote {
  const availableUsd = roundUsd(Math.max(0, input.availableUsd || 0))
  const heldUsd = roundUsd(Math.max(0, Math.min(input.heldUsd ?? 0, availableUsd)))
  const withdrawableUsd = roundUsd(Math.max(0, availableUsd - heldUsd))
  const usdToKes = input.usdToKes && input.usdToKes > 0 ? input.usdToKes : getExchangeRateUsdToKes()
  const amountUsd = roundUsd(Math.max(0, input.amountUsd ?? 0))
  return {
    availableUsd,
    heldUsd,
    withdrawableUsd,
    withdrawableKes: Math.round(withdrawableUsd * usdToKes),
    amountKes: Math.round(amountUsd * usdToKes),
    minWithdrawalUsd: input.minWithdrawalUsd,
    maxWithdrawalUsd: withdrawableUsd,
    usdToKes,
  }
}

/**
 * Validates an amount against the withdrawable balance. Shared by the form (so the member sees the
 * reason before submitting) and the route (so the reason the server gives is the same one).
 */
export function validateWithdrawalAmount(
  amountUsd: number,
  withdrawableUsd: number,
  minWithdrawalUsd: number,
): { ok: true; amountUsd: number } | { ok: false; error: string } {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return { ok: false, error: 'Enter the amount you want to withdraw.' }
  }
  const amount = roundUsd(amountUsd)
  if (amount < minWithdrawalUsd) {
    return { ok: false, error: `The minimum withdrawal is ${formatUsd(minWithdrawalUsd)}.` }
  }
  if (amount > withdrawableUsd + 0.001) {
    return {
      ok: false,
      error:
        withdrawableUsd <= 0
          ? 'Nothing is withdrawable yet. Cleared earnings appear here after the clearing window.'
          : `You can withdraw up to ${formatUsd(withdrawableUsd)} right now.`,
    }
  }
  return { ok: true, amountUsd: amount }
}

// ─── Row shape shared by the wallet panel and the console ────────────────────

export const PAYOUT_MAX_PER_PAGE = 100

export type PayoutRequestRow = {
  id: string
  uid: string
  email: string
  name: string
  amountUsd: number
  amountKes: number
  status: PayoutRequestStatus
  method: PayoutMethod
  /** Masked for the console list; the full value only travels inside the request it belongs to. */
  destinationLabel: string
  destination: PayoutDestination
  requestedAt: string
  updatedAt: string
  /** Timestamp the money is expected to leave in; set when the request is submitted. */
  payoutBy: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  paidAt: string | null
  payoutReference: string
  reason: string
  history: { status: PayoutRequestStatus; at: string; by?: string; note?: string }[]
}

export type PayoutQueueSummary = {
  pending: number
  approved: number
  processing: number
  paid: number
  rejected: number
  failed: number
  cancelled: number
  /** Value still held for members by open requests, in USD. */
  heldUsd: number
  /** Value paid out through this queue (all-time, capped scan), in USD. */
  paidUsd: number
  oldestPendingAt: string | null
}

export const EMPTY_PAYOUT_SUMMARY: PayoutQueueSummary = {
  pending: 0,
  approved: 0,
  processing: 0,
  paid: 0,
  rejected: 0,
  failed: 0,
  cancelled: 0,
  heldUsd: 0,
  paidUsd: 0,
  oldestPendingAt: null,
}

/** Sanitises an arbitrary document into a row the UI can trust. */
export function mapPayoutRequest(id: string, data: Record<string, unknown>): PayoutRequestRow {
  const status = (PAYOUT_STATUSES as readonly string[]).includes(String(data.status))
    ? (String(data.status) as PayoutRequestStatus)
    : 'pending'
  // Same coercion trap as the validator: this used to map everything except "Bank Transfer" to
  // M-Pesa, so a stored PayPal request would have been displayed as a mobile-money transfer.
  const rawMethod = String(data.method ?? data.payoutMethod ?? 'M-Pesa')
  const destination: PayoutDestination = {
    method: (PAYOUT_METHODS as readonly string[]).includes(rawMethod)
      ? (rawMethod as PayoutMethod)
      : 'M-Pesa',
    accountName: String(data.accountName ?? ''),
    accountNumber: String(data.accountNumber ?? ''),
    bankName: String(data.bankName ?? ''),
    bankBranch: String(data.bankBranch ?? ''),
    bankAccountNumber: String(data.bankAccountNumber ?? ''),
    paypalEmail: String(data.paypalEmail ?? ''),
  }
  const history = Array.isArray(data.history)
    ? (data.history as Record<string, unknown>[]).map((entry) => ({
        status: String(entry.status ?? 'pending') as PayoutRequestStatus,
        at: String(entry.at ?? ''),
        by: entry.by ? String(entry.by) : undefined,
        note: entry.note ? String(entry.note) : undefined,
      }))
    : []

  return {
    id,
    uid: String(data.uid ?? ''),
    email: String(data.email ?? ''),
    name: String(data.name ?? ''),
    amountUsd: roundUsd(Number(data.amountUsd ?? 0) || 0),
    amountKes: Math.round(Number(data.amountKes ?? 0) || 0),
    status,
    method: destination.method,
    destinationLabel: String(data.destinationLabel ?? '') || describeDestination(destination),
    destination,
    requestedAt: String(data.requestedAt ?? data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? data.requestedAt ?? data.createdAt ?? ''),
    payoutBy: data.payoutBy ? String(data.payoutBy) : null,
    reviewedBy: data.reviewedBy ? String(data.reviewedBy) : null,
    reviewedAt: data.reviewedAt ? String(data.reviewedAt) : null,
    paidAt: data.paidAt ? String(data.paidAt) : null,
    payoutReference: String(data.payoutReference ?? ''),
    reason: String(data.reason ?? ''),
    history,
  }
}

/** Copy the member sees on the wallet panel for their current request. */
export function payoutStatusCopy(row: PayoutRequestRow, { payoutSla }: { payoutSla: string }): string {
  switch (row.status) {
    case 'pending':
      return `Request received. ${payoutSla}`
    case 'approved':
      return 'Approved and queued. The transfer is handed to the provider on the next payout run.'
    case 'processing':
      return 'The transfer is with the provider. Mobile money usually lands within minutes; banks can take longer.'
    case 'paid':
      return row.payoutReference
        ? `Paid. Provider reference ${row.payoutReference}.`
        : 'Paid. Check your mobile money statement.'
    case 'rejected':
      return row.reason ? `Rejected — the money is back in your available balance. Reason: ${row.reason}` : 'Rejected — the money is back in your available balance.'
    case 'failed':
      return row.reason
        ? `The provider could not complete this payout, so the money is back in your balance. Reason: ${row.reason}`
        : 'The provider could not complete this payout, so the money is back in your balance.'
    case 'cancelled':
      return 'You cancelled this request, so the money is back in your available balance.'
    default:
      return ''
  }
}

// ─── Wallet snapshot (what the server hands the wallet panel) ────────────────

export type WalletEntry = {
  id: string
  kind: string
  amountUsd: number
  status: string
  createdAt: string
  clearedAt: string | null
  description: string
  jobTitle: string
  applicationId: string
  reference: string
}

export type PayoutDestinationState = {
  /** True when a payout can be sent to the details on file. */
  ready: boolean
  method: PayoutMethod
  /** Masked, human description of the saved destination. */
  label: string
  accountName: string
  /** What is missing, phrased for the member (null when ready). */
  problem: string | null
  /**
   * Set when the destination is saved and valid but the method cannot be disbursed yet (PayPal,
   * today). The wallet shows this instead of a Request button, so a member is told what is
   * happening rather than discovering it when a request is refused.
   */
  notYetPayable?: string | null
}

export type WelcomeBonusState = {
  /** Amount the platform pays for a 100% profile. */
  amountUsd: number
  granted: boolean
  grantedAt: string | null
  /** True when an operator deliberately onboarded this member with the reward still to come. */
  pendingFromStaff: boolean
}

/**
 * Everything the wallet panel, the dashboard and the payout form need, computed by the server from
 * the ledger, the user document and the payout queue. The client never derives a balance.
 */
export type WalletSnapshot = {
  pendingUsd: number
  availableUsd: number
  /** availableUsd + pendingUsd — every dollar in the account, withdrawable or not. */
  totalUsd: number
  /** Claimed by open payout requests; still displayed to the member, no longer spendable. */
  heldUsd: number
  /** availableUsd − heldUsd. */
  withdrawableUsd: number
  payoutNumber: string
  preferredPayoutMethod: PayoutMethod
  clearingHours: number
  minWithdrawalUsd: number
  nextClearingAt: string | null
  usdToKes: number
  availableKes: number
  withdrawableKes: number
  pendingKes: number
  entries: WalletEntry[]
  paidTrainings: string[]
  qualityScore: number
  jobsCompleted: number
  accountState: string
  kycVerified: boolean
  destination: PayoutDestinationState
  openPayout: PayoutRequestRow | null
  payoutRequests: PayoutRequestRow[]
  welcomeBonus: WelcomeBonusState
  asOf: string
  /** True when the datastore could not be reached — the UI says so instead of showing zeros. */
  unavailable?: boolean
}
