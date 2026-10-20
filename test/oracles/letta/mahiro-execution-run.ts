/**
 * Mahiro Execution Run — bounded, executor-neutral coordination records.
 *
 * Recorded metadata is caller-supplied coordination data, never execution proof.
 */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SCHEMA_VERSION = 1;
const STATE_PATH = resolve(process.env.MAHIRO_EXECUTION_RUN_STATE_PATH ?? join(homedir(), ".letta", "mods", "mahiro-execution-run.state.json"));
const LOCK_PATH = `${STATE_PATH}.lock`;
const DISABLE_PATH = resolve(process.env.MAHIRO_EXECUTION_RUN_DISABLE_PATH ?? join(homedir(), ".letta", "mods", "mahiro-execution-run.disabled"));
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_SCOPES = 256;
const MAX_TEXT = 1_200;
const MAX_LONG = 4_000;
const MAX_LANES = 16;
const MAX_WORKTREES = 16;
const MAX_TARGETS = 64;
const MAX_BLOCKERS = 30;
const MAX_HISTORY = 80;
const MAX_REFS = 24;
const MAX_SESSION_REFS = 4;
const MAX_REPORTS = 4;
const MAX_PATHS_PER_REPORT = 64;
const MAX_PATHS_PER_RUN = 512;
const MAX_CHECKS = 24;
const LETTA_SESSION_REF = /^letta:agent=([A-Za-z0-9][A-Za-z0-9_.:-]{0,239});conversation=([A-Za-z0-9][A-Za-z0-9_.:-]{0,239})$/;
const STAGES = ["plan", "ready", "active", "reported", "handed_off"] as const;
const TERMINAL_STAGES = ["handed_off", "abandoned"] as const;
const EXECUTORS = ["main_agent", "letta_subagent", "direct_cli", "human", "other"] as const;
const ROLES = ["implement", "research", "review", "verify", "other"] as const;
const LANE_STATUSES = ["planned", "active", "blocked", "reported", "handed_off", "failed", "cancelled"] as const;
type Stage = typeof STAGES[number];
type Executor = typeof EXECUTORS[number];
type Role = typeof ROLES[number];
type LaneStatus = typeof LANE_STATUSES[number];
type Access = "read" | "write";

interface Scope { agentId: string; conversationId: string; workspace: string; workspaceExplicit: boolean; key: string }
interface LockHandle { token: string; tokenPath: string }
interface Target { id: string; path: string; intent: string; worktree_ref: string; access: Access; writer_lane_id: string | null; reader_lane_ids: string[] }
interface Report { id: string; status: Extract<LaneStatus, "reported" | "handed_off" | "failed" | "cancelled">; summary: string; changed_paths: string[]; checks: string[]; refs: string[]; created_at: string }
interface Lane { id: string; required: boolean; executor_kind: Executor; executor_label: string | null; role: Role; worktree_ref: string | null; status: LaneStatus; summary: string; session_refs: string[]; reports: Report[] }
interface Blocker { id: string; lane_id: string | null; summary: string; status: "open" | "resolved"; created_at: string; resolved_at: string | null }
interface History { at: string; action: string; summary: string; revision: number }
interface CodeEvidenceIntake { run_id: string; revision: number; workspace: string; goal_refs: string[]; targets: Target[]; changed_paths: string[]; suggested_checks: string[]; refs: string[]; disclaimer: string }
interface Handoff { final_handoff: string; unresolved_items: string[]; suggested_checks: string[]; goal_refs: string[]; included: string[]; exceptions: string[]; code_evidence_intake: CodeEvidenceIntake }
interface Run { id: string; revision: number; stage: Stage | "abandoned"; summary: string; acceptance_criteria: string[]; non_goals: string[]; protected_contracts: string[]; open_questions: Array<{ question: string; blocking: boolean }>; suggested_checks: string[]; workspace: string; agent_id: string; conversation_id: string; worktree_refs: string[]; targets: Target[]; lanes: Lane[]; blockers: Blocker[]; goal_refs: string[]; ux_workflow_refs: string[]; code_evidence_refs: string[]; handoff: Handoff | null; abandoned_note: string | null; replaces_run_id: string | null; created_at: string; updated_at: string; history: History[] }
interface State { schema_version: 1; runs: Record<string, Run> }

