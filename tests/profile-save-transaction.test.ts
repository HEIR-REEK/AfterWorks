import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Firestore } from 'firebase-admin/firestore'
import { saveMemberProfile } from '@/lib/wallet-server'
import { UniquenessError } from '@/lib/account-uniqueness'
import { normalisePhone, phoneMatchKey } from '@/lib/countries'
import { WELCOME_BONUS_USD } from '@/lib/profile-completion'

/**
 * "PATCH /api/profile → 500 (Internal Server Error)", three times in a row, on the screen where a
 * member finishes their profile.
 *
 * The cause was one line's position. `saveMemberProfile` runs everything inside a single Firestore
 * transaction, and Firestore's rule for a transaction is absolute: **every read must happen before
 * the first write.** The phone-claim guard writes `phone_claims/<number>` (it has to — the claim
 * document *is* the lock that stops two accounts taking one number), and then the referral release
 * was called, which began with `tx.get(referrals/<uid>)`. Read after write. Firestore rejects the
 * whole transaction with `FAILED_PRECONDITION`, the route's catch-all maps that to a 500, and
 * because the condition was "the patch contains a phone number **and** the profile is now
 * complete", it fired on exactly the save that was supposed to pay the $5 welcome reward and
 * release the referrer's $3 — the two things a profile save exists to do.
 *
 * A comment above the call claimed the staging happened "before any write in this transaction".
 * It did not, and nothing enforced it, because the violation is *indirect*: the write is in
 * `saveMemberProfile` and the read is inside the function it calls. A source scan looking for
 * `tx.get` after `tx.set` cannot see it; a transaction that refuses to behave that way can.
 *
 * So these tests drive the real `saveMemberProfile` against an in-memory Firestore that enforces
 * the two rules the real one enforces and the reported failure violated:
 *   • no read after a write, inside a transaction;
 *   • no `undefined` field values (the other historical cause of a 500 on this route).
 */

// ─── A Firestore that refuses what Firestore refuses ─────────────────────────

type Doc = Record<string, unknown>

/** Firestore's own message, so a failure reads the same here as it does in production. */
const READ_AFTER_WRITE = 'Firestore transactions require all reads to be executed before all writes.'

function assignPath(target: Doc, key: string, value: unknown): void {
  const parts = key.split('.')
  let node = target
  for (const part of parts.slice(0, -1)) {
    const next = node[part]
    if (!next || typeof next !== 'object' || Array.isArray(next)) node[part] = {}
    node = node[part] as Doc
  }
  node[parts[parts.length - 1]] = value
}

/** `set(…, { merge: true })` on a dotted path must not wipe the sibling leaves beside it. */
function mergeInto(existing: Doc, data: Doc): Doc {
  const next: Doc = structuredClone(existing)
  for (const [key, value] of Object.entries(data)) assignPath(next, key, value)
  return next
}

function assertDefined(path: string, data: Doc, prefix = ''): void {
  for (const [key, value] of Object.entries(data)) {
    const where = `${path}.${prefix}${key}`
    if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${where}")`)
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      // FieldValue sentinels are objects too; only plain maps are walked.
      const proto = Object.getPrototypeOf(value) as object | null
      if (proto === Object.prototype || proto === null) assertDefined(path, value as Doc, `${prefix}${key}.`)
    }
  }
}

class FakeFirestore {
  readonly docs = new Map<string, Doc>()

  constructor(seed: Record<string, Doc> = {}) {
    for (const [path, value] of Object.entries(seed)) this.docs.set(path, structuredClone(value))
  }

  read(path: string): Doc | undefined {
    return this.docs.get(path)
  }

