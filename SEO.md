# Search indexing

How afterworks.site gets into a search engine, what already handles it in code, and the handful of
steps only an operator can do.

## The problem this solves

Every SEO primitive in this repo was already correct — `app/robots.ts`, `app/sitemap.ts`, the root
`generateMetadata`, Open Graph tags, an `Organization` JSON-LD block and a Search Console
verification file in `public/`. The site still could not be indexed, because **there was nothing
public to index**:

| URL in the old sitemap | What a crawler actually received |
| --- | --- |
| `/` | The signed-in dashboard, then a client-side `router.replace('/sign-in')` → a login form |
| `/jobs` | Same gate → a login form |
| `/sign-in`, `/sign-up` | A login form |
| `/status` | A page whose entire body is fetched client-side after mount |

Four of five advertised URLs were one login form. On top of that every page was a `'use client'`
component reading Firestore from the browser, `firestore.rules` requires `signedIn()` to read
`jobs/{id}`, and `app/loading.tsx` wrapped each route in a Suspense boundary — so React flushed a
skeleton and streamed the real content into a `<div hidden>` plus a swap script. A browser runs that
script; Bing, Yandex, most link unfurlers and every SEO audit tool do not, and they saw "Loading
workspace…" and some grey boxes.

## What is in place now

**Public, server-rendered pages.** `/`, `/jobs` and `/jobs/[id]` render complete HTML on the server
with no session, no JavaScript and no Firebase reachability from the browser.

**The database did not get more open.** Those pages read through the Admin SDK
(`lib/public-catalogue.ts`), which is not subject to `firestore.rules`. Client reads still require
`signedIn()`. Publishing the board changed no rule.

**Paid content is stripped before it is published.** A job document carries `trainingNotes` (the
training a worker pays for) and `assessmentQuestions` *including `correctIndex`*. A Server Component
serialises its props into the RSC payload the browser downloads, so either field in a public render
would hand out the paid material and the answer key. `toPublicJob()` in `lib/public-job.ts` is the
only door from `Job` to `PublicJob`, and `tests/public-catalogue.test.ts` fails if `Job` grows a
field nobody has classified.

**Members keep the product they had.** `components/jobs-board.tsx` and `components/job-detail.tsx`
render the public page at first paint — which is what a crawler indexes — and swap to the live
board (Firestore listener, refresh, "already applied", training checkout) once `AppGate` resolves a
session. The member home moved from `/` to `/dashboard`; `WorkspaceRedirect` sends signed-in
visitors there from the landing page.

**Real per-URL metadata.** Each job card gets its own title, description, canonical, Open Graph and
`JobPosting` + `BreadcrumbList` JSON-LD. Each category filter (`/jobs?category=Transcription`) is a
server-handled URL with its own title and canonical, so the long-tail queries those pages exist to
answer are not collapsed into one.

**The sitemap is generated from the live catalogue** — 5 static routes, one per category, and one
entry per job card with a `lastmod` from the document's own timestamp. It is `force-dynamic`:
prerendering it would freeze the job list into the deploy.

**One canonical hostname.** `www.*` 308s to `NEXT_PUBLIC_APP_URL` (`next.config.js` → `redirects`).

**Private pages stay out.** `/dashboard`, `/profile`, `/applications`, `/kyc`, `/training`,
`/verify-email`, `/forgot-password`, `/admin` and `/api` are `Disallow`ed in robots.txt, carry
`X-Robots-Tag: noindex, nofollow` from `middleware.ts`, and are `noindex` in metadata. Three layers,
because robots.txt alone only stops crawling — it does not stop a page being indexed from links.

**No suspense fallback on public routes.** `app/loading.tsx` was deleted and replaced by
`components/route-loading.tsx`, mounted only from the private segments (`app/dashboard/loading.tsx`
and friends). This is the difference between the content being in the response and being in a
`hidden` div. Do not re-add a root `app/loading.tsx` without checking
`curl -s localhost:3000/ | grep -c '<div hidden id="S:'` returns 0.

## Operator checklist (one time, ~15 minutes)

None of this can be done from code — it needs the Google account that owns the domain.

1. **Confirm the site is not noindexed.** On the production service, `SITE_NO_INDEX` must be
   `false` (or unset). This is the single most common reason a finished site never appears in
   search, and it is invisible from the outside:

   ```bash
   curl -s https://afterworks.site/ | grep -o 'name="robots" content="[^"]*"'
   # want:  name="robots" content="index, follow"
   # fatal: name="robots" content="noindex, nofollow"
   ```

2. **Verify the property in Google Search Console** — <https://search.google.com/search-console>.
   Add **`https://afterworks.site/`** (URL prefix is enough; the Domain option needs a DNS TXT
   record and also covers `www`). The HTML-file token is already committed at
   `public/googlec59a70f87ab9c532.html` and serves 200, so "HTML file" verification should pass
   immediately. If you prefer the meta tag, set `GOOGLE_SITE_VERIFICATION` on the service —
   `app/layout.tsx` emits it.

   > The token in a *filename* and the token in a *meta tag* are different strings. Do not paste the
   > filename into the meta-tag field.

