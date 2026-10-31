import { execFileSync } from 'node:child_process'
import { memoryFailure } from './reasons.ts'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { bytes, digest, hasSecret, objectShape, validId } from '../continuity/records.ts'
import { configRecordVersion, reflectionSelectionValid } from './reflection-config.ts'
import { assertPrivatePath } from '../continuity/store.ts'
import {
  type EditModeOptions,
  allowedPath,
  applySurgicalEdit,
  assertLegacyArchiveCompatible,
  assertLosslessRetention,
  isAlwaysLoadedTieredPath,
  isCriticalLinkSource,
  legacyV1Migration,
  projectOfPath,
  withMigrationFrontmatter,
} from './engine/schema.ts'
import {
  canonicalLedgerDigest,
  migrationExportPageLimit,
  migrationSourceIndex,
  pageMigrationExport,
} from './migration-export.ts'
import {
  buildMemoryPalace,
  directoryIndex,
  directoryPage,
  discoveryVersion,
  extractFrontmatterAndLinks,
  topicMetadata,
} from './retrieval.ts'
import { observedEpisode } from './engine/episodes.ts'

export { allowedPath, type EditModeOptions }

export interface MemoryConfig {
  version: 1 | 2
  projects: { cwd: string; id: string }[]
  coreBytes: number
  indexBytes: number
  fileBytes: number
  totalBytes: number
  automatic: boolean
  reflectionTrigger?: 'off' | 'step-count' | 'compaction-event'
  reflectionStepCount?: number
}
interface EpisodeIdentity {
  id: string
  project: string
  session: string
  evidence: 'observed-native-unverified'
  observedAt: string
  entryHash: string
}
export interface TurnEpisode extends EpisodeIdentity {
  input: { text: string; source: string }
  actions: { text?: string; tools?: string[] }[]
  results: { tool: string; error: boolean; text?: string }[]
  outcome: 'completed'
  /** Absent on legacy episodes. Never inferred from the truncated action list. */
  assistantSteps?: number
}
export interface CompactionEpisode extends EpisodeIdentity {
  kind: 'compaction'
  compaction: {
    entryId: string
    parentId: string | null
    firstKeptEntryId: string
    tokensBefore: number
    reason: 'manual' | 'threshold' | 'overflow'
    fromExtension: boolean
    willRetry: boolean
  }
}
export type Episode = TurnEpisode | CompactionEpisode
export interface MemoryFile {
  text: string
  sources: string[]
}
export interface Snapshot {
  revision: string
  files: Record<string, MemoryFile>
  forgottenPaths: string[]
  forgottenSources: { project: string | null; source: string }[]
  reviewed: string[]
}
export interface View {
  id: string
  project: string
  /** Absent on retained v1 views means project-scoped, NEVER shared. */
  scope?: 'primary'
  configHash: string
  base: Snapshot
  files: Record<string, MemoryFile>
  state: 'open' | 'committed' | 'conflict' | 'cancelled'
  deadline: number
}
export const memoryLimits = Object.freeze({
  files: 1024,
  fileBytes: 256 * 1024,
  totalBytes: 8 * 1024 * 1024,
  ledgerBytes: 512 * 1024,
  viewBytes: 40 * 1024 * 1024,
})
// Valid text has at most 2 JSON bytes per UTF-8 byte (quotes, backslashes,
// tabs/newlines and lone surrogates). Two 8-MiB copies therefore use <=32 MiB;
// independently bounded ledgers/path/source metadata fit in the remaining 8 MiB.
// Exact serialized-byte preflight below is authoritative, including all metadata.
export const memoryViewDerivedBytes =
  4 * memoryLimits.totalBytes + 2 * memoryLimits.ledgerBytes + 64 * memoryLimits.files + 1024
