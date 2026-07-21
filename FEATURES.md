# AfterWorks Features — Complete Specification

Comprehensive documentation of all implemented features in the AfterWorks platform.

## 1. User Authentication & Profile Management

### 1.1 Firebase OAuth Integration
- **Method:** Firebase Admin SDK + ID token verification
- **Endpoints:** `POST /auth/session`, `GET /auth/me`
- **Flow:** Client sends Firebase ID token → server verifies → creates/updates user session
- **Device Fingerprinting:** Auto-captured on session creation (IP + user-agent hash)
- **Storage:** User profile in PostgreSQL/SQLite via Prisma ORM

### 1.2 Profile Information Collection
- **Endpoint:** `POST /auth/profile`
- **Fields Collected:** Name, Date of Birth (age verification: 18+), Phone, Location, Timezone
- **Age Gate:** Hard enforcement — users under 18 cannot see jobs or apply
- **Phone Verification:** One account per phone number (prevents duplicate accounts)
- **Location Tracking:** Used for job recommendations, tax purposes, and time-zone based scheduling

### 1.3 Phone Verification (OTP)
- **Endpoint:** `POST /auth/verify-phone`
- **Test Code:** `123456` (for development)
- **Production:** Integrate SMS provider (Twilio, AWS SNS, MessageBird, etc.) for real OTP delivery
- **State Transition:** Marks `phoneVerified = true` on successful verification
- **Requirement:** Must verify before KYC submission

## 2. Know Your Customer (KYC) & Fraud Detection

### 2.1 Digital KYC Integration
- **Endpoint:** `POST /auth/kyc/submit`
- **Input:** ID Number, Face Hash, Document URL
- **Process:**
  1. Captures identity hash (SHA256: `idNumber + faceHash`)
  2. Checks if hash exists in `kyc_records` table
  3. If duplicate detected: Both accounts flagged + placed on hold for admin review
  4. If new: Creates pending KYC record, user state → `kyc_pending`

### 2.2 KYC Retry Management
- **Retry Limit:** 3 attempts per user
- **Failed Transition:** After 3rd failure → `kyc_rejected_final` (no more retries)
- **Appeal Mechanism:** Users can appeal final rejection
  - **Endpoint:** `POST /auth/kyc/appeal`
  - **Effect:** Resets to `kyc_pending` + creates audit log
  - **Use Case:** Customer submits clearer photos or disputes auto-rejection

### 2.3 Admin KYC Decision
- **Endpoint:** `POST /auth/kyc/result` (admin-only)
- **Parameters:** userId, success (boolean), reason (string)
- **On Success:** `state → active` (user can browse jobs + apply)
- **On Failure:** 
  - If retries remaining: `state → kyc_rejected`, retryRemaining--
  - If retries exhausted: `state → kyc_rejected_final` (requires appeal or manual override)

### 2.4 Duplicate Detection & Self-Referral Blocking
- **Method:** SHA256 hash of identity fields (idNumber + faceHash)
- **Storage:** `kyc_records.identityHash` column
- **Check Scope:** On both KYC submission and referral signup
- **Action on Duplicate:** Flags both accounts for manual review (no auto-ban, but alerts admin)
- **Use Case:** Prevents fraud where one person uses multiple IDs to farm referral bonuses

### 2.5 Device Fingerprinting & Clustering
- **Captured:** IP address + User-Agent string (hash: SHA256)
- **Storage:** `device_fingerprints` table (unique per user + deviceHash combo)
- **Detection Function:** `checkDeviceCluster()` compares two users' IPs + device hashes
- **Alert Trigger:** If same IP + device detected on 2+ accounts
- **Action:** Logs audit alert for manual review (no auto-block; allows signup but flags for investigation)
- **Use Case:** Detects coordinated farming attempts (multiple accounts from same device)

## 3. Job Marketplace

### 3.1 Job Creation & Management
- **Admin Endpoint:** `POST /jobs`
- **Job States:** draft → published → paused / closed → archived
- **Fields:**
  - Title, description, amount (cents), currency
  - Capacity (max applicants), remaining slots
  - Training requirement (boolean flag)
  - Estimated time to complete
  - Expiry date (auto-archive after 30 days)

### 3.2 Job Listing & Training Gate
- **Endpoint:** `GET /jobs`
- **Access:** Only `active` users see published jobs
- **Training Gate Logic:**
  - If job requires training AND user hasn't completed training:
    - Return `applyUrl: /training/start` instead of direct job ID
  - If job requires training AND user completed training:
    - Return normal job with apply endpoint
  - If job doesn't require training:
    - Always show apply endpoint

### 3.3 Job Capacity Management
- **Capacity Enforcement:** 
  - Job created with `capacity: 10` → `slotsRemaining: 10`
  - Each application approval: `slotsRemaining--`
  - Slots only decrement on APPROVAL, not on submission
