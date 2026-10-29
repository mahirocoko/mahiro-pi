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
import * as ai from '@earendil-works/pi-ai'
import * as sdk from '@earendil-works/pi-coding-agent'
import { canonicalGitDirectoryName } from '../lib/agent-memory/local/contracts.ts'
import {
  createModelMaintenanceWorker,
  modelMaintenanceLimits,
  modelMaintenanceToolNames,
  type ModelMaintenanceFailure,
  type ModelMaintenanceRoute,
} from '../lib/agent-memory/local/model-worker.ts'
import { createSyntheticLocalMemoryService, type LocalWorker } from '../lib/agent-memory/local/service.ts'
import {
  type MaintenanceWorker,
  type SyntheticPublicEntry,
  type TrajectoryRole,
  type TrajectoryWorkerView,
} from '../lib/agent-memory/local/trajectory.ts'
import type { MaintenanceWorkspace } from '../lib/agent-memory/local/workspace.ts'

const initialFiles = { 'Core.md': 'base\n' }
const forbiddenTools = [
  'bash',
  'powershell',
  'read',
  'write',
  'edit',
  'grep',
  'find',
  'ls',
  'codemode',
  'tool_search',
]
const ordinary: LocalWorker = () => {
  throw Error('ordinary worker ran')
}

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-model-worker-'))
  const stateRoot = join(dir, 'state')
  const hooks = join(dir, 'hooks')
  mkdirSync(stateRoot, { mode: 0o700 })
  mkdirSync(hooks, { mode: 0o700 })
  const bare = () => join(stateRoot, canonicalGitDirectoryName)
  const git = (cwd: string | undefined, args: string[]) =>
    execFileSync(
      'git',
      [
        ...(cwd ? ['-C', cwd] : ['--git-dir', bare()]),
        '-c',
        `core.hooksPath=${hooks}`,
        '-c',
        'credential.helper=',
        '-c',
        'core.fsmonitor=',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Synthetic Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        ...args,
      ],
      { encoding: 'utf8' },
    ).trim()
  return {
    dir,
    stateRoot,
    git,
    close() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function entry(
  sessionId: string,
  branchId: string,
  entryId: string,
  role: TrajectoryRole,
  text: string,
  order: number,
): SyntheticPublicEntry {
  return {
    sessionId,
    branchId,
    entryId,
    role,
    text,
    order,
    timestamp: `2026-10-29T00:00:${String(order).padStart(2, '0')}Z`,
  }
}

async function openRoute(deadlineMs?: number): Promise<{
  faux: ReturnType<typeof ai.fauxProvider>
  modelRuntime: sdk.ModelRuntime
  worker: MaintenanceWorker
}> {
  const modelRuntime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({
    provider: 'faux',
    models: [{ id: 'memory-maintenance', input: ['text'], reasoning: false }],
  })
  modelRuntime.registerNativeProvider(faux.provider)
  const route: ModelMaintenanceRoute = { model: faux.getModel(), modelRuntime, deadlineMs }
  return { faux, modelRuntime, worker: createModelMaintenanceWorker(route) }
}

function maintenanceLanes(): string[] {
  return readdirSync(realpathSync(tmpdir())).filter((name) => name.startsWith('mahiro-model-maintenance-'))
}

async function expectFailure(run: () => Promise<unknown>, failure: ModelMaintenanceFailure) {
  await assert.rejects(run, (error: Error) => {
    assert.equal(error.message, `Local memory model worker ${failure}`)
    return true
  })
}

function requiredJob<T extends { id: string }>(job: T | null): T {
  assert.ok(job)
  return job
}

function serviceOptions(stateRoot: string, maintenance: MaintenanceWorker) {
  return {
    stateRoot,
    initialFiles,
    worker: ordinary,
    trajectory: { policy: 'step-count' as const, stepCount: 1, maintenance },
  }
}

function declaredTools(messages: readonly unknown[]) {
  const tools: { name: string; parameters?: { required?: string[]; additionalProperties?: boolean } }[] = []
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const added = (
      message as { toolsAdded?: { name?: string; parameters?: (typeof tools)[number]['parameters'] }[] }
    ).toolsAdded
    if (!added) continue
    for (const tool of added) if (tool.name) tools.push({ name: tool.name, parameters: tool.parameters })
  }
  return tools
}

