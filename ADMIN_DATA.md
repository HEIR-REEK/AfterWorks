# Where every console number comes from

The rule for this project: **a figure in the admin panel is either read from the system that owns it, or it
is labelled as unknown.** "0" is only shown when zero is the truth — never as a stand-in for "we could not
work it out", because a dashboard that renders failures as zeros is how an operator ends up believing a
payout ran.

## Sources of truth

| Figure | Owned by | Read through | Notes |
| --- | --- | --- | --- |
| Accounts, disabled, never signed in, last sign-in, providers | **Firebase Auth** | Admin SDK `auth.listUsers()` / `getUsers()` (`lib/firestore-admin.ts`) | Cached for `ADMIN_STATS_CACHE_MS` (default 90 s). Scanned up to `AUTH_SCAN_CAP` (5 000) accounts; beyond that `capped: true` and the console says "at least". |
| Profiles, KYC state, roles, wallet balances, moderation note | **Firestore `users/{uid}`** | `listUsersPage`, `getUserDetail`, `getPlatformStats` | A profile is a description; Auth is the credential. Both are fetched so the two can be compared. |
| Jobs, slots filled, capacity | Firestore `jobs` | `getPlatformStats`, `listJobsServer` | Slot arithmetic happens on approval/rejection, not in the browser. |
| Applications, QA states, per-job throughput | Firestore `applications` | `listApplicationsPage`, `getPlatformStats` | Transitions are validated server-side against `TRANSITIONS` in `lib/firestore-admin.ts`. |
| Earnings credits, withdrawals, clearing | Firestore **`wallet_ledger`** | `listLedgerPage` → `/admin/money` | Written by the application lifecycle (`wd_<applicationId>`, idempotent) and the wallet route. |
| Card payments for training | Firestore **`transactions`** + **Paystack** | `listLedgerPage`, `getPlatformStats.payments` | Amounts are re-verified against `api.paystack.co` at confirmation; a Firestore row alone never means "paid". |
| Platform liability (`pendingUsd + availableUsd`) | Firestore `users.*.wallet` | `getPlatformStats` | Projected read of up to 1 000 wallets per pass; the console shows the window it scanned. |
| Failed sign-ins, lockouts, role changes | Firestore `admin_logs` + in-memory buckets | `listAuditLogs`, `/api/admin/security` | Audit entries are redacted on write (`lib/security.ts`) and capped at 6 KB. |
| Maintenance window | Firestore `system/maintenance`, or `MAINTENANCE_FORCE*` | `lib/maintenance-shared.ts` | Env override wins everywhere, and the console reports `forced: true` instead of pretending to control it. |
| Deployment posture (secrets, keys, rules) | process environment | `/api/health` checks | Each check reflects a variable the app really reads — `DIDIT_API_KEY`, `PAYSTACK_SECRET_KEY`, `ADMIN_SESSION_SECRET`, service account. |

## Deliberate limits, stated in the UI

- **Aggregate counts** use `count()` queries (one query, not N reads) and fall back to a bounded read of
  500 documents when the security rules deny counting; the number is then a floor, and `degraded` says so.
- **Wallet totals** project at most 1 000 `users` documents per refresh, so liability on a very large
  project is a lower bound until it is moved to a scheduled aggregation job.
- **Auth scanning** stops at `AUTH_SCAN_CAP`; "activity this week" is computed from the accounts it saw.
- **Ledger merge** (`/admin/money`) reads each collection separately and merges in memory, so the newest
  page is exact while deep paging can interleave at the tail. The row's `degraded` note says when that applies.
- Nothing in the console reads a browser-controlled document to decide privilege, a balance or a payment.

## Data-management actions (server-side, audited)

| Action | What it does | Where |
| --- | --- | --- |
| Suspend / ban / restore | Writes `users/{uid}.accountState` **and** flips the Auth `disabled` flag | `PATCH /api/admin/users` `action: moderate` |
| Disable / enable credential | Auth only, for when the two have drifted | `action: account` |
| Temporary password | `auth.updateUser({ password })` with a fresh value returned once, never stored | `action: temp-password` |
| Verification link | `auth.generateEmailVerificationLink()` handed to the operator (the app sends no email) | `action: verification-link` |
| Flag for deletion | Bans + stamps `deletedAt`, keeps financial rows | `action: delete` |
| Erase account | Deletes profile, credential, notifications, applications; redacts ledger rows unless `eraseLedger` | `action: erase` (reason ≥ 12 chars + uid confirmation) |

Every one of these goes through `requireAdmin`, a same-site check, a rate bucket and `createAuditEntry`, so
the audit log is a complete record of the console's effect on data. Passwords are never stored by this app:
worker credentials live in Firebase Auth (hashed by Google) and the operator passcode is verified against a
scrypt digest in `ADMIN_PASSWORD_SCRYPT` (`npm run hash:admin-password`).

## Making the numbers real on a fresh project

1. `cp .env.example .env.local`, fill in the Firebase block + `FIREBASE_SERVICE_ACCOUNT_JSON`,
   `ADMIN_EMAILS`, `ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD_SCRYPT`.
2. `npm run deploy:rules` (rules + indexes from `firestore.rules` / `firestore.indexes.json`).
3. Sign up one worker through the app, so `users/{uid}` and the Auth account both exist — the directory
   reads both, so a hand-inserted Firestore document shows up as "no Auth account".
4. `/admin` Overview: `Accounts` should now equal the Auth total. If it shows "Auth not connected", the
   Admin SDK is not initialised — check the service account, not the code.
5. `/admin/money` fills up as applications are completed and withdrawals are requested; before that it is
   legitimately empty, and says so.
