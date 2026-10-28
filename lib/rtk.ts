// Native RTK control. Explicit installation selects defaults; startup grants nothing.
// No settings hooks, history DB, permission bypass or native usage mutation.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { registerWorkflowCommand } from './workflow-hub.ts'
import { registerWorkflowAttention } from './workflow-attention.ts'
import { registerWorkflowPresentation, workflowRenderers } from './workflow-ui.ts'
import {
  assertRTKBinding,
  rtkBinding,
  rtkHash,
  publishRTKState,
  readRTKFile,
  rtkModes,
  validateRTKState,
  type RTKMode,
  type RTKBinding,
} from './rtk-state.ts'
export { rtkModes, validateRTKState } from './rtk-state.ts'

export const RTK_HELPER_BOUNDS = Object.freeze({
  inputBytes: 4096,
  outputBytes: 16384,
  timeoutMs: 1500,
  concurrent: 4,
})
let helpersInFlight = 0
// The public UI object owns the presentation sink, not the session manager:
// multiple healthy managers can share one UI during session replacement.
// Reloaded factories share leases; independent UIs remain isolated.
const statusOwnersKey = Symbol.for('@mahirocoko/pi-rtk:status-owners')
const statusOwners: WeakMap<object, object> = ((globalThis as any)[statusOwnersKey] ??= new WeakMap())
export type RTKRewriteResult = {
  status:
    | 'candidate'
    | 'approval-required'
    | 'unchanged'
    | 'denied'
    | 'unavailable'
    | 'timeout'
    | 'oversize'
    | 'malformed'
  command: string | null
}
// No shell interprets the original here, including flag-looking input. stdout is
// preview data only; this API never executes the proposed command.
export async function resolveRTKRewrite(
  command: unknown,
  ctx: { cwd: string; signal?: AbortSignal },
): Promise<RTKRewriteResult> {
  if (ctx.signal?.aborted) throw Error('RTK cancelled')
  if (
    typeof command !== 'string' ||
    !command.trim() ||
    Buffer.byteLength(command) > RTK_HELPER_BOUNDS.inputBytes ||
    /[\x00-\x1f\x7f]/.test(command)
  )
    return { status: 'malformed', command: null }
  if (helpersInFlight >= RTK_HELPER_BOUNDS.concurrent) return { status: 'unavailable', command: null }
  helpersInFlight++
  return new Promise((resolve, reject) => {
    try {
      execFile(
        'rtk',
        ['rewrite', '--', command],
        {
          cwd: ctx.cwd,
          signal: ctx.signal,
          timeout: RTK_HELPER_BOUNDS.timeoutMs,
          maxBuffer: RTK_HELPER_BOUNDS.outputBytes,
          encoding: 'buffer',
          shell: false,
          windowsHide: true,
          killSignal: 'SIGKILL',
        },
        (error, stdout) => {
          helpersInFlight--
          if (ctx.signal?.aborted) return reject(Error('RTK cancelled'))
          const code = error ? (error as any).code : 0
          if (code === 2) return resolve({ status: 'denied', command: null })
          if (code === 1) return resolve({ status: 'unchanged', command: null })
          if (code !== 0 && code !== 3)
            return resolve({
              status:
                code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                  ? 'oversize'
                  : (error as any)?.killed
                    ? 'timeout'
                    : 'unavailable',
              command: null,
            })
          let output: string
          try {
            output = new TextDecoder('utf-8', { fatal: true }).decode(stdout)
          } catch {
            return resolve({ status: 'malformed', command: null })
          }
          // One shell command line, with at most the helper's trailing line ending.
          output = output.replace(/\r?\n$/, '')
          if (!output.trim() || output !== output.trim() || /[\x00-\x1f\x7f]/.test(output))
            return resolve({ status: 'malformed', command: null })
          // RTK can collapse Biome version/format invocations into `rtk lint`,
          // changing semantics. Keep the whole original line, including chains.
          // This conservative token veto is not a shell parser: even a Biome
          // mention in quoted data forgoes a candidate. Helper denials above
          // still win; the caller authorizes the preview input, never executes it.
          if (/\bbiome\b/.test(command)) return resolve({ status: 'unchanged', command: null })
          resolve({
            status: code === 3 ? 'approval-required' : 'candidate',
            command: output,
          })
        },
      )
    } catch {
      // execFile can throw before a child exists (invalid launch options, etc.).
      // No callback will release this slot. A failed preview must not poison
      // later previews; the caller still rechecks current authority afterward.
      helpersInFlight--
      if (ctx.signal?.aborted) reject(Error('RTK cancelled'))
      else resolve({ status: 'unavailable', command: null })
    }
  })
}

