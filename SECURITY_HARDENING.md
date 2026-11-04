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
4. Rotate the Paystack secret key and the Firebase service-account JSON too — an
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

### Rate limits are per process, not global

`lib/security.ts` and `lib/guards.ts` keep their buckets in process memory (a bounded Map, swept on
use). That is deliberate for a single Render instance and for local development: it has no extra
database dependency and cannot be taken down by a Firestore outage. It also means:

* each instance has **its own** budget, so an attacker with many connections can get *N ×* the
  configured allowance on an *N*-instance deployment;
* a restart, deploy or cold start clears the buckets;
* the OTP challenge itself (`password_resets/{hmac}`) is persisted, so a code is still burned after
  the configured number of wrong guesses even if the process restarts — the in-memory `otp:` and
  `reset:` counters are the part that is not shared.

For a multi-instance production deployment, add a platform/WAF rate limit (Render, Cloudflare or the
CDN in front of the service) as the outer bound, or replace `attempts()`/`consumeBucket()` with a
Redis/Firestore-backed counter. The application-level limits remain the correct backstop for a
single instance; they are not a distributed guarantee. This is recorded here rather than hidden in a
comment because “we have rate limiting” is otherwise easy to over-trust.
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
`/status`, `/api/health`, `/api/maintenance`, static assets. `/sign-in` and `/sign-up` are **not**
exempt on a whole-site window — `allowSignIn` only keeps auth reachable during a scoped pause.
Bypass is a signed 12 h
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

Disposable domains are still rejected up front by `lib/email-validation.ts`. `EMAIL_FROM` must be
a domain verified in Resend; until then only `beth.t@example.com` delivers, and `/api/health`
reports the mail check as degraded.

### Verification never speaks for the wrong account

The link is opened on a phone, in a browser that may still hold *another* member's session — a
shared device, a second profile, a colleague's tablet. The rule is that a verification may only
ever be reported for the address in the link:

| Rule | Where |
| --- | --- |
| The consume response names the **token's** address, never the session's | `POST /api/auth/verify-email` returns `email` from the claims, plus `sessionMatches` / `signedInEmail` from an *optional* bearer read |
| The page renders that address, and only falls back to the session's when there is no link | `app/verify-email/page.tsx` — `subjectEmail` |
| "Continue to profile" is unreachable when the session is a different account | same page — the crossed-account branch signs the person out and offers "Sign in as &lt;the verified address&gt;" instead |
| The 5 s "verified elsewhere?" poll only runs with no token in the URL | same page — with a link, the consume is the source of truth, so the page stops re-refreshing an ID token |

Google sign-in is judged on the **refreshed** `email_verified` claim, not on the snapshot attached
to the credential `signInWithPopup` returned (`isEmailVerifiedNow` in
`components/firebase-auth-provider.tsx`). The snapshot is what used to send a brand-new Google
member to a verification screen for an inbox Google had already proven, and the same stale read
was bouncing returning members who had verified on another device. The profile document is written
with the state that is actually true rather than a blanket `emailVerified: false`.

## Idle session timeout

A signed-in tab is a wallet, a KYC record and a payout destination, and the Firebase ID token it
carries is replayable for a month — so an unattended tab is an exposure a cookie's Max-Age does not
cover.

`components/idle-session-guard.tsx`, mounted once in `components/app-gate.tsx`:

* **10 minutes** with no `pointerdown` / `keydown` / `wheel` / `touchstart` / `mousemove` ends the
  session: `signOut()`, then `window.location.replace('/sign-in?reason=idle')` — a full navigation,
  not `router.refresh()`, so no in-memory copy of the account is left on the screen.
* The **last 60 seconds** are a visible countdown with "Stay signed in" (also bound to `Escape`,
  and focused on appearance) so a member who is present is never logged out mid-task.
* **Visibility is not activity.** A tab left in the background still times out — that is the whole
  scenario — but any real interaction brings it straight back.
* No session, no timer: the guard is inert on public pages and while signed out.
* `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` (1–120, `0` disables) in `.env.example`.

## Email logo and sender icon

Verification and password-reset emails include the existing AfterWorks logo as an inline PNG
attachment (`lib/email-brand.ts`). The HTML uses `cid:afterworks-logo`; the Resend REST payload
supplies the matching `content_id`. It never depends on a relative URL, `localhost`, `next/image`
or the live site's availability. `public/brand/email-logo.png` has an opaque light background for
dark-mode readability, is regenerated by `npm run brand:build`, and is included in both sending
routes' deployment traces. If the asset is missing, email still sends with text branding rather
than a broken image. Plain-text messages retain the code/link and support address.

This changes **the message body**, not the icon beside the sender in Gmail/Outlook. Inbox avatars
are controlled by the mailbox provider and its sender-profile/BIMI requirements, not by the web
favicon or an HTML template. SPF/DKIM/DMARC and any provider-specific branding must be configured
on the verified sending domain separately. Even inline images may be hidden by a recipient's
settings; the template includes alt text. Only newly sent messages receive template updates.

