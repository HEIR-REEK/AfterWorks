# AfterWorks Prototype — Complete Implementation

Full implementation of the AfterWorks platform matching all system documentation requirements. Includes Firebase auth, Digital KYC with fraud controls, Paystack payments, job marketplace with capacity management, training system with modules, wallet with clearing windows, referrals with rate limiting and self-referral blocks, device fingerprinting for fraud detection, and comprehensive admin controls with audit trails.

## Quick Start

1. **Copy and configure environment:**

```bash
cp .env.example .env
# Edit .env with database, Firebase, and Paystack credentials (see below)
```

2. **Install dependencies:**

```bash
npm install
```

3. **Set up database and Prisma:**

```bash
npx prisma generate
npx prisma db push
```

4. **Start server:**

```bash
npm run dev
```

**Server runs on:** `http://localhost:4000`  
**Health check:** `GET http://localhost:4000/health` → `{"ok":true}`

## Configuration (`.env`)

```bash
# DATABASE CONNECTION
# PostgreSQL (production recommended)
DATABASE_URL="postgresql://user:password@localhost:5432/afterworks"
# OR SQLite (local development)
DATABASE_URL="file:./dev.db"

# FIREBASE (download service account from Firebase Console → Project Settings → Service Accounts)
FIREBASE_SERVICE_ACCOUNT_PATH="./serviceAccountKey.json"

# PAYSTACK (get from https://paystack.com → Settings → API Keys & Webhooks)
PAYSTACK_SECRET_KEY=sk_test_xxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
PAYSTACK_TRAINING_AMOUNT=1000  # In cents (1000 = $10 USD)

# SERVER
PORT=4000
NODE_ENV=development
```

## Architecture

- **Backend:** Express.js 4.18 + Node.js 16+
- **ORM:** Prisma 5.11 (PostgreSQL/SQLite/MySQL)
- **Authentication:** Firebase Admin SDK (OAuth + ID token verification + middleware)
- **Payments:** Paystack API (training, job payouts, referral bonuses)
- **KYC:** Digital KYC stub (includes identity hash duplicate detection via SHA256, 3 retry limit, manual appeal)
- **Fraud Detection:** Device fingerprinting (IP + user-agent hash), device clustering, referral rate limiting (10/week), self-referral blocking via KYC identity
- **Currency:** Real-time USD-to-KES conversion (exchangerate-api.com with fallback rate 130)
- **Background Jobs:** Clearing window (72h pending→available, runs every 60min), stale app expiry (48h under_review, runs every 30min)
- **Audit Trail:** All admin actions logged with timestamp + actor ID

## API Reference

### Authentication (`/auth`)

**Session & Profile Management:**
- `POST /auth/session` — Create session from Firebase ID token; auto-captures device fingerprint
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Response:** `{ user: { id, email, firebaseUid, state, ... } }`

- `GET /auth/me` — Get current user profile
  - **Headers:** `Authorization: Bearer <firebase_id_token>`

- `POST /auth/profile` — Update user profile
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Body:** `{ name, dob, phone, location, timezone }`
  - **Guards:** Age ≥ 18 (hard gate); phone unique per account; auto-captures device fingerprint

- `POST /auth/verify-phone` — Verify phone OTP
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Body:** `{ code: "123456" }` (test code for development)
  - **Sets:** `phoneVerified = true`

**KYC (Digital KYC Integration):**
- `POST /auth/kyc/submit` — Submit KYC (ID + face + liveness)
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Body:** `{ idNumber, faceHash, documentUrl }`
  - **Anti-fraud:** Checks identity hash against existing KYC; auto-flags duplicates
  - **State transition:** `registered` → `kyc_pending` (or `kyc_rejected` if duplicate)

- `POST /auth/kyc/result` — Admin: Post KYC decision
  - **Body:** `{ userId, success: boolean, reason?: string }`
  - **On success:** `state → active` (user can browse jobs)
  - **On fail:** `retryRemaining--`; move to `kyc_rejected_final` after 3 failures