  ref(path: string) {
    const self = this
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      path,
      async get() {
        const data = self.docs.get(path)
        return { exists: Boolean(data), id: path.slice(path.lastIndexOf('/') + 1), data: () => (data ? structuredClone(data) : undefined) }
      },
      async set(data: Doc, options?: { merge?: boolean }) {
        assertDefined(path, data)
        self.docs.set(path, options?.merge ? mergeInto(self.docs.get(path) ?? {}, data) : structuredClone(data))
      },
      async delete() {
        self.docs.delete(path)
      },
    }
  }

  collection(name: string) {
    const self = this
    return {
      doc(id: string) {
        return self.ref(`${name}/${id}`)
      },
    }
  }

  /**
   * The transaction. Reads are allowed until the first write and refused after it — the rule the
   * production code broke — and nothing is committed unless the body resolves.
   */
  async runTransaction<T>(body: (tx: unknown) => Promise<T>): Promise<T> {
    const self = this
    const pending: Array<{ path: string; data: Doc | null; merge: boolean }> = []
    let writtenPath = ''

    const tx = {
      async get(ref: { path: string }) {
        if (writtenPath) throw new Error(`${READ_AFTER_WRITE} (read of "${ref.path}" after the write to "${writtenPath}")`)
        const data = self.docs.get(ref.path)
        return {
          exists: Boolean(data),
          id: ref.path.slice(ref.path.lastIndexOf('/') + 1),
          data: () => (data ? structuredClone(data) : undefined),
        }
      },
      set(ref: { path: string }, data: Doc, options?: { merge?: boolean }) {
        writtenPath ||= ref.path
        assertDefined(ref.path, data)
        pending.push({ path: ref.path, data, merge: options?.merge === true })
      },
      delete(ref: { path: string }) {
        writtenPath ||= ref.path
        pending.push({ path: ref.path, data: null, merge: false })
      },
    }

    const result = await body(tx)

    for (const write of pending) {
      if (write.data === null) {
        self.docs.delete(write.path)
        continue
      }
      self.docs.set(write.path, write.merge ? mergeInto(self.docs.get(write.path) ?? {}, write.data) : structuredClone(write.data))
    }
    return result
  }
}

function asDb(fake: FakeFirestore): Firestore {
  return fake as unknown as Firestore
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PHONE = '+254712345678'
const kenyonPhone = () => {
  const parsed = normalisePhone(PHONE, 'KE')
  assert.ok(parsed.ok, 'the fixture phone number must be valid')
  return { e164: parsed.e164, key: phoneMatchKey(parsed.e164, parsed.country) }
}

/** Every field `profileCompletion` requires, so a save with this patch takes the profile to 100%. */
const COMPLETING_SAVE: Doc = {
  name: 'Brian Mwangi',
  phone: PHONE,
  phoneCountry: 'KE',
  location: 'Kiambu',
  bio: 'Data entry and transcription, three years.',
  skills: ['Data entry', 'Transcription'],
  languages: ['English', 'Swahili'],
  preferredPayoutMethod: 'M-Pesa',
}

// ─── The reported 500 ────────────────────────────────────────────────────────

test('a profile save that completes the profile with a phone number does not break the transaction', async () => {
  const db = new FakeFirestore()
  const result = await saveMemberProfile('u1', COMPLETING_SAVE, { db: asDb(db) })

  // The save is what the member came for.
  assert.equal(db.read('users/u1')?.name, 'Brian Mwangi')
  assert.equal(db.read('users/u1')?.phone, kenyonPhone().e164)
  assert.equal(result.completion.complete, true, 'the profile must score as complete')
  assert.deepEqual(result.grantedBonus, { amountUsd: WELCOME_BONUS_USD })

  // …and the three things the transaction writes afterwards all landed.
  assert.ok(db.read(`phone_claims/${kenyonPhone().key}`), 'the phone claim must be written')
  assert.equal(db.read(`wallet_ledger/signup_bonus_u1`)?.kind, 'signup_bonus')
  // Dotted leaf paths, expanded — never a nested `wallet` object, which Firestore would reject
  // alongside the `wallet.payoutNumber` write in the same update.
  assert.equal((db.read('users/u1')?.wallet as Doc).availableUsd, WELCOME_BONUS_USD)
  assert.equal((db.read('users/u1')?.wallet as Doc).payoutNumber, kenyonPhone().e164)
})

test('the phone claim and the profile land in the same transaction, so a crash cannot half-apply them', async () => {
  // A claim written without the number (or a number written with no claim) is the state the claim
  // document exists to prevent: the number would look free to the next account that tries it.
  const db = new FakeFirestore()
  await saveMemberProfile('u1', COMPLETING_SAVE, { db: asDb(db) })

  const claim = db.read(`phone_claims/${kenyonPhone().key}`)
  assert.equal(claim?.uid, 'u1')
  assert.equal(db.read('users/u1')?.phoneKey, kenyonPhone().key)
})

test('a phone number another account already holds is a conflict (409), not a 500', async () => {
  const key = kenyonPhone().key
  const db = new FakeFirestore({ [`phone_claims/${key}`]: { uid: 'someone-else', key, claimedAt: '2026-01-01T00:00:00.000Z' } })

  await assert.rejects(
    () => saveMemberProfile('u1', COMPLETING_SAVE, { db: asDb(db) }),
    (err: unknown) => {
      assert.ok(err instanceof UniquenessError)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'phone_taken')
      return true
    },
  )
  // The refused transaction committed nothing — not the profile, not the claim.
  assert.equal(db.read('users/u1'), undefined)
  assert.equal(db.read(`phone_claims/${key}`)?.uid, 'someone-else')
})

// ─── The referral bonus, in the same transaction ─────────────────────────────

