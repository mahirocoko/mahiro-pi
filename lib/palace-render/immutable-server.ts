import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

const capabilityPattern = /^[A-Za-z0-9_-]{43}$/
const maxHtmlBytes = 256 * 1024
const maxRequests = 32

export interface ImmutablePalaceServer {
  url: string
  address: '127.0.0.1'
  port: number
  closed: Promise<void>
  close(): Promise<void>
}

export async function startImmutablePalaceServer(options: {
  html: string
  style: string
  validate(signal: AbortSignal): Promise<boolean>
  capability?: string
}): Promise<ImmutablePalaceServer> {
  const html = Buffer.from(options.html)
  if (
    html.length < 1 ||
    html.length > maxHtmlBytes ||
    !options.html.includes(`<style>${options.style}</style>`)
  )
    throw Error('Palace HTML server refused')
  const capability = options.capability ?? randomBytes(32).toString('base64url')
  if (!capabilityPattern.test(capability)) throw Error('Palace HTML server refused')
  const route = `/${capability}`
  const styleHash = createHash('sha256').update(options.style).digest('base64')
  const policy = [
    "default-src 'none'",
    "script-src 'none'",
    `style-src 'sha256-${styleHash}'`,
    "connect-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  let accepting = true
  let requests = 0
  let validating = false
  let validationEpoch = 0
  let closing: Promise<void> | undefined
  let resolveClosed!: () => void
  let rejectClosed!: (error: unknown) => void
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })
  const tasks = new Set<Promise<void>>()
  const aborts = new Set<AbortController>()
  const server: Server = createServer(
    {
      requestTimeout: 5_000,
      headersTimeout: 2_000,
      keepAliveTimeout: 1_000,
      maxHeaderSize: 8 * 1024,
    },
    (request, response) => {
      const task = handle(request, response).then(
        () => undefined,
        () => {
          if (!response.headersSent) send(response, 500, 'Unavailable', 'GET', 'text/plain; charset=utf-8')
          else response.destroy()
        },
      )
      tasks.add(task)
      void task.finally(() => tasks.delete(task))
    },
  )
  server.maxHeadersCount = 32

  const close = (): Promise<void> => {
    if (closing) return closing
    accepting = false
    validationEpoch += 1
    for (const controller of aborts) controller.abort()
    closing = (async () => {
      let closeError: unknown
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
            else resolve()
          })
          server.closeIdleConnections()
          server.closeAllConnections()
        })
      } catch (error) {
        closeError = error
      }
      while (tasks.size) await Promise.allSettled([...tasks])
      if (closeError) throw closeError
    })()
    void closing.then(resolveClosed, rejectClosed)
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
    throw Error('Palace HTML server refused')
  }
  const port = bound.port
  const host = `127.0.0.1:${port}`
  const origin = `http://${host}`
  const url = `${origin}${route}`

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET'
    if (!accepting) {
      send(response, 503, 'Unavailable', method, 'text/plain; charset=utf-8')
      return
    }
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      send(response, 405, 'Method not allowed', method, 'text/plain; charset=utf-8')
      return
    }
    if (
      request.headers.host !== host ||
      request.url !== route ||
      request.url.length > 256 ||
      request.headers['transfer-encoding'] !== undefined ||
      (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')
    ) {
      send(response, 400, 'Bad request', method, 'text/plain; charset=utf-8')
      return
    }
    const requestOrigin = request.headers.origin
    if (requestOrigin !== undefined && requestOrigin !== origin) {
      send(response, 403, 'Forbidden', method, 'text/plain; charset=utf-8')
      return
    }
    const fetchSite = request.headers['sec-fetch-site']
    if (fetchSite !== undefined && fetchSite !== 'none' && fetchSite !== 'same-origin') {
      send(response, 403, 'Forbidden', method, 'text/plain; charset=utf-8')
      return
    }
    if (validating || requests >= maxRequests) {
      send(response, 503, 'Unavailable', method, 'text/plain; charset=utf-8')
      return
    }
    requests += 1
    validating = true
    const controller = new AbortController()
    aborts.add(controller)
    const epoch = ++validationEpoch
    const timer = setTimeout(() => controller.abort(), 3_000)
    timer.unref()
    let valid = false
    try {
      valid = await abortableValidation(controller, epoch)
    } finally {
      clearTimeout(timer)
      aborts.delete(controller)
      validating = false
    }
    if (!accepting || !valid) {
      accepting = false
      let revoked = false
      const revoke = () => {
        if (revoked) return
        revoked = true
        void close()
      }
      response.once('finish', revoke)
      response.once('close', revoke)
      send(response, 409, 'Snapshot unavailable', method, 'text/plain; charset=utf-8')
      if (response.destroyed || response.writableFinished) setImmediate(revoke)
      return
    }
    send(response, 200, html, method, 'text/html; charset=utf-8')
  }

  async function abortableValidation(controller: AbortController, epoch: number): Promise<boolean> {
    const validation = Promise.resolve()
      .then(() => options.validate(controller.signal))
      .then((value) => value === true)
      .catch(() => false)
    const aborted = new Promise<false>((resolve) => {
      if (controller.signal.aborted) resolve(false)
      else controller.signal.addEventListener('abort', () => resolve(false), { once: true })
    })
    const result = await Promise.race([validation, aborted])
    return result && accepting && validationEpoch === epoch
  }

  function send(
    response: ServerResponse,
    status: number,
    body: string | Buffer,
    method: string,
    type: string,
  ): void {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body)
    response.writeHead(status, {
      'Content-Security-Policy': policy,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
      Vary: 'Origin, Sec-Fetch-Site',
      'Content-Type': type,
      'Content-Length': payload.length,
    })
    response.end(method === 'HEAD' ? undefined : payload)
  }

  return { url, address: '127.0.0.1', port, closed, close }
}
