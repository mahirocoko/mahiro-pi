import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import {
  adapterRoot,
  productRoot,
  permissionPatch,
  stagePermissionFixture,
} from './permission-patch-fixture.mjs'

async function ownerModule(stage) {
  const exports = {
    PermissionManager: 'policy/permission-manager.ts',
    PermissionResolver: 'policy/permission-resolver.ts',
    LocalPermissionsService: 'service/permissions-service.ts',
    SessionRules: 'session/session-rules.ts',
    ResolverServingPolicy: 'policy/serving-policy.ts',
    mostRestrictiveOf: 'policy/restrictiveness.ts',
  }
  const outfile = path.join(stage.permissions, 'owner-unit.mjs')
  await build({
    stdin: {
      contents: Object.entries(exports)
        .map(
          ([name, file]) =>
            `export {${name}} from ${JSON.stringify(path.join(stage.permissions, 'src', file))};`,
        )
        .join('\n'),
      resolveDir: stage.permissions,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile,
    plugins: [
      {
        name: 'owner-import-map',
        setup(builder) {
          builder.onResolve({ filter: /^#src\// }, ({ path: name }) => ({
            path: path.join(stage.permissions, 'src', `${name.slice(5)}.ts`),
          }))
        },
      },
    ],
  })
  return import(pathToFileURL(outfile).href)
}

function engine(mod) {
  let config = {},
    project = {},
    agent = {},
    stamp = 0,
    yolo = false
  const manager = new mod.PermissionManager({
    policyLoader: {
      loadGlobalConfig: () => config,
      loadProjectConfig: () => project,
      loadAgentConfig: () => agent,
      loadProjectAgentConfig: () => ({}),
      getConfiguredMcpServerNames: () => [],
      getCacheStamp: () => String(stamp),
      getResolvedPolicyPaths: () => ({}),
    },
    isYoloEnabled: () => yolo,
  })
  const sessions = new mod.SessionRules()
  const resolver = new mod.PermissionResolver(manager, sessions)
  // Extension surface queries do not touch this path collaborator/registries.
  const service = new mod.LocalPermissionsService(resolver, { getPathNormalizer: () => ({}) }, {}, {}, {})
  return {
    resolver,
    service,
    sessions,
    set(global, scoped = {}, agentScoped = {}, yoloMode = false) {
      config = { permission: global }
      project = scoped
      agent = agentScoped
      yolo = yoloMode
      stamp++
      sessions.clear()
    },
  }
}
const withoutAttestation = ({ matchedSurface, ...result }) => result