- `POST /auth/kyc/appeal` — Appeal final rejection
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Effect:** Resets to `kyc_pending`; creates audit log

### Jobs (`/jobs`)

- `GET /jobs` — List published jobs (filters by training requirement + user eligibility)
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Guard:** Only `active` users see jobs
  - **Training gate:** If job requires training, returns `applyUrl: /training/start` instead of job ID
  - **Response:** Includes `trainingRequired`, `slotsRemaining`, `expiresAt`

- `POST /jobs` — Create job (admin)
  - **Body:** `{ title, description, amount (cents), currency, capacity, trainingRequired, estimatedTime, expiresAt }`
  - **State:** Defaults to `draft` (must publish separately)

- `PUT /jobs/:jobId` — Update job (admin)

- `POST /jobs/:jobId/publish` — Publish job (admin)
  - **Effect:** Sets `state → published`; initializes `slotsRemaining = capacity`

- `POST /jobs/:jobId/pause` — Pause job (admin, see under `/admin`)

### Applications (`/applications`)

**Full State Machine:** submitted → under_review → approved → in_progress → submitted_for_review → completed / revision_requested / failed_qa

- `POST /applications` — Apply to job
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Body:** `{ jobId }`
  - **Guards:** User must be `active`; job must be `published`
  - **Effect:** Creates application in `submitted` state

- `POST /applications/:id/approve` — Admin: Approve application
  - **Critical:** Decrements `job.slotsRemaining` by 1 (capacity management)
  - **State:** `submitted` → `approved`

- `POST /applications/:id/submit-work` — Worker: Mark work started
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **State:** `approved` → `in_progress`

- `POST /applications/:id/submit-for-review` — Worker: Submit work for QA
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **State:** `in_progress` → `submitted_for_review`

- `POST /applications/:id/complete` — Admin: Mark QA complete
  - **Payment trigger:** Moves `job.amount` to wallet `pending` balance
  - **Transaction:** `{ type: 'job_earning_pending', amount: job.amount }`
  - **State:** `submitted_for_review` → `completed`

### Quality Assurance (`/qa`)

- `POST /qa/:appId/approve` — QA: Approve work
  - **Effect:** Same as `/applications/:id/complete` (triggers payment)
  - **Creates audit log:** `{ action: 'qa_approve', target: appId }`

- `POST /qa/:appId/request-revision` — QA: Request revision
  - **Body:** `{ reason }`
  - **State:** `submitted_for_review` → `revision_requested`

- `POST /qa/:appId/fail` — QA: Fail QA
  - **Body:** `{ reason }`
  - **State:** `submitted_for_review` → `failed_qa`
  - **Auto-flag:** If user has 3+ `failed_qa` in 30 days, creates admin alert

- `POST /qa/:appId/resubmit` — Worker: Resubmit after revision
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **State:** `revision_requested` → `submitted_for_review`

### Training (`/training`)

**Pricing:** $10 USD (configurable via `PAYSTACK_TRAINING_AMOUNT`)

- `POST /training/start` — Start training (payment gateway)
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Logic:**
    1. If `wallet.available ≥ $10`: Debit wallet immediately → return `{ ok: true, paidWithWallet: true }`
    2. Else: Initialize Paystack checkout → return `{ checkoutUrl, reference, trainingProgress }`
  - **Sets:** `training.status = payment_pending`

- `POST /training/webhook` — Paystack charge.success webhook
  - **Headers:** `x-paystack-signature: <hmac_verification>` (validates with PAYSTACK_SECRET_KEY)
  - **Body (from Paystack):** `{ event: "charge.success", data: { reference, amount } }`
  - **Effect:** Sets `training.status = paid`; unlocks training content access
  - **Idempotent:** Safe to call multiple times (webhook might retry)

- `POST /training/complete` — Mark training complete (assessment passed)
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **State:** `paid` → `completed`

