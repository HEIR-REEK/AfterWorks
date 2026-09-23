/**
 * Admin domain rules — shared by the moderation API and the console UI.
 *
 * Keeping the legal state machine in one place is what stops the UI offering a transition that the
 * API then rejects (the usual symptom of duplicated rules), and gives the buttons real tooltips
 * explaining *why* something is disabled.
 */

export const ADMIN_MUTABLE_STATES = [
  'active',
  'kyc_rejected',
  'kyc_resubmission',
  'kyc_on_hold',
  'kyc_abandoned',
  'kyc_expired',
  'suspended',
  'banned',
] as const

export type AdminMutableState = (typeof ADMIN_MUTABLE_STATES)[number]

export const STATE_LABELS: Record<AdminMutableState, string> = {
  active: 'Active',
  kyc_rejected: 'KYC rejected',
  kyc_resubmission: 'Awaiting resubmission',
  kyc_on_hold: 'On hold',
  kyc_abandoned: 'Verification abandoned',
  kyc_expired: 'Verification expired',
  suspended: 'Suspended',
  banned: 'Banned',
}

export const STATE_HINTS: Record<AdminMutableState, string> = {
  active: 'Full platform access: apply, submit work, withdraw.',
  kyc_rejected: 'Cannot apply until identity verification passes.',
  kyc_resubmission: 'May retry verification from the profile page.',
  kyc_on_hold: 'Manual review in progress; no new applications.',
  kyc_abandoned: 'Verification started but never finished.',
  kyc_expired: 'Verification lapsed; must re-verify.',
  suspended: 'Reversible restriction. Earnings stay locked but safe.',
  banned: 'Permanent restriction. Only support can reverse this.',
}

const ALLOWED: Record<AdminMutableState, AdminMutableState[]> = {
  active: ['suspended', 'banned', 'kyc_on_hold', 'kyc_rejected'],
  kyc_rejected: ['kyc_resubmission', 'active', 'banned'],
  kyc_resubmission: ['kyc_on_hold', 'active', 'kyc_rejected'],
  kyc_on_hold: ['active', 'kyc_rejected', 'suspended'],
  kyc_abandoned: ['kyc_resubmission', 'active'],
  kyc_expired: ['kyc_resubmission', 'active'],
  suspended: ['active', 'banned'],
  banned: ['active'],
}

export function isStateTransitionAllowed(from: string, to: string): boolean {
  if (from === to) return true
  const list = ALLOWED[from as AdminMutableState]
  return list ? list.includes(to as AdminMutableState) : false
}

// ─── Role capabilities ───────────────────────────────────────────────────────
//
// One table for "what may a staff account do", read by the API guards *and* the console UI, so
// a button is never shown that the server then refuses (and vice versa). Owners may do everything.
//
// Staff run the support desk: KYC verdicts, unlocking members who cannot get back in (temporary
// password, restore a suspended account, re-enable a disabled credential, clear a sign-in
// lockout) and audit notes. Anything that *takes* access away, moves money, changes roles,
// or deletes data stays with the main administrator.

export type AdminRoleName = 'owner' | 'staff'

/** `PATCH /api/admin/users` actions a staff session may call (with the payload limits below). */
export const STAFF_USER_ACTIONS = ['kyc', 'temp-password', 'moderate', 'account'] as const

/** `PATCH /api/admin` operator actions a staff session may call. */
export const STAFF_OPERATOR_ACTIONS = ['note', 'unlock'] as const

export type StaffDenial = { allowed: true } | { allowed: false; reason: string }

/**
 * Staff may *restore* but never *restrict*: the only moderation state they can set is `active`,
 * and the only credential change they can make is re-enabling.
 */
export function staffUserActionVerdict(action: string, payload: Record<string, unknown>): StaffDenial {
  if (!(STAFF_USER_ACTIONS as readonly string[]).includes(action)) {
    return { allowed: false, reason: 'Staff accounts can review KYC, reset passwords and restore access. This action is restricted to the main administrator.' }
  }
  if (action === 'moderate' && String(payload.accountState ?? '') !== 'active') {
    return { allowed: false, reason: 'Staff accounts can restore an account to active, but only the main administrator can suspend, ban or hold one.' }
  }
  if (action === 'account' && payload.enable !== true) {
    return { allowed: false, reason: 'Staff accounts can re-enable a sign-in credential, but only the main administrator can disable one.' }
  }
  return { allowed: true }
}

export function staffOperatorActionVerdict(action: string): StaffDenial {
  if (!(STAFF_OPERATOR_ACTIONS as readonly string[]).includes(action)) {
    return { allowed: false, reason: 'This operator action is restricted to the main administrator.' }
  }
  return { allowed: true }
}

/** Human summary shown on the Staff page and in the users drawer footnote. */
export const STAFF_CAPABILITY_SUMMARY = [
  'Review the QA desk and approve or reject KYC',
  'Issue a temporary password to a locked-out member',
  'Restore a suspended account and re-enable a disabled sign-in',
  'Clear a sign-in lockout (console or password-reset)',
  'Pause or reopen job cards and leave audit notes',
] as const

export const OWNER_ONLY_SUMMARY = [
  'Suspend, ban, hold or delete accounts',
  'Wallet adjustments and the money ledger',
  'Staff accounts, roles, maintenance mode, audit log and security settings',
] as const

export type ApplicationAction = 'approve' | 'reject' | 'start' | 'approve_qa' | 'request_revision' | 'fail_qa' | 'requeue'

export const APPLICATION_ACTION_LABELS: Record<ApplicationAction, string> = {
  approve: 'Approve application',
  reject: 'Reject application',
  start: 'Open work window',
  approve_qa: 'Approve work & pay',
  request_revision: 'Request revision',
  fail_qa: 'Fail QA',
  requeue: 'Return to review',
}

export const APPLICATION_ACTION_SIDE_EFFECTS: Partial<Record<ApplicationAction, string>> = {
  approve: 'Reserves one job slot and notifies the worker.',
  reject: 'Releases the slot if it was already reserved.',
  approve_qa: 'Credits the job amount to the worker pending balance (clears in 72h).',
  fail_qa: 'Flags the submission; two consecutive failures lower the quality score.',
}

/** Maps the console buttons onto the Firestore status machine. */
export const ACTION_TO_STATUS: Record<ApplicationAction, string> = {
  approve: 'approved',
  reject: 'rejected',
  start: 'in_progress',
  approve_qa: 'completed',
  request_revision: 'revision_requested',
  fail_qa: 'failed_qa',
  requeue: 'under_review',
}

export const REQUIRED_REASON: ApplicationAction[] = ['reject', 'request_revision', 'fail_qa']
