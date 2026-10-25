// Real public SDK and authored Root; synthetic disposable DATA, never paid inference.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'

const primary = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const stage = path.dirname(primary)
const patched = process.env.OWN_UI_EXPECT_OWNER === 'patched'
const sha = (value) => createHash('sha256').update(value).digest('hex')

test('own-UI actual Root generation/command/PSS/data publication gate', async () => {
  assert.match(stage, /\.agent-state\/runtime\/claude-workflow-v2\/t232-storage\/sdk\//)
  const cwd = path.join(stage, 'project'),
    agentDir = path.join(stage, 'profile')
  for (const dir of [cwd, agentDir]) fs.mkdirSync(dir, { mode: 0o700 })
  const previous = {
    agent: process.env.PI_CODING_AGENT_DIR,
    fetch: globalThis.fetch,
  }
  process.env.PI_CODING_AGENT_DIR = agentDir
  let requests = 0
  globalThis.fetch = () => {
    requests++
    throw Error('External transport prohibited')
  }
  const root = path.join(agentDir, 'preferences/own-ui')
  const file = path.join(root, 'state.json')
  const capability = `own_ui_state_data_${sha(root)}`
  const config = path.join(agentDir, 'extensions/pi-permission-system/config.json')
  fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 })
  const rules = () => ({ [capability]: 'allow' })
  const grant = (permission = rules(), yoloMode = false) =>
    fs.writeFileSync(
      config,
      JSON.stringify({
        authorizerChain: [],
        yoloMode,
        permission: { '*': 'deny', ...permission },
      }),
      { mode: 0o600 },
    )
  grant()
  const untouched = ['auth.json', 'models.json', 'settings.json', 'Core.md']
  for (const name of untouched)
    fs.writeFileSync(
      path.join(agentDir, name),
      name === 'settings.json' ? '{}' : `SYNTHETIC_UNTOUCHED_${name}`,
      { mode: 0o600 },
    )
  const protectedBytes = untouched.map((name) => fs.readFileSync(path.join(agentDir, name)))
  const permissions = fs.realpathSync(path.join(primary, 'node_modules/@gotgenes/pi-permission-system'))
  const settings = sdk.SettingsManager.inMemory({
    packages: [permissions, primary],
    cacheWarming: 'off',
    compaction: { enabled: false },
    retry: { enabled: false },
  })
  const credentials = new ai.InMemoryCredentialStore()
  const runtime = await sdk.ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({
    provider: 'own-ui-offline',
    models: [{ id: 'fixture', contextWindow: 32000 }],
  })
  runtime.registerNativeProvider(faux.provider)
  await runtime.refresh({ allowNetwork: false })
  let session, ctx, observer, serviceForSession
  const observerFile = path.join(stage, 'own-ui-observer.ts')
  fs.symlinkSync(path.join(primary, 'node_modules'), path.join(stage, 'node_modules'), 'dir')
  fs.writeFileSync(
    observerFile,
    `import { getPermissionsService } from '@gotgenes/pi-permission-system';
    export default pi => { pi.on('session_start', (_event, ctx) =>
      pi.events.emit('fixture:own-ui-context', { ctx, service: () => getPermissionsService(ctx.sessionManager.getSessionId()) })); };`,
  )
  const notices = []
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ['mcp'],
    additionalExtensionPaths: [observerFile],
    extensionFactories: [
      (pi) => {
        observer = pi
        pi.events.on('fixture:own-ui-context', (value) => {
          ctx = value.ctx
          serviceForSession = value.service
        })
      },
    ],
  })
  const shutdown = async () => {
    if (!session) return
    try {
      await session.extensionRunner.emit({
        type: 'session_shutdown',
        reason: 'quit',
      })
    } finally {
      session.dispose()
      session = undefined
    }
  }
  // SDK's TS loader snapshots builtin imports. Install delegating interceptors
  // before loading Root, then arm only the publication fault being exercised.
  const originalOpen = fs.openSync,
    originalFsync = fs.fsyncSync
  const tempFds = new Set()
  let onTempSync
  fs.openSync = (p, ...args) => {
    const fd = originalOpen(p, ...args)
    tempFds.delete(fd)
    if (String(p).endsWith('.tmp')) tempFds.add(fd)
    return fd
  }
  fs.fsyncSync = (fd) => {
    originalFsync(fd)
    if (tempFds.has(fd)) onTempSync?.()
  }
  syncBuiltinESMExports()
  try {
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    ;({ session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager: settings,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel('fixture'),
      sessionManager: sdk.SessionManager.inMemory(cwd),
    }))
    const theme = {
      name: 'synthetic',
      fg: (_token, text) => text,
      bg: (_token, text) => text,
      bold: (text) => text,
    }
    await session.bindExtensions({
      mode: 'tui',
      uiContext: {
        theme,
        getTheme() {
          return undefined
        },
        notify: (...args) => notices.push(args),
        setStatus() {},
        setWidget() {},
        setWorkingMessage() {},
        setHeader() {},
        setFooter() {},
        setTitle() {},
        getEditorText() {
          return ''
        },
      },
    })
    assert.equal(ctx.mode, 'tui')
    assert.equal(ctx.hasUI, true)
    const nodes = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]
    const node = nodes.get(session.sessionId)
    assert.equal(node.healthy(), true, JSON.stringify(notices))
    const owner = node.ownUI
    assert.equal(owner.version, 1)
    assert.equal(owner.generation, node.generation)
    const { ownUIOwner } = await import(pathToFileURL(path.join(primary, 'lib/claude-ui-owner.ts')))
    assert.equal(ownUIOwner(ctx), owner)
    assert.equal(fs.existsSync(root), false)
    if (!patched) {
      assert.throws(() => owner.read(ctx), /unavailable/)
      assert.equal(fs.existsSync(root), false)
      return
    }
    const defaults = {
      palette: 'follow',
      toolStyle: 'transparent',
      diffView: 'split',
      extraDetail: false,
    }
    const { trustedOwnUICommand } = await import(
      pathToFileURL(path.join(primary, 'lib/guards/test/legacy-provenance.mjs'))
    )
    const commands = observer.getCommands()
    assert.equal(
      trustedOwnUICommand(commands),
      true,
      JSON.stringify(commands.filter((command) => command.name === 'mh-ui')),
    )
    const decision = serviceForSession().checkPermission(capability)
    assert.equal(decision.state, 'allow', JSON.stringify(decision))
    assert.equal(decision.matchedSurface, capability, JSON.stringify(decision))
    assert.equal(ctx.sessionManager.getHeader()?.id, session.sessionId)
    const initial = owner.read(ctx)
    assert.deepEqual(initial.preferences, defaults)
    assert.equal(fs.existsSync(path.dirname(root)), false, 'authorized absent read never creates preferences')
    const stored = owner.save(ctx, initial.ticket, {
      ...defaults,
      palette: 'claude',
    })
    assert.equal(JSON.parse(fs.readFileSync(file)).sequence, 1)
    assert.equal(stored.preferences.palette, 'claude')
    assert.throws(() => owner.save(ctx, initial.ticket, defaults), /revision changed/)
    const bytes = fs.readFileSync(file)
    for (const ticket of [null, 'forged', 1, {}, { version: 1 }]) {
      assert.throws(() => owner.save(ctx, ticket, defaults), /revision changed|unavailable/)
      assert.deepEqual(fs.readFileSync(file), bytes)
    }
    for (const preferences of [
      null,
      [],
      {},
      { ...defaults, extraDetail: 'true' },
      { ...defaults, path: file },
      { ...defaults, palette: 'invalid' },
    ]) {
      assert.throws(() => owner.save(ctx, stored.ticket, preferences), /unavailable/)
      assert.deepEqual(fs.readFileSync(file), bytes)
      assert.deepEqual(fs.readdirSync(root), ['state.json'])
    }
    const reject = (context = ctx) => {
      assert.throws(() => owner.read(context), /unavailable/)
      assert.throws(() => owner.save(context, stored.ticket, defaults), /unavailable|revision changed/)
      assert.deepEqual(fs.readFileSync(file), bytes)
    }
    // These are actual public-PSS resolutions, not fabricated positive metadata.
    for (const permission of [
      {},
      { 'own_ui_state_*': 'allow' },
      { 'own_ui_state_data_*': 'allow' },
      { ...rules(), 'own_ui_state_*': 'allow' },
      { ...rules(), [capability]: 'deny' },
      {
        [`rtk_state_data_${sha(path.join(agentDir, 'preferences/rtk'))}`]: 'allow',
      },
      { read: 'allow', write: 'allow' },
      { [capability]: 'ask' },
    ]) {
      grant(permission, permission[capability] === 'ask')
      reject()
    }
    grant(rules(), true)
    // Public PSS resolves an existing exact rule before yolo. Only a yolo-
    // originated fallback is forbidden (the ask case above exercises that).
    assert.notEqual(serviceForSession().checkPermission(capability).origin, 'yolo')
    owner.read(ctx)
    for (const surface of ['read', 'path_read', 'path_write']) {
      grant({ ...rules(), [surface]: { [file]: 'deny' } })
      if (surface === 'path_write') {
        owner.read(ctx)
        assert.throws(() => owner.save(ctx, stored.ticket, defaults), /unavailable/)
      } else reject()
      grant({ ...rules(), [surface]: 'deny' })
      if (surface === 'path_write')
        assert.throws(() => owner.save(ctx, stored.ticket, defaults), /unavailable/)
      else reject()
    }
    // A specific temp-path denial is checked before the temp is opened.
    grant({ ...rules(), path_write: { [`${root}/.state-*`]: 'deny' } })
    assert.throws(() => owner.save(ctx, stored.ticket, defaults), /unavailable/)
    assert.deepEqual(fs.readdirSync(root), ['state.json'])
    grant()
    for (const context of [
      { ...ctx, hasUI: false },
      { ...ctx, mode: 'rpc' },
      { ...ctx, mode: 'print' },
      { ...ctx, signal: AbortSignal.abort() },
      { ...ctx, sessionManager: { getSessionId: () => session.sessionId } },
    ])
      reject(context)
    const originalHeader = ctx.sessionManager.getHeader
    ctx.sessionManager.getHeader = () => ({
      ...originalHeader.call(ctx.sessionManager),
      parentSession: 'fixture-child',
    })
    reject()
    ctx.sessionManager.getHeader = originalHeader
    nodes.nativeChildren.add(session.sessionId)
    reject()
    nodes.nativeChildren.delete(session.sessionId)
    // Strip only attestations for a negative old-service case; never forge an allow.
    const service = serviceForSession()
    assert.ok(service)
    const originalCheck = service.checkPermission
    service.checkPermission = function (...args) {
      const { matchedSurface, ...decision } = originalCheck.apply(this, args)
      return decision
    }
    reject()
    service.checkPermission = originalCheck
    // Revocation/generation/cancellation/child changes during fsync must stop rename.
    for (const kind of ['revoke', 'generation', 'abort', 'child', 'header', 'binding']) {
      const token = owner.read(ctx).ticket
      const abort = new AbortController()
      const savingContext = { ...ctx, signal: abort.signal }
      let injected = false
      const otherProfile = path.join(stage, 'other-profile')
      if (!fs.existsSync(otherProfile)) fs.mkdirSync(otherProfile, { mode: 0o700 })
      onTempSync = () => {
        if (!injected) {
          injected = true
          if (kind === 'revoke') grant({ [capability]: 'deny' })
          if (kind === 'generation') node.generation = {}
          if (kind === 'abort') abort.abort()
          if (kind === 'child') nodes.nativeChildren.add(session.sessionId)
          if (kind === 'header')
            ctx.sessionManager.getHeader = () => ({
              ...originalHeader.call(ctx.sessionManager),
              parentSession: 'late-child',
            })
          if (kind === 'binding') process.env.PI_CODING_AGENT_DIR = otherProfile
        }
      }
      try {
        assert.throws(
          () => owner.save(savingContext, token, defaults),
          /unavailable/,
          `publication mutation: ${kind}; injected: ${injected}`,
        )
      } finally {
        onTempSync = undefined
        node.generation = owner.generation
        nodes.nativeChildren.delete(session.sessionId)
        ctx.sessionManager.getHeader = originalHeader
        process.env.PI_CODING_AGENT_DIR = agentDir
        grant()
      }
      assert.equal(injected, true, kind)
      assert.deepEqual(fs.readFileSync(file), bytes, kind)
    }
    // Fresh command registry must notice a later foreign/inline shadow.
    observer.registerCommand('mh-ui', {
      description: 'foreign negative-only shadow',
      handler() {},
    })
    reject()
    for (let i = 0; i < untouched.length; i++)
      assert.deepEqual(fs.readFileSync(path.join(agentDir, untouched[i])), protectedBytes[i])
    assert.equal(requests, 0)
    const id = session.sessionId
    await shutdown()
    assert.throws(() => owner.read(ctx), /unavailable/)
    assert.equal(nodes.has(id), false)
  } finally {
    onTempSync = undefined
    fs.openSync = originalOpen
    fs.fsyncSync = originalFsync
    syncBuiltinESMExports()
    await shutdown()
    if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous.agent
    globalThis.fetch = previous.fetch
  }
})