**Training Admin (`/training-admin`):**

- `POST /training-admin/modules` — Create training module
  - **Body:** `{ title, description, assessmentQuestion, passingScore? }`
  - **Default passingScore:** 70

- `GET /training-admin/modules` — List all training modules

- `GET /training-admin/modules/:moduleId` — Get module details

- `PUT /training-admin/modules/:moduleId` — Update module
  - **Body:** Same as POST

- `DELETE /training-admin/modules/:moduleId` — Delete module

- `GET /training-admin/completion-stats` — Training completion statistics
  - **Response:** `{ totalStarted, completed, paid, completionRate: "xx.x%" }`

### Wallet (`/wallet`)

**Balance Semantics:**
- `available` — Withdrawable balance (passed 72h clearing window)
- `pending` — Earned but in clearing window (disputes possible within 72h window; converts to available after)

- `GET /wallet` — Get wallet summary
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Response:** `{ wallet: { available, pending }, availableUsd, pendingUsd, exchangeRate: "KES/USD" }`
  - **Note:** Exchange rates fetched in real-time via exchangerate-api.com

- `POST /wallet/credit` — Admin: Manually credit account
  - **Body:** `{ userId, amount (cents), type }`

- `POST /wallet/clear` — Admin: Move pending→available (override clearing window)
  - **Body:** `{ userId, amount }`

- `POST /wallet/withdraw` — Worker: Withdraw available funds
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Body:** `{ amount (cents) }`
  - **Guards:**
    - Minimum $10 USD (1000 cents)
    - Sufficient `wallet.available` balance
    - Payout method exists and is `verified`
    - Payout method not in `cooldownUntil` period (24h after change)
  - **Conversion:** Real-time USD→KES rate applied
  - **Failure handling:** If payout fails, creates `failed_withdrawal` record; funds returned to `available`

**Withdrawal Admin (`/withdrawals-admin`):**

- `GET /withdrawals-admin/failed` — List failed withdrawal attempts
  - **Response:** Array with `amountUsd` conversion included

- `POST /withdrawals-admin/:failedId/retry` — Retry failed withdrawal
  - **Effect:** Deducts from `available`; re-attempts payout
  - **On success:** Deletes `failed_withdrawal` record

- `POST /withdrawals-admin/:failedId/mark-unrecoverable` — Give up on failed withdrawal
  - **Effect:** Refunds `amount` to `available` balance
  - **Transaction:** `{ type: 'failed_withdrawal_refunded', amount }`

**Payout Method (`/withdrawals-admin`):**

- `POST /withdrawals-admin/payout-method/update` — Update payout details (bank/mobile money)
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Body:** `{ method, details }`
  - **Security:** 
    - If changing details: Saves previous number in audit, sets `cooldownUntil = now + 24h`
    - Returns: `"Change will be active in 24 hours"`
  - **Guard:** New details must match KYC identity

- `POST /withdrawals-admin/payout-method/verify-change` — Confirm payout change
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Body:** `{ otpCode: "123456" }` (test code for development)
  - **Guard:** Only if `cooldownUntil > now` (still in security cooldown)
  - **Effect:** Clears cooldown; sets `verified = true`

### Referrals (`/referrals`)

**Payout:** $30 USD, triggered when referred user completes + payments received for a job

**Anti-Fraud Controls:**
- **Rate limit:** 10 referral signups per referrer per week (via `ReferralSignupTracker`)
- **Device clustering:** IP + device hash comparison flags suspicious clusters for manual review (no auto-ban)
- **Self-referral block:** Cross-checks KYC identity hash; flags both accounts if duplicate detected

- `POST /referrals/generate-link` — Generate referral link
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Guard:** Only `active` users
  - **Response:** `{ referralLink, referralCode }`

- `POST /referrals/signup` — Claim referral on new signup
  - **Body:** `{ referralCode, email, firebaseUid }`
  - **Rate limit check:** `signups_this_week > 10` → return 429 Conflict
  - **Device clustering check:** Logs alert if detected; allows signup but flags for manual review
  - **Self-referral check:** Cross-checks KYC identity hashes
  - **Creates:** `referral` record linking referrer → referred user

