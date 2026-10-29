import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { canonicalGitDirectoryName, localGitIdentity } from '../lib/agent-memory/local/contracts.ts'
import { localProjectionLimits, type LocalMemoryPrompt } from '../lib/agent-memory/local/projection.ts'
import { createSyntheticLocalMemoryService, type LocalWorker } from '../lib/agent-memory/local/service.ts'

const coreText = 'base <core>\n'
const indexText = 'see "index"\n'

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-local-projection-'))
  const stateRoot = join(dir, 'state')
  const hooks = join(dir, 'hooks')
  mkdirSync(stateRoot, { mode: 0o700 })
  mkdirSync(hooks, { mode: 0o700 })
  const bare = () => join(stateRoot, canonicalGitDirectoryName)
  const git = (args: string[], input?: string | Buffer, index?: string) =>
    execFileSync(
      'git',
      [
        '--git-dir',
        bare(),
        '-c',
        `core.hooksPath=${hooks}`,
        '-c',
        'credential.helper=',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Synthetic Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        ...args,
      ],
      {
        input,
        encoding: 'utf8',
        env: { ...process.env, ...(index ? { GIT_INDEX_FILE: index } : {}) },
      },
    ).trim()
  return {
    dir,
    stateRoot,
    bare,
    git,
    close() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function seedFiles(): Record<string, string> {
  const files: Record<string, string> = {
    'Core.md': coreText,
    'index.md': indexText,
    'system/persona.md': 'persona\n',
    'system/human/prefs.md': 'human-detail\n',
    'projects/demo/system/overview.md': 'overview-demo\n',
    'projects/other/system/overview.md': 'overview-other\n',
  }
  for (let index = 0; index < 33; index += 1)
    files[`box/f${String(index).padStart(2, '0')}.md`] = `box-${index}\n`
  return files
}

async function rejects(promise: Promise<unknown>, message: string, hidden?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, message)
    if (hidden) assert.equal(error.message.includes(hidden), false)
    return true
  })
}

function coreOf(projection: LocalMemoryPrompt): string {
  const file = projection.files.find((entry) => entry.path === 'Core.md')
  assert.ok(file)
  return file.text
}

test('committed projection is bounded, exact, and leaves detail deferred', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: seedFiles(),
      worker: () => {},
    })
    const first = await service.compilePrompt()
    const second = await service.compilePrompt()
    assert.equal(first.prompt, second.prompt)
    assert.equal(first.replyBytes, Buffer.byteLength(first.prompt))
    assert.ok(first.replyBytes <= localProjectionLimits.maxReplyBytes)
    assert.equal(first.prompt.includes(fx.stateRoot), false)
    assert.deepEqual(
      first.files.map((file) => file.path),
      ['Core.md', 'index.md', 'system/persona.md'],
    )
    assert.equal(
      first.files.every((file) => file.truncated === false),
      true,
    )
    const parsed = JSON.parse(first.prompt) as Pick<LocalMemoryPrompt, 'commit' | 'files' | 'deferred'>
    assert.equal(parsed.commit, first.commit)
    assert.equal(parsed.files[0].text, coreText)
    assert.equal(parsed.files[1].text, indexText)
    assert.equal(first.prompt.includes('human-detail'), false)
    assert.equal(first.prompt.includes('overview-demo'), false)
    assert.equal(first.prompt.includes('overview-other'), false)
    assert.equal(first.prompt.includes('box-0'), false)
    assert.equal(first.deferred.total, 36)
    assert.equal(first.deferred.paths.length, 32)
    assert.equal(first.deferred.truncated, true)
    assert.equal(first.deferred.paths[0], 'box/f00.md')
    assert.equal(first.deferred.paths[31], 'box/f31.md')
    assert.equal(first.absent.length, 0)

    const scoped = await service.compilePrompt({ project: 'demo' })
    assert.deepEqual(
      scoped.files.map((file) => file.path),
      ['Core.md', 'index.md', 'system/persona.md', 'projects/demo/system/overview.md'],
    )
    assert.equal(scoped.files[3].text, 'overview-demo\n')
    assert.deepEqual(scoped.absent, ['projects/demo/system/conventions.md'])
    assert.equal(scoped.prompt.includes('overview-other'), false)
    assert.equal(scoped.deferred.paths.includes('projects/other/system/overview.md'), false)
    assert.equal(scoped.deferred.total, 34)

    const human = await service.readMemory({ path: 'system/human/prefs.md' })
    assert.equal(human.commit, first.commit)
    assert.equal(human.text, 'human-detail\n')
    assert.equal(human.truncated, false)
    const owned = await service.readMemory({
      path: 'projects/demo/system/overview.md',
      project: 'demo',
    })
    assert.equal(owned.text, 'overview-demo\n')
    await rejects(
      service.readMemory({ path: 'projects/other/system/overview.md', project: 'demo' }),
      'Local memory path refused',
      fx.stateRoot,
    )

    const root = await service.listMemory()
    assert.deepEqual(
      root.entries.map((entry) => [entry.path, entry.kind]),
      [
        ['Core.md', 'file'],
        ['box', 'directory'],
        ['index.md', 'file'],
        ['projects', 'directory'],
        ['system', 'directory'],
      ],
    )
    assert.equal(root.truncated, false)
    assert.equal(root.nextOffset, undefined)
    const projects = await service.listMemory({ path: 'projects', project: 'demo' })
    assert.deepEqual(projects.entries, [{ path: 'projects/demo', kind: 'directory' }])
    const page = await service.listMemory({ path: 'box', limit: 100 })
    assert.equal(page.limit, localProjectionLimits.directoryPage)
    assert.equal(page.total, 33)
    assert.equal(page.truncated, true)
    assert.equal(page.nextOffset, 32)
    assert.deepEqual(
      page.entries.map((entry) => entry.path),
      Array.from({ length: 32 }, (_, index) => `box/f${String(index).padStart(2, '0')}.md`),
    )
    const rest = await service.listMemory({ path: 'box', offset: 32 })
    assert.equal(rest.truncated, false)
    assert.equal(rest.nextOffset, undefined)
    assert.deepEqual(rest.entries, [{ path: 'box/f32.md', kind: 'file' }])
    const boundary = await service.listMemory({ path: 'box', offset: 33 })
    assert.deepEqual(boundary.entries, [])
    assert.equal(boundary.truncated, false)
    await rejects(service.listMemory({ path: 'box', offset: 34 }), 'Local memory path refused', fx.stateRoot)
  } finally {
    fx.close()
  }
})

