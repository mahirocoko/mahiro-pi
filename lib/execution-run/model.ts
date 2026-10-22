/** Canonical Mods Execution Run metadata FSM. No executor, artifact or workflow access. */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
const MAX_SCOPES = 256
const MAX_TEXT = 1_200
const MAX_LONG = 4_000
const MAX_LANES = 16
const MAX_WORKTREES = 16
const MAX_TARGETS = 64
const MAX_BLOCKERS = 30
const MAX_HISTORY = 80
const MAX_REFS = 24
const MAX_SESSION_REFS = 4
const MAX_REPORTS = 4
const MAX_PATHS_PER_REPORT = 64
const MAX_PATHS_PER_RUN = 512
const MAX_CHECKS = 24
const LETTA_SESSION_REF =
  /^letta:agent=([A-Za-z0-9][A-Za-z0-9_.:-]{0,239});conversation=([A-Za-z0-9][A-Za-z0-9_.:-]{0,239})$/
const STAGES = ['plan', 'ready', 'active', 'reported', 'handed_off'] as const
const TERMINAL_STAGES = ['handed_off', 'abandoned'] as const
const EXECUTORS = ['main_agent', 'letta_subagent', 'pi_subagent', 'direct_cli', 'human', 'other'] as const
const ROLES = ['implement', 'research', 'review', 'verify', 'other'] as const
const LANE_STATUSES = [
  'planned',
  'active',
  'blocked',
  'reported',
  'handed_off',
  'failed',
  'cancelled',
] as const
type Stage = (typeof STAGES)[number]
type Executor = (typeof EXECUTORS)[number]
type Role = (typeof ROLES)[number]
type LaneStatus = (typeof LANE_STATUSES)[number]
type Access = 'read' | 'write'

export interface Scope {
  profile: string
  project: string
  sessionId: string
}
interface Target {
  id: string
  path: string
  intent: string
  worktree_ref: string
  access: Access
  writer_lane_id: string | null
  reader_lane_ids: string[]
}
interface Report {
  id: string
  status: Extract<LaneStatus, 'reported' | 'handed_off' | 'failed' | 'cancelled'>
  summary: string
  changed_paths: string[]
  checks: string[]
  refs: string[]
  created_at: string
}
interface Lane {
  id: string
  required: boolean
  executor_kind: Executor
  executor_label: string | null
  role: Role
  worktree_ref: string | null
  status: LaneStatus
  summary: string
  session_refs: string[]
  reports: Report[]
}
interface Blocker {
  id: string
  lane_id: string | null
  summary: string
  status: 'open' | 'resolved'
  created_at: string
  resolved_at: string | null
}
interface History {
  at: string
  action: string
  summary: string
  revision: number
}
interface CodeEvidenceIntake {
  run_id: string
  revision: number
  workspace: string
  goal_refs: string[]
  targets: Target[]
  changed_paths: string[]
  suggested_checks: string[]
  refs: string[]
  disclaimer: string
}
interface Handoff {
  final_handoff: string
  unresolved_items: string[]
  suggested_checks: string[]
  goal_refs: string[]
  included: string[]
  exceptions: string[]
  code_evidence_intake: CodeEvidenceIntake
}
export interface Run {
  id: string
  revision: number
  stage: Stage | 'abandoned'
  summary: string
  acceptance_criteria: string[]
  non_goals: string[]
  protected_contracts: string[]
  open_questions: Array<{ question: string; blocking: boolean }>
  suggested_checks: string[]
  workspace: string
  profile: string
  sessionId: string
  worktree_refs: string[]
  targets: Target[]
  lanes: Lane[]
  blockers: Blocker[]
  goal_refs: string[]
  ux_workflow_refs: string[]
  code_evidence_refs: string[]
  handoff: Handoff | null
  abandoned_note: string | null
  replaces_run_id: string | null
  created_at: string
  updated_at: string
  history: History[]
}
export interface State {
  schemaVersion: 1
  profile: string
  project: string
  sequence: number
  runs: Record<string, Run>
}

