/**
 * Binds a Paystack training charge to the job card it was opened for.
 *
 * A reference is an entitlement for exactly one job card. The pending `transactions` row written by
 * `/api/paystack/initialize` and the Paystack metadata both carry that job id; either can be used
 * as the server-side authority, but the browser cannot choose it. This helper is deliberately pure
 * so the rule can be tested without Firestore or Paystack.
 */

export type PaymentBindingInput = {
  /** The job card whose training page is asking for verification. */
  requestedJobId?: unknown
  /** `jobId` on the server-written transactions row, when the row exists. */
  storedJobId?: unknown
  /** `metadata.jobId` on the verified Paystack charge. */
  metadataJobId?: unknown
  /** The authenticated member asking for the entitlement. */
  uid: string
  /** `userId` on the server-written transactions row, when present. */
  storedUserId?: unknown
  /** `metadata.uid` on the verified Paystack charge, when present. */
  metadataUserId?: unknown
}

export type PaymentBindingResult =
  | { ok: true; jobId: string }
  | { ok: false; code: 'missing_job_id' | 'job_mismatch' | 'uid_mismatch'; message: string }

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : ''
}

export function resolvePaymentBinding(input: PaymentBindingInput): PaymentBindingResult {
  const requested = clean(input.requestedJobId)
  if (!requested) {
    return {
      ok: false,
      code: 'missing_job_id',
      message: 'Tell us which job card this payment is for.',
    }
  }

  const storedJob = clean(input.storedJobId)
  const metadataJob = clean(input.metadataJobId)
  const boundJob = storedJob || metadataJob
  if (!boundJob) {
    return {
      ok: false,
      code: 'missing_job_id',
      message: 'This charge is not linked to a job card. Contact support.',
    }
  }

  // If the two server-written records disagree, do not pick one and hope. That is a corrupted or
  // tampered charge, and neither job card should be unlocked from it.
  if (storedJob && metadataJob && storedJob !== metadataJob) {
    return {
      ok: false,
      code: 'job_mismatch',
      message: 'This charge has conflicting job-card details. Contact support before trying again.',
    }
  }

  if (boundJob !== requested) {
    return {
      ok: false,
      code: 'job_mismatch',
      message:
        'That payment was for a different job card. Each job card needs its own payment — open that card to continue, or pay for this one.',
    }
  }

  const storedUid = clean(input.storedUserId)
  const metadataUid = clean(input.metadataUserId)
  if (
    (storedUid && storedUid !== input.uid) ||
    (metadataUid && metadataUid !== input.uid) ||
    (storedUid && metadataUid && storedUid !== metadataUid)
  ) {
    return {
      ok: false,
      code: 'uid_mismatch',
      message: 'This payment belongs to a different account.',
    }
  }

  return { ok: true, jobId: boundJob }
}
