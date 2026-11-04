import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

test('console authority never falls back to a mutable users.isAdmin label', () => {
  const auth = read('app/api/admin/auth/route.ts')
  const guards = read('lib/guards.ts')
  assert.doesNotMatch(auth, /checkUserAdminRoleAdmin/)
  assert.doesNotMatch(guards, /checkUserAdminRoleAdmin/)
  assert.match(auth, /No `users\.isAdmin` fallback/)
  assert.match(guards, /ALLOW_ADMIN_BEARER_AUTH/)
})

test('the KYC answer key is server-only and a pass is server-written', () => {
  const catalogue = read('lib/job-catalogue.ts')
  const quiz = read('components/assessment-quiz.tsx')
  const route = read('app/api/assessments/route.ts')
  const admin = read('lib/firestore-admin.ts')
  assert.match(catalogue, /assessmentQuestions: \[\]/)
  assert.doesNotMatch(quiz, /generateQuestions/)
  assert.match(quiz, /\/api\/assessments/)
  assert.doesNotMatch(quiz, /\/api\/assessments\/score/)
  assert.match(route, /publicAssessmentQuestions/)
  assert.match(route, /recordAssessmentPass/)
  assert.match(admin, /assessmentPasses:/)
  assert.match(admin, /Pass the assessment/)
})

test('assessment entitlement and answer keys are not client-writable', () => {
  const rules = read('firestore.rules')
  assert.match(rules, /'paidTrainings', 'assessmentPasses'/)
  assert.match(rules, /request\.resource\.data\.get\('assessmentPasses', \[\]\)\.size\(\) == 0/)
  assert.doesNotMatch(rules, /function isStaff\(\)/)
})

test('completion pays through one transaction and a deterministic ledger create', () => {
  const source = read('lib/firestore-admin.ts')
  const start = source.indexOf('export async function transitionApplicationAdmin')
  const block = source.slice(start, start + 9000)
  assert.match(block, /db\.runTransaction/)
  assert.match(block, /tx\.create\(ledgerRef/)
  assert.match(block, /You cannot approve and pay your own application/)
})

test('identity verification cannot be self-granted, and has no demo approval path', () => {
  const rules = read('firestore.rules')
  const requestRoute = read('app/api/kyc/request/route.ts')
  const admin = read('lib/firestore-admin.ts')

  // There is no provider and no webhook, so the only way `kycVerified` becomes true is a person in
  // the admin console. That has to be structurally true, not a convention: the member-facing route
  // must not be able to write the field, and the rules must refuse a browser that tries.
  assert.match(rules, /'kycVerified'/, 'kycVerified must stay on the privileged list')
  assert.match(rules, /'kycRequestedAt'/, 'the review timestamp is server-written too')
  // The route may echo `kycVerified` back to the client as state, but the only server function it
  // can reach is the one that stamps a request — it has no import through which it could write a
  // verdict, and the rules would refuse it anyway.
  assert.match(
    requestRoute,
    /import \{ requestKycReview, getUserProfile \} from '@\/lib\/firestore-admin'/,
    'the member route reaches exactly two server helpers, neither of which can verify anyone',
  )

  // The one writer, and it is server-side only.
  assert.match(admin, /export async function verifyKycAdmin/)
  assert.doesNotMatch(admin, /demo_/, 'no demo identity may be approved')
})

test('password reset hides whether an address has an account', () => {
  const reset = read('lib/password-reset.ts')
  assert.doesNotMatch(reset, /code: 'cooldown'/)
  assert.match(reset, /outbound reset mail failed/)
  assert.match(reset, /code: 'invalid_code'/)
})

test('outbound email has a hard timeout and a process-wide cap', () => {
  const email = read('lib/email.ts')
  assert.match(email, /AbortSignal\.timeout/)
  assert.match(email, /EMAIL_MAX_CONCURRENT/)
  assert.match(email, /EMAIL_MAX_PER_MINUTE/)
})

test('production host checking fails closed and CSP no longer allows arbitrary HTTPS connects', () => {
  const middleware = read('middleware.ts')
  const core = read('lib/security-core.ts')
  assert.match(middleware, /ALLOWED_HOSTS\.size === 0\) return !PRODUCTION/)
  assert.match(core, /if \(allowList\.length === 0\) return !production/)
  // An arbitrary *.e2b.app Host is not trusted just because it is production; the preview must
  // either be the configured origin or opt in explicitly.
  assert.match(core, /PREVIEW_HOST\.test\(host\)\) return !production \|\| envBool\('ALLOW_E2B_PREVIEW_HOSTS'\)/)
  assert.match(middleware, /PREVIEW_HOST\.test\(value\)\) return !PRODUCTION \|\| ALLOW_E2B_PREVIEW_HOSTS/)
  assert.doesNotMatch(middleware, /connect-src 'self' https:/)
})

