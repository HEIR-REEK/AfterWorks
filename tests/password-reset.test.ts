import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCodeForDisplay, normaliseCode } from '@/lib/password-reset'

test('email formatting round-trips through server verification, including leading zeros', () => {
  for (const code of ['000000', '004213', '123456', '999999']) {
    assert.equal(normaliseCode(formatCodeForDisplay(code)), code)
  }
})

test('spaces copied from email do not change the code sent for verification', () => {
  assert.equal(normaliseCode('  \n004\u00a0213\n '), '004213')
  assert.equal(normaliseCode('004 213'), '004213')
  assert.equal(normaliseCode('004213'), '004213')
})
