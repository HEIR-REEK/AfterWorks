import { MetadataRoute } from 'next'
import { site } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = site.url.startsWith('http') ? site.url : `https://${site.url}`

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin/',
        '/api/',
        '/profile/',
        '/applications/',
        '/kyc/',
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
