#!/usr/bin/env node
/**
 * Embed the email wordmark into a source module.
 *
 *   node scripts/embed-email-logo.mjs
 *
 * Why this exists
 * ───────────────
 * `lib/email-brand.ts` used to read `public/brand/email-logo.png` from disk at send time
 * (`fs.readFile(path.join(process.cwd(), …))`). That works on a Node server with a real
 * filesystem, but it is the *only* thing in this repo that genuinely needs one:
 *
 *   • Cloudflare Workers (OpenNext) ship a bundle, not a project directory — `process.cwd()`
 *     and `public/` do not exist at runtime, so the read throws and every email silently
 *     falls back to the text wordmark.
 *   • It also needed `outputFileTracingIncludes` in next.config.js to coax the PNG into the
 *     standalone server bundle, and a second place to remember when the logo changed.
 *
 * A 15 KB PNG becomes ~20 KB of base64 in a module the bundler traces automatically. No
 * filesystem, no tracing rules, identical output on Node and on Workers.
 *
 * The artefact is COMMITTED (`lib/email-logo-data.ts`) — this repo already commits the images
 * in `public/brand/`, and a build step that needs ImageMagick must not be required to deploy.
 * Re-run this after `npm run brand:build` regenerates the PNG.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SOURCE = path.join(ROOT, 'public', 'brand', 'email-logo.png')
const TARGET = path.join(ROOT, 'lib', 'email-logo-data.ts')

const png = readFileSync(SOURCE)
if (png.subarray(1, 4).toString('ascii') !== 'PNG') {
  console.error(`✗ ${SOURCE} is not a PNG`)
  process.exit(1)
}

const base64 = png.toString('base64')
// Base64 has no quotes or backslashes, so each chunk is safe as a single-quoted literal.
// Chunks are joined at module load: a JS string literal cannot span source lines, and one
// 20,000-character line is unpleasant to diff.
const chunks = base64.match(/.{1,100}/g).map((chunk) => `  '${chunk}',`).join('\n')

const file = `/**
 * GENERATED FILE — do not edit by hand.
 *
 *   node scripts/embed-email-logo.mjs      (or: npm run brand:embed)
 *
 * Source: public/brand/email-logo.png (${png.length} bytes)
 *
 * The wordmark is inlined as base64 so sending an email never touches the filesystem.
 * See scripts/embed-email-logo.mjs for why that matters on non-Node runtimes.
 */

export const EMAIL_LOGO_BYTES = ${png.length}
export const EMAIL_LOGO_BASE64 = [
${chunks}
].join('')
`

writeFileSync(TARGET, file, 'utf8')
console.log(`✓ wrote ${path.relative(ROOT, TARGET)} (${png.length} bytes → ${base64.length} base64 chars)`)