- `POST /referrals/check-self-referral` — Check for KYC identity duplicates
  - **Headers:** `Authorization: Bearer <firebase_id_token>`
  - **Response:** `{ allowSelfReferral: boolean, duplicates: [...] }`

- `GET /referrals/status/:referralId` — Check referral status
  - **Response:** `{ referral, referredState, completedJobs, referralBonus, status }`
  - **Status pipeline:** Shows signup ✓, KYC status, job approvals, payment source

- `POST /referrals/payout/:referralId/process` — Process referral payout
  - **Trigger condition:** Referred user must have ≥ 1 completed jobs (with QA approval)
  - **Amount:** $30 USD (3000 cents)
  - **Queue:** Goes to `pending` balance (same 72h clearing window as job earnings)
  - **Creates transaction:** `{ type: 'referral_bonus_pending', amount: 3000 }`

### Admin Controls (`/admin`)

**KYC Management:**
- `POST /admin/kyc/:userId/approve` — Approve KYC
  - **Effect:** Sets `state → active`; creates audit log

- `POST /admin/kyc/:userId/reject` — Reject KYC
  - **Body:** `{ reason }`
  - **Auto-escalate:** If retries exhausted, sets `state → kyc_rejected_final`
  - **Creates audit log:** `{ action: 'kyc_reject', target: userId, reason }`

**User Management:**
- `POST /admin/users/:userId/suspend` — Suspend user
  - **Effect:** Sets `state → suspended` (cannot apply/work)

- `POST /admin/users/:userId/ban` — Ban user
  - **Effect:** Sets `state → banned` (account locked)

**Job Management:**
- `GET /admin/jobs/:jobId` — View job details & analytics

- `POST /admin/jobs/:jobId/pause` — Pause job
  - **Effect:** Sets `state → paused` (no new applications)

- `POST /admin/jobs/:jobId/close` — Close job
  - **Effect:** Sets `state → closed`

**Payment Holds:**
- `POST /admin/applications/:appId/hold` — Hold payment (e.g., dispute resolution)
  - **Effect:** Returns amount from `pending` to `available` (reversible dispute hold)

- `POST /admin/applications/:appId/release` — Release held payment
  - **Effect:** Moves amount back to `pending`

**Audit Trail:**
- `GET /admin/audit-log` — View all admin actions (last 100 entries)
  - **Response:** `[ { adminId, action, target, createdAt }, ... ]`
  - **Actions logged:** KYC approvals/rejections, user suspensions, KYC appeals, payment holds/releases, job pauses/closes

## Data Model (Prisma)

**Core Tables:**

- `users` — Account lifecycle (registered → kyc_pending → active / kyc_rejected / kyc_rejected_final / banned / suspended); Firebase UID; phone; KYC verification flag; location/timezone
- `kyc_records` — KYC status; ID number; face hash; identity hash (SHA256 for duplicate detection); retry counter (default 3); duplicate flag
- `device_fingerprints` — IP address + user-agent hash (SHA256); fraud clustering detection; unique per user + device combo
- `jobs` — Job listings; title/description; amount (cents); capacity; slots remaining; state (draft/published/paused/closed/archived); training requirement flag; expiry timestamp
- `applications` — Job application state machine (8 states + enum); timestamps; QA failure count; failed_qa auto-flag tracker
- `training_modules` — Module definitions; title/description; assessment question; passing score threshold
- `training_progress` — Per-user training status (pending_payment/paid/completed); Paystack transaction reference; paid-with-wallet flag
- `wallets` — User balance state; available cents (post-clearing); pending cents (in clearing window)
- `transactions` — Immutable audit log; transaction type (job_earning_pending/referral_bonus_pending/clear_pending/withdraw_to_kes/failed_withdrawal_refunded/training_fee); amount; user + job reference
- `payout_methods` — Mobile money / bank account details; verified flag; cooldown timer (24h after change); previous number audit trail
- `referrals` — Referrer ID → referred user ID; status tracking
- `referral_signup_tracker` — Per-referrer weekly signup counter (rate limiting: 10/week); week start timestamp
- `failed_withdrawals` — Failed payout queue; amount; reason; retry count; created timestamp
- `admin_audit_log` — All manual admin actions; admin user ID; action type; target user/job/application ID; timestamp

