import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { applySetup, inspectSetup, planSetup, resolveAgentDir, setupTarget } from '../lib/setup.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtures = join(root, '.agent-state/runtime/setup-tests')
mkdirSync(fixtures, { recursive: true, mode: 0o700 })
const fixture = (run: (directory: string) => void) => {
  const directory = mkdtempSync(join(fixtures, 'case-'))
  try {
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
const seed = (directory: string, text: string) => {
  const target = setupTarget(directory)
  mkdirSync(join(directory, 'extensions/pi-permission-system'), {
    recursive: true,
    mode: 0o700,
  })
  writeFileSync(target, text, { mode: 0o600 })
  return target
}

test('setup pure plan creates only skill fragment; absent surface preserves unrelated policy semantics', () => {
  const plan = planSetup(null)
  assert.deepEqual(JSON.parse(plan.next), { permission: { skill: 'allow' } })
  assert.equal(plan.defaultSkillActivationConfigured, true)
  const original = {
    debugLog: false,
    yoloMode: false,
    permission: {
      '*': 'deny',
      read: {
        '*': 'ask',
        'private/*': { action: 'deny', reason: 'protected' },
      },
    },
    shellTools: {
      exec_command: { commandArgument: 'cmd', workdirArgument: 'cwd' },
    },
    permissionDialogKeys: { approve: '1', approveSessionBoth: '3' },
  }
  const next = JSON.parse(planSetup(JSON.stringify(original)).next)
  delete next.permission.skill
  assert.deepEqual(next, original)
})

test('setup retains scalar allow/ask/deny without writing or claiming restrictions ready', () => {
  for (const value of ['allow', 'ask', 'deny']) {
    const text = JSON.stringify({ permission: { skill: value } })
    const plan = planSetup(text)
    assert.equal(plan.next, text)
    assert.equal(plan.changed, false)
    assert.equal(plan.defaultSkillActivationConfigured, value === 'allow')
    assert.equal(plan.retainedRestrictionCount, value === 'allow' ? 0 : 1)
  }
})

test('setup prepends wildcard; preserves ordered exceptions, deny reasons and existing catchall', () => {
  const skill = {
    'dangerous-*': 'deny',
    'dangerous-safe': 'allow',
    special: { action: 'deny', reason: 'keep' },
  }
  const plan = planSetup(JSON.stringify({ permission: { skill } }))
  assert.deepEqual(Object.entries(JSON.parse(plan.next).permission.skill), [
    ['*', 'allow'],
    ...Object.entries(skill),
  ])
  assert.equal(plan.retainedRestrictionCount, 2)
  assert.equal(plan.defaultSkillActivationConfigured, false)
  for (const value of ['allow', 'ask', 'deny']) {
    const text = JSON.stringify({
      permission: { skill: { named: 'deny', '*': value } },
    })
    const kept = planSetup(text)
    assert.equal(kept.next, text)
    assert.equal(kept.existingCatchAllRetained, true)
  }
})

test('setup rejects malformed, oversized and unsupported config/schema', () => {
  for (const text of [
    '{',
    'null',
    '[]',
    '{"permission":null}',
    '{"permission":{"skill":true}}',
    '{"permission":{"skill":{"x":"yes"}}}',
    '{"permission":{"skill":{"x":{"action":"allow"}}}}',
    '{"permission":{"path_wrote":"deny"}}',
    '{"unknown":1}',
    '{"permission":{"skill":{"12":"deny"}}}',
    '{"yoloMode":"false"}',
    '{"permissionDialogKeys":{"session":"s"}}',
    ' '.repeat(1024 * 1024 + 1),
  ]) {
    assert.throws(() => planSetup(text))
  }
})

test('setup create, private backup, existing mode preservation and idempotent rerun', () =>
  fixture((directory) => {
    const first = applySetup(directory, inspectSetup(directory))
    const target = setupTarget(directory)
    assert.equal(first.backup, null)
    assert.equal(lstatSync(target).mode & 0o777, 0o600)
    const original = '{ "permission": {"*":"deny"}, "debugLog":false }\n'
    writeFileSync(target, original)
    chmodSync(target, 0o640)
    const receipt = applySetup(directory, inspectSetup(directory))
    assert.equal(readFileSync(receipt.backup!, 'utf8'), original)
    assert.equal(lstatSync(receipt.backup!).mode & 0o777, 0o600)
    assert.equal(lstatSync(target).mode & 0o777, 0o640)
    const files = readdirSync(join(directory, 'extensions/pi-permission-system'))
    const repeat = applySetup(directory, inspectSetup(directory))
    assert.equal(repeat.changed, false)
    assert.equal(repeat.backup, null)
    assert.deepEqual(readdirSync(join(directory, 'extensions/pi-permission-system')), files)
  }))

test('setup resolves explicit and native override without accessing a profile', () => {
  assert.equal(resolveAgentDir('/explicit', { PI_CODING_AGENT_DIR: '/override' }, '/isolated'), '/explicit')
  assert.equal(
    resolveAgentDir(undefined, { PI_CODING_AGENT_DIR: '~/custom' }, '/isolated'),
    '/isolated/custom',
  )
  assert.equal(resolveAgentDir(undefined, {}, '/isolated'), '/isolated/.pi/agent')
  for (const path of ['relative', '/root/../other', '/root/'])
    assert.throws(() => resolveAgentDir(path, {}, '/isolated'))
})

test('setup rejects symlink ancestors, dangling/target symlinks, directories, hardlinks and unsafe modes', () =>
  fixture((directory) => {
    const real = join(directory, 'real')
    mkdirSync(real)
    const alias = join(directory, 'alias')
    symlinkSync(real, alias)
    assert.throws(() => inspectSetup(alias), /Symlink/)
    const target = seed(real, '{}')
    const linked = join(directory, 'linked')
    linkSync(target, linked)
    assert.throws(() => inspectSetup(real), /Unsafe/)
    rmSync(linked)
    chmodSync(target, 0o666)
    assert.throws(() => inspectSetup(real), /Unsafe/)
    rmSync(target)
    symlinkSync(join(directory, 'missing'), target)
    assert.throws(() => inspectSetup(real), /Symlink/)
    rmSync(target)
    symlinkSync(linked, target)
    assert.throws(() => inspectSetup(real), /Symlink/)
    rmSync(target)
    mkdirSync(target)
    assert.throws(() => inspectSetup(real), /Unsafe/)
  }))

test('setup reviewed hash and pre-publication CAS never overwrite third-party changes', () =>
  fixture((directory) => {
    const target = seed(directory, '{}')
    const reviewed = inspectSetup(directory)
    writeFileSync(target, '{"debugLog":true}')
    assert.throws(() => applySetup(directory, reviewed), /stale/)
    const fresh = inspectSetup(directory)
    assert.throws(() =>
      applySetup(directory, fresh, {
        beforeCommit: () => writeFileSync(target, '{"debugLog":false}'),
      }),
    )
    assert.equal(readFileSync(target, 'utf8'), '{"debugLog":false}')
    assert.deepEqual(readdirSync(join(directory, 'extensions/pi-permission-system')), ['config.json'])
  }))

test('setup write failure cleans temporary, preserves original and reports recovery backup', () =>
  fixture((directory) => {
    const target = seed(directory, '{}')
    assert.throws(() =>
      applySetup(directory, inspectSetup(directory), {
        beforeWrite: () => {
          throw new Error('disk failure')
        },
      }),
    )
    assert.equal(readFileSync(target, 'utf8'), '{}')
    assert.deepEqual(readdirSync(join(directory, 'extensions/pi-permission-system')), ['config.json'])
    let writes = 0
    assert.throws(() =>
      applySetup(directory, inspectSetup(directory), {
        beforeWrite: () => {
          if (++writes === 2) throw new Error('backup failure')
        },
      }),
    )
    assert.deepEqual(readdirSync(join(directory, 'extensions/pi-permission-system')), ['config.json'])
    const reviewed = inspectSetup(directory)
    assert.throws(
      () =>
        applySetup(directory, reviewed, {
          beforeWrite: (path) => {
            if (path.endsWith('.bak')) writeFileSync(target, '{"debugLog":true}')
          },
        }),
      (error: Error & { receipt?: { backup: string } }) => {
        assert.ok(error.receipt?.backup)
        assert.equal(readFileSync(error.receipt!.backup, 'utf8'), '{}')
        return true
      },
    )
    assert.equal(readFileSync(target, 'utf8'), '{"debugLog":true}')
    assert.equal(
      readdirSync(join(directory, 'extensions/pi-permission-system')).some((name) => name.endsWith('.tmp')),
      false,
    )
  }))

test('setup rejects oversized or invalid UTF-8 files without writes', () =>
  fixture((directory) => {
    const target = seed(directory, ' '.repeat(1024 * 1024 + 1))
    assert.throws(() => inspectSetup(directory), /Unsafe/)
    writeFileSync(target, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]))
    assert.throws(() => inspectSetup(directory), /UTF-8/)
    assert.deepEqual(readdirSync(join(directory, 'extensions/pi-permission-system')), ['config.json'])
  }))

