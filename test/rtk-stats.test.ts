import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { createStateFixture } from '../test-state.mjs'
import {
  parseRTKStats,
  readRTKStats,
  rtkStatsArgs,
  sanitizeRTKReport,
  RTK_STATS_BOUNDS,
} from '../lib/rtk-stats.ts'

const fixture = createStateFixture(
  path.resolve(import.meta.dirname, '..'),
  path.resolve('.agent-state/runtime/rtk-stats-unit'),
  'unit-',
)
after(() => fixture.cleanup())
const summary = {
  total_commands: 1,
  total_input: 1200,
  total_output: 200,
  total_saved: 1000,
  avg_savings_pct: 83.33333333333334,
  total_time_ms: 6,
  avg_time_ms: 6,
  oversized_excluded: 0,
}
const data = {
  summary,
  daily: [
    {
      date: '2026-11-11',
      commands: 1,
      input_tokens: 1200,
      output_tokens: 200,
      saved_tokens: 1000,
      savings_pct: 83.33333333333334,
      total_time_ms: 6,
      avg_time_ms: 6,
    },
  ],
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value))

test('actual upstream schema retains finite safe values, ignores additions, no invented algebra', () => {
  assert.deepEqual(parseRTKStats(encode(data)), data)
  assert.deepEqual(
    parseRTKStats(encode({ ...data, addition: 'ignored', summary: { ...summary, addition: 3 } })),
    data,
  )
  assert.equal(
    parseRTKStats(encode({ ...data, summary: { ...summary, total_saved: 12.5, avg_savings_pct: 101 } }))
      .summary.total_saved,
    12.5,
  )
  assert.deepEqual(
    parseRTKStats(encode({ summary: Object.fromEntries(Object.keys(summary).map((k) => [k, 0])), daily: [] }))
      .daily,
    [],
  )
  for (const bad of [-1, null, '1', Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => parseRTKStats(encode({ ...data, summary: { ...summary, total_commands: bad } })))
  for (const date of ['2026-02-30', '2026-1-1', 'bad'])
    assert.throws(() => parseRTKStats(encode({ ...data, daily: [{ ...data.daily[0], date }] })))
  for (const bytes of [Buffer.from([255]), Buffer.from('{'), Buffer.alloc(RTK_STATS_BOUNDS.jsonBytes + 1)])
    assert.throws(() => parseRTKStats(bytes))
  assert.throws(() => parseRTKStats(encode({ summary, daily: [{}] })))
})

test('fixed argv and terminal sanitization', () => {
  assert.deepEqual(rtkStatsArgs('project', 'overview'), [
    'gain',
    '--daily',
    '--format',
    'json',
    '--text',
    '-p',
  ])
  assert.deepEqual(rtkStatsArgs('all', 'daily'), ['gain', '--daily', '--format', 'json', '--text'])
  assert.deepEqual(rtkStatsArgs('project', 'commands'), ['gain', '--text', '-p'])
  assert.deepEqual(rtkStatsArgs('all', 'commands'), ['gain', '--text'])
  assert.throws(() => rtkStatsArgs('bad' as any, 'overview'))
  assert.throws(() => rtkStatsArgs('project', '--watch' as any))
  assert.equal(
    sanitizeRTKReport('\x1b[31mHello\x1b[0m\x1b]8;;https://bad\x07link\x1b]8;;\x07\r\n\tX\0\x7f\x85'),
    'Hellolink\n\tX',
  )
})

test('bounded CLI transport: fixed argv/env, report, malformed, failures, cancellation and concurrency', async () => {
  const bin = path.join(fixture.root, 'bin')
  fs.mkdirSync(bin, { mode: 0o700 })
  fs.writeFileSync(path.join(bin, 'package.json'), JSON.stringify({ type: 'commonjs' }))
  const spec = path.join(fixture.root, 'spec.json')
  const calls = path.join(fixture.root, 'calls.jsonl')
  fs.writeFileSync(
    path.join(bin, 'rtk'),
    `#!${process.execPath}\nconst fs=require('node:fs'); const s=JSON.parse(fs.readFileSync(${JSON.stringify(spec)},'utf8')); fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({args:process.argv.slice(2),telemetry:process.env.RTK_TELEMETRY_DISABLED,color:process.env.NO_COLOR})+'\\n'); setTimeout(()=>{process.stderr.write('/private/path/secret'); process.stdout.write(s.invalid?Buffer.from([255]):s.bytes?'x'.repeat(s.bytes):s.out);process.exitCode=s.code||0},s.delay||0)`,
    { mode: 0o700 },
  )
  const saved = process.env.PATH
  process.env.PATH = bin
  const set = (value: any) => fs.writeFileSync(spec, JSON.stringify(value))
  const read = (view: 'overview' | 'commands' = 'overview', signal?: AbortSignal) =>
    readRTKStats('project', view, { cwd: fixture.root, signal })
  try {
    set({ out: JSON.stringify(data) })
    const result = await read()
    assert.equal(result.status, 'ok')
    assert.ok(result.status === 'ok' && result.snapshot)
    assert.deepEqual(JSON.parse(fs.readFileSync(calls, 'utf8').trim()), {
      args: ['gain', '--daily', '--format', 'json', '--text', '-p'],
      telemetry: '1',
      color: '1',
    })
    set({ out: '\x1b[31mBy Command\x1b[0m\nopaque full table\nProxy summary\0' })
    const report = await read('commands')
    assert.ok(report.status === 'ok' && report.report === 'By Command\nopaque full table\nProxy summary')
    for (const [specification, expected] of [
      [{ out: '{' }, 'malformed'],
      [{ invalid: true }, 'malformed'],
      [{ bytes: RTK_STATS_BOUNDS.jsonBytes + 100 }, 'oversize'],
      [{ out: 'partial', code: 1 }, 'unavailable'],
      [{ out: '', delay: 5000 }, 'timeout'],
    ] as const) {
      set(specification)
      const r = await read()
      assert.equal(r.status, expected)
      assert.ok(!JSON.stringify(r).includes('private/path'))
      assert.ok(!('snapshot' in r))
    }
    set({ out: JSON.stringify(data), delay: 500 })
    const a = new AbortController(),
      b = new AbortController()
    const first = read('overview', a.signal),
      second = read('overview', b.signal)
    assert.equal((await read()).status, 'busy')
    a.abort()
    b.abort()
    assert.equal((await first).status, 'cancelled')
    assert.equal((await second).status, 'cancelled')
    const cancelled = new AbortController()
    cancelled.abort()
    assert.equal((await read('overview', cancelled.signal)).status, 'cancelled')
    process.env.PATH = path.join(fixture.root, 'absent')
    assert.equal((await read()).status, 'missing-binary')
    process.env.PATH = bin
    set({ out: JSON.stringify(data) })
    assert.equal((await read()).status, 'ok', 'slots are released after every failure')
  } finally {
    process.env.PATH = saved
  }
})
