# Cloudflare Workers migration

Status: **scaffolded and verified up to the runtime wall. Not deployable yet — one hard blocker
remains, and it is not a configuration flag.**

This document records what was actually run and measured on
`arena/c06d74ac-afterworks`, not what the plan expected. Where the original plan was wrong, that is
called out, because the corrections change the remaining work.

---

## TL;DR

| Item | Result |
|---|---|
| `@opennextjs/cloudflare` + `wrangler` installed, `wrangler.jsonc` + `open-next.config.ts` written | ✅ done |
| `npm run cf:build` produces a Worker bundle | ✅ passes (`next build` + OpenNext both clean) |
| Worker boots in workerd and serves | ✅ boots, `/api/health` → 200 |
| Email logo no longer needs a filesystem | ✅ done, tested |
| REST Firestore + REST ID-token verification written & tested | ✅ 31 new tests |
| **Every page route renders on Workers** | ❌ **500 — `firebase-admin` reaches `protobufjs`, which calls `Function()` codegen, which workerd forbids** |

The last row is the whole migration. Until `firebase-admin` is gone from the request path, the site
does not run on Workers — regardless of how the Worker is configured.

---

## 1. Corrections to the original plan

These matter because they were both wrong, in opposite directions.

### `scrypt` is not a blocker — and it is not on the hot path

The plan proposed moving `scrypt` verification off the hot path. Three facts:

- **workerd implements `node:crypto` `scrypt` natively** under `nodejs_compat`. It is not one of
  the unimplemented families (Diffie-Hellman, streaming signatures, ciphers, RSA-PSS, DSA).
- **This app never verifies a passcode per request.** `verifyPasscode` has exactly three call
  sites: console sign-in (`app/api/admin/auth/route.ts:131`), the staff passcode fallback (line
  142), and two "confirm passcode" dialogs in `app/api/admin/users/route.ts`. It is already off
  the hot path.
- The real cost is **CPU time per sign-in** (`N=16384, r=8, p=1` ≈ 16 MB, tens of ms) against the
  Workers CPU budget. That is a *benchmark* item, not a *design* item.

**Action taken:** nothing changed in `lib/security.ts`. `npm run hash:admin-password` output stays
valid. Benchmark sign-in CPU before optimising; do not pre-emptively restructure auth.

### The real blocker is `protobufjs`, not gRPC alone

The plan said the fix is "a Firestore/Auth REST swap". That is necessary but the failure is
broader than the gRPC transport:

```
firebase-admin@14.5.0
└── @google-cloud/firestore@9.4.0
    └── google-gax@6.14.0 / google-gax@5.0.4
        └── protobufjs@7.6.6   ← calls Function() to build encoders/decoders
```

workerd refuses `eval`/`new Function` ("Code generation from strings disallowed for this context").
So even the *module-level* loading of the Firestore client fails, before any gRPC connection is
attempted. Measured against a booted Worker:

```
500  /            500  /sign-in      500  /terms        500  /privacy
500  /maintenance 500  /status       500  /jobs         500  /work
200  /api/health  200  /api/maintenance               307  /admin  (correct redirect)
```

The two endpoints that work are exactly the two that do not touch `firebase-admin`. This is a
clean, mechanical signal: **the REST client is the fix, and the surface is "everything that imports
`lib/firestore-admin.ts`"** — 11 modules, behind 37 API routes.

### The adapter requires Next ≥ 16.4.5; this repo pinned 16.4.4

`@opennextjs/cloudflare@1.20.19` declares `next: ">=15.5.29 <16 || >=16.4.5"`. The repo was on
`16.4.4`, which satisfies neither branch — npm installed it anyway because the range is a peer
dependency, and the failure would have appeared later and more confusingly.

**Action taken:** bumped `next` to `16.4.6`. `next build`, `tsc --noEmit` and the full test suite
were re-run afterwards; no behavioural change.

---

## 2. What was built (and is tested)

### `lib/email-brand.ts` — no filesystem

The only genuine filesystem dependency in the repo was the email wordmark:
`fs.readFile(path.join(process.cwd(), 'public/brand/email-logo.png'))`. On Workers there is no
`public/` at runtime, so every email would silently fall back to text.