test('setup failure receipt reports residual truth when temporary cleanup fails', () =>
  fixture((directory) => {
    seed(directory, '{}')
    assert.throws(
      () =>
        applySetup(directory, inspectSetup(directory), {
          beforeCommit: () => {
            const parent = join(directory, 'extensions/pi-permission-system')
            const temporary = join(parent, readdirSync(parent).find((name) => name.endsWith('.tmp'))!)
            rmSync(temporary)
            mkdirSync(temporary)
            throw new Error('injected publication failure')
          },
        }),
      (
        error: Error & {
          receipt?: {
            residualTemporary: string
            publication: string
            changed: boolean
          }
        },
      ) => {
        assert.equal(error.receipt?.publication, 'not-published')
        assert.equal(error.receipt?.changed, false)
        assert.ok(lstatSync(error.receipt!.residualTemporary).isDirectory())
        return true
      },
    )
    assert.equal(readFileSync(setupTarget(directory), 'utf8'), '{}')
  }))

test('setup CLI previews by default; isolated HOME/override/apply/help/errors never load runtime', () =>
  fixture((directory) => {
    const home = join(directory, 'home')
    const agent = join(directory, 'override')
    mkdirSync(home)
    const env = {
      HOME: home,
      PATH: process.env.PATH,
      PI_CODING_AGENT_DIR: agent,
    }
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [resolve(root, 'setup.mjs'), ...args], {
        cwd: directory,
        env,
        encoding: 'utf8',
      })
    const preview = cli()
    assert.equal(preview.status, 0, preview.stderr)
    assert.equal(JSON.parse(preview.stdout).mode, 'plan')
    assert.equal(existsSync(agent), false)
    assert.equal(cli('--plan').status, 0)
    assert.equal(cli('--apply').status, 0)
    assert.equal(JSON.parse(readFileSync(setupTarget(agent), 'utf8')).permission.skill, 'allow')
    assert.deepEqual(readdirSync(home), [])
    const fallback = spawnSync(process.execPath, [resolve(root, 'setup.mjs'), '--plan'], {
      cwd: directory,
      env: { HOME: home, PATH: process.env.PATH },
      encoding: 'utf8',
    })
    assert.equal(fallback.status, 0, fallback.stderr)
    assert.deepEqual(readdirSync(home), [])
    assert.equal(cli('--help').status, 0)
    for (const args of [['--apply', '--plan'], ['--agent-dir'], ['--wat'], ['--agent-dir', 'relative']])
      assert.equal(cli(...args).status, 1)
    assert.equal(cli('--apply', '--agent-dir', join(directory, 'explicit')).status, 0)
    assert.equal(JSON.parse(cli('--plan').stdout).changed, false)
  }))