const hash = /^[a-f0-9]{40,64}$/
const name = /^[a-z0-9][a-z0-9-]{0,63}$/
const copy = <T>(value: T): T => structuredClone(value)
const equal = isDeepStrictEqual
const privateRead = (path: string, max: number, prefixBytes?: number) => {
  assertPrivatePath(path)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > max)
      throw new Error('Private file unavailable')
    if (prefixBytes !== undefined) {
      const prefix = Buffer.alloc(Math.min(stat.size, prefixBytes))
      const length = readSync(fd, prefix, 0, prefix.length, 0)
      return prefix.subarray(0, length).toString('utf8')
    }
    const raw = readFileSync(fd, 'utf8')
    if (bytes(raw) > max) throw new Error('Private file bound exceeded')
    return raw
  } finally {
    closeSync(fd)
  }
}
const privateDirectory = (path: string) => {
  assertPrivatePath(path)
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.mode & 0o077) throw new Error('Private directory required')
}
const atomic = (path: string, value: string) => {
  assertPrivatePath(path)
  privateDirectory(dirname(path))
  if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).nlink !== 1))
    throw new Error('Unsafe file')
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, value, { mode: 0o600, flag: 'wx' })
  renameSync(temp, path)
}
export function parseConfig(raw: string): MemoryConfig {
  const c = JSON.parse(raw)
  const version = c && typeof c === 'object' ? configRecordVersion(c) : undefined
  if (
    !c ||
    !version ||
    typeof c.automatic !== 'boolean' ||
    (version === 2 && !reflectionSelectionValid(c)) ||
    !Array.isArray(c.projects) ||
    !c.projects.length ||
    c.projects.length > 128
  )
    throw new Error('Invalid memory configuration')
  for (const key of ['coreBytes', 'indexBytes', 'fileBytes', 'totalBytes'])
    if (!Number.isSafeInteger(c[key]) || c[key] < 256) throw new Error('Invalid memory budget')
  if (
    c.coreBytes > 32768 ||
    c.indexBytes > 8192 ||
    c.fileBytes > memoryLimits.fileBytes ||
    c.totalBytes > memoryLimits.totalBytes
  )
    throw new Error('Memory configured budget ceiling exceeded')
  const seen = new Set()
  for (const p of c.projects) {
    if (
      !p ||
      Object.keys(p).sort().join() !== 'cwd,id' ||
      !isAbsolute(p.cwd) ||
      resolve(p.cwd) !== p.cwd ||
      typeof p.id !== 'string' ||
      !name.test(p.id) ||
      seen.has(p.cwd)
    )
      throw new Error('Invalid memory project')
    assertPrivatePath(p.cwd)
    seen.add(p.cwd)
  }
  return c
}
export function createMemoryStore(
  root: string,
  current: (path?: string) => void = () => {},
  authority: 'scoped' | 'primary' = 'scoped',
) {
  if (!isAbsolute(root) || resolve(root) !== root) throw new Error('Canonical memory root required')
  const safe = (deadline?: number) => {
    const withinDeadline = () => {
      if (deadline !== undefined && Date.now() >= deadline)
        throw memoryFailure('deadline', 'Memory snapshot deadline')
    }
    current()
    withinDeadline()
    assertPrivatePath(root)
    if (existsSync(root) && (!lstatSync(root).isDirectory() || lstatSync(root).mode & 0o077))
      throw new Error('Private root required')
    // Git metadata is private too. Refuse linked repositories/worktrees and hostile hooks.
    if (existsSync(join(root, '.git'))) {
      assertPrivatePath(join(root, '.git'))
      if (!lstatSync(join(root, '.git')).isDirectory())
        throw new Error('Standalone memory repository required')
      current(join(root, '.git'))
      const pending = [join(root, '.git')]
      let count = 0
      while (pending.length) {
        const path = pending.pop()!
        let entries
        try {
          entries = readdirSync(path, { withFileTypes: true })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        for (const entry of entries) {
          withinDeadline()
          if (++count > 8192) throw memoryFailure('capacity', 'Memory Git metadata capacity exceeded')
          const child = join(path, entry.name)
          let stat
          try {
            stat = lstatSync(child)
          } catch (error) {
            // Git may remove transient locks after directory enumeration.
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
            throw error
          }
          if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1))
            throw new Error('Linked Git metadata refused')
          if (stat.isDirectory()) pending.push(child)
        }
      }
    }
  }
  const git = (args: string[], input?: string, deadline?: number, finalRootCheck = false) => {
    safe(deadline)
    // Return fences revalidate root authority after Git metadata/path checks,
    // immediately before the HEAD read. Never defer this callback past spawn.
    if (finalRootCheck) current()
    return execFileSync('git', ['--no-pager', ...args], {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: deadline === undefined ? 10000 : Math.max(1, Math.min(10000, deadline - Date.now())),
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_INDEX_FILE: undefined,
        GIT_OBJECT_DIRECTORY: undefined,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
        GIT_CONFIG_COUNT: undefined,
        GIT_TERMINAL_PROMPT: '0',
      },
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
  }
  const read = (path: string, max: number) => {
    current(path)
    return privateRead(path, max)
  }
  const write = (path: string, text: string) => {
    current(path)
    atomic(path, text)
  }
  const config = (deadline?: number) => {
    safe(deadline)
    return parseConfig(read(join(root, 'config.json'), 65536))
  }
  const validate = (files: Record<string, MemoryFile>, c = config()) => {
    const paths = Object.keys(files)
    if (paths.length > memoryLimits.files || !files['Core.md'] || !files['index.md'])
      throw new Error('Memory layout required')
    let total = 0
    for (const path of paths) {
      const file = files[path]
      if (
        !allowedPath(path) ||
        !file ||
        Object.keys(file).sort().join() !== 'sources,text' ||
        typeof file.text !== 'string' ||
        !file.text.endsWith('\n') ||
        hasSecret(file.text) ||
        /[\x00-\x08\x0b-\x1f\x7f]/.test(file.text) ||
        !Array.isArray(file.sources) ||
        file.sources.length > 32 ||
        file.sources.some((s) => !validId(s)) ||
        new Set(file.sources).size !== file.sources.length
      )
        throw new Error('Unsafe memory content')
      const max = path === 'Core.md' ? c.coreBytes : path === 'index.md' ? c.indexBytes : c.fileBytes
      if (bytes(file.text) > max) throw new Error('Memory file budget exceeded')
      total += bytes(file.text)
    }
    if (total > c.totalBytes) throw new Error('Memory total budget exceeded')
  }
  const head = (deadline?: number, returnFence = false) => {
    const rev = git(['rev-parse', '--verify', 'HEAD'], undefined, deadline, returnFence).trim()
    if (!hash.test(rev)) throw new Error('Invalid revision')
    return rev
  }
  const parseLedger = (raw: string) => {
    if (bytes(raw) > memoryLimits.ledgerBytes) throw new Error('Memory ledger budget exceeded')
    const state = JSON.parse(raw)
    if (
      !state ||
      Object.keys(state).sort().join() !== 'forgottenPaths,forgottenSources,reviewed,sources,version' ||
      state.version !== 2 ||
      !state.sources ||
      typeof state.sources !== 'object' ||
      Array.isArray(state.sources) ||
      Object.keys(state.sources).length > memoryLimits.files ||
      !Object.hasOwn(state.sources, 'Core.md') ||
      !Object.hasOwn(state.sources, 'index.md')
    )
      throw new Error('Invalid memory ledger')
    for (const [path, sources] of Object.entries(state.sources))
      if (
        !allowedPath(path) ||
        !Array.isArray(sources) ||
        sources.length > 32 ||
        new Set(sources).size !== sources.length ||
        sources.some((s) => !validId(s))
      )
        throw new Error('Invalid memory source metadata')
    for (const key of ['forgottenPaths', 'forgottenSources', 'reviewed'])
      if (
        !Array.isArray(state[key]) ||
        state[key].length > 4096 ||
        state[key].some((s: unknown) =>
          key === 'forgottenPaths'
            ? typeof s !== 'string' || !allowedPath(s)
            : key === 'reviewed'
              ? !validId(s)
              : !objectShape(s, ['project', 'source']) ||
                Object.keys(s).length !== 2 ||
                !(s.project === null || (typeof s.project === 'string' && name.test(s.project))) ||
                !validId(s.source),
        )
      )
        throw new Error('Invalid memory ledger')
    for (const key of ['forgottenPaths', 'forgottenSources', 'reviewed'])
      if (new Set(state[key].map((value: unknown) => JSON.stringify(value))).size !== state[key].length)
        throw new Error('Duplicate memory ledger entry')
    return state
  }
  const ledger = (revision: string, deadline?: number) => {
    if (!hash.test(revision)) throw new Error('Invalid revision')
    current(join(root, '.memory.json'))
    return parseLedger(git(['show', `${revision}:.memory.json`], undefined, deadline))
  }
  const sourceForgotten = (s: Snapshot, source: string, project: string | null) =>
    s.forgottenSources.some((entry) => entry.project === project && entry.source === source)
  const suppressed = (s: Snapshot, path: string, file: MemoryFile) =>
    s.forgottenPaths.includes(path) ||
    file.sources.some((source) => sourceForgotten(s, source, projectOfPath(path)))
  const managementProject = (project?: string) => {
    const projects = config().projects
    const selected = project ?? (projects.length === 1 ? projects[0].id : undefined)
    if (
      !selected ||
      !name.test(selected) ||
      (authority !== 'primary' && !projects.some((p) => p.id === selected))
    )
      throw new Error('Explicit mapped management scope required')
    return selected
  }
  const load = (requested?: string): Snapshot => {
    const deadline = Date.now() + 15000
    const withinDeadline = () => {
      if (Date.now() >= deadline) throw memoryFailure('deadline', 'Memory snapshot deadline')
    }
    const revision = requested ?? head(deadline)
    if (!hash.test(revision)) throw new Error('Invalid revision')
    const state = ledger(revision, deadline)
    const c = config(deadline)
    const files: Record<string, MemoryFile> = {}
    // Fixed-argv Git remains the object owner. Inspect immutable blob sizes first,
    // then read <=1 MiB batches under the unchanged 2-MiB command output bound.
    // Each command still walks/checks Git metadata; no cached security decision.
    const entries = git(['ls-tree', '-rlz', revision], undefined, deadline).split('\0')
    const objects: { path: string; oid: string; size: number }[] = []
    let total = 0
    for (const entry of entries) {
      if (!entry) continue
      const match = /^(100644|100755) blob ([a-f0-9]{40,64}) +([0-9]+)\t(.+)$/.exec(entry)
      if (!match || !Object.hasOwn(state.sources, match[4])) continue
      const [, , oid, length, path] = match
      current(join(root, path))
      const size = Number(length)
      const max = path === 'Core.md' ? c.coreBytes : path === 'index.md' ? c.indexBytes : c.fileBytes
      if (!allowedPath(path) || size > max) throw new Error('Memory file budget exceeded')
      total += size
      objects.push({ path, oid, size })
    }
    if (objects.length !== Object.keys(state.sources).length) throw new Error('Missing tracked memory blob')
    if (total > c.totalBytes) throw new Error('Memory total budget exceeded')
    for (let start = 0; start < objects.length; ) {
      withinDeadline()
      const batch: typeof objects = []
      let size = 0
      while (start < objects.length && size + objects[start].size <= 1024 * 1024) {
        const object = objects[start++]
        batch.push(object)
        size += object.size
      }
      const raw = Buffer.from(
        git(['cat-file', '--batch'], batch.map((o) => o.oid).join('\n') + '\n', deadline),
        'utf8',
      )
      let offset = 0
      for (const object of batch) {
        const end = raw.indexOf(10, offset)
        if (
          end < 0 ||
          raw.subarray(offset, end).toString() !== `${object.oid} blob ${object.size}` ||
          raw[end + 1 + object.size] !== 10
        )
          throw new Error('Invalid memory Git object')
        files[object.path] = {
          text: raw.subarray(end + 1, end + 1 + object.size).toString('utf8'),
          sources: state.sources[object.path],
        }
        offset = end + object.size + 2
      }
      if (offset !== raw.length) throw new Error('Invalid memory Git batch')
    }
    validate(files, c)
    withinDeadline()
    return {
      revision,
      files,
      forgottenPaths: state.forgottenPaths,
      forgottenSources: state.forgottenSources,
      reviewed: state.reviewed,
    }
  }
  const lock = <T>(run: () => T): T => {
    safe()
    const path = join(root, '.lock')
    mkdirSync(path, { mode: 0o700 })
    try {
      current()
      return run()
    } finally {
      rmdirSync(path)
    }
  }
  const writeRevision = (
    previous: Snapshot | undefined,
    next: Omit<Snapshot, 'revision'>,
    message: string,
  ) => {
    validate(next.files)
    if (previous && head() !== previous.revision) throw memoryFailure('CAS', 'Stale memory revision')
    if (previous && git(['status', '--porcelain', '--untracked-files=no']).trim())
      throw new Error('Uncommitted memory work requires explicit recovery; draft retained')
    for (const path of Object.keys(next.files))
      if (previous && !previous.files[path] && existsSync(join(root, path)))
        throw new Error('Untracked memory file would be overwritten')
    if (
      previous &&
      equal(previous.files, next.files) &&
      equal(previous.forgottenPaths, next.forgottenPaths) &&
      equal(previous.forgottenSources, next.forgottenSources) &&
      equal(previous.reviewed, next.reviewed)
    )
      return previous
    const ledger = {
      version: 2,
      sources: Object.fromEntries(Object.entries(next.files).map(([p, f]) => [p, f.sources])),
      forgottenPaths: next.forgottenPaths,
      forgottenSources: next.forgottenSources,
      reviewed: next.reviewed,
    }
    // Use exactly the reader's complete validator before touching worktree/index/HEAD.
    const ledgerText = `${JSON.stringify(ledger)}\n`
    parseLedger(ledgerText)
    // HEAD is the publication boundary. Failed commits leave recoverable work, not active context.
    for (const path of Object.keys(previous?.files ?? {}))
      if (!next.files[path]) {
        const full = join(root, path)
        current(full)
        assertPrivatePath(full)
        if (existsSync(full)) {
          if (!lstatSync(full).isFile() || lstatSync(full).nlink !== 1) throw new Error('Unsafe file')
          unlinkSync(full)
        }
      }
    for (const [path, file] of Object.entries(next.files)) {
      current()
      write(join(root, path), file.text)
    }
    write(join(root, '.memory.json'), ledgerText)
    current()
    const paths = [
      ...new Set(['.memory.json', ...Object.keys(previous?.files ?? {}), ...Object.keys(next.files)]),
    ]
    git(['add', '--', ...paths])
    current()
    git(['commit', '-m', message])
    const gitObjects = join(root, '.git', 'objects')
    if (existsSync(gitObjects)) {
      let looseDirs = 0
      try {
        looseDirs = readdirSync(gitObjects).filter((n) => /^[0-9a-f]{2}$/.test(n)).length
      } catch {
        looseDirs = 0
      }
      if (looseDirs >= 192) git(['gc', '--auto', '--quiet'])
    }
    return load()
  }
  const validateView = (v: View) => {
    if (
      !objectShape(v, ['id', 'project', 'scope', 'configHash', 'base', 'files', 'state', 'deadline']) ||
      ![7, 8].includes(Object.keys(v).length) ||
      (v.scope !== undefined && (v.scope !== 'primary' || authority !== 'primary')) ||
      typeof v.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(v.id) ||
      typeof v.project !== 'string' ||
      !name.test(v.project) ||
      typeof v.configHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(v.configHash) ||
      !['open', 'committed', 'conflict', 'cancelled'].includes(v.state) ||
      !Number.isSafeInteger(v.deadline) ||
      !objectShape(v.base, ['revision', 'files', 'forgottenPaths', 'forgottenSources', 'reviewed']) ||
      Object.keys(v.base).length !== 5 ||
      !hash.test(v.base.revision)
    )
      throw new Error('Invalid private view metadata')
    // Retained conflicts must remain inspectable/discardable after budget shrink.
    // Use fixed supported ceilings here; active use separately checks configHash.
    const ceiling = {
      coreBytes: 32768,
      indexBytes: 8192,
      fileBytes: memoryLimits.fileBytes,
      totalBytes: memoryLimits.totalBytes,
    } as MemoryConfig
    for (const files of [v.base.files, v.files]) {
      if (!files || typeof files !== 'object' || Array.isArray(files))
        throw new Error('Invalid private view files')
      validate(files, ceiling)
      if (Object.keys(files).some((p) => !allowedPath(p, v.scope === 'primary' ? undefined : v.project)))
        throw new Error('Invalid private view scope')
      parseLedger(
        JSON.stringify({
          version: 2,
          sources: Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.sources])),
          forgottenPaths: v.base.forgottenPaths,
          forgottenSources: v.base.forgottenSources,
          reviewed: v.base.reviewed,
        }),
      )
    }
  }
  const serializeView = (v: View) => {
    validateView(v)
    // Stable bounded prefix supports lightweight enumeration without parsing bodies.
    const raw = `${JSON.stringify({
      id: v.id,
      project: v.project,
      state: v.state,
      deadline: v.deadline,
      ...(v.scope === 'primary' ? { scope: v.scope } : {}),
      configHash: v.configHash,
      base: v.base,
      files: v.files,
    })}\n`
    if (bytes(raw) > memoryLimits.viewBytes) throw new Error('Private view budget exceeded')
    return raw
  }
  const readView = (id: string): View => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid private view id')
    const v = JSON.parse(read(join(root, '.views', `${id}.json`), memoryLimits.viewBytes)) as View
    validateView(v)
    if (v.id !== id) throw new Error('Invalid private view metadata')
    return v
  }
  const saveView = (v: View) => {
    // Complete reader-equivalent validation and exact serialization BEFORE writes.
    const raw = serializeView(v)
    for (const [path, file] of Object.entries(v.files)) write(join(root, '.views', v.id, path), file.text)
    write(join(root, '.views', `${v.id}.json`), raw)
  }
  const checkView = (v: View) => {
    safe()
    if (
      !/^[a-f0-9-]{36}$/.test(v.id) ||
      !name.test(v.project) ||
      v.state !== 'open' ||
      Date.now() >= v.deadline ||
      digest(JSON.stringify(config())) !== v.configHash
    )
      throw new Error('Memory view inactive')
    if (!equal(readView(v.id), v)) throw memoryFailure('CAS', 'Stale memory view')
    const c = config()
    validate(v.base.files, c)
    validate(v.files, c)
    for (const [path, file] of Object.entries(v.files))
      if (
        read(join(root, '.views', v.id, path), Math.max(c.fileBytes, c.coreBytes, c.indexBytes)) !== file.text
      )
        throw new Error('Memory view changed externally')
  }
  // Reads, unlike integration, must not expose a retained proposal after another
  // view forgets its path/source. Inspect current ledger without hydrating HEAD
  // bodies; preserve the proposal and its CAS base for explicit conflict recovery.
  const inspect = <T extends object>(v: View, select: (files: Readonly<Record<string, MemoryFile>>) => T) => {
    checkView(v)
    const revision = head()
    const state = ledger(revision)
    const tombstones = { ...state, revision, files: {} } as Snapshot
    if (Object.entries(v.files).some(([path, file]) => suppressed(tombstones, path, file)))
      throw memoryFailure(
        'unknown',
        'Memory read unavailable: current forgotten knowledge; proposal retained',
        'forgetting',
      )
    for (const path of Object.keys(v.files)) current(join(root, path))
    const result = select(v.files)
    checkView(v)
    for (const path of Object.keys(v.files)) current(join(root, path))
    if (digest(JSON.stringify(config())) !== v.configHash || Date.now() >= v.deadline)
      throw new Error('Memory view inactive')
    current()
    // Final HEAD observation is the read's publication fence. Even head()'s
    // own safe/authority I/O precedes its rev-parse; no validation I/O follows.
    if (head(undefined, true) !== revision)
      throw memoryFailure(
        'CAS',
        'Memory read unavailable: current revision changed; retry with retained proposal',
        'revision',
      )
    if (Date.now() >= v.deadline) throw memoryFailure('deadline', 'Memory view inactive')
    return {
      ...result,
      revision: v.base.revision,
      baseRevision: v.base.revision,
      currentRevision: revision,
      basis: equal(v.files, v.base.files) ? ('view-snapshot' as const) : ('private-draft' as const),
      freshness: revision === v.base.revision ? ('current' as const) : ('stale' as const),
    }
  }
  const filter = (s: Snapshot, project?: string) =>
    Object.fromEntries(Object.entries(s.files).filter(([p]) => allowedPath(p, project)))
  const episode = observedEpisode
  const views = () => {
    const folder = join(root, '.views')
    if (!existsSync(folder)) return []
    current(folder)
    assertPrivatePath(folder)
    const names = readdirSync(folder).filter((p) => /^[a-f0-9-]{36}\.json$/.test(p))
    if (names.length > 64) throw memoryFailure('capacity', 'Private view capacity exceeded')
    // Only bounded headers are retained. Older serialization falls back to one
    // full validated view at a time; no proposal is dropped for a format change.
    return names
      .map((p) => {
        const path = join(folder, p)
        current(path)
        const prefix = privateRead(path, memoryLimits.viewBytes, 1024)
        const match =
          /^(\{"id":"[a-f0-9-]{36}","project":"[a-z0-9][a-z0-9-]{0,63}","state":"(?:open|committed|conflict|cancelled)","deadline":[0-9]+(?:,"scope":"primary")?),"configHash":"[a-f0-9]{64}","base":/.exec(
            prefix,
          )
        const v = match ? JSON.parse(`${match[1]}}`) : readView(p.slice(0, -5))
        if (v.id !== p.slice(0, -5) || !Number.isSafeInteger(v.deadline))
          throw new Error('Invalid private view metadata')
        return {
          id: v.id as string,
          project: v.project as string,
          scope: v.scope as View['scope'],
          state: v.state as View['state'],
          deadline: v.deadline as number,
        }
      })
      .filter((v) => authority === 'primary' || v.scope !== 'primary')
  }
  return {
    root,
    config,
    snapshot: load,
    initialize(c: MemoryConfig, core: string, index = '# Memory index\n') {
      parseConfig(JSON.stringify(c))
      if (existsSync(root))
        throw new Error('New private root required; existing bootstrap is never overwritten')
      current()
      privateDirectory(root)
      chmodSync(root, 0o700)
      write(join(root, 'config.json'), `${JSON.stringify(c)}\n`)
      write(join(root, '.gitignore'), 'config.json\n.views/\n.episodes/\n.lock/\n')
      git(['init', '--quiet'])
      // Product code never writes identity or bypasses commit hooks.
      git(['add', '--', '.gitignore'])
      return lock(() =>
        writeRevision(
          undefined,
          {
            files: {
              'Core.md': { text: core, sources: [] },
              'index.md': { text: index, sources: [] },
            },
            forgottenPaths: [],
            forgottenSources: [],
            reviewed: [],
          },
          'Initialize private managed memory',
        ),
      )
    },
    createView(project: string, ttlMs = 120000, shared = false): View {
      if (
        !name.test(project) ||
        (shared && authority !== 'primary') ||
        !Number.isSafeInteger(ttlMs) ||
        ttlMs < 1000 ||
        ttlMs > 600000
      )
        throw new Error('Invalid view scope')
      const retained = views()
      let remaining = retained.length
      if (retained.length >= 32)
        for (const old of retained)
          if (
            ['committed', 'cancelled'].includes(old.state) ||
            (old.state === 'open' && old.deadline <= Date.now())
          ) {
            // A header is discovery only, never deletion authority. Hydrate and
            // validate the selected body before reclaiming any proposal.
            const selected = readView(old.id)
            if (
              selected.state !== old.state ||
              selected.deadline !== old.deadline ||
              selected.project !== old.project
            )
              throw new Error('Stale private view summary; proposal retained')
            const folder = join(root, '.views', old.id)
            current(folder)
            assertPrivatePath(folder)
            rmSync(folder, { recursive: true, force: true })
            const metadata = join(root, '.views', `${old.id}.json`)
            current(metadata)
            unlinkSync(metadata)
            remaining--
          }
      if (remaining >= 64) throw new Error('Private conflicts require manual resolution before more views')
      const base = load()
      const v: View = {
        id: randomUUID(),
        project,
        configHash: digest(JSON.stringify(config())),
        ...(shared ? { scope: 'primary' as const } : {}),
        base: { ...base, files: filter(base, shared ? undefined : project) },
        files: copy(filter(base, shared ? undefined : project)),
        state: 'open',
        deadline: Date.now() + ttlMs,
      }
      saveView(v)
      return v
    },
    inspect,
    read(v: View, path: string, offset = 0, limit = 4096) {
      return inspect(v, (files) => {
        const cleanDir = typeof path === 'string' ? path.replace(/\/+$/, '') : ''
        const allowedDirs = new Set([
          'system',
          'system/human',
          'reference',
          `projects/${v.project}/system`,
          `projects/${v.project}/reference`,
        ])
        const archiveDirectory =
          v.scope === 'primary' && cleanDir.startsWith('archives/') && allowedPath(`${cleanDir}/index.md`)
        if (cleanDir && !cleanDir.endsWith('.md') && (allowedDirs.has(cleanDir) || archiveDirectory))
          return directoryIndex(files, directoryPage(Object.keys(files), cleanDir, offset, limit))
        if (!allowedPath(path, v.scope === 'primary' ? undefined : v.project))
          throw new Error('Memory path outside scope')
        const f = files[path]
        return f ? { ...copy(f), hash: digest(f.text) } : { missing: true, hash: null }
      })
    },
    edit(
      v: View,
      path: string,
      expectedHash: string | null,
      text: string | null,
      sources: string[] = [],
      options?: EditModeOptions,
    ) {
      checkView(v)
      if (!allowedPath(path, v.scope === 'primary' ? undefined : v.project))
        throw new Error('Stale file or path outside scope')
      if ((v.files[path] ? digest(v.files[path].text) : null) !== expectedHash)
        throw memoryFailure('CAS', 'Stale file or path outside scope')
      const nextText = applySurgicalEdit(v.files[path]?.text, text, options)
      if (nextText === null && ['Core.md', 'index.md'].includes(path))
        throw new Error('Core and index cannot be removed')
      const next = copy(v)
      if (nextText === null) delete next.files[path]
      else next.files[path] = { text: nextText, sources: [...sources].sort() }
      validate(next.files)
      saveView(next)
      Object.assign(v, next)
      return nextText === null ? null : digest(nextText)
    },
    cancel(v: View) {
      checkView(v)
      const next = { ...v, state: 'cancelled' as const }
      saveView(next)
      Object.assign(v, next)
    },
    integrate(v: View, reviewed: string[] = [], options?: { allowShrink?: boolean }) {
      checkView(v)
      return lock(() => {
        checkView(v)
        const now = load()
        const next = copy(now)
        const changed = [...new Set([...Object.keys(v.base.files), ...Object.keys(v.files)])].filter(
          (p) => !equal(v.base.files[p], v.files[p]),
        )
        if (!changed.length && reviewed.every((id) => now.reviewed.includes(id))) {
          v.state = 'committed'
          saveView(v)
          return { revision: now.revision, changed: 0 }
        }
        const conflicts = changed.filter(
          (p) =>
            !allowedPath(p, v.scope === 'primary' ? undefined : v.project) ||
            (v.files[p] ? suppressed(now, p, v.files[p]) : now.forgottenPaths.includes(p)) ||
            (!equal(v.base.files[p], now.files[p]) && !equal(v.files[p], now.files[p])),
        )
        if (conflicts.length) {
          v.state = 'conflict'
          saveView(v)
          return { conflict: conflicts, view: v.id }
        }
        assertLosslessRetention(v.base.files, v.files, changed, options?.allowShrink)
        for (const p of changed) {
          if (v.files[p]) next.files[p] = copy(v.files[p])
          else delete next.files[p]
        }
        if (reviewed.some((id) => !validId(id))) throw new Error('Invalid episode cursor')
        next.reviewed = [...new Set([...now.reviewed, ...reviewed])]
        serializeView({ ...v, state: 'committed' })
        const committed = writeRevision(now, next, 'Maintain private agent memory')
        v.state = 'committed'
        saveView(v)
        return { revision: committed.revision, changed: changed.length }
      })
    },
    forget(expected: string, paths: string[], sources: string[], project?: string) {
      const scope = managementProject(project)
      if (
        !Array.isArray(paths) ||
        !Array.isArray(sources) ||
        (!paths.length && !sources.length) ||
        paths.length > 128 ||
        sources.length > 128 ||
        paths.some((p) => !allowedPath(p, scope) || ['Core.md', 'index.md'].includes(p)) ||
        sources.some((s) => !validId(s))
      )
        throw new Error('Invalid forgetting scope; revise Core/index explicitly')
      return lock(() => {
        const now = load()
        if (now.revision !== expected) throw new Error('Stale memory revision')
        const next = copy(now)
        next.forgottenPaths = [...new Set([...now.forgottenPaths, ...paths])]
        // Source IDs are caller-supplied and may be unknown or reused in another
        // project. Tombstone only this project and the intentionally shared files.
        for (const source of sources)
          for (const project of [scope, null])
            if (!sourceForgotten(next, source, project)) next.forgottenSources.push({ project, source })
        for (const [p, file] of Object.entries(next.files))
          if (allowedPath(p, scope) && (paths.includes(p) || file.sources.some((s) => sources.includes(s)))) {
            if (['Core.md', 'index.md'].includes(p))
              throw new Error(
                'Revise Core/index and remove the source link before forgetting; preserve established identity',
              )
            else delete next.files[p]
          }
        return writeRevision(now, next, 'Forget active managed knowledge (history retained)')
      })
    },
    rollback(expected: string, revision: string, project?: string) {
      const scope = managementProject(project)
      return lock(() => {
        const now = load()
        if (now.revision !== expected) throw new Error('Stale memory revision')
        const old = load(revision)
        const next = copy(now)
        for (const p of Object.keys(next.files)) if (allowedPath(p, scope)) delete next.files[p]
        Object.assign(next.files, copy(filter(old, scope)))
        for (const [p, file] of Object.entries(next.files))
          if (allowedPath(p, scope) && suppressed(now, p, file)) {
            if (['Core.md', 'index.md'].includes(p)) next.files[p] = copy(now.files[p])
            else delete next.files[p]
          }
        return writeRevision(now, next, 'Restore memory revision without reviving forgotten knowledge')
      })
    },
    conflicts(project: string, id?: string, path?: string, offset = 0, limit = 4096) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 4096 ||
        (path === undefined && (offset !== 0 || limit !== 4096))
      )
        throw new Error('Invalid conflict paging')
      const matches = views().filter((v) => v.project === project && v.state === 'conflict')
      if (id === undefined)
        return {
          conflicts: matches.slice(0, 8).map((summary) => {
            const v = readView(summary.id)
            if (v.project !== project || v.state !== 'conflict') throw new Error('Stale private view summary')
            return {
              id: v.id,
              baseRevision: v.base.revision,
              fileCount: Object.keys(v.files).length,
            }
          }),
          total: matches.length,
        }
      const selected = matches.find((v) => v.id === id)
      if (!selected) throw new Error('Unknown scoped conflict')
      const v = readView(selected.id)
      if (v.project !== project || v.state !== 'conflict') throw new Error('Stale private view summary')
      if (path === undefined)
        return {
          id,
          files: Object.keys(v.files)
            .filter((p) => allowedPath(p, v.scope === 'primary' ? undefined : project))
            .sort(),
        }
      if (!allowedPath(path, v.scope === 'primary' ? undefined : project))
        throw new Error('Path outside conflict scope')
      const now = load()
      const file = v.files[path]
      if (!file) return { id, path, removed: true }
      if (suppressed(now, path, file)) return { id, path, suppressedByForgetting: true }
      const characters = [...file.text]
      return {
        id,
        path,
        text: characters.slice(offset, offset + limit).join(''),
        offset,
        totalCharacters: characters.length,
        truncated: offset > 0 || offset + limit < characters.length,
        sources: file.sources,
        proposalHash: digest(file.text),
        currentHash: now.files[path] ? digest(now.files[path].text) : null,
        baseRevision: v.base.revision,
      }
    },
    discardConflict(project: string, id: string) {
      const selected = views().find((v) => v.id === id && v.project === project && v.state === 'conflict')
      if (!selected) throw new Error('Unknown scoped conflict')
      const v = readView(selected.id)
      if (v.project !== project || v.state !== 'conflict') throw new Error('Stale private view summary')
      v.state = 'cancelled'
      saveView(v)
      return { discarded: id }
    },
    project(cwd: string) {
      assertPrivatePath(cwd)
      if (!lstatSync(cwd).isDirectory()) throw Error('Canonical memory project required')
      const c = config()
      const mapped = c.projects.find((p) => p.cwd === cwd)?.id
      if (mapped) return mapped
      // Full 256-bit path identity; retain every existing mapped ID unchanged.
      const id = digest(cwd)
      if (c.projects.some((p) => p.id === id && p.cwd !== cwd))
        throw Error('Derived memory project identity collision')
      return id
    },
    projection(project: string, shared = false) {
      if (!name.test(project) || (shared && authority !== 'primary'))
        throw new Error('Invalid memory project authority')
      const revision = head()
      const state = ledger(revision)
      const c = config()
      const tieredPaths = Object.keys(state.sources)
        .filter(
          (p) =>
            isAlwaysLoadedTieredPath(p, project) &&
            !suppressed({ ...state, revision, files: {} }, p, {
              text: '',
              sources: state.sources[p],
            }),
        )
        .sort()
      const batchPaths = ['Core.md', 'index.md', ...tieredPaths]
      for (const path of batchPaths) current(join(root, path))
      const rawBatch = Buffer.from(
        git(['cat-file', '--batch'], `${batchPaths.map((p) => `${revision}:${p}`).join('\n')}\n`),
        'utf8',
      )
      const selected: Record<string, MemoryFile> = {}
      let offset = 0
      for (const path of batchPaths) {
        const end = rawBatch.indexOf(10, offset)
        const header = end < 0 ? '' : rawBatch.subarray(offset, end).toString('utf8')
        const m = /^([a-f0-9]{40,64}) blob ([0-9]+)$/.exec(header)
        const size = m ? Number(m[2]) : -1
        if (!m || size < 0 || rawBatch[end + 1 + size] !== 10) throw new Error('Invalid memory Git object')
        selected[path] = {
          text: rawBatch.subarray(end + 1, end + 1 + size).toString('utf8'),
          sources: state.sources[path],
        }
        offset = end + size + 2
      }
      if (offset !== rawBatch.length) throw new Error('Invalid memory Git batch')
      validate(selected, c)
      if (
        Object.entries(selected).some(([path, file]) =>
          suppressed({ ...state, revision, files: {} }, path, file),
        )
      )
        throw new Error('Memory projection unavailable: current forgetting')
      const systemEntries = tieredPaths
        .filter((p) => p.startsWith('system/'))
        .map((p) => [p, selected[p].text] as const)
      const projectSystemEntries = tieredPaths
        .filter((p) => p.startsWith(`projects/${project}/system/`))
        .map((p) => [p, selected[p].text] as const)
      return {
        revision,
        core: selected['Core.md'].text,
        index: selected['index.md'].text,
        ...(systemEntries.length ? { system: Object.fromEntries(systemEntries) } : {}),
        ...(projectSystemEntries.length ? { projectSystem: Object.fromEntries(projectSystemEntries) } : {}),
        discovery: (() => {
          const paths = Object.keys(state.sources).filter(
            (p) =>
              allowedPath(p, shared ? undefined : project) &&
              !suppressed({ ...state, revision, files: {} }, p, {
                text: '',
                sources: state.sources[p],
              }),
          )
          for (const path of paths) current(join(root, path))
          const topics = topicMetadata(paths)
          // Config and all authority I/O (including head's safe()) must finish
          // before the final HEAD observation, just as for inspect above.
          if (!equal(config(), c) || head(undefined, true) !== revision)
            throw new Error('Memory projection unavailable: current state changed')
          return {
            version: discoveryVersion,
            topics: topics.slice(0, 8),
            totalTopics: topics.length,
            ...(topics.length > 8 ? { nextOffset: 8 } : {}),
            routes: {
              namespaces: { topic: '' },
              allFiles: { topic: '*' },
              lexical: 'agent_memory_read query',
            },
          }
        })(),
      }
    },
    pendingEpisodes(project: string) {
      const revision = head()
      const s = { ...ledger(revision), revision, files: {} } as Snapshot
      const folder = join(root, '.episodes')
      current(folder)
      assertPrivatePath(folder)
      if (!existsSync(folder)) return []
      const names = readdirSync(folder).filter((p) => /^[a-f0-9]{64}\.json$/.test(p))
      if (names.length > 256) throw new Error('Episode backlog full')
      return names
        .filter((p) => !s.reviewed.includes(p.slice(0, -5)) && !sourceForgotten(s, p.slice(0, -5), project))
        .sort()
        .map((p) => {
          const e = episode(JSON.parse(read(join(folder, p), 16384)))
          if (e.id !== p.slice(0, -5)) throw new Error('Invalid episode filename identity')
          return e
        })
        .filter((e) => e.project === project)
        .sort(
          (a, b) =>
            String(a.observedAt).localeCompare(String(b.observedAt)) ||
            String(a.id).localeCompare(String(b.id)),
        )
        .slice(0, 4)
    },
    recordEpisode(id: string, value: unknown) {
      const e = episode(value)
      if ('kind' in e && !config().automatic) throw new Error('Automatic compaction observation disabled')
      if (e.id !== id || !name.test(e.project as string)) throw new Error('Invalid episode scope')
      const raw = JSON.stringify(e)
      const target = join(root, '.episodes', `${id}.json`)
      const rev = head()
      const s = { ...ledger(rev), revision: rev, files: {} } as Snapshot
      if (sourceForgotten(s, id, e.project as string))
        throw new Error('Forgotten episode cannot be re-admitted')
      const folder = join(root, '.episodes')
      current(folder)
      assertPrivatePath(folder)
      current(target)
      assertPrivatePath(target)
      if (existsSync(target)) {
        if (read(target, 16384) !== `${raw}\n`) throw new Error('Observed episode changed')
        return
      }
      safe()
      current(folder)
      assertPrivatePath(folder)
      if (existsSync(folder)) {
        const names = readdirSync(folder).filter((p) => /^[a-f0-9]{64}\.json$/.test(p))
        if (names.length >= 256) {
          // Validate the complete bounded backlog before any reclamation. Reviewed
          // filename discovery never grants authority to delete a corrupt body.
          const retained = names.map((file) => {
            const value = episode(JSON.parse(read(join(folder, file), 16384)))
            if (value.id !== file.slice(0, -5)) throw new Error('Invalid episode filename identity')
            return { file, value }
          })
          for (const { file, value } of retained)
            if (s.reviewed.includes(value.id) || sourceForgotten(s, value.id, value.project)) {
              const path = join(folder, file)
              current(path)
              assertPrivatePath(path)
              unlinkSync(path)
            }
          current(folder)
          assertPrivatePath(folder)
          if (readdirSync(folder).filter((p) => /^[a-f0-9]{64}\.json$/.test(p)).length >= 256)
            throw memoryFailure('capacity', 'Unreviewed episode capacity exceeded')
        }
      }
      // No replace-style rename here: another updated ABI/controller may have
      // admitted this ID after the existence check. A collision never changes bytes.
      current(folder)
      privateDirectory(folder)
      const temp = `${target}.${randomUUID()}.tmp`
      current(temp)
      const fd = openSync(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      let failed = false
      try {
        try {
          current(temp)
          writeFileSync(fd, `${raw}\n`)
        } catch (error) {
          failed = true
          throw error
        } finally {
          try {
            closeSync(fd)
          } catch (error) {
            if (!failed) throw error
          }
        }
        if (head() !== rev) throw new Error('Episode revision changed')
        if ('kind' in e && !config().automatic) throw new Error('Automatic compaction observation disabled')
        current(temp)
        current(target)
        try {
          linkSync(temp, target)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          if (read(target, 16384) !== `${raw}\n`) throw new Error('Observed episode changed')
        }
      } catch (error) {
        failed = true
        throw error
      } finally {
        try {
          current(temp)
          unlinkSync(temp)
        } catch (error) {
          // Revocation leaves residue; never erase without authority or mask the failure.
          if (!failed) throw error
        }
      }
    },
    doctor(project = 'default') {
      const now = load()
      const c = config()
      const pending = [join(root, '.git')]
      let gitEntries = 0
      while (pending.length) {
        const dir = pending.pop()!
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          gitEntries++
          if (entry.isDirectory()) pending.push(join(dir, entry.name))
        }
      }
      const activePaths = Object.keys(now.files).filter((p) => !suppressed(now, p, now.files[p]))
      let totalBytesUsed = 0
      let alwaysLoadedBytes = 0
      const missingDescriptions: string[] = []
      const unmigratedV1Paths: string[] = []
      const brokenLinks: { source: string; target: string }[] = []
      for (const p of activePaths) {
        const b = bytes(now.files[p].text)
        totalBytesUsed += b
        if (p === 'Core.md' || p === 'index.md' || isAlwaysLoadedTieredPath(p, project))
          alwaysLoadedBytes += b
        const meta = extractFrontmatterAndLinks(now.files[p].text)
        if ((p.startsWith('reference/') || /^projects\/[^/]+\/reference\//.test(p)) && !meta.description) {
          missingDescriptions.push(p)
        }
        for (const link of meta.links ?? []) {
          const normalized = link.endsWith('.md') ? link : `${link}.md`
          if (!now.files[link] && !now.files[normalized]) {
            brokenLinks.push({ source: p, target: link })
          }
        }
        if (p.startsWith('global/') || p.startsWith('deferred/')) unmigratedV1Paths.push(p)
      }
      const episodesDir = join(root, '.episodes')
      const episodeFiles = existsSync(episodesDir)
        ? readdirSync(episodesDir).filter((p) => /^[a-f0-9]{64}\.json$/.test(p)).length
        : 0
      const activeViews = views()
      return {
        revision: now.revision,
        project,
        healthy:
          gitEntries <= 8192 &&
          totalBytesUsed <= c.totalBytes &&
          brokenLinks.every((link) => !isCriticalLinkSource(link.source, project)),
        gitEntries,
        gitEntryCeiling: 8192,
        fileCount: activePaths.length,
        fileCeiling: memoryLimits.files,
        totalBytesUsed,
        totalBytesCeiling: c.totalBytes,
        alwaysLoadedBytes,
        episodes: episodeFiles,
        views: activeViews.length,
        conflicts: activeViews.filter((v) => v.state === 'conflict').length,
        brokenLinks,
        missingDescriptions,
        unmigratedV1Paths,
      }
    },
    palace(project = 'default') {
      const now = load()
      const c = config()
      const activePaths = Object.keys(now.files)
        .filter((p) => !suppressed(now, p, now.files[p]))
        .sort()
      const fileSizes: Record<string, number> = {}
      const fileSources: Record<string, string[]> = {}
      const fileTexts: Record<string, string | undefined> = {}
      for (const p of activePaths) {
        fileSizes[p] = bytes(now.files[p].text)
        fileSources[p] = now.files[p].sources
        if (!p.startsWith('archives/')) {
          fileTexts[p] = now.files[p].text
        }
      }
      const episodesDir = join(root, '.episodes')
      const episodeFiles = existsSync(episodesDir)
        ? readdirSync(episodesDir).filter((p) => /^[a-f0-9]{64}\.json$/.test(p)).length
        : 0
      const activeViews = views()
      const viewCounts = {
        total: activeViews.length,
        open: activeViews.filter((v) => v.state === 'open').length,
        conflict: activeViews.filter((v) => v.state === 'conflict').length,
        committed: activeViews.filter((v) => v.state === 'committed').length,
        cancelled: activeViews.filter((v) => v.state === 'cancelled').length,
      }
      return buildMemoryPalace({
        revision: now.revision,
        project,
        config: c,
        activePaths,
        fileSizes,
        fileSources,
        fileTexts,
        views: viewCounts,
        episodes: {
          total: episodeFiles,
          reviewed: now.reviewed.length,
        },
        tombstones: {
          forgottenPaths: now.forgottenPaths.length,
          forgottenSources: now.forgottenSources.length,
        },
        pendingOperations: [],
      })
    },
    initProject(project: string) {
      if (!name.test(project)) throw new Error('Invalid project scope')
      return lock(() => {
        const now = load()
        const next = copy(now)
        const overviewPath = `projects/${project}/system/overview.md`
        const conventionsPath = `projects/${project}/system/conventions.md`
        let changed = 0
        if (!next.files[overviewPath]) {
          next.files[overviewPath] = {
            text: `---\nname: ${project}-overview\ndescription: Architecture and project overview for ${project}\n---\n# Project Overview (${project})\n\n- Active repository context and boundaries.\n`,
            sources: [],
          }
          changed++
        }
        if (!next.files[conventionsPath]) {
          next.files[conventionsPath] = {
            text: `---\nname: ${project}-conventions\ndescription: Coding conventions and workflow rules for ${project}\n---\n# Project Conventions (${project})\n\n## Rules\n\n- Follow repository-local contracts and verification gates.\n`,
            sources: [],
          }
          changed++
        }
        if (!changed) return { revision: now.revision, project, initialized: false, changed: 0 }
        const committed = writeRevision(now, next, `Initialize tiered project memory for ${project}`)
        return { revision: committed.revision, project, initialized: true, changed }
      })
    },
    migrateV2(project = 'default') {
      if (!name.test(project)) throw new Error('Invalid project scope')
      return lock(() => {
        const now = load()
        const next = copy(now)
        const migrated: string[] = []
        let changed = 0
        if (!next.files['system/persona.md']) {
          next.files['system/persona.md'] = {
            text: `---\nname: persona\ndescription: Single fixed Companion identity and collaboration posture\n---\n${now.files['Core.md'].text}`,
            sources: [...now.files['Core.md'].sources],
          }
          migrated.push('system/persona.md')
          changed++
        }
        for (const [p, file] of Object.entries(now.files)) {
          if (!p.startsWith('global/') && !p.startsWith('deferred/')) continue
          const migration = legacyV1Migration(now.revision, p)
          const archive = next.files[migration.archivePath]
          assertLegacyArchiveCompatible(
            migration.archivePath,
            archive && {
              hash: digest(archive.text),
              size: bytes(archive.text),
              sources: archive.sources,
            },
            { hash: digest(file.text), size: bytes(file.text), sources: file.sources },
          )
          if (!archive) {
            next.files[migration.archivePath] = copy(file)
            changed++
          }
          if (!next.files[migration.targetPath]) {
            next.files[migration.targetPath] = {
              text: withMigrationFrontmatter(file.text, migration),
              sources: [...file.sources],
            }
            migrated.push(migration.targetPath)
            changed++
          }
          delete next.files[p]
          changed++
        }
        if (!changed) return { revision: now.revision, migrated: [], changed: 0 }
        const committed = writeRevision(now, next, 'Losslessly migrate v1 memory into tiered v2 layout')
        return { revision: committed.revision, migrated, changed }
      })
    },
    migrationExport(
      project: string,
      request: { revision: string; section: string; offset?: number; limit?: number },
    ) {
      if (authority !== 'primary') throw new Error('Primary operation required')
      managementProject(project)
      const offset = request.offset ?? 0
      const limit = request.limit ?? migrationExportPageLimit
      if (
        typeof request.revision !== 'string' ||
        !hash.test(request.revision) ||
        typeof request.section !== 'string' ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > migrationExportPageLimit
      )
        throw new Error('Invalid memory migration export')
      return lock(() => {
        const revision = head()
        if (revision !== request.revision) throw memoryFailure('CAS', 'Stale memory revision')
        const raw = git(['show', `${revision}:.memory.json`])
        const ledger = parseLedger(raw)
        const contentHashes: Record<string, string> = {}
        if (request.section === 'sources') {
          const index = migrationSourceIndex(ledger)
          if (offset > index.length) throw new Error('Invalid memory migration export')
          for (const row of index.slice(offset, offset + limit))
            contentHashes[row.path] = digest(git(['cat-file', 'blob', `${revision}:${row.path}`]))
        }
        const page = pageMigrationExport({
          revision,
          configHash: digest(JSON.stringify(config())),
          ledgerDigest: canonicalLedgerDigest(raw),
          ledger,
          section: request.section,
          offset,
          limit,
          contentHashes,
        })
        if (head() !== revision) throw memoryFailure('CAS', 'Stale memory revision')
        return page
      })
    },
  }
}
