import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * The deployment that breaks KYC silently.
 *
 * Every credential can be present and the integration still be dead, because `/v3/*` lives on
 * `verification.didit.me` while `apx.didit.me` serves registration only. A base URL copied from
 * the old `.env.example` therefore 404s every session creation, and the member sees the same
 * "could not be started right now" as a provider outage.
 *
 * This file is separate from `didit-kyc.test.ts` because `lib/didit` reads its environment at
 * import time, and a Node test file is its own process.
 */

process.env.DIDIT_API_URL = 'https://apx.didit.me'
process.env.DIDIT_API_KEY = 'live-looking-key'
process.env.DIDIT_WORKFLOW_ID = 'wf_123'
process.env.DIDIT_WEBHOOK_SECRET = 'whsec'

type DiditModule = typeof import('../lib/didit')

let loaded: DiditModule | null = null
async function didit(): Promise<DiditModule> {
  if (!loaded) loaded = await import('../lib/didit')
  return loaded
}

test('a registration-host base URL is reported instead of looking healthy', async () => {
  const { diditConfig, diditConfigHint } = await didit()
  const config = diditConfig()

  assert.equal(config.host, 'apx.didit.me')
  assert.equal(config.usesRegistrationHost, true)
  assert.equal(config.hasApiKey, true, 'the key is present — which is exactly why the keys-only check missed this')
  assert.equal(config.configured, true)

  const hint = diditConfigHint()
  assert.match(hint ?? '', /apx\.didit\.me/)
  assert.match(hint ?? '', /verification\.didit\.me/)
})

test('session creation refuses before calling the wrong host', async () => {
  const { createKycSession, DiditConfigError } = await didit()

  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  try {
    await assert.rejects(
      () => createKycSession('uid-1', true, 'https://afterworks.site'),
      (err: unknown) => {
        assert.ok(err instanceof DiditConfigError, 'must be a config error, not a provider error')
        assert.match(String((err as Error).message), /DIDIT_API_URL/)
        return true
      },
    )
    assert.equal(called, false, 'a misconfigured host must not be called at all')
  } finally {
    globalThis.fetch = originalFetch
  }
})
