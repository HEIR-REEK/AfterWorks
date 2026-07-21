# AfterWorks — Full System Documentation

**Version:** 1.0
**Purpose:** End-to-end specification of how every part of the platform connects, including the failure paths, edge cases, and fraud controls that a "happy path only" spec leaves open.

---

## 1. System Overview

AfterWorks connects four core entities, each with its own state machine:

```
USER → VERIFICATION (KYC) → JOB → TRAINING (optional) → APPLICATION → WORK → PAYMENT → REFERRAL
```

Every entity below is documented with: states, transitions, who can trigger each transition, and what happens when something goes wrong. This is the part most specs skip — and it's where loopholes live.

---

## 2. User Account Lifecycle

### 2.1 States
`unregistered → registered → kyc_pending → kyc_verified | kyc_rejected → active → suspended | banned`

### 2.2 Flow

1. **Sign up** — Google OAuth or email/password.
2. **Profile completion** — name, DOB, phone, location, timezone. DOB is mandatory and checked against a minimum age threshold (18+) before any job becomes visible. This is a hard gate, not a soft warning — a 16-year-old should never be able to see a job listing, not even a greyed-out one.
3. **Phone verification** — OTP. One phone number maps to exactly one account (see 2.4 — multi-accounting controls).
4. **KYC verification** (Digital KYC: ID document + face match + liveness check):
   - `kyc_pending` while processing
   - `kyc_verified` on pass → user becomes `active`
   - `kyc_rejected` on fail → user sees rejection reason (blurry ID, face mismatch, expired document, liveness fail) and gets **up to 3 retry attempts** before the account is flagged for manual admin review. Unlimited free retries is itself a loophole — it lets someone iterate against the face-match model.
5. **Dashboard access** — only `active` users see job listings, apply, or access the wallet.

### 2.3 What happens when KYC fails permanently
- Account moves to `kyc_rejected_final`.
- User can submit a manual appeal with a support ticket; a human reviews it. No automated re-submission loop.
- Until resolved, the account cannot apply to jobs, withdraw funds, or generate a referral link. This matters: a rejected-identity account should not be able to refer others or receive referral credit, or you've created a laundering path around KYC.

### 2.4 Multi-accounting / fraud controls at the account layer
- One phone number = one account, enforced at OTP verification, not just at signup form validation (someone could bypass a frontend check by hitting the API directly).
- One KYC'd identity (matched via ID number + face embedding) = one account. If Digital KYC returns a "this face/ID already matched to an existing account" signal, block account creation and flag both accounts for review — don't just silently reject the new one, because the existing one may be the fraudulent duplicate.
- Device/IP fingerprinting at signup, used only as a *secondary* signal (not a hard block, since shared devices are common — e.g., cyber cafés in target markets) to flag clusters of accounts for manual review rather than auto-banning.

---

## 3. Job Lifecycle

### 3.1 States
`draft → published → (open / paused / closed) → archived`

### 3.2 Job structure
Every job record requires: title, description, payment amount and currency, requirements (verified account, optional training), estimated time, capacity (max number of workers), and an expiry/closing condition.

**Loophole this closes:** the original spec had no capacity or expiry field. Without one, a job can be "applied to" indefinitely after the work is already filled, leading to workers completing training and work for a slot that no longer exists — a major trust-killer. Every job needs a `slots_remaining` counter that decrements on approval, not on application (see 4.3).

### 3.3 Job visibility rules
- Only shown to `active` (KYC-verified) users.
- If a job requires training and the user hasn't completed it, the job is still visible but the **Apply** button routes to the training module first, not a dead end.

---

## 4. Application Lifecycle

### 4.1 States
`submitted → under_review → approved | rejected → (if approved) → in_progress → submitted_for_review → completed | revision_requested | failed_qa`

### 4.2 Flow detail

1. **Submitted** — CV (or profile-derived skills) + contact info attached automatically; no separate re-upload needed if a resume is already on file.
2. **Under review** — either automated matching (skills-to-job match score) or manual admin review, depending on job type.
3. **Approved** — slot is reserved (decrement `slots_remaining` here, not earlier).
4. **Rejected** — user gets a reason code (skills mismatch, slots full, KYC issue). Rejection does **not** block reapplication to other jobs.

### 4.3 Why approval — not application — must decrement capacity
If capacity decrements at submission, ten people can "submit" for a 2-slot job and all see a pending state, but the platform has no real signal of who's actually going to fill it. Decrementing only at approval, and auto-expiring `under_review` applications after a set window (e.g., 48 hours) if no admin action is taken, keeps the slot count honest and prevents jobs from looking perpetually "available" when they're actually full.

### 4.4 Work submission and QA
- Worker submits completed task.
- Goes to `submitted_for_review`.
- Reviewer (human or automated quality check, depending on job type) either:
  - **Approves** → triggers payment (Section 6).
  - **Requests revision** → worker can resubmit within a defined window (e.g., 24–48 hrs).
  - **Fails QA permanently** → no payment; reason logged; repeated QA failures on a worker's record affect their eligibility for future jobs (see 4.5).

