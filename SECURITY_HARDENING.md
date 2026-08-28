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
| Edge gate | `middleware.ts` | gated document requests get the maintenance screen with `503` + `Retry-After`; `/api/*` gets a JSON `503` so clients show a banner instead of a stack trace |
| Server | `lib/maintenance-shared.ts`, `app/api/admin/maintenance` | single canonical config, `resolveMaintenance()` decides, writes only through `saveMaintenanceConfigServer()` (field whitelist, `version++`, audit, cache priming) |
| Client | `components/maintenance-provider.tsx`, `app-gate.tsx` | one poller per tab freezes writes, shows a countdown, and never blocks the console |

Exempt during a blackout: `/admin`, `/api/admin/auth`, `/api/admin/session`, `/maintenance`,
`/status`, `/api/health`, `/api/maintenance`, static assets. Bypass is a signed 12 h
`aw_ops_bypass` cookie, minted **only** by `/api/maintenance/bypass` after the server has confirmed
the caller is an admin or on the config's email allow-list.

If Firestore itself is down, `MAINTENANCE_FORCE=blackout` in the platform environment gates traffic
without touching the database; the console shows an override strip instead of pretending the form
controls it, and the `PUT`/`DELETE` responses carry a warning so "I turned it off" is never a
misunderstanding.

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
