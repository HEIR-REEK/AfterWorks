import { RouteLoading } from '@/components/route-loading'

// Private route: nothing here is indexed, so a suspense fallback costs nothing. See
// `components/route-loading.tsx` for why the public pages deliberately have no such file.
export default function Loading() {
  return <RouteLoading label="Loading training…" />
}