## Rules Enforced

### User Lifecycle
- **Minimum age:** 18 years (hard gate; no underage users see jobs)
- **Phone verification:** One account per phone number (enforced at verification)
- **KYC failures:** Up to 3 attempts; final rejection requires manual appeal
- **KYC duplicates:** Identity hash cross-check; both accounts flagged and placed on hold pending admin review
- **Account states:** registered → kyc_pending → active | kyc_rejected → kyc_rejected_final (appeal) | banned/suspended

### Fraud Controls
- **Device fingerprinting:** IP + user-agent hash; tracks devices per user; clustering detection flags suspicious multi-account patterns for manual review
- **Self-referral blocking:** KYC identity hash cross-check across users; same identity triggers account freeze + admin alert
- **Rate limiting on referrals:** 10 signup referrals per week per referrer (tracked by `ReferralSignupTracker`)
- **Device clustering:** Detects shared IP/device across multiple accounts; logs alert but allows transactions (manual review required)

### Job & Application Flow
- **Job capacity:** Slots decrement on application approval (not submission); capacity is tied to job, not application
- **Stale applications:** Auto-expire if `under_review` for 48+ hours; job slots refunded automatically
- **Training gate:** If job requires training, Apply button routes to `/training/start` first; user must complete + pay $10 before applying
- **Job auto-expiry:** Job is archived 30 days after `expiresAt` timestamp
- **Slot refund:** If application expires or is rejected, slots return to `job.slotsRemaining`

### Payment & Wallet
- **Earnings queuing:** QA approval moves `job.amount` to wallet `pending` balance (not `available`)
- **Clearing window:** Pending funds convert to available after 72 hours; background job runs every 60 minutes
- **Dispute hold:** Admin can hold payment (move pending→available, marked as hold), reversible within clearing window
- **Withdrawal minimum:** $10 USD (1000 cents); debits from `available` balance only
- **Payout method verification:** Must match KYC identity; must be marked `verified`
- **Cooldown on payout change:** Changing payout details triggers 24-hour cooldown; previous number saved for audit
- **Failed withdrawal tracking:** If payout fails, creates `failed_withdrawal` record; admin can retry or mark unrecoverable (auto-refund)
- **Currency conversion:** Real-time USD→KES rate applied at withdrawal time (fallback 130 if API down)

### Referrals
- **Payout trigger:** $30 USD credited when referred user completes ≥ 1 job with full payment received
- **Rate limit:** 10 referral signups per week (same-day rate limiting via weekly window)
- **Self-referral detection:** Cross-checks KYC identity hash; flags both accounts if duplicate found
- **Device clustering flag:** IP + device hash clustering triggers audit alert for manual review (no auto-ban)
- **Bonus clearing:** $30 goes through same pending→available 72h clearing window as job earnings

### Training
- **Price:** $10 USD (1000 cents); configurable via `PAYSTACK_TRAINING_AMOUNT`
- **Payment priority:** Wallet deduction first; if insufficient, Paystack checkout fallback
- **Unlimited retries:** One training payment grants unlimited assessment retries
- **Paystack verification:** Webhook signature verified with HMAC-SHA512 using `PAYSTACK_SECRET_KEY`
- **Idempotent webhooks:** Safe to replay; idempotency key is training reference

