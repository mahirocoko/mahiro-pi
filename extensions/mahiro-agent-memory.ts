import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { ACTIVITY_FRAME_MS, ACTIVITY_FRAMES } from '../lib/activity.ts'
import { registerWorkflowCommand, selectHubMenu } from '../lib/workflow-hub.ts'
import { registerWorkflowAttention, workflowAttention } from '../lib/workflow-attention.ts'
import { registerWorkflowPresentation, workflowRenderers } from '../lib/workflow-ui.ts'
import { memoryTools, type RuntimeConfig } from '../lib/agent-memory/runtime.ts'
import { createAgentMemoryRouter } from '../lib/agent-memory/runtime-router.ts'
import { memoryReadSchema } from '../lib/agent-memory/retrieval.ts'
import { publicMemoryError } from '../lib/agent-memory/reasons.ts'
import { reportOfflineResetFailure } from '../lib/agent-memory/offline-bootstrap.ts'

export function activateAgentMemory(pi: ExtensionAPI, config: RuntimeConfig = {}) {
  registerWorkflowPresentation(pi)
  const attention = registerWorkflowAttention(pi)
  const runtime = createAgentMemoryRouter(pi, config)
  const updateMemoryPolicy = async (
    ctx: any,
    next: {
      automatic: boolean
      reflectionTrigger?: 'off' | 'step-count' | 'compaction-event'
      reflectionStepCount?: number
    },
  ) => {
    const observe = attention.capture(ctx)
    const status = (await runtime.run('agent_memory_manage', { action: 'status' }, ctx)) as Record<
      string,
      unknown
    >
    if (typeof status?.revision !== 'string' || typeof status?.configHash !== 'string')
      throw Error('Authorized ABI2 memory status required before updating policy')
    const currentSteps = typeof status.reflectionStepCount === 'number' ? status.reflectionStepCount : 25
    const currentTrigger =
      typeof status.reflectionTrigger === 'string' &&
      ['off', 'step-count', 'compaction-event'].includes(status.reflectionTrigger)
        ? (status.reflectionTrigger as 'off' | 'step-count' | 'compaction-event')
        : status.automatic
          ? 'step-count'
          : 'off'
    const reflectionTrigger =
      next.reflectionTrigger ??
      (next.automatic ? (currentTrigger === 'off' ? 'step-count' : currentTrigger) : 'off')
    const reflectionStepCount = next.reflectionStepCount ?? currentSteps
    const result = await runtime.run(
      'agent_memory_manage',
      {
        action: 'policy',
        revision: status.revision,
        configHash: status.configHash,
        automatic: next.automatic,
        reflectionTrigger,
        reflectionStepCount,
      },
      ctx,
    )
    observe('memory', result)
    return result
  }
  const memoryCommand: Parameters<typeof registerWorkflowCommand>[2] = {
    description:
      'Memory readiness, one bounded ABI2 Palace viewer, policy controls, diagnostics, remember, dream and tiered v2 init',
    handler: async (args, ctx) => {
      const trimmed = args.trim()
      const [subcommand, ...rest] = trimmed ? trimmed.split(/\s+/) : ['status']
      const restText = rest.join(' ').trim()
      if (
        ![
          'status',
          'menu',
          'policy',
          'help',
          'capacity',
          'retained-preview',
          'cleanup',
          'retire',
          'prepared-retire',
          'remember',
          'dream',
          'doctor',
          'palace',
          'context',
          'palace-context',
          'palace-history',
          'palace-html',
          'init',
        ].includes(subcommand)
      ) {
        ctx.ui.notify(
          'Use /mh-memory [status|menu|policy [on|off|step-count <1..100000>|compaction-event]|help|capacity|retained-preview|cleanup|retire|prepared-retire [status]|remember <text>|dream|doctor|palace [close|json]|init]. This command never enables memory or changes permissions.',
          'warning',
        )
        return
      }
      if (subcommand === 'help') {
        ctx.ui.notify(
          'Memory: /mh-memory status diagnoses prerequisites without requiring storage. /mh-memory capacity is the idle count-only storage diagnostic and can run after a successful status; it returns no names, paths, record bodies, or cleanup handle. A model tool turn is not idle. /mh-memory retained-preview classifies retained draft manifests without archiving, unlinking, or proving another controller is idle; safe candidates stay zero while cross-controller exclusion is unproven. /mh-memory cleanup cancels any active uncommitted primary draft, retires unpublished controller plans and ownerless prepared journals, and reclaims terminal/expired drafts, journals and unreferenced overlay blobs. /mh-memory retire permanently fences this primary memory generation and waits for its actual registered continuations, controller, publication and holds, without stopping foreground work or unrelated agents. It does not prove global root quiescence or repair uncertain operations; ABI1 and older owners report unsupported. /mh-memory prepared-retire [status] accepts only strict ownerless-prepared or locked-prepared publication evidence. With no argument it drains this capable memory generation and returns an exact offline-required target/revision handoff, without a new maintenance marker, archive, quarantine or global-quiescence claim; status only inspects. Legacy/mixed-version roots still require coordinated offline recovery. /mh-memory doctor returns engine-specific JSON diagnostics. /mh-memory palace opens one immutable ten-minute ABI2 metadata viewer on a capability-scoped 127.0.0.1 URL; it combines bounded invocation metadata, owner-certified committed structure and one offset-zero identity/time history page while remaining explicitly non-atomic and non-replayable. It best-effort opens the capability URL in the system browser and renders bounded committed file previews and sanitized history diffs without exposing raw Git headers or authors. Use /mh-memory palace close to stop it, or /mh-memory palace json for the legacy structural/link/view/episode JSON diagnostic. /mh-memory remember <text> appends a concise durable note to system/human/notes.md. /mh-memory dream dispatches background reflection on unreviewed episodes. /mh-memory init seeds non-destructive tiered v2 layout and migrates legacy blocks. agent_memory_manage status adds authorized automatic On/Off, draft/publication and latest attempt. Policy reconciliation requires current revision/config and actual process-local drain; unknown operations require owner review, not lock stealing. A private draft or writer-ready checkpoint is not publication: only the healthy parent integrates successful completion and context activates on the next request. Installation/route changes need explicit approval and a fresh session; no provider inference or credentials are resolved by status.',
          'info',
        )
        return
      }
      try {
        const observe = attention.capture(ctx)
        const openPalace = async () => {
          if (ctx.mode !== 'tui' || !ctx.hasUI) return
          const label = 'Generating Memory viewer...'
          let frameIndex = 0
          const renderIndicator = () => {
            const rawFrame = ACTIVITY_FRAMES[frameIndex % ACTIVITY_FRAMES.length]!
            frameIndex++
            const frame = ctx.ui.theme?.fg?.('accent', rawFrame) ?? rawFrame
            const text = ctx.ui.theme?.fg?.('muted', label) ?? label
            ctx.ui.setWidget?.('mahiro-palace', [`${frame} ${text}`])
          }
          renderIndicator()
          ctx.ui.setStatus?.('mahiro-palace', `⏳ ${label}`)
          const timer = setInterval(renderIndicator, ACTIVITY_FRAME_MS)
          timer.unref?.()
          try {
            const result = await runtime.openPalaceViewer(ctx)
            ctx.ui.notify(
              `Memory viewer opened in browser\n  File: ${result.filePath}\n  Close: ${result.closeCommand}`,
              'info',
            )
          } finally {
            clearInterval(timer)
            ctx.ui.setWidget?.('mahiro-palace', undefined)
            ctx.ui.setStatus?.('mahiro-palace', undefined)
          }
        }
        const closePalace = async () => {
          const result = await runtime.closePalaceViewer()
          ctx.ui.notify(result.closed ? 'Palace viewer closed.' : 'No Palace viewer is open.', 'info')
        }
        if (subcommand === 'status') {
          const result = await runtime.diagnose(ctx)
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'capacity') {
          if (rest.length) {
            ctx.ui.notify('Usage: /mh-memory capacity', 'warning')
            return
          }
          const result = await runtime.run('agent_memory_manage', { action: 'capacity' }, ctx)
          observe('memory', result)
          ctx.ui.notify(
            JSON.stringify(result, null, 2),
            workflowAttention('memory', result) ? 'warning' : 'info',
          )
          return
        }
        if (subcommand === 'retained-preview') {
          if (rest.length) {
            ctx.ui.notify('Usage: /mh-memory retained-preview', 'warning')
            return
          }
          const result = await runtime.run('agent_memory_manage', { action: 'retained-preview' }, ctx)
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'cleanup') {
          if (rest.length) {
            ctx.ui.notify('Usage: /mh-memory cleanup', 'warning')
            return
          }
          const result = await runtime.run('agent_memory_manage', { action: 'cleanup' }, ctx)
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'prepared-retire') {
          if (rest.length > 1 || (rest.length === 1 && rest[0] !== 'status')) {
            ctx.ui.notify('Usage: /mh-memory prepared-retire [status]', 'warning')
            return
          }
          const result = await runtime.run(
            'agent_memory_manage',
            { action: rest.length ? 'prepared-retire-status' : 'prepared-retire' },
            ctx,
          )
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'retire') {
          if (rest.length) {
            ctx.ui.notify('Usage: /mh-memory retire (no arguments)', 'warning')
            return
          }
          const result = await runtime.retireMemory(ctx)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'doctor') {
          const result = await runtime.run('agent_memory_manage', { action: 'doctor' }, ctx)
          observe('memory', result)
          ctx.ui.notify(
            JSON.stringify(result, null, 2),
            workflowAttention('memory', result) ? 'warning' : 'info',
          )
          return
        }
        if (subcommand === 'palace') {
          if (rest.length === 0) {
            await openPalace()
            return
          }
          if (rest.length === 1 && rest[0] === 'close') {
            await closePalace()
            return
          }
          if (rest.length === 1 && rest[0] === 'json') {
            const result = await runtime.run('agent_memory_manage', { action: 'palace' }, ctx)
            observe('memory', result)
            ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
            return
          }
          ctx.ui.notify('Usage: /mh-memory palace [close|json]', 'warning')
          return
        }
        if (subcommand === 'palace-history') {
          if (
            rest.length > 1 ||
            (rest.length === 1 && (!/^(?:0|[1-9][0-9]{0,2})$/.test(rest[0]) || Number(rest[0]) > 127))
          ) {
            ctx.ui.notify('Usage: /mh-memory palace-history [offset 0..127]', 'warning')
            return
          }
          const result = await runtime.knowledgeHistory(ctx, rest.length ? Number(rest[0]) : 0)
          ctx.ui.notify(JSON.stringify(result), 'info')
          return
        }
        if (subcommand === 'palace-context') {
          if (rest.length) {
            ctx.ui.notify('Usage: /mh-memory palace-context (no arguments)', 'warning')
            return
          }
          const result = await runtime.capturePalaceContext(ctx)
          ctx.ui.notify(JSON.stringify(result), 'info')
          return
        }
        if (subcommand === 'palace-html') {
          if (rest.length === 1 && rest[0] === 'close') {
            await closePalace()
            return
          }
          if (rest.length) {
            ctx.ui.notify('Usage: /mh-memory palace-html [close]', 'warning')
            return
          }
          await openPalace()
          return
        }
        if (subcommand === 'context') {
          const result = await runtime.captureInvocation(ctx)
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'init') {
          if (ctx.mode === 'tui' && ctx.hasUI) {
            const header = ctx.sessionManager.getHeader?.() as unknown as Record<string, unknown> | undefined
            if (header && header.parentSession !== undefined) {
              delete header.parentSession
              const sessionFile = ctx.sessionManager.getSessionFile?.()
              if (typeof sessionFile === 'string' && sessionFile) {
                try {
                  const { readFileSync, statSync, writeFileSync } = await import('node:fs')
                  const mode = statSync(sessionFile).mode & 0o777
                  const raw = readFileSync(sessionFile, 'utf8')
                  const newline = raw.indexOf('\n')
                  const firstLine = newline >= 0 ? raw.slice(0, newline) : raw
                  const parsed = JSON.parse(firstLine) as Record<string, unknown>
                  if (parsed && typeof parsed === 'object' && parsed.parentSession !== undefined) {
                    delete parsed.parentSession
                    const updated = `${JSON.stringify(parsed)}${newline >= 0 ? raw.slice(newline) : ''}`
                    writeFileSync(sessionFile, updated, { encoding: 'utf8', mode })
                  }
                } catch {
                  // Session file header detach is best-effort.
                }
              }
            }
          }
          const inited = await runtime.run(
            'agent_memory_manage',
            {
              action: 'init-project',
              ...(rest[0] && /^[a-z0-9][a-z0-9-]{0,63}$/.test(rest[0]) ? { projectId: rest[0] } : {}),
            },
            ctx,
          )
          const migrated = await runtime.run('agent_memory_manage', { action: 'migrate-v2' }, ctx)
          try {
            const { existsSync, readdirSync, readFileSync } = await import('node:fs')
            const { join } = await import('node:path')
            const { hasSecret } = await import('../lib/continuity/records.ts')
            const topEntries = readdirSync(ctx.cwd)
              .filter((name) => !name.startsWith('.'))
              .slice(0, 24)
              .join(', ')
            const snippets: string[] = []
            if (topEntries) snippets.push(`Top-level entries: ${topEntries}`)
            for (const candidate of [
              'package.json',
              'pyproject.toml',
              'Cargo.toml',
              'go.mod',
              'AGENTS.md',
              'CLAUDE.md',
              'README.md',
            ]) {
              const filePath = join(ctx.cwd, candidate)
              if (!existsSync(filePath)) continue
              const raw = readFileSync(filePath, 'utf8')
                .replace(/[\r\n\t]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 420)
              if (raw && !hasSecret(raw)) snippets.push(`${candidate}: ${raw}`)
            }
            if (snippets.length) {
              const summary = snippets.join(' | ').slice(0, 2400)
              await runtime
                .run(
                  'agent_memory_reflect',
                  {
                    assignment: `Initialize this project's tiered memory (projects/<project>/system/overview.md and projects/<project>/system/conventions.md) and update index.md from these repository facts: ${summary}`,
                  },
                  ctx,
                )
                .catch(() => undefined)
            }
          } catch {
            // Best-effort repository scan for /mh-memory init reflection.
          }
          const result = { migrated, initialized: inited }
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'remember') {
          if (!restText) {
            ctx.ui.notify('Usage: /mh-memory remember <concise durable note>', 'warning')
            return
          }
          const result = await runtime.run('agent_memory_manage', { action: 'remember', text: restText }, ctx)
          if (result && typeof result === 'object' && 'remembered' in result && result.remembered === true) {
            const notePreview = restText.slice(0, 1500)
            await runtime
              .run(
                'agent_memory_reflect',
                {
                  assignment: `Classify and consolidate this explicit user remember note into the appropriate tiered memory file (system/human/prefs/*, system/human/identity.md, or projects/<project>/system/*) and update index.md: ${notePreview}`,
                },
                ctx,
              )
              .catch(() => undefined)
          }
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'dream') {
          const assignment =
            restText ||
            'Review unreviewed episodes and consolidate durable project/user lessons into tiered memory files without losing existing facts.'
          const result = await runtime.run('agent_memory_reflect', { assignment }, ctx)
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'policy') {
          if (!rest.length) {
            await openMemoryMenu(ctx)
            return
          }
          const modeArg = rest[0].toLowerCase()
          if (modeArg === 'on' || modeArg === 'off') {
            const result = await updateMemoryPolicy(ctx, { automatic: modeArg === 'on' })
            ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
            return
          }
          if (modeArg === 'compaction-event' || modeArg === 'compaction') {
            const result = await updateMemoryPolicy(ctx, {
              automatic: true,
              reflectionTrigger: 'compaction-event',
            })
            ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
            return
          }
          if (modeArg === 'step-count') {
            const steps = rest[1] ? Number(rest[1]) : 25
            if (!Number.isInteger(steps) || steps < 1 || steps > 100000) {
              ctx.ui.notify('Usage: /mh-memory policy step-count <1..100000>', 'warning')
              return
            }
            const result = await updateMemoryPolicy(ctx, {
              automatic: true,
              reflectionTrigger: 'step-count',
              reflectionStepCount: steps,
            })
            ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
            return
          }
          ctx.ui.notify(
            'Usage: /mh-memory policy [on|off|step-count <1..100000>|compaction-event]',
            'warning',
          )
          return
        }
        if (subcommand === 'menu') {
          await openMemoryMenu(ctx)
          return
        }
      } catch (error) {
        ctx.ui.notify(publicMemoryError(error).message, 'warning')
      }
    },
  }
  const openDiagnosticsMenu = async (ctx: any): Promise<boolean> => {
    while (ctx.mode === 'tui' && ctx.hasUI) {
      const statusRow = 'Inspect full status JSON (/mh-memory status)'
      const doctorRow = 'Run Doctor (/mh-memory doctor)'
      const cleanupRow = 'Cleanup drafts & journals (/mh-memory cleanup)'
      const capacityRow = 'Check Capacity (/mh-memory capacity) [idle only]'
      const retainedRow = 'Retained drafts preview (/mh-memory retained-preview)'
      const preparedRow = 'Prepared retirement status (/mh-memory prepared-retire status)'
      const retireRow = 'Retire memory generation… (/mh-memory retire) [confirm]'
      const backRow = '← Back to Managed Memory'
      const choice = await selectHubMenu(
        ctx,
        'Managed Memory · diagnostics & maintenance',
        [
          {
            value: statusRow,
            label: 'Full status JSON  view',
            description: 'Inspect complete managed memory status and policy diagnostics · /mh-memory status',
          },
          {
            value: doctorRow,
            label: 'Memory Doctor  run',
            description: 'Audit managed memory health, scope and repository state · /mh-memory doctor',
          },
          {
            value: cleanupRow,
            label: 'Cleanup drafts  run',
            description:
              'Cancel active draft, retire stranded prepared plans and reclaim stale drafts/journals · /mh-memory cleanup',
          },
          {
            value: capacityRow,
            label: 'Check capacity  idle',
            description: 'Run count-only idle primary capacity diagnostic · /mh-memory capacity',
          },
          {
            value: retainedRow,
            label: 'Retained drafts  view',
            description: 'Preview retained unpublished memory drafts · /mh-memory retained-preview',
          },
          {
            value: preparedRow,
            label: 'Prepared retire  status',
            description: 'Inspect prepared retirement status · /mh-memory prepared-retire status',
          },
          {
            value: retireRow,
            label: 'Retire generation  confirm',
            description:
              'Permanently fence this primary memory generation and drain continuations · /mh-memory retire',
          },
          {
            value: backRow,
            label: '← Back to Memory  esc',
            description: 'Return to Managed Memory controls',
          },
        ],
        { hint: '↑/↓ focus · Enter/Space select · Esc/← back' },
      )
      if (!choice || choice === backRow) return true
      if (choice === statusRow) await memoryCommand.handler('status', ctx)
      else if (choice === doctorRow) await memoryCommand.handler('doctor', ctx)
      else if (choice === cleanupRow) await memoryCommand.handler('cleanup', ctx)
      else if (choice === capacityRow) await memoryCommand.handler('capacity', ctx)
      else if (choice === retainedRow) await memoryCommand.handler('retained-preview', ctx)
      else if (choice === preparedRow) await memoryCommand.handler('prepared-retire status', ctx)
      else if (choice === retireRow) {
        const confirmed =
          typeof ctx.ui.confirm === 'function'
            ? await ctx.ui.confirm(
                'Retire this primary memory generation?',
                'Permanently fences this generation and drains its active memory continuations.',
              )
            : false
        if (confirmed) await memoryCommand.handler('retire', ctx)
      }
    }
    return false
  }
  const openMemoryMenu = async (ctx: any): Promise<boolean | void> => {
    if (ctx.mode !== 'tui' || !ctx.hasUI) return
    while (ctx.mode === 'tui' && ctx.hasUI) {
      let diag: Record<string, unknown>
      try {
        diag = (await runtime.diagnose(ctx)) as Record<string, unknown>
        attention.capture(ctx)('memory', diag)
      } catch (error) {
        ctx.ui.notify(publicMemoryError(error).message, 'warning')
        return
      }
      const readiness = typeof diag.readiness === 'string' ? diag.readiness : 'Needs setup'
      const storage = diag.storage === 'authorized'
      const backHub = '← Back to /mh'
      if (!storage) {
        const causes = Array.isArray(diag.causes) ? (diag.causes as Array<{ cause?: string }>) : []
        const reason =
          causes[0]?.cause ?? (typeof diag.storageReason === 'string' ? diag.storageReason : 'unavailable')
        const statusRow = 'Inspect readiness & causes (/mh-memory status)'
        const initRow = 'Initialize project memory (/mh-memory init)'
        const helpRow = 'Help (/mh-memory help)'
        const choice = await selectHubMenu(
          ctx,
          `Managed Memory · ${readiness} (${reason})`,
          [
            {
              value: statusRow,
              label: 'Readiness & causes  view',
              description: 'Inspect storage authority readiness and diagnostic causes · /mh-memory status',
            },
            {
              value: initRow,
              label: 'Initialize memory  init',
              description: 'Seed absent managed memory root for the current project · /mh-memory init',
            },
            {
              value: helpRow,
              label: 'Memory help  view',
              description: 'Show available /mh-memory subcommands and usage · /mh-memory help',
            },
            {
              value: backHub,
              label: '← Back to /mh  esc',
              description: 'Return to Mahiro Control Center',
            },
          ],
          { hint: '↑/↓ focus · Enter/Space select · Esc/← back' },
        )
        if (!choice || choice === backHub) return true
        if (choice === statusRow) await memoryCommand.handler('status', ctx)
        else if (choice === initRow) await memoryCommand.handler('init', ctx)
        else if (choice === helpRow) await memoryCommand.handler('help', ctx)
        continue
      }
      const abi = typeof diag.engineABI === 'number' ? diag.engineABI : 1
      const project = typeof diag.project === 'string' ? diag.project : undefined
      const auto = typeof diag.automatic === 'boolean' ? diag.automatic : false
      const trigger =
        typeof diag.reflectionTrigger === 'string' ? diag.reflectionTrigger : auto ? 'step-count' : 'off'
      const stepCount = typeof diag.reflectionStepCount === 'number' ? diag.reflectionStepCount : 25
      const worker = typeof diag.worker === 'string' ? diag.worker : 'idle'
      if (abi !== 2) {
        const statusRow = 'Inspect status (/mh-memory status)'
        const doctorRow = 'Run Doctor (/mh-memory doctor)'
        const cleanupRow = 'Cleanup drafts (/mh-memory cleanup)'
        const choice = await selectHubMenu(
          ctx,
          `Managed Memory · ${readiness} (ABI${abi})`,
          [
            {
              value: statusRow,
              label: 'Memory status  view',
              description: 'Inspect current managed memory status · /mh-memory status',
            },
            {
              value: doctorRow,
              label: 'Memory Doctor  run',
              description: 'Audit managed memory health and scope · /mh-memory doctor',
            },
            {
              value: cleanupRow,
              label: 'Cleanup drafts  run',
              description: 'Cancel active draft and reclaim stale views · /mh-memory cleanup',
            },
            {
              value: backHub,
              label: '← Back to /mh  esc',
              description: 'Return to Mahiro Control Center',
            },
          ],
          { hint: '↑/↓ focus · Enter/Space select · Esc/← back' },
        )
        if (!choice || choice === backHub) return true
        if (choice === statusRow) await memoryCommand.handler('status', ctx)
        else if (choice === doctorRow) await memoryCommand.handler('doctor', ctx)
        else if (choice === cleanupRow) await memoryCommand.handler('cleanup', ctx)
        continue
      }
      const autoRow = `Automatic reflection · ${auto ? 'ON' : 'OFF'} [memory policy]`
      const triggerDetail = trigger === 'step-count' ? `step-count (${stepCount} turns)` : String(trigger)
      const triggerRow = `Reflection trigger · ${triggerDetail} [memory policy]`
      const dreamRow = 'Run reflection now (/mh-memory dream)'
      const palaceOpenRow = 'Open Palace viewer · 10m browser snapshot'
      const palaceCloseRow = 'Close Palace viewer'
      const rememberRow = 'Remember a note… (/mh-memory remember)'
      const initRow = 'Initialize project memory (/mh-memory init)'
      const diagRow = 'Diagnostics & Maintenance ▸'
      const triggerShort =
        trigger === 'step-count' ? `${stepCount}t` : trigger === 'compaction-event' ? 'compact' : 'off'
      const choice = await selectHubMenu(
        ctx,
        `Managed Memory · ${readiness} (ABI2${project ? ` · ${project}` : ''} · worker: ${worker})`,
        [
          {
            value: autoRow,
            label: `Auto reflection  ${auto ? 'on' : 'off'}`,
            description: 'Toggle automatic background reflection in memory policy (not host settings)',
          },
          {
            value: triggerRow,
            label: `Reflection trigger  ${triggerShort}`,
            description: `Current trigger: ${triggerDetail}. Configure step-count, compaction or off in memory policy`,
          },
          {
            value: dreamRow,
            label: 'Run reflection  dream',
            description: 'Launch an explicit on-demand memory reflection pass now · /mh-memory dream',
          },
          {
            value: palaceOpenRow,
            label: 'Palace viewer  open',
            description: 'Open the 10-minute loopback Memory Palace browser snapshot · /mh-memory palace',
          },
          {
            value: palaceCloseRow,
            label: 'Palace viewer  close',
            description: 'Close the active loopback Memory Palace preview server · /mh-memory palace close',
          },
          {
            value: rememberRow,
            label: 'Remember a note  input',
            description: 'Record a concise durable note into system/human/notes.md · /mh-memory remember',
          },
          {
            value: initRow,
            label: 'Initialize memory  init',
            description:
              'Seed absent project memory starter files without overwriting existing roots · /mh-memory init',
          },
          {
            value: diagRow,
            label: 'Diagnostics  more ▸',
            description: 'Status JSON, Doctor, idle capacity, retained drafts and generation retirement',
          },
          {
            value: backHub,
            label: '← Back to /mh  esc',
            description: 'Return to Mahiro Control Center',
          },
        ],
        { hint: '↑/↓ focus · Enter/Space select · Esc/← back' },
      )
      if (!choice || choice === backHub) return true
      try {
        if (choice === autoRow) {
          const result = await updateMemoryPolicy(ctx, { automatic: !auto })
          ctx.ui.notify(
            `Automatic reflection ${!auto ? 'ON' : 'OFF'} [memory policy].\n${JSON.stringify(result, null, 2)}`,
            'info',
          )
        } else if (choice === triggerRow) {
          const stepDefault = `step-count · every 25 turns [memory policy]`
          const stepCustom = `step-count · custom turn interval (current: ${stepCount})… [memory policy]`
          const compactionOpt = 'compaction-event · on context compaction [memory policy]'
          const offOpt = 'off · disable automatic reflection [memory policy]'
          const backOpt = '← Back'
          const picked = await selectHubMenu(
            ctx,
            `Reflection trigger · current: ${triggerDetail}`,
            [
              {
                value: stepDefault,
                label: 'Step count  25 turns',
                description: 'Enable automatic reflection every 25 turns in memory policy',
              },
              {
                value: stepCustom,
                label: `Custom interval  ${stepCount}t`,
                description:
                  'Set a custom turn interval (1..100000) for automatic reflection in memory policy',
              },
              {
                value: compactionOpt,
                label: 'Compaction event  auto',
                description: 'Trigger automatic reflection when context compaction occurs in memory policy',
              },
              {
                value: offOpt,
                label: 'Disable trigger  off',
                description: 'Turn off automatic reflection trigger in memory policy',
              },
              {
                value: backOpt,
                label: '← Back  esc',
                description: 'Return to Managed Memory controls without changing trigger policy',
              },
            ],
            { hint: '↑/↓ focus · Enter/Space select · Esc/← back' },
          )
          if (!picked || picked === backOpt) continue
          if (picked === stepDefault) {
            const result = await updateMemoryPolicy(ctx, {
              automatic: true,
              reflectionTrigger: 'step-count',
              reflectionStepCount: 25,
            })
            ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          } else if (picked === stepCustom) {
            const raw =
              typeof ctx.ui.input === 'function'
                ? await ctx.ui.input('Reflection turn interval (1..100000)', String(stepCount))
                : undefined
            if (!raw?.trim()) continue
            const steps = Number(raw.trim())
            if (!Number.isInteger(steps) || steps < 1 || steps > 100000) {
              ctx.ui.notify('Reflection step count must be an integer between 1 and 100000.', 'warning')
              continue
            }
            const result = await updateMemoryPolicy(ctx, {
              automatic: true,
              reflectionTrigger: 'step-count',
              reflectionStepCount: steps,
            })
            ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          } else if (picked === compactionOpt) {
            const result = await updateMemoryPolicy(ctx, {
              automatic: true,
              reflectionTrigger: 'compaction-event',
            })
            ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          } else if (picked === offOpt) {
            const result = await updateMemoryPolicy(ctx, {
              automatic: false,
              reflectionTrigger: 'off',
            })
            ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          }
        } else if (choice === dreamRow) {
          await memoryCommand.handler('dream', ctx)
        } else if (choice === palaceOpenRow) {
          await memoryCommand.handler('palace', ctx)
        } else if (choice === palaceCloseRow) {
          await memoryCommand.handler('palace close', ctx)
        } else if (choice === rememberRow) {
          const note =
            typeof ctx.ui.input === 'function'
              ? await ctx.ui.input('Concise durable note to remember (system/human/notes.md)')
              : undefined
          if (note?.trim()) await memoryCommand.handler(`remember ${note.trim()}`, ctx)
        } else if (choice === initRow) {
          await memoryCommand.handler('init', ctx)
        } else if (choice === diagRow) {
          const backToMemory = await openDiagnosticsMenu(ctx)
          if (!backToMemory) return
        }
      } catch (error) {
        ctx.ui.notify(publicMemoryError(error).message, 'warning')
      }
    }
  }
  registerWorkflowCommand(pi, 'mh-memory', memoryCommand, { open: openMemoryMenu })
  const string = { type: 'string' }
  const schemas = {
    agent_memory_read: memoryReadSchema,
    agent_memory_edit: {
      properties: {
        path: string,
        expectedHash: { type: ['string', 'null'] },
        text: { type: ['string', 'null'] },
        sources: { type: 'array', items: string, maxItems: 32 },
        mode: { type: 'string', enum: ['replace', 'patch', 'append'] },
        oldText: string,
        newText: string,
        section: string,
        commit: { type: 'boolean' },
        allowShrink: { type: 'boolean' },
      },
      required: ['path'],
    },
    agent_memory_commit: {
      properties: {
        revision: string,
        allowShrink: { type: 'boolean' },
      },
      required: ['revision'],
    },
    agent_memory_manage: {
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'capacity',
            'retained-preview',
            'prepared-retire-status',
            'prepared-retire',
            'doctor',
            'palace',
            'migration-export',
            'init-project',
            'migrate-v2',
            'remember',
            'policy',
            'policy-reconcile',
            'offline-inspect',
            'offline-reset-inspect',
            'offline-reset',
            'offline-adopt',
            'offline-resume',
            'offline-episode-inspect',
            'offline-episode-recover',
            'offline-episode-resume',
            'offline-draft-inspect',
            'offline-draft-archive',
            'offline-draft-resume',
            'offline-draft-rollback',
            'offline-draft-park-inspect',
            'offline-draft-park',
            'offline-draft-restore-inspect',
            'offline-draft-restore',
            'cleanup',
            'cancel',
            'forget',
            'rollback',
            'initialize',
            'conflicts',
            'discard',
            'reconcile',
          ],
        },
        revision: string,
        configHash: string,
        offline: { type: 'string', enum: ['known-profile-closed-no-cooperative-writers-start'] },
        destruction: { type: 'string', enum: ['destroy-entire-standard-memory-root-no-backup'] },
        paths: { type: 'array', items: string, maxItems: 128 },
        sources: { type: 'array', items: string, maxItems: 128 },
        target: string,
        path: string,
        text: { type: 'string', maxLength: 4096 },
        section: string,
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 4096 },
        core: { type: 'string', maxLength: 8192 },
        projectId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
        automatic: { type: 'boolean' },
        reflectionTrigger: { type: 'string', enum: ['off', 'step-count', 'compaction-event'] },
        reflectionStepCount: { type: 'integer', minimum: 1, maximum: 100000 },
      },
      required: ['action'],
    },
    agent_memory_reflect: {
      properties: {
        assignment: { type: 'string', minLength: 1, maxLength: 4096 },
      },
      required: ['assignment'],
    },
  }
  for (const name of memoryTools)
    pi.registerTool({
      name,
      label: name,
      ...workflowRenderers(name),
      description: {
        agent_memory_read:
          "Read maintained knowledge within the authenticated view. Mutually exclusive modes: {} legacy file list; path with original Unicode code-point paging (4096 max) or tiered directory-entry paging (32 file entries max, plus up to 32 immediate child directories and a bounded prefix of that directory's in-scope index.md); query for bounded English/Thai lexical search with stopword stripping, multi-term coverage, and optional | or OR clauses (256 UTF-8 bytes, 16 terms, limit 8); topic='' for namespaces, topic='*' for all files, or a namespace (limit 32). Query/topic offset pages scan/files; follow nextOffset until complete. Search scans at most 1 MiB per page and returns at most 32 KiB, with original snippet offsets, whole-file hashes and source IDs. basis/baseRevision/currentRevision/freshness distinguish private drafts and stale snapshots from current truth. Current forgetting/authority changes make old views unavailable, never successful no-match. Read all path pages before replacement. No arbitrary root/project selection or filesystem access.",
        agent_memory_edit:
          'Add, replace, patch, append or remove scoped Markdown in a private draft, or pass commit=true (and optional allowShrink=true) to auto-sync <dir>/index.md and index.md links and publish/integrate in one step. expectedHash is from read (null for a new file); text=null removes a non-core file (Core.md, index.md and read_only: true files cannot be removed or modified). Sources link observed episode IDs. Revise contradictory knowledge at its existing owner instead of appending it.',
        agent_memory_commit:
          'Commit/integrate the current private memory draft against its base revision. Disjoint edits merge automatically; overlapping edits preserve a conflict. Native workers mark ready; the healthy parent integrates only after successful completion. Active primary context refreshes on the next request.',
        agent_memory_manage:
          'Primary-only new-store initialization (explicit core/projectId, optional automatic), bounded memory status, cancellation, source/path forgetting and rollback. capacity is the same idle-primary count-only storage diagnostic as a failed status; a model tool turn is not idle, so use /mh-memory capacity. It returns no names, paths, record bodies, or cleanup handle. retained-preview is an idle-primary read-only classification of retained draft manifests. It does not archive, unlink, or prove another controller is idle, and its safe candidate count stays zero. A model tool turn is not idle, so use /mh-memory retained-preview. It returns no names, paths, record bodies, overlay bytes, or cleanup handle. Terminal-draft recovery is not this preview: the explicit offline --drafts operator archives only committed or cancelled empty-overlay manifests that no journal references, after cooperative lsof and the known-profile assurance. That assurance is not a dormant same-user or hostile-process proof. conflicts lists up to 8 retained views; target selects a view, path selects a proposal file. Read all pages with Unicode offset/limit (4096 maximum) before recovery; proposalHash covers the full text. Resolve manually through current CAS tools, then discard that view with current revision. Initialization never overwrites an existing root or native bootstrap; separate root permission must already exist. Requires current revision for changes. migration-export is a primary read of the current committed revision. Page section binding, sources, forgotten-paths, forgotten-sources or reviewed with offset/limit at most 32 entries. Every page repeats that revision, config hash and whole ledger digest, and a changed revision fails stale. sources rows include each active file committed SHA-256 content hash, the same hash agent_memory_read returns, and no file text. It returns no credentials, root paths, draft bodies or unrelated corpus, and it does not apply a migration. Logical forgetting filters recovery, not secure Git/history erasure. Revise Core/index to remove the forgotten knowledge and its source link before source-forgetting, preserving identity. Global/deferred/procedure source-forgetting conservatively removes entire affected files. ABI2: policy changes automatic admission with current revision/configHash, and may set reflectionTrigger plus reflectionStepCount from 1 through 100000; it never changes permissions, engine or writer route. Status policyOperation diagnoses policy lock retention and observed outcome, not unchanged-on-abort. policy-reconcile uses target UUID and revision=policy digest from status, only after actual executor drain under fresh primary authority; removes verified owned staging/lock only, never changes config. Missing references/restart/mismatches retain unknown evidence for owner review. Reconcile observes one existing publication operation (target UUID, revision plan digest); never replays publication, returns chunks, steals locks or initializes an existing root.',
        agent_memory_reflect:
          'Assign a locked native background writer to maintain the SAME private memory using current scoped episodes. No caller-chosen role/model/path. Registration, authority and native identity binding must already exist. Does not claim provider proof or semantic correctness.',
      }[name],
      promptGuidelines: [
        'Memory is fallible maintained knowledge, not permission policy. Preserve established identity and current instructions. Read before editing; consolidate/revise existing knowledge, cite observed evidence, avoid speculative preferences and archive-to-instruction promotion. On tiered v2 stores, Core.md, index.md, non-index system/** (system/persona.md, system/human/identity.md, system/human/prefs/*.md) and current-project non-index projects/<id>/system/** (such as overview.md and conventions.md) are always loaded; reference/** and projects/<id>/reference/** hold deferred reference notes, and procedures/** holds reusable workflows (superseding legacy global/ and deferred/ paths). When the user asks to remember, initialize, audit, or repair durable facts or preferences, load the maintaining-core-memory, maintaining-deferred-memory, initializing-memory, context-doctor, or syncing-memory-filesystem skill and update the canonical owner (such as system/human/identity.md or system/human/prefs/*.md) via agent_memory_read -> agent_memory_edit -> agent_memory_commit instead of dumping unindexed notes into system/human/notes.md. Refresh parent <dir>/index.md when directory files change. Respect read_only: true frontmatter. Commit only appropriate durable knowledge. Never copy secrets or excluded project data.',
      ],
      parameters: {
        type: 'object',
        additionalProperties: false,
        ...schemas[name],
      },
      executionMode: 'sequential',
      async execute(_id, args, signal, _update, ctx) {
        try {
          const observe = attention.capture(ctx)
          const result = await runtime.run(name, args, ctx, signal)
          observe('memory', result)
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            details: result,
          }
        } catch (error) {
          if (
            name === 'agent_memory_manage' &&
            'action' in args &&
            ['offline-reset', 'offline-reset-inspect'].includes(args.action as string)
          )
            reportOfflineResetFailure(ctx.sessionManager.getSessionId(), _id, error)
          throw publicMemoryError(error, name === 'agent_memory_read')
        }
      },
    })
  return runtime
}
export default function mahiroAgentMemory(pi: ExtensionAPI) {
  activateAgentMemory(pi)
}
