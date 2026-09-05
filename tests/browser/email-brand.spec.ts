import { expect, test } from '@playwright/test'
import { EMAIL_LOGO_CONTENT_ID, prepareEmailBranding } from '@/lib/email-brand'
import { passwordResetEmailHtml, verificationEmailHtml } from '@/lib/email'

const templates = [
  { name: 'password reset', html: passwordResetEmailHtml({ name: 'Amina', email: 'member@example.com', code: '004 213', expiresMinutes: 15 }) },
  { name: 'verification', html: verificationEmailHtml({ name: 'Amina', email: 'member@example.com', verifyUrl: 'https://afterworks.site/verify-email?token=test-only', expiresHours: 24 }) },
]

for (const template of templates) {
  test(`${template.name} email displays the embedded logo at mobile width without remote image requests`, async ({ page }) => {
    const branded = await prepareEmailBranding(template.html)
    const attachment = branded.attachments![0]!
    // A browser has no email MIME/CID resolver. Resolve the exact attachment bytes
    // locally for this rendering check; production mail keeps the cid: reference.
    const html = branded.html.replace(`cid:${EMAIL_LOGO_CONTENT_ID}`, `data:image/png;base64,${attachment.content}`)
    await page.route('**/*', (route) => route.abort())
    await page.setViewportSize({ width: 390, height: 844 })
    await page.setContent(html)
    const logo = page.getByRole('img', { name: 'AfterWorks', exact: true })
    await expect(logo).toBeVisible()
    await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(400)
    expect(await logo.evaluate((image: HTMLImageElement) => image.getBoundingClientRect().width)).toBe(200)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