test('file reads truncate on an explicit byte cap without splitting a character', async () => {
  const fx = fixture()
  try {
    const prefix = 'x'.repeat(8191)
    const edge = `${prefix}กyyyy`
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: {
        'Core.md': 'C'.repeat(9000),
        'index.md': 'index\n',
        'edge.md': edge,
      },
      worker: () => {},
    })
    const projection = await service.compilePrompt()
    const core = projection.files[0]
    assert.equal(core.bytes, 9000)
    assert.equal(core.truncated, true)
    assert.equal(core.returnedBytes, localProjectionLimits.maxPromptFileBytes)
    assert.equal(core.text, 'C'.repeat(localProjectionLimits.maxPromptFileBytes))
    assert.equal(JSON.parse(projection.prompt).files[0].text, core.text)
    const read = await service.readMemory({ path: 'edge.md' })
    assert.equal(read.text, prefix)
    assert.equal(read.returnedBytes, 8191)
    assert.equal(read.bytes, Buffer.byteLength(edge))
    assert.equal(read.truncated, true)
    const narrow = await service.readMemory({ path: 'index.md', limit: 4 })
    assert.equal(narrow.text, 'inde')
    assert.equal(narrow.limit, 4)
    assert.equal(narrow.truncated, true)
    const wide = await service.readMemory({ path: 'index.md', limit: 100000 })
    assert.equal(wide.limit, localProjectionLimits.maxReadBytes)
    assert.equal(wide.text, 'index\n')
    assert.equal(wide.truncated, false)
    const end = await service.readMemory({ path: 'index.md', offset: wide.bytes })
    assert.equal(end.text, '')
    assert.equal(end.truncated, false)
    await rejects(
      service.readMemory({ path: 'index.md', offset: wide.bytes + 1 }),
      'Local memory path refused',
      fx.stateRoot,
    )
    await rejects(
      service.readMemory({ path: 'index.md', limit: 0 }),
      'Local memory path refused',
      fx.stateRoot,
    )
  } finally {
    fx.close()
  }
})

