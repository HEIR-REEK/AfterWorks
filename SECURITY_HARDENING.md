# Security, capability and maintenance-mode hardening

What changed in this pass, why it mattered, and how to verify each claim. Every item below is
enforced in code, not in documentation.

## Read this first if the site is live

`.env.example` in the repository history contained a real administrator passcode and personal
admin email addresses, and the old build exposed `NEXT_PUBLIC_ADMIN_PASSWORD` in the browser bundle.

1. **Rotate the passcode now**: `node scripts/hash-admin-password.mjs`, set the result as
   `ADMIN_PASSWORD_SCRYPT`, and **delete** `ADMIN_PASSWORD`, `ADMIN_PASSWORD_SALT` and every
   `NEXT_PUBLIC_ADMIN_*` variable from the deployment.
2. **Revoke live sessions**: `/admin/security` → *Revoke all console sessions*. Old tokens stop
   working immediately even if they were copied somewhere.
3. If Firebase Auth is used, **invalidate refresh tokens** for the affected staff accounts.
4. Rotate the Paystack secret key, the Didit API key and the Firebase service-account JSON too — an
   exposed environment file is usually not exposed alone.

`lib/security.ts` runs a posture check on every metrics read and the console shows it on
`/admin/security`; a `NEXT_PUBLIC_ADMIN_*` variable still present in the environment is reported as
`fail`, so step 1 cannot be quietly forgotten.

## Authentication and authorisation

| Previously | Now |
| --- | --- |
| `NEXT_PUBLIC_ADMIN_PASSWORD` read in the browser bundle | no privileged value has a `NEXT_PUBLIC_` prefix; posture check fails if one appears |
| `sessionStorage` token ⇒ "is admin" | HttpOnly, `SameSite=strict`, signed `aw_admin_session` cookie; the browser is never told anything it can reuse |
| token expiry never checked | signature + `exp` + revocation + roster membership re-verified per privileged request |
| rate limiting counted a spoofable `x-forwarded-for` on an unpruned `Map` | budget keyed on an HMAC of IP **and** target email, exponential back-off up to 8× the lockout window, bounded LRU |
| one hardcoded fallback secret | missing `ADMIN_SESSION_SECRET` ⇒ the console is disabled (fail closed); a dev-only ephemeral secret is generated and logged once |
| passcode compared with `===` after a length check | `scrypt` digest (`ADMIN_PASSWORD_SCRYPT`), parsed by prefix, compared with `timingSafeEqual`; length-independent timing |
| any signed-in user could write `users/{uid}` | Firestore rules: ownership on writes, privileged fields (`isAdmin`, `role`, `kycVerified`, `wallet`, `paidTrainings`) server-written only |

Session tokens are minted by `lib/session-token.ts` — the same verifier runs in the Edge middleware
and in Node, so there is exactly one answer to "is this session valid". Revocation lives in
`system/security` (`revokedBefore`, `revokedJtis`) and is cached for 20 s, so "revoke all sessions"
takes effect within twenty seconds across instances.

## Maintenance mode

Real, three layers deep — the previous version was a client-side check that any visitor could bypass
by disabling JavaScript, and the config document was writable from the browser.

| Layer | File | Behaviour |
| --- | --- | --- |
| Edge gate | `middleware.ts` | gated document requests get the **static** outage document with `503` + `Retry-After` (no app render); gated `/api/*` gets a JSON `503` so clients show a banner instead of a stack trace |
| Server | `lib/maintenance-shared.ts`, `app/api/admin/maintenance` | single canonical config, `resolveMaintenance()` decides, writes only through `saveMaintenanceConfigServer()` (field whitelist, `version++`, audit, cache priming) |
| Client | `components/maintenance-provider.tsx`, `app-gate.tsx` | one poller per tab freezes writes, shows a countdown, and never blocks the console |