### Admin Controls
- **KYC decisions:** Approve → active; reject → kyc_rejected (or kyc_rejected_final if retries exhausted)
- **Account suspension:** Suspended users cannot apply/work (but can appeal suspensions via support)
- **Account banning:** Banned users locked permanently (requires executive override)
- **Job operations:** Pause/close on demand (affects in-progress workers per business rules)
- **Payment holds:** Reversible within clearing window; audit logged
- **Full audit trail:** All manual actions logged with admin ID, action type, target resource, timestamp

## Background Jobs

- **Clearing window** (runs every 60 min): moves pending→available after 72 hours
- **Stale application expiry** (runs every 30 min): rejects under_review applications older than 48 hours; refunds job slots

## Testing Checklist

### 1. Auth → Profile → KYC → Active

```bash
# POST /auth/session (capture device fingerprint)
curl -X POST http://localhost:4000/auth/session \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json"
# Response: user with state=registered

# POST /auth/profile (18+ age check, location/timezone)
curl -X POST http://localhost:4000/auth/profile \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"John","dob":"2000-01-01","phone":"+254123456789","location":"Nairobi","timezone":"EAT"}'

# POST /auth/verify-phone (OTP: 123456)
curl -X POST http://localhost:4000/auth/verify-phone \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}'

# POST /auth/kyc/submit (identity hash checked for duplicates)
curl -X POST http://localhost:4000/auth/kyc/submit \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"idNumber":"ID123456789","faceHash":"face_hash","documentUrl":"https://..."}'
# State: kyc_pending

# Admin: POST /auth/kyc/result (approve)
curl -X POST http://localhost:4000/auth/kyc/result \
  -H "Content-Type: application/json" \
  -d '{"userId":"<user_id>","success":true}'
# State: active ✓

# Verify user is active
curl http://localhost:4000/auth/me \
  -H "Authorization: Bearer <firebase_id_token>"
```

### 2. Job Marketplace (Training Gate)

```bash
# Admin: Create + publish job with training requirement
curl -X POST http://localhost:4000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Data Entry",
    "description":"CSV data entry",
    "amount":5000,
    "currency":"USD",
    "capacity":5,
    "trainingRequired":true,
    "expiresAt":"2025-12-31T23:59:59Z"
  }'
# State: draft

# Publish it
curl -X POST http://localhost:4000/jobs/<job_id>/publish

# Worker: Browse jobs (should see applyUrl: /training/start for training-required jobs)
curl http://localhost:4000/jobs \
  -H "Authorization: Bearer <firebase_id_token>"
```

### 3. Training with Paystack OR Wallet Deduction

```bash
# POST /training/start
curl -X POST http://localhost:4000/training/start \
  -H "Authorization: Bearer <firebase_id_token>"

# Test 1: Wallet sufficient (≥ $10)
# Expected: { ok: true, paidWithWallet: true }

# Test 2: Wallet insufficient
# Expected: { ok: false, checkoutUrl: "https://checkout.paystack.com/...", reference: "..." }

# Mock Paystack success webhook (generate HMAC signature)
export PAYSTACK_SECRET=sk_test_xxxxx
export BODY='{"event":"charge.success","data":{"reference":"training_xxx_xxx","amount":1000}}'
export SIG=$(echo -n "$BODY" | openssl dgst -sha512 -hmac "$PAYSTACK_SECRET" -hex | cut -d' ' -f2)

curl -X POST http://localhost:4000/training/webhook \
  -H "x-paystack-signature: $SIG" \
  -H "Content-Type: application/json" \
  -d "$BODY"
# Training status: paid

# Complete training
curl -X POST http://localhost:4000/training/complete \
  -H "Authorization: Bearer <firebase_id_token>"
# Training status: completed
```

### 4. Job Application → Work Submission → QA → Payment → Clearing