function now(): string { return new Date().toISOString(); }
function record(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasUnsafeText(value: string): boolean { return /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value) || /<\/?system-reminder\b|\b(?:diff --git|@@\s+-\d|(?:^|\s)(?:traceback|error:|fatal:)|\b(?:stdout|stderr)\s*:)/i.test(value); }
function text(value: unknown, label: string, max = MAX_TEXT): string { if (typeof value !== "string" || !value.trim() || value.length > max || hasUnsafeText(value)) throw new Error(`${label} must be safe, non-empty text of at most ${max} characters.`); return value.trim(); }
function optionalText(value: unknown, label: string, max = MAX_TEXT): string | null { return value == null ? null : text(value, label, max); }
function id(value: unknown, label: string, max = 120): string { const result = text(value, label, max); if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(result)) throw new Error(`${label} has invalid characters.`); return result; }
function iso(value: unknown): value is string { return typeof value === "string" && value.length <= 80 && !hasUnsafeText(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function list(value: unknown, label: string, max: number, itemMax = MAX_TEXT, required = false): string[] { if (!Array.isArray(value) || value.length > max || (required && !value.length)) throw new Error(`${label} must be ${required ? "a non-empty" : "an"} array with at most ${max} items.`); const items = value.map((item, index) => text(item, `${label}[${index}]`, itemMax)); if (new Set(items).size !== items.length) throw new Error(`${label} must not contain duplicates.`); return items; }
function laneSessionRefs(value: unknown, executor: Executor): string[] { const refs = list(value, "session_refs", MAX_SESSION_REFS); if (executor !== "letta_subagent") return refs; refs.forEach((ref, index) => { if (!LETTA_SESSION_REF.test(ref)) throw new Error(`session_refs[${index}] for a Letta subagent must use letta:agent=<agent-id>;conversation=<conversation-id>.`); }); return refs; }
function pathValue(value: unknown, label: string): string { const result = text(value, label, 4096); if (result.startsWith("/") || /^[A-Za-z]:[\\/]/.test(result) || result.includes("\\") || result.split("/").some((part) => !part || part === "..")) throw new Error(`${label} must be a relative lexical path without traversal.`); const normalized = result.split("/").filter((part) => part !== ".").join("/"); if (!normalized) throw new Error(`${label} must identify a path below the declared worktree root.`); return normalized; }
function scopeFrom(ctx: any, args?: any): Scope {
  const agentId = text(ctx?.agent?.id, "ctx.agent.id", 240);
  const conversationId = text(ctx?.conversation?.id, "ctx.conversation.id", 240);
  const workspaceExplicit = args?.workspace != null;
  const workspace = resolve(text(workspaceExplicit ? args.workspace : ctx?.cwd, workspaceExplicit ? "workspace" : "ctx.cwd", 4096));
  return { agentId, conversationId, workspace, workspaceExplicit, key: JSON.stringify([agentId, conversationId, conversationId === "default" ? workspace : ""]) };
}
function emptyState(): State { return { schema_version: SCHEMA_VERSION, runs: {} }; }
function terminal(run: Run): boolean { return (TERMINAL_STAGES as readonly string[]).includes(run.stage); }
function openBlockers(run: Run, laneId?: string): Blocker[] { return run.blockers.filter((blocker) => blocker.status === "open" && (laneId === undefined || blocker.lane_id === laneId)); }
function parentOrSame(left: string, right: string): boolean { return left === right || right.startsWith(`${left}/`); }
function latestReport(lane: Lane): Report | null { return lane.reports.length ? lane.reports[lane.reports.length - 1] : null; }
function terminalLane(lane: Lane): boolean { return ["reported", "handed_off", "failed", "cancelled"].includes(lane.status); }
function reportMatchesLane(lane: Lane): boolean { const report = latestReport(lane); return report !== null && (report.status === lane.status || (lane.status === "handed_off" && report.status === "reported")); }
function requiredLanes(run: Run): Lane[] { return run.lanes.filter((lane) => lane.required); }
function validateTargetCollisions(targets: Target[]): void {
  for (let i = 0; i < targets.length; i += 1) for (let j = i + 1; j < targets.length; j += 1) {
    const left = targets[i]; const right = targets[j];
    if (left.access !== "write" || right.access !== "write" || left.worktree_ref !== right.worktree_ref) continue;
    if (parentOrSame(left.path, right.path) || parentOrSame(right.path, left.path)) throw new Error("Only two writable targets may not overlap in the same declared worktree.");
  }
}
function normalizeTargets(value: unknown, required = true): Target[] {
  if (!Array.isArray(value) || value.length > MAX_TARGETS || (required && !value.length)) throw new Error(`targets must be ${required ? "a non-empty" : "an"} array with at most ${MAX_TARGETS} items.`);
  const targets = value.map((item, index) => {
    if (!record(item) || !["read", "write"].includes(item.access)) throw new Error(`targets[${index}] requires id, path, intent, worktree_ref, access, writer_lane_id, and reader_lane_ids.`);
    const access = item.access as Access;
    const writer = item.writer_lane_id == null ? null : id(item.writer_lane_id, `targets[${index}].writer_lane_id`);
    return { id: id(item.id, `targets[${index}].id`), path: pathValue(item.path, `targets[${index}].path`), intent: text(item.intent, `targets[${index}].intent`, MAX_LONG), worktree_ref: id(item.worktree_ref, `targets[${index}].worktree_ref`, 240), access, writer_lane_id: writer, reader_lane_ids: list(item.reader_lane_ids, `targets[${index}].reader_lane_ids`, MAX_LANES) };
  });
  if (new Set(targets.map((target) => target.id)).size !== targets.length) throw new Error("targets must have unique IDs.");
  validateTargetCollisions(targets);
  return targets;
}
function validateTargetsForReady(run: Run): void {
  const lanes = new Map(run.lanes.map((lane) => [lane.id, lane]));
  for (const target of run.targets) {
    if (target.access === "write") {
      const writer = target.writer_lane_id ? lanes.get(target.writer_lane_id) : null;
      if (!writer) throw new Error(`Write target ${target.id} requires exactly one existing writer lane.`);
      if (!writer.required || writer.role !== "implement") throw new Error(`Write target ${target.id} requires a required implementation lane.`);
      if (writer.worktree_ref !== null && writer.worktree_ref !== target.worktree_ref) throw new Error(`Write target ${target.id} and writer lane must use the same declared worktree.`);
    } else if (target.writer_lane_id !== null) {
      throw new Error(`Read target ${target.id} must not have a writer lane.`);
    }
    for (const reader of target.reader_lane_ids) {
      if (!lanes.has(reader)) throw new Error(`Target ${target.id} references an unknown reader lane.`);
      if (reader === target.writer_lane_id) throw new Error(`Target ${target.id} writer cannot also be a reader.`);
    }
  }
}
function validateReport(value: unknown, label: string): asserts value is Report {
  if (!record(value) || !["reported", "handed_off", "failed", "cancelled"].includes(value.status) || !iso(value.created_at)) throw new Error(`${label} has invalid report metadata.`);
  id(value.id, `${label}.id`); text(value.summary, `${label}.summary`, MAX_LONG);
  const paths = list(value.changed_paths, `${label}.changed_paths`, MAX_PATHS_PER_REPORT, 4096);
  paths.forEach((path, index) => pathValue(path, `${label}.changed_paths[${index}]`));
  list(value.checks, `${label}.checks`, MAX_CHECKS); list(value.refs, `${label}.refs`, MAX_REFS);
}
function validateReportOwnership(run: Run, lane: Lane, report: Report): void {
  const writable = run.targets.filter((target) => target.access === "write" && target.writer_lane_id === lane.id);
  if (!writable.length && report.changed_paths.length) throw new Error(`Read-only lane ${lane.id} must not report changed paths.`);
  for (const changed of report.changed_paths) {
    if (!writable.some((target) => target.worktree_ref === (lane.worktree_ref ?? target.worktree_ref) && parentOrSame(target.path, changed))) throw new Error(`Changed path ${changed} is not covered by a write target owned by lane ${lane.id}.`);
  }
}
function validateHandoff(value: unknown, run: Run): asserts value is Handoff {
  if (!record(value) || !record(value.code_evidence_intake)) throw new Error("Execution Run handoff is invalid.");
  text(value.final_handoff, "handoff.final_handoff", MAX_LONG);
  list(value.unresolved_items, "handoff.unresolved_items", MAX_REFS);
  list(value.suggested_checks, "handoff.suggested_checks", MAX_CHECKS, MAX_TEXT, true);
  list(value.goal_refs, "handoff.goal_refs", MAX_REFS, MAX_TEXT, true);
  const included = list(value.included, "handoff.included", MAX_LANES);
  const exceptions = list(value.exceptions, "handoff.exceptions", MAX_LANES);
  const intake = value.code_evidence_intake;
  if (intake.run_id !== run.id || intake.revision !== run.revision || intake.workspace !== run.workspace) throw new Error("Execution Run handoff intake does not bind to the current run.");
  const intakeGoalRefs = list(intake.goal_refs, "handoff.code_evidence_intake.goal_refs", MAX_REFS, MAX_TEXT, true);
  normalizeTargets(intake.targets);
  if (JSON.stringify(intake.targets) !== JSON.stringify(run.targets)) throw new Error("Execution Run handoff intake targets must match the run targets exactly.");
  const changed = list(intake.changed_paths, "handoff.code_evidence_intake.changed_paths", MAX_PATHS_PER_RUN, 4096);
  changed.forEach((path, index) => pathValue(path, `handoff.code_evidence_intake.changed_paths[${index}]`));
  list(intake.suggested_checks, "handoff.code_evidence_intake.suggested_checks", MAX_CHECKS);
  list(intake.refs, "handoff.code_evidence_intake.refs", MAX_REFS);
  text(intake.disclaimer, "handoff.code_evidence_intake.disclaimer", MAX_TEXT);
  const reported = run.lanes.filter((lane) => ["reported", "handed_off"].includes(lane.status)).map((lane) => lane.id).sort();
  const exceptional = run.lanes.filter((lane) => ["failed", "cancelled"].includes(lane.status)).map((lane) => lane.id).sort();
  if (JSON.stringify([...included].sort()) !== JSON.stringify(reported) || JSON.stringify([...exceptions].sort()) !== JSON.stringify(exceptional)) throw new Error("Handoff included and exceptions must exactly match lane terminal truth.");
  if (JSON.stringify([...value.goal_refs].sort()) !== JSON.stringify([...run.goal_refs].sort())) throw new Error("Handoff Goal refs must exactly match the run-declared Goal refs.");
  if (JSON.stringify([...intakeGoalRefs].sort()) !== JSON.stringify([...run.goal_refs].sort())) throw new Error("Handoff intake Goal refs must exactly match the run-declared Goal refs.");
}
function validateRun(key: string, value: unknown): asserts value is Run {
  if (!record(value)) throw new Error(`Execution Run ${key} must be an object.`);
  id(value.id, `Execution Run ${key}.id`, 160);
  text(value.summary, `Execution Run ${key}.summary`, MAX_LONG);
  for (const name of ["workspace", "agent_id", "conversation_id"]) text(value[name], `Execution Run ${key}.${name}`, name === "workspace" ? 4096 : 240);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || ![...STAGES, "abandoned"].includes(value.stage) || !iso(value.created_at) || !iso(value.updated_at)) throw new Error(`Execution Run ${key} has invalid lifecycle metadata.`);
  if (key !== JSON.stringify([value.agent_id, value.conversation_id, value.conversation_id === "default" ? resolve(value.workspace) : ""])) throw new Error(`Execution Run ${key} does not match its scope.`);
  list(value.acceptance_criteria, `Execution Run ${key}.acceptance_criteria`, MAX_REFS, MAX_TEXT, true);
  list(value.non_goals, `Execution Run ${key}.non_goals`, MAX_REFS);
  list(value.protected_contracts, `Execution Run ${key}.protected_contracts`, MAX_REFS);
  list(value.suggested_checks, `Execution Run ${key}.suggested_checks`, MAX_CHECKS, MAX_TEXT, true);
  if (!Array.isArray(value.open_questions) || value.open_questions.length > MAX_REFS) throw new Error(`Execution Run ${key}.open_questions is invalid.`);
  for (const [index, question] of value.open_questions.entries()) if (!record(question) || typeof question.blocking !== "boolean") throw new Error(`Execution Run ${key}.open_questions[${index}] is invalid.`); else text(question.question, `Execution Run ${key}.open_questions[${index}].question`, MAX_TEXT);
  list(value.worktree_refs, `Execution Run ${key}.worktree_refs`, MAX_WORKTREES, 240, true);
  const targets = normalizeTargets(value.targets);
  if (targets.some((target) => !value.worktree_refs.includes(target.worktree_ref))) throw new Error(`Execution Run ${key} target references an undeclared worktree.`);
  if (!Array.isArray(value.lanes) || value.lanes.length > MAX_LANES) throw new Error(`Execution Run ${key} has invalid lanes.`);
  const laneIds = new Set<string>(); let totalPaths = 0;
  for (const [index, lane] of value.lanes.entries()) {
    if (!record(lane) || typeof lane.required !== "boolean" || !EXECUTORS.includes(lane.executor_kind) || !ROLES.includes(lane.role) || !LANE_STATUSES.includes(lane.status)) throw new Error(`Execution Run ${key}.lanes[${index}] has invalid metadata.`);
    const laneId = id(lane.id, `Execution Run ${key}.lanes[${index}].id`);
    if (laneIds.has(laneId)) throw new Error(`Execution Run ${key} has duplicate lane IDs.`);
    laneIds.add(laneId);
    optionalText(lane.executor_label, `Execution Run ${key}.lanes[${index}].executor_label`);
    if (lane.worktree_ref !== null) id(lane.worktree_ref, `Execution Run ${key}.lanes[${index}].worktree_ref`, 240);
    if (lane.worktree_ref !== null && !value.worktree_refs.includes(lane.worktree_ref)) throw new Error(`Execution Run ${key} lane has an undeclared worktree.`);
    text(lane.summary, `Execution Run ${key}.lanes[${index}].summary`, MAX_LONG);
    list(lane.session_refs, `Execution Run ${key}.lanes[${index}].session_refs`, MAX_SESSION_REFS);
    if (!Array.isArray(lane.reports) || lane.reports.length > MAX_REPORTS) throw new Error(`Execution Run ${key}.lanes[${index}] has too many reports.`);
    for (const [reportIndex, report] of lane.reports.entries()) { validateReport(report, `Execution Run ${key}.lanes[${index}].reports[${reportIndex}]`); validateReportOwnership(value as Run, lane as Lane, report as Report); totalPaths += report.changed_paths.length; }
  }
  if (totalPaths > MAX_PATHS_PER_RUN) throw new Error(`Execution Run ${key} exceeds ${MAX_PATHS_PER_RUN} changed paths.`);
  for (const name of ["goal_refs", "ux_workflow_refs", "code_evidence_refs"]) list(value[name], `Execution Run ${key}.${name}`, MAX_REFS);
  if (!Array.isArray(value.blockers) || value.blockers.length > MAX_BLOCKERS || !Array.isArray(value.history) || !value.history.length || value.history.length > MAX_HISTORY) throw new Error(`Execution Run ${key} has invalid bounded collections.`);
  const blockers = new Set<string>();
  for (const [index, blocker] of value.blockers.entries()) {
    if (!record(blocker) || !["open", "resolved"].includes(blocker.status) || !iso(blocker.created_at) || (blocker.resolved_at !== null && !iso(blocker.resolved_at)) || (blocker.status === "open" ? blocker.resolved_at !== null : blocker.resolved_at === null)) throw new Error(`Execution Run ${key}.blockers[${index}] is invalid.`);
    const blockerId = id(blocker.id, `Execution Run ${key}.blockers[${index}].id`);
    if (blockers.has(blockerId)) throw new Error(`Execution Run ${key} has duplicate blockers.`);
    blockers.add(blockerId); text(blocker.summary, `Execution Run ${key}.blockers[${index}].summary`, MAX_LONG);
    if (blocker.lane_id !== null && !laneIds.has(id(blocker.lane_id, `Execution Run ${key}.blockers[${index}].lane_id`))) throw new Error(`Execution Run ${key} blocker has unknown lane.`);
  }
  value.history.forEach((item: unknown, index: number) => {
    if (!record(item) || !iso(item.at) || !Number.isSafeInteger(item.revision) || (index > 0 && item.revision !== value.history[index - 1].revision + 1)) throw new Error(`Execution Run ${key}.history must have strictly increasing contiguous revisions.`);
    text(item.action, `Execution Run ${key}.history[${index}].action`, 120); text(item.summary, `Execution Run ${key}.history[${index}].summary`, 500);
  });
  if (value.history[value.history.length - 1].revision !== value.revision) throw new Error(`Execution Run ${key}.history must end at current revision.`);
  if (value.abandoned_note !== null) text(value.abandoned_note, `Execution Run ${key}.abandoned_note`, MAX_LONG);
  if (value.replaces_run_id !== null) id(value.replaces_run_id, `Execution Run ${key}.replaces_run_id`, 160);
  if (value.stage === "abandoned" && value.abandoned_note === null) throw new Error(`Execution Run ${key} abandoned without a note.`);
  if (value.stage !== "abandoned" && value.abandoned_note !== null) throw new Error(`Execution Run ${key} has an unexpected abandoned note.`);
  if (value.handoff !== null) validateHandoff(value.handoff, value as Run);
  if (value.stage === "handed_off" && value.handoff === null) throw new Error(`Execution Run ${key} handed off without a handoff.`);
  if (!["reported", "handed_off"].includes(value.stage) && value.handoff !== null) throw new Error(`Execution Run ${key} has a handoff before reported stage.`);
}
function validateState(state: State): void {
  if (!record(state) || state.schema_version !== SCHEMA_VERSION || !record(state.runs) || Object.keys(state.runs).length > MAX_SCOPES) throw new Error("unsupported schema or invalid run map");
  for (const [key, run] of Object.entries(state.runs)) validateRun(key, run);
}
function readState(): State {
  let stat: ReturnType<typeof lstatSync>;
  try { stat = lstatSync(STATE_PATH); }
  catch (error: any) {
    if (error?.code === "ENOENT") return emptyState();
    throw new Error(`Mahiro Execution Run state was rejected in place: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("state path must be a non-symlink regular file");
    if (stat.size > MAX_STATE_BYTES) throw new Error(`state exceeds ${MAX_STATE_BYTES} bytes`);
    const raw = readFileSync(STATE_PATH, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_STATE_BYTES) throw new Error(`state exceeds ${MAX_STATE_BYTES} bytes`);
    const parsed: unknown = JSON.parse(raw);
    validateState(parsed as State);
    return parsed as State;
  } catch (error) { throw new Error(`Mahiro Execution Run state was rejected in place: ${error instanceof Error ? error.message : String(error)}`); }
}
function writeState(state: State): void {
  validateState(state);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) throw new Error(`Execution Run state exceeds ${MAX_STATE_BYTES} bytes.`);
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const temporary = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  let fd: number | null = null;
  try { fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, serialized, "utf8"); fsyncSync(fd); closeSync(fd); fd = null; renameSync(temporary, STATE_PATH); const directory = openSync(dirname(STATE_PATH), "r"); try { fsyncSync(directory); } finally { closeSync(directory); } } finally { if (fd !== null) closeSync(fd); rmSync(temporary, { force: true }); }
}
function acquireStateLock(): LockHandle {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${randomUUID()}`; const candidate = `${LOCK_PATH}.candidate-${token}`; const tokenPath = join(candidate, token); let fd: number | null = null;
  try { mkdirSync(candidate, { mode: 0o700 }); fd = openSync(tokenPath, "wx", 0o600); writeFileSync(fd, `${JSON.stringify({ token, pid: process.pid, created_at: now() })}\n`, "utf8"); fsyncSync(fd); closeSync(fd); fd = null; renameSync(candidate, LOCK_PATH); return { token, tokenPath: join(LOCK_PATH, token) }; } catch (error: any) { if (fd !== null) closeSync(fd); rmSync(candidate, { recursive: true, force: true }); if (["EEXIST", "ENOTEMPTY", "EISDIR", "ENOTDIR"].includes(error?.code)) throw new Error("Execution Run state is busy. Retry, or use /mh-run unlock --force only after confirming its owner is gone."); throw error; }
}
function releaseStateLock(lock: LockHandle): void { rmSync(lock.tokenPath, { force: true }); try { rmdirSync(LOCK_PATH); } catch (error: any) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error; } }
function forceUnlock(): boolean { if (!existsSync(LOCK_PATH)) return false; const quarantine = `${LOCK_PATH}.abandoned-${Date.now()}-${randomUUID().slice(0, 8)}`; renameSync(LOCK_PATH, quarantine); rmSync(quarantine, { recursive: lstatSync(quarantine).isDirectory(), force: true }); return true; }
function withLockedState<T>(mutate: (state: State) => T): T { const lock = acquireStateLock(); try { const state = readState(); const before = JSON.stringify(state); const result = mutate(state); if (JSON.stringify(state) !== before) writeState(state); return result; } finally { releaseStateLock(lock); } }
function history(revision: number, action: string, summary: string): History { return { at: now(), action: text(action, "history action", 120), summary: text(summary, "history summary", 500), revision }; }
function assertWorkspace(scope: Scope, run: Run): void { if (scope.workspaceExplicit && resolve(run.workspace) !== scope.workspace) throw new Error(`Execution Run workspace mismatch. Current run targets ${run.workspace}.`); }
function getRun(scope: Scope): Run | null { const run = readState().runs[scope.key]; if (run) assertWorkspace(scope, run); return run ? structuredClone(run) : null; }
function expected(args: any, run: Run): void { if (id(args.expected_run_id, "expected_run_id", 160) !== run.id || !Number.isSafeInteger(args.expected_revision) || args.expected_revision !== run.revision) throw new Error(`Stale Execution Run guard. expected_run_id and expected_revision must match ${run.id} revision ${run.revision}.`); }
function createRun(scope: Scope, args: any): Run {
  return withLockedState((state) => {
    const existing = state.runs[scope.key];
    if (existing) { assertWorkspace(scope, existing); if (!terminal(existing) || args.replace_terminal !== true) throw new Error("An Execution Run already exists for this scope. Only an explicit terminal replacement is allowed."); expected(args, existing); }
    if (!existing && Object.keys(state.runs).length >= MAX_SCOPES) throw new Error(`Execution Run state already contains ${MAX_SCOPES} scopes.`);
    const worktreeRefs = list(args.worktree_refs ?? ["default"], "worktree_refs", MAX_WORKTREES, 240, true).map((ref, index) => id(ref, `worktree_refs[${index}]`, 240));
    const targets = normalizeTargets(args.targets);
    if (targets.some((target) => !worktreeRefs.includes(target.worktree_ref))) throw new Error("Every target must declare one of worktree_refs.");
    const timestamp = now(); const run: Run = { id: `mh-run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`, revision: 1, stage: "plan", summary: text(args.summary, "summary", MAX_LONG), acceptance_criteria: list(args.acceptance_criteria, "acceptance_criteria", MAX_REFS, MAX_TEXT, true), non_goals: list(args.non_goals, "non_goals", MAX_REFS), protected_contracts: list(args.protected_contracts, "protected_contracts", MAX_REFS), open_questions: normalizeQuestions(args.open_questions), suggested_checks: list(args.suggested_checks, "suggested_checks", MAX_CHECKS, MAX_TEXT, true), workspace: scope.workspace, agent_id: scope.agentId, conversation_id: scope.conversationId, worktree_refs: worktreeRefs, targets, lanes: [], blockers: [], goal_refs: list(args.goal_refs ?? [], "goal_refs", MAX_REFS), ux_workflow_refs: list(args.ux_workflow_refs ?? [], "ux_workflow_refs", MAX_REFS), code_evidence_refs: list(args.code_evidence_refs ?? [], "code_evidence_refs", MAX_REFS), handoff: null, abandoned_note: null, replaces_run_id: existing?.id ?? null, created_at: timestamp, updated_at: timestamp, history: [history(1, existing ? "terminal_replaced" : "created", text(args.summary, "summary", 500))] };
    validateRun(scope.key, run); state.runs[scope.key] = run; return structuredClone(run);
  });
}
function normalizeQuestions(value: unknown): Array<{ question: string; blocking: boolean }> { if (!Array.isArray(value) || value.length > MAX_REFS) throw new Error(`open_questions must be an array with at most ${MAX_REFS} items.`); return value.map((item, index) => { if (!record(item) || typeof item.blocking !== "boolean") throw new Error(`open_questions[${index}] requires question and blocking.`); return { question: text(item.question, `open_questions[${index}].question`), blocking: item.blocking }; }); }
function mutate(scope: Scope, args: any, action: string, apply: (run: Run) => void): Run { return withLockedState((state) => { const current = state.runs[scope.key]; if (!current) throw new Error("No Execution Run exists for this scope."); assertWorkspace(scope, current); expected(args, current); if (terminal(current)) throw new Error("Terminal Execution Runs are immutable; create a replacement with replace_terminal and current guards."); const next = structuredClone(current); apply(next); if (JSON.stringify(next) === JSON.stringify(current)) throw new Error("Execution Run update made no change."); next.revision += 1; next.updated_at = now(); next.history = [...next.history, history(next.revision, action, optionalText(args.summary, "summary", 500) ?? action)].slice(-MAX_HISTORY); validateRun(scope.key, next); state.runs[scope.key] = next; return structuredClone(next); }); }
function lane(run: Run, laneId: unknown): Lane { const item = run.lanes.find((entry) => entry.id === String(laneId)); if (!item) throw new Error(`Unknown lane: ${String(laneId ?? "<missing>")}`); return item; }
const LEGAL_LANE_TRANSITIONS: Record<LaneStatus, LaneStatus[]> = { planned: ["active", "blocked", "cancelled"], active: ["blocked", "reported", "failed", "cancelled"], blocked: ["active", "failed", "cancelled"], reported: ["handed_off"], handed_off: [], failed: [], cancelled: [] };
function setLaneStatus(run: Run, item: Lane, status: unknown, resolvingBlocker = false): void { if (!LANE_STATUSES.includes(status as LaneStatus) || !LEGAL_LANE_TRANSITIONS[item.status].includes(status as LaneStatus)) throw new Error(`Illegal lane status transition: ${item.status} -> ${String(status)}.`); if (status === "active" && item.required && !item.session_refs.length && !resolvingBlocker) throw new Error(`Required lane ${item.id} needs session refs before active.`); if (status === "active" && openBlockers(run, item.id).length) throw new Error(`Lane ${item.id} has open blockers.`); item.status = status as LaneStatus; }
function transition(run: Run, stage: unknown): void {
  if (!STAGES.includes(stage as Stage)) throw new Error("stage must be plan, ready, active, reported, or handed_off.");
  if (stage === "ready" && run.stage === "plan") { if (!run.lanes.length || !run.goal_refs.length || openBlockers(run).length || run.open_questions.some((question) => question.blocking)) throw new Error("ready requires lanes, Goal refs, no open blockers, and no blocking open questions."); validateTargetsForReady(run); run.stage = "ready"; return; }
  if (stage === "active" && run.stage === "ready") { const missing = requiredLanes(run).filter((item) => !item.session_refs.length); if (openBlockers(run).length || missing.length) throw new Error("active requires no open blockers and session refs for every required lane."); run.stage = "active"; return; }
  if (stage === "reported" && run.stage === "active") { const missing = requiredLanes(run).filter((item) => !terminalLane(item) || !reportMatchesLane(item)); if (missing.length) throw new Error(`reported requires every required lane terminal with a matching latest report: ${missing.map((item) => item.id).join(", ")}.`); run.stage = "reported"; return; }
  if (stage === "handed_off" && run.stage === "reported") { if (openBlockers(run).length || !run.handoff || run.handoff.unresolved_items.length) throw new Error("handed_off requires no open blockers, no unresolved items, and a final handoff."); if (run.lanes.some((item) => !terminalLane(item) || !reportMatchesLane(item))) throw new Error("handed_off requires every lane terminal with a matching latest report."); validateHandoff(run.handoff, run); run.stage = "handed_off"; return; }
  throw new Error(`Invalid Execution Run transition: ${run.stage} -> ${String(stage)}.`);
}
function codeEvidenceIntake(run: Run, revision: number, suggestedChecks: string[], goalRefs: string[], refs: string[]): CodeEvidenceIntake { return { run_id: run.id, revision, workspace: run.workspace, goal_refs: goalRefs, targets: structuredClone(run.targets), changed_paths: run.lanes.flatMap((item) => item.reports.flatMap((report) => report.changed_paths)).slice(0, MAX_PATHS_PER_RUN), suggested_checks: suggestedChecks, refs, disclaimer: "Caller metadata only; this intake is not execution, repository, check, or acceptance proof." }; }
function updateRun(scope: Scope, args: any): Run {
  const action = String(args?.action ?? "");
  return mutate(scope, args, action, (run) => {
    if (action === "add_lane") { if (run.stage !== "plan" || run.lanes.length >= MAX_LANES) throw new Error("add_lane is allowed only in plan while below the lane limit."); const laneId = id(args.lane_id, "lane_id"); if (run.lanes.some((item) => item.id === laneId) || !EXECUTORS.includes(args.executor_kind) || !ROLES.includes(args.role) || typeof args.required !== "boolean") throw new Error("lane_id must be unique; required, executor_kind, and role are required."); const worktreeRef = args.worktree_ref == null ? null : id(args.worktree_ref, "worktree_ref", 240); if (worktreeRef !== null && !run.worktree_refs.includes(worktreeRef)) throw new Error("lane worktree_ref must be declared."); run.lanes.push({ id: laneId, required: args.required, executor_kind: args.executor_kind, executor_label: optionalText(args.executor_label, "executor_label"), role: args.role, worktree_ref: worktreeRef, status: "planned", summary: text(args.summary, "summary", MAX_LONG), session_refs: [], reports: [] }); return; }
    if (action === "set_lane_sessions") { if (!["plan", "ready"].includes(run.stage)) throw new Error("set_lane_sessions is allowed only before active."); const item = lane(run, args.lane_id); item.session_refs = laneSessionRefs(args.session_refs, item.executor_kind); return; }
    if (action === "set_lane_status") { if (!["active", "blocked", "handed_off"].includes(args.status)) throw new Error("set_lane_status only supports active, blocked, or handed_off; terminal report outcomes must use add_report."); setLaneStatus(run, lane(run, args.lane_id), args.status); return; }
    if (action === "add_report") { if (!["active", "reported"].includes(run.stage)) throw new Error("add_report is allowed only during active or reported."); const item = lane(run, args.lane_id); if (item.reports.length >= MAX_REPORTS || !["reported", "handed_off", "failed", "cancelled"].includes(args.status)) throw new Error("report status is invalid or the lane report limit was reached."); if (item.status === "planned") throw new Error("A planned lane cannot report."); const report: Report = { id: id(args.report_id, "report_id"), status: args.status, summary: text(args.summary, "summary", MAX_LONG), changed_paths: list(args.changed_paths ?? [], "changed_paths", MAX_PATHS_PER_REPORT, 4096).map((path, index) => pathValue(path, `changed_paths[${index}]`)), checks: list(args.checks ?? [], "checks", MAX_CHECKS), refs: list(args.refs ?? [], "refs", MAX_REFS), created_at: now() }; validateReportOwnership(run, item, report); if (run.lanes.flatMap((entry) => entry.reports).reduce((count, entry) => count + entry.changed_paths.length, 0) + report.changed_paths.length > MAX_PATHS_PER_RUN) throw new Error("Run changed path limit reached."); setLaneStatus(run, item, report.status); item.reports.push(report); return; }
    if (action === "add_blocker") { if (run.blockers.length >= MAX_BLOCKERS) throw new Error("Blocker limit reached."); const laneId = args.lane_id == null ? null : lane(run, args.lane_id).id; if (laneId !== null) { const item = lane(run, laneId); if (["reported", "handed_off", "failed", "cancelled"].includes(item.status)) throw new Error("Cannot block a terminal lane."); if (item.status !== "blocked") setLaneStatus(run, item, "blocked"); } run.blockers.push({ id: `blocker-${randomUUID().slice(0, 10)}`, lane_id: laneId, summary: text(args.summary, "summary", MAX_LONG), status: "open", created_at: now(), resolved_at: null }); return; }
    if (action === "resolve_blocker") { const blocker = run.blockers.find((item) => item.id === String(args.blocker_id)); if (!blocker || blocker.status !== "open") throw new Error("Unknown or already resolved blocker."); blocker.status = "resolved"; blocker.resolved_at = now(); if (blocker.lane_id !== null && !openBlockers(run, blocker.lane_id).length) { const item = lane(run, blocker.lane_id); if (item.status === "blocked") setLaneStatus(run, item, "active", true); } return; }
    if (action === "set_open_questions") { if (run.stage !== "plan") throw new Error("set_open_questions is allowed only in plan."); run.open_questions = normalizeQuestions(args.open_questions); return; }
    if (action === "set_goal_refs") { if (run.stage !== "plan") throw new Error("set_goal_refs is allowed only in plan."); run.goal_refs = list(args.goal_refs, "goal_refs", MAX_REFS, MAX_TEXT, true); return; }
    if (action === "set_handoff") { if (run.stage !== "reported") throw new Error("set_handoff is allowed only in reported."); const suggestedChecks = list(args.suggested_checks, "suggested_checks", MAX_CHECKS, MAX_TEXT, true); const goalRefs = list(args.goal_refs, "goal_refs", MAX_REFS, MAX_TEXT, true); const included = list(args.included, "included", MAX_LANES); const exceptions = list(args.exceptions ?? [], "exceptions", MAX_LANES); const unresolved = list(args.unresolved_items ?? [], "unresolved_items", MAX_REFS); const refs = list(args.refs ?? [], "refs", MAX_REFS); run.handoff = { final_handoff: text(args.final_handoff, "final_handoff", MAX_LONG), unresolved_items: unresolved, suggested_checks: suggestedChecks, goal_refs: goalRefs, included, exceptions, code_evidence_intake: codeEvidenceIntake(run, run.revision + 1, suggestedChecks, goalRefs, refs) }; return; }
    if (action === "set_stage") { transition(run, args.stage); if (run.stage === "handed_off" && run.handoff) run.handoff.code_evidence_intake.revision = run.revision + 1; return; }
    throw new Error(`Unsupported Execution Run action: ${action}`);
  });
}
function abandon(scope: Scope, revision: number, note: string | null): Run { return mutate(scope, { expected_run_id: getRun(scope)?.id, expected_revision: revision, summary: note ?? "Abandoned by human" }, "abandoned", (run) => { run.stage = "abandoned"; run.abandoned_note = note ?? "Abandoned by human"; }); }
function clear(scope: Scope, revision: number): boolean { return withLockedState((state) => { const run = state.runs[scope.key]; if (!run) return false; if (!terminal(run)) throw new Error("Only terminal Execution Runs may be cleared."); if (!Number.isSafeInteger(revision) || revision !== run.revision) throw new Error(`Clearing requires current revision ${run.revision}.`); delete state.runs[scope.key]; return true; }); }
function runById(state: State, runId: string): [string, Run] { const matches = Object.entries(state.runs).filter(([, run]) => run.id === runId); if (!matches.length) throw new Error(`No Execution Run exists with id ${runId}.`); if (matches.length > 1) throw new Error(`Execution Run id ${runId} is ambiguous; refusing to mutate.`); return matches[0]; }
function abandonById(runId: string, revision: number, note: string | null): Run { return withLockedState((state) => { const [key, current] = runById(state, runId); if (terminal(current)) throw new Error("Terminal Execution Runs are immutable."); if (!Number.isSafeInteger(revision) || revision !== current.revision) throw new Error(`Abandoning ${runId} requires current revision ${current.revision}.`); const next = structuredClone(current); next.stage = "abandoned"; next.abandoned_note = note ?? "Abandoned by human"; next.revision += 1; next.updated_at = now(); next.history = [...next.history, history(next.revision, "abandoned", next.abandoned_note)].slice(-MAX_HISTORY); validateRun(key, next); state.runs[key] = next; return structuredClone(next); }); }
function clearById(runId: string, revision: number): Run { return withLockedState((state) => { const [key, current] = runById(state, runId); if (!terminal(current)) throw new Error("Only terminal Execution Runs may be cleared."); if (!Number.isSafeInteger(revision) || revision !== current.revision) throw new Error(`Clearing ${runId} requires current revision ${current.revision}.`); delete state.runs[key]; return structuredClone(current); }); }
function boundedRun(run: Run): Record<string, unknown> { return { id: run.id, revision: run.revision, stage: run.stage, summary: run.summary, acceptance_criteria: run.acceptance_criteria, non_goals: run.non_goals, protected_contracts: run.protected_contracts, open_questions: run.open_questions, suggested_checks: run.suggested_checks, targets: run.targets.slice(0, 24), lanes: run.lanes.map((lane) => ({ ...lane, reports: lane.reports.slice(-2).map((report) => ({ ...report, changed_paths: report.changed_paths.slice(0, 16), checks: report.checks.slice(0, 12), refs: report.refs.slice(0, 12) })) })), blockers: run.blockers.slice(-12), goal_refs: run.goal_refs, handoff: run.handoff ? { final_handoff: run.handoff.final_handoff, unresolved_items: run.handoff.unresolved_items.slice(0, 12), suggested_checks: run.handoff.suggested_checks.slice(0, 12), goal_refs: run.handoff.goal_refs.slice(0, 12), included: run.handoff.included, exceptions: run.handoff.exceptions } : null, history: run.history.slice(-12) }; }
function response(run: Run | null) { return { status: run ? "ok" : "empty", run: run ? boundedRun(run) : null, execution_handoff: run && run.stage !== "plan" && run.stage !== "abandoned" ? { run_id: run.id, revision: run.revision, workspace: run.workspace, summary: run.summary, acceptance_criteria: run.acceptance_criteria.slice(0, 12), non_goals: run.non_goals.slice(0, 12), protected_contracts: run.protected_contracts.slice(0, 12), targets: run.targets.slice(0, 24), lanes: run.lanes.map((lane) => ({ id: lane.id, required: lane.required, executor_kind: lane.executor_kind, executor_label: lane.executor_label, role: lane.role, worktree_ref: lane.worktree_ref, status: lane.status, session_refs: lane.session_refs.slice(0, MAX_SESSION_REFS) })), suggested_checks: run.suggested_checks.slice(0, 12), goal_refs: run.goal_refs.slice(0, 12), ux_workflow_refs: run.ux_workflow_refs.slice(0, 12), boundary: "Structured coordination metadata only; the caller owns prompt construction and executor control." } : null, code_evidence_intake: run?.handoff?.code_evidence_intake ? { run_id: run.handoff.code_evidence_intake.run_id, revision: run.handoff.code_evidence_intake.revision, workspace: run.handoff.code_evidence_intake.workspace, goal_refs: run.handoff.code_evidence_intake.goal_refs.slice(0, 12), changed_paths: run.handoff.code_evidence_intake.changed_paths.slice(0, 64), suggested_checks: run.handoff.code_evidence_intake.suggested_checks.slice(0, 12), refs: run.handoff.code_evidence_intake.refs.slice(0, 12), disclaimer: run.handoff.code_evidence_intake.disclaimer } : null, open_blockers: run ? openBlockers(run).slice(0, 12) : [], boundary: "All reports, paths, checks, sessions, worktrees, and cross-workflow references are caller metadata, never proof." }; }
function format(run: Run): string { const stageMeaning = run.stage === "reported" ? "Reported means lane reports were recorded; it does not mean successful, verified, accepted, merged, or Goal complete." : run.stage === "handed_off" ? "Handed off means scope ownership moved forward; it does not mean verified or Goal complete." : "Execution Run state is coordination metadata, not Goal completion."; return [`Mahiro Execution Run · ${run.stage} · revision ${run.revision}`, `Summary: ${run.summary}`, `Targets: ${run.targets.length} · lanes: ${run.lanes.length} · open blockers: ${openBlockers(run).length}`, `Reports: ${run.lanes.reduce((count, item) => count + item.reports.length, 0)} · handoff: ${run.handoff ? "recorded" : "not recorded"}`, stageMeaning, "Metadata is coordination only, not proof."].join("\n"); }
function compactRunSummary(summary: string, max = 140): string { return summary.length <= max ? summary : `${summary.slice(0, Math.max(0, max - 1))}…`; }
function formatRunList(runs: Run[]): string { const remaining = runs.filter((run) => !terminal(run)); if (!remaining.length) return "No Execution Runs need attention."; return ["Mahiro Execution Runs needing attention · human-only inventory", ...remaining.sort((left, right) => right.updated_at.localeCompare(left.updated_at)).map((run) => `${run.id} · ${run.stage} · Goal refs: ${run.goal_refs.length ? run.goal_refs.join(", ") : "none"} · rev ${run.revision} · ${run.conversation_id} · ${run.updated_at.slice(0, 10)} · ${compactRunSummary(run.summary)}`), "Terminal handed-off/abandoned runs are intentionally hidden. Goal refs are declared coordination metadata, not live mission validation."].join("\n"); }
function output(message: string, success = true) { return { type: "output" as const, output: message, success }; }
function command(ctx: any) { const input = String(ctx?.args ?? "").trim(); try { const scope = scopeFrom(ctx); if (!input || input === "status") { const run = getRun(scope); return output(run ? format(run) : "No Execution Run exists for this scope."); } if (input === "list") return output(formatRunList(Object.values(readState().runs).map((run) => structuredClone(run)))); if (input === "unlock --force") return output(forceUnlock() ? "Execution Run mutation lock quarantined and removed." : "No Execution Run mutation lock exists."); if (input === "unlock") return output("Use /mh-run unlock --force only after confirming the owner is gone.", false); const crossClear = input.match(/^clear\s+(\S+)\s+(\d+)$/); if (crossClear) { const cleared = clearById(id(crossClear[1], "run_id", 160), Number(crossClear[2])); return output(`Execution Run cleared: ${cleared.id} · ${cleared.conversation_id} · revision ${cleared.revision}.`); } const clearMatch = input.match(/^clear\s+(\d+)$/); if (clearMatch) return output(clear(scope, Number(clearMatch[1])) ? "Execution Run cleared." : "No Execution Run exists for this scope."); const crossAbandon = input.match(/^abandon\s+(\S+)\s+(\d+)(?:\s+([\s\S]+))?$/); if (crossAbandon) return output(format(abandonById(id(crossAbandon[1], "run_id", 160), Number(crossAbandon[2]), optionalText(crossAbandon[3], "note", MAX_LONG)))); const abandonMatch = input.match(/^abandon\s+(\d+)(?:\s+([\s\S]+))?$/); if (abandonMatch) return output(format(abandon(scope, Number(abandonMatch[1]), optionalText(abandonMatch[2], "note", MAX_LONG)))); return output("Usage: /mh-run status | list | clear <revision> | clear <run-id> <revision> | abandon <revision> [note] | abandon <run-id> <revision> [note] | unlock --force", false); } catch (error) { return output(error instanceof Error ? error.message : String(error), false); } }
const STRING_ARRAY = (max: number, min = 0) => ({ type: "array", minItems: min, maxItems: max, items: { type: "string", maxLength: MAX_TEXT } });
const SESSION_REFS_SCHEMA = { ...STRING_ARRAY(MAX_SESSION_REFS), description: "Executor-owned session references. Letta subagent entries must use letta:agent=<agent-id>;conversation=<conversation-id>; other executors retain their native receipt format." };
const TARGET_SCHEMA = { type: "object", required: ["id", "path", "intent", "worktree_ref", "access", "writer_lane_id", "reader_lane_ids"], properties: { id: { type: "string", maxLength: 120 }, path: { type: "string", maxLength: 4096 }, intent: { type: "string", maxLength: MAX_LONG }, worktree_ref: { type: "string", maxLength: 240 }, access: { type: "string", enum: ["read", "write"] }, writer_lane_id: { type: ["string", "null"], maxLength: 120 }, reader_lane_ids: STRING_ARRAY(MAX_LANES) }, additionalProperties: false };
const QUESTION_SCHEMA = { type: "object", required: ["question", "blocking"], properties: { question: { type: "string", maxLength: MAX_TEXT }, blocking: { type: "boolean" } }, additionalProperties: false };
const CREATE_PARAMETERS = { type: "object", required: ["summary", "acceptance_criteria", "targets", "non_goals", "protected_contracts", "open_questions", "suggested_checks"], properties: { workspace: { type: "string", maxLength: 4096 }, summary: { type: "string", maxLength: MAX_LONG }, acceptance_criteria: STRING_ARRAY(MAX_REFS, 1), non_goals: STRING_ARRAY(MAX_REFS), protected_contracts: STRING_ARRAY(MAX_REFS), open_questions: { type: "array", maxItems: MAX_REFS, items: QUESTION_SCHEMA }, suggested_checks: STRING_ARRAY(MAX_CHECKS, 1), worktree_refs: STRING_ARRAY(MAX_WORKTREES, 1), targets: { type: "array", minItems: 1, maxItems: MAX_TARGETS, items: TARGET_SCHEMA }, goal_refs: STRING_ARRAY(MAX_REFS), ux_workflow_refs: STRING_ARRAY(MAX_REFS), code_evidence_refs: STRING_ARRAY(MAX_REFS), replace_terminal: { type: "boolean" }, expected_run_id: { type: "string", maxLength: 160 }, expected_revision: { type: "integer", minimum: 1 } }, additionalProperties: false };
const UPDATE_PARAMETERS = { type: "object", required: ["action", "expected_run_id", "expected_revision"], properties: { workspace: { type: "string", maxLength: 4096 }, action: { type: "string", enum: ["add_lane", "set_lane_sessions", "set_lane_status", "add_report", "add_blocker", "resolve_blocker", "set_open_questions", "set_goal_refs", "set_handoff", "set_stage"] }, expected_run_id: { type: "string", maxLength: 160 }, expected_revision: { type: "integer", minimum: 1 }, lane_id: { type: "string", maxLength: 120 }, required: { type: "boolean" }, executor_kind: { type: "string", enum: EXECUTORS }, executor_label: { type: ["string", "null"], maxLength: MAX_TEXT }, role: { type: "string", enum: ROLES }, worktree_ref: { type: ["string", "null"], maxLength: 240 }, status: { type: "string", enum: LANE_STATUSES }, report_id: { type: "string", maxLength: 120 }, summary: { type: "string", maxLength: MAX_LONG }, session_refs: SESSION_REFS_SCHEMA, changed_paths: { type: "array", maxItems: MAX_PATHS_PER_REPORT, items: { type: "string", maxLength: 4096 } }, checks: STRING_ARRAY(MAX_CHECKS), refs: STRING_ARRAY(MAX_REFS), blocker_id: { type: "string", maxLength: 120 }, stage: { type: "string", enum: STAGES }, open_questions: { type: "array", maxItems: MAX_REFS, items: QUESTION_SCHEMA }, final_handoff: { type: "string", maxLength: MAX_LONG }, unresolved_items: STRING_ARRAY(MAX_REFS), suggested_checks: STRING_ARRAY(MAX_CHECKS), goal_refs: STRING_ARRAY(MAX_REFS), included: STRING_ARRAY(MAX_LANES), exceptions: STRING_ARRAY(MAX_LANES) }, additionalProperties: false };
const EXECUTION_RUN_PARAMETERS = { type: "object", required: ["operation"], properties: { operation: { type: "string", enum: ["get", "create", "update"] }, ...CREATE_PARAMETERS.properties, ...UPDATE_PARAMETERS.properties }, additionalProperties: false };
function requireOperationFields(args: Record<string, any>, fields: string[], operation: string) { const missing = fields.filter((field) => args[field] === undefined); if (missing.length) throw new Error(`Execution Run ${operation} requires: ${missing.join(", ")}`); }
export const __testing = process.env.MAHIRO_EXECUTION_RUN_TESTING === "1" ? Object.freeze({ readState, writeState, acquireStateLock, releaseStateLock, forceUnlock, statePath: STATE_PATH, lockPath: LOCK_PATH, limits: Object.freeze({ MAX_STATE_BYTES, MAX_LANES, MAX_WORKTREES, MAX_TARGETS, MAX_BLOCKERS, MAX_HISTORY, MAX_SESSION_REFS, MAX_REPORTS, MAX_PATHS_PER_REPORT, MAX_PATHS_PER_RUN, MAX_CHECKS, MAX_REFS, MAX_TEXT, MAX_LONG }) }) : null;
export default function activate(letta: any) {
  if (existsSync(DISABLE_PATH)) return;
  const disposers: Array<() => void> = [];
  if (letta.capabilities?.commands && letta.commands?.register) disposers.push(letta.commands.register({ id: "mh-run", description: "Coordinate a bounded execution run without controlling executors or asserting proof", args: "status|list|clear <revision>|clear <run-id> <revision>|abandon <revision> [note]|abandon <run-id> <revision> [note]|unlock --force", run: command }));
  if (letta.capabilities?.tools && letta.tools?.register) {
    disposers.push(letta.tools.register({
      name: "mh_execution_run",
      description: "Read, create, or update the scoped bounded Execution Run through one operation selector. Metadata remains caller-supplied coordination data, never proof.",
      parameters: EXECUTION_RUN_PARAMETERS,
      parallelSafe: false,
      run(ctx: any) {
        const { operation, ...args } = ctx.args ?? {};
        if (operation === "get") return response(getRun(scopeFrom(ctx, args)));
        if (operation === "create") {
          requireOperationFields(args, CREATE_PARAMETERS.required, operation);
          return response(createRun(scopeFrom(ctx, args), args));
        }
        if (operation === "update") {
          requireOperationFields(args, UPDATE_PARAMETERS.required, operation);
          return response(updateRun(scopeFrom(ctx, args), args));
        }
        throw new Error("Execution Run operation must be get, create, or update");
      },
    }));
  }
  if (!disposers.length) { letta.diagnostics?.report?.({ severity: "warning", message: "Mahiro Execution Run requires commands or tools capability." }); return; }
  return () => { if (letta.signal?.aborted) return; for (const dispose of disposers.reverse()) dispose(); };
}
