/**
 * Email clients cannot use the app's favicon, relative image URLs or next/image.
 * Ship the existing logo as an inline PNG attachment instead. The opaque light
 * background keeps the dark wordmark readable when an inbox uses dark mode.
 * This controls the message body, not the provider-managed sender avatar.
 *
 * The bytes are imported, not read from disk. `fs` + `process.cwd()` only resolve on a host
 * with a filesystem; on Cloudflare Workers there is no `public/` directory at runtime, so a
 * disk read would drop the wordmark from every email. `lib/email-logo-data.ts` is generated
 * from the PNG by `scripts/embed-email-logo.mjs`, so the image stays the source of truth and
 * no runtime needs Node's `fs`.
 */
import { EMAIL_LOGO_BASE64 } from '@/lib/email-logo-data'

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

  // No I/O, no try/catch: the PNG is part of the bundle, so this cannot fail at send time
  // the way a missing `public/` directory can.
  return {
    html,
    attachments: [
      {
        filename: 'afterworks-logo.png',
        content: EMAIL_LOGO_BASE64,
        content_type: 'image/png',
        content_id: EMAIL_LOGO_CONTENT_ID,
      },
    ],
  }
}