test('an unintegrated worktree stays unpublished and the next compile sees the new commit', async () => {
  const fx = fixture()
  try {
    const worker: LocalWorker = (ctx) => {
      ctx.write('Core.md', 'published-core\n')
    }
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker,
    })
    await service.enqueue({ id: 'learn', summary: 'publish core' })
    const committed = await service.start('learn')
    assert.equal(committed.status, 'committed')
    assert.ok(committed.worktreePath)
    writeFileSync(join(committed.worktreePath, 'Core.md'), 'dirty-worktree\n')
    writeFileSync(join(committed.worktreePath, 'sneaky.md'), 'sneaky\n')
    const before = await service.compilePrompt()
    const saved = before.prompt
    assert.equal(coreOf(before), 'base\n')
    assert.equal(saved.includes('published-core'), false)
    assert.equal(saved.includes('dirty-worktree'), false)
    assert.equal(saved.includes('sneaky'), false)
    const integrated = await service.integrate('learn')
    assert.equal(integrated.status, 'integrated')
    assert.equal(before.prompt, saved)
    const after = await service.compilePrompt()
    assert.equal(coreOf(after), 'published-core\n')
    assert.notEqual(after.prompt, saved)
    assert.equal(after.files.find((file) => file.path === 'index.md')?.text, 'index\n')
    const reopened = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      worker: () => {
        throw Error('worker re-entered')
      },
    })
    const restarted = await reopened.compilePrompt()
    assert.equal(restarted.commit, after.commit)
    assert.equal(restarted.prompt, after.prompt)
  } finally {
    fx.close()
  }
})

test('a projection stays on the commit captured before a concurrent ref update', async () => {
  const fx = fixture()
  try {
    let armed = false
    let flipTo = ''
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      injection: {
        afterCommitResolved: () => {
          if (!armed) return
          fx.git(['update-ref', 'refs/heads/main', flipTo])
          armed = false
        },
      },
      worker: (ctx) => {
        ctx.write('Core.md', 'published-core\n')
        ctx.write('notes.md', 'published-note\n')
      },
    })
    const commitA = await service.head()
    await service.enqueue({ id: 'learn', summary: 'publish note' })
    await service.integrate((await service.start('learn')).id)
    const commitB = await service.head()
    assert.notEqual(commitA, commitB)
    fx.git(['update-ref', 'refs/heads/main', commitA])
    armed = true
    flipTo = commitB
    const during = await service.compilePrompt()
    assert.equal(during.commit, commitA)
    assert.equal(coreOf(during), 'base\n')
    assert.equal(during.prompt.includes('published-core'), false)
    assert.equal(during.prompt.includes('published-note'), false)
    fx.git(['update-ref', 'refs/heads/main', commitA])
    armed = true
    flipTo = commitB
    const read = await service.readMemory({ path: 'Core.md' })
    assert.equal(read.commit, commitA)
    assert.equal(read.text, 'base\n')
    const next = await service.compilePrompt()
    assert.equal(next.commit, commitB)
    assert.equal(coreOf(next), 'published-core\n')
    assert.equal(next.deferred.paths.includes('notes.md'), true)
  } finally {
    fx.close()
  }
})

test('hostile paths and non-regular entries fail closed without exposing targets', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: () => {},
    })
    for (const path of [
      '../Core.md',
      'box/../../Core.md',
      '/tmp/Core.md',
      'C:/Core.md',
      'box\\Core.md',
      'a\0b',
    ])
      await rejects(service.readMemory({ path }), 'Local memory path refused', fx.stateRoot)
    await rejects(service.readMemory({ path: 'missing.md' }), 'Local memory path refused', fx.stateRoot)
    await rejects(service.listMemory({ path: 'missing-dir' }), 'Local memory path refused', fx.stateRoot)
    await rejects(service.readMemory({ path: 'Core.md', project: 'Other' }), 'Local memory project refused')

    const head = await service.head()
    const index = join(fx.dir, 'special.index')
    const linkBlob = fx.git(['hash-object', '-w', '--stdin'], 'SYMLINK-TARGET\n')
    const execBlob = fx.git(['hash-object', '-w', '--stdin'], 'EXEC-BYTES\n')
    const badBlob = fx.git(['hash-object', '-w', '--stdin'], Buffer.from([0xff, 0xfe]))
    fx.git(['read-tree', head], undefined, index)
    fx.git(['update-index', '--add', '--cacheinfo', `120000,${linkBlob},link.md`], undefined, index)
    fx.git(['update-index', '--add', '--cacheinfo', `100755,${execBlob},exec.md`], undefined, index)
    fx.git(['update-index', '--add', '--cacheinfo', `160000,${head},vendor`], undefined, index)
    fx.git(['update-index', '--add', '--cacheinfo', `100644,${badBlob},bad.md`], undefined, index)
    const tree = fx.git(['write-tree'], undefined, index)
    const next = fx.git(['commit-tree', tree, '-p', head, '-m', 'special entries'])
    fx.git(['update-ref', 'refs/heads/main', next])

    const listed = await service.listMemory()
    assert.equal(listed.entries.find((entry) => entry.path === 'link.md')?.kind, 'symlink')
    assert.equal(listed.entries.find((entry) => entry.path === 'exec.md')?.kind, 'special')
    assert.equal(listed.entries.find((entry) => entry.path === 'vendor')?.kind, 'submodule')
    await rejects(service.readMemory({ path: 'link.md' }), 'Local memory path refused', fx.stateRoot)
    await rejects(service.readMemory({ path: 'exec.md' }), 'Local memory path refused', fx.stateRoot)
    await rejects(service.readMemory({ path: 'vendor' }), 'Local memory path refused', fx.stateRoot)
    await rejects(service.listMemory({ path: 'link.md' }), 'Local memory path refused', fx.stateRoot)
    await rejects(service.listMemory({ path: 'vendor' }), 'Local memory path refused', fx.stateRoot)
    await rejects(service.readMemory({ path: 'bad.md' }), 'Local memory read refused', fx.stateRoot)
    const projection = await service.compilePrompt()
    assert.equal(projection.prompt.includes('SYMLINK-TARGET'), false)
    assert.equal(projection.prompt.includes('EXEC-BYTES'), false)
    assert.equal(
      projection.blocked.paths.some((entry) => entry.path === 'link.md' && entry.kind === 'symlink'),
      true,
    )
    assert.equal(coreOf(projection), 'base\n')
  } finally {
    fx.close()
  }
})

