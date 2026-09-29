import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

/**
 * The verification page is where a member decides whether the inbox in front of them is the one
 * the platform just confirmed. These tests pin the two rules that keep it honest:
 *
 *  1. The address the page names is the address in the *link*, never the address of whatever
 *     account happens to be signed in in that browser. Getting this wrong is how somebody ends up
 *     told "your email is verified" while looking at a different person's account.
 *  2. Verification state is read from Auth at the moment of the decision, not from the snapshot
 *     that came back with the sign-in credential — that stale snapshot is what pushed Google
 *     sign-ups onto the verification screen for an inbox Google had already proven.
 *
 * These are assertions about source because the behaviour is React state over a network response
 * and a DOM; a rendered test here would cost a browser for every rule.
 */

const PAGE = 'app/verify-email/page.tsx'
const PROVIDER = 'components/firebase-auth-provider.tsx'
const ROUTE = 'app/api/auth/verify-email/route.ts'

test('the verification page names the address in the link, not the signed-in session', async () => {
  const source = await readFile(PAGE, 'utf8')

  // The address shown must come from the server's answer about the token…
  assert.match(source, /setVerifiedEmail\(result\.email \?\? null\)/, 'the page ignores the verified address')
  assert.match(source, /<strong>\{subjectEmail \|\| 'That address'\}<\/strong>/, 'the success copy does not name the address')

  // …and must not be the session's address while a link is in play.
  assert.doesNotMatch(
    source,
    /const email = user\?\.email \|\| ''/,
    'the page still renders the signed-in address as *the* verified one',
  )
  assert.match(
    source,
    /const subjectEmail = verifiedEmail \?\? \(token \? null : signedInEmail \|\| null\)/,
    'the subject address is not "the link, else the session"',
  )
})

test('a signed-in account other than the one verified is called out, not navigated into', async () => {
  const source = await readFile(PAGE, 'utf8')

  assert.match(source, /const crossedAccounts = verified && !accountsMatch && Boolean\(signedInEmail\)/)
  assert.match(source, /You are signed in here as <strong>\{signedInEmail/)
  // The dangerous affordance — "Continue to profile" — must be unreachable in that state, or the
  // member lands in the *other* account's dashboard believing this verification was that one's.
  assert.match(source, /user && sameAccount \? \(\s*<Button size="lg" className="w-full" onClick=\{\(\) => router\.push\('\/profile\?new=1'\)\}>/)

  // "Continue to profile" is only offered when the session *is* the verified account, and an
  // unreadable session must never be rounded up to "same person".
  assert.match(source, /const accountsMatch = sessionMatches \?\? subjectEmail === signedInEmail/)
  assert.doesNotMatch(source, /if \(user\)\s*\{\s*<Button size="lg" className="w-full" onClick=\{\(\) => router\.push\('\/profile/)
})

test('the consume response reports the verified address and whether the session matches', async () => {
  const source = await readFile(ROUTE, 'utf8')
  assert.match(source, /sessionMatches: session \? session\.uid === result\.uid : null/)
  assert.match(source, /signedInEmail: session && session\.uid !== result\.uid \? session\.email : null/)
  // The session is read *after* the consume, and it can never gate it: the link is the credential.
  assert.match(source, /const result = await consumeVerificationToken\(token\)/)
  assert.match(source, /const session = await signedInIdentity\(req\)/)
  assert.doesNotMatch(source, /if \(!session\) return fail\(401/)
})

test('a profile document records the verification state that is actually true', async () => {
  const firestore = await readFile('lib/firestore.ts', 'utf8')
  assert.doesNotMatch(
    firestore,
    /emailVerified: false,\n\s*accountState/,
    'createUserDocument still hard-codes "not verified" for every new profile',
  )
  assert.match(firestore, /const emailVerified = opts\.emailVerified === true/)

  const provider = await readFile(PROVIDER, 'utf8')
  assert.match(
    provider,
    /createUserDocument\(cred\.user\.uid, name, cred\.user\.email \|\| '', \{[\s\S]*?emailVerified: googleVerified[\s\S]*?\}\)/,
  )
})

test('"is this inbox verified" is asked of Auth, not of the credential snapshot', async () => {
  const source = await readFile(PROVIDER, 'utf8')
  assert.match(source, /async function isEmailVerifiedNow\(u: User\)/)
  assert.match(source, /getIdTokenResult\(true\)/, 'the token is not force-refreshed before the decision')
  assert.match(source, /result\.claims\?\.email_verified/, 'the email_verified claim is not the source of truth')

  // Neither sign-in nor Google sign-up may branch on the stale field alone.
  assert.doesNotMatch(source, /if \(!cred\.user\.emailVerified\)/)
  assert.doesNotMatch(source, /if \(!cred\.user\.emailVerified\) return \{ ok: true, needsEmailVerification: true \}/)
})
