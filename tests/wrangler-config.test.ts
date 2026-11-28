import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * `wrangler.jsonc` points `main` at `.open-next/worker.js`, which is **generated and gitignored**.
 *
 * Cloudflare's Workers Builds ran `npm run build` — which is plain `next build` and never writes
 * `.open-next/` — then failed to find the entry point, on every commit, with:
 *
 *     The entry-point file at ".open-next/worker.js" was not found.
 *
 * That is a config bug, not a code bug, so the TypeScript suite would never have caught it: the
 * app compiles, the tests pass, and the deploy step dies afterwards. These assertions pin the four
 * things that have to stay consistent for the Worker to be deployable from a clean checkout.
 */

const config = readFileSync('wrangler.jsonc', 'utf8')
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}

/** Strip comments so the config can be inspected as JSON. */
const stripped = config.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')

test('the worker entry point is generated, so the config must build it itself', () => {
  const parsed = JSON.parse(stripped) as { main?: string; build?: { command?: string } }

  assert.equal(parsed.main, '.open-next/worker.js', 'main should still be the OpenNext worker')

  // The whole bug: `npm run build` does not produce `main`.
  assert.notEqual(
    pkg.scripts.build,
    'opennextjs-cloudflare build',
    'npm run build must stay a plain Next build — `wrangler build` runs this script',
  )

  // So the config has to declare the step that does produce it.
  assert.ok(parsed.build?.command, 'wrangler.jsonc must declare a build command for a generated entry point')
  assert.match(
    String(parsed.build.command),
    /cf:build/,
    'the build command should call the OpenNext build, not duplicate it as an inline command',
  )
})

test('the declared build command is a real script, and it writes the entry point', () => {
  const parsed = JSON.parse(stripped) as { build?: { command?: string } }
  const command = String(parsed.build?.command ?? '')

  // `npm run cf:build` — extract the script it invokes and prove it exists.
  const invoked = command.match(/npm run ([\w:-]+)/)?.[1]
  assert.ok(invoked, `could not read a script name out of: ${command}`)
  assert.ok(pkg.scripts[invoked], `wrangler.jsonc calls "npm run ${invoked}", which package.json does not define`)

  // And that script must be the OpenNext build, since that is what emits `.open-next/worker.js`.
  assert.match(pkg.scripts[invoked]!, /opennextjs-cloudflare build/)
})

test('the entry point and assets are gitignored, which is why the build cannot be assumed', () => {
  const ignore = readFileSync('.gitignore', 'utf8')
  assert.match(ignore, /^\.open-next\//m, '.open-next/ must stay ignored — it is build output')
})

test('secrets stay out of the committed config', () => {
  // `vars` are public; credentials belong in `wrangler secret put`. A key landed here would be
  // baked into the Worker bundle and readable by anyone with deploy access.
  const parsed = JSON.parse(stripped) as { vars?: Record<string, unknown> }
  const names = Object.keys(parsed.vars ?? {})
  const suspicious = names.filter((name) => /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE/i.test(name))
  assert.deepEqual(suspicious, [], `these look like secrets and must not be in vars: ${suspicious.join(', ')}`)

  for (const name of names) {
    const value = String(parsed.vars![name])
    assert.ok(value.length < 200, `${name} has a long value — is that a secret?`)
  }
})