test('replaced identity, a bad commit, and interrupted integration fail closed', async () => {
  const malformed = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: malformed.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: () => {},
    })
    const blob = malformed.git(['hash-object', '-w', '--stdin'], 'not-a-tree\n')
    writeFileSync(join(malformed.bare(), 'refs/heads/main'), `${blob}\n`)
    await rejects(service.compilePrompt(), 'Local Git object refused', malformed.stateRoot)
  } finally {
    malformed.close()
  }

  const replaced = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: replaced.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: () => {},
    })
    writeFileSync(join(replaced.stateRoot, 'git-identity'), 'replaced identity\n')
    await rejects(service.compilePrompt(), 'Local memory identity refused', replaced.stateRoot)
    writeFileSync(join(replaced.stateRoot, 'git-identity'), localGitIdentity)
    const metaPath = join(replaced.stateRoot, 'meta.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { nonce: string }
    meta.nonce = 'ab'.repeat(16)
    writeFileSync(metaPath, `${JSON.stringify(meta)}\n`)
    await rejects(
      service.readMemory({ path: 'Core.md' }),
      'Local memory repository refused',
      replaced.stateRoot,
    )
  } finally {
    replaced.close()
  }

  const interrupted = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: interrupted.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      injection: { stopAfter: 'commit' },
      worker: (ctx) => {
        ctx.write('Core.md', 'worktree-only\n')
      },
    })
    await service.enqueue({ id: 'partial', summary: 'partial edit' })
    const started = await service.start('partial')
    assert.equal(started.status, 'running')
    const during = await service.compilePrompt()
    assert.equal(coreOf(during), 'base\n')
    assert.equal(during.prompt.includes('worktree-only'), false)
    const reopened = await createSyntheticLocalMemoryService({
      stateRoot: interrupted.stateRoot,
      worker: () => {
        throw Error('worker re-entered')
      },
    })
    const after = await reopened.compilePrompt()
    assert.equal(after.prompt, during.prompt)
    assert.deepEqual(await reopened.readMemory({ path: 'Core.md' }), {
      commit: during.commit,
      path: 'Core.md',
      text: 'base\n',
      offset: 0,
      limit: localProjectionLimits.maxReadBytes,
      bytes: Buffer.byteLength('base\n'),
      returnedBytes: Buffer.byteLength('base\n'),
      truncated: false,
    })
  } finally {
    interrupted.close()
  }
})

test('a leading U+FEFF stays in the projection and in a paged read', async () => {
  const fx = fixture()
  try {
    const core = '\uFEFFbase\n'
    const paged = '\uFEFFpage\n'
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': core, 'index.md': 'index\n', 'mark.md': paged },
      worker: () => {},
    })
    const projection = await service.compilePrompt()
    const file = projection.files[0]
    assert.equal(file.text, core)
    assert.equal(file.bytes, Buffer.byteLength(core))
    assert.equal(file.returnedBytes, Buffer.byteLength(core))
    assert.equal(file.truncated, false)
    assert.equal(JSON.parse(projection.prompt).files[0].text, core)
    const whole = await service.readMemory({ path: 'mark.md' })
    assert.equal(whole.text, paged)
    assert.equal(whole.bytes, Buffer.byteLength(paged))
    assert.equal(whole.returnedBytes, Buffer.byteLength(paged))
    assert.equal(whole.truncated, false)
    const first = await service.readMemory({ path: 'mark.md', offset: 0, limit: 3 })
    assert.equal(first.text, '\uFEFF')
    assert.equal(first.returnedBytes, 3)
    assert.equal(first.bytes, Buffer.byteLength(paged))
    assert.equal(first.truncated, true)
    const rest = await service.readMemory({ path: 'mark.md', offset: 3 })
    assert.equal(rest.text, 'page\n')
    assert.equal(rest.returnedBytes, Buffer.byteLength('page\n'))
    assert.equal(rest.truncated, false)
  } finally {
    fx.close()
  }
})

