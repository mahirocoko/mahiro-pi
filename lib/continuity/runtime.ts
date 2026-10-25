import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExtensionContext, ToolInfo } from '@earendil-works/pi-coding-agent'
import { historyCandidates, readHistory } from './history-reader.ts'
import { bytes, digest, type IRecord, objectShape, search, validId } from './records.ts'
import { assertPrivatePath, createStore } from './store.ts'
import { resolveAgentDir } from '../setup.ts'

// No project-name ban. Canonical/private path and accepted-data checks remain.
export const excludedCwd = (_cwd: string) => false

export function parseProjects(raw: string) {
  const manifest = JSON.parse(raw)
  if (
    !objectShape(manifest, ['version', 'projects', 'history']) ||
    (Object.hasOwn(manifest, 'history') && manifest.history !== true) ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.projects) ||
    manifest.projects.length > 256
  )
    throw new Error('Continuity unavailable')
  const projects = new Map<string, string>()
  for (const entry of manifest.projects) {
    if (
      !objectShape(entry, ['cwd', 'projectId']) ||
      typeof entry.cwd !== 'string' ||
      resolve(entry.cwd) !== entry.cwd ||
      !validId(entry.projectId) ||
      deniedProject(entry.projectId) ||
      excludedCwd(entry.cwd) ||
      projects.has(entry.cwd)
    )
      throw new Error('Continuity unavailable')
    projects.set(entry.cwd, entry.projectId)
  }
  return { projects, history: manifest.history === true }
}