```bash
# Worker: Apply to job (training-required job → must complete training first)
curl -X POST http://localhost:4000/applications \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"jobId":"<job_id>"}'
# State: submitted

# Admin: Approve (slots decrement)
curl -X POST http://localhost:4000/applications/<app_id>/approve

# Worker: Submit work
curl -X POST http://localhost:4000/applications/<app_id>/submit-work \
  -H "Authorization: Bearer <firebase_id_token>"
# State: in_progress

# Worker: Submit for QA
curl -X POST http://localhost:4000/applications/<app_id>/submit-for-review \
  -H "Authorization: Bearer <firebase_id_token>"
# State: submitted_for_review

# QA: Approve (triggers payment to pending)
curl -X POST http://localhost:4000/qa/<app_id>/approve

# Check wallet (funds in pending)
curl http://localhost:4000/wallet \
  -H "Authorization: Bearer <firebase_id_token>"
# wallet.pending = job.amount (in cents)

# Wait 72h OR admin manual clear
curl -X POST http://localhost:4000/wallet/clear \
  -H "Content-Type: application/json" \
  -d '{"userId":"<user_id>","amount":<job_amount>}'

# Check wallet (funds available)
curl http://localhost:4000/wallet \
  -H "Authorization: Bearer <firebase_id_token>"
# wallet.available = job.amount
```

### 5. Withdrawal with Failed Queue

```bash
# Setup payout method first (must match KYC identity)
curl -X POST http://localhost:4000/withdrawals-admin/payout-method/update \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"method":"mobile_money","details":"+254123456789"}'
# cooldownUntil = now + 24h

# Verify change after cooldown expires
curl -X POST http://localhost:4000/withdrawals-admin/payout-method/verify-change \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"otpCode":"123456"}'
# verified = true

# Withdraw
curl -X POST http://localhost:4000/wallet/withdraw \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":5000}'
# Success: funds sent to payout method

# If payout fails, check failed queue
curl http://localhost:4000/withdrawals-admin/failed

# Retry or mark unrecoverable
curl -X POST http://localhost:4000/withdrawals-admin/<failed_id>/retry
curl -X POST http://localhost:4000/withdrawals-admin/<failed_id>/mark-unrecoverable
```

### 6. Referrals with Rate Limiting & Self-Referral Block

```bash
# Active user: Generate referral link
curl -X POST http://localhost:4000/referrals/generate-link \
  -H "Authorization: Bearer <firebase_id_token>"
# Response: { referralLink, referralCode: "ref_<referrer_id>_<time>" }

# New user signup (with different KYC identity)
curl -X POST http://localhost:4000/referrals/signup \
  -H "Content-Type: application/json" \
  -d '{"referralCode":"ref_<referrer_id>_<time>","email":"referred@example.com","firebaseUid":"<new_uid>"}'
# Rate limit checked (max 10/week)
# Device clustering checked (flags if suspicious)
# Self-referral checked (flags if same KYC identity)

# Later: Referred user completes job (goes through full payment cycle)

# Check referral status
curl http://localhost:4000/referrals/status/<referral_id> \
  -H "Authorization: Bearer <firebase_id_token>"

# Process $30 referral payout
curl -X POST http://localhost:4000/referrals/payout/<referral_id>/process

# Check wallet (referral bonus in pending, clears after 72h)
curl http://localhost:4000/wallet \
  -H "Authorization: Bearer <firebase_id_token>"
```

## Deployment Setup

### Firebase Service Account

1. Create Firebase project: https://console.firebase.google.com
2. Go to **Project Settings** → **Service Accounts** → **Generate New Private Key** (JSON format)
3. Save as `serviceAccountKey.json` in project root
4. Set in `.env`: `FIREBASE_SERVICE_ACCOUNT_PATH="./serviceAccountKey.json"`

### Paystack Account

1. Sign up: https://paystack.com
2. Get API keys from **Settings** → **API Keys & Webhooks**
3. For test mode: use `sk_test_...` and `pk_test_...` keys
4. Set webhook URL: `https://your-api.com/training/webhook`
5. Paystack automatically sends `x-paystack-signature` header (verified in code)
6. Set in `.env`: `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY`

### Database Setup