- **Slot Refund:** When application expires (48h) or is rejected, slot is returned

### 3.4 Job Auto-Expiry
- **Trigger:** Application in `under_review` state for 48+ hours
- **Background Job:** Runs every 30 minutes
- **Action:** Auto-rejects stale applications, returns slots to job
- **Prevents:** Workers from staying in limbo waiting for QA feedback

## 4. Job Applications & Work Submission

### 4.1 Application State Machine
**Full 8-state workflow:**
```
submitted → under_review → approved → in_progress → 
submitted_for_review → (completed | revision_requested | failed_qa)
```

**State Transitions:**
- `submitted`: User applied (created by `POST /applications`)
- `under_review`: Admin is evaluating (set by approval endpoint)
- `approved`: Accepted; worker can start (set by `POST /applications/:id/approve`)
- `in_progress`: Worker started work (set by `POST /applications/:id/submit-work`)
- `submitted_for_review`: Worker submitted work for QA (set by `POST /applications/:id/submit-for-review`)
- `completed`: QA approved + payment queued (set by `POST /qa/:appId/approve`)
- `revision_requested`: QA requested changes (set by `POST /qa/:appId/request-revision`)
- `failed_qa`: QA rejected work (set by `POST /qa/:appId/fail`)

### 4.2 Work Submission Flow
1. Worker: `POST /applications/:id/submit-work` → state `approved` → `in_progress`
2. Worker: `POST /applications/:id/submit-for-review` → state `in_progress` → `submitted_for_review`
3. QA Reviewer: Reviews work
4. QA Reviewer: `POST /qa/:appId/approve` → state `submitted_for_review` → `completed` + payment pending

### 4.3 Quality Assurance Functions
- **Approve:** `POST /qa/:appId/approve`
  - Moves to `completed`, queues job.amount to wallet pending
- **Request Revision:** `POST /qa/:appId/request-revision`
  - Moves to `revision_requested`, worker must resubmit
- **Fail:** `POST /qa/:appId/fail`
  - Moves to `failed_qa`, tracks failure count
  - Auto-flag if 3+ failures in 30 days (creates admin alert for review)
- **Resubmit:** `POST /qa/:appId/resubmit`
  - Worker resubmits after revision, state → `submitted_for_review`

## 5. Training System

### 5.1 Training Requirements & Pricing
- **Fee:** $10 USD (1000 cents, configurable)
- **Gate:** If job requires training, worker must complete + pay before applying
- **Module System:** Admin can create training modules with assessments
- **Unlimited Retries:** One payment grants infinite assessment retries

### 5.2 Training Payment Gateway
- **Endpoint:** `POST /training/start`
- **Two-Path Logic:**
  1. **Wallet Sufficient** (≥ $10): Deduct immediately from wallet → mark `training.status = paid`
  2. **Wallet Insufficient** (< $10): Initialize Paystack checkout → return checkout URL + reference

### 5.3 Paystack Integration
- **Integration:** Real Paystack API calls (test mode with `sk_test_` keys)
- **Checkout:** `/training/start` returns `{ checkoutUrl, reference }` for insufficient wallet
- **Reference Format:** `training_<userId>_<timestamp>_<randomId>`
- **Webhook:** `POST /training/webhook`
  - Signature verification: HMAC-SHA512 using `PAYSTACK_SECRET_KEY`
  - Event: `charge.success`
  - Sets `training.status = paid` on success

### 5.4 Training Administration
- **Create Modules:** `POST /training-admin/modules`
  - Fields: title, description, assessmentQuestion, passingScore (default 70)
- **List Modules:** `GET /training-admin/modules`
- **Edit Modules:** `PUT /training-admin/modules/:moduleId`
- **View Stats:** `GET /training-admin/completion-stats`
  - Returns: totalStarted, completed, paid, completionRate (percentage)

## 6. Wallet & Payment System

### 6.1 Wallet Balance States
- **Pending Balance:** Earned from jobs (QA approved), in clearing window (72h default)
- **Available Balance:** Passed clearing window, ready to withdraw
- **Clearing Window:** 72-hour period before funds become withdrawable (dispute window)

### 6.2 Fund Clearing Process
- **Background Job:** Runs every 60 minutes
- **Logic:** Moves transactions older than 72h from `pending` → `available`
- **Manual Override:** Admin can clear funds immediately via `POST /wallet/clear`

### 6.3 Wallet Endpoints
- **View Balance:** `GET /wallet`
  - Returns: available (cents + USD), pending (cents + USD), current KES/USD exchange rate
- **Withdraw:** `POST /wallet/withdraw`
  - Minimum: $10 USD
  - Requires: Verified payout method, no cooldown period
  - Real-time conversion: USD → KES at withdrawal time