function textOf(messages: readonly unknown[]): string {
  return JSON.stringify(messages)
}

test('public SDK/Faux adapter keeps a bounded prompt, memory tools, and coordinator publication', async () => {
  const fx = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(fx.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const tail = 'TAILMARKER-UNIQUE'
    const entries = [entry(sessionId, branchId, 'entry-1', 'user', `${'A'.repeat(256)}${tail}`, 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    assert.ok(queued.job)
    assert.ok(queued.range)
    assert.equal(queued.range.truncatedEntryCount, 1)
    assert.equal(queued.range.entries[0]?.text.includes(tail), false)
    const jobId = queued.job.id
    let prompt = ''
    opened.faux.setResponses([
      (context) => {
        prompt = textOf(context.messages)
        return ai.fauxAssistantMessage(
          [ai.fauxToolCall('memory_write', { path: 'memory/learned.md', text: 'learned\n' })],
          { stopReason: 'toolUse' },
        )
      },
      (context) => {
        const record = JSON.parse(readFileSync(join(fx.stateRoot, 'jobs', `${jobId}.json`), 'utf8')) as {
          status: string
          workerCommit: string | null
          baseHead: string
          worktreePath: string
        }
        assert.equal(record.status, 'running')
        assert.equal(record.workerCommit, null)
        assert.equal(fx.git(record.worktreePath, ['rev-parse', 'HEAD']), record.baseHead)
        const body = textOf(context.messages)
        assert.equal(body.includes(fx.stateRoot), false)
        assert.equal(body.includes(record.worktreePath), false)
        return ai.fauxAssistantMessage('done')
      },
    ])
    assert.equal((await service.start(jobId)).status, 'committed')
    const tools = declaredTools(JSON.parse(prompt) as unknown[])
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [...modelMaintenanceToolNames].sort(),
      prompt.slice(0, 800),
    )
    for (const name of forbiddenTools)
      assert.equal(
        tools.some((tool) => tool.name === name),
        false,
      )
    const writeTool = tools.find((tool) => tool.name === 'memory_write')
    assert.deepEqual(writeTool?.parameters?.required?.slice().sort(), ['path', 'text'])
    assert.equal(writeTool?.parameters?.additionalProperties, false)
    assert.equal(prompt.includes(tail), false)
    assert.equal(prompt.includes(queued.range.digest), true)
    assert.equal(prompt.includes(fx.stateRoot), false)
    assert.equal((await service.integrate(jobId)).status, 'integrated')
    assert.equal(await service.readCommitted('memory/learned.md'), 'learned\n')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 1)
    assert.equal(opened.faux.state.callCount, 2)
  } finally {
    fx.close()
  }
})

test('a completed model maintenance restart does not launch another session', async () => {
  const fx = fixture()
  try {
    const opened = await openRoute()
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'assistant', 'No change is needed', 1)]
    const first = await createSyntheticLocalMemoryService(serviceOptions(fx.stateRoot, opened.worker))
    const queued = await first.reflect({ sessionId, branchId, entries })
    assert.ok(queued.job)
    opened.faux.setResponses([ai.fauxAssistantMessage('Nothing to change.')])
    assert.equal((await first.start(queued.job.id)).status, 'noop')
    assert.equal((await first.watermark({ sessionId, branchId })).entryId, 'entry-1')
    assert.equal(opened.faux.state.callCount, 1)
    const second = await createSyntheticLocalMemoryService(serviceOptions(fx.stateRoot, opened.worker))
    const idle = await second.reflect({ sessionId, branchId, entries })
    assert.equal(idle.action, 'idle')
    assert.equal(idle.reason, 'consumed')
    assert.equal(idle.job?.id, queued.job.id)
    assert.equal(opened.faux.state.callCount, 1)
  } finally {
    fx.close()
  }
})

