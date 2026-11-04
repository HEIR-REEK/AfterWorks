/**
 * A Google sign-up must leave a profile the console can read an email from.
 *
 * The failure this pins
 * ---------------------
 * The profile is written by the member's own browser, so it is a write the Firestore rules must
 * permit. The create rule accepts an unverified address without consulting the token — which is why
 * email/password sign-up works — but a Google account arrives with its address already proven, so
 * the document is written with `emailVerified: true` and the rule then also requires the token to
 * agree. When it does not, the write is refused.
 *
 * Nothing else fails. The member is signed in, the terms acceptance and the referral claim both go
 * through the Admin SDK and ignore the rules, and the account works. The only casualty is the
 * profile document, which never appears: a `users/{uid}` with no `email`, no `name`, no `role` and
 * no `accountState`. The console lists it with a blank email.
 *
 * It cannot be repaired from a browser either — the update rule reads `resource.data.email`, which
 * does not exist on a stub, so a client backfill is refused for the same reason the create was.
 *
 * So the fix is in two parts, and both are asserted here: the console can always show the address
 * Auth holds, and a server write the rules cannot refuse fills the profile in.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}
/** Source with `//` comments removed, so an assertion about code is not answered by prose about it. */
function code(rel: string): string {
  return read(rel)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

test('the console shows the address Auth holds, even when the profile never got one', () => {
  // Auth has held the address the whole time; a blank cell was a projection choice, not a fact.
  const admin = read('lib/firestore-admin.ts')
  let attach = admin.slice(admin.indexOf('export async function attachAuthAccountState'))
  attach = attach.slice(0, attach.indexOf('\n}'))
  assert.match(attach, /rec\.email/, 'the Auth record is fetched with its email')
  assert.match(attach, /email: rec\.email/, 'and carried onto the row')

  // The type has to allow it, or the projection is lying.
  assert.match(read('lib/admin.ts'), /email\?: string/, 'AdminUserRow.auth declares the field')

  // And the console has to actually use it.
  const page = read('app/admin/users/page.tsx')
  assert.match(page, /row\.email \|\| row\.auth\?\.email/, 'the row falls back to it')
  assert.match(page, /selected\.email \|\| selected\.auth\?\.email/, 'so does the drawer')
  assert.match(page, /from sign-in, not saved to the profile/, 'and says which one it is showing')
})

test('a server route the rules cannot refuse repairs the profile', () => {
  const route = code('app/api/auth/bootstrap/route.ts')

  // The uid and the address come from the verified token, never the request body.
  assert.match(route, /requireUser\(req\)/)
  assert.match(route, /const \{ uid, email, emailVerified \} = guard\.value/)
  assert.doesNotMatch(route, /readJsonBody/, 'it takes nothing from the client')

  // It writes through the Admin SDK, which is the whole point.
  assert.match(route, /adminDb\(\)/, 'server-side write')
  assert.match(route, /ref\.set\(patch, \{ merge: true \}\)/)

  // Only what is missing. An existing email is the account's identity and must not move.
  assert.match(route, /if \(!currentEmail\) patch\.email = email/, 'a missing email is filled')
  assert.match(route, /if \(data\[key\] === undefined\) patch\[key\] = value/, 'a missing default is filled')
  assert.match(route, /alreadyComplete/, 'and a complete profile is left alone')

  // It may record a proven inbox, never invent one.
  assert.match(route, /if \(emailVerified && data\.emailVerified !== true\)/)
  assert.doesNotMatch(route, /patch\.emailVerified = true[^\n]*\n\s*patch\.emailVerifiedAt = new Date\(\)\.toISOString\(\)\s*\n\s*\}/, 'no unconditional verified write')

  // Rate limited, because it is reachable by any signed-in member.
  assert.match(route, /consumeBucket\('auth-bootstrap'/)
})

test('both sign-up paths call the bootstrap, Google first in spirit', () => {
  const provider = code('components/firebase-auth-provider.tsx')

  // The helper exists and is best-effort — a failure must not fail a successful sign-up.
  assert.match(provider, /async function bootstrapProfile/)
  assert.match(provider, /catch \(err\) \{\s*console\.warn/, 'it swallows its own failure')

  // Email/password.
  let signUp = provider.slice(provider.indexOf('async function signUp('))
  signUp = signUp.slice(0, signUp.indexOf('async function attachReferral('))
  assert.match(signUp, /createUserDocument\(cred\.user\.uid, name \|\| email\.split/, 'writes the profile')
  assert.match(signUp, /await bootstrapProfile\(cred\.user\)/, 'then guarantees it')

  // Google.
  let google = provider.slice(provider.indexOf('async function signInWithGoogle('))
  assert.match(google, /createUserDocument\(cred\.user\.uid, name, cred\.user\.email \|\| ''/, 'writes the profile')
  assert.match(google, /await bootstrapProfile\(cred\.user\)/, 'then guarantees it')

  // The Google write is the fragile one, so it must not be the last thing standing between a member
  // and a profile: the bootstrap has to come after it, not before.
  assert.ok(
    google.indexOf('await bootstrapProfile(cred.user)') > google.indexOf('createUserDocument(cred.user.uid'),
    'bootstrap runs after the client write it repairs',
  )
})

test('the asymmetry that caused it is stated in the rules, not just implied', () => {
  // The create rule is what refuses a Google profile. If someone "simplifies" the clause below, the
  // bug comes back, so the reason it is conditional is asserted rather than left to a comment.
  const rules = read('firestore.rules')
  let create = rules.slice(rules.indexOf('allow create: if isSelf(userId)'))
  create = create.slice(0, create.indexOf('allow update:'))
  assert.match(create, /emailVerified', false\) == false\s*\n\s*\|\| request\.auth\.token\.email_verified == true/, 'the create rule consults the token only when claiming a proven inbox')
  assert.match(create, /request\.resource\.data\.email\.lower\(\) == request\.auth\.token\.email\.lower\(\)/, 'and ties the address to the token')

  // The update rule reads `resource.data.email`, which is why a stub cannot be fixed from a browser.
  let update = rules.slice(rules.indexOf('allow update: if isSelf(userId)'))
  update = update.slice(0, update.indexOf('allow delete:'))
  assert.match(update, /resource\.data\.email\.lower\(\)/, 'the update rule reads the stored address')
})

test('existing stubs can be repaired in bulk, and the script reports before it writes', () => {
  const script = read('scripts/backfill-profile-emails.ts')
  assert.match(script, /--apply/, 'writes only when asked')
  assert.match(script, /report only/, 'and says so otherwise')
  assert.match(script, /auth\.listUsers/, 'reads the address from Auth')
  assert.match(script, /Auth with no profile/, 'and flags accounts with no profile at all')
  assert.match(script, /data\.email\.trim\(\) === ''/, 'a blank email counts as missing')
})
