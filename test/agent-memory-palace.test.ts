import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMemoryPalace,
  directoryIndex,
  directoryPage,
  extractFrontmatterAndLinks,
  palaceReplyBytes,
  type PalaceInput,
} from '../lib/agent-memory/retrieval.ts'
import { validateReply } from '../lib/agent-memory/engine/replies.ts'
import { encode, transportLimits } from '../lib/agent-memory/engine/protocol.ts'
import { allowedPath, isAlwaysLoadedTieredPath } from '../lib/agent-memory/engine/schema.ts'

function inputFor(activePaths: string[], body = ''): PalaceInput {
  return {
    revision: 'a'.repeat(40),
    project: 'project',
    config: { coreBytes: 32768, indexBytes: 8192, fileBytes: 262144, totalBytes: 8388608 },
    activePaths,
    fileSizes: Object.fromEntries(activePaths.map((path) => [path, Buffer.byteLength(body)])),
    fileSources: {},
    fileTexts: Object.fromEntries(activePaths.map((path) => [path, body])),
    views: { total: 0, open: 0, conflict: 0, committed: 0, cancelled: 0 },
    episodes: { total: 0, reviewed: 0 },
    tombstones: { forgottenPaths: 0, forgottenSources: 0 },
    pendingOperations: [],
  }
}
const request = { action: 'palace', project: 'project' }
function checkReply(palace: ReturnType<typeof buildMemoryPalace>) {
  const reply = { palace }
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= palaceReplyBytes)
  validateReply('manage', request, reply)
  const frame = encode(
    { v: 2, epoch: 'e'.repeat(36), id: 'i'.repeat(36), result: reply },
    transportLimits.reply,
  )
  assert.deepEqual(JSON.parse(frame.toString()).result, reply)
  assert.equal(palace.coverage.layersTruncated, palace.coverage.filesTruncated)
  assert.deepEqual(Object.values(palace.layers).flat().sort(), palace.files.map((file) => file.path).sort())
}

test('palace bounds 1024 complete long paths including repeated layer metadata', () => {
  const paths = Array.from(
    { length: 1024 },
    (_, i) =>
      `archives/${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}/${String(i).padStart(64, '0')}.md`,
  )
  assert.ok(paths.every((path) => allowedPath(path)))
  const palace = buildMemoryPalace(inputFor(paths))
  assert.equal(palace.coverage.totalFiles, 1024)
  assert.equal(palace.coverage.filesTruncated, true)
  assert.ok(palace.files.length > 0)
  assert.ok(palace.files.every((file) => paths.includes(file.path)))
  checkReply(palace)

  // Otherwise coherent, individually valid entries must still fail the full-size gate.
  const oversized = structuredClone(palace)
  oversized.files = paths.map((path) => ({ ...palace.files[0], path }))
  oversized.layers.archives = [...paths]
  oversized.coverage.filesReturned = paths.length
  oversized.coverage.filesTruncated = false
  oversized.coverage.layersTruncated = false
  assert.ok(Buffer.byteLength(JSON.stringify({ palace: oversized })) > transportLimits.reply)
  assert.throws(() => validateReply('manage', request, { palace: oversized }))
  assert.throws(() => encode({ result: { palace: oversized } }, transportLimits.reply), /bound/)
})

test('palace charges escaped/multibyte metadata and inspects late links beyond presentation cap', () => {
  const paths = Array.from(
    { length: 1024 },
    (_, i) => `reference/${'r'.repeat(64)}/${String(i).padStart(64, '0')}.md`,
  )
  const body = `---\nname: ${'😀\\\"'.repeat(40)}\ndescription: ${'ไทย\\\"'.repeat(80)}\n---\n`
  const input = inputFor(paths, body)
  input.fileTexts[paths.at(-1)!] = `${body}[[missing-target]]`
  const palace = buildMemoryPalace(input)
  assert.equal(palace.coverage.complete, true)
  assert.equal(palace.coverage.inspectedFiles, 1024)
  assert.equal(palace.coverage.filesTruncated, true)
  assert.ok(!palace.files.some((entry) => entry.path === paths.at(-1)))
  assert.deepEqual(palace.brokenLinks, [{ source: paths.at(-1), target: 'missing-target' }])
  assert.equal(palace.coverage.criticalBrokenLinksTotal, 0)
  assert.equal(palace.coverage.advisoryBrokenLinksTotal, 1)
  assert.equal(palace.healthy, true)
  checkReply(palace)
})

