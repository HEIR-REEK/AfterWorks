# AfterWorks — Admin Panel & Maintenance Mode

## Overview

The admin panel lives at **`/admin`** and gives the AfterWorks team full
operational control of the platform. It is only visible to users with admin
access — everyone else is redirected away and API routes reject them
server-side.

The site also supports a **maintenance mode**: a branded "down for
maintenance" page shown to every non-admin visitor, with a server-side guard
on worker-facing APIs.

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

---

## 2. Panel sections

| Route | What it does |
|---|---|
| `/admin` | **Overview** — workers, KYC queue depth, open jobs/slots, active applications, wallet holdings, newest users, latest applications. |
| `/admin/users` | **Users** — search/filter every worker, expand a row to activate / hold / request resubmission / reject (with reason), and adjust the worker quality score. |
| `/admin/kyc` | **KYC reviews** — the manual verification queue. Approve (activates the account), reject (requires a reason shown to the worker), request resubmission, or hold. Decisions write to `kyc_records/{uid}` and flip the user's `accountState`, mirroring the Didit webhook logic. |
| `/admin/jobs` | **Jobs** — create, edit, publish/pause/close and delete job listings; manage pay, capacity, slots remaining, training gate and closing date. Changes appear in the worker app immediately. |
| `/admin/applications` | **Applications** — drive the full 8-state lifecycle: approve (reserves a slot), reject (refunds a held slot), mark in progress, submit for QA, pass QA & pay (credits the worker's pending balance), request revision, fail QA. |
| `/admin/settings` | **Settings** — maintenance mode toggle + message/ETA, admin-access overview, and the maintenance checklist. |

### Data written by admin actions

- `users/{uid}` — `accountState`, `kycVerified`, `qualityScore`, `wallet.*`, moderation audit fields.
- `kyc_records/{uid}` — `status`, `rejectionReason`, `reviewedBy/At`.
- `jobs/{id}` — full job documents.
- `applications/{id}` — status transitions + history; slot accounting on `jobs/{id}`.
- `site_config/settings` — `maintenance` configuration.

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
match /admins/{uid}        { allow read: own doc only; write: false }  // Admin SDK only
match /jobs/{jobId}        { allow read: signed-in;      write: false }  // Admin SDK only
match /applications/{appId}{ allow read/create: own docs; update/delete: false }
match /site_config/{doc}   { allow read: signed-in;      write: false }  // Admin SDK only
```

Deploy with `firebase deploy --only firestore:rules`.

---

## 4. Demo mode (no Firebase configured)

When Firebase env vars are absent (local sandbox, previews), the whole app —
including the admin panel and maintenance mode — runs on **seeded demo data**:

- The sign-in page offers **“Enter as Admin” / “Enter as Worker”** buttons.
- Admin edits persist to `localStorage` in the browser and are shared live
  with the worker app (job edits, application decisions, KYC decisions,
  maintenance toggle), so the entire loop is explorable without a backend.
- API routes respond with `configured: false` and the client falls back
  gracefully.

Nothing changes in production behaviour once Firebase is configured.

---

## 5. Environment variables

```bash
# Comma-separated allowlist used to bootstrap admins (see §1)
ADMIN_EMAILS=admin@yourdomain.com

# Optional fallback enforced when Firestore is unavailable
# MAINTENANCE_MODE=false
```

## 6. File map

```
app/admin/                    Admin pages (overview, users, kyc, jobs, applications, settings)
app/maintenance/page.tsx      Public maintenance page
app/api/admin/*               Admin-only API routes (Bearer ID token + admin check)
app/api/jobs/route.ts         Worker job listings (Firestore → seed fallback)
app/api/maintenance/route.ts  Public maintenance state (polled by clients)
components/admin/*            Admin shell, UI primitives, data hooks
components/admin-provider.tsx Client admin role resolution
components/maintenance-provider.tsx
components/maintenance-screen.tsx
lib/admin-data.ts             Types, labels, demo seeds, formatting helpers
lib/admin-auth.ts             Server-side admin authorisation (requireAdmin)
lib/server-config.ts          Server-side maintenance state + API guard
```
