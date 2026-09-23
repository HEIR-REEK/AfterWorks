import { expect, test, type Page } from '@playwright/test'

/** These are browser/UI regressions. All API calls are mocked: no email, Firebase or real accounts. */
async function mockReset(page: Page) {
  const calls: Record<string, string>[] = []
  let activeCode = '004213'
  let requests = 0

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path !== '/api/auth/password-reset') {
      await route.fulfill({ json: { ok: true, authenticated: false, config: { enabled: false } } })
      return
    }

    const body = route.request().postDataJSON() as Record<string, string>
    calls.push(body)
    switch (body.step) {
      case 'request':
        if (requests++ > 0) activeCode = '891023'
        await route.fulfill({ json: { ok: true, message: 'Check your inbox.', expiresInMinutes: 15, resendAfterSec: 0 } })
        return
      case 'verify':
        if (body.code !== activeCode) {
          await route.fulfill({ status: 400, json: { error: 'Check the latest email and try again.', code: 'invalid_code', attemptsLeft: 4 } })
          return
        }
        await route.fulfill({ json: { ok: true, ticket: 'test-only-ticket', minPasswordLength: 8 } })
        return
      case 'complete':
        await route.fulfill({ json: { ok: true, step: 'done' } })
        return
      default:
        throw new Error(`Unexpected reset step: ${body.step}`)
    }
  })

  // The page is server-rendered. Wait for a client effect before interacting so the
  // browser cannot submit the pre-hydration HTML form and navigate away instead.
  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/admin/session'),
    page.goto('/forgot-password'),
  ])
  await page.getByLabel('Email address', { exact: true }).fill('member@example.com')
  await page.getByRole('button', { name: 'Send reset code' }).click()
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
  return calls
}

test('a typed, grouped code with leading zeros passes native validation and completes the UI flow', async ({ page }) => {
  const calls = await mockReset(page)
  const input = page.getByLabel('6-digit code', { exact: true })
  await input.pressSequentially('004213')
  await expect(input).toHaveValue('004 213')
  expect(await input.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(true)

  await page.getByRole('button', { name: 'Verify code', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  expect(calls.find((call) => call.step === 'verify')).toEqual({ step: 'verify', email: 'member@example.com', code: '004213' })

  await page.getByLabel('New password', { exact: true }).fill('DistinctPhrase847')
  await page.getByLabel('Confirm new password', { exact: true }).fill('DistinctPhrase847')
  await page.getByRole('button', { name: 'Set new password', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible()
  expect(calls.find((call) => call.step === 'complete')).toEqual({ step: 'complete', ticket: 'test-only-ticket', password: 'DistinctPhrase847' })
})

test('pasting a code copied from an email preserves all six digits before maxLength applies', async ({ page, context }) => {
  const calls = await mockReset(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('  \n004\u00a0213\n  '))
  const input = page.getByLabel('6-digit code', { exact: true })
  await input.focus()
  await input.press('ControlOrMeta+V')
  await expect(input).toHaveValue('004 213')
  expect(await input.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(true)
  await page.getByRole('button', { name: 'Verify code', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  expect(calls.find((call) => call.step === 'verify')?.code).toBe('004213')
})

test('incomplete codes cannot submit; server rejection is shown and a fresh code can be retried', async ({ page }) => {
  const calls = await mockReset(page)
  const input = page.getByLabel('6-digit code', { exact: true })
  await input.fill('00421')
  await expect(page.getByRole('button', { name: 'Verify code', exact: true })).toBeDisabled()
  expect(calls.filter((call) => call.step === 'verify')).toHaveLength(0)

  await page.getByRole('button', { name: 'Resend code', exact: true }).click()
  await expect(input).toHaveValue('')
  await input.fill('004213')
  await page.getByRole('button', { name: 'Verify code', exact: true }).click()
  await expect(page.locator('form').getByRole('alert')).toHaveText('Check the latest email and try again.')
  await expect(page.getByText(/4 tries left on this code/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()

  await input.fill('891023')
  await page.getByRole('button', { name: 'Verify code', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  expect(calls.filter((call) => call.step === 'verify').map((call) => call.code)).toEqual(['004213', '891023'])
})
