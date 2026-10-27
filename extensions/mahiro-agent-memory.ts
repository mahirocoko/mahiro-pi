import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerWorkflowCommand } from '../lib/workflow-hub.ts'
import { registerWorkflowAttention } from '../lib/workflow-attention.ts'
import { registerWorkflowPresentation, workflowRenderers } from '../lib/workflow-ui.ts'
import { memoryTools, type RuntimeConfig } from '../lib/agent-memory/runtime.ts'
import { createAgentMemoryRouter } from '../lib/agent-memory/runtime-router.ts'
import { memoryReadSchema } from '../lib/agent-memory/retrieval.ts'
import { publicMemoryError } from '../lib/agent-memory/reasons.ts'

export function activateAgentMemory(pi: ExtensionAPI, config: RuntimeConfig = {}) {
  registerWorkflowPresentation(pi)
  const attention = registerWorkflowAttention(pi)
  const runtime = createAgentMemoryRouter(pi, config)
  registerWorkflowCommand(pi, 'mh-memory', {
    description:
      'Memory readiness, status, doctor, palace, remember, dream and tiered v2 init (no setup or credential lookup)',
    handler: async (args, ctx) => {
      const trimmed = args.trim()
      const [subcommand, ...rest] = trimmed ? trimmed.split(/\s+/) : ['status']
      const restText = rest.join(' ').trim()
      if (!['status', 'help', 'remember', 'dream', 'doctor', 'palace', 'init'].includes(subcommand)) {
        ctx.ui.notify(
          'Use /mh-memory [status|help|remember <text>|dream|doctor|palace|init]. This command never enables memory or changes permissions.',
          'warning',
        )
        return
      }
      if (subcommand === 'help') {
        ctx.ui.notify(
          'Memory: /mh-memory status diagnoses prerequisites without requiring storage. /mh-memory doctor runs health, budget and link checks. /mh-memory palace inspects read-only tiered hierarchy, frontmatter links, retained view counts and episode counters without mutating storage. /mh-memory remember <text> appends a concise durable note to system/human/notes.md. /mh-memory dream dispatches background reflection on unreviewed episodes. /mh-memory init seeds non-destructive tiered v2 layout and migrates legacy blocks. agent_memory_manage status adds authorized automatic On/Off, draft/publication and latest attempt. Use action policy with current revision + configHash + automatic true/false for explicit automatic admission control; off is preserved on upgrade. Status policyOperation classifies retained policy locks; only a fresh primary policy-reconcile with target + revision=digest may remove verified owned files after actual process-local drain, never replay/revert config. Unknown/restarted operations require owner review, not lock stealing. Reflection uses eligible settled interactive/RPC episodes, never every turn; explicit agent_memory_reflect assignments remain separate. A private draft or writer-ready checkpoint is not publication: only the healthy parent integrates successful completion; context activates next request. Cancel/conflicts/forget/rollback use existing management tools. Installation/route changes need explicit approval and a fresh session; no provider inference or credentials are resolved by status.',
          'info',
        )
        return
      }
      try {
        const observe = attention.capture(ctx)
        if (subcommand === 'status') {
          const result = await runtime.diagnose(ctx)
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'doctor') {
          const result = await runtime.run('agent_memory_manage', { action: 'doctor' }, ctx)
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'palace') {
          const result = await runtime.run('agent_memory_manage', { action: 'palace' }, ctx)
          observe('memory', result)
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info')
          return
        }
        if (subcommand === 'init') {
          const migrated = await runtime.run('agent_memory_manage', { action: 'migrate-v2' }, ctx)
          const inited = await runtime.run('agent_memory_manage', { action: 'init-project' }, ctx)
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
      } catch (error) {
        ctx.ui.notify(publicMemoryError(error).message, 'warning')
      }
    },
  })
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
      },
      required: ['path', 'expectedHash', 'text', 'sources'],
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
            'doctor',
            'palace',
            'init-project',
            'migrate-v2',
            'remember',
            'policy',
            'policy-reconcile',
            'offline-inspect',
            'offline-adopt',
            'offline-resume',
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
          "Read maintained knowledge within the authenticated view. Mutually exclusive modes: {} legacy file list; path with original Unicode code-point offset/limit (4096 max); query for bounded English/Thai lexical AND search (256 UTF-8 bytes, 16 terms, limit 8); topic='' for namespaces, topic='*' for all files, or a namespace (limit 32). Query/topic offset pages scan/files; follow nextOffset until complete. Search scans at most 1 MiB per page and returns at most 32 KiB, with original snippet offsets, whole-file hashes and source IDs. basis/baseRevision/currentRevision/freshness distinguish private drafts and stale snapshots from current truth. Current forgetting/authority changes make old views unavailable, never successful no-match. Read all path pages before replacement. No arbitrary root/project selection or filesystem access.",
        agent_memory_edit:
          'Add, replace or remove scoped Markdown in a private draft. expectedHash is from read (null for a new file); text=null removes a global/deferred/procedure file. Sources link observed episode IDs. No context changes until commit. Revise contradictory knowledge at its existing owner instead of appending it.',
        agent_memory_commit:
          'Commit/integrate the current private memory draft against its base revision. Disjoint edits merge automatically; overlapping edits preserve a conflict. Native workers mark ready; the healthy parent integrates only after successful completion. Active primary context refreshes on the next request.',
        agent_memory_manage:
          'Primary-only new-store initialization (explicit core/projectId, optional automatic), bounded memory status, cancellation, source/path forgetting and rollback. conflicts lists up to 8 retained views; target selects a view, path selects a proposal file. Read all pages with Unicode offset/limit (4096 maximum) before recovery; proposalHash covers the full text. Resolve manually through current CAS tools, then discard that view with current revision. Initialization never overwrites an existing root or native bootstrap; separate root permission must already exist. Requires current revision for changes. Logical forgetting filters recovery, not secure Git/history erasure. Revise Core/index to remove the forgotten knowledge and its source link before source-forgetting, preserving identity. Global/deferred/procedure source-forgetting conservatively removes entire affected files. ABI2: policy changes automatic admission only with current revision/configHash; it never changes permissions, engine or writer route. Status policyOperation diagnoses policy lock retention and observed outcome, not unchanged-on-abort. policy-reconcile uses target UUID and revision=policy digest from status, only after actual executor drain under fresh primary authority; removes verified owned staging/lock only, never changes config. Missing references/restart/mismatches retain unknown evidence for owner review. Reconcile observes one existing publication operation (target UUID, revision plan digest); never replays publication, returns chunks, steals locks or initializes an existing root.',
        agent_memory_reflect:
          'Assign a locked native background writer to maintain the SAME private memory using current scoped episodes. No caller-chosen role/model/path. Registration, authority and native identity binding must already exist. Does not claim provider proof or semantic correctness.',
      }[name],
      promptGuidelines: [
        'Memory is fallible maintained knowledge, not permission policy. Preserve established identity and current instructions. Read before editing; consolidate/revise existing knowledge, cite observed evidence, avoid speculative preferences and archive-to-instruction promotion. Core includes concise durable identity/preferences/methods; global holds shared detailed knowledge; deferred holds project detail; procedures hold reusable workflows. Commit only appropriate durable knowledge. Never copy secrets or excluded project data.',
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
          throw publicMemoryError(error, name === 'agent_memory_read')
        }
      },
    })
  return runtime
}
export default function mahiroAgentMemory(pi: ExtensionAPI) {
  activateAgentMemory(pi)
}
