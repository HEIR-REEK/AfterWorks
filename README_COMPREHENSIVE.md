# AfterWorks Prototype — Full Implementation

Complete platform implementation with Firebase auth, Digital KYC, Paystack payments, job marketplace, training system with modules, wallet with clearing windows, referrals with fraud controls, and comprehensive admin controls.

## Quick Start

### Prerequisites
- Node.js 16+
- PostgreSQL or SQLite
- Firebase service account JSON file
- Paystack test/live API keys

### Installation

1. **Clone and install:**

```bash
cd AfterWorks
npm install
```

2. **Configure environment (copy `.env.example` → `.env`):**

```bash
# Database connection
DATABASE_URL="postgresql://user:password@localhost:5432/afterworks"
# Or for SQLite: DATABASE_URL="file:./dev.db"

# Firebase service account (download from Firebase console → Project settings → Service accounts)
FIREBASE_SERVICE_ACCOUNT_PATH="./serviceAccountKey.json"

# Paystack (get from https://paystack.com → Settings → API Keys)
PAYSTACK_SECRET_KEY=sk_test_xxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
PAYSTACK_TRAINING_AMOUNT=1000

# Server port
PORT=4000
```

3. **Initialize database:**

```bash
npx prisma generate
npx prisma db push
```

4. **Start server:**

```bash
npm run dev
```

Server runs on `http://localhost:4000`. Health check: `GET http://localhost:4000/health`

---

## Architecture

**Stack:**
- **Backend:** Express.js + Node.js
- **Database:** Prisma ORM (PostgreSQL/SQLite/MySQL)
- **Auth:** Firebase Admin SDK (OAuth + ID token verification)
- **Payments:** Paystack API (training fees, job payouts, referral bonuses)
- **KYC:** Digital KYC stub (integrates with real Digital KYC provider)
- **Background Jobs:** Node.js interval timers (clearing window, stale app expiry)

**Features:**
- User lifecycle with KYC fraud controls (3 retry limit, identity hash duplicates, device clustering)
- Job marketplace with capacity management and auto-expiring applications
- Training system with modules, assessments, and Paystack payment integration
- Wallet with pending→available clearing window (72h default)
- Referral system with rate limiting (10/week) and self-referral block
- Admin controls with full audit trail
- Device fingerprinting (IP + user-agent) for fraud detection
- Real-time USD→KES conversion at withdrawal time

---

## Complete API Reference

### Authentication (`/auth`)

**User Session & Profile:**
- `POST /auth/session` — Create session from Firebase ID token
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Response: `{ user: { id, email, firebaseUid, state, ... } }`

- `GET /auth/me` — Get current user profile
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Response: `{ user: {...} }`

- `POST /auth/profile` — Update user profile
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Body: `{ name, dob, phone, location, timezone }`
  - Note: DOB checked for 18+ minimum; auto-captures device fingerprint

**Phone Verification:**
- `POST /auth/verify-phone` — Verify phone OTP
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Body: `{ code: "123456" }` (test code)
  - Sets: `phoneVerified = true`

**KYC (Digital KYC):**
- `POST /auth/kyc/submit` — Submit KYC (ID + face + liveness)
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Body: `{ idNumber, faceHash, documentUrl }`
  - Checks: Identity hash against existing KYC records for duplicates
  - Sets state: `kyc_pending` (or `kyc_rejected` if duplicate detected)
  - Flags: Both accounts if duplicate found (awaits manual review)

- `POST /auth/kyc/result` — Admin: Post KYC decision
  - Body: `{ userId, success: boolean, reason?: string }`
  - On success: `state → active`, user can browse jobs
  - On fail: `retryRemaining--`, move to `kyc_rejected_final` after 3 failures

- `POST /auth/kyc/appeal` — Appeal final rejection
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Resets state to `kyc_pending`, creates audit log
  - User can resubmit after appeal is reviewed

---

### Jobs (`/jobs`)

- `GET /jobs` — List published jobs
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Query: `?state=published` (optional, defaults to published)
  - Response: Array of jobs with `trainingRequired` flag and `applyUrl` routing
  - **Guard:** Only `active` users see jobs
  - **Training gate:** Returns `applyUrl: /training/start` if job requires training and user hasn't completed it