Exempt during a blackout: `/admin`, `/api/admin/auth`, `/api/admin/session`, `/maintenance`,
`/status`, `/api/health`, `/api/maintenance`, static assets. Bypass is a signed 12 h
`aw_ops_bypass` cookie, minted **only** by `/api/maintenance/bypass` after the server has confirmed
the caller is an admin or on the config's email allow-list.

**The outage page does not need the app.** A gated document request is answered in the edge runtime with a
self-contained HTML document built from the cached config (`lib/maintenance-shell.ts`): no client bundle, no
`<script>`, no Firebase, no Firestore read, inline CSS in the product's own tokens, `meta refresh` while a window
is open, `noindex`, `503` + `Retry-After`. That matters because the app is usually the thing that is degraded — a
maintenance page rendered by a broken app is a blank screen. `MAINTENANCE_STATIC_SHELL=false` falls back to the
rendered `/maintenance` route.

Two scopes, decided in `resolveMaintenance()` and enforced by one predicate (`isGatedPath`) at the edge and in
`maintenanceBlockForApi()`:

| Scope | Behaviour |
| --- | --- |
| `full` | every non-exempt path is gated; `blocksAll` freezes the app (`components/app-gate.tsx`) and `/api/maintenance` answers `503` so monitors fire |
| `sections` | only the operator-selected prefixes (`/jobs`, `/api/wallet`, …) are gated; everything else serves normally with a strip naming the paused areas; the console can never pause `/admin`, `/status`, `/maintenance`, `/api/health`, `/api/maintenance` or `/api/admin` (an ungatable list) — otherwise an outage would lock the operator out of ending it |

A `sections` window with no paths escalates to `full`: "pause nothing" while `enabled` is true is never what was meant.

If Firestore itself is down, `MAINTENANCE_FORCE=blackout` in the platform environment gates traffic
without touching the database; the console shows an override strip instead of pretending the form
controls it, and the `PUT`/`DELETE` responses carry a warning so "I turned it off" is never a
misunderstanding. The override is environment-only by design (a broken database must not be able to re-open
traffic), so **the way to clear it is to unset the variable in Render/Vercel and let the instance restart** —
`MAINTENANCE_FORCE_PATHS` scopes it to listed prefixes and `MAINTENANCE_FORCE_UNTIL` makes it expire on its own.

**When it goes back live is an operator-set field, not a guess.** `estimatedEnd` is stored as a UTC ISO
instant, edited through a date-and-time control that states the browser timezone (so a Nairobi operator
cannot drift three hours against a UTC document), offers `+30m … +8h / Tomorrow 09:00` presets, echoes the
resolved local minute, and shows the `Retry-After` the edge will publish before anything is saved. A past
ETA is labelled overdue rather than silently honoured, `autoResolve` lifts the gate on that minute, and the
console hero counts the remaining time down live with `+30m / +1h / +3h` extensions that write through the
same audited `PUT`. The outage page prints the same instant the server used for `Retry-After`, so the
worker-facing promise and the machine-facing header cannot disagree.

Two modes: `blackout` (reject traffic) and `banner` (site works, warning strip in the app shell) —
for the common case where the platform is degraded, not down. A window may be scheduled
(`scheduledStart`) and `autoResolve` lifts the gate when the ETA passes, so finishing an upgrade at
02:00 does not need someone awake at 04:00. A past ETA with `autoResolve` off is reported as `stale`
rather than silently blocking forever.

## Capability: what the console can actually operate

`/admin` Overview (queues, liability, security notes, live activity), `/admin/users` (paged, redacted
directory + KYC decision + role change + wallet correction + moderation), `/admin/jobs` (publish,
edit, pause, close), `/admin/applications` (triage, QA verdicts, bulk actions, per-transition side
effects), `/admin/maintenance` (full editor with preview), `/admin/audit-log` (filters, CSV),
`/admin/security` (sessions, roster state, live lockouts, posture, self-test), `/status` (public).

Domain rules live in `lib/admin-domain.ts` (which state a member may be moved to) and the
application lifecycle in `lib/firestore-admin.ts` (`TRANSITIONS`). Approving reserves a slot,
declining after approval releases it, completing credits the pending balance idempotently through a
`wallet_ledger` document, and each step notifies the worker **and** writes an audit entry with the
actor and the reason.

