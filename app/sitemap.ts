import { MetadataRoute } from 'next'
import { site } from '@/lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = site.url.startsWith('http') ? site.url : `https://${site.url}`
  
  return [
    {
      url: `${baseUrl}`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    // /jobs is deliberately absent: the board requires a session (AppGate redirects signed-out
    // visitors to /sign-in), so asking a crawler to index it would only advertise a redirect. The
    // landing page explains the work instead and carries the FAQPage structured data.
    {
      url: `${baseUrl}/sign-in`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/sign-up`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/status`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.4,
    },
  ]
}