**PostgreSQL (Production):**
```bash
# Create database
createdb afterworks

# Update .env
DATABASE_URL="postgresql://user:password@localhost:5432/afterworks"

# Push schema
npx prisma db push
npx prisma migrate deploy  # if using named migrations
```

**SQLite (Local Development):**
```bash
# Update .env
DATABASE_URL="file:./dev.db"

# Prisma auto-creates schema
npx prisma db push
```

## Production Checklist

- [ ] Set all env vars securely (never commit `.env` to git)
- [ ] Enable HTTPS (required for Firebase and Paystack webhooks)
- [ ] Set up PostgreSQL database with backups
- [ ] Configure rate limiting (`express-rate-limit`)
- [ ] Add request logging and monitoring (CloudWatch, DataDog, etc.)
- [ ] Enable error tracking (Sentry, Rollbar, etc.)
- [ ] Restrict admin routes to authenticated users with role checks
- [ ] Add input validation (`express-validator` or similar)
- [ ] Validate KYC provider integration (currently stubbed; integrate real provider like BioID, Vouched, Jumio)
- [ ] Test Paystack webhook signatures thoroughly
- [ ] Load test background jobs (clearing window, stale app expiry)
- [ ] Set up CI/CD pipeline (GitHub Actions, GitLab CI, etc.)
- [ ] Monitor exchange rate API uptime (fallback to 130 if down)
- [ ] Set up Redis/cache layer if scaling beyond single server
- [ ] Document API for frontend integration
- [ ] Create admin dashboard for manual overrides

## Next Steps

1. **Database migration:**
   ```bash
   npx prisma db push
   npx prisma studio  # Optional: visual DB browser
   ```

2. **Download Firebase service account JSON** from Firebase Console → Project Settings → Service Accounts

3. **Test authentication flow** with Firebase SDK on frontend

4. **Integrate Paystack webhooks** (setup webhook URL in Dashboard)

5. **Replace Digital KYC stub** with real provider (integrate BioID, Vouched, Jumio API)

6. **Replace OTP stub** (code='123456' test) with SMS provider (Twilio, AWS SNS, etc.)

7. **Build frontend** (React/Vue/etc.) with Firebase SDK for ID token generation

## Notes & Known Limitations

**Currently Stubbed (Integrate for Production):**
- **KYC Provider:** Digital KYC duplicate detection is SHA256 hash-based. Integrate real provider (BioID, Vouched, Jumio, etc.) for liveness/face matching.
- **OTP Verification:** Code='123456' works for testing. Integrate SMS provider (Twilio, AWS SNS, MessageBird, etc.) for production.
- **Exchange Rate API:** Uses exchangerate-api.com with fallback to 130 KES/USD. Monitor API uptime; consider caching rates hourly.
- **Device Fingerprinting:** IP + user-agent hash. Enhance with geolocation IP database for production-grade fraud detection.

**Pending Infrastructure:**
- **Request validation:** Currently basic; add `express-validator` for comprehensive input validation
- **Rate limiting:** Add `express-rate-limit` middleware to prevent API abuse
- **Error tracking:** Integrate Sentry, Rollbar, or DataDog for error monitoring
- **Request logging:** Add structured logging (Winston, Pino) for audit trail + debugging
- **Session management:** Single server only; add Redis for distributed sessions if scaling
- **Admin dashboard:** Build UI for manual KYC approvals, payment holds, referral disputes, etc.

**Future Enhancements:**
- Real-time updates via WebSocket (job postings, payment status)
- Mobile app (iOS/Android) for workers
- Job recommendation engine (based on user location, skills, history)
- Advanced fraud detection (IP geolocation, device clustering ML models)
- Merchant integrations (for job postings, like LinkedIn Jobs or Fiverr)
- M-Pesa direct integration (instead of Paystack) for Kenya market
- Training module marketplace (workers can create + sell modules)
- Dispute resolution system (appeals, mediation, refunds)
# AfterWorks
# AfterWorks
