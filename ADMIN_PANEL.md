# AfterWorks — Admin Panel & Maintenance Mode

## Overview

The admin panel lives at **`/admin`** and gives the AfterWorks team full
operational control of the platform. It runs entirely on **production data**:
every read and write goes through `/api/admin/*` routes that verify the
caller's Firebase ID token with the Firebase Admin SDK before touching
Firestore. There is no demo/mock mode anywhere in the app.

The site also supports a **maintenance mode**: a branded "down for
maintenance" page shown to every non-admin visitor, with a server-side guard
on worker-facing APIs.

### Requirements

- Firebase project with Firestore + Auth enabled (`firebase.json`,
  `.firebaserc` are in the repo).
- Environment variables from `.env.example` — in particular
  `FIREBASE_SERVICE_ACCOUNT_JSON` (server), the `FIREBASE_WEB_*` config
  (client auth), and `ADMIN_EMAILS`.
- Didit credentials for real KYC (`DIDIT_*`) and Paystack credentials for
  payments (`PAYSTACK_*`). Missing KYC/payment credentials **fail closed** —
  sessions and checkouts return errors instead of mock-approving.

---

## 1. Admin access

A caller is an admin when **any** of these holds:

| Mechanism | Where | How to grant |
|---|---|---|
| Custom claim | Firebase Auth `customClaims.admin === true` | Set automatically by the bootstrap (below) |
| Firestore doc | `admins/{uid}` → `{ email, role: "admin" }` | Create the doc in the Firebase console |
| Env allowlist | `ADMIN_EMAILS` env var (comma-separated) | Add the email, restart/redeploy |

### Bootstrapping the first admin

1. Set `ADMIN_EMAILS=you@yourdomain.com` in the environment.
2. Sign in to AfterWorks with that email.
3. Open `/admin` — on the first request the server verifies the email against
   the allowlist, writes `admins/{uid}`, and sets the `{ admin: true }`
   custom claim. You're in, and future checks are faster.

### How authorisation is enforced

- **Client:** `AdminProvider` probes `POST /api/admin/me` with the signed-in
  user's Firebase ID token. Non-admins never see the Admin nav item, and
  `/admin/*` renders an "Admin access required" screen.
- **Server:** every `/api/admin/*` route calls `requireAdmin()` which verifies
  the Bearer ID token with the Firebase Admin SDK **before** checking admin
  status. There are no admin capabilities that rely on client-side checks.
- **Not configured:** without Firebase credentials nobody can sign in, and
  admin APIs respond with `configured: false` (HTTP 501) — the panel shows
  the error instead of pretending to work.

---

## 2. Panel sections

| Route | What it does |
|---|---|
| `/admin` | **Overview** — workers, KYC queue depth, open jobs/slots, active applications, wallet holdings, newest users, latest applications. |
| `/admin/users` | **Users** — search/filter every worker, expand a row to activate / hold / request resubmission / reject (with reason), and adjust the worker quality score. |
| `/admin/kyc` | **KYC reviews** — the manual verification queue. Approve (activates the account), reject (requires a reason shown to the worker), request resubmission, or hold. Decisions write to `kyc_records/{uid}` and flip the user's `accountState`, mirroring the Didit webhook logic. |
| `/admin/jobs` | **Jobs** — create, edit, publish/pause/close and delete job listings; manage pay, capacity, slots remaining, training gate and closing date. Changes are served to workers from the Firestore `jobs` collection (`GET /api/jobs`). |
| `/admin/applications` | **Applications** — drive the full 8-state lifecycle: approve (reserves a slot), reject (refunds a held slot), mark in progress, submit for QA, pass QA & pay (credits the worker's pending balance), request revision, fail QA. |
| `/admin/settings` | **Settings** — maintenance mode toggle + message/ETA, admin-access overview, and the maintenance checklist. |

### Data written by admin actions

- `users/{uid}` — `accountState`, `kycVerified`, `qualityScore`, `wallet.*`, moderation audit fields.
- `kyc_records/{uid}` — `status`, `rejectionReason`, `reviewedBy/At`.
- `jobs/{id}` — full job documents.
- `applications/{id}` — status transitions + history; slot accounting on `jobs/{id}`.
- `site_config/settings` — `maintenance` configuration.

### Live data-flow

- Workers' job listings come from `GET /api/jobs` (Firestore `jobs` → JSON).
  Nothing is shown until an admin publishes a job.
- When a worker applies, the application is written to `applications/{id}` in
  Firestore and streamed back to the worker in real time (`onSnapshot`).
- Admin lifecycle actions update the same documents, so workers see status
  changes immediately; approving reserves a job slot and a QA pass credits
  the worker's `wallet.pendingUsd` (48–72h clearing per the system spec).

---

## 3. Maintenance mode

- **Toggle:** `/admin/settings` → Maintenance mode (with an explicit
  confirmation before taking the site down).
- **What workers see:** a full-screen page (route `/maintenance`) with the
  configured message, optional "expected back by" estimate, retry button and
  reassurance about balances/payments. The page auto-recovers when mode is
  switched off.
- **What admins see:** everything — plus a warning banner and an
  "Exit preview" affordance on the maintenance page itself. The sign-in page
  stays reachable (with a notice) so admins can always sign in.
- **Server enforcement:** while enabled, worker-facing mutating APIs return
  **503**:
  - `POST /api/kyc/submit` (new verification sessions)
  - `POST /api/paystack/initialize` (new checkouts)

  Webhooks (Paystack / Didit) and all `GET` reads still work, so payments
  confirmed during maintenance are never lost. Admin APIs are exempt.
- **Storage:** Firestore `site_config/settings.maintenance`, polled by clients
  via the public `GET /api/maintenance` (30s cadence). When Firestore isn't
  reachable the server falls back to the `MAINTENANCE_MODE` env var, so a
  database outage can't block taking the site down.

### Firestore rules

`firestore.rules` now includes:

```
match /admins/{uid}         { allow read: own doc only; write: false }        // Admin SDK only
match /jobs/{jobId}         { allow read: signed-in;      write: false }      // Admin SDK only
match /applications/{appId} { read/create: own docs; update: only the worker's
                              "submit for review" transition; delete: false }
match /site_config/{doc}    { allow read: signed-in;      write: false }      // Admin SDK only
```

Deploy with `firebase deploy --only firestore:rules`.

---

## 4. Environment variables

```bash
# Comma-separated allowlist used to bootstrap admins (see §1)
ADMIN_EMAILS=admin@yourdomain.com

# Optional fallback enforced when Firestore is unavailable
# MAINTENANCE_MODE=false
```

## 5. File map

```
app/admin/                    Admin pages (overview, users, kyc, jobs, applications, settings)
app/maintenance/page.tsx      Public maintenance page
app/api/admin/*               Admin-only API routes (Bearer ID token + admin check)
app/api/jobs/route.ts         Worker job listings (Firestore `jobs` collection)
app/api/maintenance/route.ts  Public maintenance state (polled by clients)
components/admin/*            Admin shell, UI primitives, data hooks
components/admin-provider.tsx Client admin role resolution (server-verified)
components/maintenance-provider.tsx
components/maintenance-screen.tsx
lib/admin-data.ts             Types, labels, formatting helpers
lib/admin-auth.ts             Server-side admin authorisation (requireAdmin)
lib/server-config.ts          Server-side maintenance state + API guard
```
