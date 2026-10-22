/** Native Goal schema v1. Derived from canonical Mods semantics; native profile/session IDs replace Letta agent/conversation IDs. No persistence or host APIs. */
import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
const MAX_OBJECTIVE_CHARS = 4000
const MAX_CRITERIA = 20
const MAX_CRITERION_CHARS = 800
const MAX_NON_GOALS = 20
const MAX_RULES = 8
const MAX_RULE_CHARS = 500
const MAX_TEXT_CHARS = 1200
const MAX_EVIDENCE_PER_CRITERION = 30
const MAX_BLOCKERS = 30
const MAX_PLAN_ITEMS = 30
const MAX_HISTORY = 80

type GoalStatus = 'active' | 'paused' | 'blocked' | 'complete'
type CriterionOwner = 'agent' | 'human'
type CriterionStatus = 'pending' | 'claimed' | 'verified' | 'blocked'
type Actor = 'agent' | 'human' | 'system'
type EvidenceKind = 'file' | 'command' | 'test' | 'browser' | 'native' | 'manual' | 'user' | 'other'
type RuleLevel = 'must' | 'prefer'
type RuleSource = 'agent' | 'human'

export interface Scope {
  profile: string
  project: string
  sessionId: string
}

interface EvidenceItem {
  id: string
  kind: EvidenceKind
  summary: string
  reference: string | null
  actor: Actor
  createdAt: string
}

interface Criterion {
  id: string
  text: string
  owner: CriterionOwner
  required: boolean
  status: CriterionStatus
  evidence: EvidenceItem[]
  note: string | null
  updatedAt: string
}

interface GoalRule {
  id: string
  text: string
  level: RuleLevel
  source: RuleSource
}

interface Blocker {
  id: string
  summary: string
  status: 'open' | 'resolved'
  createdAt: string
  resolvedAt: string | null
}

type PlanItemStatus = 'pending' | 'in_progress' | 'done' | 'blocked'

interface PlanItem {
  id: string
  text: string
  status: PlanItemStatus
  note: string | null
  updatedAt: string
}

interface HistoryItem {
  at: string
  actor: Actor
  action: string
  summary: string
  revision: number
}

export interface WorkflowGoal {
  id: string
  revision: number
  objective: string
  status: GoalStatus
  phase: string
  nextAction: string | null
  criteria: Criterion[]
  nonGoals: string[]
  rules: GoalRule[]
  blockers: Blocker[]
  plan: PlanItem[]
  workspace: string
  profile: string
  sessionId: string
  activeTimeSeconds: number
  activeStartedAt: string | null
  createdAt: string
  updatedAt: string
  history: HistoryItem[]
}

export interface WorkflowState {
  schemaVersion: 1
  sequence: number
  profile: string
  project: string
  goals: Record<string, WorkflowGoal>
  sessions: Record<string, string>
}

interface CriterionInput {
  text: string
  owner?: CriterionOwner
  required?: boolean
}

interface GoalRuleInput {
  text: string
  level?: RuleLevel
}

