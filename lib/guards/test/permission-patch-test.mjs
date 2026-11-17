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
    BashProgram: 'access-intent/bash/program.ts',
    PathNormalizer: 'path/path-normalizer.ts',
    posixPathFlavor: 'path/path-flavor.ts',
    resolveBashCommandCheck: 'handlers/gates/bash-command.ts',
    readForwardedPermissionRequest: 'authority/forwarding-io.ts',
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

test('permission owner patch binds source/types/lock and preserves actual decision semantics through scopes/session/yolo/floors/copies', async (t) => {
  const patched = stagePermissionFixture()
  t.after(patched.cleanup)
  const original = stagePermissionFixture({ patched: false })
  t.after(original.cleanup)
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
  assert.ok(lock.includes(`42.0.2(patch_hash=${hash})`))
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

test('forwarded Bash spellings computed in the child cwd survive the wire and meet the parent deny', async (t) => {
  const stage = stagePermissionFixture()
  t.after(stage.cleanup)
  const mod = await ownerModule(stage)
  const child = engine(mod),
    parent = engine(mod)
  const childCwd = path.join(stage.root, 'child'),
    parentCwd = path.join(stage.root, 'parent')
  fs.mkdirSync(childCwd)
  fs.mkdirSync(parentCwd)
  const command = 'printf ready && rm builds/x'
  child.set({ bash: 'ask' })
  const childProgram = await mod.BashProgram.parse(
    command,
    new mod.PathNormalizer(mod.posixPathFlavor, childCwd),
  )
  const check = mod.resolveBashCommandCheck(command, childProgram.commands(), 'worker', child.resolver)
  assert.equal(check.state, 'ask')
  const childSpelling = `rm ${childCwd}/builds/x`
  assert.ok(check.askingUnits.some((unit) => unit.spellings?.includes(childSpelling)))
  const request = {
    id: 'child-cwd-spellings',
    createdAt: 1,
    requesterSessionId: 'child-session',
    targetSessionId: 'parent-session',
    requesterAgentName: 'worker',
    source: 'tool_call',
    surface: 'bash',
    value: check.command,
    accessIntent: {
      surface: 'bash',
      matchValues: [check.command],
      boundaryValue: null,
      askingUnits: check.askingUnits,
      requesterCwd: childCwd,
      principal: { sessionId: 'child-session', agentName: 'worker' },
    },
  }
  const requestPath = path.join(stage.root, 'forwarded-request.json')
  fs.writeFileSync(requestPath, JSON.stringify(request))
  const intent = mod.readForwardedPermissionRequest(null, requestPath).accessIntent
  assert.deepEqual(intent.askingUnits, check.askingUnits)
  const denyPattern = `rm ${childCwd}/builds/*`
  parent.set({ bash: { '*': 'allow', [denyPattern]: 'deny' } })
  const serving = new mod.ResolverServingPolicy(parent.resolver, () => false)
  const result = serving.resolve(intent)
  assert.equal(result.state, 'deny')
  assert.equal(result.matchedSurface, 'bash')
  assert.equal(result.matchedPattern, denyPattern)
  // A parent-cwd parse cannot manufacture the child's absolute spelling.
  const parentProgram = await mod.BashProgram.parse(
    command,
    new mod.PathNormalizer(mod.posixPathFlavor, parentCwd),
  )
  assert.equal(
    mod.resolveBashCommandCheck(command, parentProgram.commands(), 'worker', parent.resolver).state,
    'allow',
  )
  // Legacy absence is supported, but malformed present spellings discard the
  // access facts rather than letting the serving rule silently miss a deny.
  for (const spellings of [[], 'not-an-array', [42]]) {
    fs.writeFileSync(
      requestPath,
      JSON.stringify({
        ...request,
        accessIntent: {
          ...request.accessIntent,
          askingUnits: [{ command: 'rm builds/x', spellings }],
        },
      }),
    )
    assert.equal(mod.readForwardedPermissionRequest(null, requestPath).accessIntent, undefined)
  }
})

test('patched owner original positive requirement and exact/family provenance/direct/nested public SDK/Faux regressions', (t) => {
  const stage = stagePermissionFixture()
  t.after(stage.cleanup)
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
