import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Where Didit sends the member after the flow.
 *
 * This is the half of KYC that fails without an error. Didit treats `callback` as an opaque string:
 * a session created with `http://localhost:3000/kyc/callback` is valid, the member's ID is scanned,
 * the decision is recorded — and then the redirect lands on an address that does not exist outside
 * the container. Nothing in the provider's response says so, so the deployment looks like "KYC is
 * broken at the very end" with no diagnostic to point at.
 *
 * These tests pin the two rules that keep it visible: classify the origin honestly, and let an
 * operator-set app URL win over anything the request claims.
 */

process.env.DIDIT_API_KEY = 'test-key'
process.env.DIDIT_WORKFLOW_ID = 'wf_123'
process.env.DIDIT_WEBHOOK_SECRET = 'whsec'

type CoreModule = typeof import('../lib/security-core')
type DiditModule = typeof import('../lib/didit')

const loaded: { core?: CoreModule; didit?: DiditModule } = {}
async function core(): Promise<CoreModule> {
  if (!loaded.core) loaded.core = await import('../lib/security-core')
  return loaded.core
}
async function didit(): Promise<DiditModule> {
  if (!loaded.didit) loaded.didit = await import('../lib/didit')
  return loaded.didit
}

/** Minimal stand-in for a NextRequest: only the two fields the resolver reads. */
function fakeRequest(headers: Record<string, string>, origin = 'http://localhost:3000') {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    nextUrl: { origin },
  }
}

function clearAppUrls() {
  for (const key of ['NEXT_PUBLIC_APP_URL', 'APP_URL', 'RENDER_EXTERNAL_URL', 'VERCEL_URL', 'APP_ALLOWED_HOSTS']) {
    delete process.env[key]
  }
}

test('a public https address is the only thing a member can be sent back to', async () => {
  const { isPublicHttpsUrl } = await core()
  assert.equal(isPublicHttpsUrl('https://afterworks.site/kyc/callback'), true)
  assert.equal(isPublicHttpsUrl('https://www.afterworks.site/kyc/callback'), true)

  // Every one of these creates a session successfully and then strands the member.
  assert.equal(isPublicHttpsUrl('http://afterworks.site/kyc/callback'), false, 'plain http')
  assert.equal(isPublicHttpsUrl('https://localhost:3000/kyc/callback'), false, 'localhost')
  assert.equal(isPublicHttpsUrl('https://127.0.0.1/kyc/callback'), false, 'loopback ip')
  assert.equal(isPublicHttpsUrl('https://0.0.0.0:3000/kyc/callback'), false, 'bind address')
  assert.equal(isPublicHttpsUrl('https://10.0.0.4/kyc/callback'), false, 'private 10/8')
  assert.equal(isPublicHttpsUrl('https://192.168.1.20/kyc/callback'), false, 'private 192.168/16')
  assert.equal(isPublicHttpsUrl('https://api.internal/kyc/callback'), false, '.internal')
  assert.equal(isPublicHttpsUrl('not-a-url'), false, 'unparseable')
  assert.equal(isPublicHttpsUrl(''), false, 'empty')
})

test('an operator-set app URL wins over the Host header', async () => {
  const { publicOriginFor } = await core()
  clearAppUrls()
  process.env.NEXT_PUBLIC_APP_URL = 'https://afterworks.site/'

  // A forged Host must not be able to redirect the callback somewhere else.
  const resolved = publicOriginFor(fakeRequest({ host: 'evil.example', 'x-forwarded-proto': 'https' }))
  assert.equal(resolved.origin, 'https://afterworks.site')
  assert.equal(resolved.source, 'env')
  assert.equal(resolved.isPublicHttps, true)

  clearAppUrls()
})

test('a bare hostname is upgraded to https rather than sent as an http callback', async () => {
  const { publicOriginFor } = await core()
  clearAppUrls()
  process.env.APP_URL = 'afterworks.site'
  assert.equal(publicOriginFor(fakeRequest({})).origin, 'https://afterworks.site')
  clearAppUrls()
})

test('without an app URL the allow-listed Host is used, and the fallback is named', async () => {
  const { publicOriginFor } = await core()
  clearAppUrls()

  const fromHeader = publicOriginFor(
    fakeRequest({ host: 'afterworks.site', 'x-forwarded-proto': 'https' }),
  )
  assert.equal(fromHeader.origin, 'https://afterworks.site')
  assert.equal(fromHeader.source, 'host-header')
  assert.equal(fromHeader.isPublicHttps, true)

  const fromForwarded = publicOriginFor(
    fakeRequest({ host: 'internal:3000', 'x-forwarded-host': 'www.afterworks.site', 'x-forwarded-proto': 'https' }),
  )
  assert.equal(fromForwarded.origin, 'https://www.afterworks.site')
  assert.equal(fromForwarded.source, 'forwarded-host')

  // The container-behind-a-proxy case: nothing configured, nothing usable. It must not be reported
  // as healthy just because a URL came back.
  const requestOrigin = publicOriginFor(fakeRequest({}, 'http://localhost:3000'))
  assert.equal(requestOrigin.source, 'request-origin')
  assert.equal(requestOrigin.isPublicHttps, false)
})

test('the callback Didit is handed is built from the resolved origin', async () => {
  const { callbackTarget } = await didit()
  clearAppUrls()

  const fromArg = callbackTarget('https://afterworks.site')
  assert.equal(fromArg.url, 'https://afterworks.site/kyc/callback')
  assert.equal(fromArg.origin, 'https://afterworks.site')
  assert.equal(fromArg.fromEnv, false)
  assert.equal(fromArg.isPublicHttps, true)

  // An app URL still beats the origin the route computed, because Didit keeps that string forever.
  process.env.NEXT_PUBLIC_APP_URL = 'https://afterworks.site'
  const fromEnv = callbackTarget('http://localhost:3000')
  assert.equal(fromEnv.url, 'https://afterworks.site/kyc/callback')
  assert.equal(fromEnv.fromEnv, true)
  assert.equal(fromEnv.isPublicHttps, true)

  clearAppUrls()
  const stranded = callbackTarget('http://localhost:3000')
  assert.equal(stranded.url, 'http://localhost:3000/kyc/callback')
  assert.equal(stranded.isPublicHttps, false)
})
