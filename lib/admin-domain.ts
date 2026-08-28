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