test('provider, cancellation, overflow, and malformed model results stay failed and retry reuses the snapshot', async () => {
  const provider = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(provider.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'user', 'Remember the port is 4312', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    assert.ok(queued.range)
    const digest = queued.range.digest
    opened.faux.setResponses([
      ai.fauxAssistantMessage('upstream down', { stopReason: 'error', errorMessage: 'upstream down' }),
    ])
    await assert.rejects(
      () => service.start(job.id),
      (error: Error) => {
        assert.equal(error.message, 'Local memory model worker provider')
        return true
      },
    )
    assert.equal((await service.job(job.id)).status, 'failed')
    assert.equal((await service.job(job.id)).reflection?.digest, digest)
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
    const callsAfterFailure = opened.faux.state.callCount
    const retried = await service.retry(job.id)
    assert.equal(retried.status, 'queued')
    assert.equal(retried.reflection?.digest, digest)
    assert.equal(opened.faux.state.callCount, callsAfterFailure)
    opened.faux.setResponses([
      ai.fauxAssistantMessage(
        [ai.fauxToolCall('memory_write', { path: 'memory/learned.md', text: 'kept\n' })],
        {
          stopReason: 'toolUse',
        },
      ),
      ai.fauxAssistantMessage('kept'),
    ])
    assert.equal((await service.start(job.id)).status, 'committed')
    assert.equal((await service.integrate(job.id)).status, 'integrated')
    assert.equal((await service.watermark({ sessionId, branchId })).rangeDigest, digest)
    assert.equal(await service.readCommitted('memory/learned.md'), 'kept\n')
  } finally {
    provider.close()
  }

  const refused = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(refused.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'user', 'Remember the port is 4312', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    const secret = 'hidden-chain-secret'
    opened.faux.setResponses([
      ai.fauxAssistantMessage(secret, { stopReason: 'aborted', errorMessage: secret }),
    ])
    await assert.rejects(
      () => service.start(job.id),
      (error: Error) => {
        assert.equal(error.message, 'Local memory model worker cancelled')
        return true
      },
    )
    assert.equal((await service.job(job.id)).status, 'failed')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
  } finally {
    refused.close()
  }

  const overflow = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(overflow.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'user', 'Remember the port is 4312', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    opened.faux.setResponses([
      ai.fauxAssistantMessage('Z'.repeat(modelMaintenanceLimits.maxAggregateAssistantTextBytes + 1)),
    ])
    await assert.rejects(() => service.start(job.id), /model worker overflow/)
    assert.equal((await service.job(job.id)).status, 'failed')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
  } finally {
    overflow.close()
  }

  const malformed = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(
      serviceOptions(malformed.stateRoot, opened.worker),
    )
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'tool', 'result', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    opened.faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall('memory_write', { path: '../secret.md', text: 'nope' })], {
        stopReason: 'toolUse',
      }),
    ])
    await assert.rejects(() => service.start(job.id), /model worker malformed/)
    assert.equal((await service.job(job.id)).status, 'failed')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
  } finally {
    malformed.close()
  }
})