- `scripts/embed-email-logo.mjs` (`npm run brand:embed`) generates `lib/email-logo-data.ts` from
  the PNG. The artefact is committed, matching how `public/brand/*` is already committed, so
  deploying never needs ImageMagick.
- `prepareEmailBranding` is now synchronous work over an imported constant — no I/O, no failure
  mode.
- Removed the now-unnecessary `outputFileTracingIncludes` from `next.config.js`.
- `tests/email.test.ts` pins the generated module to the PNG **byte for byte**, so the two cannot
  drift, and asserts the branding path imports no `fs`/`path`.

### `lib/firestore-rest.ts` — Firestore over REST

Service-account JWT (RS256 via WebCrypto) → OAuth2 token → Firestore REST. Covers the primitives
the hot paths need: point reads, `runQuery` (all comparison operators incl. `in`/`not-in`/
`array-contains-any`), merge writes with an explicit `updateMask`, `create` with an
`exists:false` precondition, deletes, `batchWrite` with the 500-write cap enforced, and optimistic
transactions (`beginTransaction` → `batchGet` → `commit`) with bounded retry+jitter on `ABORTED`.

Design choices worth knowing:

- **`updateMask` is always explicit on merge.** A merge without a mask replaces the document. This
  is the single most destructive mistake available in the REST API, so it is asserted in a test.
- **Tokens are cached per isolate** and shared across a cold-start burst; a `401` re-mints and
  retries exactly once, and only when a provider exists.
- **Values are encoded/decoded explicitly**, because REST wraps every scalar in a type tag and a
  wrong tag turns `1300` into `"1300"` — which would make wallet arithmetic concatenate strings.

### `lib/id-token-rest.ts` — ID tokens without the Admin SDK

`verifyIdToken` is on *every* authenticated route but does not need the Admin SDK: an ID token is
an RS256 JWT and Google's public keys are published. This verifier checks the signature against the
`kid`, then `iss`, `aud`, `exp`/`iat`/`auth_time`, and rejects `alg: none`. Google's key set is
cached with `max-age`, with a single refresh on an unknown `kid`.

The certificate → SPKI extraction walks DER TLVs properly; a byte-scan for `0x30` gets long-form
lengths wrong for 2048-bit keys (this was found by the tests, not by inspection).

### Tests: 31 new, all passing

`tests/firestore-rest.test.ts` (21) and `tests/id-token-rest.test.ts` (10). Notable coverage:

- a payload **edited after signing** is rejected, and a token signed by an attacker key with a
  *known* `kid` is rejected — these prove verification is not just decoding;
- an ABORTED transaction is retried with a fresh transaction id, and reads carry the transaction
  id (otherwise they are not in the snapshot);
- a batch over 500 writes throws before sending rather than half-applying.

**Suite total: 315 tests, 311 pass, 4 fail.** The 4 failures are pre-existing on `main` and
unrelated to this branch — they are listed in §6.

---

## 3. What is NOT done

Deliberately not attempted in this pass, because doing it half-way would be worse than not doing
it:

1. **`lib/firestore-admin.ts` is untouched (3,872 lines, 74 exports).** Rewriting it is the bulk of
   the migration. In the current architecture that is the *correct* split: the REST client is
   proven and tested, and the swap is a separate, reviewable change.
2. **Auth admin operations** — `listUsers` (paging, 5 uses), `getUser`, `getUserByEmail`,
   `createUser`, `deleteUser`, `updateUser`, `setCustomUserClaims`, `revokeRefreshTokens`. Only
   *token verification* is covered so far. The Identity Toolkit REST API supports all of these, but
   each needs encoding and a test.
3. **`FieldValue` sentinels** — `arrayUnion` (6), `increment` (3), `delete` (2). These map to the
   REST `updateTransforms` / `DELETE_FIELD` machinery and are not yet implemented.
4. **The `proctor_events` composite index** required by `tests/firestore-indexes.test.ts` (see §6).

---

## 4. Environment and secrets on Workers

`wrangler.jsonc` carries **non-secret** vars only. Everything credential-shaped from `.env.example`
must be pushed as a secret:

```bash
# One per credential. Never put these in wrangler.jsonc.
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put ADMIN_PASSWORD_SCRYPT
npx wrangler secret put PAYSTACK_SECRET_KEY
npx wrangler secret put PAYSTACK_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
# …every `sync: false` entry in render.yaml
```

