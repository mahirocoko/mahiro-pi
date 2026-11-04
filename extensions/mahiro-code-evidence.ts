import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerWorkflowCommand, selectHubMenu } from '../lib/workflow-hub.ts'
import { registerWorkflowAttention } from '../lib/workflow-attention.ts'
import { registerWorkflowPresentation, workflowRenderers } from '../lib/workflow-ui.ts'
import { CODE_EVIDENCE_PARAMETERS } from '../lib/evidence/model.ts'
import { createEvidenceRuntime } from '../lib/evidence/runtime.ts'
/** Registration only. No Git, profile mutation, prompt injection or automatic collection. */
export default function mahiroCodeEvidence(pi: ExtensionAPI) {
  registerWorkflowPresentation(pi)
  const attention = registerWorkflowAttention(pi)
  const runtime = createEvidenceRuntime(pi)
  pi.registerTool({
    name: 'mh_code_evidence',
    label: 'Code Evidence',
    ...workflowRenderers('mh_code_evidence'),
    description:
      'Code Evidence: get exact native-session report, collect four bounded read-only Git lanes, or record metadata about an already-performed external check. command is descriptive and NEVER executed. evidence_ready means metadata ready for explicit selection, not verified execution or Goal completion. No automatic Goal attachment, human verification, import or collection. Requires exact tool and canonical feature-data authority from explicit profile installation; legacy leaf/path/tool denials remain effective.',
    parameters: CODE_EVIDENCE_PARAMETERS,
    executionMode: 'sequential',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async execute(_id, args, signal, _update, ctx) {
      const observe = attention.capture(ctx)
      const result = await runtime.run(args, ctx, signal)
      observe('evidence', result)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      }
    },
  })
  const handler = async (input: string, ctx: any) => {
    try {
      ctx.ui.notify(await runtime.command(input, ctx), 'info')
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : 'Code Evidence unavailable', 'error')
    }
  }
  const openEvidenceMenu = async (ctx: any): Promise<boolean | void> => {
    while (ctx.mode === 'tui' && ctx.hasUI) {
      let rawStatus: string
      try {
        rawStatus = await runtime.command('status', ctx)
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : 'Code Evidence unavailable', 'error')
        return
      }
      let revision: number | undefined
      let statusLabel = 'no report in this session'
      try {
        const parsed = JSON.parse(rawStatus) as { status?: string; revision?: number }
        if (typeof parsed?.revision === 'number') {
          revision = parsed.revision
          statusLabel = `${parsed.status ?? 'collected'} (rev ${revision})`
        } else if (typeof parsed?.status === 'string') {
          statusLabel = parsed.status
        }
      } catch {
        // Fallback if non-JSON status string is returned.
      }
      const collectRow = 'Collect Git evidence now (/mh-evidence collect) [session]'
      const reportRow = 'Inspect current evidence report (/mh-evidence report)'
      const clearRow = revision ? `Clear evidence report (rev ${revision})… [session, confirm]` : undefined
      const helpRow = 'Help (/mh-evidence help)'
      const backRow = '← Back'
      const options = [
        {
          value: collectRow,
          label: 'Collect evidence  run',
          description:
            'Collect four bounded read-only Git evidence lanes for this session · /mh-evidence collect',
        },
        {
          value: reportRow,
          label: 'Evidence report  view',
          description: 'Inspect the current session Code Evidence report and checks · /mh-evidence report',
        },
        ...(clearRow
          ? [
              {
                value: clearRow,
                label: `Clear report  rev ${revision}`,
                description:
                  'Clear the current session evidence report after UI confirmation · /mh-evidence clear',
              },
            ]
          : []),
        {
          value: helpRow,
          label: 'Evidence help  view',
          description: 'Show Code Evidence subcommands and usage · /mh-evidence help',
        },
        {
          value: backRow,
          label: '← Back  esc',
          description: 'Return to the previous workflow menu',
        },
      ]
      const choice = await selectHubMenu(ctx, `Mahiro Code Evidence · ${statusLabel}`, options, {
        hint: '↑/↓ focus · Enter/Space select · Esc/← back',
      })
      if (!choice || choice === backRow) return true
      if (choice === collectRow) await handler('collect', ctx)
      else if (choice === reportRow) ctx.ui.notify(rawStatus, 'info')
      else if (clearRow && choice === clearRow && revision) await handler(`clear ${revision}`, ctx)
      else if (choice === helpRow) await handler('help', ctx)
    }
  }
  registerWorkflowCommand(
    pi,
    'mh-evidence',
    {
      description:
        'Opt-in Code Evidence help/status/report/collect/clear with exact-report public UI confirmation for clear',
      handler,
    },
    { open: openEvidenceMenu },
  )
}