test('a model worker conflict stays repair-needed and does not publish or relaunch', async () => {
  const fx = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(fx.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'assistant', 'Rewrite core', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    assert.ok(queued.range)
    opened.faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall('memory_write', { path: 'Core.md', text: 'from worker\n' })], {
        stopReason: 'toolUse',
      }),
      ai.fauxAssistantMessage('updated'),
    ])
    assert.equal((await service.start(job.id)).status, 'committed')
    const calls = opened.faux.state.callCount
    const side = join(fx.dir, 'side')
    fx.git(undefined, ['worktree', 'add', side, 'main'])
    writeFileSync(join(side, 'Core.md'), 'parent\n')
    fx.git(side, ['add', '--', 'Core.md'])
    fx.git(side, ['commit', '-m', 'parent core'])
    const blocked = await service.integrate(job.id)
    assert.equal(blocked.status, 'repair-needed')
    assert.deepEqual(blocked.conflictPaths, ['Core.md'])
    assert.equal(await service.readCommitted('Core.md'), 'parent\n')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
    await assert.rejects(() => service.retry(job.id), /repair blocked/)
    const resumed = await service.reflect({ sessionId, branchId, entries })
    assert.equal(resumed.job?.id, job.id)
    assert.equal(resumed.job?.status, 'repair-needed')
    assert.equal(resumed.range?.digest, queued.range.digest)
    assert.equal(opened.faux.state.callCount, calls)
  } finally {
    fx.close()
  }
})

test('aggregate assistant text, tool results, and arguments fail closed', async () => {
  const assistant = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(
      serviceOptions(assistant.stateRoot, opened.worker),
    )
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'user', 'Remember the port is 4312', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    const chunk = 'A'.repeat(Math.floor(modelMaintenanceLimits.maxAggregateAssistantTextBytes / 2) + 1)
    opened.faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxText(chunk), ai.fauxToolCall('memory_read', { path: 'Core.md' })], {
        stopReason: 'toolUse',
      }),
      ai.fauxAssistantMessage(chunk),
    ])
    await expectFailure(() => service.start(job.id), 'overflow')
    assert.equal((await service.job(job.id)).status, 'failed')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
    assert.ok(chunk.length < modelMaintenanceLimits.maxAggregateAssistantTextBytes)
  } finally {
    assistant.close()
  }

  const results = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService({
      stateRoot: results.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'notes.md': 'N'.repeat(5_000) },
      worker: ordinary,
      trajectory: { policy: 'step-count', stepCount: 1, maintenance: opened.worker },
    })
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'user', 'Read the notes', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    opened.faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall('memory_read', { path: 'notes.md' })], {
        stopReason: 'toolUse',
      }),
      ai.fauxAssistantMessage([ai.fauxToolCall('memory_read', { path: 'notes.md' })], {
        stopReason: 'toolUse',
      }),
      ai.fauxAssistantMessage('done'),
    ])
    await expectFailure(() => service.start(job.id), 'overflow')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
    assert.equal(await service.readCommitted('notes.md'), `${'N'.repeat(5_000)}`)
  } finally {
    results.close()
  }

  const args = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(args.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'assistant', 'Rewrite core', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    opened.faux.setResponses([
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall('memory_write', {
            path: 'Core.md',
            text: 'Q'.repeat(modelMaintenanceLimits.maxAggregateToolArgumentBytes),
          }),
        ],
        { stopReason: 'toolUse' },
      ),
    ])
    await expectFailure(() => service.start(job.id), 'overflow')
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
  } finally {
    args.close()
  }
})

test('invalid tool calls consume the call budget and a later write does not mutate', async () => {
  const unknown = fixture()
  try {
    const before = maintenanceLanes()
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(unknown.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'tool', 'result', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    opened.faux.setResponses([
      ai.fauxAssistantMessage(
        Array.from({ length: modelMaintenanceLimits.maxAggregateToolCalls + 1 }, () =>
          ai.fauxToolCall('bash', { command: 'uname' }),
        ),
        { stopReason: 'toolUse' },
      ),
    ])
    await expectFailure(() => service.start(job.id), 'overflow')
    assert.equal(opened.faux.state.callCount, 1)
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
    assert.deepEqual(maintenanceLanes(), before)
  } finally {
    unknown.close()
  }

  const invalid = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(invalid.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'tool', 'result', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    opened.faux.setResponses([
      ai.fauxAssistantMessage(
        Array.from({ length: modelMaintenanceLimits.maxAggregateToolCalls + 1 }, () =>
          ai.fauxToolCall('memory_write', { unexpected: true }),
        ),
        { stopReason: 'toolUse' },
      ),
      ai.fauxAssistantMessage('second'),
    ])
    await expectFailure(() => service.start(job.id), 'overflow')
    assert.equal(opened.faux.state.callCount, 1)
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
  } finally {
    invalid.close()
  }

  const mixed = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(mixed.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'assistant', 'Rewrite core', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    opened.faux.setResponses([
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall('memory_write', { path: '../secret.md', text: 'nope' }),
          ai.fauxToolCall('memory_write', { path: 'Core.md', text: 'mutated\n' }),
        ],
        { stopReason: 'toolUse' },
      ),
    ])
    await expectFailure(() => service.start(job.id), 'malformed')
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
  } finally {
    mixed.close()
  }
})

