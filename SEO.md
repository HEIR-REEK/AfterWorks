# Search visibility (SEO) — launch checklist

This is the operational side of getting AfterWorks found in Google, Bing and the other
crawlers. The technical plumbing is in the app; the steps below are what still has to happen
outside the repository.

## What is already in the code

- `/` is a server-rendered public landing page with a unique title, description, canonical URL,
  Open Graph/Twitter cards, `Organization` and `FAQPage` structured data.
- `/work` is a server-rendered public catalogue; `/work/category/<slug>` has category guides and
  `/work/<id>` is a public job preview with `JobPosting` + `BreadcrumbList` structured data. The
  public projection deliberately excludes assessment questions, answer indexes and training notes.
- `app/layout.tsx` sets `metadataBase` from the configured public origin, not from a hard-coded
  host. A production build refuses to publish a `localhost` origin.
- `app/robots.ts` serves `robots.txt`, and `app/sitemap.ts` serves `sitemap.xml`.
- Authenticated surfaces (`/dashboard`, `/profile`, `/applications`, `/jobs`, `/wallet`, `/kyc`,
  `/training`, `/admin`, `/api`) are excluded from robots and return `X-Robots-Tag: noindex`.
- `SITE_NO_INDEX=true` turns the whole site off for crawlers. Use it on staging and preview
  deployments.
- The Google ownership file is at `public/googlec59a70f87ab9c532.html`. `GOOGLE_SITE_VERIFICATION`
  and `BING_SITE_VERIFICATION` are also supported for the HTML-tag method if the domain changes.

## 1. Make the production origin unambiguous

Set these before the production build:

```dotenv
APP_URL="https://afterworks.site"
NEXT_PUBLIC_APP_URL="https://afterworks.site"
APP_ALLOWED_HOSTS="afterworks.site,www.afterworks.site"
SITE_NO_INDEX="false"
```

Also add the production host (without `https://`, a port or a wildcard) to
Firebase Authentication → Settings → Authorized domains. Rebuild after changing
`NEXT_PUBLIC_APP_URL`; it is part of the public metadata.

Quick checks after deploy:

```bash
curl -sS https://afterworks.site/robots.txt
curl -sS https://afterworks.site/sitemap.xml
curl -sSI https://afterworks.site/ | grep -i 'HTTP/\|robots\|link'
```

The homepage must not contain `noindex`, and the sitemap must contain the real domain.

## 2. Verify ownership and submit the sitemap

1. **Google Search Console** — add a **Domain property** (`afterworks.site`) and verify it with a
   DNS TXT record. A domain property covers `www`, `http` and `https` together. The existing
   HTML-file method also works for a URL-prefix property.
2. **Bing Webmaster Tools** — add the site and import it from Search Console, or verify with the
   `msvalidate.01` token.
3. Submit `https://afterworks.site/sitemap.xml` in Search Console → Sitemaps and in Bing.
4. Use **URL Inspection → Request indexing** once for the homepage. Repeated requests do not make
   Google crawl faster and can look manipulative.
5. Check **Page indexing** after a few days. Investigate “Discovered — currently not indexed” or
   “Crawled — currently not indexed” pages rather than repeatedly resubmitting them.

## 3. Know what can actually rank

The public catalogue now lives at `/work`, with category pages at `/work/category/<slug>` and a
public preview for each open card at `/work/<id>`. The authenticated workspace at `/jobs` remains
private: it contains the member's application state and working board, not a marketing page.

To compete for job-seeker queries, keep adding **public, useful pages**, for example:

- the category pages for transcription, data entry, image labelling, content review,
  translation and research (already present — keep the copy current);
- a guide for “how microwork payouts work”, “what KYC means for workers” and
  “how training and assessments work”;
- a public FAQ/help page that expands on the landing-page FAQ;
- public updates when pay, fees or categories change.

