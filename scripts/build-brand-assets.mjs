#!/usr/bin/env node
/**
 * Regenerate the brand assets from the source logo.
 *
 *   node scripts/build-brand-assets.mjs [path/to/source.png]
 *
 * The source of truth is `brand/logo-source.png` (the supplied 1408×768 picture logo). Everything the
 * app actually loads is derived from it here, because shipping that file as-is cost 1.14 MB per page —
 * it was the favicon, the apple touch icon *and* the 32 px navbar mark.
 *
 * What it produces (all in `public/brand/`, plus Next's metadata icons):
 *   mark.png        256² monogram, background punched out  (navbars, tiles — optimiser resizes it)
 *   mark-96.png     96² monogram                           (small slots, no optimiser needed)
 *   mark-64.png     64² monogram                           (edge-served outage page + favicon)
 *   lockup.png      monogram + wordmark, transparent       (sign-in, admin sign-in, marketing)
 *   icon-192/512, maskable-512                              (PWA manifest)
 *   opengraph.png   1200×630 share card                      (open-graph / twitter card)
 *   app/icon.png, app/apple-icon.png                        (favicon + touch icon)
 *
 * Requires ImageMagick (`convert`) on PATH.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SOURCE = path.resolve(ROOT, process.argv[2] ?? 'brand/logo-source.png')
const OUT = path.join(ROOT, 'public', 'brand')
const BG = '#F7F8F6' // sampled from the source artwork
const FUZZ = '14%'

if (!existsSync(SOURCE)) {
  console.error(`✗ source logo not found: ${SOURCE}`)
  process.exit(1)
}

const run = (args, label) => {
  execFileSync('convert', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  console.log(`  ✓ ${label}`)
}

/**
 * Find the content bands of the source image: rows that contain dark pixels, grouped into contiguous
 * bands. The first band is the monogram, the last is the wordmark. Doing this instead of hard-coding
 * crop boxes means the script survives a re-exported logo of a different size.
 */
function findBands(file) {
  const pgm = execFileSync('convert', [file, '-colorspace', 'Gray', '-depth', '8', 'pgm:-'], {
    maxBuffer: 1 << 28,
  })
  let i = 2 // skip "P5"
  const nums = []
  while (nums.length < 3) {
    while (pgm[i] === 0x20 || pgm[i] === 0x0a || pgm[i] === 0x0d || pgm[i] === 0x09) i++
    if (pgm[i] === 0x23) {
      while (pgm[i] !== 0x0a) i++
      continue
    }
    let j = i
    while (![0x20, 0x0a, 0x0d, 0x09].includes(pgm[j])) j++
    nums.push(Number(pgm.subarray(i, j).toString()))
    i = j
  }
  const [width, height] = nums
  const data = pgm.subarray(i, i + width * height)
  const THRESHOLD = 238
  const bands = []
  let y = 0
  while (y < height) {
    let dark = 0
    for (let x = 0; x < width; x++) if (data[y * width + x] < THRESHOLD) dark++
    if (dark > 2) {
      const start = y
      while (y < height) {
        let count = 0
        for (let x = 0; x < width; x++) if (data[y * width + x] < THRESHOLD) count++
        if (count === 0) break
        y++
      }
      let minX = width
      let maxX = 0
      for (let row = start; row < y; row += 1) {
        for (let x = 0; x < width; x++) {
          if (data[row * width + x] < THRESHOLD) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
          }
        }
      }
      bands.push({ top: start, bottom: y, left: minX, right: maxX })
    }
    y++
  }
  if (bands.length === 0) throw new Error('no content found in the source logo — is it a flat image?')
  return { width, height, bands }
}

mkdirSync(OUT, { recursive: true })
console.log(`Building brand assets from ${path.relative(ROOT, SOURCE)}`)

