import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { releasePreflight } from '../check-release-preflight.mjs'

const outputs: Record<string, string> = {
  bun: '1.3.11\n',
  fd: 'fd 10.5.2\n',
  rg: 'ripgrep 15.1.0\n',
}
const run = (command: string) => ({ status: 0, stdout: outputs[command] ?? '' })

test('release preflight accepts supported Node versions and reports actual executable/tools', () => {
  for (const nodeVersion of ['22.19.0', '22.23.4', '24.0.0', '26.13.0']) {
    const result = releasePreflight({ nodeVersion, nodeExecutable: '/public/node', run })
    assert.equal(result.ok, true)
    assert.equal(result.checks[0].command, '/public/node')
    assert.equal(result.checks[0].version, nodeVersion)
    assert.deepEqual(
      result.checks.slice(1).map((check) => check.command),
      ['bun', 'fd', 'rg'],
    )
  }
})

test('release preflight rejects unsupported or malformed Node versions', () => {
  for (const nodeVersion of ['20.19.0', '22.18.9', 'invalid']) {
    const result = releasePreflight({ nodeVersion, run })
    assert.equal(result.ok, false)
    assert.equal(result.checks[0].ok, false)
  }
})

test('release preflight accepts the upstream-supported fdfind alias', () => {
  const result = releasePreflight({
    run: (command: string) =>
      command === 'fdfind'
        ? { status: 0, stdout: 'fdfind 10.5.2\n' }
        : command === 'fd'
          ? { status: 1, stdout: '' }
          : run(command),
  })
  assert.equal(result.ok, true)
  assert.equal(result.checks[2].command, 'fdfind')
})

test('release preflight reports all unavailable tools without accepting bad output or failed probes', () => {
  const result = releasePreflight({
    run: (command: string) =>
      command === 'bun'
        ? { status: 0, stdout: 'unexpected output' }
        : { status: 1, stdout: outputs[command] ?? '' },
  })
  assert.equal(result.ok, false)
  assert.deepEqual(
    result.checks.filter((check) => !check.ok).map((check) => check.name),
    ['Bun', 'fd', 'ripgrep'],
  )
  const timedOut = releasePreflight({
    run: () => ({ status: null, stdout: '', error: new Error('timeout') }),
  })
  assert.equal(timedOut.ok, false)
})

test('real CLI fails early on missing PATH tools, with no package-manager or download fallback', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../check-release-preflight.mjs', import.meta.url))],
    {
      env: { ...process.env, PATH: '' },
      encoding: 'utf8',
      timeout: 10000,
    },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /MISSING Bun/)
  assert.match(result.stdout, /MISSING fd/)
  assert.match(result.stdout, /MISSING ripgrep/)
  assert.match(result.stderr, /No suites, downloads or profile changes were started/)
})

test('release script keeps all existing tiers after preflight and SDK wrappers explicitly request TAP', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(
    manifest.scripts['check:release'],
    'pnpm check:release:preflight && pnpm check:fast && pnpm check:source && pnpm check:public-sdk && pnpm check:state',
  )
  for (const name of ['own-ui', 'usage']) {
    const source = readFileSync(new URL(`../lib/guards/test/${name}-patch-test.mjs`, import.meta.url), 'utf8')
    assert.match(source, /'--test-reporter=tap'/)
    assert.match(source, /# pass 1/)
  }
})