**Loophole this closes:** the original spec ends application status at "Approved" with no path for what happens *after* approval through to actual payment. Without an explicit work-submission → QA → payment chain, there's no enforcement point to confirm work was actually done before money moves.

### 4.5 Worker quality score
Each worker accumulates a running quality score from QA outcomes. This isn't punitive by default — it's a matching signal. Workers below a threshold are deprioritized for high-payout jobs rather than instantly banned, since a single bad submission shouldn't end someone's access to income. Repeated failures (e.g., 3+ `failed_qa` in a rolling 30-day window) escalate to admin review for potential suspension.

---

## 5. Training (Optional)

### 5.1 Rule
Training is **optional**, not a gate to platform access. It is, however, allowed to be a gate to *specific* job categories — i.e., a job can declare `training_required: true`, in which case the Apply flow redirects there first (per 3.3).

### 5.2 Flow
`not_started → in_progress → completed (assessment passed) | failed_assessment (retry allowed)`

### 5.3 Training fee ($10)
Training itself is optional — a user can skip it entirely and apply to any job that doesn't require it. But if a user chooses to start training, a **$10 fee is mandatory** before Module 1 unlocks. Clicking "Start Training" triggers the payment flow; training content stays locked until payment clears.

**Why this needs careful handling to avoid the pay-to-work trust problem:**