### 6.4 Failed Withdrawal Handling
- **Trigger:** Payout fails (invalid account, network error, etc.)
- **Record Creation:** `failed_withdrawals` table entry
- **Admin Actions:**
  - `POST /withdrawals-admin/:failedId/retry` — Re-attempt payout
  - `POST /withdrawals-admin/:failedId/mark-unrecoverable` — Give up, refund to available balance
- **Auto-Refund:** Unrecoverable withdrawals automatically return funds to available

### 6.5 Payout Method Management
- **Update:** `POST /withdrawals-admin/payout-method/update`
  - Method: mobile_money (M-Pesa), bank account, etc.
  - Security: 24-hour cooldown after change (time for security review)
  - Previous number saved in audit trail
- **Verify Change:** `POST /withdrawals-admin/payout-method/verify-change`
  - OTP verification: Code `123456` (test); integrate SMS for production
  - Unlocks new payout method after cooldown expires
- **Guards:** Must match KYC identity; must be verified before withdrawal

## 7. Referral System

### 7.1 Referral Generation
- **Endpoint:** `POST /referrals/generate-link`
- **Access:** Only `active` users can generate links
- **Output:** Referral code (format: `ref_<referrerId>_<timestamp>`)
- **Link Format:** Share with others: `https://app.afterworks.com?ref=<referralCode>`

