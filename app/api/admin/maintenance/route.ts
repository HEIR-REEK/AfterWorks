/**
 * GET  /api/admin/maintenance — current maintenance state (admin or public GET
 *                                of the same data as /api/maintenance).
 * POST /api/admin/maintenance — update the maintenance config (admin only).
 *
 * Body: { enabled: boolean, message?: string, estimatedUntil?: string }
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getMaintenanceState, setMaintenanceState } from '@/lib/server-config'
import { DEFAULT_MAINTENANCE_MESSAGE } from '@/lib/admin-data'

export async function GET() {
  const state = await getMaintenanceState()
  return NextResponse.json(state)
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, configured: auth.configured },
      { status: auth.configured ? auth.status : 501 },
    )
  }

  let body: { enabled?: boolean; message?: string; estimatedUntil?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: '`enabled` (boolean) is required.' }, { status: 400 })
  }

  const current = await getMaintenanceState()
  const config = {
    enabled: body.enabled,
    message: (body.message ?? current.message ?? DEFAULT_MAINTENANCE_MESSAGE).slice(0, 500),
    estimatedUntil: body.estimatedUntil?.slice(0, 120) ?? current.estimatedUntil,
    updatedAt: new Date().toISOString(),
    updatedBy: auth.caller.email ?? auth.caller.uid,
  }

  const ok = await setMaintenanceState(config)
  if (!ok) {
    return NextResponse.json(
      { error: 'Failed to persist maintenance state to Firestore.', configured: false },
      { status: 501 },
    )
  }

  console.log(`[Admin] Maintenance ${config.enabled ? 'ENABLED' : 'disabled'} by ${config.updatedBy}`)
  return NextResponse.json({ ok: true, ...config, configured: true })
}