- `POST /jobs` — Create job (admin)
  - Body: `{ title, description, amount (cents), currency, capacity, trainingRequired, estimatedTime, expiresAt }`
  - Sets state to `draft` (must manually publish)

- `PUT /jobs/:jobId` — Update job (admin)
  - Body: Same as POST

- `POST /jobs/:jobId/publish` — Publish job (admin)
  - Sets state to `published`, `slotsRemaining = capacity`

---

### Applications (`/applications`)

**Application Lifecycle:** submitted → under_review → approved → in_progress → submitted_for_review → completed/failed_qa

- `POST /applications` — Apply to job
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Body: `{ jobId }`
  - **Guards:** state must be `active`; job must be `published`
  - Sets state: `submitted`

- `POST /applications/:id/approve` — Admin: Approve application
  - **Critical:** Decrements `job.slotsRemaining` (capacity management)
  - Sets state: `approved`

- `POST /applications/:id/submit-work` — Worker: Mark work started
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Sets state: `in_progress`

- `POST /applications/:id/submit-for-review` — Worker: Submit work
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Sets state: `submitted_for_review`

- `POST /applications/:id/complete` — Admin: Mark QA complete
  - **Payment trigger:** Moves `job.amount` to wallet `pending` balance
  - Creates transaction: `{ type: 'job_earning_pending', amount }`
  - Sets state: `completed`

---

### Quality Assurance (`/qa`)

- `POST /qa/:appId/approve` — QA: Approve work
  - Triggers payment (same as `/applications/:id/complete`)
  - Creates audit log

- `POST /qa/:appId/request-revision` — QA: Request revision
  - Body: `{ reason }`
  - Sets state: `revision_requested`

- `POST /qa/:appId/fail` — QA: Fail QA
  - Body: `{ reason }`
  - Sets state: `failed_qa`
  - **Auto-flag:** If worker has 3+ `failed_qa` in 30 days, logs admin alert

- `POST /qa/:appId/resubmit` — Worker: Resubmit after revision
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Sets state: `submitted_for_review` (returns to QA)

---

### Training (`/training`)

**Pricing:** $10 USD (configurable via `PAYSTACK_TRAINING_AMOUNT`)

- `POST /training/start` — Start training
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Logic:
    1. If wallet.available ≥ $10: Debit wallet, set `status: paid`, return `{ ok: true, paidWithWallet: true }`
    2. Else: Initialize Paystack checkout, return `{ checkoutUrl, trainingProgress }`
  - Sets initial state: `payment_pending`

- `POST /training/webhook` — Paystack success webhook
  - Headers: `x-paystack-signature: <hmac_verification>`
  - Body from Paystack: `{ event: "charge.success", data: { reference } }`
  - **Webhook verification:** Validates HMAC signature with `PAYSTACK_SECRET_KEY`
  - Sets state: `paid` (unlocks training content)
  - **Note:** Idempotent — safe to call multiple times

- `POST /training/complete` — Mark training complete
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Sets state: `completed`

**Training Admin (`/training-admin`):**

- `POST /training-admin/modules` — Create training module
  - Body: `{ title, description, assessmentQuestion, passingScore (default 70) }`

- `GET /training-admin/modules` — List all modules

- `GET /training-admin/modules/:moduleId` — Get module details

- `PUT /training-admin/modules/:moduleId` — Update module

- `GET /training-admin/completion-stats` — Training statistics
  - Response: `{ totalStarted, completed, paid, completionRate }`

---

### Wallet (`/wallet`)

**Balance States:**
- `available` — Withdrawable (passed clearing window)
- `pending` — Earned but not yet cleared (72h default window)

- `GET /wallet` — Get wallet summary
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Response: `{ wallet, availableUsd, pendingUsd, exchangeRate }`

- `POST /wallet/credit` — Admin: Manually credit account
  - Body: `{ userId, amount (cents), type }`

