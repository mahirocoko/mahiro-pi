import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerWorkflowCommand } from '../lib/workflow-hub.ts'
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
  registerWorkflowCommand(pi, 'mh-run', {
    description:
      'Execution Run operator metadata inventory; public-UI-confirmed abandon and terminal-only clear. No execution, force unlock or moves.',
    async handler(args, ctx) {
      try {
        ctx.ui.notify(await runtime.command(args, ctx), 'info')
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : 'Execution Run unavailable', 'error')
      }
    },
  })
}
