/**
 * One email = one account. One phone number = one account.
 *
 * Two halves, because two different stores are involved and neither is complete on its own:
 *
 *  • **Firebase Auth** is the credential. It already refuses to create a second account for an
 *    address, which is the real guarantee for email. But Auth can be edited or deleted from the
 *    console, which leaves a `users` document behind with no credential — and a stale document
 *    with the same address will happily answer a lookup that Auth can no longer answer.
 *  • **Firestore `users`** is the profile. It is where the phone lives, and it is the only place
 *    a phone is recorded at all.
 *
 * So the phone rule is enforced here, against the profile collection, and the email rule is
 * enforced against *both* — Auth first (authoritative for "can this person sign in?"), then the
 * profile collection (authoritative for "whose account is this?").
 *
 * On comparing phone numbers: the comparison key is the **E.164 digit string** (`254712345678`),
 * never the text a member typed. `0712345678`, `+254 712 345 678` and `0712 345 678` are one
 * number, and comparing the raw text is exactly how three accounts end up sharing a phone.
 * `PHONE_UNIQUE_BACKFILL` notes exist for rows written before this module existed and therefore
 * have no `phoneKey`; those are caught by the literal-variant queries and the bounded scan below.
 */

// `firestore-admin` imports *this* module (to canonicalise a phone on account creation), so a
// static import of the whole of it back the other way would be a cycle. Only the handles are
// needed at load time; `createAuditEntry` is pulled in lazily, once, at the one call site.
import { adminDb, dbOrNull, getAuthAdmin, isFirebaseAdminUsable } from '@/lib/firestore-admin'
import { clampNumber, normalizeEmail } from '@/lib/security-core'
import { normalisePhone, phoneMatchKey } from '@/lib/countries'

/** How many legacy documents the fallback scan may read before giving up. */
const SCAN_LIMIT = clampNumber(process.env.PHONE_UNIQUE_SCAN_LIMIT, { min: 0, max: 2000, fallback: 500 })

export type UniquenessConflict = {
  /** The uid that already holds this identifier. Never returned to the *other* member. */
  uid: string
  kind: 'email' | 'phone'
}

export class UniquenessError extends Error {
  constructor(
    message: string,
    readonly code: 'email_taken' | 'phone_taken' | 'phone_invalid',
    readonly status = 409,
  ) {
    super(message)
    this.name = 'UniquenessError'
  }
}

// ─── Email ───────────────────────────────────────────────────────────────────

/**
 * The uid that already owns this address, or null.
 *
 * Auth is consulted first and deliberately: an address that *can* sign in belongs to that account
 * even if no profile document survives. The profile query then catches the reverse — a document
 * that Auth has forgotten.
 */
export async function findEmailOwnerUid(email: string, opts: { exceptUid?: string } = {}): Promise<string | null> {
  const clean = normalizeEmail(email)
  if (!clean) return null

  if (isFirebaseAdminUsable()) {
    try {
      const record = await getAuthAdmin().getUserByEmail(clean)
      if (record.uid && record.uid !== opts.exceptUid) return record.uid
    } catch (err) {
      // Only "no such user" is expected; anything else (network, permissions) must not be read as
      // "the address is free", so it falls through to the profile collection below and the caller
      // gets a real answer from there.
      const message = err instanceof Error ? err.message : ''
      if (!/user-not-found|USER_NOT_FOUND|no user record/i.test(message)) {
        console.warn('[uniqueness] Auth email lookup failed; falling back to the profile collection:', message)
      }
    }
  }

  const db = dbOrNull()
  if (db) {
    try {
      const snap = await db.collection('users').where('email', '==', clean).limit(5).get()
      for (const doc of snap.docs) {
        if (doc.id !== opts.exceptUid) return doc.id
      }
    } catch (err) {
      console.warn('[uniqueness] profile email lookup failed:', err instanceof Error ? err.message : err)
    }
  }

  return null
}

/** Throws `UniquenessError` when the address is already on another account. */
export async function assertEmailAvailable(email: string, opts: { exceptUid?: string } = {}): Promise<void> {
  const owner = await findEmailOwnerUid(email, opts)
  if (owner) {
    throw new UniquenessError(
      'An AfterWorks account already uses this email address. One person gets one account — sign in, or reset your password if you have lost access.',
      'email_taken',
    )
  }
}