test('a tree OID in main fails the three reads, and malformed records stay sanitized', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: () => {},
    })
    const commit = await service.head()
    const tree = fx.git(['rev-parse', `${commit}^{tree}`])
    writeFileSync(join(fx.bare(), 'refs/heads/main'), `${tree}\n`)
    assert.equal(await service.head(), tree)
    await rejects(service.compilePrompt(), 'Local Git object refused', fx.stateRoot)
    await rejects(service.readMemory({ path: 'Core.md' }), 'Local Git object refused', fx.stateRoot)
    await rejects(service.listMemory(), 'Local Git object refused', fx.stateRoot)
    writeFileSync(join(fx.bare(), 'refs/heads/main'), `${commit}\n`)

    const hidden = [fx.stateRoot, 'PROGRESS-EXCERPT-NOT-JSON', 'JOB-EXCERPT-NOT-JSON']
    const assertHidden = async (promise: Promise<unknown>) => {
      await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.message, 'Local memory read refused')
        for (const item of hidden) assert.equal(error.message.includes(item), false)
        return true
      })
    }
    writeFileSync(join(fx.stateRoot, 'progress', 'learn-1.json'), 'PROGRESS-EXCERPT-NOT-JSON')
    await assertHidden(service.compilePrompt())
    await assertHidden(service.readMemory({ path: 'Core.md' }))
    await assertHidden(service.listMemory())
    rmSync(join(fx.stateRoot, 'progress', 'learn-1.json'))
    writeFileSync(join(fx.stateRoot, 'jobs', 'learn-1.json'), 'JOB-EXCERPT-NOT-JSON')
    await assertHidden(service.compilePrompt())
    await assertHidden(service.readMemory({ path: 'Core.md' }))
    await assertHidden(service.listMemory())
    rmSync(join(fx.stateRoot, 'jobs', 'learn-1.json'))
    const live = await service.compilePrompt()
    assert.equal(coreOf(live), 'base\n')
    assert.equal((await service.readMemory({ path: 'Core.md' })).text, 'base\n')
    assert.equal(
      (await service.listMemory()).entries.some((entry) => entry.path === 'Core.md'),
      true,
    )
  } finally {
    fx.close()
  }
})

test('extension, kernel, installer, and profile sources do not import the projection', async () => {
  const root = join(import.meta.dirname, '..')
  const files: string[] = [join(root, 'lib/agent-memory/profile.ts')]
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      if (name === 'node_modules' || name === '.agent-state') continue
      const path = join(directory, name)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else if (/\.(ts|mjs|json|md)$/.test(name)) files.push(path)
    }
  }
  for (const directory of ['extensions', 'lib/kernel', 'lib/guards', 'agents']) walk(join(root, directory))
  for (const name of ['package.json', 'install.mjs', 'bootstrap.mjs']) files.push(join(root, name))
  const needles = ['local/projection', 'compileLocalMemoryPrompt', 'readLocalMemory', 'listLocalMemory']
  const hits = files.filter((path) => needles.some((needle) => readFileSync(path, 'utf8').includes(needle)))
  assert.deepEqual(hits, [])
  const source = readFileSync(join(root, 'lib/agent-memory/local/projection.ts'), 'utf8')
  for (const needle of [
    'node:fs',
    'node:child_process',
    'refs/heads/main',
    'MAHIRO_AGENT_MEMORY_ROOT',
    'worktree',
    'extensions/',
    'lib/kernel',
  ])
    assert.equal(source.includes(needle), false, needle)

  const fx = fixture()
  try {
    const secretRoot = join(fx.dir, 'private-root')
    mkdirSync(secretRoot, { mode: 0o700 })
    writeFileSync(join(secretRoot, 'Core.md'), 'PRIVATE-ROOT-SECRET\n')
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: () => {},
    })
    const projection = await service.compilePrompt()
    assert.equal(projection.prompt.includes('PRIVATE-ROOT-SECRET'), false)
    assert.equal(projection.prompt.includes(secretRoot), false)
  } finally {
    fx.close()
  }
})
