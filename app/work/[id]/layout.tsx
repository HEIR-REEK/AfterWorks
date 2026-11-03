import { redirect } from 'next/navigation'
import { getPublicJob } from '@/lib/public-jobs-server'

/**
 * Resolve the job before the page streams. A missing or closed card redirects to the catalogue rather than
 * rendering a soft 404 with a 200.
 */
export default async function PublicJobLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!(await getPublicJob(id))) redirect('/work')
  return children
}