// ─── Phone ───────────────────────────────────────────────────────────────────

/**
 * The literal strings a phone may already be stored as, for the legacy rows that predate
 * `phoneKey`. Each is queried exactly — never with a `contains`, which cannot use an index and
 * would turn a profile save into a collection scan.
 */
function legacyPhoneVariants(rawInput: string, e164: string, country: string): string[] {
  const digits = e164.replace(/\D/g, '')
  const national = phoneMatchKey(e164, country)
  const out = new Set<string>()
  for (const value of [rawInput, rawInput.trim(), e164, digits, national, `+${digits}`, `0${national}`]) {
    const clean = String(value ?? '').trim()
    if (clean) out.add(clean)
  }
  return [...out].slice(0, 8)
}

/**
 * The uid that already holds this phone number, or null.
 *
 * `rawInput` and `country` come from the member's form and are only used to catch documents
 * written before `phoneKey` existed; the authoritative comparison is always the E.164 key.
 */
export async function findPhoneOwnerUid(input: {
  raw: string
  country: string
  exceptUid?: string
}): Promise<UniquenessConflict | null> {
  const parsed = normalisePhone(input.raw, input.country)
  if (!parsed.ok) {
    throw new UniquenessError(parsed.error, 'phone_invalid', 400)
  }
  const key = phoneMatchKey(parsed.e164, parsed.country)
  const db = dbOrNull()
  if (!db) return null

  const ignore = (uid: string) => uid === input.exceptUid

  // 1. Fast path: every document written since `phoneKey` existed carries it.
  try {
    const snap = await db.collection('users').where('phoneKey', '==', key).limit(5).get()
    for (const doc of snap.docs) if (!ignore(doc.id)) return { uid: doc.id, kind: 'phone' }
  } catch (err) {
    console.warn('[uniqueness] phoneKey lookup failed:', err instanceof Error ? err.message : err)
  }

  // 2. Legacy rows: the literal forms the number may have been saved as.
  for (const variant of legacyPhoneVariants(String(input.raw ?? ''), parsed.e164, parsed.country)) {
    try {
      const snap = await db.collection('users').where('phone', '==', variant).limit(5).get()
      for (const doc of snap.docs) {
        if (ignore(doc.id)) continue
        // Re-normalise before reporting: `phone` is free text, so a substring match is not a match.
        const stored = normalisePhone(String((doc.data() ?? {}).phone ?? ''), parsed.country)
        if (stored.ok && phoneMatchKey(stored.e164, stored.country) === key) return { uid: doc.id, kind: 'phone' }
      }
    } catch (err) {
      console.warn('[uniqueness] legacy phone lookup failed:', err instanceof Error ? err.message : err)
    }
  }

  // 3. Backstop for rows stored in a format neither query above anticipated. Bounded, and
  //    configurable to 0 once `phoneKey` has been backfilled across the collection.
  if (SCAN_LIMIT > 0) {
    try {
      const snap = await db.collection('users').where('phone', '!=', '').limit(SCAN_LIMIT).get()
      for (const doc of snap.docs) {
        if (ignore(doc.id)) continue
        const stored = String((doc.data() ?? {}).phone ?? '')
        if (!stored) continue
        const parsedStored = normalisePhone(stored, parsed.country)
        if (parsedStored.ok && phoneMatchKey(parsedStored.e164, parsedStored.country) === key) {
          return { uid: doc.id, kind: 'phone' }
        }
      }
    } catch (err) {
      console.warn('[uniqueness] phone backstop scan skipped:', err instanceof Error ? err.message : err)
    }
  }

  return null
}

/**
 * Validates a phone the member is trying to claim and returns the canonical values to store.
 *
 * Throws rather than returning null, because both failure modes need distinct copy: a malformed
 * number is the member's typo (400), and a number on someone else's account is a rule they have
 * just hit (409). Collapsing them into one "invalid phone" message is how people end up
 * retyping a number ten times.
 */