const { bands } = findBands(SOURCE)
// The monogram is the tallest band above the wordmark; with a two-band logo that is simply bands[0].
const mark = bands[0]
const union = {
  top: Math.min(...bands.map((b) => b.top)),
  bottom: Math.max(...bands.map((b) => b.bottom)),
  left: Math.min(...bands.map((b) => b.left)),
  right: Math.max(...bands.map((b) => b.right)),
}
const pad = 16
const geo = (b, extra = pad) => `${b.right - b.left + extra * 2}x${b.bottom - b.top + extra * 2}+${b.left - extra}+${b.top - extra}`
const punch = ['-fuzz', FUZZ, '-fill', 'none', '-stroke', 'none', '-draw', 'matte 2,2 floodfill']

// The brand images are referenced with `unoptimized` (see `components/brand.tsx`) because this
// deployment does not install `sharp`, so `next/image` cannot resize anything at runtime — a request
// to `/_next/image` returns 400. Pre-sizing and quantising here is what keeps the logo cheap.
const QUANTISE = ['-colors', '256', '-depth', '8', '-dither', 'None']

run([SOURCE, '-crop', geo(mark), '+repage', ...punch, '-trim', '+repage', '-bordercolor', 'none', '-border', '14', '-resize', '256x256', '-background', 'none', '-gravity', 'center', '-extent', '256x256', ...QUANTISE, '-strip', `PNG8:${path.join(OUT, 'mark.png')}`], 'mark.png (256², transparent)')
run([path.join(OUT, 'mark.png'), '-resize', '96x96', ...QUANTISE, '-strip', `PNG8:${path.join(OUT, 'mark-96.png')}`], 'mark-96.png (chrome tiles)')
run([path.join(OUT, 'mark.png'), '-resize', '64x64', ...QUANTISE, '-strip', `PNG8:${path.join(OUT, 'mark-64.png')}`], 'mark-64.png (favicon, outage page)')
run([SOURCE, '-crop', geo(union, 10), '+repage', ...punch, '-trim', '+repage', '-bordercolor', 'none', '-border', '10', '-resize', '620x', ...QUANTISE, '-strip', `PNG8:${path.join(OUT, 'lockup.png')}`], 'lockup.png (mark + wordmark, 620 px)')

for (const [size, target] of [
  [192, path.join(OUT, 'icon-192.png')],
  [512, path.join(OUT, 'icon-512.png')],
  [64, path.join(ROOT, 'app', 'icon.png')],
  [180, path.join(ROOT, 'app', 'apple-icon.png')],
]) {
  run([path.join(OUT, 'mark.png'), '-background', BG, '-gravity', 'center', '-resize', `${size}x${size}`, '-extent', `${size}x${size}`, '-alpha', 'remove', '-alpha', 'off', '-strip', `PNG8:${target}`], `${path.relative(ROOT, target)}`)
}
run([path.join(OUT, 'mark.png'), '-resize', '62%', '-background', BG, '-gravity', 'center', '-extent', '512x512', '-alpha', 'remove', '-alpha', 'off', '-strip', `PNG8:${path.join(OUT, 'maskable-512.png')}`], 'maskable-512.png (20% safe zone)')

try {
  execFileSync('convert', ['-list', 'font'], { stdio: 'ignore' })
  run(
    [
      '-size', '1200x630', `xc:${BG}`,
      '-gravity', 'South', '-font', 'DejaVu-Sans-Bold', '-pointsize', '34', '-fill', '#3A4657',
      '-annotate', '+0+96', 'Real, verified microwork.  Paid to your mobile money.',
      // The lockup goes in a sub-shell so `-resize` applies to it and not to the canvas.
      '(', path.join(OUT, 'lockup.png'), '-resize', '620x', ')', '-gravity', 'Center', '-composite',
      '-background', BG, '-flatten', '-strip', '-quality', '92', `PNG8:${path.join(OUT, 'opengraph.png')}`,
    ],
    'opengraph.png (1200×630 share card)',
  )
} catch {
  console.warn('  ! skipped the share card (no usable font for ImageMagick)')
}

console.log('\nDone. Commit the regenerated files in public/brand, app/icon.png and app/apple-icon.png.')
