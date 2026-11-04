import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerWorkflowCommand, selectHubMenu } from '../lib/workflow-hub.ts'
import { registerWorkflowAttention } from '../lib/workflow-attention.ts'
import { registerWorkflowPresentation, workflowRenderers } from '../lib/workflow-ui.ts'
import {
  CREATE_PARAMETERS,
  GET_PARAMETERS,
  UPDATE_PARAMETERS,
  validateInput,
  validateUpdate,
} from '../lib/ux-workflow/model.ts'
import { createUXRuntime, uxTools } from '../lib/ux-workflow/runtime.ts'

/** Ordinary installed tools; workflow creation needs human direction. Registration never seeds state, policy, profile or grants. */
export default function mahiroUXWorkflow(pi: ExtensionAPI) {
  registerWorkflowPresentation(pi)
  const attention = registerWorkflowAttention(pi)
  const runtime = createUXRuntime(pi)
  for (const name of uxTools)
    pi.registerTool({
      name,
      label: name,
      ...workflowRenderers(name),
      description:
        name === 'mh_get_ux_workflow'
          ? 'Read the current native session UX workflow/open blockers and coordinator boundary. Read before mutation; canonical binding and installed tool/feature-data authority required; empty reads never create a workflow.'
          : name === 'mh_create_ux_workflow'
            ? 'Create frame-stage UX metadata only after an explicit actual human request. This is guidance, not mechanical requester proof. No research, executors, Goal/Evidence mutation or owner invocation.'
            : 'Revision-guarded UX metadata updates, always actor agent. Cannot approve human gates. Brief/owner/research/finding/evidence/Goal refs are opaque caller metadata, never proof or file reads. Ordinary metadata and eligible completion need no UI dialog.',
      parameters: (name === 'mh_get_ux_workflow'
        ? GET_PARAMETERS
        : name === 'mh_create_ux_workflow'
          ? CREATE_PARAMETERS
          : UPDATE_PARAMETERS) as any,
      executionMode: 'sequential',
      annotations: {
        readOnlyHint: name === 'mh_get_ux_workflow',
        destructiveHint: false,
        idempotentHint: name === 'mh_get_ux_workflow',
        openWorldHint: false,
      },
      async execute(_id, args, signal, _update, ctx) {
        if (name === 'mh_update_ux_workflow') validateUpdate(args)
        else validateInput(name === 'mh_get_ux_workflow' ? GET_PARAMETERS : CREATE_PARAMETERS, args)
        const observe = attention.capture(ctx)
        const result = await runtime.run(name, args, ctx, signal)
        observe('ux', result)
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
      ctx.ui.notify(error instanceof Error ? error.message : 'UX unavailable', 'error')
    }
  }
  const openUXMenu = async (ctx: any): Promise<boolean | void> => {
    while (ctx.mode === 'tui' && ctx.hasUI) {
      let rawStatus: string
      try {
        rawStatus = await runtime.command('status', ctx)
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : 'UX unavailable', 'error')
        return
      }
      type UXSummary = { id?: string; revision?: number; stage?: string }
      let wf: UXSummary | null = null
      try {
        const parsed = JSON.parse(rawStatus) as { workflow?: UXSummary | null }
        wf = parsed?.workflow ?? null
      } catch {
        // Fallback if non-JSON status string is returned.
      }
      const summary = wf
        ? `stage: ${wf.stage ?? 'active'} (rev ${wf.revision ?? '?'})`
        : 'no active UX workflow in this session'
      const statusRow = 'Inspect UX workflow status (/mh-ux status)'
      const clearRow =
        typeof wf?.revision === 'number'
          ? `Clear UX workflow (rev ${wf.revision})… [session, confirm]`
          : undefined
      const helpRow = 'Help & human gate commands (/mh-ux help)'
      const backRow = '← Back'
      const options = [
        {
          value: statusRow,
          label: 'UX status  view',
          description: 'Inspect current UX workflow stage, brief, blockers and gates · /mh-ux status',
        },
        ...(clearRow
          ? [
              {
                value: clearRow,
                label: `Clear workflow  rev ${wf?.revision}`,
                description: 'Clear the current UX workflow after UI confirmation · /mh-ux clear',
              },
            ]
          : []),
        {
          value: helpRow,
          label: 'UX help  view',
          description: 'Show UX workflow subcommands and human gate syntax · /mh-ux help',
        },
        {
          value: backRow,
          label: '← Back  esc',
          description: 'Return to the previous workflow menu',
        },
      ]
      const choice = await selectHubMenu(ctx, `Mahiro UX Workflow · ${summary}`, options, {
        hint: '↑/↓ focus · Enter/Space select · Esc/← back',
      })
      if (!choice || choice === backRow) return true
      if (choice === statusRow) ctx.ui.notify(rawStatus, 'info')
      else if (clearRow && choice === clearRow && wf?.revision) await handler(`clear ${wf.revision}`, ctx)
      else if (choice === helpRow) await handler('help', ctx)
    }
  }
  registerWorkflowCommand(
    pi,
    'mh-ux',
    {
      description:
        'UX metadata status/help and public-UI-confirmed human direction/review/reopen/clear gates; no force unlock or moves',
      handler,
    },
    { open: openUXMenu },
  )
}
