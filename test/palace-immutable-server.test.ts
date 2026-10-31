import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import test from 'node:test'
import { abi2PalaceStyle } from '../lib/palace-render/abi2-page.ts'
import { startImmutablePalaceServer } from '../lib/palace-render/immutable-server.ts'

const html = `<!doctype html><html><head><style>${abi2PalaceStyle}</style></head><body>Frozen</body></html>`

test('ABI2 stylesheet preserves pulled Letta shell grammar without brands or asset dependencies', () => {
  // Hash of these unmodified declaration blocks from memory-viewer-template.txt
  // at v0.34.36 / 8f72222 (also unchanged from audited v0.34.31 / a8900b8).
  // The public source test needs no sibling reference checkout.
  const selectors = ['body', '.app-shell', '.header', '.tabs', '.tab', '.main', '.panel']
  const declarations = selectors.map((selector) => {
    const block = abi2PalaceStyle.match(
      new RegExp(`^${selector.replaceAll('.', '\\.')}\\s*\\{([^}]+)\\}`, 'm'),
    )
    assert.ok(block, selector)
    return block[1]
  })
  const digest = createHash('sha256').update(declarations.join('').replace(/\s/g, '')).digest('hex')
  assert.equal(digest, 'd39ffe56592ee7295d5a91cbfeadb3da09e8a4ac047d9966ded4b35d8dcf4589')
  assert.match(abi2PalaceStyle, /--accent: hsl\(240, 93%, 35%\)/)
  assert.match(abi2PalaceStyle, /@media \(prefers-color-scheme: dark\)/)
  assert.match(abi2PalaceStyle, /--accent: hsl\(240, 80%, 68%\)/)
  assert.match(abi2PalaceStyle, /--mono: 'Fira Code', Menlo, Courier, monospace/)
  assert.match(abi2PalaceStyle, /--sans: 'Manrope', -apple-system/)
  assert.match(abi2PalaceStyle, /th, td \{ border: 1px solid #ddd; padding: 6px 10px; \}/)
  assert.match(abi2PalaceStyle, /h2, caption \{[^}]+color: var\(--text-muted\)/s)
  assert.match(abi2PalaceStyle, /footer \{[^}]+color: var\(--text-muted\)/s)
  assert.doesNotMatch(abi2PalaceStyle, /@import|url\(|@font-face|radial-gradient|\.hero|header-brand/i)
  const source = readFileSync(new URL('../lib/palace-render/abi2-page.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from ['"][^'"]*local\//)
  assert.doesNotMatch(source, /<svg|<script|<img|<link/i)
  const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8')
  for (const text of [
    'lib/palace-render/abi2-page.ts',
    '8f72222dec142dfc2316692d68ada3ab2e439d46',
    'v0.34.36',
  ]) {
    assert.ok(notices.includes(text))
  }
})

function fetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method ?? 'GET', headers: options.headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      )
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

test('immutable Palace server serves only the exact capability after current validation', async () => {
  let validations = 0
  const server = await startImmutablePalaceServer({
    html,
    style: abi2PalaceStyle,
    capability: 'a'.repeat(43),
    validate: async () => {
      validations += 1
      return true
    },
  })
  try {
    const wrong = await fetch(`${server.url}?extra=1`)
    assert.equal(wrong.status, 400)
    assert.equal(validations, 0)
    const foreign = await fetch(server.url, { headers: { Origin: 'https://example.invalid' } })
    assert.equal(foreign.status, 403)
    assert.equal(validations, 0)
    const crossSite = await fetch(server.url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(crossSite.status, 403)
    assert.equal(validations, 0)
    const post = await fetch(server.url, { method: 'POST' })
    assert.equal(post.status, 405)
    assert.equal(validations, 0)
    const wrongHost = await fetch(server.url, { headers: { Host: 'localhost.invalid' } })
    assert.equal(wrongHost.status, 400)
    assert.equal(validations, 0)
    const body = await fetch(server.url, { headers: { 'Content-Length': '9' }, body: 'not-empty' })
    assert.equal(body.status, 400)
    assert.equal(validations, 0)

    const first = await fetch(server.url)
    const second = await fetch(server.url, { method: 'HEAD' })
    assert.equal(first.status, 200)
    assert.deepEqual(first.body, Buffer.from(html))
    assert.equal(second.status, 200)
    assert.equal(second.body.length, 0)
    assert.equal(second.headers['content-length'], String(Buffer.byteLength(html)))
    assert.equal(validations, 2)
    assert.match(String(first.headers['content-security-policy']), /default-src 'none'/)
    assert.match(String(first.headers['content-security-policy']), /script-src 'none'/)
    const styleHash = createHash('sha256').update(abi2PalaceStyle).digest('base64')
    assert.ok(String(first.headers['content-security-policy']).includes(`style-src 'sha256-${styleHash}'`))
    assert.equal(first.headers['cache-control'], 'no-store')
    assert.equal(first.headers['referrer-policy'], 'no-referrer')
    assert.equal(first.headers['x-content-type-options'], 'nosniff')
    assert.equal(first.headers['x-frame-options'], 'DENY')
    assert.equal(first.headers['cross-origin-resource-policy'], 'same-origin')
    assert.equal(first.headers['access-control-allow-origin'], undefined)
  } finally {
    await server.close()
    await server.close()
  }
})

test('immutable Palace server revokes after a failed authority revalidation', async () => {
  let valid = true
  const server = await startImmutablePalaceServer({
    html,
    style: abi2PalaceStyle,
    capability: 'b'.repeat(43),
    validate: async () => valid,
  })
  try {
    assert.equal((await fetch(server.url)).status, 200)
    valid = false
    const stale = await fetch(server.url)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.toString(), 'Snapshot unavailable')
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    await server.close()
  }
})

test('immutable Palace server rejects invalid validation deadlines', async () => {
  for (const validationTimeoutMs of [0, 15_001, 1.5, Number.NaN])
    await assert.rejects(
      startImmutablePalaceServer({
        html,
        style: abi2PalaceStyle,
        capability: 'c'.repeat(43),
        validationTimeoutMs,
        validate: async () => true,
      }),
      /Palace HTML server refused/,
    )
})

test('immutable Palace server allows bounded slow validation and revokes at its configured deadline', async () => {
  const slow = await startImmutablePalaceServer({
    html,
    style: abi2PalaceStyle,
    capability: 'c'.repeat(43),
    validationTimeoutMs: 100,
    validate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
      return true
    },
  })
  try {
    assert.equal((await fetch(slow.url)).status, 200)
  } finally {
    await slow.close()
  }

  let completedLate = false
  const timedOut = await startImmutablePalaceServer({
    html,
    style: abi2PalaceStyle,
    capability: 'd'.repeat(43),
    validationTimeoutMs: 25,
    validate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      completedLate = true
      return true
    },
  })
  const response = await fetch(timedOut.url)
  assert.equal(response.status, 409)
  assert.equal(response.body.toString(), 'Snapshot unavailable')
  await Promise.race([
    timedOut.closed,
    new Promise((_, reject) => setTimeout(() => reject(Error('timed-out server did not close')), 1_000)),
  ])
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(completedLate, true)
  await assert.rejects(fetch(timedOut.url))
})

test('immutable Palace server closes after a disconnected request fails validation', async () => {
  let started!: () => void
  const validationStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const server = await startImmutablePalaceServer({
    html,
    style: abi2PalaceStyle,
    capability: 'c'.repeat(43),
    validate: async () => {
      started()
      await gate
      return false
    },
  })
  const disconnected = request(server.url)
  disconnected.on('error', () => {})
  disconnected.end()
  await validationStarted
  disconnected.destroy()
  release()
  await Promise.race([
    server.closed,
    new Promise((_, reject) => setTimeout(() => reject(Error('server did not close')), 1_000)),
  ])
})

test('immutable Palace server close is bounded when validation ignores abort', async () => {
  let started!: () => void
  const validationStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  const server = await startImmutablePalaceServer({
    html,
    style: abi2PalaceStyle,
    capability: 'd'.repeat(43),
    validate: async () => {
      started()
      return await new Promise<boolean>(() => {})
    },
  })
  const pending = fetch(server.url)
  await validationStarted
  const before = Date.now()
  await server.close()
  assert.ok(Date.now() - before < 1_000)
  await server.closed
  const outcome = await Promise.allSettled([pending])
  assert.equal(outcome[0].status, 'rejected')
})

test('immutable Palace server refuses concurrent validation instead of queueing', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const server = await startImmutablePalaceServer({
    html,
    style: abi2PalaceStyle,
    capability: 'e'.repeat(43),
    validate: async () => {
      calls += 1
      await gate
      return true
    },
  })
  try {
    const first = fetch(server.url)
    await new Promise((resolve) => setImmediate(resolve))
    const second = await fetch(server.url)
    assert.equal(second.status, 503)
    assert.equal(calls, 1)
    release()
    assert.equal((await first).status, 200)
  } finally {
    release()
    await server.close()
  }
})