test('palace inspects full-length targets before bounded presentation without changing discovery callers', () => {
  const reference = `reference/${'a'.repeat(64)}/${'b'.repeat(64)}.md`
  const archive = `archives/${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}/${'d'.repeat(64)}.md`
  for (const target of [reference, archive]) {
    assert.ok(allowedPath(target))
    assert.ok(target.length > 128)
    for (const link of [target, target.slice(0, -3)]) {
      const body = `[[${link}]] [[Core.md]]`
      const missing = buildMemoryPalace(inputFor(['Core.md'], body))
      assert.equal(missing.coverage.complete, true)
      assert.equal(missing.healthy, false)
      assert.equal(missing.coverage.brokenLinksTotal, 1)
      assert.deepEqual(missing.brokenLinks, [{ source: 'Core.md', target: link.slice(0, 128) }])
      assert.deepEqual(missing.files[0].links, [link.slice(0, 128), 'Core.md'])
      checkReply(missing)

      const resolved = buildMemoryPalace(inputFor(['Core.md', target], body))
      assert.equal(resolved.healthy, true, 'resolve against the full target, not its clipped prefix')
      assert.equal(resolved.coverage.brokenLinksTotal, 0)
      checkReply(resolved)
      assert.deepEqual(extractFrontmatterAndLinks(body).links, ['Core.md'])
      assert.deepEqual(
        directoryIndex(
          { 'reference/topic.md': { text: body, sources: [] } },
          directoryPage(['reference/topic.md'], 'reference', 0, 32),
        ).entries[0].links,
        ['Core.md'],
      )
    }
  }
  const oversized = buildMemoryPalace(inputFor(['Core.md'], `[[${'😀'.repeat(1000)}]]`))
  assert.equal(oversized.coverage.brokenLinksTotal, 1)
  assert.equal(oversized.healthy, false)
  assert.ok(oversized.brokenLinks[0].target.length <= 128)
  checkReply(oversized)
})

test('palace health follows discovery sources, not detail links or foreign project navigation', () => {
  const critical = [
    'Core.md',
    'index.md',
    'system/persona.md',
    'projects/project/system/overview.md',
    'projects/project/system/conventions.md',
  ]
  const advisory = [
    'system/human/prefs/editor.md',
    'projects/project/system/work.md',
    'projects/other/system/overview.md',
    'projects/other/system/conventions.md',
    'reference/detail.md',
  ]
  for (const path of [...critical, ...advisory]) {
    const palace = buildMemoryPalace(inputFor([path], '[[missing]]'))
    const isCritical = critical.includes(path)
    assert.equal(palace.healthy, !isCritical, path)
    assert.equal(palace.coverage.criticalBrokenLinksTotal, Number(isCritical), path)
    assert.equal(palace.coverage.advisoryBrokenLinksTotal, Number(!isCritical), path)
    checkReply(palace)
  }
  const input = inputFor([...critical, ...advisory, 'archives/old/topic.md'], '[[missing]]')
  const palace = buildMemoryPalace(input)
  assert.equal(palace.coverage.brokenLinksTotal, critical.length + advisory.length)
  assert.equal(palace.budget.alwaysLoadedBytes, critical.length * Buffer.byteLength('[[missing]]'))
  checkReply(palace)
  input.project = 'other'
  const other = buildMemoryPalace(input)
  assert.equal(other.coverage.criticalBrokenLinksTotal, 5)
  assert.equal(
    other.files.find((file) => file.path === 'projects/project/system/overview.md')?.alwaysLoaded,
    false,
  )
  assert.equal(isAlwaysLoadedTieredPath('projects/project/system/overview.md'), false)
  assert.equal(isAlwaysLoadedTieredPath('projects/project/system/conventions.md'), false)

  const partial = inputFor(['Core.md', 'reference/uninspected.md'])
  delete partial.fileTexts['reference/uninspected.md']
  const incomplete = buildMemoryPalace(partial)
  assert.equal(incomplete.coverage.complete, false)
  assert.equal(incomplete.healthy, false)
  checkReply(incomplete)
})

