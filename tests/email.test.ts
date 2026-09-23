import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test, { type TestContext } from 'node:test'
import { EMAIL_BRAND_LOGO_HTML, EMAIL_LOGO_CONTENT_ID, prepareEmailBranding } from '@/lib/email-brand'
import {
  passwordResetEmailHtml,
  passwordResetEmailSubject,
  passwordResetEmailText,
  sendEmail,
  verificationEmailHtml,
  verificationEmailText,
} from '@/lib/email'

const reset = { name: 'Amina', email: 'member@example.com', code: '004 213', expiresMinutes: 15 }
const verification = { name: 'Amina', email: 'member@example.com', verifyUrl: 'https://afterworks.site/verify-email?token=test-only', expiresHours: 24 }

function mockEmailConfig(t: TestContext) {
  const values = { RESEND_API_KEY: 're_test_key_for_mock_transport', EMAIL_FROM: 'AfterWorks <noreply@afterworks.example>' }
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

test('both account emails use the actual PNG logo as an inline image, not a relative or remote URL', async () => {
  const logo = await fs.readFile('public/brand/email-logo.png')
  assert.equal(logo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(logo.readUInt32BE(16), 400)
  assert.equal(logo.readUInt32BE(20), 240)

  for (const html of [passwordResetEmailHtml(reset), verificationEmailHtml(verification)]) {
    assert.ok(html.includes(EMAIL_BRAND_LOGO_HTML))
    assert.match(html, /alt="AfterWorks"/)
    assert.doesNotMatch(html, /<img[^>]+src="(?:https?:|\/|data:)/)
    const branded = await prepareEmailBranding(html)
    assert.equal(branded.html, html)
    assert.equal(branded.attachments?.length, 1)
    const attachment = branded.attachments![0]!
    assert.equal(attachment.content_id, EMAIL_LOGO_CONTENT_ID)
    assert.equal(attachment.content_type, 'image/png')
    assert.equal(attachment.filename, 'afterworks-logo.png')
    assert.deepEqual(Buffer.from(attachment.content, 'base64'), logo)
  }
})

test('the reset code and verification link remain accessible in HTML and plain text', () => {
  assert.equal(passwordResetEmailSubject(reset.code), '004213 is your AfterWorks password reset code')
  assert.match(passwordResetEmailHtml(reset), /004 213/)
  assert.match(passwordResetEmailText(reset), /004 213/)
  assert.ok(verificationEmailHtml(verification).includes(verification.verifyUrl))
  assert.ok(verificationEmailText(verification).includes(verification.verifyUrl))
  assert.doesNotMatch(passwordResetEmailHtml({ ...reset, name: '<script>' }), /<script>/)
  assert.match(passwordResetEmailHtml({ ...reset, name: '<script>' }), /&lt;script&gt;/)
})

test('Resend receives the inline attachment with the REST content_id field for both templates', async (t) => {
  mockEmailConfig(t)
  const payloads: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.resend.com/emails')
    assert.equal(init.method, 'POST')
    payloads.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ id: 'test-only-message-id' }), { status: 200 })
  })

  for (const copy of [
    { subject: passwordResetEmailSubject(reset.code), html: passwordResetEmailHtml(reset), text: passwordResetEmailText(reset), tag: 'password-reset' },
    { subject: 'Verify your AfterWorks email', html: verificationEmailHtml(verification), text: verificationEmailText(verification), tag: 'email-verification' },
  ]) {
    assert.deepEqual(await sendEmail({ to: 'member@example.com', ...copy }), { ok: true, id: 'test-only-message-id' })
  }

  assert.equal(payloads.length, 2)
  for (const payload of payloads) {
    const attachments = payload.attachments as Record<string, unknown>[]
    assert.equal(attachments.length, 1)
    assert.equal(attachments[0]!.content_id, EMAIL_LOGO_CONTENT_ID)
    assert.equal(attachments[0]!.content_type, 'image/png')
    assert.equal(attachments[0]!.contentId, undefined)
    assert.deepEqual(payload.to, ['member@example.com'])
    assert.equal(payload.from, 'AfterWorks <noreply@afterworks.example>')
  }
})

test('a missing image falls back to readable branding without preventing recovery email delivery', async (t) => {
  mockEmailConfig(t)
  t.mock.method(fs, 'readFile', async () => { throw new Error('Simulated missing deploy asset') })
  t.mock.method(console, 'warn', () => {})
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body))
    assert.equal(payload.attachments, undefined)
    assert.doesNotMatch(payload.html, /cid:|<img/)
    assert.match(payload.html, /AfterWorks/)
    assert.match(payload.html, /004 213/)
    return new Response(JSON.stringify({ id: 'test-only-fallback-id' }), { status: 200 })
  })
  assert.deepEqual(await sendEmail({ to: 'member@example.com', subject: 'Reset', html: passwordResetEmailHtml(reset), text: passwordResetEmailText(reset) }), { ok: true, id: 'test-only-fallback-id' })
  assert.equal(fetch.mock.callCount(), 1)
})

test('emails without a logo do not read or attach any asset', async (t) => {
  const read = t.mock.method(fs, 'readFile', async () => { throw new Error('Should not read') })
  assert.deepEqual(await prepareEmailBranding('<p>Plain message</p>'), { html: '<p>Plain message</p>' })
  assert.equal(read.mock.callCount(), 0)
})
