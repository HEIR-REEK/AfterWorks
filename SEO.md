# Search visibility (SEO) — launch checklist

This is the operational side of getting AfterWorks found in Google, Bing and the other
crawlers. The technical plumbing is in the app; the steps below are what still has to happen
outside the repository.

## What is already in the code

- `/` is a server-rendered public landing page with a unique title, description, canonical URL,
  Open Graph/Twitter cards, `Organization` and `FAQPage` structured data.
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

Today the indexable pages are `/`, `/sign-in`, `/sign-up`, `/terms`, `/privacy` and `/status`.
That is enough for brand searches such as “AfterWorks”, but not for competitive queries such as
“microwork jobs in Kenya” or “transcription work from home Kenya”.

The job board (`/jobs` and job details) is session-gated and therefore deliberately excluded.
To compete for job-seeker queries, the product needs **public, useful pages**, for example:

- public category pages for transcription, data entry, image labelling, content review,
  translation and research;
- public job previews with a clear apply/sign-in path;
- guides such as “how microwork payouts work”, “what KYC means for workers” and
  “how training and assessments work”;
- a public FAQ/help page that expands on the landing-page FAQ.

If public job pages are added, give each one a unique title, description, H1, canonical URL,
`JobPosting` structured data, pay range, location/remote status and closing date. Do not publish
empty or duplicate pages; adding many thin pages is a common way to lose trust.

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
