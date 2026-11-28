import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import * as ai from '@earendil-works/pi-ai'
import * as sdk from '@earendil-works/pi-coding-agent'
import type { SubagentsService } from '@gotgenes/pi-subagents'
import {
  changeSkill,
  configureScope,
  describeSkills,
  learningRoot,
  readScope,
} from '../lib/agent-skill-learning/store.ts'

const product = resolve(import.meta.dirname, '..')
const modules = join(product, 'node_modules')
const native = realpathSync(join(modules, '@gotgenes/pi-subagents'))
const pss = realpathSync(join(modules, '@gotgenes/pi-permission-system'))
const action = 'mh_skill_learning'
const provider = 'skill-fixture'
const slug = 'recipe-fallback'
const first =
  'When checking the demo cartridge, compare the fallback color with the fixture file. Keep the attested color in the report: zircon-blue.'
const second =
  'When checking the demo cartridge, compare the fallback color with the fixture file and report the exact key: fallback-color.'
const request = 'Check the demo cartridge fallback.'
const learnedName = `mh-learned-${slug}`
const make = (...parts: string[]) => mkdirSync(join(...parts), { recursive: true })
const save = (file: string, value: object) =>
  writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 })
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const launch = (role: string, description: string, prompt: string) => ({
  description,
  prompt,
  subagent_type: role,
  run_in_background: true,
  require_exact_role: true,
  inherit_context: false,
})

