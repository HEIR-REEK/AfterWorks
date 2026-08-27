/**
 * GET /api/maintenance — public.
 *
 * Returns the current maintenance state so the client can gate the whole site
 * without requiring authentication (users in maintenance mode are typically
 * signed out). Polled by the MaintenanceProvider.
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getMaintenanceState } from '@/lib/server-config'

export async function GET() {
  const state = await getMaintenanceState()
  return NextResponse.json(state)
}
