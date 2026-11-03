import { MetadataRoute } from 'next'
import { site } from '@/lib/site'
import { listPublicJobs } from '@/lib/public-jobs-server'
import { PUBLIC_JOB_CATEGORIES, publicCategoryPath, publicJobPath } from '@/lib/public-jobs'

// The public catalogue changes when an operator publishes or closes a card. Read it at request
// time instead of freezing the sitemap at build, so a sitemap URL cannot point at a closed job.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = site.url
  const jobs = await listPublicJobs()

  return [
    {
      url: `${baseUrl}/`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/work`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    ...PUBLIC_JOB_CATEGORIES.map((category) => ({
      url: `${baseUrl}${publicCategoryPath(category.slug)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...jobs.map((job) => ({
      url: `${baseUrl}${publicJobPath(job.id)}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
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