test('the realtime Firestore channel is not blocked out of its WebSocket transport', () => {
  const middleware = read('middleware.ts')
  // connect-src lists the Firestore hosts under `https:` only. A WebSocket URL is matched
  // scheme-by-scheme, so `wss://firestore.googleapis.com/...Listen/channel?...&TYPE=websocket`
  // was refused and the SDK silently fell back to XHR long-polling (`TYPE=xmlhttp`).
  assert.match(middleware, /FIREBASE_WSS_HOSTS = 'wss:\/\/\*\.googleapis\.com'/)
  assert.match(middleware, /connect-src[^`]*\$\{FIREBASE_WSS_HOSTS\}/)
  // Still not a blanket scheme allowance: the https/wss wildcards are host-scoped.
  assert.doesNotMatch(middleware, /connect-src[^`]*' wss: /)
})

test('job slot counters move inside the application transaction', () => {
  const source = read('lib/firestore-admin.ts')
  const start = source.indexOf('export async function transitionApplicationAdmin')
  const block = source.slice(start, start + 12_000)
  assert.match(block, /One transaction for the application state/)
  assert.match(block, /This job has no slots remaining/)
  assert.match(block, /slotsRemaining: FieldValue\.increment\(-1\)/)
  assert.match(block, /slotsRemaining: FieldValue\.increment\(1\)/)
  // The old code wrote the slot after the status write. Both writes must now be in a transaction.
  assert.doesNotMatch(block, /await db\.collection\('jobs'\)\.doc\(jobId\)\.set/)
})

test('the maintenance bypass re-resolves the operator and audits every mint', () => {
  const bypass = read('app/api/maintenance/bypass/route.ts')
  assert.match(bypass, /resolveAdminRole\(guard\.value\.email\)/)
  assert.match(bypass, /MAINTENANCE_BYPASS_GRANTED/)
  assert.doesNotMatch(bypass, /guard\.value\.isAdmin/)
})

test('raw wallet edits require the owner passcode again', () => {
  const users = read('app/api/admin/users/route.ts')
  const ui = read('app/admin/users/page.tsx')
  assert.match(users, /confirmPasscode/)
  assert.match(users, /reauth_required/)
  assert.match(users, /admin-wallet-confirm/)
  assert.match(ui, /adj-passcode/)
  assert.match(users, /grant a welcome reward/)
  assert.match(ui, /bonus-passcode/)
})

test('profile identity fields cannot be forged by a direct browser write', () => {
  const rules = read('firestore.rules')
  assert.match(rules, /'phone', 'phoneCountry'/)
  assert.match(rules, /request\.resource\.data\.email\.lower\(\) == request\.auth\.token\.email\.lower\(\)/)
  assert.match(rules, /changesOnlyEmail\(\)/)
})

test('staff can list jobs but never receive the authored assessment key', () => {
  const jobs = read('app/api/admin/jobs/route.ts')
  assert.match(jobs, /const guard = await requireAdmin\(req\)/)
  assert.match(jobs, /assessmentQuestions: \[\]/)
  assert.match(jobs, /Only the main administrator can close a job card/)
})

test('payout audit records the state the request actually moved from', () => {
  const wallet = read('lib/wallet-server.ts')
  const route = read('app/api/admin/payouts/route.ts')
  assert.match(wallet, /fromStatus/)
  assert.match(route, /from: result\.fromStatus/)
  assert.match(route, /Only the main administrator can mark a payout as paid/)
})

test('a verification request is rate limited and cannot pin a worker', () => {
  const route = read('app/api/kyc/request/route.ts')
  // The provider round trips this route used to make are gone, but the write is still a remote
  // call, and a member tapping the button repeatedly is still a flood. Both guards stay.
  assert.match(route, /rateLimit\(req, 'kyc-request'/, 'a burst of requests must be shed at the edge')
  assert.match(route, /consumeBucket\('kyc-request-write'/, 'the write itself needs its own per-member budget')
  assert.match(route, /getUserProfile/, 'an already-verified member is told so instead of queueing a no-op review')
})
