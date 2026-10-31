import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateToolCall } from '@earendil-works/pi-ai'
import * as sdk from '@earendil-works/pi-coding-agent'
import mahiroAgentMemory from '../extensions/mahiro-agent-memory.ts'

test('registered manage tool accepts bounded reflection fields and rejects the rest', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mahiro-policy-tool-'))
  try {
    const loader = new sdk.DefaultResourceLoader({
      cwd: directory,
      agentDir: join(directory, 'agent'),
      settingsManager: sdk.SettingsManager.inMemory({}),
      noSkills: true,
      noContextFiles: true,
      noThemes: true,
      noPromptTemplates: true,
      disabledBuiltinExtensions: ['mcp'],
      extensionFactories: [mahiroAgentMemory],
    })
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    const manage = loader
      .getExtensions()
      .extensions.flatMap((extension) => [...extension.tools.values()])
      .map((tool) => tool.definition)
      .find((tool) => tool.name === 'agent_memory_manage')
    assert.ok(manage)
    const accepted = validateToolCall([manage], {
      type: 'toolCall',
      id: 'policy-fields',
      name: 'agent_memory_manage',
      arguments: {
        action: 'policy',
        automatic: true,
        reflectionTrigger: 'step-count',
        reflectionStepCount: 1,
      },
    })
    assert.equal(accepted.reflectionTrigger, 'step-count')
    assert.equal(accepted.reflectionStepCount, 1)
    const capacity = validateToolCall([manage], {
      type: 'toolCall',
      id: 'capacity-action',
      name: 'agent_memory_manage',
      arguments: { action: 'capacity' },
    })
    assert.equal(capacity.action, 'capacity')
    const rejected: { [key: string]: string | number | boolean }[] = [
      { action: 'policy', automatic: true, reflectionTrigger: 'weekly', reflectionStepCount: 1 },
      { action: 'policy', automatic: true, reflectionTrigger: 'step-count', reflectionStepCount: 0 },
      { action: 'policy', automatic: true, reflectionTrigger: 'step-count', reflectionStepCount: 100001 },
      { action: 'policy', automatic: true, reflectionMode: 'step-count' },
      { action: 'capacity', reflectionMode: 'status' },
    ]
    for (const arguments_ of rejected)
      assert.throws(
        () =>
          validateToolCall([manage], {
            type: 'toolCall',
            id: 'policy-reject',
            name: 'agent_memory_manage',
            arguments: arguments_,
          }),
        /Validation failed/,
      )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
