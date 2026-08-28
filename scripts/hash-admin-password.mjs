#!/usr/bin/env node
/**
 * Generate an ADMIN_PASSWORD_SCRYPT verifier for the operations console.
 *
 *   node scripts/hash-admin-password.mjs              # prompts twice, input is not echoed
 *   printf '%s' "$PW" | node scripts/hash-admin-password.mjs
 *
 * The format is defined by hashPasscode() in lib/security.ts (scrypt$N$r$p$saltHex$hashHex) and
 * must stay in sync with it: the verifier is parsed by prefix, so changing one side alone locks
 * every operator out. A script rather than a settings screen because a passcode changed from the
 * browser has to reach the browser at some point - here the plaintext exists only in this terminal.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const N = 16384, r = 8, p = 1, KEYLEN = 32, MAXMEM = 64 * 1024 * 1024
const CTRL_C = String.fromCharCode(3)
const BACKSPACE = String.fromCharCode(127)

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    'Usage: node scripts/hash-admin-password.mjs\n\n' +
      'Prints: ADMIN_PASSWORD_SCRYPT="scrypt$16384$8$1$salt$hash"\n\n' +
      'After rotating, revoke existing console sessions from /admin/security so a token minted',
      'with the previous secret cannot keep working.',
  )
  process.exit(0)
}

const build = (passcode) => {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(passcode.normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: MAXMEM }).toString('hex')
  return 'scrypt$' + N + '$' + r + '$' + p + '$' + salt + '$' + hash
}

// Re-derive from the exact string we are about to print, so a parameter mismatch is caught here
// and not at 2am by someone who cannot sign in.
const check = (passcode, verifier) => {
  const parts = verifier.split('$')
  const salt = parts[4]
  const expected = parts[5]
  const candidate = scryptSync(passcode.normalize('NFKC'), salt, expected.length / 2, {
    N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), maxmem: MAXMEM,
  }).toString('hex')
  return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'))
}

const readPiped = () =>
  new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
      if (data.length > 4096) reject(new Error('passcode is suspiciously long'))
    })
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')))
    process.stdin.on('error', reject)
  })

/** Raw-mode prompt that never echoes characters, so the passcode does not end up in a terminal log. */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    process.stdout.write(prompt)
    if (!stdin.isTTY) {
      readPiped().then(resolve, reject)
      return
    }
    let value = ''
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (char === CTRL_C) {
          process.stdout.write('\n')
          process.exit(130)
        }
        if (char === BACKSPACE || char === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += char
      }
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    stdin.on('data', onData)
  })
}

async function main() {
  const argIndex = process.argv.indexOf('--passcode')
  if (argIndex >= 0 && process.argv[argIndex + 1]) {
    console.error('note: --passcode puts the secret in your shell history; prefer the prompt')
  }

  const first = argIndex >= 0 ? process.argv[argIndex + 1] : await readHidden('Admin passcode (not echoed): ')
  if (!first || first.length < 12) {
    console.error('FAIL: a console passcode must be at least 12 characters.')
    console.error('      16+ with mixed case, digits and symbols is the target - it guards payouts.')
    process.exit(1)
  }
  if (argIndex < 0) {
    const again = await readHidden('Repeat it: ')
    if (again !== first) {
      console.error('FAIL: the two entries did not match.')
      process.exit(1)
    }
  }

  const verifier = build(first)
  if (!check(first, verifier)) {
    console.error('FAIL: the generated verifier did not re-derive; lib/security.ts may have changed.')
    console.error('      compare hashPasscode() with this script before deploying.')
    process.exit(1)
  }

  console.log('')
  console.log(verifier)
  console.log('')
  console.log('ADMIN_PASSWORD_SCRYPT="' + verifier + '"')
  console.log('')
  console.log('Next:')
  console.log('  1. set that in the deploy environment (Render env vars / secret store)')
  console.log('  2. confirm ADMIN_EMAILS lists exactly the operator addresses')
  console.log('  3. redeploy, sign in once, then revoke all sessions from /admin/security')
  console.log('  4. delete any ADMIN_PASSWORD / ADMIN_PASSWORD_SALT still in the environment')
}

main().catch((err) => {
  console.error('FAIL: ' + (err && err.message ? err.message : err))
  process.exit(1)
})
