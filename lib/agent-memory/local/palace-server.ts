import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { oidPattern } from './contracts.ts'
import { type PalaceContextSnapshot, parsePalaceContext } from './palace-context.ts'
import { type PalaceCorpusPage, type PalaceCorpusRequest, parsePalaceCorpusPage } from './palace-corpus.ts'
import {
  type PalaceDocument,
  type PalaceDocumentRequest,
  defaultPalacePath,
  parsePalaceDocument,
} from './palace-document.ts'
import {
  type PalaceFontFaces,
  palaceFontFallback,
  palaceFontHrefs,
  type PalacePreviewProvenance,
  palacePreviewScript,
  palacePreviewStyle,
  renderPalacePage,
} from './palace-page.ts'
import { decodePalacePath } from './palace-path.ts'
import { type PalaceSnapshot, palacePreviewLimits, parsePalaceSnapshot } from './palace.ts'

// Loopback renderer for one synthetic snapshot and one bounded document callback.
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

type PalaceFontName = 'manrope-latin.woff2' | 'firacode-latin.woff2'

type PalaceRoute =
  | { kind: 'page' }
  | { kind: 'snapshot' }
  | { kind: 'font'; name: PalaceFontName }
  | { kind: 'corpus'; commit: string; offset: number }
  | { kind: 'document'; commit: string; path: string }
  | { kind: 'read'; commit: string; path: string }

const palaceFontBytes: Record<PalaceFontName, Buffer> = {
  'manrope-latin.woff2': loadPalaceFont(
    'manrope-latin.woff2',
    '8bd97e6bbbc1f602a8f791530eed1064c9a357d5731bbc76e3fc587fb068728f',
  ),
  'firacode-latin.woff2': loadPalaceFont(
    'firacode-latin.woff2',
    'd32d5b5a7c9720cf3812f7d1e3ebdb54116f8f656e7471a03a5a93bdd93c98b3',
  ),
}

function loadPalaceFont(name: PalaceFontName, sha256: string): Buffer {
  const bytes = readFileSync(new URL(`./palace-assets/${name}`, import.meta.url))
  if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') throw Error('Local memory palace refused')
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw Error('Local memory palace refused')
  return bytes
}

