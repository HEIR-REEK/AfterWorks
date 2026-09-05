import { NextRequest } from 'next/server'
import { audit, consumeBucket, fail, json, requireOwner, routeError } from '@/lib/guards'
import { hashPasscode, passcodeStrength } from '@/lib/security'
import { env, isEmailLike, parseEmailList, sanitizeLine } from '@/lib/security-core'

/**
 * /api/admin/staff — the staff desk. OWNER ONLY.
 *
 * The main administrator adds staff by email and *chooses their console password* here. The
 * password is scrypt-hashed before it touches Firestore and is never returned by any endpoint.
 *
 * Two doors, two keys: a staff member whose email also has a worker account keeps using their
 * Firebase Auth password for the worker app — this password only ever opens the console. Nothing
 * in this route touches Firebase Auth.
 *
 * GET    → { owners: string[], staff: AdminAccountRow[] }
 * POST   { email, passcode }                      → create a staff account
 * PATCH  { email, action: 'password', passcode }  → reset a staff password
 * PATCH  { email, action: 'status', status }      → enable / disable
 * DELETE ?email=                                  → remove the account entirely
 */

export const dynamic = 'force-dynamic'

const MIN_PASSCODE_LENGTH = 10

function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  return req
    .text()
    .then((raw) => (raw.length > 8_000 ? null : (JSON.parse(raw || '{}') as Record<string, unknown>)))
    .catch(() => null)
}

/** Password policy for staff console credentials — the owner decides the value, this decides the floor. */
function validatePasscode(passcode: string): string | null {
  if (typeof passcode !== 'string' || passcode.length < MIN_PASSCODE_LENGTH) {
    return `The password must be at least ${MIN_PASSCODE_LENGTH} characters.`
  }
  if (passcode.length > 200) return 'That password is too long.'
  const strength = passcodeStrength(passcode)
  if (strength.score < 2) return `That password is too weak: ${strength.issues[0] ?? 'mix letters, digits and symbols.'}`
  return null
}

export async function GET(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response
  try {
    const firestore = await import('@/lib/firestore-admin')
    const owners = parseEmailList(env('ADMIN_EMAILS'))
    const staff = firestore.isFirebaseAdminUsable() ? await firestore.listAdminAccounts() : []
    return json({
      ok: true,
      owners,
      staff,
      degraded: firestore.isFirebaseAdminUsable() ? undefined : 'Storage is not configured — staff accounts are unavailable.',
    })
  } catch (err) {
    return routeError('admin/staff:GET', err)
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('admin-staff', 20, 60_000, String(guard.value.jti).slice(0, 12))
  if (!bucket.ok) return fail(429, 'Too many staff changes. Please wait.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })

  const body = await readBody(req)
  if (!body) return fail(400, 'Expected a JSON body.', { code: 'bad_request' })

  const email = sanitizeLine(body.email, 200).toLowerCase()
  const passcode = typeof body.passcode === 'string' ? body.passcode : ''

  if (!isEmailLike(email)) return fail(400, 'Enter a valid email address.', { code: 'invalid_email' })
  if (parseEmailList(env('ADMIN_EMAILS')).includes(email)) {
    return fail(409, 'That email is a main administrator (ADMIN_EMAILS). Owners sign in with the master passcode and cannot be managed here.', { code: 'env_owner' })
  }
  const policyError = validatePasscode(passcode)
  if (policyError) return fail(400, policyError, { code: 'weak_passcode' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Storage unavailable — the staff account was not created.', { code: 'storage_unavailable' })

    await firestore.createAdminAccount({ email, passcodeHash: hashPasscode(passcode), role: 'staff', createdBy: guard.value.email })
    const { invalidateAdminCache } = await import('@/lib/guards')
    invalidateAdminCache(email)

    await audit({ action: 'STAFF_ADDED', actorEmail: guard.value.email, details: { email }, req })
    return json({ ok: true, email, role: 'staff', note: 'Staff account created. Share the password with them securely — it is not stored in readable form anywhere.' })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/already has a staff account/i.test(message)) return fail(409, message, { code: 'duplicate' })
    return routeError('admin/staff:POST', err)
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('admin-staff', 20, 60_000, String(guard.value.jti).slice(0, 12))
  if (!bucket.ok) return fail(429, 'Too many staff changes. Please wait.', { headers: { 'Retry-After': String(bucket.retryAfterSec) } })

  const body = await readBody(req)
  if (!body) return fail(400, 'Expected a JSON body.', { code: 'bad_request' })

  const email = sanitizeLine(body.email, 200).toLowerCase()
  const action = String(body.action ?? '')
  if (!isEmailLike(email)) return fail(400, 'Enter a valid email address.', { code: 'invalid_email' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Storage unavailable — nothing was changed.', { code: 'storage_unavailable' })

    if (action === 'password') {
      const passcode = typeof body.passcode === 'string' ? body.passcode : ''
      const policyError = validatePasscode(passcode)
      if (policyError) return fail(400, policyError, { code: 'weak_passcode' })
      await firestore.updateAdminAccountPasscode(email, hashPasscode(passcode), guard.value.email)
      await audit({ action: 'STAFF_PASSWORD_RESET', actorEmail: guard.value.email, details: { email }, req })
      return json({ ok: true, email, note: 'Password updated. Give the new password to the staff member securely.' })
    }

    if (action === 'status') {
      const status = String(body.status ?? '')
      if (status !== 'active' && status !== 'disabled') return fail(400, 'Status must be "active" or "disabled".', { code: 'invalid_status' })
      await firestore.setAdminAccountStatus(email, status, guard.value.email)
      const { invalidateAdminCache } = await import('@/lib/guards')
      invalidateAdminCache(email)
      await audit({ action: status === 'active' ? 'STAFF_ENABLED' : 'STAFF_DISABLED', actorEmail: guard.value.email, details: { email }, req })
      return json({
        ok: true,
        email,
        status,
        note: status === 'disabled' ? 'Console access stops on their next request.' : 'Console access restored.',
      })
    }

    return fail(400, `Unsupported staff action "${action || '(blank)'}".`, { code: 'unknown_action' })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/No staff account/i.test(message)) return fail(404, message, { code: 'not_found' })
    return routeError('admin/staff:PATCH', err)
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireOwner(req)
  if (!guard.ok) return guard.response

  const email = sanitizeLine(req.nextUrl.searchParams.get('email'), 200).toLowerCase()
  if (!isEmailLike(email)) return fail(400, 'Enter a valid email address.', { code: 'invalid_email' })

  try {
    const firestore = await import('@/lib/firestore-admin')
    if (!firestore.isFirebaseAdminUsable()) return fail(503, 'Storage unavailable — nothing was removed.', { code: 'storage_unavailable' })

    await firestore.deleteAdminAccount(email, guard.value.email)
    const { invalidateAdminCache } = await import('@/lib/guards')
    invalidateAdminCache(email)

    await audit({ action: 'STAFF_REMOVED', actorEmail: guard.value.email, details: { email }, req })
    return json({ ok: true, email, note: 'Staff account removed. If they have a worker account, it is untouched.' })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/No staff account/i.test(message)) return fail(404, message, { code: 'not_found' })
    return routeError('admin/staff:DELETE', err)
  }
}
