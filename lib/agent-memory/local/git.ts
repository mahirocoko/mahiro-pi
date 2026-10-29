import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { assertOid, assertRelativePath, oidPattern, relativePathPattern } from './contracts.ts'

export interface LocalGitContext {
  bare: string
  env: NodeJS.ProcessEnv
  hooksPath: string
  identityPath: string
}

const outputLimit = 1024 * 1024
const diagnosticLimit = 65536
const timeoutMs = 10000

export function localGitEnvironment(identityPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: identityPath,
  }
  for (const key of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SYSTEMROOT']) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function runGit(
  context: LocalGitContext,
  prefix: readonly string[],
  args: readonly string[],
  allowedCodes: readonly number[],
  input?: string,
  indexFile?: string,
  cwd?: string,
  capture?: { maxBytes: number },
): Promise<{ code: number; stdout: Buffer; truncated: boolean }> {
  const argv = [
    ...prefix,
    '--no-pager',
    '-c',
    `core.hooksPath=${context.hooksPath}`,
    '-c',
    'credential.helper=',
    '-c',
    'core.fsmonitor=',
    '-c',
    'core.sshCommand=',
    '-c',
    'core.askPass=',
    '-c',
    'diff.external=',
    '-c',
    'gpg.program=',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=Synthetic Local Memory',
    '-c',
    'user.email=local-memory@example.invalid',
    '-c',
    'advice.detachedHead=false',
    ...args,
  ]
  const env = indexFile ? { ...context.env, GIT_INDEX_FILE: indexFile } : context.env
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', argv, {
      cwd: cwd ?? dirname(context.bare),
      env,
      shell: false,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    let length = 0
    let diagnostics = 0
    let settled = false
    let truncated = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      fail(Error('Local Git timed out'))
    }, timeoutMs)
    if (input !== undefined) {
      if (!child.stdin) throw Error('Local Git failed (stdio)')
      child.stdin.end(input)
    }
    if (!child.stdout || !child.stderr) throw Error('Local Git failed (stdio)')
    child.stdout.on('data', (chunk: Buffer) => {
      if (capture) {
        if (length >= capture.maxBytes) {
          truncated = true
          child.kill('SIGTERM')
          return
        }
        const room = capture.maxBytes - length
        if (chunk.length > room) {
          stdout.push(chunk.subarray(0, room))
          length = capture.maxBytes
          truncated = true
          child.kill('SIGTERM')
          return
        }
        length += chunk.length
        stdout.push(chunk)
        return
      }
      length += chunk.length
      if (length > outputLimit) {
        child.kill('SIGTERM')
        fail(Error('Local Git output exceeded'))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics += chunk.length
      if (diagnostics > diagnosticLimit) {
        child.kill('SIGTERM')
        fail(Error('Local Git diagnostics exceeded'))
      }
    })
    child.once('error', (error) => fail(error))
    child.once('close', (code, signal) => {
      if (settled) return
      clearTimeout(timer)
      if (truncated) {
        settled = true
        resolvePromise({ code: code ?? 0, stdout: Buffer.concat(stdout), truncated: true })
        return
      }
      if (signal || code === null || !allowedCodes.includes(code))
        fail(Error(`Local Git failed (${code ?? signal})`))
      else {
        settled = true
        resolvePromise({ code, stdout: Buffer.concat(stdout), truncated: false })
      }
    })
  })
}

function text(result: { stdout: Buffer }): string {
  return result.stdout.toString('utf8').replaceAll('\0', '').trim()
}

function oid(result: { stdout: Buffer }): string {
  const value = text(result)
  assertOid(value)
  return value
}

async function bareGit(
  context: LocalGitContext,
  args: readonly string[],
  codes: readonly number[] = [0],
  input?: string,
  indexFile?: string,
  capture?: { maxBytes: number },
): Promise<{ code: number; stdout: Buffer; truncated: boolean }> {
  return runGit(context, ['--git-dir', context.bare], args, codes, input, indexFile, undefined, capture)
}

export async function gitInitBare(context: LocalGitContext, path: string): Promise<void> {
  await runGit(context, [], ['init', '--bare', '--quiet', '--template=', '-b', 'main', path], [0])
}

export async function gitMain(context: LocalGitContext): Promise<string> {
  const ref = text(await bareGit(context, ['symbolic-ref', '--quiet', 'HEAD']))
  if (ref !== 'refs/heads/main') throw Error('Local Git branch refused')
  return oid(await bareGit(context, ['rev-parse', '--verify', 'refs/heads/main']))
}

export async function gitRequireCommit(context: LocalGitContext, objectId: string): Promise<void> {
  assertOid(objectId)
  const kind = text(await bareGit(context, ['cat-file', '-t', objectId]))
  if (kind !== 'commit') throw Error('Local Git object refused')
}

export async function gitMainPresence(context: LocalGitContext): Promise<'present' | 'absent'> {
  const result = await bareGit(context, ['show-ref', '--verify', '--quiet', 'refs/heads/main'], [0, 1])
  return result.code === 0 ? 'present' : 'absent'
}

