import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

test('the public origin never falls back to localhost in a production build', () => {
  const site = read('lib/site.ts')
  assert.match(site, /function publicSiteUrl/)
  assert.match(site, /loopback/)
  assert.match(site, /return isProduction\(\) \? 'https:\/\/afterworks\.site' : 'http:\/\/localhost:3000'/)
  // metadataBase must be the resolved site origin, not a second hard-coded domain.
  const layout = read('app/layout.tsx')
  assert.match(layout, /metadataBase: new URL\(site\.url\)/)
})

test('search metadata exposes verification tokens and a crawlable canonical', () => {
  const layout = read('app/layout.tsx')
  assert.match(layout, /GOOGLE_SITE_VERIFICATION/)
  assert.match(layout, /BING_SITE_VERIFICATION/)
  assert.match(layout, /robots: noIndex/)
  assert.match(layout, /logo: `\$\{site\.url\}\/brand\/icon-512\.png`/)
})

test('robots.txt obeys SITE_NO_INDEX and excludes private surfaces', () => {
  const robots = read('app/robots.ts')
  assert.match(robots, /envBool\('SITE_NO_INDEX'/)
  assert.match(robots, /disallow: '\/'/)
  assert.match(robots, /'\/jobs'/)
  assert.match(robots, /'\/wallet'/)
  assert.match(robots, /sitemap: `\$\{site\.url\}\/sitemap\.xml`/)
})
