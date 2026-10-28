import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import type { ExtensionAPI, ExtensionContext, BeforeAgentStartEvent } from '@earendil-works/pi-coding-agent'
import type { KernelNode, KernelRegistry } from '../lib/kernel/types.ts'
import { nodes } from '../lib/kernel/registry.mjs'
import {
  registerTerraPersistence,
  TERRA_PERSISTENCE_GUIDANCE as guidance,
  TERRA_PERSISTENCE_SECTION as section,
} from '../lib/terra-persistence.ts'
import { registerSessionTasks } from '../lib/session-work/tasks.ts'

const registry = nodes as KernelRegistry

test('exact-model/run/identity gates strip only the owned section and never start work', async () => {
  type Handler = (event: any, ctx: ExtensionContext) => unknown
  const handlers = new Map<string, Handler>()
  let disabled = false
  const pi = {
    registerFlag() {},
    getFlag: () => disabled,
    on(name: string, handler: Handler) {
      handlers.set(name, handler)
    },
  } as unknown as ExtensionAPI
  registerTerraPersistence(pi)
  assert.deepEqual([...handlers.keys()], ['before_agent_start'], 'no continuation or execution hooks')
  const manager = { getSessionId: () => 'terra-unit' }
  let primary = true
  registry.set('terra-unit', {
    isPrimarySession: (ctx: ExtensionContext) => primary && ctx.sessionManager === manager,
  } as unknown as KernelNode)
  try {
    for (const variant of [
      'terra',
      'repeat',
      'other-id',
      'other-provider',
      'undefined-model',
      'custom',
      'child',
      'wrong-manager',
      'role',
      'memory-worker',
      'disabled',
      'forced',
      'missing-kernel',
    ]) {
      disabled = variant === 'disabled'
      primary = variant !== 'child'
      const options: BeforeAgentStartEvent['systemPromptOptions'] = {
        cwd: '/fixture',
        customPrompt: 'Persona',
        appendSystemPrompt: 'Append owner',
        sections: { other: 'Other section', [section]: 'stale' },
        contextFiles: [{ path: '/Core.md', content: 'Core unchanged' }],
        selectedTools: [],
        hiddenTools: [],
        toolSnippets: {},
        toolGuidelines: {},
        promptGuidelines: [],
        skills: [],
      }
      if (variant === 'forced') options.forceSystemPrompt = 'Opaque owner text'
      const before = structuredClone(options)
      const ctx = {
        sessionManager: variant === 'wrong-manager' ? { ...manager } : manager,
        model:
          variant === 'undefined-model'
            ? undefined
            : {
                provider: variant === 'other-provider' ? 'azure' : 'openai',
                id: variant === 'other-id' ? 'gpt-6.1-terra-preview' : 'gpt-6.1-terra',
              },
      } as unknown as ExtensionContext
      if (variant === 'missing-kernel') registry.delete('terra-unit')
      const event = {
        messageType: variant === 'custom' ? 'custom' : 'user',
        prompt: 'Do the authorized work',
        images: [{ type: 'image', data: 'unchanged' }],
        systemPrompt:
          variant === 'role'
            ? '<active_agent name="implementer"/>'
            : variant === 'memory-worker'
              ? "You maintain the primary companion's private managed knowledge"
              : 'Persona',
        systemPromptOptions: options,
      }
      assert.equal(handlers.get('before_agent_start')!(event, ctx), undefined)
      const expected = structuredClone(before)
      delete expected.sections[section]
      if (variant === 'terra' || variant === 'repeat') expected.sections[section] = guidance
      assert.deepEqual(options, expected, variant)
      assert.equal(event.prompt, 'Do the authorized work')
      assert.equal(event.images[0].data, 'unchanged')
    }
  } finally {
    registry.delete('terra-unit')
  }
})

test('advisory encodes checkpoint positives and question/stop/approval negatives, not behavior proof', () => {
  for (const phrase of [
    'promising to start',
    'recommending that same work',
    'permission already granted',
    'investigation, implementation and verification',
    'intermediate checkpoint',
    'scan, plan, partial edit or test',
    'Questions remain questions',
    'research-only, plan-only, no-edit',
    'human stop/pause',
    'actual blocker',
    'changed scope',
    'required approval',
    'do not guess through a blocker',
    'Do not manufacture extra work',
    'commit, push, publish',
    'profile change or automatic continuation',
    'unrun checks or human acceptance',
  ])
    assert.ok(guidance.includes(phrase), phrase)
  assert.ok(guidance.length < 2400)
})

