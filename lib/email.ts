/**
 * Transactional email — Resend is the only transport.
 *
 * Signup verification used to call Firebase `sendEmailVerification()`, which ships Firebase's
 * default template from a domain nobody asked for and which workers' inboxes treat as spam.
 * The link, the copy and the from-address now come from us; Firebase Auth is only the place
 * we *record* that the address was proven (Admin SDK `emailVerified: true`).
 *
 * The API key is server-only. A missing key fails closed: we do not pretend the mail was sent.
 */

import { env, isEmailLike, isProduction, sanitizeLine } from '@/lib/security-core'
import { site } from '@/lib/site'

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
  /** Optional Resend tag for the dashboard (e.g. `email-verification`). */
  tag?: string
  replyTo?: string
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string; code: string; status?: number }

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Resend's onboarding sender — works without a verified domain, for local/preview only. */
const RESEND_TEST_FROM = 'AfterWorks <beth.t@example.com>'

export function resendApiKey(): string {
  return env('RESEND_API_KEY').trim()
}

export function isResendConfigured(): boolean {
  return resendApiKey().startsWith('re_')
}

/**
 * From-address. Production must use a domain verified in Resend; the test sender is accepted
 * only outside production so a missing EMAIL_FROM does not silently break local signup.
 *
 * Gmail/Yahoo/Outlook cannot be a Resend From — Resend authenticates a domain you own, not a
 * consumer mailbox. Those addresses belong in EMAIL_REPLY_TO / NEXT_PUBLIC_SUPPORT_EMAIL.
 */
export function emailFromAddress(): string {
  const configured = sanitizeLine(env('EMAIL_FROM') || env('RESEND_FROM'), 180)
  if (configured && configured.includes('@') && !isConsumerMailbox(configured)) return configured
  return isProduction() ? `AfterWorks <noreply@${fromHost()}>` : RESEND_TEST_FROM
}

export function emailReplyToAddress(): string {
  const dedicated = sanitizeLine(env('EMAIL_REPLY_TO'), 180)
  if (isEmailLike(dedicated)) return dedicated.trim().toLowerCase()
  return site.supportEmail
}

const CONSUMER_MAILBOX_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
])

function addressDomain(value: string): string {
  const match = value.toLowerCase().match(/@([^>\s]+)/)
  return match?.[1] ?? ''
}

function isConsumerMailbox(value: string): boolean {
  return CONSUMER_MAILBOX_DOMAINS.has(addressDomain(value))
}

function fromHost(): string {
  try {
    const url = site.url.startsWith('http') ? site.url : `https://${site.url}`
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host || 'afterworks.io'
  } catch {
    return 'afterworks.io'
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = resendApiKey()
  if (!key) {
    return {
      ok: false,
      error: 'Transactional email is not configured on this deployment (RESEND_API_KEY).',
      code: 'email_unconfigured',
    }
  }
  if (!key.startsWith('re_')) {
    return {
      ok: false,
      error: 'RESEND_API_KEY does not look like a Resend key.',
      code: 'email_unconfigured',
    }
  }

  const to = input.to.trim().toLowerCase()
  if (!isEmailLike(to)) {
    return { ok: false, error: 'That email address is not deliverable.', code: 'invalid_recipient' }
  }

  const payload: Record<string, unknown> = {
    from: emailFromAddress(),
    to: [to],
    subject: sanitizeLine(input.subject, 140) || 'AfterWorks',
    html: input.html,
    text: input.text,
  }
  const replyTo = input.replyTo || emailReplyToAddress()
  if (isEmailLike(replyTo)) payload.reply_to = replyTo
  if (input.tag) payload.tags = [{ name: 'category', value: sanitizeLine(input.tag, 40) }]

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string; statusCode?: number }
      | null

    if (!res.ok || !body?.id) {
      const detail = typeof body?.message === 'string' ? body.message.slice(0, 180) : `HTTP ${res.status}`
      console.error('[email] Resend rejected send:', res.status, detail)
      return {
        ok: false,
        error: isProduction()
          ? 'We could not send the email just now. Please try again in a minute.'
          : `Resend rejected the send (${detail}). Check EMAIL_FROM is a verified domain, or use beth.t@example.com in development.`,
        code: 'email_send_failed',
        status: res.status,
      }
    }
    return { ok: true, id: body.id }
  } catch (err) {
    console.error('[email] Resend unreachable:', err instanceof Error ? err.message : err)
    return {
      ok: false,
      error: 'The email service is unreachable. Please try again shortly.',
      code: 'email_unreachable',
    }
  }
}

export type VerificationEmailCopy = {
  name: string
  email: string
  verifyUrl: string
  expiresHours: number
}

export function verificationEmailSubject(): string {
  return 'Verify your AfterWorks email'
}

export function verificationEmailText(copy: VerificationEmailCopy): string {
  const first = firstName(copy.name, copy.email)
  return [
    `Hi ${first},`,
    '',
    'Confirm this email address to finish creating your AfterWorks account. Until you do, you cannot update your profile or start identity verification.',
    '',
    `Verify your email: ${copy.verifyUrl}`,
    '',
    `This link expires in ${copy.expiresHours} hour${copy.expiresHours === 1 ? '' : 's'} and can be used once.`,
    '',
    'If you did not create an AfterWorks account, you can ignore this message — nothing else will happen.',
    '',
    `— ${site.name}`,
    site.supportEmail,
  ].join('\n')
}

export function verificationEmailHtml(copy: VerificationEmailCopy): string {
  const first = escapeHtml(firstName(copy.name, copy.email))
  const url = escapeHtml(copy.verifyUrl)
  const hours = String(copy.expiresHours)
  const support = escapeHtml(site.supportEmail)
  const brand = escapeHtml(site.name)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Verify your AfterWorks email</title>
</head>
<body style="margin:0;padding:0;background:#F4F6FB;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1A1F36;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FB;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr>
            <td style="padding:8px 8px 20px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2F5FE0;">
              ${brand}
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #E4E7F1;border-radius:16px;padding:36px 32px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#2F5FE0;">Step 2 of 4 — verify your email</p>
              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;color:#1A1F36;">Confirm this is your address</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3C4257;">
                Hi ${first}, we need to know <strong>${escapeHtml(copy.email)}</strong> is a real inbox you control before you update your profile or start identity verification.
              </p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#3C4257;">
                Click the button below. The link expires in ${hours} hour${copy.expiresHours === 1 ? '' : 's'} and works once.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:10px;background:#2F5FE0;">
                    <a href="${url}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Verify my email
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0;font-size:12px;line-height:1.55;color:#667085;word-break:break-all;">
                If the button does not work, paste this URL into your browser:<br />
                <a href="${url}" style="color:#2F5FE0;">${url}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0;font-size:12px;line-height:1.55;color:#667085;">
              If you did not create an AfterWorks account, ignore this email — nothing else will happen.
              Questions? ${support}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function firstName(name: string, email: string): string {
  const trimmed = name.trim()
  if (trimmed) return trimmed.split(/\s+/)[0]!.slice(0, 40)
  const local = email.split('@')[0] || 'there'
  return local.slice(0, 40)
}