const REFERRAL_SEED: Record<string, Doc> = {
  [`phone_claims/${kenyonPhone().key}`]: { uid: 'u1', key: kenyonPhone().key, claimedAt: '2026-01-01T00:00:00.000Z' },
  'referrals/u1': {
    id: 'u1',
    code: 'AWK7MNPQ',
    referrerUid: 'ref-1',
    referrerName: 'Amina Otieno',
    referrerEmail: 'amina@example.com',
    referredUid: 'u1',
    referredName: 'Brian Mwangi',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  'users/ref-1': { uid: 'ref-1', accountState: 'active', kycVerified: true, wallet: { pendingUsd: 2, availableUsd: 10 } },
}

test('completing a referred profile credits the referrer, in the same transaction', async () => {
  const db = new FakeFirestore(REFERRAL_SEED)
  const result = await saveMemberProfile('u1', COMPLETING_SAVE, { db: asDb(db) })

  assert.deepEqual(result.releasedReferral, { referrerName: 'Amina Otieno', bonusUsd: 3 })
  // The referrer's pending balance, their statement line, and the attribution flip.
  assert.equal((db.read('users/ref-1')?.wallet as Doc).pendingUsd, 5)
  assert.equal(db.read('wallet_ledger/referral_bonus_u1')?.kind, 'referral_bonus')
  assert.equal(db.read('wallet_ledger/referral_bonus_u1')?.uid, 'ref-1')
  assert.equal(db.read('referrals/u1')?.status, 'qualified')
  // The member's own balance moved by the welcome reward only — the referral is not paid to them.
  assert.equal((db.read('users/u1')?.wallet as Doc).availableUsd, WELCOME_BONUS_USD)
  assert.equal((db.read('users/u1')?.wallet as Doc).pendingUsd, 0)
})

test('a second save after the reward is paid does not pay it twice', async () => {
  const db = new FakeFirestore()
  await saveMemberProfile('u1', COMPLETING_SAVE, { db: asDb(db) })
  const second = await saveMemberProfile('u1', { bio: 'Now with four years of experience.' }, { db: asDb(db) })

  assert.equal(second.grantedBonus, null)
  assert.equal(second.bonusAlreadyGranted, true)
  assert.equal(second.releasedReferral, null)
  assert.equal((db.read('users/u1')?.wallet as Doc).availableUsd, WELCOME_BONUS_USD)
})

test('a referrer who is no longer in good standing is not paid', async () => {
  const db = new FakeFirestore({
    ...REFERRAL_SEED,
    'users/ref-1': { uid: 'ref-1', accountState: 'suspended', kycVerified: true, wallet: { pendingUsd: 2 } },
  })
  const result = await saveMemberProfile('u1', COMPLETING_SAVE, { db: asDb(db) })

  assert.equal(result.releasedReferral, null)
  assert.equal((db.read('users/ref-1')?.wallet as Doc).pendingUsd, 2)
  assert.equal(db.read('wallet_ledger/referral_bonus_u1'), undefined)
})

// ─── The rule, for every other transaction in the codebase ───────────────────

test('no transaction in the codebase reads after it writes', () => {
  // The profile save was fixed by moving the read, but the rule it broke is a property of every
  // transaction in the repo, so it is checked everywhere. Direct `tx.get` calls are visible here;
  // the *indirect* violation (a helper called with the transaction that reads inside) is what the
  // fake-Firestore tests above catch, because only executing the code can see it.
  const roots = ['lib', 'app']
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (full.includes('/api/admin')) continue
        walk(full)
        continue
      }
      if (full.endsWith('.ts')) files.push(full)
    }
  }
  for (const root of roots) walk(join(process.cwd(), root))

  let transactions = 0
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/runTransaction\(\s*async\s*\((\w+)\)\s*=>\s*\{/g)) {
      const variable = match[1]
      const open = source.indexOf('{', match.index! + match[0].length - 1)
      let depth = 0
      let end = open
      for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++
        else if (source[i] === '}') {
          depth--
          if (depth === 0) {
            end = i
            break
          }
        }
      }
      const body = source.slice(open, end)
      const ops = [...body.matchAll(new RegExp(`${variable}\\.(get|set|update|delete)\\(`, 'g'))].map((m) => m[1])
      const firstWrite = ops.findIndex((op) => op !== 'get')
      transactions++
      if (firstWrite === -1) continue
      const laterRead = ops.findIndex((op, index) => op === 'get' && index > firstWrite)
      assert.equal(
        laterRead,
        -1,
        `${file}: a read is issued after a write inside a Firestore transaction (reads must all come first)`,
      )
    }
  }
  assert.ok(transactions >= 8, `expected to find the codebase's transactions, found ${transactions}`)
})