test('palace validates canonical retention and project-dependent always-loaded flags', () => {
  const paths = [
    'Core.md',
    'index.md',
    'system/persona.md',
    'system/human/prefs/editor.md',
    'projects/project/system/work.md',
    'projects/other/system/work.md',
    'reference/topic.md',
    'archives/legacy/topic.md',
  ]
  const palace = buildMemoryPalace(inputFor(paths))
  checkReply(palace)
  for (const [path, protectedRetention, alwaysLoaded] of [
    ['Core.md', true, true],
    ['index.md', false, true],
    ['system/persona.md', true, true],
    ['system/human/prefs/editor.md', true, false],
    ['projects/project/system/work.md', true, false],
    ['projects/other/system/work.md', true, false],
    ['reference/topic.md', false, false],
    ['archives/legacy/topic.md', false, false],
  ] as const) {
    const entry = palace.files.find((file) => file.path === path)!
    assert.equal(entry.protectedRetention, protectedRetention)
    assert.equal(entry.alwaysLoaded, alwaysLoaded)
    for (const flag of ['protectedRetention', 'alwaysLoaded'] as const) {
      const forged = structuredClone(palace)
      const forgedEntry = forged.files.find((file) => file.path === path)!
      forgedEntry[flag] = !forgedEntry[flag]
      assert.throws(() => validateReply('manage', request, { palace: forged }), `${path}: ${flag}`)
    }
  }
})

test('palace validator rejects forged size, layers, coverage, sample totals and health', () => {
  const base = { palace: buildMemoryPalace(inputFor(['Core.md', 'index.md'], '# Text')) }
  validateReply('manage', request, base)
  const mutations: ((reply: typeof base) => void)[] = [
    ({ palace }) => {
      palace.brokenLinks.push({ source: 'Core.md', target: 'missing' })
    },
    ({ palace }) => {
      palace.budget.totalBytesCeiling = 0
    },
    ({ palace }) => {
      palace.healthy = false
    },
    ({ palace }) => {
      palace.layers.core = []
    },
    ({ palace }) => {
      palace.layers.index.push('Core.md')
    },
    ({ palace }) => {
      palace.files[0].layer = 'legacy'
    },
    ({ palace }) => {
      palace.files.push(palace.files[0])
      palace.coverage.filesReturned++
    },
    ({ palace }) => {
      palace.coverage.layersTruncated = true
    },
    ({ palace }) => {
      palace.coverage.filesReturned++
    },
    ({ palace }) => {
      palace.coverage.complete = false
    },
    ({ palace }) => {
      palace.coverage.criticalBrokenLinksTotal++
    },
    ({ palace }) => {
      palace.coverage.advisoryBrokenLinksTotal++
    },
    ({ palace }) => {
      palace.files[0].description = '😀'.repeat(palaceReplyBytes)
    },
  ]
  for (const mutate of mutations) {
    const forged = structuredClone(base)
    mutate(forged)
    assert.throws(() => validateReply('manage', request, forged))
  }
  const brokenInput = inputFor(['Core.md'], '[[missing]]')
  const broken = { palace: buildMemoryPalace(brokenInput) }
  broken.palace.healthy = true
  assert.throws(() => validateReply('manage', request, broken))
  const overBudget = inputFor(['Core.md'], '# Text')
  overBudget.config.totalBytes = 1
  const unhealthy = buildMemoryPalace(overBudget)
  assert.equal(unhealthy.healthy, false)
  checkReply(unhealthy)
})