export interface IGuardNode {
  generation: unknown
  healthy(): boolean
  context: {
    finalArgs(name: string, args: unknown, ctx: ExtensionContext): Promise<unknown>
  }
  continuity: {
    version: number
    generation: unknown
    isPrimarySession?(ctx: ExtensionContext): boolean
    authorizeLearning?(ctx: ExtensionContext, root: string, target?: string): void
    parentService?(): unknown
    trustedTool(tool: ToolInfo): boolean
    authorizeRead(tool: ToolInfo, path: string, ctx: ExtensionContext, signal?: AbortSignal): Promise<void>
  }
}
export interface IRuntimeConfig {
  root?: string
  nodes?: Map<string, IGuardNode>
}
export interface IRecallArgs {
  query?: string
  recordId?: string
  includeGlobal?: boolean
  crossProject?: boolean
}
const registryKey = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
const EXCLUDED_PROJECT_IDS: string[] = []
const deniedProject = (id: string) => EXCLUDED_PROJECT_IDS.includes(id.toLowerCase())
export function closedArgs(name: string, value: unknown): IRecallArgs {
  const keys =
    name === 'recall_search'
      ? ['query', 'includeGlobal', 'crossProject']
      : ['recordId', 'query', 'includeGlobal', 'crossProject']
  if (
    !objectShape(value, keys) ||
    (name === 'recall_search' && (typeof value.query !== 'string' || !value.query.trim())) ||
    (name === 'recall_read' && !validId(value.recordId)) ||
    (value.query !== undefined &&
      (typeof value.query !== 'string' ||
        !value.query.trim() ||
        bytes(value.query) > 512 ||
        /[\x00-\x1f]/.test(value.query))) ||
    [value.includeGlobal, value.crossProject].some((v) => v !== undefined && typeof v !== 'boolean')
  )
    throw new Error('Invalid recall arguments')
  return structuredClone(value) as IRecallArgs
}
export function createRuntime(config: IRuntimeConfig = {}) {
  const sessions = new Map<string, symbol>()
  const nodes = () => config.nodes ?? (globalThis as Record<symbol, Map<string, IGuardNode>>)[registryKey]
  return {
    start(ctx: ExtensionContext) {
      sessions.set(ctx.sessionManager.getSessionId(), Symbol())
    },
    stop(ctx: ExtensionContext) {
      sessions.delete(ctx.sessionManager.getSessionId())
    },
    async run(
      name: 'recall_search' | 'recall_read' | 'context',
      input: unknown,
      tool: ToolInfo | undefined,
      ctx: ExtensionContext,
      signal?: AbortSignal,
    ) {
      const id = ctx.sessionManager.getSessionId()
      const token = sessions.get(id)
      const node = nodes()?.get(id)
      const abi = node?.continuity
      const current = () => {
        if (
          !token ||
          sessions.get(id) !== token ||
          nodes()?.get(id) !== node ||
          !node?.healthy() ||
          abi?.version !== 1 ||
          abi.generation !== node.generation ||
          (name === 'context' && abi.isPrimarySession?.(ctx) !== true) ||
          signal?.aborted ||
          ctx.signal?.aborted ||
          !tool ||
          !abi.trustedTool(tool)
        )
          throw new Error('Continuity unavailable')
      }
      try {
        if (excludedCwd(ctx.cwd)) throw new Error('Continuity unavailable')
        current()
        let args = name === 'context' ? {} : closedArgs(name, input)
        if (name !== 'context') args = closedArgs(name, await node!.context.finalArgs(name, args, ctx))
        current()
        const root =
          config.root ?? process.env.MAHIRO_CONTINUITY_ROOT ?? join(resolveAgentDir(), 'continuity')
        const allowed = new Set<string>()
        const authorize = async (path: string) => {
          current()
          await abi!.authorizeRead(tool!, path, ctx, signal)
          current()
          allowed.add(path)
        }
        const safe = (path: string) => {
          current()
          if (!allowed.has(path)) throw new Error('Continuity unavailable')
          assertPrivatePath(path)
          if ((lstatSync(path).mode & 0o077) !== 0) throw new Error('Continuity unavailable')
        }
        const read = (path: string, max = 16 * 1024 * 1024) => {
          safe(path)
          const stat = lstatSync(path)
          if (!stat.isFile() || stat.size > max) throw new Error('Continuity unavailable')
          const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            if (!fstatSync(fd).isFile() || fstatSync(fd).size > max) throw new Error('Continuity unavailable')
            const text = readFileSync(fd, 'utf8')
            current()
            if (bytes(text) > max) throw new Error('Continuity unavailable')
            return text
          } finally {
            closeSync(fd)
          }
        }
        await authorize(root)
        safe(root)
        const manifestPath = join(root, 'manifest.json')
        await authorize(manifestPath)
        const manifestRaw = read(manifestPath, 65536)
        const manifest = parseProjects(manifestRaw)
        const cwd = realpathSync(ctx.cwd)
        const projects = manifest.projects
        const projectId = projects.get(cwd) ?? digest(cwd)
        const pointer = join(root, 'state.json')
        await authorize(pointer)
        const original = read(pointer, 16 * 1024 * 1024)
        const state = JSON.parse(original)
        if (!validId(state?.generation)) throw new Error('Continuity unavailable')
        const generation = join(root, `${state.generation}.json`)
        await authorize(generation)
        safe(generation)
        const store = createStore(
          root,
          { excludedProjectIds: EXCLUDED_PROJECT_IDS, excludedPaths: [] },
          {
            readOnly: true,
            beforeRead: (path) => {
              safe(path)
              if (path === pointer && digest(read(pointer, 16 * 1024 * 1024)) !== digest(original))
                throw new Error('Continuity unavailable')
            },
          },
        )
        const scope = {
          projectId,
          includeGlobal: args.includeGlobal,
          crossProject: args.crossProject,
        }
        const limits = { count: 6, perResultBytes: 1024, totalBytes: 6144 }
        const historical = manifest.history === true && name !== 'context'
        const snapshot = historical ? JSON.stringify(store.snapshot()) : undefined
        const hidden = historical ? new Set(store.inspect().controls.forgotten) : new Set<string>()
        const historyRoot = join(root, 'history')
        let historyReady = false
        const history = {
          root: historyRoot,
          read: async (path: string, maxBytes: number) => {
            if (
              path !== join(historyRoot, 'manifest.json') &&
              !/^[a-f0-9]{64}\.json$/.test(path.slice(historyRoot.length + 1))
            )
              throw new Error('Continuity unavailable')
            if (!path.startsWith(`${historyRoot}/`)) throw new Error('Continuity unavailable')
            if (!historyReady) {
              await authorize(historyRoot)
              safe(historyRoot)
              historyReady = true
            }
            await authorize(path)
            return read(path, maxBytes)
          },
        }
        const policy = {
          excludedProjectIds: EXCLUDED_PROJECT_IDS,
          excludedPaths: [],
        }
        let result: unknown
        if (name === 'context') {
          const facts = store
            .inspect()
            .facts.filter((fact) => fact.projectId === projectId)
            .slice(-4)
            .reverse()
          result = {
            evidence: 'UNTRUSTED',
            notes: facts.map((fact) => ({
              id: fact.id,
              recordId: fact.recordId,
              quote: fact.quote.slice(0, 400),
            })),
          }
        } else if (name === 'recall_search') {
          const hits = store.search(args.query!, scope, limits)
          if (!historical) result = hits
          else {
            const records = hits
              .map((hit) => store.read(hit.recordId, scope))
              .filter((record): record is IRecord => record !== undefined)
            const archived = await historyCandidates(history, policy, args.query!, scope, hidden)
            result = search([...records, ...archived], args.query!, scope, limits)
          }
        } else {
          const record =
            store.read(args.recordId!, scope) ??
            (historical ? await readHistory(history, policy, args.recordId!, scope, hidden) : undefined)
          if (!record) result = { unavailable: true }
          else {
            const match = args.query
              ? search([record], args.query, scope, {
                  count: 1,
                  perResultBytes: 2048,
                  totalBytes: 4096,
                })[0]
              : undefined
            let quote = match?.quote ?? ''
            if (!args.query)
              for (const char of record.text) {
                if (bytes(quote + char) > 2048) break
                quote += char
              }
            result = {
              evidence: 'UNTRUSTED',
              recordId: record.id,
              sourceKind: record.sourceKind,
              agentId: record.agentId,
              conversationId: record.conversationId,
              messageId: record.messageId,
              date: record.date,
              path: record.path,
              hash: record.hash,
              quote,
              truncated: quote !== record.text,
            }
          }
        }
        if (historical) {
          // Permission awaits may let cooperative store writers or the operator
          // replace the root mapping. Never publish results from a stale scope.
          await authorize(manifestPath)
          if (
            digest(read(manifestPath, 65536)) !== digest(manifestRaw) ||
            JSON.stringify(store.snapshot()) !== snapshot
          )
            throw new Error('Continuity unavailable')
        }
        current()
        if (bytes(JSON.stringify(result)) > 8192) throw new Error('Continuity unavailable')
        return result
      } catch {
        throw new Error('Continuity unavailable: guarded accepted data required')
      }
    },
  }
}