## Signup email verification

Firebase Auth no longer sends the verification mail. AfterWorks sends it through Resend so the
from-address, the copy and the link are ours; Firebase is only the place we record the outcome.

| Layer | File | Behaviour |
| --- | --- | --- |
| Transport | `lib/email.ts` | `POST https://api.resend.com/emails` with `RESEND_API_KEY`. Missing key → fail closed, no pretend send |
| Token | `lib/email-verification.ts` | HMAC-SHA256 (`ev1.<payload>.<sig>`), bound to uid **and** email, 24 h TTL, single-use `jti` in `email_verifications` |
| Send | `POST /api/auth/send-verification` | ID token required; address taken from the token, never the body; 3 / 15 min per uid |
| Consume | `POST /api/auth/verify-email` | Public (the click often happens on another device); Admin SDK sets `emailVerified: true` |
| Gate | `components/app-gate.tsx`, `requireVerifiedUser` | Unverified members are held on `/verify-email`. Apply, KYC and Paystack init return `403 email_not_verified` |

Disposable domains are still rejected up front by `lib/email-validation.ts`. Google sign-in that
Firebase already marks `email_verified` skips the hold. `EMAIL_FROM` must be a domain verified in
Resend; until then only `beth.t@example.com` delivers, and `/api/health` reports the mail check as
degraded.

## Money

* Training price is computed server-side (`/api/paystack/initialize`) from configuration, never from
  a client-supplied `amount`. The `test_ref_*` shortcut that returned `paid: true` is gone.
* `/api/paystack/verify/[reference]` re-reads the charge from Paystack, requires the payer email to
  match the signed-in member, refuses under-payment, and grants the entitlement to the authenticated
  uid — not to whatever `metadata` the transaction carried.
* The webhook compares the HMAC with `timingSafeEqual`, re-verifies the charge upstream, and is
  idempotent, so Paystack retries cannot double-credit.
* `/api/wallet` derives balances from `wallet_ledger` server-side; the client renders, it does not add.

## Efficiency

* The console no longer subscribes to whole collections in the browser: reads are one cursor page at
  a time, projected server-side, with payout handles masked.
* Metrics are aggregated once on the server and cached for 20 s instead of six concurrent listeners
  recomputing the same numbers per tab.
* `@prisma/client`, `prisma`, `express`, `express-validator`, `body-parser`, `dotenv`, `nodemon`,
  `@supabase/*` and `react-paystack` were removed: nothing imported them, and they described a backend
  that does not exist.
* Fonts are self-hosted (`@fontsource-variable/inter`, `jetbrains-mono`) — no build-time network
  dependency on Google, no extra origin in the CSP.
* Middleware does not await a Firestore read per request: the maintenance snapshot is cached
  (`MAINTENANCE_CACHE_MS`) and primed on write.

## Verifying

```bash
npm run typecheck
node scripts/hash-admin-password.mjs --help

# unauthenticated privileged call must be 401, not 200
curl -si https://<host>/api/admin | head -1

# spoofed admin flag must grant nothing
curl -si -X POST https://<host>/api/admin/auth -H 'content-type: application/json' \
  -d '{"email":"attacker@example.com","isAdmin":true,"password":"anything"}' | head -1

# cross-site mutation must be refused
curl -si -X POST https://<host>/api/wallet/withdraw -H 'Origin: https://evil.example' | head -1

# during a blackout: 503 + Retry-After for pages and APIs, 200 for the console
curl -si https://<host>/jobs | grep -iE 'HTTP/|retry-after|maintenance'
curl -si https://<host>/api/health | head -1
```

Deploy the rules and indexes with `npm run deploy:rules` (`firebase deploy --only
firestore:rules,firestore:indexes`); composite indexes in `firestore.indexes.json` take a few
minutes to build, and until then the console falls back to unindexed reads and says so in the UI
("add the composite indexes…") rather than erroring.
