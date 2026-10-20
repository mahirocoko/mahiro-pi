/**
 * Mahiro Goal — structured workflow goal foundation for Mahiro's Letta mods.
 *
 * Surfaces: /mh-goal, mh_get_goal, mh_create_goal, mh_update_goal.
 * State: ~/.letta/mods/mahiro-goal.state.json.
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

const SCHEMA_VERSION = 1;
const MAX_OBJECTIVE_CHARS = 4000;
const MAX_CRITERIA = 20;
const MAX_CRITERION_CHARS = 800;
const MAX_NON_GOALS = 20;
const MAX_RULES = 8;
const MAX_RULE_CHARS = 500;
const MAX_TEXT_CHARS = 1200;
const MAX_EVIDENCE_PER_CRITERION = 30;
const MAX_BLOCKERS = 30;
const MAX_PLAN_ITEMS = 30;
const MAX_HISTORY = 80;

const GOAL_COLORS = {
  section: "#8C8CF9",
  active: "#20B2AA",
  complete: "#64CF64",
  attention: "#FEE19C",
  blocked: "#F1689F",
} as const;

const STATE_PATH = resolve(
  process.env.MAHIRO_GOAL_STATE_PATH
    ?? join(homedir(), ".letta", "mods", "mahiro-goal.state.json"),
);
const LOCK_PATH = `${STATE_PATH}.lock`;
const DISABLE_PATH = resolve(
  process.env.MAHIRO_GOAL_DISABLE_PATH
    ?? join(homedir(), ".letta", "mods", "mahiro-goal.disabled"),
);
const waitForRegistrationTurn = () => new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));

type GoalStatus = "active" | "paused" | "blocked" | "complete";
type CriterionOwner = "agent" | "human";
type CriterionStatus = "pending" | "claimed" | "verified" | "blocked";
type Actor = "agent" | "human" | "system";
type EvidenceKind = "file" | "command" | "test" | "browser" | "native" | "manual" | "user" | "other";
type RuleLevel = "must" | "prefer";
type RuleSource = "agent" | "human";

interface Scope {
  agentId: string;
  conversationId: string;
  key: string;
}

interface LockHandle {
  token: string;
  tokenPath: string;
}

interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  summary: string;
  reference: string | null;
  actor: Actor;
  createdAt: string;
}

interface Criterion {
  id: string;
  text: string;
  owner: CriterionOwner;
  required: boolean;
  status: CriterionStatus;
  evidence: EvidenceItem[];
  note: string | null;
  updatedAt: string;
}

interface GoalRule {
  id: string;
  text: string;
  level: RuleLevel;
  source: RuleSource;
}

interface Blocker {
  id: string;
  summary: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}

type PlanItemStatus = "pending" | "in_progress" | "done" | "blocked";

interface PlanItem {
  id: string;
  text: string;
  status: PlanItemStatus;
  note: string | null;
  updatedAt: string;
}

interface HistoryItem {
  at: string;
  actor: Actor;
  action: string;
  summary: string;
  revision: number;
}

interface WorkflowGoal {
  id: string;
  revision: number;
  objective: string;
  status: GoalStatus;
  phase: string;
  nextAction: string | null;
  criteria: Criterion[];
  nonGoals: string[];
  rules: GoalRule[];
  blockers: Blocker[];
  plan: PlanItem[];
  workspace: string;
  agentId: string;
  conversationId: string;
  activeTimeSeconds: number;
  activeStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: HistoryItem[];
}

interface WorkflowState {
  schemaVersion: 1;
  goals: Record<string, WorkflowGoal>;
}

interface CriterionInput {
  text: string;
  owner?: CriterionOwner;
  required?: boolean;
}

interface GoalRuleInput {
  text: string;
  level?: RuleLevel;
}

interface GoalCreateInput {
  objective: string;
  criteria: CriterionInput[];
  nonGoals?: string[];
  rules?: GoalRuleInput[];
  nextAction?: string | null;
  replace?: boolean;
  expectedRevision?: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function compactText(value: unknown, max = MAX_TEXT_CHARS): string {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function displayFieldText(value: unknown): string {
  return stripVTControlCharacters(String(value ?? ""))
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function markdownAccent(value: unknown): string {
  return `\`${displayFieldText(value).replace(/`/g, "'")}\``;
}

function scopeFrom(ctx: any = {}, event: any = {}): Scope {
  const agentId = compactText(ctx?.agent?.id ?? event?.agentId ?? event?.agent_id ?? process.env.AGENT_ID, 240);
  const conversationId = compactText(
    ctx?.conversation?.id ?? event?.conversationId ?? event?.conversation_id ?? process.env.CONVERSATION_ID,
    240,
  );
  if (!agentId || !conversationId) {
    throw new Error("Mahiro Goal requires concrete agent and conversation identity; refusing shared fallback scope.");
  }
  const defaultLaneWorkspace = conversationId === "default" ? workspaceFrom(ctx, event) : "";
  return {
    agentId,
    conversationId,
    key: JSON.stringify([agentId, conversationId, defaultLaneWorkspace]),
  };
}

function workspaceFrom(ctx: any = {}, event: any = {}): string {
  return resolve(String(ctx?.cwd ?? event?.cwd ?? event?.workingDirectory ?? process.cwd()));
}

function emptyState(): WorkflowState {
  return { schemaVersion: SCHEMA_VERSION, goals: {} };
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isBoundedString(value, 80)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function hasUniqueIds(items: unknown[]): boolean {
  if (!items.every((item) => isRecord(item) && typeof item.id === "string")) return false;
  const ids = items.map((item: any) => item.id);
  return ids.length === new Set(ids).size;
}

function normalizeStoredGoal(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized = structuredClone(value);
  // Phase 1 missions predate the mutable plan. Keeping schemaVersion 1 and
  // normalizing the absent field preserves existing conversation state.
  if (normalized.plan === undefined) normalized.plan = [];
  if (normalized.rules === undefined) normalized.rules = [];
  delete normalized.tokenBudget;
  delete normalized.tokenBaseline;
  delete normalized.tokensUsed;
  if (normalized.status === "budget_limited") {
    normalized.status = "active";
    normalized.activeStartedAt = nowIso();
  }
  return normalized;
}

function validateStoredGoal(key: string, value: unknown): asserts value is WorkflowGoal {
  if (!isRecord(value)) throw new Error(`Mahiro Goal state entry ${key} must be an object.`);
  const stringLimits: Record<string, number> = {
    id: 160,
    objective: MAX_OBJECTIVE_CHARS,
    status: 32,
    phase: 120,
    workspace: 4096,
    agentId: 240,
    conversationId: 240,
    createdAt: 80,
    updatedAt: 80,
  };
  for (const [field, max] of Object.entries(stringLimits)) {
    if (!isBoundedString(value[field], max)) throw new Error(`Mahiro Goal state entry ${key} has invalid ${field}.`);
  }
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid timestamps.`);
  }
  if (!["active", "paused", "blocked", "complete"].includes(value.status)) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid status.`);
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid revision.`);
  }
  if (!Number.isSafeInteger(value.activeTimeSeconds) || value.activeTimeSeconds < 0) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid activeTimeSeconds.`);
  }
  if (value.nextAction !== null && !isBoundedString(value.nextAction, MAX_TEXT_CHARS)) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid nextAction.`);
  }
  if (value.activeStartedAt !== null && !isIsoTimestamp(value.activeStartedAt)) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid activeStartedAt.`);
  }
  if ((value.status === "active") !== (value.activeStartedAt !== null)) {
    throw new Error(`Mahiro Goal state entry ${key} has inconsistent active clock state.`);
  }
  if (!Array.isArray(value.criteria) || !Array.isArray(value.nonGoals) || !Array.isArray(value.rules) || !Array.isArray(value.blockers) || !Array.isArray(value.plan) || !Array.isArray(value.history)) {
    throw new Error(`Mahiro Goal state entry ${key} has invalid collection fields.`);
  }
  if (value.criteria.length === 0
    || value.criteria.length > MAX_CRITERIA
    || value.nonGoals.length > MAX_NON_GOALS
    || value.rules.length > MAX_RULES
    || value.blockers.length > MAX_BLOCKERS
    || value.plan.length > MAX_PLAN_ITEMS
    || value.history.length === 0
    || value.history.length > MAX_HISTORY
    || value.nonGoals.some((item: unknown) => !isBoundedString(item, MAX_CRITERION_CHARS))) {
    throw new Error(`Mahiro Goal state entry ${key} exceeds collection limits or contains invalid non-goals.`);
  }
  if (!hasUniqueIds(value.criteria) || !hasUniqueIds(value.rules) || !hasUniqueIds(value.blockers)) {
    throw new Error(`Mahiro Goal state entry ${key} contains duplicate criterion, rule, or blocker IDs.`);
  }
  for (const criterion of value.criteria) {
    if (!isRecord(criterion)
      || !isBoundedString(criterion.id, 120)
      || !isBoundedString(criterion.text, MAX_CRITERION_CHARS)
      || !["agent", "human"].includes(criterion.owner)
      || !["pending", "claimed", "verified", "blocked"].includes(criterion.status)
      || typeof criterion.required !== "boolean"
      || (criterion.note !== null && !isBoundedString(criterion.note, MAX_TEXT_CHARS))
      || !isIsoTimestamp(criterion.updatedAt)
      || !Array.isArray(criterion.evidence)) {
      throw new Error(`Mahiro Goal state entry ${key} has an invalid criterion.`);
    }
    if (criterion.evidence.length > MAX_EVIDENCE_PER_CRITERION) {
      throw new Error(`Mahiro Goal state entry ${key} has too much criterion evidence.`);
    }
    if (!hasUniqueIds(criterion.evidence)) {
      throw new Error(`Mahiro Goal state entry ${key} has duplicate evidence IDs.`);
    }
    for (const evidence of criterion.evidence) {
      if (!isRecord(evidence)
        || !isBoundedString(evidence.id, 120)
        || !["file", "command", "test", "browser", "native", "manual", "user", "other"].includes(evidence.kind)
        || !isBoundedString(evidence.summary, MAX_TEXT_CHARS)
        || (evidence.reference !== null && !isBoundedString(evidence.reference, MAX_TEXT_CHARS))
        || !["agent", "human", "system"].includes(evidence.actor)
        || !isIsoTimestamp(evidence.createdAt)) {
        throw new Error(`Mahiro Goal state entry ${key} has invalid criterion evidence.`);
      }
    }
  }
  for (const rule of value.rules) {
    if (!isRecord(rule)
      || Object.keys(rule).some((field) => !["id", "text", "level", "source"].includes(field))
      || !isBoundedString(rule.id, 120)
      || !isBoundedString(rule.text, MAX_RULE_CHARS)
      || !["must", "prefer"].includes(rule.level)
      || !["agent", "human"].includes(rule.source)) {
      throw new Error(`Mahiro Goal state entry ${key} has an invalid rule.`);
    }
  }
  for (const blocker of value.blockers) {
    if (!isRecord(blocker)
      || !isBoundedString(blocker.id, 120)
      || !isBoundedString(blocker.summary, MAX_TEXT_CHARS)
      || !["open", "resolved"].includes(blocker.status)
      || !isIsoTimestamp(blocker.createdAt)
      || (blocker.resolvedAt !== null && !isIsoTimestamp(blocker.resolvedAt))
      || (blocker.status === "open" && blocker.resolvedAt !== null)
      || (blocker.status === "resolved" && blocker.resolvedAt === null)) {
      throw new Error(`Mahiro Goal state entry ${key} has an invalid blocker.`);
    }
  }
  if (!hasUniqueIds(value.plan)) {
    throw new Error(`Mahiro Goal state entry ${key} contains duplicate plan item IDs.`);
  }
  for (const item of value.plan) {
    if (!isRecord(item)
      || !isBoundedString(item.id, 120)
      || !isBoundedString(item.text, MAX_CRITERION_CHARS)
      || !["pending", "in_progress", "done", "blocked"].includes(item.status)
      || (item.note !== null && !isBoundedString(item.note, MAX_TEXT_CHARS))
      || !isIsoTimestamp(item.updatedAt)) {
      throw new Error(`Mahiro Goal state entry ${key} has an invalid plan item.`);
    }
  }
  for (const history of value.history) {
    if (!isRecord(history)
      || !isIsoTimestamp(history.at)
      || !["agent", "human", "system"].includes(history.actor)
      || !isBoundedString(history.action, 120)
      || !isBoundedString(history.summary, 500)
      || !Number.isSafeInteger(history.revision)
      || history.revision < 1
      || history.revision > value.revision) {
      throw new Error(`Mahiro Goal state entry ${key} has invalid history.`);
    }
  }
  const expectedKey = JSON.stringify([
    value.agentId,
    value.conversationId,
    value.conversationId === "default" ? resolve(value.workspace) : "",
  ]);
  if (key !== expectedKey) {
    throw new Error(`Mahiro Goal state entry ${key} does not match its scoped identity.`);
  }
}

function readState(): WorkflowState {
  if (!existsSync(STATE_PATH)) return emptyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse Mahiro Goal state: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error("Mahiro Goal state must be a JSON object.");
  }
  const candidate = structuredClone(parsed) as Partial<WorkflowState>;
  if (candidate.schemaVersion !== SCHEMA_VERSION || !isRecord(candidate.goals)) {
    throw new Error(`Unsupported Mahiro Goal state schema. Expected ${SCHEMA_VERSION}.`);
  }
  for (const [key, goal] of Object.entries(candidate.goals)) {
    candidate.goals[key] = normalizeStoredGoal(goal) as WorkflowGoal;
    validateStoredGoal(key, candidate.goals[key]);
  }
  return candidate as WorkflowState;
}

function writeState(state: WorkflowState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const temporary = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  let fd: number | null = null;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporary, STATE_PATH);
    const directoryFd = openSync(dirname(STATE_PATH), "r");
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

function acquireStateLock(): LockHandle {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${randomUUID()}`;
  const candidatePath = `${LOCK_PATH}.candidate-${token}`;
  const candidateTokenPath = join(candidatePath, token);
  let fd: number | null = null;
  try {
    mkdirSync(candidatePath, { mode: 0o700 });
    fd = openSync(candidateTokenPath, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify({ token, pid: process.pid, createdAt: nowIso() })}\n`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const candidateDirectoryFd = openSync(candidatePath, "r");
    try {
      fsyncSync(candidateDirectoryFd);
    } finally {
      closeSync(candidateDirectoryFd);
    }
    renameSync(candidatePath, LOCK_PATH);
    return { token, tokenPath: join(LOCK_PATH, token) };
  } catch (error: any) {
    if (fd !== null) closeSync(fd);
    rmSync(candidatePath, { recursive: true, force: true });
    if (["EEXIST", "ENOTEMPTY", "EISDIR", "ENOTDIR"].includes(error?.code)) {
      throw new Error("Mahiro Goal state is busy in another Letta process. Retry, or use /mh-goal unlock --force only after confirming the owner is gone.");
    }
    throw error;
  }
}

function releaseStateLock(lock: LockHandle): void {
  rmSync(lock.tokenPath, { force: true });
  try {
    rmdirSync(LOCK_PATH);
  } catch (error: any) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
  }
}

function forceUnlock(): boolean {
  if (!existsSync(LOCK_PATH)) return false;
  const quarantine = `${LOCK_PATH}.abandoned-${Date.now()}-${randomUUID().slice(0, 8)}`;
  renameSync(LOCK_PATH, quarantine);
  rmSync(quarantine, { recursive: lstatSync(quarantine).isDirectory(), force: true });
  return true;
}

// Isolated repository smoke seam; normal packaged runtimes export null.
export const __testing = process.env.MAHIRO_GOAL_TESTING === "1"
  ? Object.freeze({ acquireStateLock, releaseStateLock, forceUnlock, lockPath: LOCK_PATH, disablePath: DISABLE_PATH })
  : null;

function withLockedState<T>(mutate: (state: WorkflowState) => T): T {
  const lock = acquireStateLock();
  try {
    const state = readState();
    const result = mutate(state);
    writeState(state);
    return result;
  } finally {
    releaseStateLock(lock);
  }
}

function historyEntry(revision: number, actor: Actor, action: string, summary: string): HistoryItem {
  return {
    at: nowIso(),
    actor,
    action,
    summary: compactText(summary, 500),
    revision,
  };
}

function mutateGoal(
  scope: Scope,
  actor: Actor,
  action: string,
  summary: string,
  expectedRevision: number | null,
  mutate: (goal: WorkflowGoal) => WorkflowGoal,
  options: { allowCompleted?: boolean } = {},
): WorkflowGoal {
  return withLockedState((state) => {
    const current = state.goals[scope.key];
    if (!current) throw new Error("No Mahiro Goal exists for this conversation.");
    if (current.status === "complete" && !options.allowCompleted) {
      throw new Error("This mission's current plan is complete. Use revise_mission to explicitly reopen it, or clear it.");
    }
    if (expectedRevision !== null && current.revision !== expectedRevision) {
      throw new Error(`Stale Mahiro Goal revision: expected ${expectedRevision}, current ${current.revision}. Read the goal again before updating.`);
    }
    const revision = current.revision + 1;
    const next = mutate(structuredClone(current));
    next.revision = revision;
    next.updatedAt = nowIso();
    next.history = [
      ...(Array.isArray(next.history) ? next.history : []),
      historyEntry(revision, actor, action, summary),
    ].slice(-MAX_HISTORY);
    state.goals[scope.key] = next;
    return structuredClone(next);
  });
}

function clearGoal(scope: Scope): boolean {
  return withLockedState((state) => {
    if (!state.goals[scope.key]) return false;
    delete state.goals[scope.key];
    return true;
  });
}

function clearGoalAtRevision(scope: Scope, expectedRevision: number): WorkflowGoal {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error("expected_revision must be the current positive mission revision.");
  }
  return withLockedState((state) => {
    const current = state.goals[scope.key];
    if (!current) throw new Error("No Mahiro Goal exists for this conversation.");
    if (current.revision !== expectedRevision) {
      throw new Error(`Stale Mahiro Goal revision: expected ${expectedRevision}, current ${current.revision}. Read the mission again before clearing.`);
    }
    delete state.goals[scope.key];
    return structuredClone(current);
  });
}

function getGoal(scope: Scope): WorkflowGoal | null {
  const goal = readState().goals[scope.key];
  return goal ? structuredClone(goal) : null;
}

function goalProgress(goal: WorkflowGoal) {
  const required = goal.criteria.filter((item) => item.required);
  const satisfied = required.filter((item) =>
    item.owner === "human"
      ? item.status === "verified"
      : item.status === "claimed" && item.evidence.length > 0,
  );
  const humanPending = required.filter((item) => item.owner === "human" && item.status !== "verified");
  const agentPending = required.filter((item) => item.owner === "agent" && (item.status !== "claimed" || item.evidence.length === 0));
  return { required, satisfied, humanPending, agentPending };
}

function goalStateLabel(goal: WorkflowGoal): string {
  const progress = goalProgress(goal);
  const openBlockers = goal.blockers.filter((item) => item.status === "open");
  if (goal.status === "complete") return "Current plan complete — all required DoD criteria passed the completion audit; revise the mission only when new work is chosen.";
  if (goal.status === "paused") return "Paused — wait for Mahiro to resume the goal.";
  if (goal.status === "blocked" || openBlockers.length) return "Blocked — resolve the recorded blocker before continuing.";
  if (progress.humanPending.length) return `Waiting for Mahiro — human gates: ${progress.humanPending.map((item) => item.id).join(", ")}.`;
  if (progress.agentPending.length) return `Agent work remaining — criteria: ${progress.agentPending.map((item) => item.id).join(", ")}.`;
  return "Checkpoint — agent criteria are claimed; the goal remains open until any required human gates pass.";
}

function formatGoalList(goals: WorkflowGoal[]): string {
  const remaining = goals.filter((goal) => goal.status !== "complete");
  if (!remaining.length) return "No Mahiro Goals need attention.";
  return [
    "Mahiro Goals needing attention · human-only inventory",
    ...remaining
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((goal) => `${goal.id} · ${goal.status} · plan ${goal.plan.filter((item) => item.status === "done").length}/${goal.plan.length} done · rev ${goal.revision} · ${goal.conversationId} · ${goal.updatedAt.slice(0, 10)} · ${compactText(goal.objective, 140)}`),
    "Completed current plans are intentionally hidden. Revise an existing mission when new work is chosen; clear only when the record itself should be removed.",
  ].join("\n");
}

function listGoals(agentId: string): WorkflowGoal[] {
  return Object.values(readState().goals)
    .filter((goal) => goal.agentId === agentId)
    .map((goal) => structuredClone(goal));
}

function clearGoalById(goalId: string, revision: number, agentId: string): WorkflowGoal {
  return withLockedState((state) => {
    const matches = Object.entries(state.goals).filter(([, goal]) => goal.id === goalId && goal.agentId === agentId);
    if (!matches.length) throw new Error(`No Mahiro Goal exists with id ${goalId} for this agent.`);
    if (matches.length > 1) throw new Error(`Mahiro Goal id ${goalId} is ambiguous; refusing to clear.`);
    const [key, current] = matches[0];
    if (!Number.isSafeInteger(revision) || revision !== current.revision) {
      throw new Error(`Clearing ${goalId} requires current revision ${current.revision}.`);
    }
    delete state.goals[key];
    return structuredClone(current);
  });
}

function moveGoalToScope(scope: Scope, currentWorkspace: string, goalId: string, expectedRevision: number, actor: Actor): WorkflowGoal {
  if (!goalId) throw new Error("goal_id is required when moving a Mahiro Goal.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error("expected_revision must be the current positive mission revision.");
  }
  return withLockedState((state) => {
    const matches = Object.entries(state.goals).filter(([, goal]) => goal.id === goalId);
    if (!matches.length) throw new Error(`No Mahiro Goal exists with id ${goalId}.`);
    if (matches.length > 1) throw new Error(`Mahiro Goal id ${goalId} is ambiguous; refusing to move.`);
    const [sourceKey, current] = matches[0];
    if (sourceKey === scope.key) throw new Error(`${goalId} is already attached to this conversation.`);
    if (current.agentId !== scope.agentId) {
      throw new Error("Mahiro Goals may move only between conversations owned by the same agent.");
    }
    if (current.revision !== expectedRevision) {
      throw new Error(`Stale Mahiro Goal revision: expected ${expectedRevision}, current ${current.revision}. Read the mission again before moving it.`);
    }
    if (state.goals[scope.key]) {
      throw new Error("The destination conversation already has a Mahiro Goal. Clear or finish that record before moving another goal here.");
    }
    if (scope.conversationId === "default" && resolve(current.workspace) !== resolve(currentWorkspace)) {
      throw new Error("A raw default conversation may move a Mahiro Goal only within its exact workspace lane.");
    }
    const revision = current.revision + 1;
    const moved = structuredClone(current);
    const sourceConversationId = moved.conversationId;
    moved.conversationId = scope.conversationId;
    moved.revision = revision;
    moved.updatedAt = nowIso();
    moved.history = [
      ...moved.history,
      historyEntry(revision, actor, "goal_moved", `Moved from conversation ${sourceConversationId} to ${scope.conversationId}.`),
    ].slice(-MAX_HISTORY);
    validateStoredGoal(scope.key, moved);
    delete state.goals[sourceKey];
    state.goals[scope.key] = moved;
    return structuredClone(moved);
  });
}

function validateObjective(value: unknown): string {
  const objective = String(value ?? "").trim();
  if (!objective) throw new Error("Goal objective must not be empty.");
  if (objective.length > MAX_OBJECTIVE_CHARS) {
    throw new Error(`Goal objective exceeds ${MAX_OBJECTIVE_CHARS} characters.`);
  }
  return objective;
}

function validateGoalIdInput(value: unknown): string {
  const goalId = String(value ?? "").trim();
  if (!goalId) throw new Error("goal_id is required when moving a Mahiro Goal.");
  if (goalId.length > 160) throw new Error("goal_id exceeds 160 characters.");
  return goalId;
}

function normalizeCriteria(input: CriterionInput[]): Criterion[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("At least one Definition of Done criterion is required.");
  }
  if (input.length > MAX_CRITERIA) throw new Error(`At most ${MAX_CRITERIA} criteria are allowed.`);
  const timestamp = nowIso();
  return input.map((item, index) => {
    const text = String(item?.text ?? "").trim();
    if (!text) throw new Error(`Criterion ${index + 1} must not be empty.`);
    if (text.length > MAX_CRITERION_CHARS) {
      throw new Error(`Criterion ${index + 1} exceeds ${MAX_CRITERION_CHARS} characters.`);
    }
    const owner = item.owner ?? "agent";
    if (owner !== "agent" && owner !== "human") {
      throw new Error(`Criterion ${index + 1} owner must be agent or human.`);
    }
    return {
      id: `criterion-${String(index + 1).padStart(2, "0")}`,
      text,
      owner,
      required: item.required !== false,
      status: "pending",
      evidence: [],
      note: null,
      updatedAt: timestamp,
    };
  });
}

function normalizeNonGoals(input: unknown): string[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("non_goals must be an array of strings.");
  if (input.length > MAX_NON_GOALS) throw new Error(`At most ${MAX_NON_GOALS} non-goals are allowed.`);
  return input.map((item, index) => {
    const text = compactText(item, MAX_CRITERION_CHARS);
    if (!text) throw new Error(`Non-goal ${index + 1} must not be empty.`);
    return text;
  });
}

function normalizeRules(input: unknown, source: RuleSource, reservedIds: Iterable<string> = []): GoalRule[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("rules must be an array.");
  if (input.length > MAX_RULES) throw new Error(`At most ${MAX_RULES} goal rules are allowed.`);
  const usedIds = new Set(reservedIds);
  return input.map((item, index) => {
    if (!isRecord(item) || Object.keys(item).some((field) => !["text", "level"].includes(field))) {
      throw new Error(`Rule ${index + 1} contains unsupported fields.`);
    }
    const text = String(item.text ?? "").trim();
    if (!text) throw new Error(`Rule ${index + 1} must not be empty.`);
    if (text.length > MAX_RULE_CHARS) throw new Error(`Rule ${index + 1} exceeds ${MAX_RULE_CHARS} characters.`);
    const level = item.level ?? "prefer";
    if (level !== "must" && level !== "prefer") {
      throw new Error(`Rule ${index + 1} level must be must or prefer.`);
    }
    let id = "";
    do id = `rule-${randomUUID().slice(0, 8)}`;
    while (usedIds.has(id));
    usedIds.add(id);
    return {
      id,
      text,
      level,
      source,
    };
  });
}

function createGoal(scope: Scope, workspace: string, input: GoalCreateInput, actor: Actor): WorkflowGoal {
  const objective = validateObjective(input.objective);
  const criteria = normalizeCriteria(input.criteria);
  const nonGoals = normalizeNonGoals(input.nonGoals);
  const rules = normalizeRules(input.rules, actor === "human" ? "human" : "agent");
  const nextAction = input.nextAction == null ? null : compactText(input.nextAction);
  if (input.nextAction != null && !nextAction) throw new Error("next_action must not be empty when provided.");
  const timestamp = nowIso();
  return withLockedState((state) => {
    const existing = state.goals[scope.key];
    if (existing && input.replace !== true) {
      throw new Error("A Mahiro Goal already exists. Revise the living mission or explicitly replace its current plan first.");
    }
    if (input.replace === true) {
      if (!existing) throw new Error("Cannot replace a Mahiro Goal that does not exist.");
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== existing.revision) {
        throw new Error(`Replacing a Mahiro Goal requires expected_revision ${existing.revision}.`);
      }
    }
    if (existing) {
      const revised = structuredClone(existing);
      const revision = existing.revision + 1;
      revised.objective = objective;
      revised.criteria = criteria;
      revised.nonGoals = nonGoals;
      revised.rules = rules;
      revised.nextAction = nextAction;
      revised.phase = "planning";
      revised.blockers = [];
      revised.plan = [];
      revised.status = "active";
      startClock(revised);
      revised.revision = revision;
      revised.updatedAt = timestamp;
      revised.history = [
        ...revised.history,
        historyEntry(revision, actor, "mission_revised", "Mission and current plan revised explicitly."),
      ].slice(-MAX_HISTORY);
      state.goals[scope.key] = revised;
      return structuredClone(revised);
    }
    const goal: WorkflowGoal = {
      id: `mh-goal-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      revision: 1,
      objective,
      status: "active",
      phase: "execution",
      nextAction,
      criteria,
      nonGoals,
      rules,
      blockers: [],
      plan: [],
      workspace,
      agentId: scope.agentId,
      conversationId: scope.conversationId,
      activeTimeSeconds: 0,
      activeStartedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [historyEntry(1, actor, input.replace ? "goal_replaced" : "goal_created", objective)],
    };
    state.goals[scope.key] = goal;
    return structuredClone(goal);
  });
}

function liveElapsedSeconds(goal: WorkflowGoal): number {
  if (goal.status !== "active" || !goal.activeStartedAt) return goal.activeTimeSeconds;
  const startedAt = Date.parse(goal.activeStartedAt);
  const live = Number.isNaN(startedAt) ? 0 : Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return goal.activeTimeSeconds + live;
}

function stopClock(goal: WorkflowGoal): WorkflowGoal {
  if (!goal.activeStartedAt) return goal;
  const startedAt = Date.parse(goal.activeStartedAt);
  const elapsed = Number.isNaN(startedAt) ? 0 : Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  goal.activeTimeSeconds += elapsed;
  goal.activeStartedAt = null;
  return goal;
}

function startClock(goal: WorkflowGoal): WorkflowGoal {
  goal.activeStartedAt ??= nowIso();
  return goal;
}

function criterionById(goal: WorkflowGoal, id: unknown): Criterion {
  const criterion = goal.criteria.find((item) => item.id === String(id ?? ""));
  if (!criterion) throw new Error(`Unknown criterion: ${String(id ?? "<missing>")}`);
  return criterion;
}

function blockerById(goal: WorkflowGoal, id: unknown): Blocker {
  const blocker = goal.blockers.find((item) => item.id === String(id ?? ""));
  if (!blocker) throw new Error(`Unknown blocker: ${String(id ?? "<missing>")}`);
  return blocker;
}

function planItemById(goal: WorkflowGoal, id: unknown): PlanItem {
  const item = goal.plan.find((candidate) => candidate.id === String(id ?? ""));
  if (!item) throw new Error(`Unknown plan item: ${String(id ?? "<missing>")}`);
  return item;
}

function ruleById(goal: WorkflowGoal, id: unknown): GoalRule {
  const rule = goal.rules.find((item) => item.id === String(id ?? ""));
  if (!rule) throw new Error(`Unknown goal rule: ${String(id ?? "<missing>")}`);
  return rule;
}

function addRule(goal: WorkflowGoal, args: any, source: RuleSource): WorkflowGoal {
  if (goal.rules.length >= MAX_RULES) throw new Error(`A mission may contain at most ${MAX_RULES} goal rules.`);
  const [rule] = normalizeRules([{ text: args.rule_text, level: args.rule_level }], source, goal.rules.map((item) => item.id));
  goal.rules.push(rule);
  return goal;
}

function updateRule(goal: WorkflowGoal, args: any): WorkflowGoal {
  const rule = ruleById(goal, args.rule_id);
  if (!Object.hasOwn(args, "rule_text") && !Object.hasOwn(args, "rule_level")) {
    throw new Error("update_rule needs rule_text, rule_level, or both.");
  }
  if (Object.hasOwn(args, "rule_text")) {
    const text = String(args.rule_text ?? "").trim();
    if (!text) throw new Error("rule_text must not be empty.");
    if (text.length > MAX_RULE_CHARS) throw new Error(`rule_text exceeds ${MAX_RULE_CHARS} characters.`);
    rule.text = text;
  }
  if (Object.hasOwn(args, "rule_level")) {
    if (args.rule_level !== "must" && args.rule_level !== "prefer") {
      throw new Error("rule_level must be must or prefer.");
    }
    rule.level = args.rule_level;
  }
  return goal;
}

function reviseMission(goal: WorkflowGoal, args: any, actor: Actor): WorkflowGoal {
  const editable = ["objective", "criteria", "non_goals", "rules", "phase", "next_action"];
  if (!editable.some((field) => Object.hasOwn(args, field))) {
    throw new Error("revise_mission needs at least one of objective, criteria, non_goals, rules, phase, or next_action.");
  }
  if (Object.hasOwn(args, "objective")) goal.objective = validateObjective(args.objective);
  if (Object.hasOwn(args, "criteria")) goal.criteria = normalizeCriteria(args.criteria);
  if (Object.hasOwn(args, "non_goals")) goal.nonGoals = normalizeNonGoals(args.non_goals);
  if (Object.hasOwn(args, "rules")) goal.rules = normalizeRules(args.rules, actor === "human" ? "human" : "agent");
  if (Object.hasOwn(args, "phase")) {
    const phase = compactText(args.phase, 120);
    if (!phase) throw new Error("phase must not be empty when revising a mission.");
    goal.phase = phase;
  }
  if (Object.hasOwn(args, "next_action")) {
    const nextAction = compactText(args.next_action);
    if (!nextAction) throw new Error("next_action must not be empty when revising a mission.");
    goal.nextAction = nextAction;
  }
  if (goal.status === "complete" || goal.status === "paused") {
    goal.status = "active";
    startClock(goal);
  }
  return goal;
}

function addPlanItem(goal: WorkflowGoal, args: any): WorkflowGoal {
  if (goal.plan.length >= MAX_PLAN_ITEMS) throw new Error(`A mission may contain at most ${MAX_PLAN_ITEMS} plan items.`);
  const text = compactText(args.plan_text, MAX_CRITERION_CHARS);
  if (!text) throw new Error("plan_text is required when adding a plan item.");
  const status = String(args.plan_status ?? "pending") as PlanItemStatus;
  if (!["pending", "in_progress", "done", "blocked"].includes(status)) {
    throw new Error(`Unsupported plan status: ${status}`);
  }
  const note = args.plan_note == null ? null : compactText(args.plan_note);
  if (args.plan_note != null && !note) throw new Error("plan_note must not be empty when provided.");
  goal.plan.push({
    id: `plan-${randomUUID().slice(0, 8)}`,
    text,
    status,
    note,
    updatedAt: nowIso(),
  });
  return goal;
}

function updatePlanItem(goal: WorkflowGoal, args: any): WorkflowGoal {
  const item = planItemById(goal, args.plan_id);
  if (!["plan_text", "plan_status", "plan_note", "clear_plan_note"].some((field) => Object.hasOwn(args, field))) {
    throw new Error("update_plan_item needs plan_text, plan_status, plan_note, or clear_plan_note.");
  }
  if (Object.hasOwn(args, "plan_text")) {
    const text = compactText(args.plan_text, MAX_CRITERION_CHARS);
    if (!text) throw new Error("plan_text must not be empty when updating a plan item.");
    item.text = text;
  }
  if (Object.hasOwn(args, "plan_status")) {
    const status = String(args.plan_status) as PlanItemStatus;
    if (!["pending", "in_progress", "done", "blocked"].includes(status)) {
      throw new Error(`Unsupported plan status: ${status}`);
    }
    item.status = status;
  }
  if (Object.hasOwn(args, "plan_note")) {
    const note = compactText(args.plan_note);
    if (!note) throw new Error("plan_note must not be empty when updating a plan item.");
    item.note = note;
  }
  if (args.clear_plan_note === true) item.note = null;
  item.updatedAt = nowIso();
  return goal;
}

function completionIssues(goal: WorkflowGoal): string[] {
  const issues: string[] = [];
  const openBlockers = goal.blockers.filter((item) => item.status === "open");
  if (openBlockers.length) issues.push(`open blockers: ${openBlockers.map((item) => item.id).join(", ")}`);
  for (const criterion of goal.criteria.filter((item) => item.required)) {
    if (criterion.status === "blocked") {
      issues.push(`${criterion.id} is blocked`);
      continue;
    }
    if (criterion.owner === "human" && criterion.status !== "verified") {
      issues.push(`${criterion.id} requires human verification`);
      continue;
    }
    if (criterion.owner === "agent" && (criterion.status !== "claimed" || criterion.evidence.length === 0)) {
      issues.push(`${criterion.id} has not been claimed with evidence`);
    }
  }
  return issues;
}

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes}m ${safe % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function criterionMark(status: CriterionStatus): string {
  if (status === "verified") return "🟢 ✓";
  if (status === "claimed") return "🟢 ◉";
  if (status === "blocked") return "🔴 !";
  return "⚪";
}

function planMark(status: PlanItemStatus): string {
  if (status === "done") return "🟢 ✓";
  if (status === "in_progress") return "🔵 ◉";
  if (status === "blocked") return "🔴 !";
  return "⚪";
}

function ruleMark(level: RuleLevel): string {
  return level === "must" ? "◆" : "◇";
}

function evidenceLabel(count: number): string {
  return `${count} evidence item${count === 1 ? "" : "s"}`;
}

function criterionOwnerMark(owner: CriterionOwner): string {
  return owner === "human" ? "🟣" : "🔵";
}

function criterionRequirementMark(required: boolean): string {
  return required ? "🟠" : "⚪";
}

function panelColor(chalk: any, hex: string, text: string): string {
  const painter = chalk?.hex?.(hex);
  return typeof painter === "function" ? painter(text) : text;
}

function panelDim(chalk: any, text: string): string {
  return typeof chalk?.dim === "function" ? chalk.dim(text) : text;
}

function goalStatusColor(goal: WorkflowGoal): string {
  if (goal.status === "complete") return GOAL_COLORS.complete;
  if (goal.status === "blocked") return GOAL_COLORS.blocked;
  if (goal.status === "paused") return GOAL_COLORS.attention;
  return GOAL_COLORS.active;
}

function goalStateColor(goal: WorkflowGoal): string {
  if (goal.status === "complete") return GOAL_COLORS.complete;
  if (goal.status === "blocked" || goal.blockers.some((item) => item.status === "open")) return GOAL_COLORS.blocked;
  if (goal.status === "paused" || goalProgress(goal).humanPending.length) return GOAL_COLORS.attention;
  return GOAL_COLORS.active;
}

function goalStateMark(goal: WorkflowGoal): string {
  if (goal.status === "complete") return "🟢";
  if (goal.status === "blocked" || goal.blockers.some((item) => item.status === "open")) return "🔴";
  if (goal.status === "paused" || goalProgress(goal).humanPending.length) return "🟡";
  return "🔵";
}

function goalProgressMark(goal: WorkflowGoal): string {
  const progress = goalProgress(goal);
  if (progress.required.some((item) => item.status === "blocked")) return "🔴";
  if (progress.satisfied.length === progress.required.length) return "🟢";
  if (progress.humanPending.length) return "🟡";
  return "🔵";
}

function planProgressMark(goal: WorkflowGoal): string {
  if (!goal.plan.length) return "⚪";
  if (goal.plan.some((item) => item.status === "blocked")) return "🔴";
  if (goal.plan.every((item) => item.status === "done")) return "🟢";
  if (goal.plan.some((item) => item.status === "in_progress")) return "🔵";
  return "⚪";
}

function formatGoal(goal: WorkflowGoal): string {
  const progress = goalProgress(goal);
  const mustRules = goal.rules.filter((item) => item.level === "must").length;
  const preferRules = goal.rules.length - mustRules;
  const criteria = goal.criteria.flatMap((item) => [
    `  ${criterionMark(item.status)} ${markdownAccent(item.id)} · ${criterionOwnerMark(item.owner)} ${displayFieldText(item.owner.toUpperCase())} · ${criterionRequirementMark(item.required)} ${item.required ? "REQUIRED" : "OPTIONAL"} · **${displayFieldText(item.status.toUpperCase())}** · 📎 ${displayFieldText(evidenceLabel(item.evidence.length))}`,
    `    ${displayFieldText(item.text)}`,
    ...(item.note ? [`    Note: ${displayFieldText(item.note)}`] : []),
  ]);
  const blockers = goal.blockers.filter((item) => item.status === "open");
  const planDone = goal.plan.filter((item) => item.status === "done").length;
  const plan = goal.plan.flatMap((item) => [
    `  ${planMark(item.status)} ${markdownAccent(item.id)} · **${displayFieldText(item.status.toUpperCase())}**`,
    `    ${displayFieldText(item.text)}`,
    ...(item.note ? [`    Note: ${displayFieldText(item.note)}`] : []),
  ]);
  const rules = goal.rules.flatMap((item) => [
    `  ${ruleMark(item.level)} **${displayFieldText(item.level.toUpperCase())}** ${markdownAccent(item.id)} · SOURCE ${displayFieldText(item.source.toUpperCase())}`,
    `    ${displayFieldText(item.text)}`,
  ]);
  return [
    `# Mahiro Goal · ${displayFieldText(goal.status.toUpperCase())}`,
    "",
    "## Mission",
    `  ${displayFieldText(goal.objective)}`,
    "",
    "## Current",
    `  ${markdownAccent("State")}  ${goalStateMark(goal)} ${displayFieldText(goalStateLabel(goal))}`,
    `  ${markdownAccent("Phase")}  ${displayFieldText(goal.phase)}`,
    `  ${markdownAccent("Next")}   ${displayFieldText(goal.nextAction ?? "Not set")}`,
    "",
    "## Progress",
    `  ${markdownAccent("DoD")}       ${goalProgressMark(goal)} ${displayFieldText(`${progress.satisfied.length}/${progress.required.length}`)} required satisfied`,
    `  ${markdownAccent("Plan")}      ${planProgressMark(goal)} ${displayFieldText(`${planDone}/${goal.plan.length}`)} items done`,
    `  ${markdownAccent("Rules")}     ${displayFieldText(`${mustRules} must · ${preferRules} prefer`)}`,
    `  ${markdownAccent("Blockers")}  ${blockers.length ? "🔴" : "🟢"} ${displayFieldText(blockers.length)} open`,
    "",
    "## Goal Rules",
    ...(rules.length ? rules : ["  — None"]),
    "",
    "## Definition of Done",
    ...criteria,
    "",
    "## Plan",
    ...(plan.length ? plan : ["  ⚪ — No plan items yet"]),
    "",
    "## Blockers",
    ...(blockers.length ? blockers.flatMap((item) => [`  🔴 ! ${markdownAccent(item.id)}`, `    ${displayFieldText(item.summary)}`]) : ["  🟢 ✓ None open"]),
    "",
    "## Details",
    `  ${markdownAccent("Active time")}  ${displayFieldText(formatElapsed(liveElapsedSeconds(goal)))}`,
    `  ${markdownAccent("Revision")}     ${displayFieldText(goal.revision)}`,
    `  ${markdownAccent("Workspace")}    ${displayFieldText(goal.workspace)}`,
    `  ${markdownAccent("Conversation")} ${displayFieldText(goal.conversationId)}`,
    `  ${markdownAccent("Goal ID")}      ${displayFieldText(goal.id)}`,
  ].join("\n");
}

function compactStatusPanel(goal: WorkflowGoal | null, chalk?: any): string[] {
  if (!goal) return [
    panelColor(chalk, GOAL_COLORS.section, "Mahiro Goal"),
    panelDim(chalk, "No goal is set for this conversation."),
  ];
  const progress = goalProgress(goal);
  const blockers = goal.blockers.filter((item) => item.status === "open").length;
  const planDone = goal.plan.filter((item) => item.status === "done").length;
  const visibleRules = goal.rules.slice(0, 3);
  const section = (text: string) => panelColor(chalk, GOAL_COLORS.section, text);
  const progressColor = progress.satisfied.length === progress.required.length
    ? GOAL_COLORS.complete
    : GOAL_COLORS.active;
  const blockerColor = blockers ? GOAL_COLORS.blocked : GOAL_COLORS.complete;
  return [
    `${panelColor(chalk, goalStatusColor(goal), displayFieldText(`Mahiro Goal · ${goal.status.toUpperCase()}`))} ${panelDim(chalk, displayFieldText(`· rev ${goal.revision}`))}`,
    section("MISSION"),
    `  ${compactText(displayFieldText(goal.objective), 100)}`,
    section("PROGRESS"),
    `  DoD ${panelColor(chalk, progressColor, displayFieldText(`${progress.satisfied.length}/${progress.required.length}`))} · Plan ${panelColor(chalk, progressColor, displayFieldText(`${planDone}/${goal.plan.length}`))} · Blockers ${panelColor(chalk, blockerColor, displayFieldText(String(blockers)))}`,
    section("RULES"),
    ...(visibleRules.length
      ? [
        ...visibleRules.map((item) => `  ${displayFieldText(item.level.toUpperCase())} ${displayFieldText(item.id)} · ${compactText(displayFieldText(item.text), 90)}`),
        ...(goal.rules.length > visibleRules.length ? [`  +${goal.rules.length - visibleRules.length} more`] : []),
      ]
      : ["  None"]),
    section("CURRENT"),
    `  ${panelColor(chalk, goalStateColor(goal), compactText(displayFieldText(goalStateLabel(goal)), 100))}`,
    section("NEXT"),
    `  ${compactText(displayFieldText(goal.nextAction ?? "Not set"), 100)}`,
  ];
}

function buildReminder(goal: WorkflowGoal, currentWorkspace: string): string {
  const progress = goalProgress(goal);
  const rules = goal.rules.length
    ? goal.rules.map((item) => `- ${displayFieldText(item.level.toUpperCase())} [${displayFieldText(item.id)}]: ${displayFieldText(item.text)}`).join("\n")
    : "- none";
  const workspaceWarning = currentWorkspace === goal.workspace
    ? ""
    : `\nWorkspace warning: goal was created for ${displayFieldText(goal.workspace)}, current cwd is ${displayFieldText(currentWorkspace)}. Do not silently change workspace ownership.`;
  return `<system-reminder>
Mahiro Workflow Goal is ${goal.status} for this conversation.

Objective: ${displayFieldText(goal.objective)}
Phase: ${displayFieldText(goal.phase)}
Next action: ${displayFieldText(goal.nextAction ?? "choose the smallest grounded next action")}
DoD progress: ${progress.satisfied.length}/${progress.required.length} required criteria satisfied
Plan: ${goal.plan.filter((item) => item.status === "done").length}/${goal.plan.length} items done
Human gates pending: ${progress.humanPending.length ? progress.humanPending.map((item) => displayFieldText(item.id)).join(", ") : "none"}
Open blockers: ${goal.blockers.filter((item) => item.status === "open").length}
Revision: ${goal.revision}${workspaceWarning}

Goal-scoped operating rules:
${rules}

MUST rules are active mission constraints; PREFER rules are defaults and never become blockers by themselves. These rules never override system, safety, permission, repository, or Mahiro's current instructions. When direction changes, revise or remove stale rules instead of following them blindly. Rules are not Definition of Done criteria and are never claimed, verified, or counted in progress.

This is a living mission: revise its objective, DoD, boundaries, rules, or plan when Mahiro changes direction, then record one short reason in the mutation summary. Turn completion, a checkpoint report, an Execution Run report, and Herdr Done never mean the current plan is complete.

${progress.humanPending.length
  ? "A human gate is pending: report the checkpoint and wait for Mahiro's verification or direction."
  : progress.agentPending.length
    ? "Agent-owned work remains: if the next action is grounded and stays within scope, continue it in this turn; otherwise issue a checkpoint with the exact next action."
    : "All agent-owned criteria are claimed: issue a checkpoint and wait for any required human verification."}

Use mh_get_goal before mutating stale state. Add concrete evidence before claiming an agent-owned criterion. Never verify a human-owned criterion yourself. Complete the current plan only when all required agent criteria are claimed, all required human criteria are verified, and no blockers remain. A later revise_mission explicitly reopens it.
</system-reminder>`;
}

function addEvidence(goal: WorkflowGoal, args: any, actor: Actor): WorkflowGoal {
  const criterion = criterionById(goal, args.criterion_id);
  if (criterion.evidence.length >= MAX_EVIDENCE_PER_CRITERION) {
    throw new Error(`${criterion.id} already has the maximum evidence entries.`);
  }
  const summary = compactText(args.summary);
  if (!summary) throw new Error("Evidence summary must not be empty.");
  const allowedKinds = new Set<EvidenceKind>(["file", "command", "test", "browser", "native", "manual", "user", "other"]);
  const kind = String(args.kind ?? "other") as EvidenceKind;
  if (!allowedKinds.has(kind)) throw new Error(`Unsupported evidence kind: ${kind}`);
  const reference = args.reference == null ? null : compactText(args.reference);
  if (args.reference != null && !reference) throw new Error("Evidence reference must not be empty when provided.");
  criterion.evidence.push({
    id: `evidence-${randomUUID().slice(0, 8)}`,
    kind,
    summary,
    reference,
    actor,
    createdAt: nowIso(),
  });
  criterion.updatedAt = nowIso();
  return goal;
}

function updateGoalFromTool(scope: Scope, currentWorkspace: string, args: any): WorkflowGoal {
  const action = String(args.action ?? "");
  const expectedRevision = Number(args.expected_revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error("expected_revision must be the current positive goal revision.");
  }
  if (action === "move_goal") {
    return moveGoalToScope(scope, currentWorkspace, validateGoalIdInput(args.goal_id), expectedRevision, "agent");
  }
  return mutateGoal(scope, "agent", action, args.summary ?? action, expectedRevision, (goal) => {
    if (action === "revise_mission") return reviseMission(goal, args, "agent");
    if (action === "set_phase") {
      const phase = compactText(args.phase, 120);
      if (!phase) throw new Error("phase is required for set_phase.");
      goal.phase = phase;
      return goal;
    }
    if (action === "set_next") {
      const nextAction = compactText(args.next_action);
      if (!nextAction) throw new Error("next_action is required for set_next.");
      goal.nextAction = nextAction;
      return goal;
    }
    if (action === "add_plan_item") return addPlanItem(goal, args);
    if (action === "update_plan_item") return updatePlanItem(goal, args);
    if (action === "remove_plan_item") {
      const item = planItemById(goal, args.plan_id);
      goal.plan = goal.plan.filter((candidate) => candidate.id !== item.id);
      return goal;
    }
    if (action === "add_rule") return addRule(goal, args, "agent");
    if (action === "update_rule") return updateRule(goal, args);
    if (action === "remove_rule") {
      const rule = ruleById(goal, args.rule_id);
      goal.rules = goal.rules.filter((candidate) => candidate.id !== rule.id);
      return goal;
    }
    if (action === "add_evidence") return addEvidence(goal, args, "agent");
    if (action === "claim_criterion") {
      const criterion = criterionById(goal, args.criterion_id);
      if (criterion.owner !== "agent") throw new Error(`${criterion.id} is human-owned and cannot be claimed by the agent.`);
      if (criterion.evidence.length === 0) throw new Error(`${criterion.id} needs concrete evidence before it can be claimed.`);
      criterion.status = "claimed";
      if (args.summary != null) {
        const note = compactText(args.summary);
        if (!note) throw new Error("Claim summary must not be empty when provided.");
        criterion.note = note;
      }
      criterion.updatedAt = nowIso();
      return goal;
    }
    if (action === "block_criterion") {
      const criterion = criterionById(goal, args.criterion_id);
      criterion.status = "blocked";
      criterion.note = compactText(args.summary || "Blocked");
      criterion.updatedAt = nowIso();
      goal.status = "blocked";
      stopClock(goal);
      return goal;
    }
    if (action === "add_blocker" || action === "mark_blocked") {
      if (goal.blockers.length >= MAX_BLOCKERS) throw new Error("Goal already has the maximum blocker entries.");
      const summary = compactText(args.summary);
      if (!summary) throw new Error("summary is required when adding a blocker.");
      goal.blockers.push({
        id: `blocker-${randomUUID().slice(0, 8)}`,
        summary,
        status: "open",
        createdAt: nowIso(),
        resolvedAt: null,
      });
      if (action === "mark_blocked") {
        goal.status = "blocked";
        stopClock(goal);
      }
      return goal;
    }
    if (action === "resolve_blocker") {
      const blocker = blockerById(goal, args.blocker_id);
      blocker.status = "resolved";
      blocker.resolvedAt = nowIso();
      return goal;
    }
    if (action === "complete") {
      const issues = completionIssues(goal);
      if (issues.length) throw new Error(`Goal cannot complete: ${issues.join("; ")}.`);
      goal.status = "complete";
      goal.nextAction = null;
      stopClock(goal);
      return goal;
    }
    throw new Error(`Unsupported Mahiro Goal action: ${action}`);
  }, { allowCompleted: action === "revise_mission" });
}

function commandOutput(output: string, success = true) {
  return { type: "output" as const, output, success };
}

function jsonResult(payload: unknown) {
  return { status: "success", output: JSON.stringify(payload, null, 2) };
}

function parseCreateArgs(input: string): { objective: string } {
  return { objective: input.trim().replace(/^["']|["']$/g, "").trim() };
}

function simpleCriterion(objective: string): CriterionInput {
  return {
    owner: "agent",
    required: true,
    text: `The objective is complete and audited against concrete repository/runtime evidence: ${compactText(objective, 500)}`,
  };
}

function helpText(): string {
  return [
    "Mahiro Goal — living mission, bounded rules, and mutable plan",
    "",
    "Commands:",
    "  /mh-goal <objective>                     Create a simple goal",
    "  /mh-goal revise <revision> <objective>   Revise the mission and reset its current plan",
    "  /mh-goal replace <revision> <objective>  Legacy alias for revise",
    "  /mh-goal status                          Show objective, DoD, evidence state, and blockers",
    "  /mh-goal list                            List bounded Goal records across this agent (human-only)",
    "  /mh-goal move <goal-id> <revision>       Move one same-agent Goal into this empty conversation",
    "  /mh-goal pause | resume                  Control active reminders/time",
    "  /mh-goal next <action>                   Set the immediate next action",
    "  /mh-goal phase <name>                    Set the current workflow phase",
    "  /mh-goal evidence <criterion-id> <text>  Add human-provided evidence",
    "  /mh-goal verify <criterion-id> [note]    Verify a criterion as the human owner",
    "  /mh-goal resolve <blocker-id>            Resolve a blocker",
    "  /mh-goal rule add <revision> <must|prefer> <text>",
    "  /mh-goal rule update <revision> <rule-id> <must|prefer> <text>",
    "  /mh-goal rule remove <revision> <rule-id>",
    "  /mh-goal complete [--force]              Complete the current plan after DoD audit; --force is explicit human override",
    "  /mh-goal clear                           Remove this conversation's Mahiro Goal",
    "  /mh-goal clear <goal-id> <revision>      Revision-guarded cross-scope clear (human-only)",
    "  /mh-goal unlock --force                  Explicitly remove an abandoned mutation lock",
    "",
    "/mh-goal and mh_* tools are the Goal surfaces for this bundle.",
  ].join("\n");
}

function runCommand(ctx: any) {
  const input = String(ctx?.args ?? "").trim();
  const normalized = input.toLowerCase();

  try {
    const scope = scopeFrom(ctx);
    const workspace = workspaceFrom(ctx);
    if (!input || normalized === "status" || normalized === "show") {
      const goal = getGoal(scope);
      return commandOutput(goal ? formatGoal(goal) : "# Mahiro Goal\n\n_No goal is set for this conversation._");
    }
    if (["help", "-h", "--help"].includes(normalized)) return commandOutput(helpText());
    if (normalized === "unlock --force") {
      return commandOutput(forceUnlock() ? "Mahiro Goal mutation lock quarantined and removed by explicit human override." : "No Mahiro Goal mutation lock exists.");
    }
    if (normalized === "unlock") return commandOutput("Use /mh-goal unlock --force only after confirming no live mutation owns the lock.", false);
    if (normalized === "list") return commandOutput(formatGoalList(listGoals(scope.agentId)));
    const moveMatch = input.match(/^move\s+(\S+)\s+(\d+)$/i);
    if (normalized.startsWith("move ") && !moveMatch) {
      return commandOutput("Usage: /mh-goal move <goal-id> <revision>", false);
    }
    if (moveMatch) {
      const moved = moveGoalToScope(scope, workspace, validateGoalIdInput(moveMatch[1]), Number(moveMatch[2]), "human");
      return commandOutput(formatGoal(moved));
    }
    const crossScopeClear = input.match(/^clear\s+(\S+)\s+(\d+)$/i);
    if (crossScopeClear) {
      const cleared = clearGoalById(compactText(crossScopeClear[1], 160), Number(crossScopeClear[2]), scope.agentId);
      return commandOutput(`Mahiro Goal cleared: ${cleared.id} · ${cleared.conversationId} · revision ${cleared.revision}.`);
    }
    if (normalized === "clear") {
      return commandOutput(clearGoal(scope) ? "Mahiro Goal cleared." : "No Mahiro Goal was set.");
    }
    if (normalized === "pause") {
      const goal = mutateGoal(scope, "human", "goal_paused", "Paused by Mahiro.", null, (current) => {
        stopClock(current);
        current.status = "paused";
        return current;
      });
      return commandOutput(formatGoal(goal));
    }
    if (normalized === "resume") {
      const goal = mutateGoal(scope, "human", "goal_resumed", "Resumed by Mahiro.", null, (current) => {
        const unresolved = current.blockers.filter((item) => item.status === "open");
        const blockedCriteria = current.criteria.filter((item) => item.status === "blocked");
        if (unresolved.length || blockedCriteria.length) {
          throw new Error("Resolve open blockers and blocked criteria before resuming the goal.");
        }
        current.status = "active";
        startClock(current);
        return current;
      });
      return commandOutput(formatGoal(goal));
    }
    if (normalized.startsWith("next ")) {
      const nextAction = compactText(input.slice(5));
      if (!nextAction) return commandOutput("Next action must not be empty.", false);
      const goal = mutateGoal(scope, "human", "next_set", nextAction, null, (current) => {
        current.nextAction = nextAction;
        return current;
      });
      return commandOutput(formatGoal(goal));
    }
    if (normalized.startsWith("phase ")) {
      const phase = compactText(input.slice(6), 120);
      if (!phase) return commandOutput("Phase must not be empty.", false);
      const goal = mutateGoal(scope, "human", "phase_set", phase, null, (current) => {
        current.phase = phase;
        return current;
      });
      return commandOutput(formatGoal(goal));
    }
    if (normalized.startsWith("evidence ")) {
      const match = input.match(/^evidence\s+(\S+)\s+([\s\S]+)$/i);
      if (!match) return commandOutput("Usage: /mh-goal evidence <criterion-id> <summary>", false);
      const goal = mutateGoal(scope, "human", "evidence_added", match[2], null, (current) =>
        addEvidence(current, { criterion_id: match[1], summary: match[2], kind: "user" }, "human"));
      return commandOutput(formatGoal(goal));
    }
    if (normalized.startsWith("verify ")) {
      const match = input.match(/^verify\s+(\S+)(?:\s+([\s\S]+))?$/i);
      if (!match) return commandOutput("Usage: /mh-goal verify <criterion-id> [note]", false);
      const goal = mutateGoal(scope, "human", "criterion_verified", match[1], null, (current) => {
        const criterion = criterionById(current, match[1]);
        if (criterion.owner !== "human") {
          throw new Error(`${criterion.id} is agent-owned; add evidence and use mh_update_goal claim_criterion instead.`);
        }
        criterion.status = "verified";
        criterion.note = match[2] ? compactText(match[2]) : criterion.note;
        criterion.updatedAt = nowIso();
        return current;
      });
      return commandOutput(formatGoal(goal));
    }
    if (normalized.startsWith("resolve ")) {
      const blockerId = input.slice(8).trim();
      const goal = mutateGoal(scope, "human", "blocker_resolved", blockerId, null, (current) => {
        const blocker = blockerById(current, blockerId);
        blocker.status = "resolved";
        blocker.resolvedAt = nowIso();
        return current;
      });
      return commandOutput(formatGoal(goal));
    }
    const ruleAddMatch = input.match(/^rule\s+add\s+(\d+)\s+(must|prefer)\s+([\s\S]+)$/i);
    if (ruleAddMatch) {
      const goal = mutateGoal(scope, "human", "rule_added", ruleAddMatch[2], Number(ruleAddMatch[1]), (current) =>
        addRule(current, { rule_level: ruleAddMatch[2].toLowerCase(), rule_text: ruleAddMatch[3] }, "human"));
      return commandOutput(formatGoal(goal));
    }
    const ruleUpdateMatch = input.match(/^rule\s+update\s+(\d+)\s+(\S+)\s+(must|prefer)\s+([\s\S]+)$/i);
    if (ruleUpdateMatch) {
      const goal = mutateGoal(scope, "human", "rule_updated", ruleUpdateMatch[3], Number(ruleUpdateMatch[1]), (current) =>
        updateRule(current, { rule_id: ruleUpdateMatch[2], rule_level: ruleUpdateMatch[3].toLowerCase(), rule_text: ruleUpdateMatch[4] }));
      return commandOutput(formatGoal(goal));
    }
    const ruleRemoveMatch = input.match(/^rule\s+remove\s+(\d+)\s+(\S+)$/i);
    if (ruleRemoveMatch) {
      const goal = mutateGoal(scope, "human", "rule_removed", ruleRemoveMatch[2], Number(ruleRemoveMatch[1]), (current) => {
        const rule = ruleById(current, ruleRemoveMatch[2]);
        current.rules = current.rules.filter((candidate) => candidate.id !== rule.id);
        return current;
      });
      return commandOutput(formatGoal(goal));
    }
    if (normalized.startsWith("rule ")) {
      return commandOutput("Usage: /mh-goal rule add <revision> <must|prefer> <text> | update <revision> <rule-id> <must|prefer> <text> | remove <revision> <rule-id>", false);
    }
    if (normalized === "complete" || normalized === "complete --force") {
      const force = normalized.endsWith("--force");
      const goal = mutateGoal(scope, "human", force ? "goal_force_completed" : "goal_completed", force ? "Forced complete by Mahiro." : "Completed after DoD audit.", null, (current) => {
        const issues = completionIssues(current);
        if (issues.length && !force) throw new Error(`Goal cannot complete: ${issues.join("; ")}. Use --force only as an explicit human override.`);
        current.status = "complete";
        current.nextAction = null;
        stopClock(current);
        return current;
      });
      return commandOutput(formatGoal(goal));
    }

    if (normalized === "replace" || normalized === "revise") return commandOutput("Usage: /mh-goal revise <revision> <objective>", false);
    const replaceMatch = input.match(/^(?:replace|revise)\s+(\d+)\s+([\s\S]+)$/i);
    if ((normalized.startsWith("replace ") || normalized.startsWith("revise ")) && !replaceMatch) {
      return commandOutput("Usage: /mh-goal revise <revision> <objective>", false);
    }
    const createText = replaceMatch?.[2] ?? input;
    const parsed = parseCreateArgs(createText);
    const goal = createGoal(scope, workspace, {
      objective: parsed.objective,
      criteria: [simpleCriterion(parsed.objective)],
      replace: Boolean(replaceMatch),
      expectedRevision: replaceMatch ? Number(replaceMatch[1]) : null,
      nextAction: null,
    }, "human");
    return {
      type: "prompt" as const,
      systemReminder: true,
      content: `${buildReminder(goal, workspace)}\n\nBegin with the smallest grounded next action. Revise the living mission, bounded rules, and mutable plan through mh_update_goal only when Mahiro changes direction.`,
    };
  } catch (error) {
    return commandOutput(error instanceof Error ? error.message : String(error), false);
  }
}

const GET_PARAMETERS = { type: "object", properties: {}, additionalProperties: false };
const CLEAR_PARAMETERS = {
  type: "object",
  properties: {
    expected_revision: { type: "integer", minimum: 1, description: "Current revision returned by mh_get_goal." },
  },
  required: ["expected_revision"],
  additionalProperties: false,
};
const CREATE_PARAMETERS = {
  type: "object",
  properties: {
    objective: { type: "string", description: "One concrete human-owned mission objective." },
    criteria: {
      type: "array",
      minItems: 1,
      maxItems: MAX_CRITERIA,
      description: "Definition of Done criteria. Human-owned criteria require Mahiro verification.",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          owner: { type: "string", enum: ["agent", "human"] },
          required: { type: "boolean" },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
    non_goals: { type: "array", items: { type: "string" }, maxItems: MAX_NON_GOALS },
    rules: {
      type: "array",
      maxItems: MAX_RULES,
      description: "Temporary goal-scoped operating rules. MUST is a mission constraint; PREFER is a non-blocking default. Rules never override higher-priority instructions or count as DoD.",
      items: {
        type: "object",
        properties: {
          text: { type: "string", maxLength: MAX_RULE_CHARS },
          level: { type: "string", enum: ["must", "prefer"] },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
    next_action: { type: "string", description: "Immediate next action." },
    replace: { type: "boolean", description: "Compatibility alias: explicitly revise the current mission only after Mahiro approved the revision." },
    expected_revision: { type: "integer", minimum: 1, description: "Required with replace=true to guard against stale mission revision." },
  },
  required: ["objective", "criteria"],
  additionalProperties: false,
};
const UPDATE_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "set_phase",
        "set_next",
        "revise_mission",
        "move_goal",
        "add_plan_item",
        "update_plan_item",
        "remove_plan_item",
        "add_rule",
        "update_rule",
        "remove_rule",
        "add_evidence",
        "claim_criterion",
        "block_criterion",
        "add_blocker",
        "resolve_blocker",
        "mark_blocked",
        "complete",
      ],
    },
    expected_revision: { type: "integer", minimum: 1, description: "Current revision returned by mh_get_goal." },
    phase: { type: "string" },
    next_action: { type: "string" },
    objective: { type: "string" },
    criteria: {
      type: "array",
      minItems: 1,
      maxItems: MAX_CRITERIA,
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          owner: { type: "string", enum: ["agent", "human"] },
          required: { type: "boolean" },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
    non_goals: { type: "array", items: { type: "string" }, maxItems: MAX_NON_GOALS },
    rules: {
      type: "array",
      maxItems: MAX_RULES,
      items: {
        type: "object",
        properties: {
          text: { type: "string", maxLength: MAX_RULE_CHARS },
          level: { type: "string", enum: ["must", "prefer"] },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
    goal_id: { type: "string", description: "Stable Goal ID required by move_goal. The destination is always the current conversation." },
    rule_id: { type: "string" },
    rule_text: { type: "string", maxLength: MAX_RULE_CHARS },
    rule_level: { type: "string", enum: ["must", "prefer"] },
    plan_id: { type: "string" },
    plan_text: { type: "string" },
    plan_status: { type: "string", enum: ["pending", "in_progress", "done", "blocked"] },
    plan_note: { type: "string" },
    clear_plan_note: { type: "boolean" },
    criterion_id: { type: "string" },
    blocker_id: { type: "string" },
    summary: { type: "string" },
    kind: { type: "string", enum: ["file", "command", "test", "browser", "native", "manual", "user", "other"] },
    reference: { type: "string" },
  },
  required: ["action", "expected_revision"],
  additionalProperties: false,
};

export default async function activate(letta: any) {
  if (existsSync(DISABLE_PATH)) return;
  await waitForRegistrationTurn();
  if (letta.signal?.aborted) return;
  const disposers: Array<() => void> = [];
  let busyStatusPanel: any = null;
  let busyStatusTimer: ReturnType<typeof setTimeout> | null = null;

  const closeBusyStatus = (closePanel = true) => {
    if (busyStatusTimer) clearTimeout(busyStatusTimer);
    busyStatusTimer = null;
    if (closePanel) busyStatusPanel?.close?.();
    busyStatusPanel = null;
  };

  if (letta.capabilities?.commands && letta.commands?.register) {
    disposers.push(letta.commands.register({
      id: "mh-goal",
      description: "Manage Mahiro's living conversation mission, goal rules, mutable plan, DoD, evidence, blockers, movement, and human gates",
      args: "[status|list|move|pause|resume|next|phase|rule|evidence|verify|resolve|complete|clear|revise|<objective>]",
      run: runCommand,
    }));
  }

  if (letta.capabilities?.commands
    && letta.commands?.register
    && letta.capabilities?.ui?.panels
    && letta.ui?.openPanel) {
    disposers.push(letta.commands.register({
      id: "mh-goal-status",
      description: "Show Mahiro Goal status in a transient panel while the agent may still be working",
      args: "",
      runWhenBusy: true,
      showInTranscript: false,
      run(ctx: any) {
        closeBusyStatus();
        let goal: WorkflowGoal | null = null;
        let statusError: string | null = null;
        try {
          goal = getGoal(scopeFrom(ctx));
        } catch (error) {
          statusError = `Mahiro Goal status unavailable · ${error instanceof Error ? error.message : String(error)}`;
        }
        busyStatusPanel = letta.ui.openPanel({
          id: "mahiro-goal-status",
          order: 120,
          render: (renderContext: any) => statusError
            ? [panelColor(renderContext?.chalk, GOAL_COLORS.blocked, displayFieldText(statusError))]
            : compactStatusPanel(goal, renderContext?.chalk),
        });
        busyStatusTimer = setTimeout(closeBusyStatus, 10_000);
        busyStatusTimer.unref?.();
        return { type: "handled" as const };
      },
    }));
  }

  if (letta.capabilities?.tools && letta.tools?.register) {
    disposers.push(letta.tools.register({
      name: "mh_get_goal",
      description: "Read Mahiro's structured goal for the current conversation before planning or mutating goal state.",
      parameters: GET_PARAMETERS,
      requiresApproval: false,
      parallelSafe: true,
      run(ctx: any) {
        const goal = getGoal(scopeFrom(ctx));
        return jsonResult({ goal, completion_issues: goal ? completionIssues(goal) : [] });
      },
    }));
    disposers.push(letta.tools.register({
      name: "mh_create_goal",
      description: "Create a structured Mahiro mission only after Mahiro directly requested or approved it. The replace compatibility field revises the existing mission in place; include concrete DoD criteria, mark visual/product acceptance criteria as human-owned, and keep optional rules goal-scoped and lower priority than system/repository/current-user instructions.",
      parameters: CREATE_PARAMETERS,
      requiresApproval: false,
      parallelSafe: false,
      run(ctx: any) {
        const goal = createGoal(scopeFrom(ctx), workspaceFrom(ctx), {
          objective: ctx.args.objective,
          criteria: ctx.args.criteria,
          nonGoals: ctx.args.non_goals,
          rules: ctx.args.rules,
          nextAction: ctx.args.next_action,
          replace: ctx.args.replace,
          expectedRevision: ctx.args.expected_revision,
        }, "agent");
        return jsonResult({ goal, completion_issues: completionIssues(goal) });
      },
    }));
    disposers.push(letta.tools.register({
      name: "mh_update_goal",
      description: "Update the current Mahiro living mission, bounded goal rules, and mutable plan using its latest revision. move_goal atomically moves one same-agent Goal into the current empty conversation only after Mahiro directly requests it. Omitted rules are preserved; rules: [] explicitly clears them. Rules never override higher-priority instructions or count as DoD. Add evidence before claiming agent criteria, never verify human-owned criteria, and complete only after the audit passes.",
      parameters: UPDATE_PARAMETERS,
      requiresApproval: false,
      parallelSafe: false,
      run(ctx: any) {
        const goal = updateGoalFromTool(scopeFrom(ctx), workspaceFrom(ctx), ctx.args);
        return jsonResult({ goal, completion_issues: completionIssues(goal) });
      },
    }));
    disposers.push(letta.tools.register({
      name: "mh_clear_goal",
      description: "Clear the current Mahiro mission after Mahiro explicitly asked to clear it and approves this destructive call. This is revision-guarded and removes the conversation record rather than creating a synthetic completed goal.",
      parameters: CLEAR_PARAMETERS,
      requiresApproval: true,
      parallelSafe: false,
      run(ctx: any) {
        const cleared = clearGoalAtRevision(scopeFrom(ctx), Number(ctx.args.expected_revision));
        return jsonResult({ cleared_goal_id: cleared.id, cleared_revision: cleared.revision });
      },
    }));
  }

  if (letta.capabilities?.events?.turns && letta.events?.on) {
    disposers.push(letta.events.on("turn_start", (event: any, ctx: any) => {
      try {
        const scope = scopeFrom(ctx, event);
        const goal = getGoal(scope);
        if (!goal || goal.status !== "active") return;
        return {
          input: [
            { role: "user", content: buildReminder(goal, workspaceFrom(ctx, event)) },
            ...(Array.isArray(event?.input) ? event.input : []),
          ],
        };
      } catch (error) {
        letta.diagnostics?.report?.({
          severity: "warning",
          message: `Mahiro Goal reminder skipped: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
    }));
  }

  return () => {
    const aborted = Boolean(letta.signal?.aborted);
    closeBusyStatus(!aborted);
    if (aborted) return;
    for (const dispose of disposers.reverse()) dispose();
  };
}