test('thinking is malformed, timeout is cooperative, and cleanup stays sanitized', async () => {
  const thinking = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(thinking.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'user', 'Remember the port is 4312', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    const secret = 'hidden-chain-secret'
    opened.faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxThinking(secret), ai.fauxText('ordinary note')], {
        stopReason: 'stop',
      }),
    ])
    await expectFailure(() => service.start(job.id), 'malformed')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
  } finally {
    thinking.close()
  }

  const timed = fixture()
  try {
    const before = maintenanceLanes()
    const opened = await openRoute(50)
    const service = await createSyntheticLocalMemoryService(serviceOptions(timed.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'user', 'Remember the port is 4312', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    let honored = false
    opened.faux.setResponses([
      (_context, options) =>
        new Promise((resolve) => {
          const signal = options?.signal
          const late = setTimeout(() => resolve(ai.fauxAssistantMessage('late-secret')), 2_000)
          const stop = () => {
            clearTimeout(late)
            honored = true
            resolve(
              ai.fauxAssistantMessage('stopped', {
                stopReason: 'aborted',
                errorMessage: 'secret-abort-path',
              }),
            )
          }
          if (signal?.aborted) stop()
          else signal?.addEventListener('abort', stop, { once: true })
        }),
    ])
    await expectFailure(() => service.start(job.id), 'timeout')
    assert.equal(honored, true)
    assert.equal(opened.faux.state.callCount, 1)
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
    assert.deepEqual(maintenanceLanes(), before)
  } finally {
    timed.close()
  }

  const broken = fixture()
  try {
    const before = maintenanceLanes()
    const opened = await openRoute()
    const worker = createModelMaintenanceWorker({
      model: { provider: 'missing', id: 'missing', api: 'missing' } as never,
      modelRuntime: opened.modelRuntime,
    })
    const service = await createSyntheticLocalMemoryService(serviceOptions(broken.stateRoot, worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'user', 'Remember the port is 4312', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    await expectFailure(() => service.start(job.id), 'provider')
    assert.deepEqual(maintenanceLanes(), before)
  } finally {
    broken.close()
  }
})

test('a huge unknown tool name stays out of later requests and length stays overflow', async () => {
  const named = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(serviceOptions(named.stateRoot, opened.worker))
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'tool', 'result', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    const rawName = `unknown-${'U'.repeat(modelMaintenanceLimits.maxAggregateToolCallBytes)}`
    const requests: string[] = []
    opened.faux.setResponses([
      (context) => {
        requests.push(JSON.stringify(context.messages))
        return ai.fauxAssistantMessage([ai.fauxToolCall(rawName, { command: 'nope' })], {
          stopReason: 'toolUse',
        })
      },
      (context) => {
        requests.push(JSON.stringify(context.messages))
        return ai.fauxAssistantMessage('second')
      },
    ])
    await expectFailure(() => service.start(job.id), 'overflow')
    assert.equal(opened.faux.state.callCount, 1)
    assert.equal(
      requests.some((body) => body.includes(rawName)),
      false,
    )
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
  } finally {
    named.close()
  }

  const truncated = fixture()
  try {
    const opened = await openRoute()
    const service = await createSyntheticLocalMemoryService(
      serviceOptions(truncated.stateRoot, opened.worker),
    )
    const sessionId = 'session-a'
    const branchId = 'line-a'
    const entries = [entry(sessionId, branchId, 'entry-1', 'assistant', 'Rewrite core', 1)]
    const queued = await service.reflect({ sessionId, branchId, entries })
    const job = requiredJob(queued.job)
    opened.faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall('memory_write', { path: 'Core.md', text: 'truncated\n' })], {
        stopReason: 'length',
      }),
      ai.fauxAssistantMessage('second'),
    ])
    await expectFailure(() => service.start(job.id), 'overflow')
    assert.equal(opened.faux.state.callCount, 1)
    assert.equal(await service.readCommitted('Core.md'), 'base\n')
    assert.equal((await service.watermark({ sessionId, branchId })).order, 0)
  } finally {
    truncated.close()
  }
})