- `POST /wallet/clear` — Admin: Move pending→available
  - Body: `{ userId, amount }`
  - **Use case:** Manual override after clearing window OR after dispute resolution

- `POST /wallet/withdraw` — Worker: Withdraw funds
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Body: `{ amount (cents) }`
  - **Minimum:** $10 USD (1000 cents)
  - **Guards:** 
    - Payout method must exist and be `verified`
    - Payout method cannot be in `cooldownUntil` period (24h after change)
  - **Conversion:** Real-time USD→KES rate (from exchangerate-api.com, fallback 130)
  - **Failure:** If payout fails, creates `failed_withdrawal` record, funds return to `available`

**Withdrawal Admin (`/withdrawals-admin`):**

- `GET /withdrawals-admin/failed` — List failed withdrawals
  - Response: Array with `amountUsd` conversion

- `POST /withdrawals-admin/:failedId/retry` — Retry failed withdrawal
  - Deducts amount from `available`, re-attempts payout
  - Deletes `failed_withdrawal` record on success

- `POST /withdrawals-admin/:failedId/mark-unrecoverable` — Mark failed withdrawal as lost
  - Refunds amount to `available` balance
  - Creates transaction: `{ type: 'failed_withdrawal_refunded' }`

**Payout Method (`/withdrawals-admin`):**

- `POST /withdrawals-admin/payout-method/update` — Update payout details
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Body: `{ method, details }`
  - **Security:** If changing details:
    1. Sets `cooldownUntil = now + 24h`
    2. Saves previous number in `previousNumber`
    3. Returns: "Change will be active in 24 hours"
  - **Guard:** New details must match KYC identity

- `POST /withdrawals-admin/payout-method/verify-change` — Confirm payout change
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Body: `{ otpCode: "123456" }` (test code)
  - **Guard:** Only if `cooldownUntil > now` (still in cooldown)
  - Clears cooldown, sets `verified = true`

---

### Referrals (`/referrals`)

**Payout:** $30 USD, triggered when referred user completes + paid job

**Anti-fraud controls:**
- Rate limit: 10 referral signups per referrer per 7-day window
- Self-referral block: Checks KYC identity hash match (both accounts flagged if duplicate)
- Device cluster detection: IP address + device hash clustering (flags for review, no auto-block)

- `POST /referrals/generate-link` — Generate referral link
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - **Guard:** Only `active` users
  - Response: `{ referralLink, referralCode }`

- `POST /referrals/signup` — Claim referral (signup endpoint)
  - Body: `{ referralCode, email, firebaseUid }`
  - **Rate limit check:** `referrals/signups per week > 10` → reject with 429
  - **Device clustering:** Logs audit alert if detected but allows signup (flags for manual review)
  - Creates `referral` record linking referrer → referred user

- `POST /referrals/check-self-referral` — Check for KYC identity duplicates
  - Headers: `Authorization: Bearer <firebase_id_token>`
  - Response: `{ allowSelfReferral, duplicates }`

- `GET /referrals/status/:referralId` — Referral status pipeline
  - Response: `{ referral, referredState, completedJobs, referralBonus, status }`
  - Shows: signup ✓, KYC status, job approvals, payments

- `POST /referrals/payout/:referralId/process` — Process referral payout
  - **Trigger:** When referred user has completed jobs
  - **Amount:** $30 USD (3000 cents)
  - **Queue:** Goes to `pending` balance (same 72h clearing window as job earnings)
  - No payment until clearing window passes

---

### Admin Controls (`/admin`)

**KYC Management:**
- `POST /admin/kyc/:userId/approve` — Approve KYC
  - Sets: `state → active`

- `POST /admin/kyc/:userId/reject` — Reject KYC
  - Body: `{ reason }`
  - Auto-escalates to `kyc_rejected_final` if retries exhausted

**User Management:**
- `POST /admin/users/:userId/suspend` — Suspend user
  - Sets: `state → suspended` (cannot apply/work)

- `POST /admin/users/:userId/ban` — Ban user
  - Sets: `state → banned` (account locked)

**Job Management:**
- `GET /admin/jobs/:jobId` — View job details & analytics