Transport reference: [Resend inline images](https://resend.com/docs/dashboard/emails/embed-inline-images).

## Self-service password reset (email OTP)

Members who forget their password recover it themselves from `/forgot-password` without a
Firebase-hosted page or a Firebase-branded email. The one-time code travels through Resend like
signup verification; Firebase Auth is only where the new password is written.

| Step | Route body | What happens |
| --- | --- | --- |
| 1. request | `POST /api/auth/password-reset { step: 'request', email }` | If the address belongs to a live account, a 6-digit code is emailed (`PASSWORD_RESET_CODE_TTL_MINUTES`, default 15). The response is identical for unknown addresses; only the audit log distinguishes `PASSWORD_RESET_REQUESTED` from `_UNKNOWN` |
| 2. verify | `{ step: 'verify', email, code }` | Constant-time HMAC compare inside a Firestore transaction. Wrong guesses are counted on the challenge (burned after `PASSWORD_RESET_MAX_ATTEMPTS`, default 5) **and** in the lockout store (`otp:` key). Success returns a signed reset *ticket* (`pr1.<payload>.<sig>`, `PASSWORD_RESET_TICKET_TTL_MINUTES`, default 10) |
| 3. complete | `{ step: 'complete', ticket, password }` | Ticket is bound to the challenge `jti`; the challenge is consumed transactionally, the password is set through the Admin SDK and `revokeRefreshTokens` signs out every other device. Lockouts keyed on the address are cleared |

Storage is one document per address in `password_resets` (doc id = HMAC of the email, holding an
HMAC of the code — the code exists only in the email). Requesting again replaces the document, so
at most one code is live per address. Requests are throttled per address (`reset:` lockout key, plus
a `PASSWORD_RESET_RESEND_COOLDOWN_SECONDS` cooldown, default 60) and per IP (`PASSWORD_RESET_PER_IP`
per 15 min, default 20). `PASSWORD_RESET_SECRET` (32+ chars) can dedicate a signing secret; otherwise
`ADMIN_SESSION_SECRET` is used with a purpose prefix. The password policy (8+ chars, letters and
digits, no obvious words) lives in `lib/password-reset.ts#passwordPolicyError`.

The route is exempt from *scoped* maintenance windows together with `/api/auth/*`; a whole-site
blackout still closes it. Staff can clear a member's lockouts from the Users drawer when the
member has exhausted their guesses and the window has not lapsed.

## Roles: what staff can do

`lib/admin-domain.ts` holds the single capability table both the API guards and the console read:

| Staff may | Owner only |
| --- | --- |
| Approve / reject KYC, triage applications and request revisions, pause or reopen job cards | Suspend, ban, hold or delete accounts |
| Issue a temporary password (`temp-password`) | Wallet adjustments and the money ledger |
| Restore a suspended account (`moderate` → `active` only) | **Approve work and release payment** (`approve_qa`) and mark a payout **paid** |
| Re-enable a disabled sign-in credential (`account` → `enable: true` only) | Staff accounts, role grants, maintenance mode |
| Clear sign-in / reset lockouts for an email (`unlock`) and leave audit notes | Audit log, Security Centre, session revocation |
|  | Cache flushes |

Two further money controls sit on top of the role table:

* A KYC approval or rejection never lifts a `suspended`/`banned` state. Only the
  owner's `moderate` action restores an account; staff cannot “verify” a banned member back in.
* Raw wallet edits and the owner's welcome-reward grant require the owner's **passcode again** in
  the same request (`confirmPasscode`), even though the console session is already authenticated. A
  copied HttpOnly cookie cannot mint or rewrite a balance on its own. Confirmation guesses have their
  own rate-limit bucket, and the change is written to the audit log with the reason and operator
  email.

The rule of thumb: staff can *give access back*, never *take it away* or move money. Every staff
action is still reason-gated and audited under the staff member's own email.

## Quiz keys and lesson checks

Job assessments are graded **server-side** (`POST /api/assessments`): the browser receives the
questions and options, never `correctIndex`, and only a passing server record unlocks an
application. A failed attempt returns no answer key.

Training sections may also carry an optional inline “quick check”. Those are reading aids: they
only tick a section in the learner's own progress and do not unlock work. Their answer index stays in
the job payload so the lesson can mark itself, and a curious learner can read it in devtools — that
is the accepted residual, because it grants nothing the server-scored assessment does not already
control.

## Money

* Training price is computed server-side (`/api/paystack/initialize`) from configuration, never from
  a client-supplied `amount`. The `test_ref_*` shortcut that returned `paid: true` is gone.
* `/api/paystack/verify/[reference]` re-reads the charge from Paystack, requires the payer email to
  match the signed-in member, refuses under-payment, and grants the entitlement to the authenticated
  uid — not to whatever `metadata` the transaction carried.
* A charge is bound to the job card it was opened for. Verification requires `?jobId=` and checks it
  against both the server-written transaction row and Paystack metadata; a reference for card A
  cannot unlock card B, and the browser only credits the job id the server confirms. Cross-card
  attempts are audited as `PAYMENT_JOB_MISMATCH`.
* The webhook compares the HMAC with `timingSafeEqual`, re-verifies the charge upstream, and is
  idempotent, so Paystack retries cannot double-credit.
* `/api/wallet` derives balances from `wallet_ledger` server-side; the client renders, it does not add.

## Efficiency

* The console no longer subscribes to whole collections in the browser: reads are one cursor page at
  a time, projected server-side, with payout handles masked.
* Metrics are aggregated once on the server and cached for 60 s instead of six concurrent listeners
  recomputing the same numbers per tab. Only the owner may force a cache-busting recompute; staff
  get the cached view.
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