test('an oversized trajectory fails before a model session starts', async () => {
  let called = false
  const workspace = {
    read() {
      called = true
      return ''
    },
    list() {
      called = true
      return []
    },
    search() {
      called = true
      return []
    },
    write() {
      called = true
    },
    edit() {
      called = true
    },
    delete() {
      called = true
    },
    rename() {
      called = true
    },
  } satisfies MaintenanceWorkspace
  const view: TrajectoryWorkerView = {
    sessionId: 'session-a',
    branchId: 'line-a',
    digest: 'a'.repeat(64),
    startEntryId: 'entry-1',
    endEntryId: 'entry-1',
    entryCount: 1,
    byteCount: 1,
    omittedEntryCount: 0,
    truncatedEntryCount: 0,
    preservedPreCompactionCount: 0,
    entries: [
      {
        sessionId: 'session-a',
        branchId: 'line-a',
        entryId: 'entry-1',
        role: 'user',
        text: 'x'.repeat(modelMaintenanceLimits.maxPromptBytes),
        order: 1,
        timestamp: '2026-10-29T00:00:01Z',
        truncated: false,
      },
    ],
  }
  const worker = createModelMaintenanceWorker({ model: undefined as never, modelRuntime: undefined as never })
  await assert.rejects(async () => {
    await worker({ jobId: 'reflect-1', trajectory: view, workspace })
  }, /model worker overflow/)
  assert.equal(called, false)
})

test('extension, kernel, installer, and profile sources do not import the model adapter', () => {
  const root = join(import.meta.dirname, '..')
  const skip = new Set([join(root, 'lib/agent-memory/local/model-worker.ts')])
  const files: string[] = []
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      if (name === 'node_modules' || name === '.agent-state') continue
      const path = join(directory, name)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else if (/\.(ts|mjs|json|md)$/.test(name)) files.push(path)
    }
  }
  for (const directory of ['extensions', 'lib/kernel', 'lib/guards', 'lib/agent-memory', 'agents'])
    walk(join(root, directory))
  for (const name of ['package.json', 'install.mjs', 'bootstrap.mjs']) files.push(join(root, name))
  const hits: string[] = []
  for (const path of files) {
    if (skip.has(path)) continue
    const source = readFileSync(path, 'utf8')
    if (source.includes('model-worker') || source.includes('createModelMaintenanceWorker')) hits.push(path)
  }
  assert.deepEqual(hits, [])
  const adapter = readFileSync(join(root, 'lib/agent-memory/local/model-worker.ts'), 'utf8')
  for (const needle of ['pi-subagents', 'child_process', 'node:http', 'undici', 'auth.json', 'getAgentDir'])
    assert.equal(adapter.includes(needle), false, needle)
  const valueImports = adapter
    .split('\n')
    .filter(
      (line) =>
        line.startsWith('import ') && !line.startsWith('import type ') && line.includes('@earendil-works'),
    )
  assert.deepEqual(valueImports, [])
})