test('permission owner patch binds source/types/lock and preserves actual decision semantics through scopes/session/yolo/floors/copies', async () => {
  const patched = stagePermissionFixture(),
    original = stagePermissionFixture({ patched: false })
  const mod = await ownerModule(patched),
    old = await ownerModule(original)
  const next = engine(mod),
    previous = engine(old)
  const cases = [
    ['exact', { mh_code_map: 'allow' }, {}, {}, false, 'mh_code_map', 'allow'],
    ['family', { 'mh_*': 'allow' }, {}, {}, false, 'mh_*', 'allow'],
    ['subfamily', { 'mh_code_*': 'allow' }, {}, {}, false, 'mh_code_*', 'allow'],
    ['later-family', { mh_code_map: 'allow', 'mh_*': 'allow' }, {}, {}, false, 'mh_*', 'allow'],
    ['later-exact', { 'mh_*': 'allow', mh_code_map: 'allow' }, {}, {}, false, 'mh_code_map', 'allow'],
    ['default', { '*': 'allow' }, {}, {}, false, '*', 'allow'],
    ['scope-deny', { mh_code_map: 'allow' }, { permission: { 'mh_*': 'deny' } }, {}, false, 'mh_*', 'deny'],
    [
      'scope-exact',
      { 'mh_*': 'deny' },
      { permission: { mh_code_map: 'allow' } },
      {},
      false,
      'mh_code_map',
      'allow',
    ],
    ['agent', { mh_code_map: 'allow' }, {}, { permission: { 'mh_*': 'ask' } }, false, 'mh_*', 'ask'],
    ['fail-closed', { mh_code_map: 'allow' }, { invalid: true }, {}, false, 'mh_code_map', 'ask'],
    ['yolo-exact-ask', { mh_code_map: 'ask' }, {}, {}, true, 'mh_code_map', 'allow'],
    ['yolo-family-ask', { 'mh_*': 'ask' }, {}, {}, true, 'mh_*', 'allow'],
    ['yolo-default', { '*': 'ask' }, {}, {}, true, '*', 'allow'],
    ['yolo-existing-exact', { mh_code_map: 'allow' }, {}, {}, true, 'mh_code_map', 'allow'],
    ['revoked', { mh_code_map: 'deny' }, {}, {}, false, 'mh_code_map', 'deny'],
  ]
  const results = []
  for (const [name, global, project, agent, yolo, surface, state] of cases) {
    next.set(global, project, agent, yolo)
    previous.set(global, project, agent, yolo)
    const result = next.service.checkPermission('mh_code_map', undefined, 'worker')
    const baseline = previous.service.checkPermission('mh_code_map', undefined, 'worker')
    assert.deepEqual(withoutAttestation(result), baseline, name)
    assert.equal(result.matchedSurface, surface, name)
    assert.equal(result.state, state, name)
    if (name.startsWith('yolo-') && name !== 'yolo-existing-exact') assert.equal(result.origin, 'yolo')
    if (name === 'yolo-existing-exact') assert.notEqual(result.origin, 'yolo')
    results.push({ name, result })
  }
  for (const surface of ['mh_code_map', 'mh_*']) {
    next.set({ mh_code_map: 'deny' })
    previous.set({ mh_code_map: 'deny' })
    next.sessions.approve(surface, '*')
    previous.sessions.approve(surface, '*')
    const result = next.service.checkPermission('mh_code_map')
    assert.deepEqual(withoutAttestation(result), previous.service.checkPermission('mh_code_map'))
    assert.equal(result.matchedSurface, surface)
    assert.equal(result.source, 'session')
    assert.equal(
      mod.mostRestrictiveOf([
        { ...result, state: 'allow' },
        { ...result, state: 'deny' },
      ]).matchedSurface,
      surface,
    )
  }
  next.set({ path_read: 'allow', path_write: 'deny' })
  previous.set({ path_read: 'allow', path_write: 'deny' })
  const folded = {
    kind: 'path-values',
    surface: 'path',
    values: ['/fixture'],
    agentName: 'worker',
  }
  const foldedResult = next.resolver.resolve(folded)
  assert.equal(foldedResult.state, 'deny')
  assert.equal(foldedResult.matchedSurface, 'path_write')
  assert.deepEqual(withoutAttestation(foldedResult), previous.resolver.resolve(folded))
  next.set({ mh_code_map: 'allow' })
  const intent = {
    surface: 'mh_code_map',
    matchValues: ['*'],
    principal: { agentName: 'worker' },
    floor: '<fixture-floor>',
  }
  for (const yolo of [false, true]) {
    const result = new mod.ResolverServingPolicy(next.resolver, () => yolo).resolve(intent)
    assert.equal(result.matchedSurface, 'mh_code_map')
    assert.equal(result.matchedPattern, '<fixture-floor>')
    assert.equal(result.state, yolo ? 'allow' : 'ask')
    if (yolo) assert.equal(result.origin, 'yolo')
  }
  const hash = createHash('sha256').update(fs.readFileSync(permissionPatch)).digest('hex')
  const lock = fs.readFileSync(path.join(productRoot, 'pnpm-lock.yaml'), 'utf8')
  assert.ok(lock.includes(`hash: ${hash}`))
  assert.ok(lock.includes(`40.2.2(patch_hash=${hash})`))
  for (const file of ['src/types.ts', 'dist/public.d.ts'])
    assert.match(fs.readFileSync(path.join(patched.permissions, file), 'utf8'), /matchedSurface\?: string;/)
  for (const file of ['src/service.ts', 'dist/public.d.ts']) {
    const declaration = fs.readFileSync(path.join(patched.permissions, file), 'utf8')
    assert.match(declaration, /consumeBashApproval\?\(request:/)
    assert.match(declaration, /sessionManager: \{\s*getSessionId\(\): string\s*\}/)
    assert.match(declaration, /toolCallId: string;/)
    assert.match(declaration, /command: string;/)
    assert.match(declaration, /\(\(command: string\) => boolean\) \| undefined;/)
  }
  fs.writeFileSync(
    path.join(patched.root, 'owner-results.json'),
    JSON.stringify(
      {
        fixtureCanonicalRoots: true,
        liveInstalledPatch: false,
        cases: results,
        patchHash: hash,
      },
      null,
      2,
    ),
  )
})

test('patched owner original positive requirement and exact/family provenance/direct/nested public SDK/Faux regressions', () => {
  const stage = stagePermissionFixture()
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(stage.adapter, 'test/code-map-test.mjs')],
    { encoding: 'utf8', timeout: 45000, env },
  )
  fs.writeFileSync(path.join(stage.root, 'public-sdk.log'), result.stdout + result.stderr)
  fs.writeFileSync(
    path.join(stage.root, 'public-sdk-exit.json'),
    JSON.stringify(
      {
        status: result.status,
        error: String(result.error ?? ''),
        provenance: stage.provenance,
        liveInstalledPatch: false,
      },
      null,
      2,
    ),
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /# pass 2/)
})
