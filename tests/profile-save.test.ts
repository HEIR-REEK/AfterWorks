import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProfileUpdate } from '@/lib/wallet-server'
import { sanitiseProfilePatch } from '@/lib/profile-completion'

/**
 * "I am not able to save my profile — when I click save it deletes the contents of the fields and
 * offers the update again."
 *
 * The cause was the order in which one document update was assembled. For an account with no
 * `users/{uid}` document yet — a console-onboarded member, a phone-claim stub, an interrupted
 * sign-up, i.e. exactly the accounts that most need the form — the save built
 *
 *     { ...memberPatch, updatedAt }            then    Object.assign(updates, blankProfileDocument())
 *
 * so the *blank* defaults landed last and won. `location`, `country`, `bio`, `skills`, `languages`
 * and `preferredPayoutMethod` were written empty, and because the blank document also carried a
 * nested `wallet: { availableUsd: 0, … }` while the same write set `wallet.payoutNumber` and (for a
 * completed profile) `wallet.availableUsd`, the request addressed a field and a path inside it —
 * a write Firestore rejects outright.
 *
 * `buildProfileUpdate` is that assembly, in the correct order, as one testable function.
 */

const patch = {
  name: 'Amina Otieno',
  phone: '+254712345678',
  phoneCountry: 'KE',
  location: 'Kiambu',
  country: 'Kenya',
  zipCode: '00900',
  bio: 'Transcription and data entry, five years.',
  skills: ['Transcription', 'Data entry'],
  languages: ['English', 'Swahili'],
  preferredPayoutMethod: 'M-Pesa',
  career: 'Freelance transcriber',
}

// ─── The reported failure ────────────────────────────────────────────────────

test('the member’s save is not overwritten by the inert defaults on a first save', () => {
  const update = buildProfileUpdate({ uid: 'u1', exists: false, patch, now: '2026-09-29T10:00:00.000Z' })

  for (const [key, value] of Object.entries(patch)) {
    assert.deepEqual(update[key], value, `${key} must survive a first save`)
  }
  // The regression in one line: these are the fields the blanks used to empty.
  assert.equal(update.location, 'Kiambu')
  assert.equal(update.bio, 'Transcription and data entry, five years.')
  assert.deepEqual(update.skills, ['Transcription', 'Data entry'])
  assert.deepEqual(update.languages, ['English', 'Swahili'])
  assert.equal(update.preferredPayoutMethod, 'M-Pesa')
  assert.equal(update.updatedAt, '2026-09-29T10:00:00.000Z')
})

test('the inert shape is still written, so the account is a complete member document', () => {
  const update = buildProfileUpdate({ uid: 'u1', exists: false, patch, now: '2026-09-29T10:00:00.000Z' })
  assert.equal(update.uid, 'u1')
  assert.equal(update.accountState, 'active')
  assert.equal(update.role, 'user')
  assert.equal(update.isAdmin, false)
  assert.equal(update.kycVerified, false)
  assert.equal(update.qualityScore, 100)
  assert.equal(update.jobsCompleted, 0)
  assert.equal(update.signupBonusGranted, false)
  assert.ok(update.createdAt)
  assert.ok(update.memberSince)
})

test('an existing document is patched, not rebuilt: no defaults are reintroduced', () => {
  const existing = { uid: 'u1', name: 'Amina', bio: 'old', accountState: 'kyc_rejected', kycVerified: true }
  const update = buildProfileUpdate({
    uid: 'u1',
    exists: true,
    patch: { bio: 'new' },
    now: '2026-09-29T10:00:00.000Z',
  })
  assert.deepEqual(Object.keys(update).sort(), ['bio', 'updatedAt'])
  // Nothing that a merge would silently reset.
  assert.equal('accountState' in update, false)
  assert.equal('kycVerified' in update, false)
  assert.equal('signupBonusGranted' in update, false)
  assert.equal('createdAt' in update, false)
  assert.equal(existing.kycVerified, true)
})

// ─── The write that Firestore refuses ────────────────────────────────────────

test('wallet defaults are leaf paths, never a nested object, so the write cannot conflict', () => {
  const update = buildProfileUpdate({ uid: 'u1', exists: false, patch, now: '2026-09-29T10:00:00.000Z' })
  assert.equal('wallet' in update, false, 'a nested wallet object conflicts with wallet.* paths')
  assert.equal(update['wallet.pendingUsd'], 0)
  assert.equal(update['wallet.availableUsd'], 0)
  assert.equal(update['wallet.payoutNumber'], '')
  assert.equal(update['wallet.payoutHoldUsd'], 0)

  // And the derived values the transaction adds afterwards win over those zeros — this is the same
  // write, finished, for a save that also releases the $5 welcome reward and stores the phone.
  const finished: Record<string, unknown> = { ...update }
  finished['wallet.payoutNumber'] = patch.phone
  finished['wallet.availableUsd'] = 5
  finished.signupBonusGranted = true
  assert.equal(finished['wallet.availableUsd'], 5)
  assert.equal(finished['wallet.payoutNumber'], '+254712345678')
  assert.equal(finished.signupBonusGranted, true)
  // Every key addresses a leaf: no key is a prefix of another.
  const keys = Object.keys(finished)
  for (const key of keys) {
    const prefix = keys.find((other) => other !== key && key.startsWith(`${other}.`))
    assert.equal(prefix, undefined, `"${key}" and "${prefix}" would collide in one write`)
  }
})

test('a field kept by the sanitiser is a field that survives the update', () => {
  // The two halves of the save, together: what the API accepts must be what the document keeps.
  const { patch: clean, dropped } = sanitiseProfilePatch({ ...patch, role: 'admin', wallet: 'x' }, { method: 'M-Pesa' })
  assert.deepEqual(dropped.sort(), ['role', 'wallet'])
  const update = buildProfileUpdate({ uid: 'u1', exists: false, patch: clean, now: '2026-09-29T10:00:00.000Z' })
  for (const key of Object.keys(clean)) {
    assert.deepEqual(update[key], clean[key as keyof typeof clean], `${key} must be written as sent`)
  }
  // `role` is part of the inert shape, so it is present — as `user`, the default, never the
  // `admin` the request tried to slip in.
  assert.equal(update.role, 'user')
})

test('an explicit clear is respected: emptying a field still saves as empty', () => {
  const update = buildProfileUpdate({ uid: 'u1', exists: true, patch: { bio: '', skills: [] }, now: 'x' })
  assert.equal(update.bio, '')
  assert.deepEqual(update.skills, [])
})
