/**
 * Email clients cannot use the app's favicon, relative image URLs or next/image.
 * Ship the existing logo as an inline PNG attachment instead. The opaque light
 * background keeps the dark wordmark readable when an inbox uses dark mode.
 * This controls the message body, not the provider-managed sender avatar.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export const EMAIL_LOGO_CONTENT_ID = 'afterworks-logo'
export const EMAIL_BRAND_LOGO_HTML = `<img src="cid:${EMAIL_LOGO_CONTENT_ID}" alt="AfterWorks" width="200" height="120" border="0" style="display:block;width:200px;max-width:100%;height:auto;border:0;border-radius:12px;outline:none;text-decoration:none;" />`

/** Resend's REST API uses snake_case (its JavaScript SDK uses contentId instead). */
export type InlineEmailAttachment = {
  filename: string
  content: string
  content_type: 'image/png'
  content_id: string
}

export async function prepareEmailBranding(html: string): Promise<{ html: string; attachments?: InlineEmailAttachment[] }> {
  if (!html.includes(EMAIL_BRAND_LOGO_HTML)) return { html }

  try {
    // Keep this path literal and bounded for Next's output-file tracer. The two
    // sending routes also explicitly include this asset in next.config.js.
    const logo = await fs.readFile(path.join(process.cwd(), 'public/brand/email-logo.png'))
    return {
      html,
      attachments: [{
        filename: 'afterworks-logo.png',
        content: logo.toString('base64'),
        content_type: 'image/png',
        content_id: EMAIL_LOGO_CONTENT_ID,
      }],
    }
  } catch {
    // Branding must never stop an account-recovery email from being delivered.
    // Remove the CID image rather than leaving a broken-image icon in the inbox.
    console.warn('[email] Logo asset unavailable; sending text branding instead.')
    return {
      html: html.split(EMAIL_BRAND_LOGO_HTML).join('<span style="font-size:20px;font-weight:700;color:#1A1F36;">AfterWorks</span>'),
    }
  }
}
