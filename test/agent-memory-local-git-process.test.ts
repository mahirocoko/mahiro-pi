import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  localMemoryClaimPath,
  localMemoryCleanupAllowed,
  withLocalMemoryClaim,
} from '../lib/agent-memory/local/coordination.ts'
import { LocalGitUncertainty, runLocalGitProcess } from '../lib/agent-memory/local/git-process.ts'
import { gitMain, localGitEnvironment } from '../lib/agent-memory/local/git.ts'
import { createSyntheticLocalMemoryService } from '../lib/agent-memory/local/service.ts'

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'local-git-process-'))
  const root = join(dir, 'state')
  mkdirSync(root)
  return { dir, root, close: () => rmSync(dir, { recursive: true, force: true }) }
}
function run(cwd: string, argv: string[], capture?: { maxBytes: number; totalBytes: number }) {
  return runLocalGitProcess({
    cwd,
    argv,
    env: localGitEnvironment(join(cwd, 'identity')),
    allowedCodes: [0],
    capture,
  })
}

// Raw runner fixture only: service command owners cannot supply aliases or arbitrary argv.
function syntheticAlias(script: string): string[] {
  return ['-c', `alias.synthetic=!"${process.execPath}" -e '${script}'`, 'synthetic']
}

test('normal Git completion and nonzero close drain before releasing the claim', async () => {
  const fx = fixture()
  try {
    await withLocalMemoryClaim(fx.root, 'normal', async () => {
      const result = await run(fx.root, ['version'])
      assert.match(result.stdout.toString(), /^git version /)
      assert.equal(result.truncated, false)
      await assert.rejects(run(fx.root, ['not-a-command']), /Local Git failed/)
      assert.equal(localMemoryCleanupAllowed(), true)
    })
    assert.equal(existsSync(localMemoryClaimPath(fx.root)), false)
  } finally {
    fx.close()
  }
})

test('prefix capture drains the entire bounded output without interrupting the child', async () => {
  const fx = fixture()
  try {
    const result = await run(fx.root, syntheticAlias('process.stdout.write("x".repeat(200000))'), {
      maxBytes: 17,
      totalBytes: 200000,
    })
    assert.equal(result.stdout.toString(), 'x'.repeat(17))
    assert.equal(result.truncated, true)
  } finally {
    fx.close()
  }
})

for (const [label, script] of [
  ['stdout', 'process.stdout.write("x".repeat(1200000))'],
  ['stderr', 'process.stderr.write("x".repeat(100000))'],
] as const) {
  test(`${label} overflow retains the claim and blocks cleanup and reopen`, { timeout: 15000 }, async () => {
    const fx = fixture()
    try {
      const evidence = join(fx.root, 'repair.index')
      writeFileSync(evidence, 'retained')
      await assert.rejects(
        withLocalMemoryClaim(fx.root, 'overflow', async () => {
          try {
            await run(fx.root, syntheticAlias(script))
          } finally {
            if (localMemoryCleanupAllowed()) rmSync(evidence)
          }
        }),
        LocalGitUncertainty,
      )
      assert.equal(readFileSync(evidence, 'utf8'), 'retained')
      assert.equal(existsSync(localMemoryClaimPath(fx.root)), true)
      await assert.rejects(
        createSyntheticLocalMemoryService({ stateRoot: fx.root, worker() {} }),
        /claim blocked/,
      )
    } finally {
      fx.close()
    }
  })
}

test('timeout is uncertain even after child termination; claim and evidence remain', {
  timeout: 15000,
}, async () => {
  const fx = fixture()
  try {
    // Helper self-exits at 10.5 seconds even if its shell outlives direct Git termination.
    // This deliberately does not claim universal helper-tree settlement.
    await assert.rejects(
      withLocalMemoryClaim(fx.root, 'timeout', async () => {
        await run(fx.root, syntheticAlias('setTimeout(() => {}, 10500)'))
      }),
      /uncertain \(timeout\)/,
    )
    assert.equal(existsSync(localMemoryClaimPath(fx.root)), true)
    await assert.rejects(
      withLocalMemoryClaim(fx.root, 'later', async () => {}),
      /claim blocked/,
    )
  } finally {
    fx.close()
  }
})

test('callback-reported uncertainty also retains ownership and original running evidence', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.root,
      initialFiles: { 'Core.md': 'base\n' },
      worker() {
        throw new LocalGitUncertainty('synthetic callback boundary')
      },
    })
    await service.enqueue({ id: 'one', summary: 'one' })
    await assert.rejects(service.start('one'), LocalGitUncertainty)
    assert.equal(JSON.parse(readFileSync(join(fx.root, 'jobs/one.json'), 'utf8')).status, 'running')
    assert.equal(existsSync(join(fx.root, 'ownership/one.json')), true)
    assert.equal(existsSync(join(fx.root, 'worktrees/one')), true)
    await assert.rejects(service.cleanup(join(fx.root, 'worktrees/one')), /claim blocked/)
  } finally {
    fx.close()
  }
})

test('service Git refuses helper-bearing repository config and disables all transports', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.root,
      initialFiles: { 'Core.md': 'base\n' },
      worker() {},
    })
    const bare = join(fx.root, 'canonical.git')
    const path = join(bare, 'config')
    const config = readFileSync(path, 'utf8')
    for (const extra of [
      '[include]\npath = /synthetic/not-read\n',
      '[remote "origin"]\nurl = https://example.invalid/never\n',
      '[filter "unsafe"]\nclean = false\n',
    ]) {
      writeFileSync(path, config + extra)
      await assert.rejects(service.head(), /configuration refused/)
    }
    writeFileSync(path, config)
    assert.match(await service.head(), /^[a-f0-9]{40,64}$/)
    const env = localGitEnvironment(join(fx.root, 'git-identity'))
    assert.equal(env.GIT_ALLOW_PROTOCOL, '')
    assert.equal(env.GIT_NO_LAZY_FETCH, '1')
    const refused = await runLocalGitProcess({
      cwd: fx.root,
      env,
      argv: ['ls-remote', 'file:///synthetic/not-read'],
      allowedCodes: [128],
    })
    assert.equal(refused.code, 128)
    assert.match(
      await gitMain({
        bare,
        env,
        hooksPath: join(fx.root, 'empty-hooks'),
        identityPath: join(fx.root, 'git-identity'),
      }),
      /^[a-f0-9]{40,64}$/,
    )
  } finally {
    fx.close()
  }
})
