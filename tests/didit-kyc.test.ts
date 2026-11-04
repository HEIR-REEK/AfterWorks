import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Didit integration contract.
 *
 * These tests exist because three separate v2-era assumptions survived into a v3 integration and
 * none of them failed loudly:
 *
 *  1. `X-Signature-V2` is an HMAC over a *canonical* re-encoding of the JSON body (keys sorted,
 *     whole-valued floats shortened), not over the bytes Didit sent. Hashing the raw body only
 *     agreed when the payload happened to arrive in canonical order, so a decision containing a
 *     score like `96.0` was rejected as a forgery and the approval never landed.
 *  2. v3 returns per-feature results as *plural arrays* (`id_verifications[]`, `face_matches[]`)
 *     either at the root of a decision GET or under `decision` in a webhook. The v2
 *     `verification_checks` object no longer exists, so declines arrived with no reason at all.
 *  3. v3 renamed statuses: `Resubmitted`, `Not Finished`, `Awaiting User`, `Not Started`. Anything
 *     unrecognised normalises to "Pending", which left resubmission-required members watching a
 *     spinner forever.
 */

const SECRET = 'didit-webhook-secret-for-tests'
process.env.DIDIT_WEBHOOK_SECRET = SECRET
process.env.DIDIT_API_KEY = 'test-api-key'
process.env.DIDIT_WORKFLOW_ID = 'wf_123'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

type DiditModule = typeof import('../lib/didit')

let loaded: DiditModule | null = null
/** `lib/didit` reads its credentials at import time, so the environment is set before it loads. */
async function didit(): Promise<DiditModule> {
  if (!loaded) loaded = await import('../lib/didit')
  return loaded
}