Two Worker-specific traps, both of which cost real debugging time here:

- **`APP_ALLOWED_HOSTS` must include the port.** The allow-list compares the raw `Host` header,
  which includes `:8791` locally and `:443` never (Cloudflare strips the default port). Locally the
  whole site answers `400 host_not_allowed` until you set
  `--var APP_ALLOWED_HOSTS:127.0.0.1:<port>`.
- **`NODE_ENV` is inlined into `middleware.ts` at build time** (`const PRODUCTION`). A local
  Worker therefore behaves like production even under `wrangler dev` — that is what made the host
  guard reject traffic instead of passing through in dev. Build the Worker with the real
  production env in place.

---

## 5. Benchmark checklist

Run these before deciding whether the migration is worth finishing. The edge-latency win is the
entire justification, so measure it rather than assuming it.

**Latency**
- [ ] TTFB p50/p95 for `/` and `/jobs` — Workers vs current Render, same region (Nairobi clients,
      so compare `nbo`/`jnb`-close PoPs against Render's region).
- [ ] Cold start: first request to a freshly deployed Worker, and after 5 minutes idle.
- [ ] A request that hits Firestore — REST round-trip to `us-central1` may dominate and erase the
      edge win. **This is the number that decides the project.**
- [ ] Console dashboard (`/api/admin`) — it aggregates several reads; measure the fan-out.

**CPU (Workers bills CPU time, and the free tier is 10 ms/invocation)**
- [ ] `scrypt` sign-in: CPU ms per `POST /api/admin/auth`.
- [ ] `hmac`-based session verification per authenticated request.
- [ ] Next.js RSC render of `/jobs` — the page is dynamic; check it does not exceed the limit.
- [ ] `protobufjs`-free REST client: confirm CPU actually improved vs the Admin SDK path.

**Correctness under load (REST has no live listeners — verify nothing silently depended on them)**
- [ ] Wallet debit/credit under concurrent requests: the optimistic transaction must not
      double-spend. Hammer `/api/wallet` with parallel withdrawals.
- [ ] Referral ledger: one-time application under contention.
- [ ] `create()` uniqueness race on email/phone reservation.
- [ ] Query parity: for each of the 61 `where` clauses in `firestore-admin.ts`, confirm the REST
      query returns the same documents as the SDK. The composite indexes in
      `firestore.indexes.json` must also be satisfied by the REST queries.

**Operational**
- [ ] `wrangler tail` shows no unhandled `EvalError` (the signal that a `firebase-admin` import
      crept back onto a request path).
- [ ] Paystack webhook signature verification and delivery from Cloudflare.
- [ ] Resend email delivery (logo now inline base64 — check Gmail/Outlook do not clip it).
- [ ] Confirm `firestore.rules` still guard everything: REST calls with an OAuth token **bypass
      rules**, exactly as the Admin SDK did. Any route that relied on rules must keep its
      server-side check.

---

## 6. Pre-existing failures on `main` (not caused by this branch)

The suite was not green before any change here: **279 pass / 4 fail** on the base commit. Recorded
so nobody mistakes them for regressions, and fixed separately:

| Test | Cause |
|---|---|
| `every composite Firestore query has a matching declared index` | `proctor_events` query on `uid ASC, at DESC` has no index in `firestore.indexes.json` |
| `console authority never falls back to a mutable users.isAdmin label` | source assertion on the console authority path |
| `identity verification cannot be self-granted, and has no demo approval path` | source assertion on the KYC path |
| `the member-facing route only stamps a review request` | source assertion on `/api/kyc/request` |

The first is a real latent bug (a query that will fail in production once a composite index is
required); the other three are source-text assertions that have drifted from the code.

---

## 7. Recommended path

1. **Decide on the benchmark, not the enthusiasm.** If §5's Firestore round-trip number shows no
   win, stop — Cloudflare Containers would run `firebase-admin` unchanged and lose only the edge
   latency that motivated the move.
2. **If continuing:** move the 11 `firestore-admin` import sites onto `lib/firestore-rest.ts` one
   domain at a time, starting with read-only paths (`public-jobs-server`, `external-jobs-server`),
   then wallet/referrals (transactions), then the console. Keep `firebase-admin` installed
   throughout so `next start` on Render keeps working while the Worker is proven.
3. **Only then** delete `firebase-admin` and flip DNS.
