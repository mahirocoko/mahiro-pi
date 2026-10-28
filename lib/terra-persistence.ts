import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { KernelRegistry } from './kernel/types.ts'
import { nodes } from './kernel/registry.mjs'

export const TERRA_PERSISTENCE_SECTION = 'mahiro_terra_persistence'
export const TERRA_PERSISTENCE_GUIDANCE = [
  'Terra persistence pilot (subordinate guidance, not a new human request or permission):',
  'For an actionable request, do the requested work within its approved scope rather than merely promising to start, recommending that same work, or asking again for permission already granted. Carry authorized investigation, implementation and verification through to a checked result.',
  'An intermediate checkpoint is progress, not completion. After a scan, plan, partial edit or test, continue the remaining already-authorized steps when feasible; a progress update need not become a final handoff. Do not manufacture extra work once the request is satisfied.',
  'Questions remain questions: answer explanations, advice and casual conversation without treating them as authorization to implement. Respect explicit research-only, plan-only, no-edit and verification limits.',
  'Stop for a human stop/pause, safety or permission boundary, actual blocker, changed scope or required approval. Ask a focused question when its answer changes the next action; do not guess through a blocker or repeatedly retry the same failure. Report what is done, what remains and the concrete blocker or approval needed, without claiming unrun checks or human acceptance.',
  'Current human, system and repository instructions and protected child/worker boundaries prevail. This grants no scope expansion, Goal creation, commit, push, publish, installation, profile change or automatic continuation. Never bypass permissions to finish.',
].join('\n')

/** Register before prompt-replacing memory and session-step owners in the existing bootstrap. */
export function registerTerraPersistence(pi: ExtensionAPI) {
  pi.registerFlag('mahiro-terra-persistence-disable', {
    type: 'boolean',
    default: false,
    description: 'Disable the exact openai/gpt-6.1-terra primary-session persistence pilot',
  })
  pi.on('before_agent_start', (event, ctx) => {
    const sections = event.systemPromptOptions.sections
    // Own only this section; run-local SDK options are rebuilt on each prompt.
    delete sections[TERRA_PERSISTENCE_SECTION]
    const node = (nodes as KernelRegistry).get(ctx.sessionManager.getSessionId())
    if (
      pi.getFlag('mahiro-terra-persistence-disable') === true ||
      event.messageType !== 'user' ||
      ctx.model?.provider !== 'openai' ||
      ctx.model.id !== 'gpt-6.1-terra' ||
      !node?.isPrimarySession(ctx) ||
      /<active_agent\s+name=/.test(event.systemPrompt) ||
      event.systemPrompt.includes("You maintain the primary companion's private managed knowledge") ||
      event.systemPrompt.includes('Managed memory worker unavailable.') ||
      event.systemPromptOptions.forceSystemPrompt !== undefined
    )
      return
    sections[TERRA_PERSISTENCE_SECTION] = TERRA_PERSISTENCE_GUIDANCE
  })
}