/** An independent implementation of Didit's canonical form, so the test pins the contract. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortDeep((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}

function signCanonical(payload: unknown): string {
  return createHmac('sha256', SECRET).update(JSON.stringify(sortDeep(payload)), 'utf8').digest('hex')
}

function signRaw(body: string): string {
  return createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

// A realistic V2 delivery: keys are not in alphabetical order and the decision carries a
// whole-valued float, which is exactly the shape that used to fail.
const RAW_BODY = JSON.stringify({
  event_id: 'evt_1',
  status: 'Approved',
  session_id: 'ses_1',
  vendor_data: 'uid-1',
  decision: { score: 96.0, liveness_checks: [{ status: 'Approved', node_id: 'liveness_1' }] },
})

test('a V2 webhook signed over canonical JSON verifies', async () => {
  const { verifyWebhookSignature } = await didit()
  const signature = signCanonical(JSON.parse(RAW_BODY))

  assert.notEqual(signature, signRaw(RAW_BODY), 'fixture must exercise the canonical/raw difference')
  assert.equal(
    verifyWebhookSignature(RAW_BODY, signature, { timestamp: String(nowSeconds()), requireTimestamp: true }),
    true,
  )
})

test('a signature computed over the wire bytes still matches (deprecated X-Signature)', async () => {
  const { verifyWebhookSignature } = await didit()
  assert.equal(verifyWebhookSignature(RAW_BODY, signRaw(RAW_BODY)), true)
})

test('a tampered body, a stale timestamp and a missing timestamp are all refused', async () => {
  const { verifyWebhookSignature, WEBHOOK_TOLERANCE_SECONDS } = await didit()
  const signature = signCanonical(JSON.parse(RAW_BODY))
  const fresh = String(nowSeconds())

  assert.equal(verifyWebhookSignature(RAW_BODY, signature, { timestamp: fresh, requireTimestamp: true }), true)

  const tampered = RAW_BODY.replace('Approved', 'Declined')
  assert.equal(verifyWebhookSignature(tampered, signature, { timestamp: fresh, requireTimestamp: true }), false)

  const stale = String(nowSeconds() - WEBHOOK_TOLERANCE_SECONDS - 60)
  assert.equal(verifyWebhookSignature(RAW_BODY, signature, { timestamp: stale, requireTimestamp: true }), false)

  // Dropping X-Timestamp must not be a way to skip the replay window.
  assert.equal(verifyWebhookSignature(RAW_BODY, signature, { requireTimestamp: true }), false)
  assert.equal(verifyWebhookSignature(RAW_BODY, null, { timestamp: fresh }), false)
})

test('every v3 status string maps to a state the app acts on', async () => {
  const { normaliseStatus } = await didit()
  assert.equal(normaliseStatus('Not Started'), 'Pending')
  assert.equal(normaliseStatus('In Progress'), 'InProgress')
  assert.equal(normaliseStatus('Awaiting User'), 'InProgress')
  assert.equal(normaliseStatus('In Review'), 'OnHold')
  assert.equal(normaliseStatus('Approved'), 'Approved')
  assert.equal(normaliseStatus('Declined'), 'Declined')
  assert.equal(normaliseStatus('Resubmitted'), 'Resubmission')
  assert.equal(normaliseStatus('Not Finished'), 'Abandoned')
  assert.equal(normaliseStatus('Abandoned'), 'Abandoned')
  assert.equal(normaliseStatus('Expired'), 'Expired')
})

const DECLINED_DECISION = {
  session_id: 'ses_1',
  status: 'Declined',
  vendor_data: 'uid-1',
  id_verifications: [
    {
      node_id: 'feature_ocr_1',
      status: 'Declined',
      warnings: [{ risk: 'DOCUMENT_EXPIRED', short_description: 'The document expired on 3 March 2024' }],
    },
  ],
  liveness_checks: [{ node_id: 'liveness_1', status: 'Approved', score: 96.0, warnings: [] }],
  face_matches: [{ node_id: 'face_match_1', status: 'Declined', score: 41.0, warnings: [{ risk: 'FACE_MATCH_FAILED' }] }],
}

test('failed checks are read from the v3 plural arrays, with readable detail', async () => {
  const { extractFailedChecks, extractRejectionReason } = await didit()

  const checks = extractFailedChecks(DECLINED_DECISION)
  assert.ok(checks, 'a declined decision must report the checks that failed')
  assert.equal(checks.length, 2, 'only the failing nodes are reported')
  assert.match(checks[0]!, /^ID document: declined/)
  assert.match(checks[0]!, /expired on 3 March 2024/)
  assert.match(checks[1]!, /Face match: declined/)
  assert.match(checks[1]!, /face match failed/)

  // An explicit reason outranks a warning.
  assert.equal(
    extractRejectionReason({ ...DECLINED_DECISION, reason: 'Document could not be read' }),
    'Document could not be read',
  )
  // With none given, the first warning becomes the reason.
  assert.equal(extractRejectionReason(DECLINED_DECISION), 'The document expired on 3 March 2024')
})

test('a webhook envelope (arrays nested under `decision`) parses the same way', async () => {
  const { extractFailedChecks, extractRejectionReason } = await didit()
  const envelope = {
    event_id: 'evt_1',
    session_id: 'ses_1',
    vendor_data: 'uid-1',
    status: 'Declined',
    decision: DECLINED_DECISION,
  }
  const checks = extractFailedChecks(envelope)
  assert.ok(checks && checks.length === 2)
  assert.equal(extractRejectionReason(envelope), 'The document expired on 3 March 2024')
})

test('an approved decision reports no failures', async () => {
  const { extractFailedChecks, extractRejectionReason } = await didit()
  const approved = {
    status: 'Approved',
    vendor_data: 'uid-1',
    id_verifications: [{ node_id: 'feature_ocr_1', status: 'Approved', warnings: [] }],
    liveness_checks: [{ node_id: 'liveness_1', status: 'Approved', score: 99.0, warnings: [] }],
  }
  assert.equal(extractFailedChecks(approved), undefined)
  assert.equal(extractRejectionReason(approved), undefined)
})

test('a decision without vendor_data falls back to the session record for ownership', async () => {
  const { getKycSessionStatus } = await didit()
  const calls: string[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const body = url.endsWith('/decision/')
      ? { session_id: 'ses_1', status: 'Approved', id_verifications: [{ status: 'Approved', warnings: [] }] }
      : { session_id: 'ses_1', status: 'Approved', vendor_data: 'uid-1' }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  try {
    const result = await getKycSessionStatus('ses_1')
    assert.equal(result.status, 'Approved')
    assert.equal(result.vendor_data, 'uid-1', 'ownership must come from the session record when the decision omits it')
    assert.equal(calls.length, 2, 'the session endpoint is read once for the owner field')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the callback is sent to the device that finished the flow, not to both', () => {
  const source = read('lib/didit.ts')
  assert.doesNotMatch(source, /callback_method: 'both'/, 'both devices were redirected, killing the desktop poll')
  assert.match(source, /callback_method: isMobile \? 'initiator' : 'completer'/)
})

test('the webhook verifies the V2 signature with its timestamp and does not stall on a status read', () => {
  const webhook = read('app/api/kyc/webhook/route.ts')
  assert.match(webhook, /req\.headers\.get\('x-signature-v2'\)/)
  assert.match(webhook, /req\.headers\.get\('x-timestamp'\)/)
  assert.match(webhook, /requireTimestamp: Boolean\(signatureV2\)/)
  assert.match(webhook, /timeoutMs: 2_500/, 'a slow status read must not blow the 5s delivery budget')
  assert.match(webhook, /extractFailedChecks|live\?\.failed_checks/)
  assert.doesNotMatch(webhook, /verification_checks/, 'the v2 check shape no longer exists')

  const status = read('app/api/kyc/status/route.ts')
  assert.doesNotMatch(status, /awaitingWebhook/, 'the flag was unreachable')
})

test('the API base URL is the verification host, never the registration host', () => {
  const env = read('.env.example')
  assert.doesNotMatch(env, /^DIDIT_API_URL="https:\/\/apx\.didit\.me"/m, 'apx does not serve /v3/* — sessions would 404')
  assert.match(read('lib/didit.ts'), /https:\/\/verification\.didit\.me/)
})

test('the connection test reads the workflow list and matches the configured workflow', async () => {
  const { probeDidit } = await didit()
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        count: 2,
        results: [
          { workflow_id: 'wf_other', workflow_label: 'Other KYC', status: 'published', version: 1 },
          { workflow_id: 'wf_123', workflow_label: 'Standard KYC', status: 'published', version: 2 },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch

  try {
    const result = await probeDidit()
    assert.equal(result.reachable, true)
    assert.equal(result.status, 200)
    assert.equal(result.workflows.length, 2)
    assert.equal(result.workflowFound, true, 'the configured workflow id must be matched against the provider list')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a key the provider refuses is reported as such, not as an outage', async () => {
  const { probeDidit } = await didit()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: 'You do not have permission to perform this action.' }), { status: 403 })) as typeof fetch
  try {
    const result = await probeDidit()
    assert.equal(result.reachable, true, '403 means the host answered')
    assert.equal(result.status, 403)
    assert.match(result.detail, /refused the key/i)
    assert.equal(result.workflowFound, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a workflow missing from the key is called out with the ids that do exist', async () => {
  const { probeDidit } = await didit()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ results: [{ workflow_id: 'wf_other', workflow_label: 'Other KYC', status: 'published' }] }), {
      status: 200,
    })) as typeof fetch
  try {
    const result = await probeDidit()
    assert.equal(result.workflowFound, false)
    assert.match(result.detail, /not one of the 1 workflow/i)
    assert.match(result.hint ?? '', /DIDIT_WORKFLOW_ID/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

/**
 * The id being *in the list* is not the same as the id being *usable*. Each row is one version of a
 * workflow group and new sessions always use the latest published version, so a workflow that only
 * exists as a draft (or whose rows are archived) is listed by GET /v3/workflows/ and still refuses
 * every member's POST /v3/session/. That is the "admin says ready, every member fails" shape, so
 * the probe must separate "found" from "usable".
 */