3. **Add `www.afterworks.site` as a second property** (or use the Domain property) so you can see
   that the 308 to the apex is being followed rather than indexed separately.

4. **Submit the sitemap.** Search Console → Sitemaps → enter `sitemap.xml` → Submit. Then check it
   reports the URLs it found:

   ```bash
   curl -s https://afterworks.site/sitemap.xml | grep -c '<loc>'   # expect 5 + categories + job cards
   curl -s https://afterworks.site/robots.txt                       # Sitemap: line must be absolute
   ```

5. **Request indexing for the pages that matter.** URL Inspection → paste
   `https://afterworks.site/` → "Request Indexing". Repeat for `/jobs` and two or three job cards.
   This is a hint, not a queue jump, but it gets the first crawl to happen now instead of in a few
   weeks.

6. **Check the rendered HTML, not the browser.** Search Console → URL Inspection → "View crawled
   page" → confirm it shows the landing copy and the job cards, and that the screenshot is not the
   sign-in form. This is the test that would have caught everything above.

7. **Bing Webmaster Tools** — <https://www.bing.com/webmasters>. Import from Search Console in one
   click; it also feeds ChatGPT search. Worth doing, it is nearly free.

8. **Give it links.** A new domain with no inbound links can take weeks to be crawled deeply. A
   LinkedIn/X post, a product directory listing, and links from any partner or community site all
   shorten that.

## Before you deploy this change

* `NEXT_PUBLIC_APP_URL=https://afterworks.site` and `APP_URL` the same — every canonical, OG URL,
  sitemap entry and JSON-LD `url` is built from it (`site.origin` / `absoluteUrl()` in
  `lib/site.ts`). If it points at `*.onrender.com`, that is what you will tell Google is canonical.
* `APP_ALLOWED_HOSTS` must contain **both** `afterworks.site` and `www.afterworks.site`, or the
  middleware answers the `www` host with a 400 before the redirect can run.
* Firebase → Authentication → **Authorized domains** must list both hostnames (see README). This is
  auth, not SEO, but it is the other thing that silently breaks on a new domain.
* If Cloudflare fronts the apex, do **not** enable "Cache Everything" on HTML: the board and the job
  cards change as slots fill, and a stale cache serves a crawler a job that is already full.

## Verifying it locally

```bash
npm run build && npm run start

# 1. Content is in the first response, not streamed into a hidden div (must print 0).
curl -s localhost:3000/            | grep -c '<div hidden id="S:'
curl -s localhost:3000/jobs        | grep -c '<div hidden id="S:'

# 2. Exactly one <h1>, and it is the page's, not a loading skeleton's.
curl -s localhost:3000/jobs | grep -o '<h1[^>]*>[^<]*'

# 3. Per-card metadata and structured data.
curl -s localhost:3000/jobs/<jobId> | grep -o '<title>[^<]*'
curl -s localhost:3000/jobs/<jobId> | grep -o '"@type":"JobPosting"'

# 4. Paid training content and answer keys must never appear on a public page.
curl -s localhost:3000/jobs/<jobId> | grep -cE 'correctIndex|trainingNotes|assessmentQuestions'  # must be 0

# 5. www consolidates onto the apex (production build only).
curl -sI -H 'Host: www.afterworks.site' localhost:3000/jobs | grep -i location

# 6. Private routes stay out.
curl -sI localhost:3000/dashboard | grep -i x-robots-tag    # noindex, nofollow

npm test   # includes tests/public-catalogue.test.ts
```

Without Firebase configured locally, the pages fall back to the sample catalogue and say so with a
"Sample catalogue" badge — that is the honest label, not a bug. Point the app at the production
Firestore (or deploy) to see live cards.

## What to watch after launch

* **Search Console → Pages**: "Crawled – currently not indexed" on job cards usually means thin or
  duplicated copy — the fix is better job descriptions in the console, not more metadata.
* **Enhancements → Job postings**: Google validates `JobPosting` here. The required fields are all
  emitted; the one to improve is `datePosted`, which currently comes from the document's
  `updatedAt` (or is parsed from the human `postedAgo` copy, and is omitted rather than invented
  when neither exists). Writing a real `postedAt` when the console publishes a card would make it
  exact.
* **Coverage of new cards**: a card published in the console appears in `sitemap.xml` on the next
  request. If cards are published and closed within hours, expect "Discovered – not indexed" for
  some of them; that is normal churn for a job board, not a fault.
* **Never let a private page into the index.** If you add a new member-only route, add it to
  `NOINDEX_PATHS` in `middleware.ts`, to `disallow` in `app/robots.ts`, and to `PUBLIC_ROUTES`'s
  *absence* in `components/app-gate.tsx`.