- `POST /admin/jobs/:jobId/pause` — Pause job (no new applications)
  - Sets: `state → paused`

- `POST /admin/jobs/:jobId/close` — Close job (all slots filled)
  - Sets: `state → closed`

**Payment Holds:**
- `POST /admin/applications/:appId/hold` — Hold payment (dispute)
  - Returns amount from `pending` to `available` (reversible hold)

- `POST /admin/applications/:appId/release` — Release held payment
  - Moves amount back to `pending`

**Audit:**
- `GET /admin/audit-log` — View all admin actions (last 100 entries)
  - Response: Array of `{ adminId, action, target, createdAt }`

---

## Background Jobs

Automatically executed every:
- **Clearing window (60 min):** Moves `pending → available` for funds older than 72h
- **Stale application expiry (30 min):** Auto-rejects `under_review` applications older than 48h; refunds job slots

These run in the background after server startup.

---

## Data Model (Prisma)

**Core Tables:**
- `users` — Account state, Firebase UID, phone, KYC status, profile (name, DOB, location, timezone)
- `kyc_records` — KYC status, ID number, face hash, identity hash (for duplicate detection), retry counter, duplicate flag
- `device_fingerprints` — IP address + device hash (for fraud clustering)
- `jobs` — Job listings with capacity, remaining slots, state, expiry date
- `applications` — Job applications with state machine and QA workflow
- `training_modules` — Training module definitions with assessments
- `training_progress` — User training status, payment reference (Paystack), paid flag
- `wallets` — Balance tracking (available + pending)
- `transactions` — Immutable transaction log (job earnings, training fees, referral bonuses, clears, withdrawals)
- `payout_methods` — Mobile money/bank account, verified flag, cooldown tracking
- `referrals` — Referrer → referred user mapping
- `referral_signup_tracker` — Weekly signup counts per referrer (rate limiting)
- `failed_withdrawals` — Failed payout queue with retry counters
- `admin_audit_log` — All admin actions with timestamp and actor ID

---

## Testing Checklist

### 1. Auth → KYC → Active

```bash
# Step 1: Signup (Firebase handles this in real frontend)
curl -X POST http://localhost:4000/auth/session \
  -H "Authorization: Bearer <firebase_id_token>"

# Step 2: Complete profile (18+ age gate)
curl -X POST http://localhost:4000/auth/profile \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"John","dob":"2000-01-01","phone":"+254123456789","location":"Nairobi","timezone":"EAT"}'

# Step 3: Verify phone (OTP code: 123456 for testing)
curl -X POST http://localhost:4000/auth/verify-phone \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}'

# Step 4: Submit KYC
curl -X POST http://localhost:4000/auth/kyc/submit \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "idNumber":"ID123456789",
    "faceHash":"face_hash_from_digital_kyc_provider",
    "documentUrl":"https://..."
  }'

# Step 5: Admin approves KYC
curl -X POST http://localhost:4000/auth/kyc/result \
  -H "Content-Type: application/json" \
  -d '{"userId":"<user_id>","success":true}'

# Verify user is now active
curl http://localhost:4000/auth/me \
  -H "Authorization: Bearer <firebase_id_token>"
```

### 2. Job Marketplace

```bash
# Admin: Create and publish job
curl -X POST http://localhost:4000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Data Entry Task",
    "description":"Enter CSV data",
    "amount":5000,
    "currency":"USD",
    "capacity":10,
    "trainingRequired":false
  }'

# Worker: Browse jobs (only active users)
curl http://localhost:4000/jobs \
  -H "Authorization: Bearer <firebase_id_token>"
```

### 3. Training with Paystack

```bash
# Start training (debit wallet if available, else Paystack)
curl -X POST http://localhost:4000/training/start \
  -H "Authorization: Bearer <firebase_id_token>"

# Mock Paystack webhook (test with valid HMAC signature)
curl -X POST http://localhost:4000/training/webhook \
  -H "x-paystack-signature: <valid_hmac>" \
  -H "Content-Type: application/json" \
  -d '{"event":"charge.success","data":{"reference":"training_<user>_<time>"}}'

# Complete training
curl -X POST http://localhost:4000/training/complete \
  -H "Authorization: Bearer <firebase_id_token>"
```