test('a workflow that only exists as a draft is not reported as usable', async () => {
  const { probeDidit } = await didit()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        count: 1,
        next: null,
        results: [{ workflow_id: 'wf_123', workflow_label: 'Standard KYC', status: 'draft', version: 3 }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch

  try {
    const result = await probeDidit()
    assert.equal(result.workflowFound, true, 'the id does appear in the provider list')
    assert.equal(result.workflowUsable, false, 'but a draft cannot serve a session')
    assert.match(result.detail, /no published, non-archived version/i)
    assert.match(result.hint ?? '', /publish the workflow/i, 'the operator must be told to publish it')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('an archived workflow is not reported as usable', async () => {
  const { probeDidit } = await didit()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [
          { workflow_id: 'wf_123', workflow_label: 'Old KYC', status: 'published', is_archived: true },
          { workflow_id: 'wf_123', workflow_label: 'Old KYC', status: 'published', is_archived: false, version: 4 },
        ],
      }),
      { status: 200 },
    )) as typeof fetch

  try {
    const result = await probeDidit()
    assert.equal(result.workflowFound, true)
    assert.equal(
      result.workflowUsable,
      true,
      'one live published version is enough — the archived row must not condemn a usable workflow',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a workflow the page did not show is not called missing', async () => {
  const { probeDidit } = await didit()
  const originalFetch = globalThis.fetch
  // The list paginates at 50 rows, so the configured id can simply be on the next page.
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        count: 74,
        next: 'https://verification.didit.me/v3/workflows/?offset=50',
        results: [{ workflow_id: 'wf_other', workflow_label: 'Other KYC', status: 'published' }],
      }),
      { status: 200 },
    )) as typeof fetch

  try {
    const result = await probeDidit()
    assert.equal(result.workflowFound, false)
    assert.equal(result.morePages, true)
    assert.match(result.detail, /shown on this page/i)
    assert.match(result.hint ?? '', /later page/i, 'a missing id must not be blamed when the list is truncated')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the credit balance is read, and an empty one is explained in current pricing terms', async () => {
  const { probeDiditBilling } = await didit()
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ balance: '0.0000', auto_refill_enabled: false }), { status: 200 })) as typeof fetch
    const empty = await probeDiditBilling()
    assert.equal(empty.ok, true)
    assert.equal(empty.balance, 0)
    assert.match(empty.hint ?? '', /\$10 a month/i, 'the Free plan is $10 of credit a month, not 500 checks')
    assert.match(empty.hint ?? '', /work email/i)

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ balance: '42.5000', auto_refill_enabled: true }), { status: 200 })) as typeof fetch
    const funded = await probeDiditBilling()
    assert.equal(funded.balance, 42.5)
    assert.equal(funded.autoRefill, true)
    assert.match(funded.detail, /128 checks/i, 'the balance must be translated into checks at $0.33 each')
    assert.equal(funded.hint, null, 'a funded account needs no billing hint')

    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: 'nope' }), { status: 403 })) as typeof fetch
    const refused = await probeDiditBilling()
    assert.equal(refused.ok, false)
    assert.equal(refused.status, 403)
    assert.equal(refused.balance, null, 'an unreadable balance must not be shown as $0')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the diagnose route gates "ready to verify" on a usable workflow and reads the balance', () => {
  const diagnose = read('app/api/admin/kyc/diagnose/route.ts')
  assert.match(diagnose, /probe\.workflowUsable/, 'a draft workflow id lists fine and refuses every session')
  assert.match(diagnose, /probeDiditBilling/, 'the credit balance is the one thing a refused session cannot say')
  assert.match(diagnose, /billing/, 'the balance must reach the operator')

  const security = read('app/admin/security/page.tsx')
  assert.match(security, /kyc\.billing/, 'the operator must see the balance, not a guess about the free plan')
  assert.match(security, /kyc\.probe\.workflowUsable/, 'the workflow row must distinguish published from not')
})

