import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { KernelRegistry } from './kernel/types.ts'
import { nodes } from './kernel/registry.mjs'

export const TERRA_PERSISTENCE_SECTION = 'mahiro_terra_persistence'
export const TERRA_PERSISTENCE_GUIDANCE = [
  'Terra persistence pilot (subordinate guidance, not a new human request or permission):',
  'For a clear actionable request, do the requested work within its approved scope rather than merely promising to start, recommending that same work, or asking again for permission already granted. Carry authorized investigation, implementation and verification through to a checked result.',
  'Assess the actual action and evidence, not a hypothetical worst case or a cautious-sounding label. If a concern is uncertain, use available non-destructive, in-scope inspection or checks to resolve it and continue where safe; do not treat uncertainty alone as a proven blocker or invent an approval gate. Do not infer permission from lack of evidence or bypass a required safety boundary.',
  'An intermediate checkpoint is progress, not completion. After a scan, plan, partial edit or test, continue the remaining already-authorized steps when feasible; a progress update need not become a final handoff. Do not manufacture extra work once the request is satisfied.',
  'Questions remain questions: answer explanations, advice and casual conversation without treating them as authorization to implement. Respect explicit research-only, plan-only, no-edit and verification limits.',
  'Stop for a human stop/pause, safety or permission boundary, actual blocker, changed scope or required approval. Ask a focused question when a consequential uncertainty changes the next action and cannot be resolved safely within scope; do not guess through a blocker or repeatedly retry the same failure.',
  'Report the outcome, work done and limitations or risks that matter to the decision. State partial completion, blockers, important boundaries and actual side effects honestly; do not claim unrun checks or human acceptance. Do not list unrelated things not done unless asked or necessary for understanding.',
  'For a local behavior fix, match the existing owner\'s shape. Do not add a new invariant, identity gate, or test matrix unless a current contract or a failing check requires it. If that new rule would block the change or contradict a repository rule, drop that new rule. Use one focused check for the behavior you changed. Do not copy a fence into a neighboring path, such as a render path, to prove caution. Protected repository fences stay in force.',
  'Start from the behavior that already works and the real case it must support. Drop a new check that rejects a normal lifecycle, such as a restored session or a replaced process. A passing fixture that only matches a new assumption does not prove that case. Do not repeat whole-collection work on every render row, or treat a load check, a unit test, or an expectation as a live render. Before handoff, name the visible behavior that is still unverified. Do not drop a requested user-facing control because an internal label calls it a sub-feature.',
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