test('public SDK/Faux: section survives memory-like replacement then real Todos override; switches and reload are clean', async () => {
  const sdk = await import('@earendil-works/pi-coding-agent')
  const ai = await import('@earendil-works/pi-ai')
  const base = resolve('.agent-state/runtime')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'terra-persistence-'))
  const modelRuntime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  // Exact identifiers, deterministic Faux transport only: no Terra inference/auth/network.
  const faux = ai.fauxProvider({ provider: 'openai', models: [{ id: 'gpt-6.1-terra' }, { id: 'other' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const errors: unknown[] = []
  let disabled = false
  let memoryEnabled = true
  let runtime: Awaited<ReturnType<typeof sdk.createAgentSessionRuntime>> | undefined
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('External network forbidden')
  }
  try {
    runtime = await sdk.createAgentSessionRuntime(
      async ({ sessionManager, sessionStartEvent }) => {
        const settingsManager = sdk.SettingsManager.inMemory({
          defaultTools: [],
          cacheWarming: 'off',
          compaction: { enabled: false },
          retry: { enabled: false },
        })
        const services = await sdk.createAgentSessionServices({
          cwd: dir,
          agentDir: dir,
          settingsManager,
          modelRuntime,
          resourceLoaderOptions: {
            noExtensions: true,
            noSkills: true,
            noContextFiles: true,
            noThemes: true,
            noPromptTemplates: true,
            disabledBuiltinExtensions: ['mcp', 'codemode', 'tool-search', 'llama.cpp'],
            systemPrompt: 'Canonical persona',
            extensionFactories: [
              (pi) => {
                // Identity fixture stands in for the kernel, not an alternate production classifier.
                let generation: object
                pi.on('session_start', (_event, ctx) => {
                  generation = {}
                  const manager = ctx.sessionManager
                  registry.set(manager.getSessionId(), {
                    generation,
                    isPrimarySession: (candidate: ExtensionContext) =>
                      candidate.sessionManager === manager && !manager.getHeader()?.parentSession,
                  } as unknown as KernelNode)
                })
                pi.on('session_shutdown', (_event, ctx) => {
                  const id = ctx.sessionManager.getSessionId()
                  if (registry.get(id)?.generation === generation) registry.delete(id)
                })
                const getFlag = pi.getFlag.bind(pi)
                pi.getFlag = (name) =>
                  name === 'mahiro-terra-persistence-disable' ? disabled : getFlag(name)
                registerTerraPersistence(pi)
              },
              (pi) => {
                // Same public replacement pattern as upstream maintained-memory owner.
                pi.on('before_agent_start', (event) => {
                  event.systemPromptOptions.sections.fixture_other = 'OTHER SECTION'
                  if (memoryEnabled)
                    return {
                      systemPrompt: `${event.systemPrompt}\n<mahiro-managed-memory>CORE FIXTURE</mahiro-managed-memory>`,
                    }
                })
              },
              registerSessionTasks,
            ],
          },
        })
        assert.deepEqual(services.resourceLoader.getExtensions().errors, [])
        const result = await sdk.createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
          model: faux.getModel('gpt-6.1-terra'),
          noTools: 'all',
        })
        await result.session.bindExtensions({ onError: (error) => errors.push(error) })
        return { ...result, services, diagnostics: services.diagnostics }
      },
      { cwd: dir, agentDir: dir, sessionManager: sdk.SessionManager.inMemory(dir) },
    )
    async function request(text: string, expected: boolean) {
      let calls = 0
      let serialized = ''
      const start = runtime!.session.messages.length
      faux.setResponses([
        (context) => {
          calls++
          serialized = JSON.stringify(context)
          return ai.fauxAssistantMessage('Checkpoint only: deliberately no automatic continuation.')
        },
      ])
      await runtime!.session.prompt(text)
      assert.equal(calls, 1, 'a partial response never forces another request')
      assert.equal(serialized.includes('Terra persistence pilot'), expected, text)
      assert.equal(serialized.split('Terra persistence pilot').length - 1, expected ? 1 : 0)
      assert.match(serialized, /Canonical persona/)
      assert.match(serialized, /OTHER SECTION/)
      assert.equal(serialized.includes('CORE FIXTURE'), memoryEnabled)
      assert.match(serialized, /Session-step guidance/)
      const messages = runtime!.session.messages.slice(start)
      const assistant = messages.findLast((message) => message.role === 'assistant')
      assert.equal(assistant?.stopReason, 'stop')
      assert.match(
        JSON.stringify(assistant?.content),
        /Checkpoint only: deliberately no automatic continuation/,
      )
    }
    await request('Scan then implement then verify within approved scope', true)
    await runtime.session.setModel(faux.getModel('other')!)
    await request('Other model', false)
    await runtime.session.setModel(faux.getModel('gpt-6.1-terra')!)
    await request('Terra again', true)
    disabled = true
    await request('Disabled pilot', false)
    disabled = false
    memoryEnabled = false
    await request('No memory replacement', true)
    await runtime.session.reload()
    await request('Fresh extension generation', true)
    assert.deepEqual(errors, [])
  } finally {
    await runtime?.dispose()
    globalThis.fetch = savedFetch
    rmSync(dir, { recursive: true, force: true })
  }
})