export async function gitCommitParents(context: LocalGitContext, commit: string): Promise<string[]> {
  assertOid(commit)
  const raw = text(await bareGit(context, ['log', '-1', '--format=%P', commit]))
  const parents = raw ? raw.split(' ') : []
  if (parents.length > 8) throw Error('Local Git parents refused')
  for (const parent of parents) assertOid(parent)
  return parents
}

export async function gitTree(context: LocalGitContext, commit: string): Promise<string> {
  assertOid(commit)
  return oid(await bareGit(context, ['rev-parse', '--verify', `${commit}^{tree}`]))
}

export async function gitIsAncestor(
  context: LocalGitContext,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  assertOid(ancestor)
  assertOid(descendant)
  const result = await bareGit(context, ['merge-base', '--is-ancestor', ancestor, descendant], [0, 1])
  return result.code === 0
}

export async function gitWorktreeAdd(context: LocalGitContext, path: string, commit: string): Promise<void> {
  assertOid(commit)
  await bareGit(context, ['worktree', 'add', '--detach', path, commit])
}

export async function gitWorktreeRemove(
  context: LocalGitContext,
  path: string,
  force = false,
): Promise<void> {
  await bareGit(
    context,
    force ? ['worktree', 'remove', '--force', '--', path] : ['worktree', 'remove', '--', path],
  )
}

export async function gitAddAll(context: LocalGitContext, gitDir: string, worktree: string): Promise<void> {
  await runGit(
    context,
    ['--git-dir', gitDir, '--work-tree', worktree],
    ['add', '-A', '--', '.'],
    [0],
    undefined,
    undefined,
    worktree,
  )
}

export async function gitCommit(
  context: LocalGitContext,
  gitDir: string,
  worktree: string,
  message: string,
): Promise<void> {
  if (message.length < 1 || message.length > 160 || /[\u0000-\u001f\u007f]/.test(message))
    throw Error('Local Git message refused')
  await runGit(context, ['--git-dir', gitDir, '--work-tree', worktree], ['commit', '-m', message], [0])
}

export async function gitWorktreeHead(
  context: LocalGitContext,
  gitDir: string,
  worktree: string,
): Promise<string> {
  return oid(
    await runGit(
      context,
      ['--git-dir', gitDir, '--work-tree', worktree],
      ['rev-parse', '--verify', 'HEAD'],
      [0],
    ),
  )
}

export async function gitIndexClean(
  context: LocalGitContext,
  gitDir: string,
  worktree: string,
): Promise<boolean> {
  const result = await runGit(
    context,
    ['--git-dir', gitDir, '--work-tree', worktree],
    ['diff', '--cached', '--quiet'],
    [0, 1],
  )
  return result.code === 0
}

export async function gitWorktreeDirty(
  context: LocalGitContext,
  gitDir: string,
  worktree: string,
): Promise<boolean> {
  const status = await runGit(
    context,
    ['--git-dir', gitDir, '--work-tree', worktree],
    ['status', '--porcelain=v1', '-z'],
    [0],
  )
  return status.stdout.length > 0
}

export async function gitMergeTree(
  context: LocalGitContext,
  parent: string,
  worker: string,
): Promise<{ tree: string; conflicts: string[] }> {
  assertOid(parent)
  assertOid(worker)
  const result = await bareGit(
    context,
    ['merge-tree', '--write-tree', '--name-only', '-z', parent, worker],
    [0, 1],
  )
  if (result.code === 0) return { tree: oid(result), conflicts: [] }
  const fields = result.stdout.toString('utf8').split('\0')
  const tree = fields[0] ?? ''
  if (!oidPattern.test(tree)) throw Error('Local Git object refused')
  const conflicts: string[] = []
  for (const field of fields.slice(1)) {
    if (field === '') break
    if (!relativePathPattern.test(field)) throw Error('Local Git conflict path refused')
    conflicts.push(field)
  }
  if (!conflicts.length) throw Error('Local Git conflict paths missing')
  return { tree, conflicts }
}

export async function gitCommitTree(
  context: LocalGitContext,
  tree: string,
  parents: readonly string[],
  message: string,
): Promise<string> {
  assertOid(tree)
  if (parents.length > 2) throw Error('Local Git parents refused')
  for (const parent of parents) assertOid(parent)
  if (message.length < 1 || message.length > 160 || /[\u0000-\u001f\u007f]/.test(message))
    throw Error('Local Git message refused')
  const args = ['commit-tree', tree]
  for (const parent of parents) args.push('-p', parent)
  args.push('-m', message)
  return oid(await bareGit(context, args))
}

export async function gitUpdateMain(
  context: LocalGitContext,
  next: string,
  expected?: string,
): Promise<void> {
  assertOid(next)
  if (expected === undefined) {
    await bareGit(context, ['update-ref', 'refs/heads/main', next])
    return
  }
  assertOid(expected)
  await bareGit(context, ['update-ref', 'refs/heads/main', next, expected])
}

export async function gitShow(context: LocalGitContext, path: string): Promise<string> {
  assertRelativePath(path)
  const shown = await bareGit(context, ['show', '--no-color', `refs/heads/main:${path}`])
  return new TextDecoder('utf-8', { fatal: true }).decode(shown.stdout)
}