interface GoalCreateInput {
  objective: string
  criteria: CriterionInput[]
  nonGoals?: string[]
  rules?: GoalRuleInput[]
  nextAction?: string | null
  replace?: boolean
  expectedRevision?: number | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function compactText(value: unknown, max = MAX_TEXT_CHARS): string {
  const text = String(value ?? '').trim()
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

function displayFieldText(value: unknown): string {
  return stripVTControlCharacters(String(value ?? ''))
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/ +/g, ' ')
    .trim()
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isBoundedString(value, 80)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function hasUniqueIds(items: unknown[]): boolean {
  if (!items.every((item) => isRecord(item) && typeof item.id === 'string')) return false
  const ids = items.map((item: any) => item.id)
  return ids.length === new Set(ids).size
}

function validateStoredGoal(key: string, value: unknown): asserts value is WorkflowGoal {
  if (!isRecord(value)) throw new Error(`Mahiro Goal state entry ${key} must be an object.`)
  const stringLimits: Record<string, number> = {
    id: 160,
    objective: MAX_OBJECTIVE_CHARS,
    status: 32,
    phase: 120,
    workspace: 4096,
    profile: 4096,
    sessionId: 240,
    createdAt: 80,
    updatedAt: 80,
  }
  for (const [field, max] of Object.entries(stringLimits)) {
    if (!isBoundedString(value[field], max))
      throw new Error(`Mahiro Goal state entry ${key} has invalid ${field}.`)
  }
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid timestamps.`)
  }
  if (!['active', 'paused', 'blocked', 'complete'].includes(value.status)) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid status.`)
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid revision.`)
  }
  if (!Number.isSafeInteger(value.activeTimeSeconds) || value.activeTimeSeconds < 0) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid activeTimeSeconds.`)
  }
  if (value.nextAction !== null && !isBoundedString(value.nextAction, MAX_TEXT_CHARS)) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid nextAction.`)
  }
  if (value.activeStartedAt !== null && !isIsoTimestamp(value.activeStartedAt)) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid activeStartedAt.`)
  }
  if ((value.status === 'active') !== (value.activeStartedAt !== null)) {
    throw new Error(`Mahiro Goal state entry ${key} has inconsistent active clock state.`)
  }
  if (
    !Array.isArray(value.criteria) ||
    !Array.isArray(value.nonGoals) ||
    !Array.isArray(value.rules) ||
    !Array.isArray(value.blockers) ||
    !Array.isArray(value.plan) ||
    !Array.isArray(value.history)
  ) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid collection fields.`)
  }
  if (
    value.criteria.length === 0 ||
    value.criteria.length > MAX_CRITERIA ||
    value.nonGoals.length > MAX_NON_GOALS ||
    value.rules.length > MAX_RULES ||
    value.blockers.length > MAX_BLOCKERS ||
    value.plan.length > MAX_PLAN_ITEMS ||
    value.history.length === 0 ||
    value.history.length > MAX_HISTORY ||
    value.nonGoals.some((item: unknown) => !isBoundedString(item, MAX_CRITERION_CHARS))
  ) {
    throw new Error(`Mahiro Goal state entry ${key} exceeds collection limits or contains invalid non-goals.`)
  }
  if (!hasUniqueIds(value.criteria) || !hasUniqueIds(value.rules) || !hasUniqueIds(value.blockers)) {
    throw new Error(`Mahiro Goal state entry ${key} contains duplicate criterion, rule, or blocker IDs.`)
  }
  for (const criterion of value.criteria) {
    if (
      !isRecord(criterion) ||
      Object.keys(criterion).some(
        (field) =>
          !['id', 'text', 'owner', 'required', 'status', 'evidence', 'note', 'updatedAt'].includes(field),
      ) ||
      !isBoundedString(criterion.id, 120) ||
      !isBoundedString(criterion.text, MAX_CRITERION_CHARS) ||
      !['agent', 'human'].includes(criterion.owner) ||
      !['pending', 'claimed', 'verified', 'blocked'].includes(criterion.status) ||
      typeof criterion.required !== 'boolean' ||
      (criterion.note !== null && !isBoundedString(criterion.note, MAX_TEXT_CHARS)) ||
      !isIsoTimestamp(criterion.updatedAt) ||
      !Array.isArray(criterion.evidence)
    ) {
      throw new Error(`Mahiro Goal state entry ${key} has an invalid criterion.`)
    }
    if (criterion.evidence.length > MAX_EVIDENCE_PER_CRITERION) {
      throw new Error(`Mahiro Goal state entry ${key} has too much criterion evidence.`)
    }
    if (!hasUniqueIds(criterion.evidence)) {
      throw new Error(`Mahiro Goal state entry ${key} has duplicate evidence IDs.`)
    }
    for (const evidence of criterion.evidence) {
      if (
        !isRecord(evidence) ||
        Object.keys(evidence).some(
          (field) => !['id', 'kind', 'summary', 'reference', 'actor', 'createdAt'].includes(field),
        ) ||
        !isBoundedString(evidence.id, 120) ||
        !['file', 'command', 'test', 'browser', 'native', 'manual', 'user', 'other'].includes(
          evidence.kind,
        ) ||
        !isBoundedString(evidence.summary, MAX_TEXT_CHARS) ||
        (evidence.reference !== null && !isBoundedString(evidence.reference, MAX_TEXT_CHARS)) ||
        !['agent', 'human', 'system'].includes(evidence.actor) ||
        !isIsoTimestamp(evidence.createdAt)
      ) {
        throw new Error(`Mahiro Goal state entry ${key} has invalid criterion evidence.`)
      }
    }
  }
  for (const rule of value.rules) {
    if (
      !isRecord(rule) ||
      Object.keys(rule).some((field) => !['id', 'text', 'level', 'source'].includes(field)) ||
      !isBoundedString(rule.id, 120) ||
      !isBoundedString(rule.text, MAX_RULE_CHARS) ||
      !['must', 'prefer'].includes(rule.level) ||
      !['agent', 'human'].includes(rule.source)
    ) {
      throw new Error(`Mahiro Goal state entry ${key} has an invalid rule.`)
    }
  }
  for (const blocker of value.blockers) {
    if (
      !isRecord(blocker) ||
      Object.keys(blocker).some(
        (field) => !['id', 'summary', 'status', 'createdAt', 'resolvedAt'].includes(field),
      ) ||
      !isBoundedString(blocker.id, 120) ||
      !isBoundedString(blocker.summary, MAX_TEXT_CHARS) ||
      !['open', 'resolved'].includes(blocker.status) ||
      !isIsoTimestamp(blocker.createdAt) ||
      (blocker.resolvedAt !== null && !isIsoTimestamp(blocker.resolvedAt)) ||
      (blocker.status === 'open' && blocker.resolvedAt !== null) ||
      (blocker.status === 'resolved' && blocker.resolvedAt === null)
    ) {
      throw new Error(`Mahiro Goal state entry ${key} has an invalid blocker.`)
    }
  }
  if (!hasUniqueIds(value.plan)) {
    throw new Error(`Mahiro Goal state entry ${key} contains duplicate plan item IDs.`)
  }
  for (const item of value.plan) {
    if (
      !isRecord(item) ||
      Object.keys(item).some((field) => !['id', 'text', 'status', 'note', 'updatedAt'].includes(field)) ||
      !isBoundedString(item.id, 120) ||
      !isBoundedString(item.text, MAX_CRITERION_CHARS) ||
      !['pending', 'in_progress', 'done', 'blocked'].includes(item.status) ||
      (item.note !== null && !isBoundedString(item.note, MAX_TEXT_CHARS)) ||
      !isIsoTimestamp(item.updatedAt)
    ) {
      throw new Error(`Mahiro Goal state entry ${key} has an invalid plan item.`)
    }
  }
  for (const history of value.history) {
    if (
      !isRecord(history) ||
      Object.keys(history).some(
        (field) => !['at', 'actor', 'action', 'summary', 'revision'].includes(field),
      ) ||
      !isIsoTimestamp(history.at) ||
      !['agent', 'human', 'system'].includes(history.actor) ||
      !isBoundedString(history.action, 120) ||
      !isBoundedString(history.summary, 500) ||
      !Number.isSafeInteger(history.revision) ||
      history.revision < 1 ||
      history.revision > value.revision
    ) {
      throw new Error(`Mahiro Goal state entry ${key} has invalid history.`)
    }
  }
  if (key !== value.id) throw new Error('Goal ID/key mismatch.')
  const known = [
    'id',
    'revision',
    'objective',
    'status',
    'phase',
    'nextAction',
    'criteria',
    'nonGoals',
    'rules',
    'blockers',
    'plan',
    'workspace',
    'profile',
    'sessionId',
    'activeTimeSeconds',
    'activeStartedAt',
    'createdAt',
    'updatedAt',
    'history',
  ]
  if (Object.keys(value).some((key) => !known.includes(key))) throw new Error('Unknown Goal field.')
}

function historyEntry(revision: number, actor: Actor, action: string, summary: string): HistoryItem {
  return {
    at: nowIso(),
    actor,
    action,
    summary: compactText(summary, 500),
    revision,
  }
}

function validateObjective(value: unknown): string {
  const objective = String(value ?? '').trim()
  if (!objective) throw new Error('Goal objective must not be empty.')
  if (objective.length > MAX_OBJECTIVE_CHARS) {
    throw new Error(`Goal objective exceeds ${MAX_OBJECTIVE_CHARS} characters.`)
  }
  return objective
}

function validateGoalIdInput(value: unknown): string {
  const goalId = String(value ?? '').trim()
  if (!goalId) throw new Error('goal_id is required when moving a Mahiro Goal.')
  if (goalId.length > 160) throw new Error('goal_id exceeds 160 characters.')
  return goalId
}

function normalizeCriteria(input: CriterionInput[]): Criterion[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('At least one Definition of Done criterion is required.')
  }
  if (input.length > MAX_CRITERIA) throw new Error(`At most ${MAX_CRITERIA} criteria are allowed.`)
  const timestamp = nowIso()
  return input.map((item, index) => {
    const text = String(item?.text ?? '').trim()
    if (!text) throw new Error(`Criterion ${index + 1} must not be empty.`)
    if (text.length > MAX_CRITERION_CHARS) {
      throw new Error(`Criterion ${index + 1} exceeds ${MAX_CRITERION_CHARS} characters.`)
    }
    const owner = item.owner ?? 'agent'
    if (owner !== 'agent' && owner !== 'human') {
      throw new Error(`Criterion ${index + 1} owner must be agent or human.`)
    }
    return {
      id: `criterion-${String(index + 1).padStart(2, '0')}`,
      text,
      owner,
      required: item.required !== false,
      status: 'pending',
      evidence: [],
      note: null,
      updatedAt: timestamp,
    }
  })
}

function normalizeNonGoals(input: unknown): string[] {
  if (input == null) return []
  if (!Array.isArray(input)) throw new Error('non_goals must be an array of strings.')
  if (input.length > MAX_NON_GOALS) throw new Error(`At most ${MAX_NON_GOALS} non-goals are allowed.`)
  return input.map((item, index) => {
    const text = compactText(item, MAX_CRITERION_CHARS)
    if (!text) throw new Error(`Non-goal ${index + 1} must not be empty.`)
    return text
  })
}

function normalizeRules(input: unknown, source: RuleSource, reservedIds: Iterable<string> = []): GoalRule[] {
  if (input == null) return []
  if (!Array.isArray(input)) throw new Error('rules must be an array.')
  if (input.length > MAX_RULES) throw new Error(`At most ${MAX_RULES} goal rules are allowed.`)
  const usedIds = new Set(reservedIds)
  return input.map((item, index) => {
    if (!isRecord(item) || Object.keys(item).some((field) => !['text', 'level'].includes(field))) {
      throw new Error(`Rule ${index + 1} contains unsupported fields.`)
    }
    const text = String(item.text ?? '').trim()
    if (!text) throw new Error(`Rule ${index + 1} must not be empty.`)
    if (text.length > MAX_RULE_CHARS)
      throw new Error(`Rule ${index + 1} exceeds ${MAX_RULE_CHARS} characters.`)
    const level = item.level ?? 'prefer'
    if (level !== 'must' && level !== 'prefer') {
      throw new Error(`Rule ${index + 1} level must be must or prefer.`)
    }
    let id = ''
    do id = `rule-${randomUUID().slice(0, 8)}`
    while (usedIds.has(id))
    usedIds.add(id)
    return {
      id,
      text,
      level,
      source,
    }
  })
}

export function liveElapsedSeconds(goal: WorkflowGoal): number {
  if (goal.status !== 'active' || !goal.activeStartedAt) return goal.activeTimeSeconds
  const startedAt = Date.parse(goal.activeStartedAt)
  const live = Number.isNaN(startedAt) ? 0 : Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  return goal.activeTimeSeconds + live
}

function stopClock(goal: WorkflowGoal): WorkflowGoal {
  if (!goal.activeStartedAt) return goal
  const startedAt = Date.parse(goal.activeStartedAt)
  const elapsed = Number.isNaN(startedAt) ? 0 : Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  goal.activeTimeSeconds += elapsed
  goal.activeStartedAt = null
  return goal
}

function startClock(goal: WorkflowGoal): WorkflowGoal {
  goal.activeStartedAt ??= nowIso()
  return goal
}

function criterionById(goal: WorkflowGoal, id: unknown): Criterion {
  const criterion = goal.criteria.find((item) => item.id === String(id ?? ''))
  if (!criterion) throw new Error(`Unknown criterion: ${String(id ?? '<missing>')}`)
  return criterion
}

function blockerById(goal: WorkflowGoal, id: unknown): Blocker {
  const blocker = goal.blockers.find((item) => item.id === String(id ?? ''))
  if (!blocker) throw new Error(`Unknown blocker: ${String(id ?? '<missing>')}`)
  return blocker
}

function planItemById(goal: WorkflowGoal, id: unknown): PlanItem {
  const item = goal.plan.find((candidate) => candidate.id === String(id ?? ''))
  if (!item) throw new Error(`Unknown plan item: ${String(id ?? '<missing>')}`)
  return item
}

function ruleById(goal: WorkflowGoal, id: unknown): GoalRule {
  const rule = goal.rules.find((item) => item.id === String(id ?? ''))
  if (!rule) throw new Error(`Unknown goal rule: ${String(id ?? '<missing>')}`)
  return rule
}

function addRule(goal: WorkflowGoal, args: any, source: RuleSource): WorkflowGoal {
  if (goal.rules.length >= MAX_RULES)
    throw new Error(`A mission may contain at most ${MAX_RULES} goal rules.`)
  const [rule] = normalizeRules(
    [{ text: args.rule_text, level: args.rule_level }],
    source,
    goal.rules.map((item) => item.id),
  )
  goal.rules.push(rule)
  return goal
}

function updateRule(goal: WorkflowGoal, args: any): WorkflowGoal {
  const rule = ruleById(goal, args.rule_id)
  if (!Object.hasOwn(args, 'rule_text') && !Object.hasOwn(args, 'rule_level')) {
    throw new Error('update_rule needs rule_text, rule_level, or both.')
  }
  if (Object.hasOwn(args, 'rule_text')) {
    const text = String(args.rule_text ?? '').trim()
    if (!text) throw new Error('rule_text must not be empty.')
    if (text.length > MAX_RULE_CHARS) throw new Error(`rule_text exceeds ${MAX_RULE_CHARS} characters.`)
    rule.text = text
  }
  if (Object.hasOwn(args, 'rule_level')) {
    if (args.rule_level !== 'must' && args.rule_level !== 'prefer') {
      throw new Error('rule_level must be must or prefer.')
    }
    rule.level = args.rule_level
  }
  return goal
}

function reviseMission(goal: WorkflowGoal, args: any, actor: Actor): WorkflowGoal {
  const editable = ['objective', 'criteria', 'non_goals', 'rules', 'phase', 'next_action']
  if (!editable.some((field) => Object.hasOwn(args, field))) {
    throw new Error(
      'revise_mission needs at least one of objective, criteria, non_goals, rules, phase, or next_action.',
    )
  }
  if (Object.hasOwn(args, 'objective')) goal.objective = validateObjective(args.objective)
  if (Object.hasOwn(args, 'criteria')) goal.criteria = normalizeCriteria(args.criteria)
  if (Object.hasOwn(args, 'non_goals')) goal.nonGoals = normalizeNonGoals(args.non_goals)
  if (Object.hasOwn(args, 'rules'))
    goal.rules = normalizeRules(args.rules, actor === 'human' ? 'human' : 'agent')
  if (Object.hasOwn(args, 'phase')) {
    const phase = compactText(args.phase, 120)
    if (!phase) throw new Error('phase must not be empty when revising a mission.')
    goal.phase = phase
  }
  if (Object.hasOwn(args, 'next_action')) {
    const nextAction = compactText(args.next_action)
    if (!nextAction) throw new Error('next_action must not be empty when revising a mission.')
    goal.nextAction = nextAction
  }
  if (goal.status === 'complete' || goal.status === 'paused') {
    goal.status = 'active'
    startClock(goal)
  }
  return goal
}

function addPlanItem(goal: WorkflowGoal, args: any): WorkflowGoal {
  if (goal.plan.length >= MAX_PLAN_ITEMS)
    throw new Error(`A mission may contain at most ${MAX_PLAN_ITEMS} plan items.`)
  const text = compactText(args.plan_text, MAX_CRITERION_CHARS)
  if (!text) throw new Error('plan_text is required when adding a plan item.')
  const status = String(args.plan_status ?? 'pending') as PlanItemStatus
  if (!['pending', 'in_progress', 'done', 'blocked'].includes(status)) {
    throw new Error(`Unsupported plan status: ${status}`)
  }
  const note = args.plan_note == null ? null : compactText(args.plan_note)
  if (args.plan_note != null && !note) throw new Error('plan_note must not be empty when provided.')
  goal.plan.push({
    id: `plan-${randomUUID().slice(0, 8)}`,
    text,
    status,
    note,
    updatedAt: nowIso(),
  })
  return goal
}

function updatePlanItem(goal: WorkflowGoal, args: any): WorkflowGoal {
  const item = planItemById(goal, args.plan_id)
  if (
    !['plan_text', 'plan_status', 'plan_note', 'clear_plan_note'].some((field) => Object.hasOwn(args, field))
  ) {
    throw new Error('update_plan_item needs plan_text, plan_status, plan_note, or clear_plan_note.')
  }
  if (Object.hasOwn(args, 'plan_text')) {
    const text = compactText(args.plan_text, MAX_CRITERION_CHARS)
    if (!text) throw new Error('plan_text must not be empty when updating a plan item.')
    item.text = text
  }
  if (Object.hasOwn(args, 'plan_status')) {
    const status = String(args.plan_status) as PlanItemStatus
    if (!['pending', 'in_progress', 'done', 'blocked'].includes(status)) {
      throw new Error(`Unsupported plan status: ${status}`)
    }
    item.status = status
  }
  if (Object.hasOwn(args, 'plan_note')) {
    const note = compactText(args.plan_note)
    if (!note) throw new Error('plan_note must not be empty when updating a plan item.')
    item.note = note
  }
  if (args.clear_plan_note === true) item.note = null
  item.updatedAt = nowIso()
  return goal
}

export function completionIssues(goal: WorkflowGoal): string[] {
  const issues: string[] = []
  const openBlockers = goal.blockers.filter((item) => item.status === 'open')
  if (openBlockers.length) issues.push(`open blockers: ${openBlockers.map((item) => item.id).join(', ')}`)
  for (const criterion of goal.criteria.filter((item) => item.required)) {
    if (criterion.status === 'blocked') {
      issues.push(`${criterion.id} is blocked`)
      continue
    }
    if (criterion.owner === 'human' && criterion.status !== 'verified') {
      issues.push(`${criterion.id} requires human verification`)
      continue
    }
    if (criterion.owner === 'agent' && (criterion.status !== 'claimed' || criterion.evidence.length === 0)) {
      issues.push(`${criterion.id} has not been claimed with evidence`)
    }
  }
  return issues
}

function addEvidence(goal: WorkflowGoal, args: any, actor: Actor): WorkflowGoal {
  const criterion = criterionById(goal, args.criterion_id)
  if (criterion.evidence.length >= MAX_EVIDENCE_PER_CRITERION) {
    throw new Error(`${criterion.id} already has the maximum evidence entries.`)
  }
  const summary = compactText(args.summary)
  if (!summary) throw new Error('Evidence summary must not be empty.')
  const allowedKinds = new Set<EvidenceKind>([
    'file',
    'command',
    'test',
    'browser',
    'native',
    'manual',
    'user',
    'other',
  ])
  const kind = String(args.kind ?? 'other') as EvidenceKind
  if (!allowedKinds.has(kind)) throw new Error(`Unsupported evidence kind: ${kind}`)
  const reference = args.reference == null ? null : compactText(args.reference)
  if (args.reference != null && !reference)
    throw new Error('Evidence reference must not be empty when provided.')
  criterion.evidence.push({
    id: `evidence-${randomUUID().slice(0, 8)}`,
    kind,
    summary,
    reference,
    actor,
    createdAt: nowIso(),
  })
  criterion.updatedAt = nowIso()
  return goal
}

export function emptyState(profile: string, project: string): WorkflowState {
  return {
    schemaVersion: 1,
    sequence: 0,
    profile,
    project,
    goals: {},
    sessions: {},
  }
}
export function validateState(state: any, profile: string, project: string): asserts state is WorkflowState {
  if (
    !isRecord(state) ||
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 0 ||
    state.profile !== profile ||
    state.project !== project ||
    Object.keys(state).some(
      (k) => !['schemaVersion', 'sequence', 'profile', 'project', 'goals', 'sessions'].includes(k),
    ) ||
    !isRecord(state.goals) ||
    !isRecord(state.sessions) ||
    Object.keys(state.goals).length > 128 ||
    Object.keys(state.sessions).length > 128
  )
    throw new Error('Invalid native Goal envelope.')
  const assigned = new Set<string>()
  for (const [id, goal] of Object.entries(state.goals)) {
    validateStoredGoal(id, goal)
    if (goal.profile !== profile || goal.workspace !== project || state.sessions[goal.sessionId] !== id)
      throw new Error('Goal scope mismatch.')
  }
  for (const [sessionId, id] of Object.entries(state.sessions)) {
    if (
      !isBoundedString(sessionId, 240) ||
      !isBoundedString(id, 160) ||
      assigned.has(id) ||
      state.goals[id]?.sessionId !== sessionId
    )
      throw new Error('Invalid session pointer.')
    assigned.add(id)
  }
}
export function goalAt(state: WorkflowState, scope: Scope): WorkflowGoal | null {
  return state.goals[state.sessions[scope.sessionId]] ?? null
}
/** Omission selects the session Goal; an explicit selector must resolve exactly. */
export function resolveGoalTarget(
  state: WorkflowState,
  scope: Scope,
  args: { goal_id?: unknown },
): WorkflowGoal | null {
  if (!Object.hasOwn(args, 'goal_id')) return goalAt(state, scope)
  const id = args.goal_id
  if (typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 160)
    throw new Error('Invalid explicit Goal ID.')
  const goal = Object.hasOwn(state.goals, id) ? state.goals[id] : null
  if (
    !goal ||
    goal.profile !== scope.profile ||
    goal.workspace !== scope.project ||
    state.sessions[goal.sessionId] !== id
  )
    throw new Error('Explicit Goal ID not found in this profile/project.')
  return goal
}
function moveGoalToScope(
  state: WorkflowState,
  scope: Scope,
  currentWorkspace: string,
  goalId: string,
  expectedRevision: number,
  actor: Actor,
): WorkflowGoal {
  const current = resolveGoalTarget(state, scope, { goal_id: goalId })
  if (!current || current.profile !== scope.profile || current.workspace !== currentWorkspace)
    throw new Error('Same profile/project Goal required; cross-project move unsupported.')
  if (current.sessionId === scope.sessionId || goalAt(state, scope))
    throw new Error('Move requires a different empty destination session.')
  if (current.revision !== expectedRevision) throw new Error('Stale Goal revision.')
  const moved = structuredClone(current),
    source = current.sessionId
  moved.sessionId = scope.sessionId
  moved.revision++
  moved.updatedAt = nowIso()
  moved.history = [
    ...moved.history,
    historyEntry(moved.revision, actor, 'goal_moved', `Moved from session ${source} to ${scope.sessionId}.`),
  ].slice(-MAX_HISTORY)
  delete state.sessions[source]
  state.sessions[scope.sessionId] = goalId
  state.goals[goalId] = moved
  return structuredClone(moved)
}
export function applyGoal(
  state: WorkflowState,
  scope: Scope,
  operation: 'create' | 'update' | 'clear' | 'human',
  args: any,
): WorkflowGoal {
  if (state.profile !== scope.profile || state.project !== scope.project)
    throw new Error('Goal scope changed.')
  if (
    Object.hasOwn(args, 'goal_id') &&
    operation !== 'clear' &&
    !((operation === 'update' || operation === 'human') && args.action === 'move_goal')
  )
    throw new Error('Explicit Goal ID unsupported for this operation.')
  let result: WorkflowGoal
  if (operation === 'create')
    result = createGoal(
      state,
      scope,
      scope.project,
      {
        ...args,
        nonGoals: args.non_goals,
        nextAction: args.next_action,
        expectedRevision: args.expected_revision,
      },
      'agent',
    )
  else if (operation === 'update') result = updateGoalFromTool(state, scope, scope.project, args)
  else if (operation === 'clear') {
    const current = resolveGoalTarget(state, scope, args)
    if (!current || current.revision !== args.expected_revision) throw new Error('Stale Goal clear.')
    result = structuredClone(current)
    delete state.goals[current.id]
    delete state.sessions[current.sessionId]
  } else {
    if (args.action === 'create' || args.action === 'replace')
      result = createGoal(
        state,
        scope,
        scope.project,
        {
          ...args,
          replace: args.action === 'replace',
          nonGoals: args.non_goals,
          nextAction: args.next_action,
          expectedRevision: args.expected_revision,
        },
        'human',
      )
    else if (args.action === 'move_goal')
      result = moveGoalToScope(state, scope, scope.project, args.goal_id, args.expected_revision, 'human')
    else
      result = mutateGoal(
        state,
        scope,
        'human',
        (
          {
            pause: 'goal_paused',
            resume: 'goal_resumed',
            verify: 'criterion_verified',
            evidence: 'evidence_added',
            complete: 'goal_completed',
            force_complete: 'goal_force_completed',
            set_next: 'next_set',
            set_phase: 'phase_set',
            resolve_blocker: 'blocker_resolved',
            add_rule: 'rule_added',
            update_rule: 'rule_updated',
            remove_rule: 'rule_removed',
          } as Record<string, string>
        )[args.action] ?? args.action,
        (
          {
            pause: 'Paused by Mahiro.',
            resume: 'Resumed by Mahiro.',
            verify: args.criterion_id,
            evidence: args.summary,
            complete: 'Completed after DoD audit.',
            force_complete: 'Forced complete by Mahiro.',
            set_next: args.next_action,
            set_phase: args.phase,
            resolve_blocker: args.blocker_id,
            add_rule: args.rule_level,
            update_rule: args.rule_id,
            remove_rule: args.rule_id,
          } as Record<string, string>
        )[args.action] ?? args.action,
        args.expected_revision,
        (goal) => {
          if (args.action === 'pause') {
            stopClock(goal)
            goal.status = 'paused'
          } else if (args.action === 'resume') {
            if (
              goal.blockers.some((b) => b.status === 'open') ||
              goal.criteria.some((c) => c.status === 'blocked')
            )
              throw new Error('Resolve blockers and blocked criteria before resuming.')
            goal.status = 'active'
            startClock(goal)
          } else if (args.action === 'verify') {
            const criterion = criterionById(goal, args.criterion_id)
            if (criterion.owner !== 'human') throw new Error('Only human-owned criteria can be verified.')
            criterion.status = 'verified'
            criterion.note = args.summary ? compactText(args.summary) : criterion.note
            criterion.updatedAt = nowIso()
          } else if (args.action === 'evidence') return addEvidence(goal, { ...args, kind: 'user' }, 'human')
          else if (args.action === 'complete' || args.action === 'force_complete') {
            const issues = completionIssues(goal)
            if (issues.length && args.action !== 'force_complete')
              throw new Error(`Goal cannot complete: ${issues.join('; ')}`)
            goal.status = 'complete'
            goal.nextAction = null
            stopClock(goal)
          } else if (args.action === 'set_next') {
            const text = compactText(args.next_action)
            if (!text) throw new Error('Next action required.')
            goal.nextAction = text
          } else if (args.action === 'set_phase') {
            const text = compactText(args.phase, 120)
            if (!text) throw new Error('Phase required.')
            goal.phase = text
          } else if (args.action === 'resolve_blocker') {
            const b = blockerById(goal, args.blocker_id)
            b.status = 'resolved'
            b.resolvedAt = nowIso()
          } else if (args.action === 'add_rule') return addRule(goal, args, 'human')
          else if (args.action === 'update_rule') return updateRule(goal, args)
          else if (args.action === 'remove_rule') {
            const rule = ruleById(goal, args.rule_id)
            goal.rules = goal.rules.filter((r) => r.id !== rule.id)
          } else throw new Error('Unsupported human Goal action.')
          return goal
        },
      )
  }
  validateState(state, scope.profile, scope.project)
  return result
}
function createGoal(
  state: WorkflowState,
  scope: Scope,
  workspace: string,
  input: GoalCreateInput,
  actor: Actor,
): WorkflowGoal {
  const objective = validateObjective(input.objective)
  const criteria = normalizeCriteria(input.criteria)
  const nonGoals = normalizeNonGoals(input.nonGoals)
  const rules = normalizeRules(input.rules, actor === 'human' ? 'human' : 'agent')
  const nextAction = input.nextAction == null ? null : compactText(input.nextAction)
  if (input.nextAction != null && !nextAction) throw new Error('next_action must not be empty when provided.')
  const timestamp = nowIso()
  return (() => {
    const existing = goalAt(state, scope)
    if (existing && input.replace !== true) {
      throw new Error(
        'A Mahiro Goal already exists. Revise the living mission or explicitly replace its current plan first.',
      )
    }
    if (input.replace === true) {
      if (!existing) throw new Error('Cannot replace a Mahiro Goal that does not exist.')
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== existing.revision) {
        throw new Error(`Replacing a Mahiro Goal requires expected_revision ${existing.revision}.`)
      }
    }
    if (existing) {
      const revised = structuredClone(existing)
      const revision = existing.revision + 1
      revised.objective = objective
      revised.criteria = criteria
      revised.nonGoals = nonGoals
      revised.rules = rules
      revised.nextAction = nextAction
      revised.phase = 'planning'
      revised.blockers = []
      revised.plan = []
      revised.status = 'active'
      startClock(revised)
      revised.revision = revision
      revised.updatedAt = timestamp
      revised.history = [
        ...revised.history,
        historyEntry(revision, actor, 'mission_revised', 'Mission and current plan revised explicitly.'),
      ].slice(-MAX_HISTORY)
      state.goals[revised.id] = revised
      return structuredClone(revised)
    }
    const goal: WorkflowGoal = {
      id: `mh-goal-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      revision: 1,
      objective,
      status: 'active',
      phase: 'execution',
      nextAction,
      criteria,
      nonGoals,
      rules,
      blockers: [],
      plan: [],
      workspace,
      profile: scope.profile,
      sessionId: scope.sessionId,
      activeTimeSeconds: 0,
      activeStartedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [historyEntry(1, actor, input.replace ? 'goal_replaced' : 'goal_created', objective)],
    }
    state.goals[goal.id] = goal
    state.sessions[scope.sessionId] = goal.id
    return structuredClone(goal)
  })()
}
function mutateGoal(
  state: WorkflowState,
  scope: Scope,
  actor: Actor,
  action: string,
  summary: string,
  expectedRevision: number | null,
  mutate: (goal: WorkflowGoal) => WorkflowGoal,
  options: { allowCompleted?: boolean } = {},
): WorkflowGoal {
  return (() => {
    const current = goalAt(state, scope)
    if (!current) throw new Error('No Mahiro Goal exists for this conversation.')
    if (current.status === 'complete' && !options.allowCompleted) {
      throw new Error(
        "This mission's current plan is complete. Use revise_mission to explicitly reopen it, or clear it.",
      )
    }
    if (expectedRevision !== null && current.revision !== expectedRevision) {
      throw new Error(
        `Stale Mahiro Goal revision: expected ${expectedRevision}, current ${current.revision}. Read the goal again before updating.`,
      )
    }
    const revision = current.revision + 1
    const next = mutate(structuredClone(current))
    next.revision = revision
    next.updatedAt = nowIso()
    next.history = [
      ...(Array.isArray(next.history) ? next.history : []),
      historyEntry(revision, actor, action, summary),
    ].slice(-MAX_HISTORY)
    state.goals[next.id] = next
    return structuredClone(next)
  })()
}
function updateGoalFromTool(
  state: WorkflowState,
  scope: Scope,
  currentWorkspace: string,
  args: any,
): WorkflowGoal {
  const action = String(args.action ?? '')
  const expectedRevision = Number(args.expected_revision)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('expected_revision must be the current positive goal revision.')
  }
  if (action === 'move_goal') {
    return moveGoalToScope(
      state,
      scope,
      currentWorkspace,
      validateGoalIdInput(args.goal_id),
      expectedRevision,
      'agent',
    )
  }
  return mutateGoal(
    state,
    scope,
    'agent',
    action,
    args.summary ?? action,
    expectedRevision,
    (goal) => {
      if (action === 'revise_mission') return reviseMission(goal, args, 'agent')
      if (action === 'set_phase') {
        const phase = compactText(args.phase, 120)
        if (!phase) throw new Error('phase is required for set_phase.')
        goal.phase = phase
        return goal
      }
      if (action === 'set_next') {
        const nextAction = compactText(args.next_action)
        if (!nextAction) throw new Error('next_action is required for set_next.')
        goal.nextAction = nextAction
        return goal
      }
      if (action === 'add_plan_item') return addPlanItem(goal, args)
      if (action === 'update_plan_item') return updatePlanItem(goal, args)
      if (action === 'remove_plan_item') {
        const item = planItemById(goal, args.plan_id)
        goal.plan = goal.plan.filter((candidate) => candidate.id !== item.id)
        return goal
      }
      if (action === 'add_rule') return addRule(goal, args, 'agent')
      if (action === 'update_rule') return updateRule(goal, args)
      if (action === 'remove_rule') {
        const rule = ruleById(goal, args.rule_id)
        goal.rules = goal.rules.filter((candidate) => candidate.id !== rule.id)
        return goal
      }
      if (action === 'add_evidence') return addEvidence(goal, args, 'agent')
      if (action === 'claim_criterion') {
        const criterion = criterionById(goal, args.criterion_id)
        if (criterion.owner !== 'agent')
          throw new Error(`${criterion.id} is human-owned and cannot be claimed by the agent.`)
        if (criterion.evidence.length === 0)
          throw new Error(`${criterion.id} needs concrete evidence before it can be claimed.`)
        criterion.status = 'claimed'
        if (args.summary != null) {
          const note = compactText(args.summary)
          if (!note) throw new Error('Claim summary must not be empty when provided.')
          criterion.note = note
        }
        criterion.updatedAt = nowIso()
        return goal
      }
      if (action === 'block_criterion') {
        const criterion = criterionById(goal, args.criterion_id)
        criterion.status = 'blocked'
        criterion.note = compactText(args.summary || 'Blocked')
        criterion.updatedAt = nowIso()
        goal.status = 'blocked'
        stopClock(goal)
        return goal
      }
      if (action === 'add_blocker' || action === 'mark_blocked') {
        if (goal.blockers.length >= MAX_BLOCKERS)
          throw new Error('Goal already has the maximum blocker entries.')
        const summary = compactText(args.summary)
        if (!summary) throw new Error('summary is required when adding a blocker.')
        goal.blockers.push({
          id: `blocker-${randomUUID().slice(0, 8)}`,
          summary,
          status: 'open',
          createdAt: nowIso(),
          resolvedAt: null,
        })
        if (action === 'mark_blocked') {
          goal.status = 'blocked'
          stopClock(goal)
        }
        return goal
      }
      if (action === 'resolve_blocker') {
        const blocker = blockerById(goal, args.blocker_id)
        blocker.status = 'resolved'
        blocker.resolvedAt = nowIso()
        return goal
      }
      if (action === 'complete') {
        const issues = completionIssues(goal)
        if (issues.length) throw new Error(`Goal cannot complete: ${issues.join('; ')}.`)
        goal.status = 'complete'
        goal.nextAction = null
        stopClock(goal)
        return goal
      }
      throw new Error(`Unsupported Mahiro Goal action: ${action}`)
    },
    { allowCompleted: action === 'revise_mission' },
  )
}
/** Validate direct execute too; public dispatch schema validation is not the only boundary. */
export function validateGoalInput(schema: any, value: any, depth = 0): void {
  if (depth > 6) throw new Error('Goal input depth exceeded')
  if (schema.type === 'object') {
    if (
      !isRecord(value) ||
      Object.keys(value).length > 40 ||
      (schema.required ?? []).some((key: string) => !Object.hasOwn(value, key)) ||
      (schema.additionalProperties === false &&
        Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key)))
    )
      throw new Error('Invalid Goal input object')
    for (const [key, entry] of Object.entries(value))
      validateGoalInput(schema.properties[key], entry, depth + 1)
  } else if (schema.type === 'array') {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? 30)
    )
      throw new Error('Goal input array bound')
    for (const entry of value) validateGoalInput(schema.items, entry, depth + 1)
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? 0))
      throw new Error('Goal positive integer required')
  } else if (
    typeof value !== schema.type ||
    (schema.type === 'string' && (value.length > (schema.maxLength ?? 4096) || /\u0000/.test(value)))
  )
    throw new Error('Invalid Goal input scalar')
  if (schema.enum && !schema.enum.includes(value)) throw new Error('Invalid Goal input enum')
}

