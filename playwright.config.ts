import { defineConfig } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    // Optional existing Chromium for restricted/offline development environments.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: `${baseURL}/forgot-password`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