export async function gitHashObject(context: LocalGitContext, text: string): Promise<string> {
  return oid(await bareGit(context, ['hash-object', '-w', '--stdin'], [0], text))
}

export async function gitStage(
  context: LocalGitContext,
  indexFile: string,
  object: string,
  path: string,
): Promise<void> {
  assertOid(object)
  assertRelativePath(path)
  await bareGit(
    context,
    ['update-index', '--add', '--cacheinfo', `100644,${object},${path}`],
    [0],
    undefined,
    indexFile,
  )
}

export async function gitWriteTree(context: LocalGitContext, indexFile: string): Promise<string> {
  return oid(await bareGit(context, ['write-tree'], [0], undefined, indexFile))
}

export async function publicationMatches(
  context: LocalGitContext,
  pending: string,
  expected: string,
  worker: string,
): Promise<boolean> {
  assertOid(pending)
  assertOid(expected)
  assertOid(worker)
  const workerParents = await gitCommitParents(context, worker)
  const workerParent = workerParents[0]
  if (workerParents.length !== 1 || workerParent === undefined) return false
  if (!(await gitIsAncestor(context, workerParent, expected))) return false
  if (pending === worker) return workerParent === expected
  const parents = await gitCommitParents(context, pending)
  if (parents.length !== 2 || parents[0] !== expected || parents[1] !== worker) return false
  const merged = await gitMergeTree(context, expected, worker)
  if (merged.conflicts.length) return false
  return (await gitTree(context, pending)) === merged.tree
}

export interface LocalGitTreeEntry {
  mode: string
  type: 'blob' | 'tree' | 'commit'
  oid: string
  path: string
}

function parseTree(stdout: Buffer): LocalGitTreeEntry[] {
  const entries: LocalGitTreeEntry[] = []
  let start = 0
  for (let index = 0; index <= stdout.length; index += 1) {
    if (index !== stdout.length && stdout[index] !== 0) continue
    if (index === start) {
      start = index + 1
      continue
    }
    let line: string
    try {
      line = new TextDecoder('utf-8', { fatal: true }).decode(stdout.subarray(start, index))
    } catch {
      throw Error('Local Git object refused')
    }
    const match = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40,64})\t(.+)$/.exec(line)
    if (!match) throw Error('Local Git object refused')
    const type = match[2]
    if (type !== 'blob' && type !== 'tree' && type !== 'commit') throw Error('Local Git object refused')
    entries.push({ mode: match[1], type, oid: match[3], path: match[4] })
    start = index + 1
  }
  return entries
}

export async function gitBlobSize(context: LocalGitContext, objectId: string): Promise<number> {
  assertOid(objectId)
  const raw = text(await bareGit(context, ['cat-file', '-s', objectId]))
  if (!/^[0-9]+$/.test(raw)) throw Error('Local Git object refused')
  const total = Number(raw)
  if (!Number.isSafeInteger(total) || total < 0) throw Error('Local Git object refused')
  return total
}

export async function gitBlobPrefix(
  context: LocalGitContext,
  objectId: string,
  maxBytes: number,
): Promise<{ bytes: Buffer; total: number }> {
  assertOid(objectId)
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > outputLimit)
    throw Error('Local Git object refused')
  const total = await gitBlobSize(context, objectId)
  if (total === 0) return { bytes: Buffer.alloc(0), total }
  if (total <= maxBytes) {
    const exact = await bareGit(context, ['cat-file', 'blob', objectId])
    if (exact.truncated || exact.stdout.length !== total) throw Error('Local Git object refused')
    return { bytes: exact.stdout, total }
  }
  const partial = await bareGit(context, ['cat-file', 'blob', objectId], [0], undefined, undefined, {
    maxBytes,
  })
  if (partial.stdout.length !== maxBytes) throw Error('Local Git object refused')
  return { bytes: partial.stdout, total }
}

export async function gitEntryAt(
  context: LocalGitContext,
  commit: string,
  path: string,
): Promise<LocalGitTreeEntry | undefined> {
  assertOid(commit)
  assertRelativePath(path)
  const result = await bareGit(context, ['ls-tree', '-z', commit, '--', path])
  const entries = parseTree(result.stdout).filter((entry) => entry.path === path)
  if (entries.length > 1) throw Error('Local Git object refused')
  return entries[0]
}

export async function gitTreeAt(
  context: LocalGitContext,
  commit: string,
  directory?: string,
): Promise<LocalGitTreeEntry[]> {
  assertOid(commit)
  if (directory !== undefined) assertRelativePath(directory)
  const spec = directory === undefined ? commit : `${commit}:${directory}`
  const result = await bareGit(context, ['ls-tree', '-z', spec])
  return parseTree(result.stdout)
}

export async function gitEntriesRecursive(
  context: LocalGitContext,
  commit: string,
): Promise<LocalGitTreeEntry[]> {
  assertOid(commit)
  const result = await bareGit(context, ['ls-tree', '-r', '-z', commit])
  return parseTree(result.stdout)
}