### 7.2 Referral Signup
- **Endpoint:** `POST /referrals/signup`
- **Parameters:** referralCode, email, firebaseUid (new user's UID)
- **Checks:**
  1. **Rate limit:** Max 10 signups per week per referrer
     - Tracked in `ReferralSignupTracker` (week-based rollover)
     - Returns 429 if exceeded
  2. **Device clustering:** Checks IP + device hash against referrer
     - If matched: Logs alert but allows signup (flags for manual review)
  3. **Self-referral blocking:** Cross-checks KYC identity hashes
     - If matched: Flags both accounts for admin (no auto-ban)
- **Result:** Creates `referral` record linking referrer → referred user

### 7.3 Referral Flow Completion
- **Status Check:** `GET /referrals/status/:referralId`
  - Shows: referral state, referred user's KYC status, completed jobs, eligibility
- **Payout Trigger:** When referred user completes 1+ paid jobs
  - Endpoint: `POST /referrals/payout/:referralId/process`
  - Amount: $30 USD (3000 cents)
  - Queue: Goes to wallet `pending` (same 72h clearing window)

### 7.4 Anti-Fraud Controls
- **Rate Limit:** `ReferralSignupTracker` enforces 10/week per referrer
- **Device Clustering:** IP + UA hash detection (logs alert, no block)
- **Self-Referral Block:** KYC identity hash cross-check
- **Device Fingerprinting:** All devices tracked; reports generated for investigation
- **Audit Trail:** All referral actions logged with timestamp + actor

## 8. Admin Controls & Audit Trail

### 8.1 KYC Management (Admin)
- `POST /admin/kyc/:userId/approve` — Approve KYC, move user to `active`
- `POST /admin/kyc/:userId/reject` — Reject KYC, auto-escalate if retries exhausted
- Both actions logged in `admin_audit_log`

### 8.2 User Management (Admin)
- `POST /admin/users/:userId/suspend` — Prevent user from applying/working; freezes account
- `POST /admin/users/:userId/ban` — Permanent lock; requires executive override to unban
- Both actions logged in `admin_audit_log`

### 8.3 Job Management (Admin)
- `POST /admin/jobs/:jobId/pause` — Pause job; stop accepting new applications
- `POST /admin/jobs/:jobId/close` — Close job; mark as filled
- Both actions logged in `admin_audit_log`

### 8.4 Payment Management (Admin)
- `POST /admin/applications/:appId/hold` — Dispute hold
  - Moves pending payment back to available (reversible)
  - Used for chargeback disputes, quality issues, etc.
- `POST /admin/applications/:appId/release` — Release hold
  - Moves held payment back to pending
  - Triggered after dispute resolution
- Both actions logged with reason

### 8.5 Training Administration (Admin)
- `POST /training-admin/modules` — Create training module
- `GET /training-admin/modules` — List all modules
- `PUT /training-admin/modules/:moduleId` — Edit module
- `GET /training-admin/completion-stats` — View training analytics

### 8.6 Withdrawal Administration (Admin)
- `GET /withdrawals-admin/failed` — View failed withdrawal queue
- `POST /withdrawals-admin/:failedId/retry` — Attempt payout again
- `POST /withdrawals-admin/:failedId/mark-unrecoverable` — Mark as lost, refund
- `POST /withdrawals-admin/payout-method/verify-change` — Confirm payout change

### 8.7 Audit Logging
- **Endpoint:** `GET /admin/audit-log`
- **Last 100 Entries:** Shows all manual admin actions
- **Logged Fields:** Admin user ID, action type, target resource ID, timestamp
- **Actions Tracked:**
  - KYC approval/rejection/appeal
  - User suspension/banning
  - Payment holds/releases
  - Job state changes
  - Training module updates
  - Withdrawal retries/refunds
  - Payout method changes

## 9. Currency Conversion

### 9.1 USD to KES Conversion
- **API:** exchangerate-api.com (free tier)
- **Fallback Rate:** 130 KES/USD (if API unavailable)
- **Update Frequency:** Fetched in real-time at withdrawal time
- **Applied At:** Wallet withdrawal request
- **Example:** $100 USD × 130 = 13,000 KES

### 9.2 Exchange Rate Display
- **Endpoint:** `GET /wallet`
- **Includes:** Current exchange rate in response
- **Use:** For worker reference before withdrawal

## 10. Background Jobs & Automation

### 10.1 Clearing Window Job
- **Schedule:** Every 60 minutes (configurable)
- **Logic:** Find transactions in `pending` state older than 72 hours → move to `available`
- **Implementation:** Node.js `setInterval()` on server startup
- **Prevents:** Memory leaks by scheduling cleanup, not file watching

### 10.2 Stale Application Expiry
- **Schedule:** Every 30 minutes (configurable)
- **Logic:** Find applications in `under_review` state older than 48 hours → auto-reject
- **Refund:** Return slots to `job.slotsRemaining`
- **Purpose:** Prevents workers from staying in limbo indefinitely

## 11. Security & Anti-Fraud Measures

### 11.1 Device Fingerprinting
- **Capture:** IP address + User-Agent header (SHA256 hashed)
- **Storage:** `device_fingerprints` table with userId reference
- **Detection:** `checkDeviceCluster()` function compares fingerprints across users
- **Use:** Flags multi-account farming attempts without hard blocking

### 11.2 Rate Limiting
- **Referrals:** 10 signups per week per referrer (enforced)
- **Proposed:** Add express-rate-limit for API endpoint protection (not yet implemented)

### 11.3 Identity Verification
- **Method:** SHA256 hash of identity fields
- **Check Points:** KYC submission, referral signup, self-referral detection
- **Duplicates:** Both accounts flagged (not auto-banned; requires admin review)

### 11.4 Webhook Signature Verification
- **Paystack:** HMAC-SHA512 signature verification on `x-paystack-signature` header
- **Method:** Verifies webhook authenticity before processing
- **Prevents:** Replay attacks, spoofed webhooks

### 11.5 Proposed Enhancements
- [ ] Add request rate limiting (express-rate-limit)
- [ ] Add input validation (express-validator)
- [ ] Enable HTTPS with strict SSL
- [ ] Add CORS security headers
- [ ] Implement API key authentication for admin endpoints
- [ ] Add request signing for critical operations
- [ ] Enable database encryption at rest
- [ ] Add intrusion detection (Suricata, Snort)
- [ ] Regular security audits (OWASP Top 10)

## 12. Data Model Summary

**15 Prisma Models:**
1. `User` — Account lifecycle, profile, Firebase UID
2. `KycRecord` — KYC status, identity hash, retry tracking
3. `DeviceFingerprint` — IP + UA hash for fraud detection
4. `Job` — Job listings with capacity and state
5. `Application` — Job applications with state machine
6. `TrainingModule` — Training assessment definitions
7. `TrainingProgress` — User training status + payment ref
8. `Wallet` — User balance (available + pending)
9. `Transaction` — Immutable transaction log
10. `PayoutMethod` — Payout account details (mobile/bank)
11. `Referral` — Referrer → referred user link
12. `ReferralSignupTracker` — Weekly signup rate limiting
13. `FailedWithdrawal` — Failed payout queue
14. `AdminAuditLog` — All admin actions logged

---

## Implementation Status

**✅ Implemented:**
- Firebase OAuth + ID token verification
- Device fingerprinting with clustering detection
- KYC workflow with 3-retry limit, duplicate detection, appeals
- Job marketplace with capacity management + auto-expiry
- Full application state machine (8 states)
- Training system with Paystack integration
- Wallet with pending/available states + clearing window
- Withdrawal system with failed queue handling
- Referral system with rate limiting + self-referral blocking
- Admin controls with full audit trail
- Background jobs (clearing, stale app expiry)
- Real-time USD-to-KES conversion

**⚠️ Stubbed (Replace for Production):**
- Digital KYC (use BioID, Vouched, Jumio, etc.)
- OTP verification (use Twilio, AWS SNS, etc.)
- Exchange rate API (monitor uptime)

**❌ Not Yet Implemented (Optional/Future):**
- Rate limiting middleware
- Input validation framework
- Error tracking (Sentry)
- Structured logging (Winston, Pino)
- Admin dashboard UI
- Real-time WebSocket updates
- Mobile app (iOS/Android)
- Merchant integrations
- Dispute resolution system