function contentPolicy(style: string): string {
  const styleHash = createHash('sha256').update(style).digest('base64')
  const script = createHash('sha256').update(palacePreviewScript()).digest('base64')
  return [
    "default-src 'none'",
    `style-src 'sha256-${styleHash}'`,
    `script-src 'sha256-${script}'`,
    "img-src 'none'",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function parseTokenRoute(kind: 'document' | 'read', rest: string): PalaceRoute | undefined {
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash !== rest.lastIndexOf('/')) return undefined
  const commit = rest.slice(0, slash)
  const token = rest.slice(slash + 1)
  if (!oidPattern.test(commit)) return undefined
  try {
    return { kind, commit, path: decodePalacePath(token) }
  } catch {
    return undefined
  }
}

function parseRoute(raw: string, pagePath: string): PalaceRoute | undefined {
  if (
    raw.length > 1024 ||
    !raw.startsWith('/') ||
    raw.includes('?') ||
    raw.includes('#') ||
    raw.includes('\\') ||
    raw.includes('%') ||
    raw.includes('..') ||
    raw.includes('//')
  )
    return undefined
  if (raw === pagePath) return { kind: 'page' }
  if (raw === `${pagePath}/snapshot`) return { kind: 'snapshot' }
  const fontPrefix = `${pagePath}/font/`
  if (raw.startsWith(fontPrefix)) {
    const name = raw.slice(fontPrefix.length)
    if (name === 'manrope-latin.woff2' || name === 'firacode-latin.woff2') return { kind: 'font', name }
    return undefined
  }
  const corpusPrefix = `${pagePath}/corpus/`
  if (raw.startsWith(corpusPrefix)) {
    const rest = raw.slice(corpusPrefix.length)
    const slash = rest.indexOf('/')
    if (slash <= 0 || slash !== rest.lastIndexOf('/')) return undefined
    const commit = rest.slice(0, slash)
    const offsetText = rest.slice(slash + 1)
    if (!oidPattern.test(commit) || !/^(0|[1-9][0-9]{0,5})$/.test(offsetText)) return undefined
    const offset = Number(offsetText)
    if (!Number.isSafeInteger(offset) || offset > 999_999) return undefined
    return { kind: 'corpus', commit, offset }
  }
  for (const kind of ['document', 'read'] as const) {
    const prefix = `${pagePath}/${kind}/`
    if (!raw.startsWith(prefix)) continue
    return parseTokenRoute(kind, raw.slice(prefix.length))
  }
  return undefined
}

function corpusBody(page: PalaceCorpusPage, pagePath: string): string {
  const body = JSON.stringify(page)
  if (Buffer.byteLength(body) > palacePreviewLimits.maxSnapshotBytes)
    throw Error('Local memory palace refused')
  if (!pagePath.startsWith('/') || pagePath.includes('%') || pagePath.includes('..'))
    throw Error('Local memory palace refused')
  return body
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  type: string,
  method: string,
  style: string,
): void {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body)
  response.writeHead(status, {
    'Content-Security-Policy': contentPolicy(style),
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
  reloadPath = '',
  fonts: PalaceFontFaces = palaceFontFallback,
  provenance: PalacePreviewProvenance = 'synthetic',
  context: PalaceContextSnapshot | null = null,
): void {
  send(
    response,
    status,
    renderPalacePage({ state, reloadPath, fonts, provenance, context }),
    'text/html; charset=utf-8',
    method,
    palacePreviewStyle(fonts),
  )
}

function unavailable(stale: boolean): { status: number; body: string; type: string } {
  return {
    status: stale ? 409 : 404,
    body: stale ? '{"version":1,"status":"stale"}' : '{"version":1,"status":"unavailable"}',
    type: 'application/json; charset=utf-8',
  }
}

export async function startPalacePreviewServer(options: {
  snapshot: () => Promise<PalaceSnapshot>
  document: (request: PalaceDocumentRequest) => Promise<PalaceDocument>
  corpus: (request: PalaceCorpusRequest) => Promise<PalaceCorpusPage>
  capability?: string
  provenance?: PalacePreviewProvenance
  context?: unknown
}): Promise<PalacePreviewServer> {
  const provenance = options.provenance === 'private-shadow' ? 'private-shadow' : 'synthetic'
  const context = options.context == null ? null : parsePalaceContext(options.context)
  const capability = options.capability ?? randomBytes(32).toString('base64url')
  if (!capabilityPattern.test(capability)) throw Error('Local memory palace refused')
  const pagePath = `/${capability}`
  const pageFonts = palaceFontHrefs(pagePath, pagePath)
  const pageStyle = palacePreviewStyle(pageFonts)
  const policy = contentPolicy(pageStyle)
  if (
    !policy.includes("frame-ancestors 'none'") ||
    !policy.includes("connect-src 'self'") ||
    !policy.includes("font-src 'self'") ||
    policy.includes("font-src 'none'") ||
    policy.includes('http:') ||
    policy.includes('https:') ||
    !policy.includes('sha256-') ||
    policy.includes('unsafe-inline') ||
    policy.includes('unsafe-eval') ||
    policy.includes('wasm-unsafe-eval')
  )
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
  const url = `http://127.0.0.1:${port}${pagePath}`

  async function answer(
    route: PalaceRoute,
    fonts: PalaceFontFaces,
  ): Promise<{ status: number; body: string; type: string }> {
    if (route.kind === 'font') throw Error('Local memory palace refused')
    if (route.kind === 'document') {
      try {
        const document = parsePalaceDocument(await options.document(route))
        if (document.commit !== route.commit || document.path !== route.path)
          throw Error('Local memory palace refused')
        return { status: 200, body: JSON.stringify(document), type: 'application/json; charset=utf-8' }
      } catch (error) {
        return unavailable(error instanceof Error && error.message === 'Local memory palace stale')
      }
    }
    if (route.kind === 'corpus') {
      try {
        const page = parsePalaceCorpusPage(await options.corpus(route))
        if (page.commit !== route.commit || page.offset !== route.offset)
          throw Error('Local memory palace refused')
        return { status: 200, body: corpusBody(page, pagePath), type: 'application/json; charset=utf-8' }
      } catch (error) {
        return unavailable(error instanceof Error && error.message === 'Local memory palace stale')
      }
    }
    const snapshot = parsePalaceSnapshot(await options.snapshot())
    if (route.kind === 'snapshot') {
      return { status: 200, body: JSON.stringify(snapshot), type: 'application/json; charset=utf-8' }
    }
    if (route.kind === 'read' && route.commit !== snapshot.head) throw Error('Local memory palace stale')
    const path = route.kind === 'read' ? route.path : defaultPalacePath(snapshot.corpus.entries)
    let document: PalaceDocument | null = null
    if (path) {
      try {
        const loaded = parsePalaceDocument(await options.document({ commit: snapshot.head, path }))
        if (loaded.commit !== snapshot.head || loaded.path !== path)
          throw Error('Local memory palace refused')
        document = loaded
      } catch (error) {
        if (error instanceof Error && error.message === 'Local memory palace stale') throw error
        document = null
      }
    }
    return {
      status: 200,
      body: renderPalacePage({
        state: 'snapshot',
        snapshot,
        reloadPath: pagePath,
        document,
        focus: route.kind === 'read' ? 'selection' : 'context',
        fonts,
        provenance,
        context,
      }),
      type: 'text/html; charset=utf-8',
    }
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET'
    let recoveryPath = ''
    const fail = (status: number, state: 'error' | 'stale') => {
      const fonts = recoveryPath ? palaceFontHrefs(request.url ?? '', recoveryPath) : palaceFontFallback
      page(response, status, state, method, recoveryPath, fonts, provenance, context)
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
      if (request.headers['transfer-encoding'] !== undefined) {
        fail(400, 'error')
        return
      }
      const route = parseRoute(request.url ?? '', pagePath)
      if (!route) {
        fail(404, 'error')
        return
      }
      recoveryPath = pagePath
      const fonts = route.kind === 'read' ? palaceFontHrefs(request.url ?? '', pagePath) : pageFonts
      const style = palacePreviewStyle(fonts)
      if (route.kind === 'font') {
        send(response, 200, palaceFontBytes[route.name], 'font/woff2', method, pageStyle)
        return
      }
      if (!accepting || inFlight >= 2) {
        fail(503, 'error')
        return
      }
      inFlight += 1
      const task = answer(route, fonts)
      track(task)
      try {
        const result = await task
        send(response, result.status, result.body, result.type, method, style)
      } catch (error) {
        const stale = error instanceof Error && error.message === 'Local memory palace stale'
        if (route.kind === 'document' || route.kind === 'corpus') {
          const body = unavailable(stale)
          send(response, body.status, body.body, body.type, method, pageStyle)
          return
        }
        fail(stale ? 409 : 500, stale ? 'stale' : 'error')
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
