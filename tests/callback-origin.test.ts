import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * How this deployment decides what its own public address is.
 *
 * This used to be pinned around the Didit callback, which was the sharpest case: the provider
 * treated `callback` as an opaque string, so a session created against
 * `http://localhost:3000/kyc/callback` was valid, the member finished the whole flow, and the
 * redirect landed on an address that does not exist outside the container — a failure with no
 * error anywhere, which is why it needed a test of its own.
 *
 * Identity verification is a human review now, so there is no provider callback to strand anyone
 * on. The same origin resolution still feeds email links, payment redirects and the site URL, so
 * the two rules stay worth pinning: classify the origin honestly, and let an operator-set app URL
 * win over anything the request claims about itself.
 */

type CoreModule = typeof import('../lib/security-core')

const loaded: { core?: CoreModule } = {}
async function core(): Promise<CoreModule> {
  if (!loaded.core) loaded.core = await import('../lib/security-core')
  return loaded.core
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

test('a public https address is the only thing a member can be sent to', async () => {
  const { isPublicHttpsUrl } = await core()
  assert.equal(isPublicHttpsUrl('https://afterworks.site/kyc/callback'), true)
  assert.equal(isPublicHttpsUrl('https://www.afterworks.site/kyc/callback'), true)

  // Every one of these produces a link that cannot be opened by the person it was made for.
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

  // A forged Host must not be able to redirect a member-supplied link somewhere else.
  const resolved = publicOriginFor(fakeRequest({ host: 'evil.example', 'x-forwarded-proto': 'https' }))
  assert.equal(resolved.origin, 'https://afterworks.site')
  assert.equal(resolved.source, 'env')
  assert.equal(resolved.isPublicHttps, true)

  clearAppUrls()
})

test('a bare hostname is upgraded to https rather than left as http', async () => {
  const { publicOriginFor } = await core()
  clearAppUrls()
  process.env.APP_URL = 'afterworks.site'
  assert.equal(publicOriginFor(fakeRequest({})).origin, 'https://afterworks.site')
  clearAppUrls()
})

test('without an app URL the allow-listed Host is used, and the fallback is named', async () => {
  const { publicOriginFor } = await core()
  clearAppUrls()

  const fromHeader = publicOriginFor(fakeRequest({ host: 'afterworks.site', 'x-forwarded-proto': 'https' }))
  assert.equal(fromHeader.origin, 'https://afterworks.site')
  assert.equal(fromHeader.source, 'host-header')
  assert.equal(fromHeader.isPublicHttps, true)

  const fromForwarded = publicOriginFor(
    fakeRequest({ host: 'internal:3000', 'x-forwarded-host': 'www.afterworks.site', 'x-forwarded-proto': 'https' }),
  )
  assert.equal(fromForwarded.origin, 'https://www.afterworks.site')
  assert.equal(fromForwarded.source, 'forwarded-host')

  // The container-behind-a-proxy case: nothing configured, nothing usable. It must not be reported
  // as healthy just because some URL came back.
  const requestOrigin = publicOriginFor(fakeRequest({}, 'http://localhost:3000'))
  assert.equal(requestOrigin.source, 'request-origin')
  assert.equal(requestOrigin.isPublicHttps, false)
})
