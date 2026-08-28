# AfterWorks

Microwork platform for Kenyan data work: workers browse job cards, pay for the job-specific training
where required, pass an assessment, apply, submit work, and get paid into a wallet that settles to
mobile money. An operations console handles KYC decisions, QA, the catalogue, payouts and maintenance
windows.

Next.js 14 (App Router) · Firestore · Firebase Auth · Paystack · Didit · Tailwind v4. There is no
separate Express/Prisma backend — the API routes in `app/api/**` *are* the server.

## Run it

```bash
npm install
cp .env.example .env.local     # fill in Firebase; the app degrades to demo mode without it
npm run dev                    # http://localhost:3000
npm run typecheck              # tsc --noEmit — the gate used before every commit
```

With no Firebase configuration the site still renders in **demo mode**: job cards come from
`lib/afterworks-data.ts`, a strip in the app shell says so, and nothing is written anywhere. Sign-in,
payments and the console stay disabled rather than pretending to work.

The console needs `ADMIN_EMAILS` (the roster), `ADMIN_SESSION_SECRET` (≥ 32 chars) and a passcode
verifier from `npm run hash:admin-password`. Without those it fails closed and says why.

## Layout

| Path | What lives there |
| --- | --- |
| `middleware.ts` | Edge security: CSRF/host checks, maintenance gate, header policy |
| `lib/session-token.ts` | one sign/verify path shared by Edge and Node (admin + maintenance-bypass cookies) |
| `lib/security.ts`, `lib/security-core.ts` | passcode hashing, attempt budgets, redaction, env parsing |
| `lib/maintenance-shared.ts` | canonical maintenance config + resolution, edge-safe |
| `lib/guards.ts` | `requireAdmin` / `requireUser`, rate buckets, audit, shared response envelope |
| `lib/firestore-admin.ts` | server-side data access: moderation, QA transitions, stats, ledger |
| `lib/firestore.ts`, `lib/client-api.ts` | client reads and the fetch wrapper (timeouts, idempotency, error codes) |
| `app/api/**` | every privileged operation, one guarded route handler each |
| `components/app-gate.tsx` | sign-in gate + maintenance interception for the worker app |
| `app/admin/**` | operations console (overview, users, jobs, QA, maintenance, audit, security) |

## Conventions that matter

* **The client never decides anything privileged.** No `isAdmin`, balance, "paid" flag or QA status is
  read from a browser-controlled document or `localStorage`; the server derives it.
* **Mutations go through a route handler** with `requireAdmin`/`requireUser`, a rate bucket, a reason
  where it is destructive, and an audit write. Direct Firestore writes from the browser are for
  member-owned profile fields only, and `firestore.rules` enforces that split.
* **Fail closed.** A missing secret, unreachable datastore or unsigned webhook produces an
  honest error, not a permissive default.
* **Images are pre-sized, not optimised at runtime.** `sharp` is not a dependency, so `/_next/image`
  returns 400 in production and any `next/image` source that relies on it silently fails to load. Brand
  art is therefore generated at the right size up-front (`npm run brand:build`) and rendered with
  `unoptimized`. Install `sharp` before removing that flag or adding photographic content.
* **Theme**: tokens in `app/globals.css` (`bg-card`, `border-border`, `text-muted-foreground`,
  `bg-primary`), `components/ui/*`, `StatusBadge tone`, Inter + JetBrains Mono for numerics and ids.
  New UI should read as the same product, not a dashboard bolted on.

## Operations

* Public status page: `/status` (polls `/api/health`, shows service states and the maintenance window).
* Maintenance is edited at `/admin/maintenance` and enforced at the edge (`503` + `Retry-After`), not
  only in the client. The window carries a **back-live date & time** — pick it from the picker, or use
  `+30 min / +1 h / +2 h / +4 h / +8 h / Tomorrow 09:00`; the console shows the resolved local time,
  what is left on the countdown, the `Retry-After` a crawler will be handed, and `+30m +1h +3h` buttons
  to push an active window out without reloading the form. With *Auto-resolve at the ETA* the gate lifts
  itself on that minute. See `SECURITY_HARDENING.md`.
* Brand assets are generated: `npm run brand:build` re-crops `brand/logo-source.png` (source artwork,
  never shipped) into `public/brand/*`, `app/icon.png` and `app/apple-icon.png`. `components/brand.tsx`
  is the only thing that renders them — the monogram in chrome, the full lockup on centred screens.
* Deploy rules + indexes: `npm run deploy:rules` after editing `firestore.rules` / `firestore.indexes.json`.
* `render.yaml` is the deployment blueprint; every secret there is `sync: false` on purpose.

## Documentation map

`SECURITY_HARDENING.md` (what is enforced and how to verify it) · `DEPLOYMENT.md` (Render/Firebase
setup) · `FEATURES.md` and `IMPLEMENTATION_STATUS.md` are **specification** documents: they describe
several features that were never built, and each file opens with a list of what is actually true.