function now(): string {
  return new Date().toISOString()
}
function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function hasUnsafeText(value: string): boolean {
  return (
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value) ||
    /<\/?system-reminder\b|\b(?:diff --git|@@\s+-\d|(?:^|\s)(?:traceback|error:|fatal:)|\b(?:stdout|stderr)\s*:)/i.test(
      value,
    )
  )
}
function text(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || hasUnsafeText(value))
    throw new Error(`${label} must be safe, non-empty text of at most ${max} characters.`)
  return value.trim()
}
function optionalText(value: unknown, label: string, max = MAX_TEXT): string | null {
  return value == null ? null : text(value, label, max)
}
function id(value: unknown, label: string, max = 120): string {
  const result = text(value, label, max)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(result)) throw new Error(`${label} has invalid characters.`)
  return result
}
function iso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 80 &&
    !hasUnsafeText(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
function list(value: unknown, label: string, max: number, itemMax = MAX_TEXT, required = false): string[] {
  if (!Array.isArray(value) || value.length > max || (required && !value.length))
    throw new Error(`${label} must be ${required ? 'a non-empty' : 'an'} array with at most ${max} items.`)
  const items = value.map((item, index) => text(item, `${label}[${index}]`, itemMax))
  if (new Set(items).size !== items.length) throw new Error(`${label} must not contain duplicates.`)
  return items
}
function laneSessionRefs(value: unknown, executor: Executor): string[] {
  const refs = list(value, 'session_refs', MAX_SESSION_REFS)
  if (executor === 'pi_subagent') {
    for (const ref of refs)
      if (!/^pi:session=[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(ref))
        throw Error('Pi session refs require pi:session=<nativeSessionId> metadata')
    return refs
  }
  if (executor !== 'letta_subagent') return refs
  refs.forEach((ref, index) => {
    if (!LETTA_SESSION_REF.test(ref))
      throw new Error(
        `session_refs[${index}] for a Letta subagent must use letta:agent=<agent-id>;conversation=<conversation-id>.`,
      )
  })
  return refs
}
function pathValue(value: unknown, label: string): string {
  const result = text(value, label, 4096)
  if (
    result.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(result) ||
    result.includes('\\') ||
    result.split('/').some((part) => !part || part === '..')
  )
    throw new Error(`${label} must be a relative lexical path without traversal.`)
  const normalized = result
    .split('/')
    .filter((part) => part !== '.')
    .join('/')
  if (!normalized) throw new Error(`${label} must identify a path below the declared worktree root.`)
  return normalized
}
function terminal(run: Run): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(run.stage)
}
function openBlockers(run: Run, laneId?: string): Blocker[] {
  return run.blockers.filter(
    (blocker) => blocker.status === 'open' && (laneId === undefined || blocker.lane_id === laneId),
  )
}
function parentOrSame(left: string, right: string): boolean {
  return left === right || right.startsWith(`${left}/`)
}
function latestReport(lane: Lane): Report | null {
  return lane.reports.length ? lane.reports[lane.reports.length - 1] : null
}
function terminalLane(lane: Lane): boolean {
  return ['reported', 'handed_off', 'failed', 'cancelled'].includes(lane.status)
}
function reportMatchesLane(lane: Lane): boolean {
  const report = latestReport(lane)
  return (
    report !== null &&
    (report.status === lane.status || (lane.status === 'handed_off' && report.status === 'reported'))
  )
}
function requiredLanes(run: Run): Lane[] {
  return run.lanes.filter((lane) => lane.required)
}
function validateTargetCollisions(targets: Target[]): void {
  for (let i = 0; i < targets.length; i += 1)
    for (let j = i + 1; j < targets.length; j += 1) {
      const left = targets[i]
      const right = targets[j]
      if (left.access !== 'write' || right.access !== 'write' || left.worktree_ref !== right.worktree_ref)
        continue
      if (parentOrSame(left.path, right.path) || parentOrSame(right.path, left.path))
        throw new Error('Only two writable targets may not overlap in the same declared worktree.')
    }
}
function normalizeTargets(value: unknown, required = true): Target[] {
  if (!Array.isArray(value) || value.length > MAX_TARGETS || (required && !value.length))
    throw new Error(
      `targets must be ${required ? 'a non-empty' : 'an'} array with at most ${MAX_TARGETS} items.`,
    )
  const targets = value.map((item, index) => {
    if (!record(item) || !['read', 'write'].includes(item.access))
      throw new Error(
        `targets[${index}] requires id, path, intent, worktree_ref, access, writer_lane_id, and reader_lane_ids.`,
      )
    const access = item.access as Access
    const writer =
      item.writer_lane_id == null ? null : id(item.writer_lane_id, `targets[${index}].writer_lane_id`)
    return {
      id: id(item.id, `targets[${index}].id`),
      path: pathValue(item.path, `targets[${index}].path`),
      intent: text(item.intent, `targets[${index}].intent`, MAX_LONG),
      worktree_ref: id(item.worktree_ref, `targets[${index}].worktree_ref`, 240),
      access,
      writer_lane_id: writer,
      reader_lane_ids: list(item.reader_lane_ids, `targets[${index}].reader_lane_ids`, MAX_LANES),
    }
  })
  if (new Set(targets.map((target) => target.id)).size !== targets.length)
    throw new Error('targets must have unique IDs.')
  validateTargetCollisions(targets)
  return targets
}
function validateTargetsForReady(run: Run): void {
  const lanes = new Map(run.lanes.map((lane) => [lane.id, lane]))
  for (const target of run.targets) {
    if (target.access === 'write') {
      const writer = target.writer_lane_id ? lanes.get(target.writer_lane_id) : null
      if (!writer) throw new Error(`Write target ${target.id} requires exactly one existing writer lane.`)
      if (!writer.required || writer.role !== 'implement')
        throw new Error(`Write target ${target.id} requires a required implementation lane.`)
      if (writer.worktree_ref !== null && writer.worktree_ref !== target.worktree_ref)
        throw new Error(`Write target ${target.id} and writer lane must use the same declared worktree.`)
    } else if (target.writer_lane_id !== null) {
      throw new Error(`Read target ${target.id} must not have a writer lane.`)
    }
    for (const reader of target.reader_lane_ids) {
      if (!lanes.has(reader)) throw new Error(`Target ${target.id} references an unknown reader lane.`)
      if (reader === target.writer_lane_id)
        throw new Error(`Target ${target.id} writer cannot also be a reader.`)
    }
  }
}
function validateReport(value: unknown, label: string): asserts value is Report {
  if (
    !record(value) ||
    !['reported', 'handed_off', 'failed', 'cancelled'].includes(value.status) ||
    !iso(value.created_at)
  )
    throw new Error(`${label} has invalid report metadata.`)
  id(value.id, `${label}.id`)
  text(value.summary, `${label}.summary`, MAX_LONG)
  const paths = list(value.changed_paths, `${label}.changed_paths`, MAX_PATHS_PER_REPORT, 4096)
  paths.forEach((path, index) => pathValue(path, `${label}.changed_paths[${index}]`))
  list(value.checks, `${label}.checks`, MAX_CHECKS)
  list(value.refs, `${label}.refs`, MAX_REFS)
}
function validateReportOwnership(run: Run, lane: Lane, report: Report): void {
  const writable = run.targets.filter(
    (target) => target.access === 'write' && target.writer_lane_id === lane.id,
  )
  if (!writable.length && report.changed_paths.length)
    throw new Error(`Read-only lane ${lane.id} must not report changed paths.`)
  for (const changed of report.changed_paths) {
    if (
      !writable.some(
        (target) =>
          target.worktree_ref === (lane.worktree_ref ?? target.worktree_ref) &&
          parentOrSame(target.path, changed),
      )
    )
      throw new Error(`Changed path ${changed} is not covered by a write target owned by lane ${lane.id}.`)
  }
}
function validateHandoff(value: unknown, run: Run): asserts value is Handoff {
  if (!record(value) || !record(value.code_evidence_intake))
    throw new Error('Execution Run handoff is invalid.')
  text(value.final_handoff, 'handoff.final_handoff', MAX_LONG)
  list(value.unresolved_items, 'handoff.unresolved_items', MAX_REFS)
  list(value.suggested_checks, 'handoff.suggested_checks', MAX_CHECKS, MAX_TEXT, true)
  list(value.goal_refs, 'handoff.goal_refs', MAX_REFS, MAX_TEXT, true)
  const included = list(value.included, 'handoff.included', MAX_LANES)
  const exceptions = list(value.exceptions, 'handoff.exceptions', MAX_LANES)
  const intake = value.code_evidence_intake
  if (intake.run_id !== run.id || intake.revision !== run.revision || intake.workspace !== run.workspace)
    throw new Error('Execution Run handoff intake does not bind to the current run.')
  const intakeGoalRefs = list(
    intake.goal_refs,
    'handoff.code_evidence_intake.goal_refs',
    MAX_REFS,
    MAX_TEXT,
    true,
  )
  normalizeTargets(intake.targets)
  if (JSON.stringify(intake.targets) !== JSON.stringify(run.targets))
    throw new Error('Execution Run handoff intake targets must match the run targets exactly.')
  const changed = list(
    intake.changed_paths,
    'handoff.code_evidence_intake.changed_paths',
    MAX_PATHS_PER_RUN,
    4096,
  )
  changed.forEach((path, index) => pathValue(path, `handoff.code_evidence_intake.changed_paths[${index}]`))
  list(intake.suggested_checks, 'handoff.code_evidence_intake.suggested_checks', MAX_CHECKS)
  list(intake.refs, 'handoff.code_evidence_intake.refs', MAX_REFS)
  text(intake.disclaimer, 'handoff.code_evidence_intake.disclaimer', MAX_TEXT)
  const reported = run.lanes
    .filter((lane) => ['reported', 'handed_off'].includes(lane.status))
    .map((lane) => lane.id)
    .sort()
  const exceptional = run.lanes
    .filter((lane) => ['failed', 'cancelled'].includes(lane.status))
    .map((lane) => lane.id)
    .sort()
  if (
    JSON.stringify([...included].sort()) !== JSON.stringify(reported) ||
    JSON.stringify([...exceptions].sort()) !== JSON.stringify(exceptional)
  )
    throw new Error('Handoff included and exceptions must exactly match lane terminal truth.')
  if (JSON.stringify([...value.goal_refs].sort()) !== JSON.stringify([...run.goal_refs].sort()))
    throw new Error('Handoff Goal refs must exactly match the run-declared Goal refs.')
  if (JSON.stringify([...intakeGoalRefs].sort()) !== JSON.stringify([...run.goal_refs].sort()))
    throw new Error('Handoff intake Goal refs must exactly match the run-declared Goal refs.')
}
function validateRun(key: string, value: unknown): asserts value is Run {
  if (!record(value)) throw new Error(`Execution Run ${key} must be an object.`)
  id(value.id, `Execution Run ${key}.id`, 160)
  text(value.summary, `Execution Run ${key}.summary`, MAX_LONG)
  for (const name of ['workspace', 'profile', 'sessionId'])
    text(value[name], `Execution Run ${key}.${name}`, name === 'sessionId' ? 240 : 4096)
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    ![...STAGES, 'abandoned'].includes(value.stage) ||
    !iso(value.created_at) ||
    !iso(value.updated_at)
  )
    throw new Error(`Execution Run ${key} has invalid lifecycle metadata.`)
  if (key !== value.sessionId) throw new Error(`Execution Run ${key} does not match its scope.`)
  list(value.acceptance_criteria, `Execution Run ${key}.acceptance_criteria`, MAX_REFS, MAX_TEXT, true)
  list(value.non_goals, `Execution Run ${key}.non_goals`, MAX_REFS)
  list(value.protected_contracts, `Execution Run ${key}.protected_contracts`, MAX_REFS)
  list(value.suggested_checks, `Execution Run ${key}.suggested_checks`, MAX_CHECKS, MAX_TEXT, true)
  if (!Array.isArray(value.open_questions) || value.open_questions.length > MAX_REFS)
    throw new Error(`Execution Run ${key}.open_questions is invalid.`)
  for (const [index, question] of value.open_questions.entries())
    if (!record(question) || typeof question.blocking !== 'boolean')
      throw new Error(`Execution Run ${key}.open_questions[${index}] is invalid.`)
    else text(question.question, `Execution Run ${key}.open_questions[${index}].question`, MAX_TEXT)
  list(value.worktree_refs, `Execution Run ${key}.worktree_refs`, MAX_WORKTREES, 240, true)
  const targets = normalizeTargets(value.targets)
  if (targets.some((target) => !value.worktree_refs.includes(target.worktree_ref)))
    throw new Error(`Execution Run ${key} target references an undeclared worktree.`)
  if (!Array.isArray(value.lanes) || value.lanes.length > MAX_LANES)
    throw new Error(`Execution Run ${key} has invalid lanes.`)
  const laneIds = new Set<string>()
  let totalPaths = 0
  for (const [index, lane] of value.lanes.entries()) {
    if (
      !record(lane) ||
      typeof lane.required !== 'boolean' ||
      !EXECUTORS.includes(lane.executor_kind) ||
      !ROLES.includes(lane.role) ||
      !LANE_STATUSES.includes(lane.status)
    )
      throw new Error(`Execution Run ${key}.lanes[${index}] has invalid metadata.`)
    const laneId = id(lane.id, `Execution Run ${key}.lanes[${index}].id`)
    if (laneIds.has(laneId)) throw new Error(`Execution Run ${key} has duplicate lane IDs.`)
    laneIds.add(laneId)
    optionalText(lane.executor_label, `Execution Run ${key}.lanes[${index}].executor_label`)
    if (lane.worktree_ref !== null)
      id(lane.worktree_ref, `Execution Run ${key}.lanes[${index}].worktree_ref`, 240)
    if (lane.worktree_ref !== null && !value.worktree_refs.includes(lane.worktree_ref))
      throw new Error(`Execution Run ${key} lane has an undeclared worktree.`)
    text(lane.summary, `Execution Run ${key}.lanes[${index}].summary`, MAX_LONG)
    laneSessionRefs(lane.session_refs, lane.executor_kind)
    if (!Array.isArray(lane.reports) || lane.reports.length > MAX_REPORTS)
      throw new Error(`Execution Run ${key}.lanes[${index}] has too many reports.`)
    for (const [reportIndex, report] of lane.reports.entries()) {
      validateReport(report, `Execution Run ${key}.lanes[${index}].reports[${reportIndex}]`)
      validateReportOwnership(value as Run, lane as Lane, report as Report)
      totalPaths += report.changed_paths.length
    }
  }
  if (totalPaths > MAX_PATHS_PER_RUN)
    throw new Error(`Execution Run ${key} exceeds ${MAX_PATHS_PER_RUN} changed paths.`)
  for (const name of ['goal_refs', 'ux_workflow_refs', 'code_evidence_refs'])
    list(value[name], `Execution Run ${key}.${name}`, MAX_REFS)
  if (
    !Array.isArray(value.blockers) ||
    value.blockers.length > MAX_BLOCKERS ||
    !Array.isArray(value.history) ||
    !value.history.length ||
    value.history.length > MAX_HISTORY
  )
    throw new Error(`Execution Run ${key} has invalid bounded collections.`)
  const blockers = new Set<string>()
  for (const [index, blocker] of value.blockers.entries()) {
    if (
      !record(blocker) ||
      !['open', 'resolved'].includes(blocker.status) ||
      !iso(blocker.created_at) ||
      (blocker.resolved_at !== null && !iso(blocker.resolved_at)) ||
      (blocker.status === 'open' ? blocker.resolved_at !== null : blocker.resolved_at === null)
    )
      throw new Error(`Execution Run ${key}.blockers[${index}] is invalid.`)
    const blockerId = id(blocker.id, `Execution Run ${key}.blockers[${index}].id`)
    if (blockers.has(blockerId)) throw new Error(`Execution Run ${key} has duplicate blockers.`)
    blockers.add(blockerId)
    text(blocker.summary, `Execution Run ${key}.blockers[${index}].summary`, MAX_LONG)
    if (
      blocker.lane_id !== null &&
      !laneIds.has(id(blocker.lane_id, `Execution Run ${key}.blockers[${index}].lane_id`))
    )
      throw new Error(`Execution Run ${key} blocker has unknown lane.`)
  }
  value.history.forEach((item: unknown, index: number) => {
    if (
      !record(item) ||
      !iso(item.at) ||
      !Number.isSafeInteger(item.revision) ||
      (index > 0 && item.revision !== value.history[index - 1].revision + 1)
    )
      throw new Error(`Execution Run ${key}.history must have strictly increasing contiguous revisions.`)
    text(item.action, `Execution Run ${key}.history[${index}].action`, 120)
    text(item.summary, `Execution Run ${key}.history[${index}].summary`, 500)
  })
  if (value.history[value.history.length - 1].revision !== value.revision)
    throw new Error(`Execution Run ${key}.history must end at current revision.`)
  if (value.abandoned_note !== null)
    text(value.abandoned_note, `Execution Run ${key}.abandoned_note`, MAX_LONG)
  if (value.replaces_run_id !== null) id(value.replaces_run_id, `Execution Run ${key}.replaces_run_id`, 160)
  if (value.stage === 'abandoned' && value.abandoned_note === null)
    throw new Error(`Execution Run ${key} abandoned without a note.`)
  if (value.stage !== 'abandoned' && value.abandoned_note !== null)
    throw new Error(`Execution Run ${key} has an unexpected abandoned note.`)
  if (value.handoff !== null) validateHandoff(value.handoff, value as Run)
  if (value.stage === 'handed_off' && value.handoff === null)
    throw new Error(`Execution Run ${key} handed off without a handoff.`)
  if (!['reported', 'handed_off'].includes(value.stage) && value.handoff !== null)
    throw new Error(`Execution Run ${key} has a handoff before reported stage.`)
}
function history(revision: number, action: string, summary: string): History {
  return {
    at: now(),
    action: text(action, 'history action', 120),
    summary: text(summary, 'history summary', 500),
    revision,
  }
}
function assertWorkspace(scope: Scope, run: Run): void {
  if (run.workspace !== scope.project || run.profile !== scope.profile)
    throw new Error(`Execution Run workspace mismatch. Current run targets ${run.workspace}.`)
}
function expected(args: any, run: Run): void {
  if (
    id(args.expected_run_id, 'expected_run_id', 160) !== run.id ||
    !Number.isSafeInteger(args.expected_revision) ||
    args.expected_revision !== run.revision
  )
    throw new Error(
      `Stale Execution Run guard. expected_run_id and expected_revision must match ${run.id} revision ${run.revision}.`,
    )
}
function createRun(state: State, scope: Scope, args: any): Run {
  return ((state: State) => {
    const existing = state.runs[scope.sessionId]
    if (existing) {
      assertWorkspace(scope, existing)
      if (!terminal(existing) || args.replace_terminal !== true)
        throw new Error(
          'An Execution Run already exists for this scope. Only an explicit terminal replacement is allowed.',
        )
      expected(args, existing)
    }
    if (!existing && Object.keys(state.runs).length >= MAX_SCOPES)
      throw new Error(`Execution Run state already contains ${MAX_SCOPES} scopes.`)
    const worktreeRefs = list(
      args.worktree_refs ?? ['default'],
      'worktree_refs',
      MAX_WORKTREES,
      240,
      true,
    ).map((ref, index) => id(ref, `worktree_refs[${index}]`, 240))
    const targets = normalizeTargets(args.targets)
    if (targets.some((target) => !worktreeRefs.includes(target.worktree_ref)))
      throw new Error('Every target must declare one of worktree_refs.')
    const timestamp = now()
    const run: Run = {
      id: `mh-run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      revision: 1,
      stage: 'plan',
      summary: text(args.summary, 'summary', MAX_LONG),
      acceptance_criteria: list(args.acceptance_criteria, 'acceptance_criteria', MAX_REFS, MAX_TEXT, true),
      non_goals: list(args.non_goals, 'non_goals', MAX_REFS),
      protected_contracts: list(args.protected_contracts, 'protected_contracts', MAX_REFS),
      open_questions: normalizeQuestions(args.open_questions),
      suggested_checks: list(args.suggested_checks, 'suggested_checks', MAX_CHECKS, MAX_TEXT, true),
      workspace: scope.project,
      profile: scope.profile,
      sessionId: scope.sessionId,
      worktree_refs: worktreeRefs,
      targets,
      lanes: [],
      blockers: [],
      goal_refs: list(args.goal_refs ?? [], 'goal_refs', MAX_REFS),
      ux_workflow_refs: list(args.ux_workflow_refs ?? [], 'ux_workflow_refs', MAX_REFS),
      code_evidence_refs: list(args.code_evidence_refs ?? [], 'code_evidence_refs', MAX_REFS),
      handoff: null,
      abandoned_note: null,
      replaces_run_id: existing?.id ?? null,
      created_at: timestamp,
      updated_at: timestamp,
      history: [history(1, existing ? 'terminal_replaced' : 'created', text(args.summary, 'summary', 500))],
    }
    validateRun(scope.sessionId, run)
    state.runs[scope.sessionId] = run
    return structuredClone(run)
  })(state)
}
function normalizeQuestions(value: unknown): Array<{ question: string; blocking: boolean }> {
  if (!Array.isArray(value) || value.length > MAX_REFS)
    throw new Error(`open_questions must be an array with at most ${MAX_REFS} items.`)
  return value.map((item, index) => {
    if (!record(item) || typeof item.blocking !== 'boolean')
      throw new Error(`open_questions[${index}] requires question and blocking.`)
    return {
      question: text(item.question, `open_questions[${index}].question`),
      blocking: item.blocking,
    }
  })
}
function mutate(state: State, scope: Scope, args: any, action: string, apply: (run: Run) => void): Run {
  return ((state: State) => {
    const current = state.runs[scope.sessionId]
    if (!current) throw new Error('No Execution Run exists for this scope.')
    assertWorkspace(scope, current)
    expected(args, current)
    if (terminal(current))
      throw new Error(
        'Terminal Execution Runs are immutable; create a replacement with replace_terminal and current guards.',
      )
    const next = structuredClone(current)
    apply(next)
    if (JSON.stringify(next) === JSON.stringify(current))
      throw new Error('Execution Run update made no change.')
    next.revision += 1
    next.updated_at = now()
    next.history = [
      ...next.history,
      history(next.revision, action, optionalText(args.summary, 'summary', 500) ?? action),
    ].slice(-MAX_HISTORY)
    validateRun(scope.sessionId, next)
    state.runs[scope.sessionId] = next
    return structuredClone(next)
  })(state)
}
function lane(run: Run, laneId: unknown): Lane {
  const item = run.lanes.find((entry) => entry.id === String(laneId))
  if (!item) throw new Error(`Unknown lane: ${String(laneId ?? '<missing>')}`)
  return item
}
const LEGAL_LANE_TRANSITIONS: Record<LaneStatus, LaneStatus[]> = {
  planned: ['active', 'blocked', 'cancelled'],
  active: ['blocked', 'reported', 'failed', 'cancelled'],
  blocked: ['active', 'failed', 'cancelled'],
  reported: ['handed_off'],
  handed_off: [],
  failed: [],
  cancelled: [],
}
function setLaneStatus(run: Run, item: Lane, status: unknown, resolvingBlocker = false): void {
  if (
    !LANE_STATUSES.includes(status as LaneStatus) ||
    !LEGAL_LANE_TRANSITIONS[item.status].includes(status as LaneStatus)
  )
    throw new Error(`Illegal lane status transition: ${item.status} -> ${String(status)}.`)
  if (status === 'active' && item.required && !item.session_refs.length && !resolvingBlocker)
    throw new Error(`Required lane ${item.id} needs session refs before active.`)
  if (status === 'active' && openBlockers(run, item.id).length)
    throw new Error(`Lane ${item.id} has open blockers.`)
  item.status = status as LaneStatus
}
function transition(run: Run, stage: unknown): void {
  if (!STAGES.includes(stage as Stage))
    throw new Error('stage must be plan, ready, active, reported, or handed_off.')
  if (stage === 'ready' && run.stage === 'plan') {
    if (
      !run.lanes.length ||
      !run.goal_refs.length ||
      openBlockers(run).length ||
      run.open_questions.some((question) => question.blocking)
    )
      throw new Error('ready requires lanes, Goal refs, no open blockers, and no blocking open questions.')
    validateTargetsForReady(run)
    run.stage = 'ready'
    return
  }
  if (stage === 'active' && run.stage === 'ready') {
    const missing = requiredLanes(run).filter((item) => !item.session_refs.length)
    if (openBlockers(run).length || missing.length)
      throw new Error('active requires no open blockers and session refs for every required lane.')
    run.stage = 'active'
    return
  }
  if (stage === 'reported' && run.stage === 'active') {
    const missing = requiredLanes(run).filter((item) => !terminalLane(item) || !reportMatchesLane(item))
    if (missing.length)
      throw new Error(
        `reported requires every required lane terminal with a matching latest report: ${missing.map((item) => item.id).join(', ')}.`,
      )
    run.stage = 'reported'
    return
  }
  if (stage === 'handed_off' && run.stage === 'reported') {
    if (openBlockers(run).length || !run.handoff || run.handoff.unresolved_items.length)
      throw new Error('handed_off requires no open blockers, no unresolved items, and a final handoff.')
    if (run.lanes.some((item) => !terminalLane(item) || !reportMatchesLane(item)))
      throw new Error('handed_off requires every lane terminal with a matching latest report.')
    validateHandoff(run.handoff, run)
    run.stage = 'handed_off'
    return
  }
  throw new Error(`Invalid Execution Run transition: ${run.stage} -> ${String(stage)}.`)
}
function codeEvidenceIntake(
  run: Run,
  revision: number,
  suggestedChecks: string[],
  goalRefs: string[],
  refs: string[],
): CodeEvidenceIntake {
  return {
    run_id: run.id,
    revision,
    workspace: run.workspace,
    goal_refs: goalRefs,
    targets: structuredClone(run.targets),
    changed_paths: run.lanes
      .flatMap((item) => item.reports.flatMap((report) => report.changed_paths))
      .slice(0, MAX_PATHS_PER_RUN),
    suggested_checks: suggestedChecks,
    refs,
    disclaimer: 'Caller metadata only; this intake is not execution, repository, check, or acceptance proof.',
  }
}
function updateRun(state: State, scope: Scope, args: any): Run {
  const action = String(args?.action ?? '')
  return mutate(state, scope, args, action, (run) => {
    if (action === 'add_lane') {
      if (run.stage !== 'plan' || run.lanes.length >= MAX_LANES)
        throw new Error('add_lane is allowed only in plan while below the lane limit.')
      const laneId = id(args.lane_id, 'lane_id')
      if (
        run.lanes.some((item) => item.id === laneId) ||
        !EXECUTORS.includes(args.executor_kind) ||
        !ROLES.includes(args.role) ||
        typeof args.required !== 'boolean'
      )
        throw new Error('lane_id must be unique; required, executor_kind, and role are required.')
      const worktreeRef = args.worktree_ref == null ? null : id(args.worktree_ref, 'worktree_ref', 240)
      if (worktreeRef !== null && !run.worktree_refs.includes(worktreeRef))
        throw new Error('lane worktree_ref must be declared.')
      run.lanes.push({
        id: laneId,
        required: args.required,
        executor_kind: args.executor_kind,
        executor_label: optionalText(args.executor_label, 'executor_label'),
        role: args.role,
        worktree_ref: worktreeRef,
        status: 'planned',
        summary: text(args.summary, 'summary', MAX_LONG),
        session_refs: [],
        reports: [],
      })
      return
    }
    if (action === 'set_lane_sessions') {
      if (!['plan', 'ready'].includes(run.stage))
        throw new Error('set_lane_sessions is allowed only before active.')
      const item = lane(run, args.lane_id)
      item.session_refs = laneSessionRefs(args.session_refs, item.executor_kind)
      return
    }
    if (action === 'set_lane_status') {
      if (!['active', 'blocked', 'handed_off'].includes(args.status))
        throw new Error(
          'set_lane_status only supports active, blocked, or handed_off; terminal report outcomes must use add_report.',
        )
      setLaneStatus(run, lane(run, args.lane_id), args.status)
      return
    }
    if (action === 'add_report') {
      if (!['active', 'reported'].includes(run.stage))
        throw new Error('add_report is allowed only during active or reported.')
      const item = lane(run, args.lane_id)
      if (
        item.reports.length >= MAX_REPORTS ||
        !['reported', 'handed_off', 'failed', 'cancelled'].includes(args.status)
      )
        throw new Error('report status is invalid or the lane report limit was reached.')
      if (item.status === 'planned') throw new Error('A planned lane cannot report.')
      const report: Report = {
        id: id(args.report_id, 'report_id'),
        status: args.status,
        summary: text(args.summary, 'summary', MAX_LONG),
        changed_paths: list(args.changed_paths ?? [], 'changed_paths', MAX_PATHS_PER_REPORT, 4096).map(
          (path, index) => pathValue(path, `changed_paths[${index}]`),
        ),
        checks: list(args.checks ?? [], 'checks', MAX_CHECKS),
        refs: list(args.refs ?? [], 'refs', MAX_REFS),
        created_at: now(),
      }
      validateReportOwnership(run, item, report)
      if (
        run.lanes
          .flatMap((entry) => entry.reports)
          .reduce((count, entry) => count + entry.changed_paths.length, 0) +
          report.changed_paths.length >
        MAX_PATHS_PER_RUN
      )
        throw new Error('Run changed path limit reached.')
      setLaneStatus(run, item, report.status)
      item.reports.push(report)
      return
    }
    if (action === 'add_blocker') {
      if (run.blockers.length >= MAX_BLOCKERS) throw new Error('Blocker limit reached.')
      const laneId = args.lane_id == null ? null : lane(run, args.lane_id).id
      if (laneId !== null) {
        const item = lane(run, laneId)
        if (['reported', 'handed_off', 'failed', 'cancelled'].includes(item.status))
          throw new Error('Cannot block a terminal lane.')
        if (item.status !== 'blocked') setLaneStatus(run, item, 'blocked')
      }
      run.blockers.push({
        id: `blocker-${randomUUID().slice(0, 10)}`,
        lane_id: laneId,
        summary: text(args.summary, 'summary', MAX_LONG),
        status: 'open',
        created_at: now(),
        resolved_at: null,
      })
      return
    }
    if (action === 'resolve_blocker') {
      const blocker = run.blockers.find((item) => item.id === String(args.blocker_id))
      if (!blocker || blocker.status !== 'open') throw new Error('Unknown or already resolved blocker.')
      blocker.status = 'resolved'
      blocker.resolved_at = now()
      if (blocker.lane_id !== null && !openBlockers(run, blocker.lane_id).length) {
        const item = lane(run, blocker.lane_id)
        if (item.status === 'blocked') setLaneStatus(run, item, 'active', true)
      }
      return
    }
    if (action === 'set_open_questions') {
      if (run.stage !== 'plan') throw new Error('set_open_questions is allowed only in plan.')
      run.open_questions = normalizeQuestions(args.open_questions)
      return
    }
    if (action === 'set_goal_refs') {
      if (run.stage !== 'plan') throw new Error('set_goal_refs is allowed only in plan.')
      run.goal_refs = list(args.goal_refs, 'goal_refs', MAX_REFS, MAX_TEXT, true)
      return
    }
    if (action === 'set_handoff') {
      if (run.stage !== 'reported') throw new Error('set_handoff is allowed only in reported.')
      const suggestedChecks = list(args.suggested_checks, 'suggested_checks', MAX_CHECKS, MAX_TEXT, true)
      const goalRefs = list(args.goal_refs, 'goal_refs', MAX_REFS, MAX_TEXT, true)
      const included = list(args.included, 'included', MAX_LANES)
      const exceptions = list(args.exceptions ?? [], 'exceptions', MAX_LANES)
      const unresolved = list(args.unresolved_items ?? [], 'unresolved_items', MAX_REFS)
      const refs = list(args.refs ?? [], 'refs', MAX_REFS)
      run.handoff = {
        final_handoff: text(args.final_handoff, 'final_handoff', MAX_LONG),
        unresolved_items: unresolved,
        suggested_checks: suggestedChecks,
        goal_refs: goalRefs,
        included,
        exceptions,
        code_evidence_intake: codeEvidenceIntake(run, run.revision + 1, suggestedChecks, goalRefs, refs),
      }
      return
    }
    if (action === 'set_stage') {
      transition(run, args.stage)
      if (run.stage === 'handed_off' && run.handoff)
        run.handoff.code_evidence_intake.revision = run.revision + 1
      return
    }
    throw new Error(`Unsupported Execution Run action: ${action}`)
  })
}
function boundedRun(run: Run): Record<string, unknown> {
  return {
    id: run.id,
    revision: run.revision,
    stage: run.stage,
    summary: run.summary,
    acceptance_criteria: run.acceptance_criteria,
    non_goals: run.non_goals,
    protected_contracts: run.protected_contracts,
    open_questions: run.open_questions,
    suggested_checks: run.suggested_checks,
    targets: run.targets.slice(0, 24),
    lanes: run.lanes.map((lane) => ({
      ...lane,
      reports: lane.reports.slice(-2).map((report) => ({
        ...report,
        changed_paths: report.changed_paths.slice(0, 16),
        checks: report.checks.slice(0, 12),
        refs: report.refs.slice(0, 12),
      })),
    })),
    blockers: run.blockers.slice(-12),
    goal_refs: run.goal_refs,
    handoff: run.handoff
      ? {
          final_handoff: run.handoff.final_handoff,
          unresolved_items: run.handoff.unresolved_items.slice(0, 12),
          suggested_checks: run.handoff.suggested_checks.slice(0, 12),
          goal_refs: run.handoff.goal_refs.slice(0, 12),
          included: run.handoff.included,
          exceptions: run.handoff.exceptions,
        }
      : null,
    history: run.history.slice(-12),
  }
}
export function response(run: Run | null) {
  return {
    status: run ? 'ok' : 'empty',
    run: run ? boundedRun(run) : null,
    execution_handoff:
      run && run.stage !== 'plan' && run.stage !== 'abandoned'
        ? {
            run_id: run.id,
            revision: run.revision,
            workspace: run.workspace,
            summary: run.summary,
            acceptance_criteria: run.acceptance_criteria.slice(0, 12),
            non_goals: run.non_goals.slice(0, 12),
            protected_contracts: run.protected_contracts.slice(0, 12),
            targets: run.targets.slice(0, 24),
            lanes: run.lanes.map((lane) => ({
              id: lane.id,
              required: lane.required,
              executor_kind: lane.executor_kind,
              executor_label: lane.executor_label,
              role: lane.role,
              worktree_ref: lane.worktree_ref,
              status: lane.status,
              session_refs: lane.session_refs.slice(0, MAX_SESSION_REFS),
            })),
            suggested_checks: run.suggested_checks.slice(0, 12),
            goal_refs: run.goal_refs.slice(0, 12),
            ux_workflow_refs: run.ux_workflow_refs.slice(0, 12),
            boundary:
              'Structured coordination metadata only; the caller owns prompt construction and executor control.',
          }
        : null,
    code_evidence_intake: run?.handoff?.code_evidence_intake
      ? {
          run_id: run.handoff.code_evidence_intake.run_id,
          revision: run.handoff.code_evidence_intake.revision,
          workspace: run.handoff.code_evidence_intake.workspace,
          goal_refs: run.handoff.code_evidence_intake.goal_refs.slice(0, 12),
          changed_paths: run.handoff.code_evidence_intake.changed_paths.slice(0, 64),
          suggested_checks: run.handoff.code_evidence_intake.suggested_checks.slice(0, 12),
          refs: run.handoff.code_evidence_intake.refs.slice(0, 12),
          disclaimer: run.handoff.code_evidence_intake.disclaimer,
        }
      : null,
    open_blockers: run ? openBlockers(run).slice(0, 12) : [],
    boundary:
      'All reports, paths, checks, sessions, worktrees, and cross-workflow references are caller metadata, never proof.',
  }
}
function format(run: Run): string {
  const stageMeaning =
    run.stage === 'reported'
      ? 'Reported means lane reports were recorded; it does not mean successful, verified, accepted, merged, or Goal complete.'
      : run.stage === 'handed_off'
        ? 'Handed off means scope ownership moved forward; it does not mean verified or Goal complete.'
        : 'Execution Run state is coordination metadata, not Goal completion.'
  return [
    `Mahiro Execution Run · ${run.stage} · revision ${run.revision}`,
    `Summary: ${run.summary}`,
    `Targets: ${run.targets.length} · lanes: ${run.lanes.length} · open blockers: ${openBlockers(run).length}`,
    `Reports: ${run.lanes.reduce((count, item) => count + item.reports.length, 0)} · handoff: ${run.handoff ? 'recorded' : 'not recorded'}`,
    stageMeaning,
    'Metadata is coordination only, not proof.',
  ].join('\n')
}
function compactRunSummary(summary: string, max = 140): string {
  return summary.length <= max ? summary : `${summary.slice(0, Math.max(0, max - 1))}…`
}
export function formatRunList(runs: Run[]): string {
  const remaining = runs.filter((run) => !terminal(run))
  if (!remaining.length) return 'No Execution Runs need attention.'
  return [
    'Mahiro Execution Runs needing attention · operator command metadata inventory',
    ...remaining
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map(
        (run) =>
          `${run.id} · ${run.stage} · Goal refs: ${run.goal_refs.length ? run.goal_refs.join(', ') : 'none'} · rev ${run.revision} · ${run.sessionId} · ${run.updated_at.slice(0, 10)} · ${compactRunSummary(run.summary)}`,
      ),
    'Terminal handed-off/abandoned runs are intentionally hidden. Goal refs are declared coordination metadata, not live mission validation.',
  ].join('\n')
}
function output(message: string, success = true) {
  return { type: 'output' as const, output: message, success }
}
const STRING_ARRAY = (max: number, min = 0) => ({
  type: 'array',
  minItems: min,
  maxItems: max,
  items: { type: 'string', maxLength: MAX_TEXT },
})
const SESSION_REFS_SCHEMA = {
  ...STRING_ARRAY(MAX_SESSION_REFS),
  description:
    'Caller session metadata only, never worker binding or authenticated receipts. pi_subagent uses pi:session=<nativeSessionId>; letta_subagent uses letta:agent=<agent-id>;conversation=<conversation-id>. Other executor references are opaque.',
}
const TARGET_SCHEMA = {
  type: 'object',
  required: ['id', 'path', 'intent', 'worktree_ref', 'access', 'writer_lane_id', 'reader_lane_ids'],
  properties: {
    id: { type: 'string', maxLength: 120 },
    path: { type: 'string', maxLength: 4096 },
    intent: { type: 'string', maxLength: MAX_LONG },
    worktree_ref: { type: 'string', maxLength: 240 },
    access: { type: 'string', enum: ['read', 'write'] },
    writer_lane_id: { type: ['string', 'null'], maxLength: 120 },
    reader_lane_ids: STRING_ARRAY(MAX_LANES),
  },
  additionalProperties: false,
}
const QUESTION_SCHEMA = {
  type: 'object',
  required: ['question', 'blocking'],
  properties: {
    question: { type: 'string', maxLength: MAX_TEXT },
    blocking: { type: 'boolean' },
  },
  additionalProperties: false,
}
const CREATE_PARAMETERS = {
  type: 'object',
  required: [
    'summary',
    'acceptance_criteria',
    'targets',
    'non_goals',
    'protected_contracts',
    'open_questions',
    'suggested_checks',
  ],
  properties: {
    workspace: { type: 'string', maxLength: 4096 },
    summary: { type: 'string', maxLength: MAX_LONG },
    acceptance_criteria: STRING_ARRAY(MAX_REFS, 1),
    non_goals: STRING_ARRAY(MAX_REFS),
    protected_contracts: STRING_ARRAY(MAX_REFS),
    open_questions: {
      type: 'array',
      maxItems: MAX_REFS,
      items: QUESTION_SCHEMA,
    },
    suggested_checks: STRING_ARRAY(MAX_CHECKS, 1),
    worktree_refs: STRING_ARRAY(MAX_WORKTREES, 1),
    targets: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_TARGETS,
      items: TARGET_SCHEMA,
    },
    goal_refs: STRING_ARRAY(MAX_REFS),
    ux_workflow_refs: STRING_ARRAY(MAX_REFS),
    code_evidence_refs: STRING_ARRAY(MAX_REFS),
    replace_terminal: { type: 'boolean' },
    expected_run_id: { type: 'string', maxLength: 160 },
    expected_revision: { type: 'integer', minimum: 1 },
  },
  additionalProperties: false,
}
const UPDATE_PARAMETERS = {
  type: 'object',
  required: ['action', 'expected_run_id', 'expected_revision'],
  properties: {
    workspace: { type: 'string', maxLength: 4096 },
    action: {
      type: 'string',
      enum: [
        'add_lane',
        'set_lane_sessions',
        'set_lane_status',
        'add_report',
        'add_blocker',
        'resolve_blocker',
        'set_open_questions',
        'set_goal_refs',
        'set_handoff',
        'set_stage',
      ],
    },
    expected_run_id: { type: 'string', maxLength: 160 },
    expected_revision: { type: 'integer', minimum: 1 },
    lane_id: { type: 'string', maxLength: 120 },
    required: { type: 'boolean' },
    executor_kind: { type: 'string', enum: EXECUTORS },
    executor_label: { type: ['string', 'null'], maxLength: MAX_TEXT },
    role: { type: 'string', enum: ROLES },
    worktree_ref: { type: ['string', 'null'], maxLength: 240 },
    status: { type: 'string', enum: LANE_STATUSES },
    report_id: { type: 'string', maxLength: 120 },
    summary: { type: 'string', maxLength: MAX_LONG },
    session_refs: SESSION_REFS_SCHEMA,
    changed_paths: {
      type: 'array',
      maxItems: MAX_PATHS_PER_REPORT,
      items: { type: 'string', maxLength: 4096 },
    },
    checks: STRING_ARRAY(MAX_CHECKS),
    refs: STRING_ARRAY(MAX_REFS),
    blocker_id: { type: 'string', maxLength: 120 },
    stage: { type: 'string', enum: STAGES },
    open_questions: {
      type: 'array',
      maxItems: MAX_REFS,
      items: QUESTION_SCHEMA,
    },
    final_handoff: { type: 'string', maxLength: MAX_LONG },
    unresolved_items: STRING_ARRAY(MAX_REFS),
    suggested_checks: STRING_ARRAY(MAX_CHECKS),
    goal_refs: STRING_ARRAY(MAX_REFS),
    included: STRING_ARRAY(MAX_LANES),
    exceptions: STRING_ARRAY(MAX_LANES),
  },
  additionalProperties: false,
}
export const EXECUTION_RUN_PARAMETERS = {
  type: 'object',
  required: ['operation'],
  properties: {
    operation: { type: 'string', enum: ['get', 'create', 'update'] },
    ...CREATE_PARAMETERS.properties,
    ...UPDATE_PARAMETERS.properties,
  },
  additionalProperties: false,
}

export function emptyState(profile: string, project: string): State {
  return { schemaVersion: 1, profile, project, sequence: 0, runs: {} }
}
export function runAt(state: State, scope: Scope): Run | null {
  return Object.hasOwn(state.runs, scope.sessionId) ? state.runs[scope.sessionId] : null
}
function closed(value: any, fields: string) {
  const keys = fields.split(' ')
  if (
    !record(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    throw Error('Invalid closed Execution Run stored object')
}
export function validateState(state: any, profile: string, project: string): asserts state is State {
  closed(state, 'schemaVersion profile project sequence runs')
  if (
    state.schemaVersion !== 1 ||
    state.profile !== profile ||
    state.project !== project ||
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 0 ||
    !record(state.runs) ||
    Object.keys(state.runs).length > MAX_SCOPES
  )
    throw Error('Invalid native Execution Run envelope')
  const ids = new Set()
  for (const [key, run] of Object.entries(state.runs) as [string, Run][]) {
    closed(
      run,
      'id revision stage summary acceptance_criteria non_goals protected_contracts open_questions suggested_checks workspace profile sessionId worktree_refs targets lanes blockers goal_refs ux_workflow_refs code_evidence_refs handoff abandoned_note replaces_run_id created_at updated_at history',
    )
    if (
      run.profile !== profile ||
      run.workspace !== project ||
      key !== run.sessionId ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      ids.has(run.id)
    )
      throw Error('Invalid native Execution Run scope')
    ids.add(run.id)
    for (const [name, fields] of [
      ['targets', 'id path intent worktree_ref access writer_lane_id reader_lane_ids'],
      [
        'lanes',
        'id required executor_kind executor_label role worktree_ref status summary session_refs reports',
      ],
      ['blockers', 'id lane_id summary status created_at resolved_at'],
      ['history', 'at action summary revision'],
      ['open_questions', 'question blocking'],
    ]) {
      if (!Array.isArray((run as any)[name])) throw Error('Invalid Run collection')
      for (const item of (run as any)[name]) closed(item, fields)
    }
    for (const lane of run.lanes) {
      if (!Array.isArray(lane.reports)) throw Error('Invalid reports')
      for (const r of lane.reports) closed(r, 'id status summary changed_paths checks refs created_at')
    }
    if (run.handoff !== null) {
      closed(
        run.handoff,
        'final_handoff unresolved_items suggested_checks goal_refs included exceptions code_evidence_intake',
      )
      closed(
        run.handoff.code_evidence_intake,
        'run_id revision workspace goal_refs targets changed_paths suggested_checks refs disclaimer',
      )
      for (const t of run.handoff.code_evidence_intake.targets)
        closed(t, 'id path intent worktree_ref access writer_lane_id reader_lane_ids')
    }
    validateRun(key, run)
  }
}
function validateSchema(schema: any, value: any): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (
    !types.some((t: string) =>
      t === 'null'
        ? value === null
        : t === 'array'
          ? Array.isArray(value)
          : t === 'object'
            ? record(value)
            : t === 'integer'
              ? Number.isSafeInteger(value)
              : typeof value === t,
    )
  )
    throw Error('Invalid Execution Run input type')
  if (schema.enum && !schema.enum.includes(value)) throw Error('Invalid Execution Run enum')
  if (typeof value === 'string' && (value.length > (schema.maxLength ?? Infinity) || hasUnsafeText(value)))
    throw Error('Invalid Execution Run input text')
  if (typeof value === 'number' && value < (schema.minimum ?? -Infinity))
    throw Error('Invalid Execution Run number')
  if (Array.isArray(value)) {
    if (value.length > (schema.maxItems ?? Infinity) || value.length < (schema.minItems ?? 0))
      throw Error('Invalid Execution Run input bound')
    for (const item of value) validateSchema(schema.items, item)
  }
  if (record(value)) {
    for (const k of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, k)) throw Error('Unknown Execution Run input field: ' + k)
      validateSchema(schema.properties[k], value[k])
    }
    for (const k of schema.required ?? [])
      if (!Object.hasOwn(value, k)) throw Error('Missing Execution Run input field: ' + k)
  }
}
const actionFields: Record<string, string> = {
  add_lane: 'lane_id required executor_kind executor_label role worktree_ref summary',
  set_lane_sessions: 'lane_id session_refs summary',
  set_lane_status: 'lane_id status summary',
  add_report: 'lane_id report_id status summary changed_paths checks refs',
  add_blocker: 'lane_id summary',
  resolve_blocker: 'blocker_id summary',
  set_open_questions: 'open_questions summary',
  set_goal_refs: 'goal_refs summary',
  set_handoff: 'final_handoff unresolved_items suggested_checks goal_refs included exceptions refs summary',
  set_stage: 'stage summary',
}
const actionRequired: Record<string, string> = {
  add_lane: 'lane_id required executor_kind role summary',
  set_lane_sessions: 'lane_id session_refs',
  set_lane_status: 'lane_id status',
  add_report: 'lane_id report_id status summary',
  add_blocker: 'summary',
  resolve_blocker: 'blocker_id',
  set_open_questions: 'open_questions',
  set_goal_refs: 'goal_refs',
  set_handoff: 'final_handoff suggested_checks goal_refs included',
  set_stage: 'stage',
}
export function validateInput(value: any): void {
  validateSchema(EXECUTION_RUN_PARAMETERS, value)
  const { operation, ...args } = value
  if (operation === 'get') {
    validateSchema(
      {
        type: 'object',
        properties: { workspace: CREATE_PARAMETERS.properties.workspace },
      },
      args,
    )
    return
  }
  if (operation === 'create') {
    validateSchema(CREATE_PARAMETERS, args)
    return
  }
  const fields = actionFields[args.action]
  if (!fields) throw Error('Unsupported Execution Run action')
  const keys = ['workspace', 'action', 'expected_run_id', 'expected_revision', ...fields.split(' ')]
  validateSchema(
    {
      type: 'object',
      properties: Object.fromEntries(keys.map((k) => [k, (UPDATE_PARAMETERS.properties as any)[k]])),
      required: [...UPDATE_PARAMETERS.required, ...actionRequired[args.action].split(' ')],
    },
    args,
  )
}
export function applyRun(
  state: State,
  scope: Scope,
  operation: 'create' | 'update' | 'abandon' | 'clear',
  args: any,
): Run | boolean {
  text(scope.sessionId, 'native session', 240)
  if (['__proto__', 'constructor', 'prototype'].includes(scope.sessionId))
    throw Error('Invalid native session')
  if (args.workspace !== undefined && args.workspace !== scope.project)
    throw Error('Workspace must select configured current project')
  if (operation === 'create' || operation === 'update') {
    validateInput({ operation, ...args })
    return operation === 'create' ? createRun(state, scope, args) : updateRun(state, scope, args)
  }
  const run = runAt(state, scope)
  if (!run) throw Error('No Execution Run target')
  expected(args, run)
  if (operation === 'clear') {
    if (!terminal(run)) throw Error('Only terminal Execution Runs may be cleared')
    delete state.runs[scope.sessionId]
    return true
  }
  return mutate(
    state,
    scope,
    {
      ...args,
      summary: optionalText(args.note, 'note', MAX_LONG) ?? 'Abandoned by confirmed operator',
    },
    'abandoned',
    (r) => {
      r.stage = 'abandoned'
      r.abandoned_note = optionalText(args.note, 'note', MAX_LONG) ?? 'Abandoned by confirmed operator'
    },
  )
}
export function targetById(state: State, runId: string): Run {
  const matches = Object.values(state.runs).filter((r) => r.id === id(runId, 'run_id', 160))
  if (matches.length !== 1) throw Error('No exact unique Execution Run target')
  return matches[0]
}
