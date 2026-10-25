import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

// Real disposable filesystem aliases/upgrade, not fabricated realpath answers.
test('loaded registered entries survive version upgrades and removed physical aliases; withdrawal is fresh', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'guard-friction-'))
  try {
    const root = join(fixture, 'package')
    const installed = join(fixture, 'installed')
    mkdirSync(join(root, 'extensions'), { recursive: true })
    mkdirSync(installed)
    const entry = './extensions/mahiro-agent-memory.ts'
    writeFileSync(join(root, entry), '// real declared entry\n')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@mahirocoko/mahiro-pi',
        version: 'future-compatible',
        pi: { extensions: [entry] },
      }),
    )
    symlinkSync(join(root, entry), join(installed, 'memory.ts'))
    const source = readFileSync(new URL('./legacy-owned-provenance.mjs', import.meta.url), 'utf8').replace(
      "fileURLToPath(new URL('../../../', import.meta.url))",
      JSON.stringify(root),
    )
    const module = join(root, 'owned.mjs')
    writeFileSync(module, source)
    const { createOwnedProvenance } = await import(pathToFileURL(module))
    const tool = {
      name: 'agent_memory_manage',
      sourceInfo: {
        origin: 'top-level',
        scope: 'user',
        source: join(installed, 'memory.ts'),
        path: join(installed, 'memory.ts'),
        baseDir: installed,
      },
    }
    let tools = [tool]
    const bound = createOwnedProvenance({ getTools: () => tools })
    assert.equal(bound.trustedMemoryTool(tool), true, 'actual installed entry, not package-only source')
    renameSync(root, join(fixture, 'moved-package'))
    assert.equal(bound.trustedMemoryTool(tool), true, 'loaded identity is not later disk realpath')
    tools = []
    assert.equal(bound.trustedMemoryTool(tool), false, 'withdrawal is not cached authority')
    tools = [{ ...tool, sourceInfo: { ...tool.sourceInfo, path: join(fixture, 'foreign.ts') } }]
    assert.equal(bound.trustedMemoryTool(tool), false, 'old binding cannot impersonate current registry')
    assert.equal(bound.trustedMemoryTool(tools[0]), false, 'foreign current entry is not authority')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('importing meta classifier without any subagents dependency still supports unrelated classification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'guard-no-subagents-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ pi: { extensions: [] } }))
    writeFileSync(
      join(root, 'legacy-owned-provenance.mjs'),
      readFileSync(new URL('./legacy-owned-provenance.mjs', import.meta.url), 'utf8').replace(
        "fileURLToPath(new URL('../../../', import.meta.url))",
        JSON.stringify(root),
      ),
    )
    writeFileSync(
      join(root, 'legacy-provenance.mjs'),
      readFileSync(new URL('./legacy-provenance.mjs', import.meta.url)),
    )
    const { trustedMetaTool } = await import(pathToFileURL(join(root, 'legacy-provenance.mjs')))
    assert.equal(trustedMetaTool({ name: 'read' }), false)
    assert.equal(
      trustedMetaTool({
        name: 'subagent',
        sourceInfo: {
          origin: 'package',
          scope: 'user',
          path: join(root, 'absent.ts'),
        },
      }),
      false,
      'only the actual subagent family is unavailable',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