export const GET_PARAMETERS = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}
export const CLEAR_PARAMETERS = {
  type: 'object',
  properties: {
    goal_id: {
      type: 'string',
      minLength: 1,
      maxLength: 160,
      description:
        'Optional exact Goal ID in this profile/project; unknown IDs reject, never select the current Goal.',
    },
    expected_revision: {
      type: 'integer',
      minimum: 1,
      description: 'Current revision returned by mh_get_goal.',
    },
  },
  required: ['expected_revision'],
  additionalProperties: false,
}
export const CREATE_PARAMETERS = {
  type: 'object',
  properties: {
    objective: {
      type: 'string',
      description: 'One concrete human-owned mission objective.',
    },
    criteria: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_CRITERIA,
      description: 'Definition of Done criteria. Human-owned criteria require Mahiro verification.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          owner: { type: 'string', enum: ['agent', 'human'] },
          required: { type: 'boolean' },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    non_goals: {
      type: 'array',
      items: { type: 'string' },
      maxItems: MAX_NON_GOALS,
    },
    rules: {
      type: 'array',
      maxItems: MAX_RULES,
      description:
        'Temporary goal-scoped operating rules. MUST is a mission constraint; PREFER is a non-blocking default. Rules never override higher-priority instructions or count as DoD.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: MAX_RULE_CHARS },
          level: { type: 'string', enum: ['must', 'prefer'] },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    next_action: { type: 'string', description: 'Immediate next action.' },
    replace: {
      type: 'boolean',
      description:
        'Compatibility alias: explicitly revise the current mission only after Mahiro approved the revision.',
    },
    expected_revision: {
      type: 'integer',
      minimum: 1,
      description: 'Required with replace=true to guard against stale mission revision.',
    },
  },
  required: ['objective', 'criteria'],
  additionalProperties: false,
}
export const UPDATE_PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [
        'set_phase',
        'set_next',
        'revise_mission',
        'move_goal',
        'add_plan_item',
        'update_plan_item',
        'remove_plan_item',
        'add_rule',
        'update_rule',
        'remove_rule',
        'add_evidence',
        'claim_criterion',
        'block_criterion',
        'add_blocker',
        'resolve_blocker',
        'mark_blocked',
        'complete',
      ],
    },
    expected_revision: {
      type: 'integer',
      minimum: 1,
      description: 'Current revision returned by mh_get_goal.',
    },
    phase: { type: 'string' },
    next_action: { type: 'string' },
    objective: { type: 'string' },
    criteria: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_CRITERIA,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          owner: { type: 'string', enum: ['agent', 'human'] },
          required: { type: 'boolean' },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    non_goals: {
      type: 'array',
      items: { type: 'string' },
      maxItems: MAX_NON_GOALS,
    },
    rules: {
      type: 'array',
      maxItems: MAX_RULES,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: MAX_RULE_CHARS },
          level: { type: 'string', enum: ['must', 'prefer'] },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    goal_id: {
      type: 'string',
      description:
        'Stable Goal ID required by move_goal. The destination is always the current conversation.',
    },
    rule_id: { type: 'string' },
    rule_text: { type: 'string', maxLength: MAX_RULE_CHARS },
    rule_level: { type: 'string', enum: ['must', 'prefer'] },
    plan_id: { type: 'string' },
    plan_text: { type: 'string' },
    plan_status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'done', 'blocked'],
    },
    plan_note: { type: 'string' },
    clear_plan_note: { type: 'boolean' },
    criterion_id: { type: 'string' },
    blocker_id: { type: 'string' },
    summary: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['file', 'command', 'test', 'browser', 'native', 'manual', 'user', 'other'],
    },
    reference: { type: 'string' },
  },
  required: ['action', 'expected_revision'],
  additionalProperties: false,
}