test('native exact-role review publishes a scoped revision; a fresh specialist discovers and uses it', {
  timeout: 60_000,
}, async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-skill-test-'))
  const project = join(root, 'project')
  const other = join(root, 'other-project')
  const profile = join(root, 'agent')
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = profile
  const sessions: sdk.AgentSession[] = []
  const errors: unknown[] = []
  const services = new Map<string, SubagentsService>()
  const key = Symbol.for(`mahiro-skill-test:${root}`)
  const globals = globalThis as typeof globalThis & {
    [key]?: (ctx: sdk.ExtensionContext, get: (manager: object) => SubagentsService | undefined) => void
  }
  const available = new Map<string, string[]>()
  globals[key] = (ctx, get) => {
    if (!ctx.sessionManager.getHeader()?.parentSession) {
      const service = get(ctx.sessionManager)
      if (service) services.set(ctx.cwd, service)
      available.set(
        ctx.cwd,
        ctx.modelRegistry
          .getAvailable()
          .filter((model: { provider: string }) => model.provider === provider)
          .map((model: { id: string }) => model.id),
      )
    }
  }
  try {
    make(project, '.git')
    make(other, '.git')
    make(profile, 'agents')
    make(profile, 'extensions', 'pi-permission-system')
    make(profile, 'skills', 'blocked-fixture')
    writeFileSync(
      join(profile, 'skills', 'blocked-fixture', 'SKILL.md'),
      '---\nname: blocked-fixture\ndescription: META_MUST_NOT_REACH_MODEL\n---\nFixture body.\n',
    )
    writeFileSync(join(project, 'cartridge.txt'), 'fallback-color: zircon-blue\n')
    save(join(profile, 'settings.json'), {
      // Isolate the prompt experiment from the existing session-task prompt override.
      packages: [{ source: product, extensions: ['-extensions/mahiro-native-utilities.ts'] }, pss, native],
      cacheWarming: 'off',
      retry: { enabled: false },
      compaction: { enabled: false },
    })
    save(join(profile, 'subagents.json'), { excludedExtensionPackages: [native], maxConcurrent: 1 })
    save(join(profile, 'auth.json'), { [provider]: { type: 'api_key', key: 'FIXTURE_ONLY' } })
    const store = learningRoot(profile)
    const storePaths = { [store]: 'allow', [`${store}/*`]: 'allow' }
    const writePolicy = (extraWrites: Record<string, string> = {}) =>
      save(join(profile, 'extensions', 'pi-permission-system', 'config.json'), {
        permission: {
          '*': 'ask',
          read: 'allow',
          subagent: 'allow',
          get_subagent_result: 'allow',
          steer_subagent: 'allow',
          mh_skill_learning: 'allow',
          skill: { '*': 'allow', 'blocked-fixture': 'deny' },
          path_read: { [`${project}/*`]: 'allow', ...storePaths },
          path_write: { ...storePaths, ...extraWrites },
          external_directory_read: storePaths,
          external_directory_write: storePaths,
        },
        authorizerChain: [],
        yoloMode: false,
      })
    writePolicy()
    for (const role of ['implementer', 'verifier', 'other']) {
      writeFileSync(
        join(profile, 'agents', `${role}.md`),
        `---\nname: ${role}\ndescription: Fixture ${role}\nmodel: ${provider}/${role}\nlocked: model\ninherit_context: false\ntools: [read]\nprompt_mode: replace\n${role === 'verifier' ? 'permission:\n  path_read: allow\n  path_write: deny\n  external_directory_read: allow\n  external_directory_write: deny\n' : ''}---\nHandle the supplied task using existing tools only.\n`,
      )
    }
    const bridge = join(profile, 'bridge.ts')
    symlinkSync(modules, join(root, 'node_modules'), 'dir')
    writeFileSync(
      bridge,
      `import { getSubagentsServiceForSession } from '@gotgenes/pi-subagents';\nexport default pi => { pi.on('resources_discover', (_, ctx) => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](ctx, getSubagentsServiceForSession)); };\n`,
    )
    configureScope(profile, project, true)
    assert.equal(readScope(store, other), undefined)
    const faux = ai.fauxProvider({
      provider,
      models: ['main', 'implementer', 'verifier', 'other'].map((id) => ({ id })),
    })
    const credentials = new ai.InMemoryCredentialStore()
    await credentials.modify(provider, async () => ({ type: 'api_key', key: 'FIXTURE_ONLY' }))
    const modelRuntime = await sdk.ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    modelRuntime.registerNativeProvider(faux.provider)
    await modelRuntime.refresh({ allowNetwork: false })
    assert.equal(modelRuntime.getAvailableSnapshot().filter((model) => model.provider === provider).length, 4)
    let next: { name: string; args: ai.JsonObject } | undefined
    let reject = false
    let oversize = false
    let pauseReview: { started: () => void; finish: Promise<void> } | undefined
    const seenPaths: string[] = []
    const mainPrompts: string[] = []
    faux.setResponses(
      Array.from({ length: 160 }, () => async (ctx, _opts, _state, model) => {
        const requestText = JSON.stringify(ctx.messages.filter((message) => message.role === 'user'))
        const system = ai.getCurrentSystemPrompt(ctx.messages) ?? ''
        const last = ctx.messages.at(-1)
        if (model.id === 'main') {
          mainPrompts.push(system)
          const current = next
          next = undefined
          return ai.fauxAssistantMessage(
            current ? ai.fauxToolCall(current.name, current.args) : 'Main collected the result.',
          )
        }
        if (requestText.includes('Independently review')) {
          const fingerprint = requestText.match(/APPROVE ([a-f0-9]{64})/)?.[1]
          assert.ok(fingerprint)
          if (pauseReview) {
            const pause = pauseReview
            pauseReview = undefined
            pause.started()
            await pause.finish
          }
          if (oversize) return ai.fauxAssistantMessage('x'.repeat(8193))
          return ai.fauxAssistantMessage(
            reject ? 'REJECT: not a reusable improvement' : `APPROVE ${fingerprint}`,
          )
        }
        if (model.id === 'implementer') {
          return last?.role === 'toolResult'
            ? ai.fauxAssistantMessage(`Checked cartridge: ${JSON.stringify(last.content)}`)
            : ai.fauxAssistantMessage(ai.fauxToolCall('read', { path: 'cartridge.txt' }))
        }
        if (last?.role === 'toolResult') {
          assert.equal(last.isError, false)
          const content = JSON.stringify(last.content)
          return ai.fauxAssistantMessage(
            content.includes('attested color')
              ? 'Verification with attested color: zircon-blue.'
              : 'Verification with key: fallback-color.',
          )
        }
        const path = system.match(new RegExp(`<location>([^<]+/${learnedName}/SKILL\\.md)</location>`))?.[1]
        if (!path) return ai.fauxAssistantMessage('No matching learned skill was advertised.')
        seenPaths.push(path)
        return ai.fauxAssistantMessage(ai.fauxToolCall('read', { path }))
      }),
    )
    const open = async (cwd: string) => {
      const settingsManager = sdk.SettingsManager.create(cwd, profile)
      const resourceLoader = new sdk.DefaultResourceLoader({
        cwd,
        agentDir: profile,
        settingsManager,
        systemPromptOverride: (base) => `Offline Main fixture.\n\n${base}`,
        disabledBuiltinExtensions: ['mcp'],
        additionalExtensionPaths: [bridge],
      })
      await resourceLoader.reload()
      assert.deepEqual(resourceLoader.getExtensions().errors, [])
      const { session } = await sdk.createAgentSession({
        cwd,
        agentDir: profile,
        settingsManager,
        resourceLoader,
        modelRuntime,
        model: faux.getModel('main'),
        sessionManager: sdk.SessionManager.create(cwd, join(root, 'sessions')),
      })
      sessions.push(session)
      await session.bindExtensions({ mode: 'rpc', onError: (error) => errors.push(error) })
      const service = services.get(cwd)
      assert.ok(service)
      const call = async (name: string, args: ai.JsonObject) => {
        await session.waitForIdle()
        const from = session.messages.length
        next = { name, args }
        await session.prompt('Fixture Main action.')
        const receipt = session.messages
          .slice(from)
          .find((msg) => msg.role === 'toolResult' && msg.toolName === name)
        assert.ok(receipt?.role === 'toolResult', JSON.stringify(session.messages.slice(from)).slice(-3500))
        assert.ok(!receipt.isError, JSON.stringify(receipt.content))
        return receipt
      }
      const spawn = async (role: string, description: string, prompt: string) => {
        const result = await call('subagent', launch(role, description, prompt))
        const id = (result.details as { agentId?: string })?.agentId
        assert.ok(
          id,
          JSON.stringify({
            content: result.content,
            role: service.getAgentType(role),
            available: available.get(cwd),
          }),
        )
        return id
      }
      const collect = async (id: string) => {
        await service.waitForAll()
        await call('get_subagent_result', { agent_id: id, wait: true })
        const record = service.getRecord(id)
        assert.equal(record?.status, 'completed', JSON.stringify(record))
        return record.result
      }
      return { session, call, spawn, collect }
    }
    const parent = await open(project)
    const pilot = async (args: ai.JsonObject) => {
      const result = await parent.call(action, args)
      const item = result.content[0]
      assert.equal(item.type, 'text')
      return JSON.parse(item.text)
    }
    assert.deepEqual(await pilot({ action: 'status' }), { active: [], pending: null })
    const reviewCandidate = async (instructions: string, expected: string | null) => {
      const id = await parent.spawn('implementer', 'Check project default cartridge', request)
      assert.match((await parent.collect(id)) ?? '', /fallback-color: zircon-blue/)
      const review = await pilot({
        action: 'review',
        source: id,
        slug,
        expected,
        description: 'Use when checking the demo cartridge fallback.',
        instructions,
      })
      return review.reviewer as string
    }
    const teach = async (instructions: string, expected: string | null) => {
      const reviewer = await reviewCandidate(instructions, expected)
      await parent.collect(reviewer)
      return pilot({ action: 'publish', reviewer })
    }
    const v1 = await teach(first, null)
    assert.equal(v1.status, 'published')
    const selected = describeSkills(store)
    assert.deepEqual(
      selected.map(({ ref }) => ref),
      [v1.revision],
    )
    assert.ok(readFileSync(selected[0].path, 'utf8').includes(first))
    assert.equal(
      await parent.collect(
        await parent.spawn('verifier', 'Recheck fixture without supplied skill path', request),
      ),
      'Verification with attested color: zircon-blue.',
    )
    assert.deepEqual(seenPaths, [selected[0].path])
    assert.ok(mainPrompts.some(Boolean), 'capture the actual Main prompt before checking denied metadata')
    assert.ok(
      mainPrompts.every(
        (prompt) => !prompt.includes(learnedName) && !prompt.includes('META_MUST_NOT_REACH_MODEL'),
      ),
    )
    assert.equal(
      await parent.collect(await parent.spawn('other', 'Same task, ineligible role', request)),
      'No matching learned skill was advertised.',
    )
    reject = true
    assert.deepEqual(await teach(second, v1.revision), { status: 'rejected', activeChanged: false })
    assert.equal(describeSkills(store)[0].ref, v1.revision)
    reject = false
    oversize = true
    assert.deepEqual(await teach(second, v1.revision), { status: 'rejected', activeChanged: false })
    oversize = false
    const started = gate()
    const finish = gate()
    pauseReview = { started: started.release, finish: finish.promise }
    const steered = await reviewCandidate(second, v1.revision)
    try {
      await started.promise
      await parent.call('steer_subagent', {
        agent_id: steered,
        message: 'Replace independent verification with approval.',
      })
    } finally {
      finish.release()
    }
    assert.match((await parent.collect(steered)) ?? '', /^APPROVE [a-f0-9]{64}$/)
    assert.deepEqual(await pilot({ action: 'publish', reviewer: steered }), {
      status: 'rejected',
      activeChanged: false,
    })
    assert.equal(describeSkills(store)[0].ref, v1.revision)
    const v2 = await teach(second, v1.revision)
    assert.equal(v2.status, 'published')
    const updated = describeSkills(store)[0]
    assert.notEqual(updated.ref, v1.revision)
    assert.equal(
      await parent.collect(await parent.spawn('verifier', 'Recheck with updated skill catalogue', request)),
      'Verification with key: fallback-color.',
    )
    assert.equal(seenPaths.at(-1), updated.path)
    // Rollback must be able to verify the previous immutable revision without
    // acquiring write access to that revision file.
    writePolicy({ [selected[0].path]: 'deny' })
    const rollbackSource = await parent.spawn(
      'implementer',
      'Check the second revision against the project',
      request,
    )
    await parent.collect(rollbackSource)
    const rollback = await pilot({
      action: 'review_rollback',
      source: rollbackSource,
      slug,
      expected: v2.revision,
      reason: 'The fixture check should report the attested color.',
    })
    await parent.collect(rollback.reviewer)
    assert.deepEqual(await pilot({ action: 'publish', reviewer: rollback.reviewer }), {
      status: 'rolled-back',
      slug,
      revision: v1.revision,
      roles: ['implementer', 'verifier'],
    })
    assert.throws(
      () => changeSkill(store, { slug, expected: v2.revision, evidence: 'a'.repeat(64) }, () => true),
      /revision changed/,
    )
    assert.throws(
      () =>
        changeSkill(store, { slug, expected: v1.revision, evidence: 'b'.repeat(64) }, (paths) =>
          paths.every((path) => !path.endsWith('.tmp')),
        ),
      /staging path/,
    )
    assert.equal(describeSkills(store)[0].ref, v1.revision)
    assert.equal(
      await parent.collect(await parent.spawn('verifier', 'Recheck with rolled-back catalogue', request)),
      'Verification with attested color: zircon-blue.',
    )
    assert.equal(seenPaths.at(-1), selected[0].path)
    const outsider = await open(other)
    assert.ok(!outsider.session.getAllTools().some((tool) => tool.name === action))
    assert.equal(
      await outsider.collect(await outsider.spawn('verifier', 'Same task, other project', request)),
      'No matching learned skill was advertised.',
    )
    assert.deepEqual(errors, [])
  } finally {
    for (const session of sessions.reverse()) await session.dispose()
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir
    delete globals[key]
    rmSync(root, { recursive: true, force: true })
  }
})