test('a standalone check script exists for diagnosing without a deploy', () => {
  const script = read('scripts/didit-check.mjs')
  assert.match(script, /\/v3\/workflows\//, 'the cheap read that proves host and key')
  assert.match(script, /\/v3\/billing\/balance\//, 'the credit balance')
  assert.match(script, /\/v3\/session\//, 'the call a member actually makes')
  assert.match(script, /--session/, 'opening a real session must be opt-in, not the default')
  assert.match(script, /vendor_data: 'afterworks-console-connection-test'/, 'the probe identity the app reuses')
  assert.doesNotMatch(script, /console\.log\([^)]*API_KEY/, 'the script must never print the key')
})

test('a member is told the truth when the deployment is not configured', () => {
  const submit = read('app/api/kyc/submit/route.ts')
  // The generic "try again in a few minutes" hid a missing key behind an outage message.
  assert.match(submit, /err instanceof DiditConfigError/)
  assert.match(submit, /kyc_not_configured/)
  assert.match(submit, /err instanceof DiditApiError/)
  assert.match(submit, /kyc_provider_auth/)
  assert.match(submit, /diditConfigHint\(\)/)

  const security = read('lib/security.ts')
  assert.match(security, /apx\\\.didit\\\.me/i, 'the posture report must flag a registration-host base URL')
  const health = read('app/api/health/route.ts')
  assert.match(health, /function identityCheck/)
  assert.match(health, /apx\\\.didit\\\.me/i)
})

test('the console connection test opens the same session a member opens', async () => {
  const { probeDiditSession, DIDIT_PROBE_VENDOR_DATA } = await didit()
  const originalFetch = globalThis.fetch
  const calls: { url: string; body: string }[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ session_id: 'ses_probe', url: 'https://verify.didit.me/en/session/tok' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const result = await probeDiditSession('https://afterworks.site')
    assert.equal(result.ok, true)
    assert.equal(result.sessionId, 'ses_probe')
    assert.ok(
      calls[0]!.url.endsWith('/v3/session/'),
      'the probe must call the member-facing endpoint, not the workflow list',
    )
    const body = JSON.parse(calls[0]!.body)
    assert.equal(body.vendor_data, DIDIT_PROBE_VENDOR_DATA, 'a fixed probe identity lets Didit reuse the session')
    assert.equal(body.workflow_id, 'wf_123')
    assert.match(body.callback, /^https:\/\/afterworks\.site\/kyc\/callback/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a session refusal the workflow read cannot see is reported with its cause', async () => {
  const { probeDiditSession } = await didit()
  const originalFetch = globalThis.fetch

  // Every one of these passes GET /v3/workflows/ (200 + workflow found) and refuses POST
  // /v3/session/ — the failure shape where the console says "Ready to verify" and every member
  // is told verification could not be started.
  const cases: { status: number; body: unknown; expect: RegExp }[] = [
    {
      status: 403,
      body: { detail: 'You do not have permission to perform this action.' },
      expect: /write:sessions/,
    },
    {
      status: 400,
      body: { detail: "You don't have enough credits to perform this request. Please top up at https://business.didit.me" },
      expect: /credit/i,
    },
    {
      status: 400,
      body: { callback: ["callback must be on one of the application's allowed domains: https://app.example.com"] },
      expect: /allowed domains/i,
    },
    {
      status: 429,
      body: { detail: 'Request was throttled.' },
      expect: /rate-limited/i,
    },
  ]

  try {
    for (const testCase of cases) {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(testCase.body), { status: testCase.status })) as typeof fetch
      const result = await probeDiditSession('https://afterworks.site')
      assert.equal(result.ok, false)
      assert.equal(result.status, testCase.status)
      assert.match(result.hint ?? '', testCase.expect)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the diagnose route runs the session probe and folds it into the verdict', () => {
  const diagnose = read('app/api/admin/kyc/diagnose/route.ts')
  assert.match(diagnose, /probeDiditSession/, 'the workflow read alone cannot see a session-creation failure')
  assert.match(diagnose, /sessionProbe\?\.ok === true/, 'a green workflow read alone must not read as "Ready to verify"')

  const security = read('app/admin/security/page.tsx')
  assert.match(security, /kyc\.sessionProbe/, 'the operator must see the session-creation answer, not just the workflow read')
})

test('the deployment blueprint points the API at the verification host', () => {
  const render = read('render.yaml')
  assert.doesNotMatch(
    render,
    /DIDIT_API_URL[\s\S]{0,120}?apx\.didit\.me/,
    'apx serves registration only — every /v3/session/ call 404s there while the workflow read still looks fine',
  )
  assert.match(render, /DIDIT_API_URL[\s\S]{0,120}?verification\.didit\.me/)
})
