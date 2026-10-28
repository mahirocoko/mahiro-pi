import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertSecretPaths, isSecretPath } from '../lib/guards/secret-paths.mjs'
import { createFilteredTools, __testing as filtered } from '../lib/guards/filtered-config.mjs'
import { createGuardHost } from '../lib/guards/host.mjs'

test('lightweight secret rules inspect actual file operands, not content or query strings', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'thin-secret-paths-'))
  try {
    writeFileSync(join(cwd, 'public.txt'), 'public')
    for (const path of [
      '.env',
      '.env.local',
      '.npmrc',
      '.pypirc',
      'id_ed25519',
      'auth.json',
      'private.pem',
    ]) {
      assert.equal(isSecretPath(join(cwd, path)), true)
      assert.throws(() => assertSecretPaths('read', { path }, cwd), /Secret file read blocked/)
    }
    assert.doesNotThrow(() => assertSecretPaths('grep', { path: 'public.txt', pattern: '.env' }, cwd))
    assert.doesNotThrow(() =>
      assertSecretPaths('write', { path: 'public.txt', content: '.env auth.json' }, cwd),
    )
    assert.doesNotThrow(() => assertSecretPaths('mh_env_config', { path: '.env' }, cwd))
    writeFileSync(join(cwd, '.env'), 'FIXTURE_ONLY=not-a-real-secret')
    symlinkSync(join(cwd, '.env'), join(cwd, 'alias.txt'))
    assert.throws(() => assertSecretPaths('read', { path: 'alias.txt' }, cwd), /Secret file alias/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('standalone filtered helpers preserve upstream payloads without loading its checker', async () => {
  // Computed test-only import keeps the frozen oracle outside the compiler program.
  const oracle = new URL('./oracles/letta/mahiro-secret-read-guard.js', import.meta.url)
  const { __testing: upstream } = await import(oracle.href)
  const cwd = mkdtempSync(join(tmpdir(), 'thin-filtered-'))
  try {
    const inputs = [
      [
        '.npmrc',
        'registry=https://registry.npmjs.org/\n_authToken=fixture-secret\nstrict-ssl=true\n',
        'runNpmConfig',
      ],
      ['.env', 'FIXTURE_TOKEN=fixture-secret\nEMPTY=\n', 'runEnvConfig'],
      [
        '.pypirc',
        '[distutils]\nindex-servers=pypi\n[pypi]\nrepository=https://upload.pypi.org/legacy/\npassword=fixture-secret\n',
        'runPypiConfig',
      ],
    ] as const
    for (const [path, content, method] of inputs) {
      writeFileSync(join(cwd, path), content)
      const context = { cwd, args: { path } }
      const result = await filtered[method](context)
      assert.deepEqual(result, await upstream[method](context))
      assert.equal(result.status, 'success')
      assert.doesNotMatch(JSON.stringify(result), /fixture-secret/)
    }
    writeFileSync(
      join(cwd, 'private.pem'),
      '-----BEGIN PRIVATE KEY-----\nfixture-secret\n-----END PRIVATE KEY-----',
    )
    const certContext = { cwd, args: { path: 'private.pem' } }
    assert.deepEqual(
      await filtered.runCertificateInfo(certContext),
      await upstream.runCertificateInfo(certContext),
    )
    assert.doesNotMatch(JSON.stringify(await filtered.runCertificateInfo(certContext)), /fixture-secret/)
    const lifetime = new AbortController()
    const tools = createFilteredTools(lifetime.signal)
    assert.equal(tools.size, 4)
    lifetime.abort()
    assert.deepEqual(await tools.get('mh_env_config')!.run({ cwd, args: { path: '.env' } }), {
      status: 'error',
      error: 'Operation aborted.',
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('thin host combines path rules, filtered inspection and commit lifetime', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'thin-host-'))
  const host = createGuardHost()
  try {
    assert.equal(host.healthy, true)
    assert.equal(host.tools.size, 4)
    await assert.rejects(host.finalArgs('read', { path: '.env' }, { cwd }), /Secret file read blocked/)
    assert.deepEqual(await host.finalArgs('read', { path: 'public.txt' }, { cwd }), { path: 'public.txt' })
    host.dispose()
    assert.equal(host.healthy, false)
    await assert.rejects(host.finalArgs('read', { path: 'public.txt' }, { cwd }), /generation disposed/)
  } finally {
    host.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
})
