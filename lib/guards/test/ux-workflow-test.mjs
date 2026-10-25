// Executed only from disposable canonical-root source stages by ux-workflow-patch-test.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { syncBuiltinESMExports } from 'node:module'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'
import { trustedUXWorkflowTool, uxWorkflowToolNames } from './legacy-provenance.mjs'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  primary = path.resolve(adapter, '../..')
const stagedRoot = path.resolve(adapter, '../../..')
const patched = process.env.UX_EXPECT_OWNER === 'patched'
const sha = (value) => createHash('sha256').update(value).digest('hex')

test(`native UXWorkflow actual public SDK/Faux and ${patched ? 'patched' : 'old'} owner`, async () => {
  assert.match(
    stagedRoot,
    /\.agent-state\/runtime\/pi-ownership-repair\//,
    'fixture only, never real profile or installed sources',
  )
  const cwd = path.join(stagedRoot, 'project'),
    agentDir = path.join(stagedRoot, 'profile')
  for (const dir of [cwd, agentDir]) fs.mkdirSync(dir, { mode: 0o700 })
  const saved = {
    agent: process.env.PI_CODING_AGENT_DIR,
    fetch: globalThis.fetch,
  }
  process.env.PI_CODING_AGENT_DIR = agentDir
  let requests = 0
  globalThis.fetch = () => {
    requests++
    throw Error('External requests prohibited')
  }
  const root = path.join(agentDir, 'workflow/ux-workflow', sha(cwd)),
    capability = `ux_workflow_state_${sha(root)}`
  const config = path.join(agentDir, 'extensions/pi-permission-system/config.json'),
    uxConfig = path.join(agentDir, 'extensions/mahiro-ux-workflow/config.json')
  for (const file of [config, uxConfig]) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const uxConfigBytes = JSON.stringify({
    version: 1,
    profile: agentDir,
    projects: [cwd],
  })
  fs.writeFileSync(uxConfig, uxConfigBytes, { mode: 0o600 })
  const rules = () =>
    Object.fromEntries([...uxWorkflowToolNames, capability, 'codemode'].map((name) => [name, 'allow']))
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
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({
      defaultTools: ['+codemode'],
      skills: [],
      prompts: [],
      themes: [],
      cacheWarming: 'off',
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
    { mode: 0o600 },
  )
  const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
  const untouched = [
    path.join(cwd, 'opaque-artifact.txt'),
    ...['goals', 'evidence'].map((kind) => path.join(agentDir, 'workflow', kind, sha(cwd), 'state.json')),
  ]
  for (const file of untouched) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, `FROZEN OFFLINE FIXTURE ONLY ${path.basename(path.dirname(file))}`, {
      mode: 0o600,
    })
  }
  const untouchedBytes = new Map(untouched.map((file) => [file, fs.readFileSync(file)]))
  const originalRead = fs.readFileSync,
    originalOpen = fs.openSync
  let forbiddenArtifactReads = 0
  const assertNotArtifact = (file) => {
    if (untouched.includes(String(file))) {
      forbiddenArtifactReads++
      throw Error('Opaque artifact/Goal/Evidence reads prohibited')
    }
  }
  fs.readFileSync = function (file, ...args) {
    assertNotArtifact(file)
    return originalRead.call(this, file, ...args)
  }
  fs.openSync = function (file, ...args) {
    assertNotArtifact(file)
    return originalOpen.call(this, file, ...args)
  }
  syncBuiltinESMExports()
  const settings = sdk.SettingsManager.create(cwd, agentDir)
  settings.setPackages([
    permissions,
    adapter,
    {
      source: primary,
      extensions: ['extensions/mahiro-ux-workflow.ts'],
      skills: [],
      prompts: [],
      themes: [],
    },
  ])
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({
    provider: 'openai',
    models: [{ id: 'ux-workflow-offline-fixture', input: ['text', 'image'] }],
  })
  runtime.registerNativeProvider(faux.provider)
  let ctx, tools, definition, node, session, service
  const defs = new Map()
  const observer = path.join(stagedRoot, 'ux-workflow-observer.ts')
  fs.symlinkSync(path.join(adapter, 'node_modules'), path.join(stagedRoot, 'node_modules'), 'dir')
  fs.writeFileSync(
    observer,
    `import {getPermissionsService} from '@gotgenes/pi-permission-system'; export default pi=>{pi.on('session_start',(_e,ctx)=>pi.events.emit('fixture:ux-workflow-context',{ctx,tools:pi.getAllTools(),service:()=>getPermissionsService(ctx.sessionManager.getSessionId())}));};`,
  )
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ['mcp'],
    additionalExtensionPaths: [observer],
    extensionFactories: [
      { name: 'codemode', builtin: true, factory: sdk.createCodemodeExtension() },
      (pi) => {
        pi.events.on('fixture:ux-workflow-context', (value) => {
          ctx = value.ctx
          tools = value.tools
          service = value.service
        })
      },
    ],
  })
  let confirm = async () => false,
    notices = []
  try {
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    for (const extension of loader.getExtensions().extensions) {
      for (const item of extension.tools.values()) defs.set(item.definition.name, item.definition)
    }
    definition = defs.get('mh_create_ux_workflow')
    assert.ok(definition)
    assert.equal(fs.existsSync(root), false, 'import/registration reads or writes no UXWorkflow state')
    const result = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager: settings,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: sdk.SessionManager.create(cwd, path.join(stagedRoot, 'sessions')),
    })
    session = result.session
    await session.bindExtensions({
      mode: 'rpc',
      uiContext: {
        confirm: (...args) => confirm(...args),
        notify: (...args) => notices.push(args),
        setStatus() {},
        setWidget() {},
        setWorkingMessage() {},
      },
    })
    service = service()
    node = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(session.sessionId)
    assert.ok(node.healthy())
    assert.equal(node.uxWorkflow.version, 1)
    const execute = (name, args = {}, context = ctx, signal) =>
      defs.get(name).execute('fixture', args, signal, undefined, context)
    const read = async () => (await execute('mh_get_ux_workflow')).details
    const statePath = path.join(root, 'state.json'),
      state = () => JSON.parse(fs.readFileSync(statePath))
    const current = () => Object.values(state().runs)[0]
    const update = async (args) => {
      await read()
      return execute('mh_update_ux_workflow', {
        expected_revision: current().revision,
        ...args,
      })
    }
    if (!patched) {
      assert.equal((await read()).workflow, null)
      grant({ [capability]: 'allow', codemode: 'allow' })
      await assert.rejects(read(), /PSS permission/)
      await assert.rejects(execute('mh_create_ux_workflow', { summary: 'denied' }))
      await assert.rejects(
        execute('mh_update_ux_workflow', {
          action: 'add_blocker',
          expected_revision: 1,
          summary: 'denied',
        }),
      )
      let transcript
      faux.setResponses([
        ai.fauxAssistantMessage(
          [
            ...uxWorkflowToolNames.map((name) =>
              ai.fauxToolCall(
                name,
                name === 'mh_get_ux_workflow'
                  ? {}
                  : name === 'mh_create_ux_workflow'
                    ? { summary: 'denied' }
                    : {
                        action: 'add_blocker',
                        expected_revision: 1,
                        summary: 'denied',
                      },
              ),
            ),
            ai.fauxToolCall('codemode', {
              code: "for (const name of ['mh_get_ux_workflow','mh_create_ux_workflow','mh_update_ux_workflow']) { try { await tools[name](name==='mh_get_ux_workflow'?{}:name==='mh_create_ux_workflow'?{summary:'denied'}:{action:'add_blocker',expected_revision:1,summary:'denied'}); text('BAD_ALLOW'); } catch(e) { text('OLD_OWNER_DENIED'); } }",
            }),
          ],
          { stopReason: 'toolUse' },
        ),
        (context) => {
          transcript = context.messages
          return ai.fauxAssistantMessage('Old owner denied offline')
        },
      ])
      await session.prompt('Synthetic old-owner UX denial only')
      const results = transcript.filter((m) => m.role === 'toolResult').slice(-4)
      for (const name of uxWorkflowToolNames)
        assert.equal(results.find((m) => m.toolName === name).isError, true)
      assert.match(JSON.stringify(results.find((m) => m.toolName === 'codemode')), /OLD_OWNER_DENIED/)
      assert.doesNotMatch(JSON.stringify(results), /BAD_ALLOW/)
      assert.equal(fs.existsSync(root), false)
      assert.equal(requests, 0)
      return
    }
    assert.equal((await read()).workflow, null)
    assert.equal(fs.existsSync(root), false)
    fs.unlinkSync(uxConfig)
    assert.equal((await read()).workflow, null)
    assert.equal(fs.existsSync(root), false)
    fs.writeFileSync(uxConfig, uxConfigBytes, { mode: 0o600 })
    let confirmations = 0
    confirm = async () => {
      confirmations++
      return true
    }
    await read()
    await execute('mh_create_ux_workflow', {
      summary: 'Offline native UX fixture',
    })
    assert.equal(current().stage, 'frame')
    assert.equal(current().revision, 1)
    for (const injected of [
      { actor: 'human' },
      { approval: { status: 'approved' } },
      { goal_id: 'other' },
      { workflow_id: 'other' },
      { acceptance_criteria: [{ text: 'invented', owner: 'human' }] },
    ]) {
      await assert.rejects(
        update({
          action: 'set_frame',
          problem: 'p',
          audience: 'a',
          desired_outcome: 'd',
          ...injected,
        }),
      )
      assert.equal(current().revision, 1)
    }
    await assert.rejects(update({ action: 'set_phase', phase: 'handoff' }))
    await update({
      action: 'set_frame',
      problem: 'p',
      audience: 'a',
      desired_outcome: 'd',
    })
    const brief = {
      owner: 'opaque-owner-never-invoked',
      mode: 'fixture',
      reference: untouched[0],
      summary: 'brief',
    }
    await update({
      action: 'add_research',
      kind: 'metadata',
      summary: 'optional',
      reference: untouched[0],
    })
    await update({ action: 'set_brief', brief })
    await update({ action: 'set_phase', phase: 'design' })
    await update({
      action: 'add_concept',
      concept_id: 'a',
      title: 'A',
      summary: 'A',
      tradeoffs: [],
    })
    await update({
      action: 'propose_direction',
      concept_id: 'a',
      summary: 'A',
    })
    assert.equal(confirmations, 0, 'ordinary agent metadata has no mechanical universal UI gate')
    console.log(
      'CHEAP_FALSIFIER_PASS',
      JSON.stringify({
        actualPublicSDK: true,
        actualPatchedOwner: true,
        injectedHumanDenied: true,
        unauthorizedAdvanceDenied: true,
        ordinaryMetadataWithoutConfirm: true,
      }),
    )
    const command = async (text) => {
      const episodes = JSON.stringify(session.messages)
      await session.prompt(`/mh-ux ${text}`)
      assert.equal(
        JSON.stringify(session.messages),
        episodes,
        'UX human commands append/rewrite no user or assistant episodes',
      )
    }
    let before = fs.readFileSync(statePath)
    const commandDefinition = loader
      .getExtensions()
      .extensions.map((e) => e.commands.get('mh-ux'))
      .find(Boolean)
    assert.ok(commandDefinition)
    await commandDefinition.handler(`approve direction ${current().revision} a`, { ...ctx, hasUI: false })
    assert.deepEqual(fs.readFileSync(statePath), before)
    assert.match(notices.at(-1)[0], /no UI/)
    await command(`approve direction ${current().revision} wrong`)
    assert.deepEqual(fs.readFileSync(statePath), before)
    confirm = async () => false
    await command(`approve direction ${current().revision} a`)
    assert.deepEqual(fs.readFileSync(statePath), before)
    confirm = async () => {
      confirmations++
      return true
    }
    await command(`approve direction ${current().revision} a`)
    assert.equal(current().stage, 'handoff')
    assert.equal(current().direction.approval.actor, 'human')
    await update({
      action: 'set_handoff',
      handoff: {
        readiness: 'prototype_ready',
        brief,
        acceptance_criteria: ['string criterion'],
        non_goals: [],
        constraints: [],
        open_questions: [],
        protected_contracts: [],
        target_matrix: [{ target: 'opaque target', intent: 'metadata' }],
        suggested_checks: [],
        goal_criterion_refs: [untouched[1]],
      },
    })
    await update({ action: 'set_phase', phase: 'implementation' })
    await update({
      action: 'set_review',
      verdict: 'Ready',
      summary: 'metadata not verification',
      findings: [
        {
          severity: 'low',
          summary: 'metadata finding',
          reference: untouched[0],
        },
      ],
      evidence_refs: [untouched[2]],
      code_evidence_refs: [untouched[0]],
    })
    await assert.rejects(update({ action: 'set_phase', phase: 'implementation' }), /awaits human/)
    await command(`reject review ${current().revision} revise`)
    assert.equal(current().stage, 'implementation')
    await update({
      action: 'set_review',
      verdict: 'Needs Revision',
      summary: 'iteration two',
      findings: [],
      evidence_refs: [],
      code_evidence_refs: [],
    })
    const invalidReviewCount = confirmations
    await command(`approve review ${current().revision}`)
    assert.equal(confirmations, invalidReviewCount)
    assert.equal(current().stage, 'review')
    await command(`reopen ${current().revision}`)
    assert.equal(current().stage, 'implementation')
    await update({
      action: 'set_review',
      verdict: 'Ready',
      summary: 'iteration three',
      findings: [],
      evidence_refs: [],
      code_evidence_refs: [],
    })
    await command(`reject review ${current().revision} exhausted`)
    assert.equal(current().stage, 'review')
    await command(`approve review ${current().revision}`)
    assert.equal(current().stage, 'review', 'approval is not completion')
    const countBefore = confirmations
    await update({ action: 'complete' })
    assert.equal(current().stage, 'complete')
    assert.equal(confirmations, countBefore)
    await assert.rejects(update({ action: 'add_blocker', summary: 'immutable' }), /immutable/)
    await command(`reopen ${current().revision}`)
    assert.equal(current().stage, 'complete')
    assert.equal(requests, 0)
    const realTool = tools.find((t) => t.name === 'mh_get_ux_workflow')
    assert.equal(trustedUXWorkflowTool(realTool), true)
    for (const candidate of [
      { ...realTool, name: 'mh_ux_alias' },
      { ...realTool, sourceInfo: undefined },
      { ...realTool, sourceInfo: { ...realTool.sourceInfo, path: '<inline>' } },
    ])
      assert.equal(trustedUXWorkflowTool(candidate), false)
    const rootAlias = path.join(stagedRoot, 'pi-root-alias')
    fs.symlinkSync(primary, rootAlias, 'dir')
    for (const candidate of [
      {
        ...realTool,
        sourceInfo: { ...realTool.sourceInfo, origin: 'top-level' },
      },
      {
        ...realTool,
        sourceInfo: { ...realTool.sourceInfo, baseDir: stagedRoot },
      },
      {
        ...realTool,
        sourceInfo: { ...realTool.sourceInfo, baseDir: rootAlias },
      },
      {
        ...realTool,
        sourceInfo: {
          ...realTool.sourceInfo,
          baseDir: primary + '/../mahiro-pi',
        },
      },
    ])
      assert.equal(trustedUXWorkflowTool(candidate), true)
    const alias = path.join(primary, 'extensions/ux-alias.ts')
    fs.symlinkSync(path.join(primary, 'extensions/mahiro-ux-workflow.ts'), alias)
    assert.equal(
      trustedUXWorkflowTool({
        ...realTool,
        sourceInfo: { ...realTool.sourceInfo, path: alias },
      }),
      true,
    )
    const copied = path.join(stagedRoot, 'copied-pi')
    fs.cpSync(primary, copied, { recursive: true })
    assert.equal(
      trustedUXWorkflowTool({
        ...realTool,
        sourceInfo: {
          ...realTool.sourceInfo,
          baseDir: copied,
          path: path.join(copied, 'extensions/mahiro-ux-workflow.ts'),
        },
      }),
      false,
    )
    assert.throws(() =>
      node.uxWorkflow.assertAccess(
        realTool,
        { ...ctx, sessionManager: { getSessionId: () => session.sessionId } },
        root,
      ),
    )
    assert.throws(() => node.uxWorkflow.assertAccess(realTool, ctx, `${root}/foreign`))
    const header = ctx.sessionManager.getHeader.bind(ctx.sessionManager),
      getHeader = ctx.sessionManager.getHeader
    ctx.sessionManager.getHeader = () => ({
      ...header(),
      parentSession: 'human-fork-or-native-child',
    })
    await assert.rejects(read())
    ctx.sessionManager.getHeader = getHeader
    const registry = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]
    registry.nativeChildren.add(session.sessionId)
    await assert.rejects(read())
    registry.nativeChildren.delete(session.sessionId)
    const deniedDispatch = async () => {
      let transcript
      faux.setResponses([
        ai.fauxAssistantMessage(
          [
            ...uxWorkflowToolNames.map((name) =>
              ai.fauxToolCall(
                name,
                name === 'mh_get_ux_workflow'
                  ? {}
                  : name === 'mh_create_ux_workflow'
                    ? { summary: 'denied' }
                    : {
                        action: 'add_blocker',
                        summary: 'denied',
                        expected_revision: current().revision,
                      },
              ),
            ),
            ai.fauxToolCall('codemode', {
              code: "for (const name of ['mh_get_ux_workflow','mh_create_ux_workflow','mh_update_ux_workflow']) { try { await tools[name](name==='mh_get_ux_workflow'?{}:name==='mh_create_ux_workflow'?{summary:'denied'}:{action:'add_blocker',summary:'denied',expected_revision:1}); text('BAD_ALLOW'); } catch(e) { text('NESTED_UX_DENIED'); } }",
            }),
          ],
          { stopReason: 'toolUse' },
        ),
        (context) => {
          transcript = context.messages
          return ai.fauxAssistantMessage('Offline denial matrix')
        },
      ])
      await session.prompt('Synthetic denied UX dispatch only')
      const results = transcript.filter((m) => m.role === 'toolResult').slice(-4)
      for (const name of uxWorkflowToolNames)
        assert.equal(results.find((m) => m.toolName === name).isError, true)
      const nested = JSON.stringify(results.find((m) => m.toolName === 'codemode'))
      assert.match(nested, /NESTED_UX_DENIED/)
      assert.doesNotMatch(nested, /BAD_ALLOW/)
    }
    const frozen = fs.readFileSync(statePath)
    let matrixCases = 0
    for (const permission of [
      { 'mh_*': 'allow' },
      { '*': 'allow' },
      { ...Object.fromEntries(uxWorkflowToolNames.map((n) => [n, 'allow'])) },
      { ...rules(), 'mh_*': 'allow' },
      { ...rules(), 'ux_workflow_state_*': 'allow' },
    ]) {
      grant({ codemode: 'allow', ...permission })
      await read()
    }
    grant(
      {
        ...Object.fromEntries([...uxWorkflowToolNames, capability].map((n) => [n, 'ask'])),
        codemode: 'allow',
      },
      true,
    )
    await session.extensionRunner.emitBeforeAgentStart(
      { messageType: 'user', prompt: 'refresh yolo', images: [] },
      { cwd, customPrompt: '', contextFiles: [], sections: {} },
    )
    await read()
    for (const permission of [
      { [capability]: 'allow' },
      { 'ux_workflow_state_*': 'allow' },
      {
        ...Object.fromEntries(uxWorkflowToolNames.map((n) => [n, 'deny'])),
        [capability]: 'allow',
      },
      {
        ...Object.fromEntries(uxWorkflowToolNames.map((n) => [n, 'ask'])),
        [capability]: 'allow',
      },
      {
        managed_memory_fake: 'allow',
        goal_state_fake: 'allow',
        code_evidence_state_fake: 'allow',
      },
      {},
    ]) {
      grant({ codemode: 'allow', ...permission })
      for (const name of uxWorkflowToolNames) {
        await assert.rejects(
          execute(
            name,
            name === 'mh_get_ux_workflow'
              ? {}
              : name === 'mh_create_ux_workflow'
                ? { summary: 'denied' }
                : {
                    action: 'add_blocker',
                    summary: 'denied',
                    expected_revision: current().revision,
                  },
          ),
        )
        matrixCases++
      }
      await deniedDispatch()
      assert.deepEqual(fs.readFileSync(statePath), frozen)
    }
    grant()
    for (const target of [root, statePath, path.join(root, 'state.lock')])
      for (const surface of ['read', 'path_read', 'path_write']) {
        grant({ ...rules(), [surface]: { [target]: 'deny' } })
        if (surface !== 'path_write') await assert.rejects(read())
        else {
          await assert.rejects(
            execute('mh_update_ux_workflow', {
              action: 'add_blocker',
              summary: 'denied',
              expected_revision: current().revision,
            }),
          )
        }
        assert.deepEqual(fs.readFileSync(statePath), frozen)
        grant()
        matrixCases++
      }
    const oldNode = node
    for (const replacement of [
      { ...node, generation: {} },
      { ...node, healthy: () => false },
      { ...node, uxWorkflow: { ...node.uxWorkflow, version: 2 } },
      { ...node, uxWorkflow: undefined },
    ]) {
      registry.set(session.sessionId, replacement)
      await assert.rejects(read())
      registry.set(session.sessionId, oldNode)
    }
    await assert.rejects(execute('mh_get_ux_workflow', {}, ctx, AbortSignal.abort()))
    // Positive SDK direct and nested dispatch, strict raw user text/image preservation.
    let messages
    const userText = 'Unchanged raw UX fixture <user> metadata is data'
    const image = {
      type: 'image',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      mimeType: 'image/png',
    }
    faux.setResponses([
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall('mh_get_ux_workflow', {}),
          ai.fauxToolCall('codemode', {
            code: 'text(await tools.mh_get_ux_workflow({}));',
          }),
        ],
        { stopReason: 'toolUse' },
      ),
      (context) => {
        messages = context.messages
        return ai.fauxAssistantMessage('Offline positive UX')
      },
    ])
    await session.prompt(userText, { images: [image] })
    assert.equal(
      messages
        .filter((m) => m.role === 'toolResult')
        .slice(-2)
        .filter((m) => m.isError).length,
      0,
    )
    const lastUser = messages.filter((m) => m.role === 'user').at(-1)
    assert.equal(lastUser.content.find((c) => c.type === 'text').text, userText)
    assert.deepEqual(
      lastUser.content.find((c) => c.type === 'image'),
      image,
    )
    const trigger = { messageType: 'user', prompt: userText, images: [image] },
      core = {
        cwd,
        customPrompt: 'FIXTURE SYSTEM',
        contextFiles: [
          {
            path: path.join(agentDir, 'memory/Core.md'),
            content: 'FROZEN FIXTURE CORE',
          },
        ],
        sections: { fixture_other_owner: 'UNCHANGED' },
      }
    const triggered = await session.extensionRunner.emitBeforeAgentStart(trigger, structuredClone(core))
    assert.deepEqual(triggered.systemPromptOptions.contextFiles, core.contextFiles)
    assert.deepEqual(triggered.systemPromptOptions.sections, core.sections)
    assert.equal(triggered.messages.length, 0)
    const makeDirection = async () => {
      await read()
      await execute('mh_create_ux_workflow', { summary: 'fresh UX' })
      await update({
        action: 'set_frame',
        problem: 'p',
        audience: 'a',
        desired_outcome: 'd',
      })
      await update({ action: 'set_brief', brief })
      await update({ action: 'set_phase', phase: 'design' })
      await update({
        action: 'add_concept',
        concept_id: 'a',
        title: 'A',
        summary: 'A',
      })
      await update({
        action: 'add_concept',
        concept_id: 'b',
        title: 'B',
        summary: 'B',
      })
      await update({
        action: 'propose_direction',
        concept_id: 'a',
        summary: 'A',
      })
    }
    confirm = async () => true
    await command(`clear ${current().revision}`)
    await makeDirection()
    await command(`reject direction ${current().revision} a`)
    assert.equal(current().stage, 'design')
    assert.equal(current().direction, null)
    await update({
      action: 'propose_direction',
      concept_id: 'a',
      summary: 'A',
    })
    await command(`reopen ${current().revision}`)
    assert.equal(current().stage, 'design')
    await update({
      action: 'propose_direction',
      concept_id: 'a',
      summary: 'A',
    })
    const navigationEvents = [
      {
        type: 'session_before_switch',
        reason: 'resume',
        targetSessionFile: path.join(stagedRoot, 'other.jsonl'),
      },
      {
        type: 'session_before_fork',
        entryId: session.sessionManager.getLeafId(),
        position: 'at',
      },
      {
        type: 'session_before_tree',
        preparation: {
          targetId: session.sessionManager.getLeafId(),
          oldLeafId: session.sessionManager.getLeafId(),
          commonAncestorId: null,
          entriesToSummarize: [],
          userWantsSummary: false,
        },
        signal: new AbortController().signal,
      },
    ]
    for (const event of navigationEvents) {
      await read()
      before = fs.readFileSync(statePath)
      await session.extensionRunner.emit(event)
      await assert.rejects(
        execute('mh_update_ux_workflow', {
          action: 'add_blocker',
          expected_revision: current().revision,
          summary: 'stale ticket',
        }),
        /Read mh_get/,
      )
      assert.deepEqual(fs.readFileSync(statePath), before)
    }
    const { transactUX, readUXState, stateTicket, resolveUXBinding } = await import(
      path.join(primary, 'lib/ux-workflow/store.ts')
    )
    const { applyUX } = await import(path.join(primary, 'lib/ux-workflow/model.ts'))
    let binding = { ...resolveUXBinding(cwd), sessionId: session.sessionId }
    const access = () =>
      node.uxWorkflow.authorize(
        tools.find((t) => t.name === 'mh_update_ux_workflow'),
        ctx,
        root,
        'write',
      )
    const assertAccess = () =>
      node.uxWorkflow.assertAccess(
        tools.find((t) => t.name === 'mh_update_ux_workflow'),
        ctx,
        root,
        'write',
      )
    for (const race of ['revision', 'concept', 'ABA', 'revoke', 'config-replace', 'navigation', 'cancel']) {
      let release, label
      const id = current().id,
        revision = current().revision
      confirm = async (_title, message) => {
        label = message
        return new Promise((resolve) => (release = resolve))
      }
      const pending = command(`approve direction ${revision} a`)
      while (!release) await new Promise((resolve) => setTimeout(resolve, 1))
      assert.match(label, new RegExp(id))
      assert.match(label, new RegExp(`revision ${revision}`))
      assert.match(label, /Concept: a/)
      const preRace = fs.readFileSync(statePath)
      if (race === 'revision') await update({ action: 'add_blocker', summary: 'concurrent' })
      if (race === 'concept')
        await transactUX(
          binding,
          stateTicket(readUXState(binding)),
          access,
          (draft) => {
            applyUX(draft, binding, 'reopen', { expected_revision: revision })
            return applyUX(draft, binding, 'update', {
              expected_revision: revision + 1,
              action: 'propose_direction',
              concept_id: 'b',
              summary: 'B',
            })
          },
          assertAccess,
        )
      if (race === 'ABA')
        await transactUX(
          binding,
          stateTicket(readUXState(binding)),
          access,
          (draft) => {
            applyUX(draft, binding, 'clear', { expected_revision: revision })
            return applyUX(draft, binding, 'create', {
              summary: 'ABA replacement',
            })
          },
          assertAccess,
        )
      if (race === 'revoke') grant({ ...rules(), mh_update_ux_workflow: 'deny' })
      if (race === 'config-replace') {
        fs.renameSync(uxConfig, `${uxConfig}.old`)
        fs.writeFileSync(uxConfig, uxConfigBytes, { mode: 0o600 })
      }
      if (race === 'navigation') await session.extensionRunner.emit(navigationEvents[1])
      if (race === 'cancel')
        await session.extensionRunner.emit({
          type: 'session_before_switch',
          reason: 'new',
        })
      const afterRace = fs.readFileSync(statePath)
      release(true)
      await pending
      assert.deepEqual(fs.readFileSync(statePath), afterRace, race)
      if (['revoke', 'config-replace', 'navigation', 'cancel'].includes(race))
        assert.deepEqual(afterRace, preRace)
      grant()
      binding = { ...resolveUXBinding(cwd), sessionId: session.sessionId }
      confirm = async () => true
      await command(`clear ${current().revision}`)
      await makeDirection()
    }
    // Clearing an existing run must show its actual ID, and never retarget clear/recreate.
    let clearRelease, clearLabel
    confirm = async (_title, message) => {
      clearLabel = message
      return new Promise((resolve) => (clearRelease = resolve))
    }
    const clearingId = current().id,
      clearingRevision = current().revision
    const clearing = command(`clear ${clearingRevision}`)
    while (!clearRelease) await new Promise((resolve) => setTimeout(resolve, 1))
    assert.match(clearLabel, new RegExp(clearingId))
    assert.doesNotMatch(clearLabel, /empty session/)
    await transactUX(
      binding,
      stateTicket(readUXState(binding)),
      access,
      (draft) => {
        applyUX(draft, binding, 'clear', {
          expected_revision: clearingRevision,
        })
        return applyUX(draft, binding, 'create', {
          summary: 'new rev1 after clear',
        })
      },
      assertAccess,
    )
    const recreated = fs.readFileSync(statePath)
    clearRelease(true)
    await clearing
    assert.deepEqual(fs.readFileSync(statePath), recreated)
    assert.notEqual(current().id, clearingId)
    assert.equal(current().revision, 1)
    // Branch navigation does not rewind canonical state; a different native session has no fallback.
    session.sessionManager.resetLeaf()
    assert.equal((await read()).workflow.id, current().id)
    const other = { ...binding, sessionId: 'different-native-session' }
    const { runAt } = await import(path.join(primary, 'lib/ux-workflow/model.ts'))
    assert.equal(runAt(readUXState(binding), other), null)
    const cancelled = new AbortController()
    let cancelledRelease
    confirm = async () => new Promise((resolve) => (cancelledRelease = resolve))
    const cancelledCommand = commandDefinition.handler(`clear ${current().revision}`, {
      ...ctx,
      signal: cancelled.signal,
    })
    while (!cancelledRelease) await new Promise((resolve) => setTimeout(resolve, 1))
    const beforeCancel = fs.readFileSync(statePath)
    cancelled.abort()
    cancelledRelease(true)
    await cancelledCommand
    assert.deepEqual(fs.readFileSync(statePath), beforeCancel)
    assert.equal(forbiddenArtifactReads, 0)
    fs.readFileSync = originalRead
    fs.openSync = originalOpen
    syncBuiltinESMExports()
    for (const [file, bytes] of untouchedBytes)
      assert.deepEqual(
        fs.readFileSync(file),
        bytes,
        'UX updates never mutate Goal/Evidence/project artifacts',
      )
    assert.deepEqual(
      fs.readdirSync(cwd),
      ['opaque-artifact.txt'],
      'no product files or executor side effects',
    )
    const priorId = current().id,
      beforeNewSession = fs.readFileSync(statePath),
      previousCtx = ctx,
      previousDefinitions = new Map(defs)
    await session.extensionRunner.emit({
      type: 'session_shutdown',
      reason: 'new',
    })
    session.dispose()
    session = undefined
    const secondLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: settings,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ['mcp'],
      additionalExtensionPaths: [observer],
      extensionFactories: [
        (pi) =>
          pi.events.on('fixture:ux-workflow-context', (value) => {
            ctx = value.ctx
            tools = value.tools
          }),
      ],
    })
    await secondLoader.reload()
    assert.deepEqual(secondLoader.getExtensions().errors, [])
    defs.clear()
    for (const extension of secondLoader.getExtensions().extensions)
      for (const item of extension.tools.values()) defs.set(item.definition.name, item.definition)
    ;({ session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager: settings,
      resourceLoader: secondLoader,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: sdk.SessionManager.create(cwd, path.join(stagedRoot, 'sessions')),
    }))
    await session.bindExtensions({
      mode: 'rpc',
      uiContext: {
        confirm: (...args) => confirm(...args),
        notify() {},
        setStatus() {},
        setWidget() {},
        setWorkingMessage() {},
      },
    })
    assert.equal(
      (await read()).workflow,
      null,
      'new native session never falls back to sole existing workflow or attaches it',
    )
    assert.deepEqual(fs.readFileSync(statePath), beforeNewSession)
    assert.equal(current().id, priorId)
    await assert.rejects(
      previousDefinitions
        .get('mh_get_ux_workflow')
        .execute('old-context', {}, undefined, undefined, previousCtx),
    )
    assert.equal(requests, 0)
    fs.writeFileSync(
      path.join(stagedRoot, 'ux-receipt.json'),
      JSON.stringify(
        {
          actualPublicSDK: true,
          patchedOwner: true,
          requests,
          matrixCases,
          confirmedHumanPath: true,
          ordinaryMetadataWithoutConfirm: true,
          opaqueRefsNeverRead: true,
          sourceOnly: true,
          unsupported: ['force unlock', 'session move', 'human fork'],
        },
        null,
        2,
      ),
    )
  } finally {
    try {
      if (session)
        await session.extensionRunner.emit({
          type: 'session_shutdown',
          reason: 'quit',
        })
    } finally {
      session?.dispose()
      globalThis.fetch = saved.fetch
      fs.readFileSync = originalRead
      fs.openSync = originalOpen
      syncBuiltinESMExports()
    }
    if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = saved.agent
  }
})
