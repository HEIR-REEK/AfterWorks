/**
 * Give every member profile the email address their sign-in already has.
 *
 * Why this exists
 * ---------------
 * A Google sign-up writes its profile from the member's own browser, and that write is one the
 * Firestore rules have to permit. The create rule accepts an unverified address without consulting
 * the token, but a Google account arrives with the address already proven, so the document is
 * written with `emailVerified: true` — and the rule then also requires the token to say so. When
 * that does not line up the write is refused, and nothing else fails: the member is signed in, the
 * terms acceptance goes through the Admin SDK regardless, and the account works. The only casualty
 * is the profile document, which never appears.
 *
 * What is left behind is a `users/{uid}` with no `email`, no `name`, no `role` and no `accountState`.
 * The console lists it with a blank email and an "Incomplete record" badge. It cannot be repaired
 * from a browser: the update rule reads `resource.data.email`, which does not exist on a stub, so a
 * client write is refused for the same reason the create was.
 *
 * This script repairs them from the one source the rules cannot refuse — Firebase Auth, which has
 * held the address the whole time. It fills in only what is missing and never moves an address.
 *
 * It is idempotent: a second run finds nothing to do.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a && npx tsx scripts/backfill-profile-emails.ts            # report only
 *   set -a && . ./.env.local && set +a && npx tsx scripts/backfill-profile-emails.ts --apply     # write
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { dbOrNull } from '../lib/firestore-admin'

/** Load `.env.local` without a dependency — same approach as the other scripts here. */
function loadEnvFile(): void {
  const file = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!match) continue
    const key = match[1]!
    if (process.env[key] !== undefined) continue
    process.env[key] = match[2]!.replace(/^["']|["']$/g, '')
  }
}

/** The inert defaults a brand-new account carries. Mirrors `createUserDocument`. */
const BLANK_PROFILE: Record<string, unknown> = {
  location: '',
  memberSince: '',
  qualityScore: 100,
  jobsCompleted: 0,
  kycVerified: false,
  accountState: 'active',
  role: 'user',
  isAdmin: false,
  phone: '',
  bio: '',
  skills: [],
  languages: [],
  preferredPayoutMethod: 'M-Pesa',
  paidTrainings: [],
  wallet: { pendingUsd: 0, availableUsd: 0, payoutNumber: '' },
}

async function main(): Promise<void> {
  loadEnvFile()
  const apply = process.argv.includes('--apply')
  const db = dbOrNull()
  if (!db) {
    console.error('Firebase Admin SDK is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or _PATH in .env.local.')
    process.exitCode = 1
    return
  }

  console.log(apply ? 'Mode: APPLY (writes)\n' : 'Mode: report only (pass --apply to write)\n')

  // Auth is the authority on the address, so read it first: a stub profile is exactly a document
  // Auth knows more about than Firestore does.
  let authUsers: Map<string, { email: string; emailVerified: boolean; displayName: string }>
  try {
    const { getAuth } = await import('firebase-admin/auth')
    const auth = getAuth()
    authUsers = new Map()
    let pageToken: string | undefined
    do {
      const page = await auth.listUsers(1000, pageToken)
      for (const rec of page.users) {
        authUsers.set(rec.uid, {
          email: (rec.email ?? '').trim().toLowerCase(),
          emailVerified: rec.emailVerified === true,
          displayName: (rec.displayName ?? '').trim(),
        })
      }
      pageToken = page.pageToken
    } while (pageToken)
  } catch (err) {
    console.error('Could not list Firebase Auth users. The service account needs the Auth read scope.')
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
    return
  }
  console.log(`Auth accounts: ${authUsers.size}`)

  const snap = await db.collection('users').get()
  const repairs: { uid: string; fields: string[] }[] = []
  let complete = 0

  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>
    const authRec = authUsers.get(doc.id)
    const patch: Record<string, unknown> = {}

    if (typeof data.email !== 'string' || data.email.trim() === '') {
      if (authRec?.email) patch.email = authRec.email
    }
    if (typeof data.name !== 'string' || data.name.trim() === '') {
      if (authRec?.displayName || authRec?.email) {
        patch.name = authRec.displayName || authRec!.email.split('@')[0]
      }
    }
    for (const [key, value] of Object.entries(BLANK_PROFILE)) {
      if (data[key] === undefined) patch[key] = value
    }
    if (authRec?.emailVerified && data.emailVerified !== true) {
      patch.emailVerified = true
      if (typeof data.emailVerifiedAt !== 'string') patch.emailVerifiedAt = new Date().toISOString()
    }

    if (Object.keys(patch).length === 0) {
      complete += 1
      continue
    }
    repairs.push({ uid: doc.id, fields: Object.keys(patch) })
  }

  // An Auth account with no profile document at all is a separate problem, but it is the one an
  // operator most wants to know about: that member has no profile to repair.
  const orphaned = [...authUsers.keys()].filter((uid) => !snap.docs.some((d) => d.id === uid))

  console.log(`Profiles read:        ${snap.size}`)
  console.log(`Already complete:     ${complete}`)
  console.log(`Needing repair:       ${repairs.length}`)
  console.log(`Auth with no profile: ${orphaned.length}\n`)

  if (repairs.length === 0 && orphaned.length === 0) {
    console.log('Nothing to do.')
    return
  }

  for (const repair of repairs.slice(0, 50)) {
    console.log(`  ${repair.uid}  \u2192 ${repair.fields.join(', ')}`)
  }
  if (repairs.length > 50) console.log(`  \u2026 and ${repairs.length - 50} more`)
  for (const uid of orphaned.slice(0, 20)) console.log(`  ${uid}  \u2192 Auth account with no profile document`)

  if (!apply) {
    console.log('\nReport only. Re-run with --apply to repair them.')
    return
  }

  let written = 0
  for (let i = 0; i < repairs.length; i += 400) {
    const batch = db.batch()
    for (const repair of repairs.slice(i, i + 400)) {
      const authRec = authUsers.get(repair.uid)
      const patch: Record<string, unknown> = {}
      if (repair.fields.includes('email') && authRec?.email) patch.email = authRec.email
      if (repair.fields.includes('name')) patch.name = authRec?.displayName || authRec?.email?.split('@')[0] || 'Worker'
      for (const key of repair.fields) {
        if (key in BLANK_PROFILE) patch[key] = BLANK_PROFILE[key]
      }
      if (repair.fields.includes('emailVerified')) {
        patch.emailVerified = true
        patch.emailVerifiedAt = new Date().toISOString()
      }
      patch.updatedAt = new Date().toISOString()
      batch.set(db.collection('users').doc(repair.uid), patch, { merge: true })
    }
    await batch.commit()
    written += Math.min(400, repairs.length - i)
  }
  console.log(`\nRepaired ${written} profile${written === 1 ? '' : 's'}.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
