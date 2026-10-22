import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import activate from '../extensions/mahiro-code-map.ts'
import { codeMapParameters, formatCodeMap } from '../lib/code-map.ts'

const basic = { intent: 'exact', query: 'owner' }
const render = (input: unknown) => formatCodeMap('/host/project', input)

test('all intents, host versus metadata workspace, defaults, explicit reads and opaque references', () => {
  for (const intent of ['semantic', 'exact', 'outline']) {
    const text = render({ ...basic, intent })
    assert.match(text, new RegExp(`Code Map · ${intent}`))
    assert.match(text, /host context/)
    assert.match(text, /targeted default \(2 files × 6000 chars\/file\)/)
    assert.match(text, /not verification evidence/)
    assert.match(text, /Side effects: none/)
    const supplied = render({
      ...basic,
      intent,
      workspace: '/metadata-only',
      large_read: { reason: 'explicit' },
      goal_criterion_refs: ['goal:opaque'],
      code_evidence_refs: ['evidence:opaque'],
    })
    assert.match(supplied, /\/metadata-only \(caller-supplied metadata\)/)
    assert.match(supplied, /6 files × 12000/)
    assert.match(supplied, /goal:opaque/)
    assert.match(supplied, /evidence:opaque/)
    assert.match(supplied, /Advisory only—not permission/)
  }
  const text = render({
    ...basic,
    workspace: '/not/read',
    large_read: { reason: 'caller reason' },
    goal_criterion_refs: ['opaque:goal'],
    code_evidence_refs: ['opaque:evidence'],
  })
  assert.match(text, /\/not\/read \(caller-supplied metadata\)/)
  assert.match(text, /6 files × 12000/)
  assert.match(text, /Advisory only—not permission/)
  assert.match(text, /opaque:goal/)
  assert.match(text, /opaque:evidence/)
  assert.match(
    render({
      ...basic,
      large_read: {
        reason: 'reason',
        max_files: 12,
        max_chars_per_file: 20000,
      },
    }),
    /12 files × 20000/,
  )
})

test('closed top-level and nested schemas; enums and invalid shapes', () => {
  assert.equal(codeMapParameters.additionalProperties, false)
  assert.equal(codeMapParameters.properties.navigation_entries.items.additionalProperties, false)
  assert.equal(codeMapParameters.properties.large_read.additionalProperties, false)
  for (const value of [
    null,
    [],
    'x',
    {},
    { ...basic, extra: true },
    { ...basic, intent: 'search' },
    { ...basic, large_read: {} },
    { ...basic, large_read: [] },
    { ...basic, large_read: { reason: 'x', extra: true } },
    { ...basic, navigation_entries: [null] },
    { ...basic, navigation_entries: [{ source: 'search', path: 'x' }] },
    {
      ...basic,
      navigation_entries: [{ source: 'exact', path: 'x', extra: true }],
    },
  ])
    assert.throws(() => render(value))
})

