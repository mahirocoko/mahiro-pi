import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerWorkflowCommand, selectHubMenu } from '../lib/workflow-hub.ts'
import { registerWorkflowAttention } from '../lib/workflow-attention.ts'
import { registerWorkflowPresentation, workflowRenderers } from '../lib/workflow-ui.ts'
import { EXECUTION_RUN_PARAMETERS, validateInput } from '../lib/execution-run/model.ts'
import { createRunRuntime } from '../lib/execution-run/runtime.ts'

/** Ordinary installed tool for optional human-directed metadata; registration never seeds state or grants. */
export default function mahiroExecutionRun(pi: ExtensionAPI) {
  registerWorkflowPresentation(pi)
  const attention = registerWorkflowAttention(pi)
  const runtime = createRunRuntime(pi)
  pi.registerTool({
    name: 'mh_execution_run',
    label: 'mh_execution_run',
    ...workflowRenderers('mh_execution_run'),
    description:
      'Read/create/update optional bounded execution coordination metadata. Never executes workers, CLI, Git or worktrees; never reads artifacts or other workflows. Reports/checks/paths/session refs are caller metadata, never proof, acceptance or Goal completion. Live TSK owns tasks/outcomes/evidence/human acceptance. Read get before mutation; canonical binding and explicitly installed tool/feature-data authority required; empty reads never create a Run. Operation get/create/update only; human abandon/terminal clear use public-UI-confirmed /mh-run.',
    parameters: EXECUTION_RUN_PARAMETERS as any,
    executionMode: 'sequential',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async execute(_id, args, signal, _update, ctx) {
      validateInput(args)
      const observe = attention.capture(ctx)
      const result = await runtime.run(args, ctx, signal)
      observe('run', result)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      }
    },
  })
  const handler = async (args: string, ctx: any) => {
    try {
      ctx.ui.notify(await runtime.command(args, ctx), 'info')
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : 'Execution Run unavailable', 'error')
    }
  }
  const openRunMenu = async (ctx: any): Promise<boolean | void> => {
    while (ctx.mode === 'tui' && ctx.hasUI) {
      let rawStatus: string
      try {
        rawStatus = await runtime.command('status', ctx)
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : 'Execution Run unavailable', 'error')
        return
      }
      type RunSummary = { id?: string; revision?: number; stage?: string }
      let run: RunSummary | null = null
      try {
        const parsed = JSON.parse(rawStatus) as { run?: RunSummary | null }
        run = parsed?.run ?? null
      } catch {
        // Fallback if non-JSON status string is returned.
      }
      const summary = run
        ? `stage: ${run.stage ?? 'active'} (rev ${run.revision ?? '?'})`
        : 'no active run in this session'
      const statusRow = 'Inspect current Run status (/mh-run status)'
      const listRow = 'List project runs (/mh-run list)'
      const abandonRow =
        typeof run?.revision === 'number'
          ? `Abandon current run (rev ${run.revision})… [session, confirm]`
          : undefined
      const clearRow =
        typeof run?.revision === 'number'
          ? `Clear terminal run (rev ${run.revision})… [session, confirm]`
          : undefined
      const helpRow = 'Help & operator commands (/mh-run help)'
      const backRow = '← Back'
      const options = [
        {
          value: statusRow,
          label: 'Run status  view',
          description: 'Inspect current Execution Run stage, items and blockers · /mh-run status',
        },
        {
          value: listRow,
          label: 'Project runs  list',
          description: 'List Execution Runs recorded in this profile and project · /mh-run list',
        },
        ...(abandonRow
          ? [
              {
                value: abandonRow,
                label: `Abandon run  rev ${run?.revision}`,
                description: 'Abandon the active Execution Run after UI confirmation · /mh-run abandon',
              },
            ]
          : []),
        ...(clearRow
          ? [
              {
                value: clearRow,
                label: `Clear run  rev ${run?.revision}`,
                description: 'Clear a terminal Execution Run after UI confirmation · /mh-run clear',
              },
            ]
          : []),
        {
          value: helpRow,
          label: 'Run help  view',
          description: 'Show Execution Run subcommands and operator syntax · /mh-run help',
        },
        {
          value: backRow,
          label: '← Back  esc',
          description: 'Return to the previous workflow menu',
        },
      ]
      const choice = await selectHubMenu(ctx, `Mahiro Execution Run · ${summary}`, options, {
        hint: '↑/↓ focus · Enter/Space select · Esc/← back',
      })
      if (!choice || choice === backRow) return true
      if (choice === statusRow) ctx.ui.notify(rawStatus, 'info')
      else if (choice === listRow) await handler('list', ctx)
      else if (abandonRow && choice === abandonRow && run?.revision)
        await handler(`abandon ${run.revision}`, ctx)
      else if (clearRow && choice === clearRow && run?.revision) await handler(`clear ${run.revision}`, ctx)
      else if (choice === helpRow) await handler('help', ctx)
    }
  }
  registerWorkflowCommand(
    pi,
    'mh-run',
    {
      description:
        'Execution Run operator metadata inventory; public-UI-confirmed abandon and terminal-only clear. No execution, force unlock or moves.',
      handler,
    },
    { open: openRunMenu },
  )
}
