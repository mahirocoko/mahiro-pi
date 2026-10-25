import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { trustedNativeMcpTool } from './legacy-owned-provenance.mjs'

test('owned provenance binds metadata once per Root generation but validates fresh source each call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'owned-provenance-'))
  try {
    mkdirSync(join(root, 'extensions'))
    const entry = './extensions/mahiro-agent-memory.ts'
    writeFileSync(join(root, entry), '// fixture\n')
    const manifest = (version, extensions = [entry]) =>
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: '@mahirocoko/mahiro-pi', version, pi: { extensions } }),
      )
    manifest('old')
    const source = readFileSync(new URL('./legacy-owned-provenance.mjs', import.meta.url), 'utf8').replace(
      "fileURLToPath(new URL('../../../', import.meta.url))",
      JSON.stringify(root),
    )
    const module = join(root, 'owned.mjs')
    writeFileSync(module, source)
    const { createOwnedProvenance } = await import(pathToFileURL(module))
    const old = createOwnedProvenance('old')
    const tool = {
      name: 'agent_memory_manage',
      sourceInfo: {
        origin: 'package',
        scope: 'user',
        baseDir: root,
        path: join(root, entry),
      },
    }
    assert.equal(old.trustedMemoryTool(tool), true)
    manifest('new')
    assert.equal(old.trustedMemoryTool(tool), true, 'source upgrade does not revoke loaded identity')
    assert.equal(
      createOwnedProvenance().trustedMemoryTool(tool),
      true,
      'version is compatibility metadata, not authority',
    )
    const fresh = createOwnedProvenance('new')
    assert.equal(fresh.trustedMemoryTool(tool), true)
    for (const validator of [old, fresh]) {
      assert.equal(validator.trustedMemoryTool({ ...tool, name: 'invented' }), false)
      assert.equal(
        validator.trustedMemoryTool({ ...tool, sourceInfo: { ...tool.sourceInfo, path: module } }),
        false,
      )
      assert.equal(
        validator.trustedMemoryTool({ ...tool, sourceInfo: { ...tool.sourceInfo, baseDir: tmpdir() } }),
        true,
        'host resource baseDir is not an author-checkout pin',
      )
      assert.equal(
        validator.trustedMemoryTool({ ...tool, sourceInfo: { ...tool.sourceInfo, origin: 'top-level' } }),
        true,
      )
    }
    manifest('new', [])
    const withdrawn = createOwnedProvenance('new')
    assert.equal(withdrawn.trustedMemoryTool(tool), false)
    assert.equal(fresh.trustedMemoryTool(tool), true, 'loaded manifest remains generation-local')
    writeFileSync(join(root, 'package.json'), '{}')
    assert.throws(() => createOwnedProvenance(), /loaded resource manifest unavailable/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('native MCP continues to use fresh registry identity, exposure and withdrawal', () => {
  const tool = {
    name: `mcp_${'opaque'.repeat(50)}`,
    exposure: 'direct',
    sourceInfo: {
      path: 'builtin:mcp',
      source: 'builtin',
      origin: 'top-level',
      scope: 'temporary',
    },
  }
  const event = { toolName: tool.name }
  assert.equal(trustedNativeMcpTool([tool], [tool.name], event), true)
  assert.equal(trustedNativeMcpTool([], [tool.name], event), false)
  assert.equal(trustedNativeMcpTool([tool, tool], [tool.name], event), false)
  assert.equal(trustedNativeMcpTool([tool], [], event), false)
  assert.equal(
    trustedNativeMcpTool([{ ...tool, exposure: 'model-only' }], [tool.name], {
      ...event,
      parentToolCallId: 'nested',
    }),
    false,
  )
})
