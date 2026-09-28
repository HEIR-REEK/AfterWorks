import { NextRequest } from 'next/server'
import { consumeBucket, fail, json, maintenanceBlockForApi, rateLimit, requireUser, routeError } from '@/lib/guards'
import { readJsonBody } from '@/lib/security-core'
import { adminDb, createAuditEntry } from '@/lib/firestore-admin'
import { TERMS_VERSION } from '@/lib/terms'

/**
 * POST /api/auth/terms — record acceptance of the Terms and the Privacy Notice.
 *
 * Why this is a server write rather than a field in the sign-up form's body:
 *
 *  • The sign-up form runs on the *client* Firebase SDK, so the profile document it writes is one
 *    the member's own browser authored. Putting "I accepted version X on date Y" in a
 *    client-written field would mean the member's browser is the sole authority on the single
 *    piece of information we would ever want to be able to prove. Here the timestamp is the
 *    server's, and the account id is taken from the verified token rather than the request body.
 *  • It is deliberately *not* required for the account to exist. If this call fails, the member
 *    has an account and a working platform; the UI says acceptance was not recorded. Faking a
 *    legal record is a smaller problem than locking a real worker out of work.
 *
 * The gate itself is enforced in the UI: the Create account button is blurred and disabled until
 * both boxes are ticked, and the Google button is held back the same way.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 'terms-accept', 10, 60_000)
  if (limited) return limited

  const blocked = await maintenanceBlockForApi(req)
  if (blocked) return blocked

  const guard = await requireUser(req)
  if (!guard.ok) return guard.response

  const bucket = consumeBucket('terms-accept-write', 5, 60_000, guard.value.uid)
  if (!bucket.ok) return fail(429, 'Please wait a moment before trying again.', { code: 'rate_limited' })

  const parsed = await readJsonBody<{ terms?: unknown; privacy?: unknown }>(req, 1_000)
  if (!parsed.ok) return fail(400, parsed.error, { code: 'bad_request' })

  // The server does not take the member's word for which boxes were ticked: it records both
  // together, or refuses. A partial acceptance is not a thing.
  if (parsed.data.terms !== true || parsed.data.privacy !== true) {
    return fail(400, 'Both the Terms and the Privacy Notice must be accepted.', {
      code: 'acceptance_incomplete',
    })
  }

  try {
    const now = new Date().toISOString()
    const ref = adminDb().collection('users').doc(guard.value.uid)

    // First acceptance wins, and it is decided by the *version*, not by the clock. A member who
    // already accepted the terms currently in force keeps the timestamp they gave them; only a
    // genuinely new version re-asks. Without this, anything that replayed the call — a returning
    // member signing in again, a retried request — would silently restamp the acceptance, and the
    // field that is supposed to answer "when did this person agree to this?" would start
    // answering "when did this person last log in?".
    const existing = await ref.get()
    const prior = (existing.exists ? existing.data() : {}) as Record<string, unknown>
    const alreadyAccepted = prior.termsVersion === TERMS_VERSION && typeof prior.termsAcceptedAt === 'string'
    if (alreadyAccepted) {
      return json({ ok: true, acceptedAt: prior.termsAcceptedAt, version: TERMS_VERSION, alreadyRecorded: true })
    }

    await ref.set(
      {
        termsAcceptedAt: now,
        termsVersion: TERMS_VERSION,
        privacyAcceptedAt: now,
        privacyVersion: TERMS_VERSION,
        termsAcceptedEmail: guard.value.email,
      },
      { merge: true },
    )
    await createAuditEntry(
      'TERMS_ACCEPTED',
      { uid: guard.value.uid, version: TERMS_VERSION, terms: true, privacy: true, renewedFrom: prior.termsVersion ?? null },
      `member:${guard.value.uid}`,
    )
    return json({ ok: true, acceptedAt: now, version: TERMS_VERSION })
  } catch (err) {
    return routeError('auth/terms:POST', err)
  }
}
