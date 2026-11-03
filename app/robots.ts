import { MetadataRoute } from 'next'
import { envBool, isProduction } from '@/lib/security-core'
import { site } from '@/lib/site'

// Read SITE_NO_INDEX at request time, so flipping a staging deployment to noindex does not require
// a rebuild for /robots.txt to agree with the page metadata.
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const noIndex = envBool('SITE_NO_INDEX', !isProduction())

  // Staging/preview deployments must not be indexed at all. The old file always invited every
  // crawler in, even when the page metadata said noindex, so a preview could still be discovered.
  if (noIndex) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/api',
          '/dashboard',
          '/profile',
          '/applications',
          '/jobs',
          '/kyc',
          '/training',
          '/wallet',
          '/referrals',
          '/verify-email',
          '/forgot-password',
        ],
      },
    ],
    sitemap: `${site.url}/sitemap.xml`,
  }
}