export async function assertPhoneAvailable(input: {
  raw: string
  country: string
  exceptUid?: string
}): Promise<{ e164: string; country: string; key: string; display: string }> {
  const conflict = await findPhoneOwnerUid(input)
  if (conflict) {
    throw new UniquenessError(
      'That mobile number is already linked to another AfterWorks account. One person gets one account — use a different number, or sign in to the account that already has it.',
      'phone_taken',
    )
  }
  const parsed = normalisePhone(input.raw, input.country)
  if (!parsed.ok) throw new UniquenessError(parsed.error, 'phone_invalid', 400)
  return {
    e164: parsed.e164,
    country: parsed.country,
    key: phoneMatchKey(parsed.e164, parsed.country),
    display: parsed.display,
  }
}

/**
 * Writes the canonical phone fields onto a profile document.
 *
 * `phoneKey` is what the uniqueness query reads; `phoneCountry` is what the picker reopens on.
 * Both are written together with `phone` so a document is never half-migrated.
 */
export async function writeCanonicalPhone(uid: string, resolved: { e164: string; country: string; key: string }): Promise<void> {
  const db = adminDb()
  await db.collection('users').doc(uid).set(
    {
      phone: resolved.e164,
      phoneKey: resolved.key,
      phoneCountry: resolved.country,
    },
    { merge: true },
  )
}

// ─── The claim guard ─────────────────────────────────────────────────────────

/**
 * One document per phone number — `phone_claims/<e164 digits>` → `{ uid, claimedAt }` — owned by
 * the uid that holds the number.
 *
 * `findPhoneOwnerUid` above is a *query*, and a query cannot make a decision: two members saving
 * a profile at the same moment can both read "nobody has this number" and both write it. The rule
 * would then hold only until the first reload. This document is the part that is actually
 * serialised — two transactions writing the same document id conflict, and Firestore re-runs the
 * loser, which by then sees the winner's claim and refuses.
 *
 * It is written in the *same transaction* as the profile save, so a claim and the number it claims
 * can never disagree, and it is released in that same transaction when the member changes their
 * number — otherwise correcting a typo would leave the old number taken by the person who just
 * gave it up.
 */
export const PHONE_CLAIMS_COLLECTION = 'phone_claims'

/** The error thrown from inside a transaction when another account already holds the number. */
export function phoneTakenError(): UniquenessError {
  return new UniquenessError(
    'That mobile number is already linked to another AfterWorks account. One person gets one account — use a different number, or sign in to the account that already has it.',
    'phone_taken',
  )
}

/**
 * One-off repair for rows written before `phoneKey` existed.
 *
 * Not called from a request path: it is a maintenance routine an operator runs once
 * (`npx tsx scripts/backfill-phone-keys.ts`) and then sets `PHONE_UNIQUE_SCAN_LIMIT=0` to retire
 * the backstop scan in `findPhoneOwnerUid`.
 */
export async function backfillPhoneKeys(limit = 2000): Promise<{ scanned: number; updated: number }> {
  const db = dbOrNull()
  if (!db) return { scanned: 0, updated: 0 }
  let scanned = 0
  let updated = 0
  const batch = db.batch()
  let pending = 0

  const pageSize = Math.min(2000, Math.max(1, limit))
  let query = db.collection('users').where('phone', '!=', '').limit(pageSize)
  for (;;) {
    const snap = await query.get()
    if (snap.empty) break
    for (const doc of snap.docs) {
      const data = (doc.data() ?? {}) as Record<string, unknown>
      if (data.phoneKey) continue
      scanned += 1
      const country = String(data.phoneCountry ?? data.country ?? 'KE')
      const parsed = normalisePhone(String(data.phone ?? ''), country)
      if (!parsed.ok) continue
      batch.set(
        doc.ref,
        { phoneKey: phoneMatchKey(parsed.e164, parsed.country), phone: parsed.e164, phoneCountry: parsed.country },
        { merge: true },
      )
      updated += 1
      pending += 1
      if (pending >= 400) {
        await batch.commit()
        pending = 0
      }
    }
    const last = snap.docs[snap.docs.length - 1]
    if (!last || snap.size < pageSize) break
    query = query.startAfter(last)
  }
  if (pending > 0) await batch.commit()
  const { createAuditEntry } = await import('@/lib/firestore-admin')
  await createAuditEntry('PHONE_KEYS_BACKFILLED', { scanned, updated }, 'system:maintenance')
  return { scanned, updated }
}
