import { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/site'

/**
 * robots.txt, generated rather than committed as a static file.
 *
 * The split is deliberate: everything a signed-out visitor can read is open (the landing page, the
 * board, each job card, the status page), and everything personal or privileged is disallowed. A
 * crawler that respects this never asks for somebody's wallet, and Search Console never reports a
 * private route as "discovered but blocked by robots.txt with content".
 *
 * `Disallow` here is a crawl budget hint, not a security control — the actual gate is
 * `components/app-gate.tsx` plus `X-Robots-Tag: noindex` from `middleware.ts` on the same paths, so a
 * private page cannot be indexed even if a link to it leaks.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = absoluteUrl('').replace(/\/$/, '')

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin/',
          '/api/',
          '/dashboard/',
          '/profile/',
          '/applications/',
          '/kyc/',
          '/training/',
          '/verify-email/',
          '/forgot-password/',
          '/maintenance/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