- The fee must be clearly scoped to *training access*, not framed anywhere as a job-application fee or KYC fee — those two must always stay free, since charging for identity verification or job applications is the pattern most associated with scam platforms in this space.
- Jobs that require training should still display the $10 cost upfront on the job card itself (e.g., "Training Required — $10"), not surface it as a surprise only after the user clicks Apply.
- Refund policy needs to be explicit: if a user pays $10, starts training, and fails the assessment, do they get a free retry of the assessment (recommended — retry the test, not the payment) or do they need to pay again? Recommend: **one paid entry grants unlimited assessment retries** for that module, so the fee is for content access, not per-attempt.
- Training fee payment should debit from the user's existing wallet balance first if they have one, falling back to an external payment prompt only if wallet balance is insufficient — avoids forcing a worker who's already earned money on the platform to go through an external payment flow.
- The external payment prompt is handled via **Paystack**. Clicking "Start Training" opens a Paystack checkout (card or mobile money, depending on what Paystack supports in the user's region) for the fixed $10 amount. On Paystack's webhook confirming successful payment, the backend flips training status from `payment_pending` to `paid` and unlocks Module 1 — the unlock must happen on the **webhook event**, not on the frontend redirect back to the app, since a user closing the browser right after paying (before redirect) should still get access once Paystack confirms the charge server-side.
- Failed or abandoned Paystack payments leave the user in `payment_pending` with a clear "Retry Payment" action — no silent retry charges, and no partial unlock.
- Log every training payment as its own transaction type (`training_fee`) in the `transactions` table (Section 9), separate from job-earning transactions, so revenue from training fees vs. worker payouts can be reported independently.

### 5.4 State update
`not_started → payment_pending → paid → in_progress → completed (assessment passed) | failed_assessment (free retry)`

A user who pays but abandons training before completing it keeps `paid` status indefinitely — they should be able to resume later without paying again.

---

## 6. Payments & Wallet

### 6.1 Trigger
Payment is queued automatically the moment an application moves to `completed` (QA-approved). It does not require a separate manual "release funds" step by the worker — only by the platform's payment processor, which runs on a schedule (e.g., daily batch) or instantly via API depending on cost tradeoffs.

### 6.2 Wallet states
- `pending` balance — earned but not yet cleared (e.g., within a dispute window — recommend a short one, like 48–72 hours, during which a client/admin can flag a quality issue post-approval before funds become withdrawable).
- `available` balance — withdrawable.
- `withdrawn` — historical record.

**Loophole this closes:** instant withdrawability the moment QA approves means a compromised reviewer account or a single QA mistake becomes irreversible cash out the door. A short clearing window with no UX cost to the legitimate worker (money still arrives, just not in <1 hour) is a standard safeguard.

### 6.3 Withdrawal
- Minimum withdrawal: $10 (your existing rule).
- **Payout account details are stored, not re-entered every time.** On first withdrawal (or earlier, in Settings), the user adds their payout details — mobile money number (and bank account, if that option is added later) — which gets saved to their profile as their default payout method. Future withdrawals just confirm "Withdraw $X to [saved number]" instead of asking the user to retype it each time, reducing typo-driven failed payouts.
- Stored payout number must match the KYC'd account holder — not an arbitrary mobile money number — to prevent a stolen/compromised account from rerouting payouts to a different number undetected. This check happens once at the time the payout method is *saved*, not re-verified on every withdrawal.
- If a user wants to change their saved payout number, that change itself should trigger a re-verification step (OTP to new number + notification to the old number), not a silent overwrite — and ideally a short cooldown (e.g., 24 hours) before the new number becomes withdrawal-eligible, so a hijacked account can't add a new number and immediately drain the wallet.
- Currency: USD-denominated balance, KES conversion shown at withdrawal-time rate, not locked at earn-time, with the rate displayed before confirmation so there's no surprise.

### 6.4 Failed withdrawals
If a mobile money payout fails (wrong number, network issue), funds return to `available` balance automatically — they should never just vanish into a pending limbo with no UI indication.

---

## 7. Referral System

### 7.1 Confirmed rule
Referral payout triggers only when the referred user **completes a job and is paid** — not at signup, not at KYC, not at job approval. This is the correct anti-fraud anchor point because it requires real money to have already moved before more money moves.

### 7.2 Why this needs visible status, not a black box
Because the chain (signup → KYC → apply → train if needed → work → QA → payment) is long, referrers need a status pipeline so the referral doesn't feel like it disappeared:

```
Referred user: Maria
[✓] Signed up
[✓] KYC Verified
[ ] Job Application Approved
[ ] Work Completed & Paid → Eric earns $3
```

### 7.3 Anti-abuse controls specific to referrals
- **Rate limit**: cap referral signups per referrer per week (e.g., 10) to blunt mass fake-account farming even though payout is gated on real payment — a determined actor could still try to push fake accounts through the full funnel if KYC is weak, so this is a second layer, not the only one.
- **Self-referral block**: referred account's KYC identity (face/ID) must not match the referrer's KYC identity, and device/IP clustering between referrer and referred accounts triggers a hold on the referral payout pending review, not an automatic block (to avoid punishing legitimate cases like family members on shared devices).
- **Referral payout itself goes through the same `pending → available` clearing window** as regular earnings (Section 6.2), so a referral bonus can be clawed back if the underlying job payment is later reversed for fraud.

---

## 8. Admin Platform — Control Points

The admin side isn't just a CRUD panel over the same tables; it's the manual-override layer for every loophole above. Minimum required admin capabilities:

| Area | Capability |
|---|---|
| Users | View KYC status/history, manually approve/reject appeals, suspend/ban, view device/IP cluster flags |
| Jobs | Set capacity, pause/close jobs, view slot fill rate |
| Applications | Override stuck `under_review` states, view auto-expiry log |
| Training | View completion rates, edit modules |
| Payments | View pending→available clearing queue, manually hold/release funds on dispute |
| Withdrawals | View failed withdrawal queue, manually retry |
| Referrals | View flagged self-referral clusters, manually approve/reject held referral payouts |
| Audit log | Every manual override above must be logged with admin ID and timestamp — admins overriding fraud holds is itself a fraud vector if unlogged |

---

## 9. Data Model (Summary)

Recommend dropping the `afterworks_` table prefix unless this database is shared/multi-tenant with other products — otherwise it's redundant noise. Core tables:

- `users` (includes account state, phone, KYC reference)
- `kyc_records` (separate table — ID images/face embeddings should not live in the main users table; restrict access at the database/role level since this is the most sensitive data on the platform)
- `jobs`
- `applications`
- `training_modules`, `training_progress`
- `wallets`, `transactions` (every balance change is an immutable transaction row, not just a balance field overwrite — this is what makes disputes and audits possible)
- `payout_methods` (stored mobile money/bank details per user, separate from `users` for the same reason `kyc_records` is separate — sensitive financial data with its own access controls and change-history log)
- `referrals`
- `admin_audit_log`

---

## 10. End-to-End Flow Diagram

```
 SIGN UP → PHONE OTP → PROFILE → DIGITAL KYC (ID + Face + Liveness)
                                        |
                          PASS ─────────┴───────── FAIL (≤3 retries → manual appeal)
                            |
                      ACTIVE ACCOUNT
                            |
                  BROWSE JOBS (capacity + expiry aware)
                            |
                    APPLY → UNDER REVIEW (auto-expires if stale)
                            |
                  APPROVED (slot decremented here)
                            |
            [if job requires it] → TRAINING (optional otherwise)
                            |
                       WORK SUBMITTED
                            |
                QA REVIEW → REVISION / FAIL / APPROVE
                            |
                    PAYMENT QUEUED (pending balance)
                            |
              CLEARING WINDOW (48–72h, disputable)
                            |
                    AVAILABLE BALANCE
                            |
              WITHDRAW (KYC-matched number only)
                            |
            [if referred] → REFERRAL PAYOUT (same clearing rules)
```

---

## 11. Open Decisions Still Needed From You

These aren't filled in because they're business calls, not technical ones:

1. QA review: human reviewers, automated checks, or hybrid — and at what worker-trust-level does QA get lighter touch?
2. Clearing window length (suggested 48–72h, but depends on your dispute volume tolerance).
3. Referral rate limit number and whether it scales with account tenure/trust level.
4. What happens to in-progress work if a job is paused or closed mid-cycle — do active workers get to finish, or does the platform honor partial payment?
