/**
 * POST /api/admin/me — admin status probe.
 *
 * Accepts { idToken } (or a Bearer header), verifies it server-side and
 * returns whether the caller is an admin. Allowlisted emails (ADMIN_EMAILS)
 * are auto-promoted (admins/{uid} doc + custom claim) on first call, which
 * bootstraps the very first admin without console access.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'

export async function POST(req: NextRequest) {
  const result = await requireAdmin(req)

  if (!result.ok) {
    // 403 = valid sign-in, just not an admin — not an error for the client.
    if (result.status === 403) {
      return NextResponse.json({ isAdmin: false, configured: true })
    }
    return NextResponse.json(
      { isAdmin: false, configured: result.configured, error: result.error },
      { status: result.configured ? result.status : 501 },
    )
  }

  return NextResponse.json({
    isAdmin: true,
    configured: true,
    uid: result.caller.uid,
    email: result.caller.email,
    via: result.caller.via,
  })
}