### 4. Payment Clearing Window

```bash
# Complete job (QA approves)
curl -X POST http://localhost:4000/applications/<app_id>/complete

# Check wallet (funds in pending)
curl http://localhost:4000/wallet \
  -H "Authorization: Bearer <firebase_id_token>"

# After 72h (or manual clear)
curl -X POST http://localhost:4000/wallet/clear \
  -H "Content-Type: application/json" \
  -d '{"userId":"<user_id>","amount":5000}'

# Check wallet (funds now available)
curl http://localhost:4000/wallet \
  -H "Authorization: Bearer <firebase_id_token>"

# Withdraw (requires verified payout method)
curl -X POST http://localhost:4000/wallet/withdraw \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":5000}'
```

### 5. Referrals

```bash
# Generate referral link
curl -X POST http://localhost:4000/referrals/generate-link \
  -H "Authorization: Bearer <firebase_id_token>"

# Signup with referral
curl -X POST http://localhost:4000/referrals/signup \
  -H "Content-Type: application/json" \
  -d '{"referralCode":"ref_<referrer_id>_<time>","email":"referred@example.com","firebaseUid":"<new_uid>"}'

# Check referral status
curl http://localhost:4000/referrals/status/<referral_id> \
  -H "Authorization: Bearer <firebase_id_token>"

# Process referral payout (after referred user completes job)
curl -X POST http://localhost:4000/referrals/payout/<referral_id>/process
```

---

## Environment Setup for Production

### Firebase Setup

1. Create Firebase project at https://console.firebase.google.com
2. Go to **Project Settings** → **Service Accounts** → **Generate New Private Key** (JSON)
3. Save as `serviceAccountKey.json` in project root
4. Set `FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json` in `.env`

### Paystack Setup

1. Sign up at https://paystack.com
2. Get API keys from **Settings** → **API Keys & Webhooks**
3. For webhooks: Set URL to `https://your-api.com/training/webhook`
4. Set headers: `X-Paystack-Signature` verification enabled (automatic in code)

### Database Setup

**PostgreSQL (Production):**
```bash
# Set DATABASE_URL in .env
DATABASE_URL="postgresql://user:password@db-host:5432/afterworks"

# Run migrations
npx prisma db push
npx prisma migrate deploy  # if using named migrations
```

**SQLite (Local Development):**
```bash
# Set DATABASE_URL in .env
DATABASE_URL="file:./dev.db"

# Prisma auto-migrates on push
npx prisma db push
```

---

## Deployment Checklist

- [ ] Set all API keys in production environment variables (never commit `.env`)
- [ ] Enable HTTPS (required for Firebase and Paystack webhooks)
- [ ] Set up database backups
- [ ] Enable request logging and monitoring
- [ ] Add rate limiting (e.g., `express-rate-limit`)
- [ ] Add input validation with `express-validator` (currently basic)
- [ ] Set up error tracking (e.g., Sentry)
- [ ] Configure CORS if frontend is separate domain
- [ ] Enable database encryption at rest
- [ ] Restrict admin routes to authenticated admins (currently open; add role check)
- [ ] Set up Redis for session/cache if scaling beyond single server
- [ ] Test Paystack webhook signatures thoroughly
- [ ] Validate KYC provider integration (currently stubbed)
- [ ] Load test clearing window jobs under high load

---

## Notes & Future Work

- **KYC Provider:** Current implementation is a stub. Integrate real Digital KYC provider (BioID, Vouched, Jumio, etc.)
- **Rate Limiting:** Add `express-rate-limit` to prevent abuse
- **Validation:** Add schema validation with `express-validator`
- **Testing:** Add Jest/Mocha tests for critical paths
- **Admin Dashboard:** Build a React/Vue admin UI for manual overrides
- **Real-time Updates:** Add WebSocket for live job updates, payment status
- **Mobile App:** Add native iOS/Android clients for workers
- **Scaling:** Move background jobs to separate worker process (Bull, RQ) if queue grows

