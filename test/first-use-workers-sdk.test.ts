import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// One serial disposable host. POSIX process-group supervision bounds native cleanup and reaps
// descendants on failure; this is not a sandbox or proof of all possible network transports.
test('first-use public workers, reflection and headless commands preserve native authority', {
  skip: process.platform === 'win32' ? 'Requires POSIX process-group cleanup supervision' : false,
}, async () => {
  const evidence = fileURLToPath(new URL('../.agent-state/runtime/first-use-workers/', import.meta.url))
  fs.mkdirSync(evidence, { recursive: true, mode: 0o700 })
  const supervisor = fs.mkdtempSync(path.join(evidence, 'supervisor-'))
  const ownershipFile = path.join(supervisor, 'ownership.json')
  const child = spawn(
    process.execPath,
    [
      '--import',
      fileURLToPath(new URL('./public-dependency-loader.mjs', import.meta.url)),
      fileURLToPath(new URL('./fixtures/first-use-workers-sdk.mjs', import.meta.url)),
      '--ownership-file',
      ownershipFile,
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stdout = '',
    stderr = '',
    timedOut = false,
    spawnError: Error | undefined
  const killGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('error', (error) => {
    spawnError = error
  })
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  const deadline = setTimeout(() => {
    timedOut = true
    killGroup('SIGTERM')
    forceTimer = setTimeout(() => killGroup('SIGKILL'), 5000)
  }, 90000)
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(deadline)
  clearTimeout(forceTimer)
  // Also reap a descendant that outlived an unexpectedly exited fixture.
  killGroup('SIGKILL')
  fs.writeFileSync(path.join(supervisor, 'stdout.log'), stdout, { mode: 0o600 })
  fs.writeFileSync(path.join(supervisor, 'stderr.log'), stderr, { mode: 0o600 })
  let removedResidualDisposable = false
  if (fs.existsSync(ownershipFile)) {
    const ownership = JSON.parse(fs.readFileSync(ownershipFile, 'utf8'))
    assert.equal(ownership.pid, child.pid)
    assert.equal(path.dirname(ownership.disposable), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(ownership.disposable).startsWith('mahiro-first-use-workers-'))
    if (fs.existsSync(ownership.disposable)) {
      fs.rmSync(ownership.disposable, { recursive: true, force: true })
      removedResidualDisposable = true
    }
  }
  fs.writeFileSync(
    path.join(supervisor, 'receipt.json'),
    JSON.stringify(
      {
        ...result,
        timedOut,
        spawnError: spawnError?.message ?? null,
        removedResidualDisposable,
        deadlineMs: 90000,
        forceKillGraceMs: 5000,
        supervision: 'POSIX process group',
      },
      null,
      2,
    ),
  )
  assert.ifError(spawnError)
  assert.equal(timedOut, false, `Fixture deadline exceeded; evidence: ${supervisor}`)
  assert.equal(result.signal, null, stderr)
  assert.equal(result.code, 0, `${stdout}\n${stderr}`)
  const summary = JSON.parse(stdout.trim().split('\n').at(-1)!)
  assert.equal(summary.fatal, null, JSON.stringify(summary))
  assert.deepEqual(summary.networkObservation, {
    interceptedFetchCalls: 0,
    scope: 'fixture process globalThis.fetch only',
  })
  assert.deepEqual(summary.cleanup, { budgetMs: 10000, status: 'drained', disposableRemoved: true })
  assert.deepEqual(summary.unexpected, [])
  assert.ok(summary.successes >= 25, JSON.stringify(summary))
  assert.deepEqual(summary.exercisedTools, [
    'agent_memory_manage',
    'agent_memory_read',
    'agent_memory_reflect',
    'get_subagent_result',
    'steer_subagent',
    'subagent',
  ])
  for (const id of [
    'worker.spawn-denied',
    'worker.get-denied',
    'worker.steer-denied',
    'worker.unknown-get',
    'worker.unknown-steer',
    'worker.completed-steer',
    'reflect.tool-denied',
    'reflect.exact-root-denied',
    'reflect.child-path-denied',
    'reflect.cancelled',
  ])
    assert.ok(summary.controlIds.includes(id), `${id}: ${JSON.stringify(summary)}`)
  assert.equal(summary.reflectionPublished, true)
  assert.equal(summary.steeringObserved, true)
  assert.equal(summary.commands, 22)
  assert.equal(summary.verifiedHeadlessNoops, 7)
  assert.ok(!summary.commandResults.some((row: { id: string }) => row.id === 'command.mh-rtk-help'))
  assert.deepEqual(
    summary.commandResults.find((row: { id: string }) => row.id === 'command.mh-rtk-status'),
    {
      id: 'command.mh-rtk-status',
      outcome: 'success',
      verification: 'semantic-output',
    },
  )
  assert.ok(
    summary.commandResults.every((row: { verification: string }) =>
      ['semantic-output', 'headless-noop', 'expected-validation'].includes(row.verification),
    ),
  )
})
