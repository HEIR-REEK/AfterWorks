import { redirect } from 'next/navigation'
import { publicCategory } from '@/lib/public-jobs'

export default async function PublicCategoryLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  if (!publicCategory(category)) redirect('/work')
  return children
}