// Legacy pure candidate utility; no automatic execution path consumes it.
export function rtkCandidate(command: unknown, mode: RTKMode) {
  if (
    mode === 'off' ||
    typeof command !== 'string' ||
    command.length > 4096 ||
    !command ||
    command !== command.trim() ||
    !/^[A-Za-z0-9_./:@%+,= -]+$/.test(command)
  )
    return null
  const words = command.split(/ +/)
  if (words.length > 64 || words.some((w) => w.length > 512)) return null
  const [executable, sub, ...rest] = words
  let paths: string[] = [],
    rewritten: string
  if (executable === 'git') {
    const commands = ['status', 'diff']
    if (!commands.includes(sub)) return null
    const flags = new Set([
      '--short',
      '--branch',
      '--porcelain',
      '--stat',
      '--shortstat',
      '--name-only',
      '--name-status',
      '--oneline',
      '--no-color',
      '--',
      '-s',
      '-b',
    ])
    if (rest.some((w) => w.startsWith('-') && !flags.has(w))) return null
    paths = rest.filter((w) => !w.startsWith('-'))
    rewritten = `rtk ${words.join(' ')}`
  } else if (executable === 'ls') {
    const args = words.slice(1)
    if (args.some((w) => w.startsWith('-') && !/^-[alh1]+$/.test(w) && w !== '--')) return null
    paths = args.filter((w) => !w.startsWith('-'))
    rewritten = `rtk ${words.join(' ')}`
  } else return null
  return { command: rewritten, paths }
}
export function registerRTK(
  pi: any,
  owner: {
    access: (ctx: any, root: string, operation: string) => void
    finalArgs: (name: string, args: any, ctx: any) => Promise<any>
    permission: (ctx: any, surface: string, value?: string) => any
    current: (ctx: any) => boolean
    executionCurrent?: (ctx: any) => boolean
    executionAccess?: (ctx: any, root: string, binding?: RTKBinding) => void
  },
) {
  let mode: RTKMode = 'off',
    binding: ReturnType<typeof rtkBinding> = null,
    epoch = 0,
    alive = true
  const recent: any[] = []
  const statusOwner = {}
  let statusContext: any
  const isCurrent = (ctx: any) => (owner.executionCurrent ?? owner.current)(ctx)
  const clearStatus = () => {
    const ctx = statusContext
    statusContext = undefined
    if (!ctx || statusOwners.get(ctx.ui) !== statusOwner) return
    statusOwners.delete(ctx.ui)
    if (isCurrent(ctx)) ctx.ui.setStatus('mahiro-rtk', undefined)
  }
  const publishStatus = (ctx: any, available: boolean) => {
    if (!alive || ctx.mode !== 'tui' || !ctx.hasUI || !isCurrent(ctx)) return
    if (statusContext?.ui !== ctx.ui) clearStatus()
    statusOwners.set(ctx.ui, statusOwner)
    statusContext = ctx
    // Plain text inherits the existing footer's colors and geometry. This is
    // the stored compatibility mode, never an interception or savings claim.
    ctx.ui.setStatus('mahiro-rtk', `RTK ${available ? mode : 'unavailable'}`)
  }
  const read = (ctx: any, operation = 'read', execution = false) => {
    const b = rtkBinding(ctx.cwd)
    if (!b) throw Error('Canonical RTK profile/project binding unavailable')
    if (execution && owner.executionAccess) owner.executionAccess(ctx, b.root, b)
    else owner.access(ctx, b.root, operation)
    // Initialization reuses one fresh full binding within this synchronous
    // read. Preview and publication retain their own fresh binding checks.
    if (!execution) assertRTKBinding(b)
    const text = readRTKFile(join(b.root, 'state.json'))
    const defaultsText = text === null ? readRTKFile(join(b.root, 'default.json')) : null
    const defaults = defaultsText === null ? { version: 1, mode: 'off' } : JSON.parse(defaultsText)
    if (
      defaults.version !== 1 ||
      !rtkModes.includes(defaults.mode) ||
      Object.keys(defaults).some((k) => !['version', 'mode'].includes(k))
    )
      throw Error('Invalid installed RTK default')
    const state = text === null ? { version: 1, sequence: 0, mode: defaults.mode } : JSON.parse(text)
    validateRTKState(state)
    return { b, state, ticket: rtkHash(text ?? '<absent>') }
  }
  pi.on('session_shutdown', () => {
    clearStatus()
    alive = false
    epoch++
    mode = 'off'
    binding = null
    recent.length = 0
  })
  const authorizePreview = (ctx: any, command: string) => {
    const d = owner.permission(ctx, 'bash', command)
    if (d?.state !== 'allow') throw Error('RTK preview Bash permission required')
  }
  const assertPreview = (
    ctx: any,
    captured: number,
    b: NonNullable<ReturnType<typeof rtkBinding>>,
    ticket: string,
  ) => {
    if (!alive || captured !== epoch || !owner.current(ctx) || ctx.signal?.aborted)
      throw Error('RTK stale/cancelled')
    const current = read(ctx)
    if (JSON.stringify(current.b) !== JSON.stringify(b) || current.ticket !== ticket)
      throw Error('RTK binding changed')
  }
  const run = async (args: any, ctx: any) => {
    if (
      !args ||
      Array.isArray(args) ||
      Object.keys(args).some((k) => !['operation', 'mode', 'expected_sequence', 'command'].includes(k))
    )
      throw Error('Closed RTK arguments required')
    if (!alive || !owner.current(ctx) || ctx.signal?.aborted) throw Error('RTK generation unavailable')
    const { b, state, ticket } = read(ctx, args.operation === 'mode' ? 'write' : 'read')
    if (args.operation === 'mode') {
      if (
        !rtkModes.includes(args.mode) ||
        args.expected_sequence !== state.sequence ||
        !ctx.hasUI ||
        !['rpc', 'tui'].includes(ctx.mode)
      )
        throw Error('RTK mode requires exact sequence and actual UI')
      const captured = epoch,
        manager = ctx.sessionManager,
        session = manager.getSessionId()
      if (
        !(await ctx.ui.confirm(
          'Mahiro RTK mode',
          `${args.mode}\nSequence: ${state.sequence}\nSession: ${session}\nProject: ${b.project}\nProfile: ${b.profile}\nCompatibility state only: no mode intercepts Bash. Only explicit rewrite calls the bounded helper for a non-executing preview. No settings hooks or history access; preview is never an execution grant.`,
        ))
      )
        throw Error('RTK mode declined')
      const assert = () => {
        if (
          !alive ||
          captured !== epoch ||
          ctx.sessionManager !== manager ||
          manager.getSessionId() !== session ||
          !owner.current(ctx) ||
          ctx.signal?.aborted
        )
          throw Error('RTK session replaced')
        owner.access(ctx, b.root, 'write')
        assertRTKBinding(b)
      }
      assert()
      const next = {
        version: 1,
        sequence: state.sequence + 1,
        mode: args.mode,
      }
      publishRTKState(b, ticket, next, assert)
      mode = next.mode
      binding = b
      epoch++
      publishStatus(ctx, true)
      return { mode, sequence: next.sequence, hooksChanged: false }
    }
    if (!['status', 'log', 'rewrite', 'doctor', 'guidance', 'gain', 'projects'].includes(args.operation))
      throw Error('Unknown RTK operation')
    if (args.operation === 'rewrite') {
      const captured = epoch
      const original = await owner.finalArgs('bash', { command: args.command }, ctx)
      authorizePreview(ctx, args.command)
      authorizePreview(ctx, original.command)
      assertPreview(ctx, captured, b, ticket)
      const result: RTKRewriteResult = /^\s*git\s+commit(?:\s|$)/.test(original.command)
        ? { status: 'unchanged', command: null }
        : await resolveRTKRewrite(original.command, ctx)
      assertPreview(ctx, captured, b, ticket)
      return { ...result, executed: false, hostApprovalRequired: true }
    }
    return {
      mode: state.mode,
      sequence: state.sequence,
      activeThisGeneration: mode,
      automaticInterception: false,
      recent: args.operation === 'log' ? structuredClone(recent) : undefined,
      savings: 'unverified; no history reads or native usage/quota changes',
      binaryProbe: false,
      resolver:
        'explicit preview only: rtk rewrite -- <original>; exit 0/3 are candidates, 1 unchanged, 2 denied; errors return no candidate',
      helperBounds: RTK_HELPER_BOUNDS,
      supported:
        'all modes are compatibility state only; explicit rewrite previews the real helper without executing',
      doctor: 'No availability/version probe or history access; rewrite explicitly invokes the resolver',
      projects: args.operation === 'projects' ? [b.project] : undefined,
    }
  }
  registerWorkflowPresentation(pi)
  const attention = registerWorkflowAttention(pi)
  pi.registerTool({
    ...workflowRenderers('mh_rtk'),
    name: 'mh_rtk',
    label: 'Mahiro RTK',
    description:
      'Native RTK compatibility state and non-executing helper preview. New installations default off; existing state is preserved. No automatic Bash interception, history or savings claims. Mode writes require exact sequence and actual UI.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['status', 'mode', 'log', 'rewrite', 'doctor', 'guidance', 'gain', 'projects'],
        },
        mode: { type: 'string', enum: [...rtkModes] },
        expected_sequence: { type: 'integer', minimum: 0 },
        command: { type: 'string', maxLength: 4096 },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    async execute(_id: string, args: any, signal: AbortSignal, _update: any, ctx: any) {
      if (signal?.aborted) throw Error('RTK cancelled')
      const observe = attention.capture(ctx)
      const details = await run(args, { ...ctx, signal: signal ?? ctx.signal })
      observe('rtk', details)
      return {
        content: [{ type: 'text', text: JSON.stringify(details) }],
        details,
      }
    },
  })
  registerWorkflowCommand(pi, 'mh-rtk', {
    description:
      'Native RTK status | mode <off|suggest|rewrite-safe|rewrite-rtk> <sequence> | rewrite <command> | log | doctor | guidance',
    handler: async (input: string, ctx: any) => {
      try {
        if (
          input.length > 8192 ||
          // Only a blank spaces/tabs command bypasses the control guard.
          // Newlines and other controls remain rejected, including alone.
          (!/^[ \t]*$/.test(input) && /[\x00-\x1f\x7f]/.test(input))
        )
          throw Error('Bounded RTK command required')
        const [operation, requested, sequence] = (input.trim() || 'status').split(/\s+/)
        const args =
          operation === 'mode'
            ? {
                operation,
                mode: requested,
                expected_sequence: /^\d+$/.test(sequence ?? '') ? Number(sequence) : -1,
              }
            : operation === 'rewrite'
              ? { operation, command: input.slice(input.indexOf(' ') + 1) }
              : { operation }
        ctx.ui.notify(JSON.stringify(await run(args, ctx)), 'info')
      } catch (e) {
        ctx.ui.notify(e instanceof Error ? e.message : 'RTK failed', 'error')
      }
    },
  })
  return {
    initialize(ctx: any) {
      if (!alive || !isCurrent(ctx)) return
      epoch++
      mode = 'off'
      binding = null
      try {
        const current = read(ctx, 'read', true)
        mode = current.state.mode
        binding = current.b
      } catch {
        /* Unconfigured/unattested is disabled, never a grant. */
      }
      publishStatus(ctx, binding !== null)
    },
    async transform(input: any, _ctx: any, _effectiveBash?: (command: string) => boolean) {
      // Compatibility API only. No mode reads state, authorizes, invokes a
      // helper, records a log or changes native execution through this hook.
      return input
    },
  }
}
