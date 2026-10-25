import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { nodes, claimKernel } from '../lib/kernel/registry.mjs'

test('kernel owns the single shared registry, not an optional guard runtime', () => {
  assert.equal(nodes, (globalThis as any)[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')])
  const api = {}
  assert.equal(claimKernel(api), true)
  assert.equal(claimKernel(api), false)
  const kernel = readFileSync(new URL('../lib/kernel/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(kernel, /(?:from|import\()\s*['"][^'"]*provenance|createGuardHost|host\.healthy/)
  assert.match(kernel, /ctx\.sessionManager === sessionManager/)
  assert.match(kernel, /nodes\.get\(sessionId\)\?\.generation === generation/)
  assert.match(kernel, /memoryRetiring = true/)
  const root = readFileSync(new URL('../lib/guards/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(root, /nodes\.(?:set|delete)\(|new Map\(\) as .*Registry|activateKernel/)
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.pi.extensions.length, 13)
  assert.deepEqual(manifest.pi.extensions.slice(0, 2), ['./lib/guards/bootstrap.ts', './lib/guards/index.ts'])
})
