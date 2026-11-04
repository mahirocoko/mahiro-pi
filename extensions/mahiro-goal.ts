import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerWorkflowCommand, selectHubMenu } from '../lib/workflow-hub.ts'
import { registerWorkflowAttention } from '../lib/workflow-attention.ts'
import { registerWorkflowPresentation, workflowRenderers } from '../lib/workflow-ui.ts'
import {
  CLEAR_PARAMETERS,
  CREATE_PARAMETERS,
  GET_PARAMETERS,
  UPDATE_PARAMETERS,
  validateGoalInput,
} from '../lib/goal/model.ts'
import { createGoalRuntime, goalTools } from '../lib/goal/runtime.ts'

/** Ordinary installed tools; Goal creation needs human direction. Registration grants nothing and has no profile, state, policy or network I/O. */
export default function mahiroGoal(pi: ExtensionAPI) {
  registerWorkflowPresentation(pi)
  const attention = registerWorkflowAttention(pi)
  const runtime = createGoalRuntime(pi)
  const parameters = {
    mh_get_goal: GET_PARAMETERS,
    mh_create_goal: CREATE_PARAMETERS,
    mh_update_goal: UPDATE_PARAMETERS,
    mh_clear_goal: CLEAR_PARAMETERS,
  }
  for (const name of goalTools)
    pi.registerTool({
      name,
      label: name,
      ...workflowRenderers(name),
      description: {
        mh_get_goal:
          'Read the canonical Goal assigned to this native session and obtain an internal revision ticket before mutation. Canonical project binding; explicit installation grants narrow tool/feature-data authority. Empty reads never create Goals. Branches do not rewind state; new/fork sessions have no Goal until explicitly moved.',
        mh_create_goal:
          'Create a Goal ONLY after Mahiro directly requests or approves it, not from loading skills. Read mh_get_goal first. replace=true explicitly replaces the plan in place preserving the Goal ID, resets blockers/plan, and requires expected_revision. This is requester guidance, not mechanical requester attestation; ordinary model mutations need no new UI approval.',
        mh_update_goal:
          'Update a freshly read canonical Goal using expected_revision. Create/revise/move require explicit human direction. move_goal preserves ID/history and moves only within this profile/project to an empty native session. Add evidence before claiming agent criteria; never verify or claim human criteria. Completion audits required criteria and open blockers, not plan/rules. Ordinary completed edits reject; revise_mission explicitly reopens.',
        mh_clear_goal:
          'Destructively clear the current Goal (or optional exact goal_id in this profile/project) only after explicit human request AND public UI confirmation of its exact Goal ID/revision. Unknown or invalid explicit IDs reject; they never select the current Goal. Read mh_get_goal first. No UI/decline/stale approval writes nothing; revision tickets protect clear/recreate ABA.',
      }[name],
      parameters: parameters[name],
      executionMode: 'sequential',
      annotations: {
        readOnlyHint: name === 'mh_get_goal',
        destructiveHint: name === 'mh_clear_goal',
        idempotentHint: name === 'mh_get_goal',
        openWorldHint: false,
      },
      async execute(_id, args, signal, _update, ctx) {
        validateGoalInput(parameters[name], args)
        const observe = attention.capture(ctx)
        const result = await runtime.run(name, args, ctx, signal)
        observe('goal', result)
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
      ctx.ui.notify(error instanceof Error ? error.message : 'Goal unavailable', 'error')
    }
  }
  const openGoalMenu = async (ctx: any): Promise<boolean | void> => {
    while (ctx.mode === 'tui' && ctx.hasUI) {
      let rawStatus: string
      try {
        rawStatus = await runtime.command('status', ctx)
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : 'Goal unavailable', 'error')
        return
      }
      type GoalSummary = { id?: string; revision?: number; status?: string; objective?: string }
      let goal: GoalSummary | null = null
      try {
        const parsed = JSON.parse(rawStatus) as { goal?: GoalSummary | null }
        goal = parsed?.goal ?? null
      } catch {
        // Fallback if non-JSON status string is returned.
      }
      const summary = goal
        ? `${goal.status ?? 'active'} (rev ${goal.revision ?? '?'}) · ${String(goal.objective ?? '').slice(0, 44)}`
        : 'no active goal in this session'
      const statusRow = 'Inspect current Goal status (/mh-goal status)'
      const listRow = 'List open project goals (/mh-goal list)'
      const togglePauseRow =
        goal?.status === 'paused'
          ? 'Resume current Goal (/mh-goal resume) [session, confirm]'
          : 'Pause current Goal (/mh-goal pause) [session, confirm]'
      const clearRow = 'Clear current Goal… (/mh-goal clear) [session, confirm]'
      const helpRow = 'Help & human gate commands (/mh-goal help)'
      const backRow = '← Back'
      const options = [
        {
          value: statusRow,
          label: 'Goal status  view',
          description: 'Inspect current mission objective, plan steps and blockers · /mh-goal status',
        },
        {
          value: listRow,
          label: 'Open goals  list',
          description: 'List open project goals across sessions in this profile · /mh-goal list',
        },
        ...(goal
          ? [
              {
                value: togglePauseRow,
                label: goal.status === 'paused' ? 'Resume Goal  confirm' : 'Pause Goal  confirm',
                description:
                  goal.status === 'paused'
                    ? 'Resume the paused Goal in this session · /mh-goal resume'
                    : 'Pause the active Goal in this session · /mh-goal pause',
              },
              {
                value: clearRow,
                label: 'Clear Goal  confirm',
                description: 'Destructively clear the current Goal after UI confirmation · /mh-goal clear',
              },
            ]
          : []),
        {
          value: helpRow,
          label: 'Goal help  view',
          description: 'Show Goal commands and human-confirmed gate syntax · /mh-goal help',
        },
        {
          value: backRow,
          label: '← Back  esc',
          description: 'Return to the previous workflow menu',
        },
      ]
      const choice = await selectHubMenu(ctx, `Mahiro Goal · ${summary}`, options, {
        hint: '↑/↓ focus · Enter/Space select · Esc/← back',
      })
      if (!choice || choice === backRow) return true
      if (choice === statusRow) ctx.ui.notify(rawStatus, 'info')
      else if (choice === listRow) await handler('list', ctx)
      else if (choice === togglePauseRow) await handler(goal?.status === 'paused' ? 'resume' : 'pause', ctx)
      else if (choice === clearRow) await handler('clear', ctx)
      else if (choice === helpRow) await handler('help', ctx)
    }
  }
  registerWorkflowCommand(
    pi,
    'mh-goal',
    {
      description:
        'Native Goal: status/list; human-directed create/revise/move, plan/rules and confirmed human gates',
      handler,
    },
    { open: openGoalMenu },
  )
  pi.registerCommand('mh-goal-status', {
    description: 'Read native Goal status (no busy panel or Herdr publication)',
    handler: (_args, ctx) => handler('status', ctx),
  })
}