The `/work/<id>` pages carry a unique title, description, H1, canonical URL, `JobPosting` and
`BreadcrumbList` structured data, pay, remote/Kenya eligibility and closing date. They are
generated only for open cards with a free slot and a future deadline. Do not publish empty or
duplicate pages; adding many thin pages is a common way to lose trust.

## Why only the homepage is indexed

This is the usual order of causes, from most likely to least likely:

1. **The live sitemap or canonicals contain `localhost`.** Older builds fell back to
   `http://localhost:3000` when `NEXT_PUBLIC_APP_URL` was missing. Google cannot crawl those URLs,
   so it may only know the homepage from an external link. Check:
   ```bash
   curl -sS https://afterworks.site/sitemap.xml | grep -o '<loc>[^<]*' | head
   curl -sS https://afterworks.site/sign-in | grep -o '<link rel="canonical"[^>]*>'
   ```
   Every URL must be `https://afterworks.site/...`. If they are localhost, set
   `NEXT_PUBLIC_APP_URL` and `APP_URL`, rebuild, redeploy, then resubmit the sitemap.
2. **The deployment still has an old build.** The canonical/robots fixes are in commit
   `266c4e4`. A Git push alone does not change the live site; trigger a production deploy and
   verify the live files with the commands above.
3. **`/jobs` is intentionally noindex.** It requires a session, so it is excluded from the
   sitemap, robots and page metadata. The public, indexable catalogue is `/work` and its category
   and job-preview pages; keep the signed-in board private.
4. **`/sign-in` and `/sign-up` are utility pages.** Google often decides not to index login and
   signup forms because they have little unique content and are duplicated across the web. This is
   normal; the pages are not broken. Do not chase them. Build a public `/join` or category page
   instead if you want a signup-related result.
5. **The pages are new and have no external links.** “Discovered — currently not indexed” and
   “Crawled — currently not indexed” are quality/authority decisions, not crawl errors. Internal
   links from the homepage help; sitemap submission does not guarantee indexing.
6. **The exact reason is in Search Console.** Open **Indexing → Pages**, click the URL, and read
   the reason. The important ones are:
   - *Excluded by noindex tag* → check the live `<meta name="robots">` and `X-Robots-Tag`.
   - *Blocked by robots.txt* → check the live `/robots.txt`; do not use `Disallow: /` in production.
   - *Alternate page with proper canonical tag* → the canonical points at another URL.
   - *Crawled/Discovered — currently not indexed* → content/authority issue.
   - *Soft 404* → the page looked empty or like a login redirect to Google.

The `site:afterworks.site` search operator is not a complete index report; it is a sample and can
show only the homepage even when more pages are indexed. Use Search Console → Pages instead.

## 4. Content that earns links and trust

Search engines rank pages that answer a query better than the alternatives. For AfterWorks that
means:

- show real pay amounts, the payout process and the training/assessment path;
- explain who is eligible and what verification requires;
- publish updates when payouts, fees or job categories change;
- link the landing page to the public category/guide pages and back again;
- keep the `sameAs` profiles in `lib/site.ts` accurate (X/Twitter, LinkedIn) and use the same
  brand name, logo and description everywhere;
- earn links from worker communities, training partners, press coverage and relevant directories.
  Never buy links or use link schemes.

## 5. Measure what matters

- Search Console: impressions, clicks, average position, CTR, indexing status.
- Bing Webmaster Tools: the same, plus crawl errors.
- Analytics: organic sessions → sign-up → profile completion → first application.
- Core Web Vitals: the landing page is server-rendered and images use `next/image`; keep it that
  way when adding content.
- Review queries monthly and write pages for the questions people actually ask.

## 6. Do not

- Do not index private workspaces “for SEO”.
- Do not add a `noindex` to the homepage while trying to rank.
- Do not use hidden text, cloaking, doorway pages or purchased links.
- Do not rely on the `keywords` meta tag; Google ignores it. It is harmless, not a ranking lever.