test('every string and array bound, control/bidi rejection and line range bounds', () => {
  const strings: [string, number][] = [
    ['query', 500],
    ['workspace', 4096],
  ]
  for (const [key, max] of strings) {
    assert.doesNotThrow(() => render({ ...basic, [key]: 'x'.repeat(max) }))
    for (const value of [
      '',
      ' ',
      3,
      'x'.repeat(max + 1),
      'x\n',
      'x\u0000',
      'x\u007f',
      'x\u0085',
      'x\u2028',
      'x\u2029',
      'x\u202a',
      'x\u202e',
      'x\u2066',
      'x\u2069',
    ])
      assert.throws(() => render({ ...basic, [key]: value }))
  }
  for (const [key, count, max] of [
    ['path_hints', 12, 4096],
    ['language_hints', 8, 80],
    ['goal_criterion_refs', 8, 120],
    ['code_evidence_refs', 8, 120],
  ] as const) {
    assert.doesNotThrow(() => render({ ...basic, [key]: Array(count).fill('x'.repeat(max)) }))
    for (const value of ['x', Array(count + 1).fill('x'), ['x'.repeat(max + 1)], [''], ['x\u202e'], [7]])
      assert.throws(() => render({ ...basic, [key]: value }))
  }
  for (const [key, max] of [
    ['path', 4096],
    ['symbol', 240],
    ['summary', 500],
  ] as const) {
    const nav = { source: 'exact', path: 'p' }
    assert.doesNotThrow(() =>
      render({
        ...basic,
        navigation_entries: [{ ...nav, [key]: 'x'.repeat(max) }],
      }),
    )
    for (const value of ['', 'x'.repeat(max + 1), 'x\u2067', 3])
      assert.throws(() => render({ ...basic, navigation_entries: [{ ...nav, [key]: value }] }))
  }
  for (const reason of ['', 3, 'x'.repeat(501), 'x\u202d'])
    assert.throws(() => render({ ...basic, large_read: { reason } }))
  assert.doesNotThrow(() =>
    render({
      ...basic,
      large_read: {
        reason: 'x'.repeat(500),
        max_files: 3,
        max_chars_per_file: 6000,
      },
    }),
  )
  for (const [key, values] of [
    ['max_files', [2, 13, 3.5, '6']],
    ['max_chars_per_file', [5999, 20001, 6000.5, '12000']],
  ] as const)
    for (const value of values)
      assert.throws(() => render({ ...basic, large_read: { reason: 'x', [key]: value } }))
  for (const nav of [
    { line_end: 3 },
    { line_start: 3, line_end: 2 },
    { line_start: 0 },
    { line_start: 10000001 },
    { line_start: 1.5 },
    { line_start: '1' },
    { line_start: 1, line_end: 10000001 },
  ])
    assert.throws(() =>
      render({
        ...basic,
        navigation_entries: [{ source: 'exact', path: 'x', ...nav }],
      }),
    )
  assert.match(
    render({
      ...basic,
      navigation_entries: [{ source: 'outline', path: 'x', line_start: 1, line_end: 10000000 }],
    }),
    /x:1-10000000/,
  )
  assert.throws(() =>
    render({
      ...basic,
      navigation_entries: Array(41).fill({ source: 'exact', path: 'x' }),
    }),
  )
  assert.throws(() => formatCodeMap('bad\nworkspace', basic))
})

test('3000 code-unit cap, omission accounting, escaping, immutable parallel formatting and import/registration zero I/O surface', async () => {
  const input = {
    ...basic,
    query: '<untrusted>',
    navigation_entries: Array.from({ length: 40 }, (_, i) => ({
      source: 'filename',
      path: `<${i}>${'x'.repeat(4000)}`,
      symbol: 's'.repeat(240),
      summary: 's'.repeat(500),
    })),
  }
  const saved = structuredClone(input)
  const results = await Promise.all(Array.from({ length: 32 }, () => Promise.resolve(render(input))))
  assert.ok(results.every((text) => text === results[0] && text.length <= 3000))
  const count = /Navigation: 40 caller-supplied; included (\d+); omitted (\d+)\./.exec(results[0])!
  assert.equal(Number(count[1]) + Number(count[2]), 40)
  assert.ok(Number(count[2]) > 0)
  assert.match(results[0], /‹untrusted›/)
  assert.deepEqual(input, saved)
  const saturated = render({
    ...input,
    workspace: 'w'.repeat(4096),
    query: 'q'.repeat(500),
    path_hints: Array(12).fill('p'.repeat(4096)),
    language_hints: Array(8).fill('l'.repeat(80)),
    goal_criterion_refs: Array(8).fill('g'.repeat(120)),
    code_evidence_refs: Array(8).fill('e'.repeat(120)),
    large_read: {
      reason: 'r'.repeat(500),
      max_files: 12,
      max_chars_per_file: 20000,
    },
  })
  assert.ok(saturated.length <= 3000)
  assert.match(saturated, /\[bounded output truncated\]$/)
  for (const file of ['../lib/code-map.ts', '../extensions/mahiro-code-map.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(
      source,
      /node:|appendEntry|sendMessage|executeTool\(|process\.|fetch\(|setTimeout|\.letta|existsSync|readFile/,
    )
  }
  let tool: any
  activate({
    getAllTools: () => [],
    registerTool: (value: any) => {
      tool = value
    },
  } as any)
  assert.equal(tool.name, 'mh_code_map')
  assert.equal(tool.executionMode, 'parallel')
  assert.equal(tool.parameters, codeMapParameters)
  await assert.rejects(
    tool.execute('x', basic, undefined, undefined, {
      cwd: '/host',
      sessionManager: { getSessionId: () => 'missing' },
    }),
    /unavailable/,
  )
})
