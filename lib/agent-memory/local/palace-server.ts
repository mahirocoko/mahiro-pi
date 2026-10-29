import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { type PalaceSnapshot, palacePreviewStyle, parsePalaceSnapshot, renderPalacePage } from './palace.ts'

// Loopback renderer for one synthetic snapshot callback.
// Another same-user process is outside this contract. This server does not claim to resist one.
const capabilityPattern = /^[A-Za-z0-9_-]{43}$/

export interface PalacePreviewServer {
  url: string
  snapshotUrl: string
  capability: string
  address: string
  port: number
  close(): Promise<void>
}

function stylePolicy(): string {
  const hash = createHash('sha256').update(palacePreviewStyle()).digest('base64')
  return [
    "default-src 'none'",
    `style-src 'sha256-${hash}'`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "script-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function send(response: ServerResponse, status: number, body: string, type: string, method: string): void {
  const payload = Buffer.from(body)
  response.writeHead(status, {
    'Content-Security-Policy': stylePolicy(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Type': type,
    'Content-Length': payload.length,
  })
  response.end(method === 'HEAD' ? undefined : payload)
}

function page(
  response: ServerResponse,
  status: number,
  state: 'error' | 'stale' | 'loading',
  method: string,
  reloadPath: string,
): void {
  send(response, status, renderPalacePage({ state, reloadPath }), 'text/html; charset=utf-8', method)
}

export async function startPalacePreviewServer(options: {
  snapshot: () => Promise<PalaceSnapshot>
  capability?: string
}): Promise<PalacePreviewServer> {
  const capability = options.capability ?? randomBytes(32).toString('base64url')
  if (!capabilityPattern.test(capability)) throw Error('Local memory palace refused')
  const policy = stylePolicy()
  if (!policy.includes("frame-ancestors 'none'") || !policy.includes('sha256-'))
    throw Error('Local memory palace refused')
  let inFlight = 0
  let accepting = true
  let closing: Promise<void> | undefined
  const tasks = new Set<Promise<void>>()
  const track = (task: Promise<unknown>) => {
    const settled = task.then(
      () => undefined,
      () => undefined,
    )
    tasks.add(settled)
    void settled.finally(() => {
      tasks.delete(settled)
    })
  }
  const server: Server = createServer(
    { requestTimeout: 5_000, headersTimeout: 2_000, keepAliveTimeout: 1_000 },
    (request, response) => {
      void handle(request, response)
    },
  )
  server.maxHeadersCount = 32
  const closeSockets = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
        else resolve()
      })
      server.closeAllConnections()
    })
  const close = (): Promise<void> => {
    if (closing) return closing
    accepting = false
    closing = (async () => {
      let closeError: unknown
      try {
        await closeSockets()
      } catch (error) {
        closeError = error
      }
      while (tasks.size > 0) await Promise.all([...tasks])
      if (closeError) throw closeError
    })()
    return closing
  }
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error)
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', fail)
      resolve()
    })
  })
  const bound = server.address()
  if (!bound || typeof bound === 'string' || bound.address !== '127.0.0.1') {
    await close()
    throw Error('Local memory palace refused')
  }
  const port = bound.port
  const pagePath = `/${capability}`
  const snapshotPath = `${pagePath}/snapshot`
  const url = `http://127.0.0.1:${port}${pagePath}`

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET'
    const fail = (status: number, state: 'error' | 'stale', reloadPath = '') => {
      page(response, status, state, method, reloadPath)
    }
    try {
      if (!accepting) {
        fail(503, 'error')
        return
      }
      if (method !== 'GET' && method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD')
        fail(405, 'error')
        return
      }
      const host = request.headers.host
      if (host !== `127.0.0.1:${port}`) {
        fail(400, 'error')
        return
      }
      const length = request.headers['content-length']
      if (length !== undefined && length !== '0') {
        fail(400, 'error')
        return
      }
      const raw = request.url ?? ''
      if (
        !raw.startsWith('/') ||
        raw.includes('?') ||
        raw.includes('#') ||
        raw.includes('\\') ||
        raw.includes('%') ||
        raw.includes('..')
      ) {
        fail(404, 'error')
        return
      }
      if (raw !== pagePath && raw !== snapshotPath) {
        fail(404, 'error')
        return
      }
      if (!accepting || inFlight >= 2) {
        fail(503, 'error')
        return
      }
      inFlight += 1
      const snapshotTask = options.snapshot()
      track(snapshotTask)
      try {
        const snapshot = parsePalaceSnapshot(await snapshotTask)
        if (raw === snapshotPath) {
          send(response, 200, JSON.stringify(snapshot), 'application/json; charset=utf-8', method)
          return
        }
        send(
          response,
          200,
          renderPalacePage({ state: 'snapshot', snapshot, reloadPath: pagePath }),
          'text/html; charset=utf-8',
          method,
        )
      } catch (error) {
        const stale = error instanceof Error && error.message === 'Local memory palace stale'
        fail(stale ? 409 : 500, stale ? 'stale' : 'error', pagePath)
      } finally {
        inFlight -= 1
      }
    } catch {
      if (!response.headersSent) fail(500, 'error')
    }
  }

  return {
    url,
    snapshotUrl: `${url}/snapshot`,
    capability,
    address: bound.address,
    port,
    close,
  }
}
