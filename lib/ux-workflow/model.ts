/** Canonical Mods UX metadata semantics, native identity/envelope adaptation only.
 * References are opaque strings. No artifact, Goal, Evidence or executor access.
 */
import { randomUUID } from "node:crypto";
const MAX_SCOPES = 256;
export function emptyState(profile: string, project: string): WorkflowState {
  return { schemaVersion: 1, profile, project, sequence: 0, runs: {} };
}
export function runAt(state: WorkflowState, scope: Scope): UXRun | null {
  return Object.hasOwn(state.runs, scope.sessionId)
    ? state.runs[scope.sessionId]
    : null;
}
function closed(value: any, keys: string) {
  const allowed = keys.split(" ");
  if (
    !isRecord(value) ||
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    allowed.some((k) => !Object.hasOwn(value, k))
  )
    throw Error("Invalid closed UX stored object");
}
export function validateState(
  state: any,
  profile: string,
  project: string,
): asserts state is WorkflowState {
  closed(state, "schemaVersion profile project sequence runs");
  if (
    state.schemaVersion !== 1 ||
    state.profile !== profile ||
    state.project !== project ||
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 0 ||
    !isRecord(state.runs) ||
    Object.keys(state.runs).length > MAX_SCOPES
  )
    throw Error("Invalid native UX state envelope");
  for (const [key, run] of Object.entries(state.runs) as [string, UXRun][]) {
    closed(
      run,
      "id revision summary stage workspace profile sessionId frame research brief concepts direction handoff review reviewIterations blockers createdAt updatedAt history",
    );
    if (
      run.profile !== profile ||
      run.workspace !== project ||
      key !== run.sessionId ||
      ["__proto__", "constructor", "prototype"].includes(key)
    )
      throw Error("Invalid UX native scope");
    if (run.frame)
      closed(run.frame, "problem audience desiredOutcome constraints");
    if (run.brief) closed(run.brief, "owner mode reference summary createdAt");
    if (run.direction) {
      closed(run.direction, "conceptId summary proposedAt approval");
      closed(run.direction.approval, "status note at actor");
    }
    if (run.handoff) {
      closed(
        run.handoff,
        "readiness brief acceptance_criteria non_goals constraints open_questions protected_contracts target_matrix suggested_checks goal_criterion_refs createdAt",
      );
      closed(run.handoff.brief, "owner mode reference summary createdAt");
      for (const [name, fields] of [
        ["open_questions", "question blocking"],
        ["target_matrix", "target intent"],
        ["suggested_checks", "kind summary"],
      ]) {
        if (!Array.isArray((run.handoff as any)[name]))
          throw Error("Invalid UX handoff list");
        for (const item of (run.handoff as any)[name]) closed(item, fields);
      }
    }
    if (run.review) {
      closed(
        run.review,
        "iteration verdict summary findings evidenceRefs codeEvidenceRefs approval createdAt",
      );
      closed(run.review.approval, "status note at actor");
      if (!Array.isArray(run.review.findings)) throw Error("Invalid findings");
      for (const finding of run.review.findings)
        closed(finding, "severity summary reference");
    }
    for (const [name, fields] of [
      ["research", "id kind summary reference createdAt"],
      ["concepts", "id title summary tradeoffs createdAt"],
      ["blockers", "id summary status createdAt resolvedAt"],
      ["history", "at actor action summary revision"],
    ]) {
      if (!Array.isArray((run as any)[name]))
        throw Error("Invalid UX collection");
      for (const item of (run as any)[name]) closed(item, fields);
    }
    validateStoredRun(key, run);
  }
}
export function applyUX(
  state: WorkflowState,
  scope: Scope,
  operation: "create" | "update" | "approve" | "reject" | "reopen" | "clear",
  args: any,
): UXRun | boolean {
  if (
    !isBoundedString(scope.sessionId, 240) ||
    ["__proto__", "constructor", "prototype"].includes(scope.sessionId)
  )
    throw Error("Native session required");
  if (operation === "create") {
    validateInput(CREATE_PARAMETERS, args);
    return createRun(state, scope, args);
  }
  if (operation === "update") {
    validateUpdate(args);
    return updateFromTool(state, scope, args);
  }
  if (operation === "clear")
    return clearRun(state, scope, args.expected_revision);
  if (operation === "reopen")
    return reopen(
      state,
      scope,
      args.expected_revision,
      optionalField(args.note, "note"),
    );
  return humanApproval(
    state,
    scope,
    args.gate,
    args.expected_revision,
    args.concept_id ?? null,
    optionalField(args.note, "note"),
    operation === "approve",
  );
}
/** The only runtime callers of human operations are exact-target confirmed commands. */
export function validateInput(schema: any, value: any, depth = 0): void {
  if (depth > 6 || !schema) throw Error("UX input depth/schema invalid");
  if (schema.type === "object") {
    if (
      !isRecord(value) ||
      Object.keys(value).length > 40 ||
      (schema.required ?? []).some((k: string) => !Object.hasOwn(value, k)) ||
      Object.keys(value).some((k) => !Object.hasOwn(schema.properties, k))
    )
      throw Error("Invalid closed UX input object");
    for (const [k, v] of Object.entries(value))
      validateInput(schema.properties[k], v, depth + 1);
  } else if (schema.type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? 24)
    )
      throw Error("UX input array bound");
    for (const item of value) validateInput(schema.items, item, depth + 1);
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? 0))
      throw Error("UX integer required");
  } else if (
    typeof value !== schema.type ||
    (schema.type === "string" &&
      (value.length > (schema.maxLength ?? 1200) ||
        (schema.pattern && !new RegExp(schema.pattern).test(value))))
  )
    throw Error("Invalid UX scalar");
  if (schema.enum && !schema.enum.includes(value))
    throw Error("Invalid UX enum");
}
const actionFields: Record<string, string> = {
  set_frame: "problem audience desired_outcome constraints",
  add_research: "kind summary reference",
  set_brief: "brief",
  add_concept: "concept_id title summary tradeoffs",
  propose_direction: "concept_id summary",
  set_handoff: "handoff",
  set_phase: "phase",
  set_review: "verdict summary findings evidence_refs code_evidence_refs",
  add_blocker: "summary",
  resolve_blocker: "blocker_id",
  complete: "",
};
export function validateUpdate(args: any) {
  validateInput(UPDATE_PARAMETERS, args);
  const fields = [
    "action",
    "expected_revision",
    ...(actionFields[args.action] ?? "").split(" "),
  ];
  if (Object.keys(args).some((k) => !fields.includes(k)))
    throw Error("Unexpected UX action field");
}
const MAX_TEXT = 1_200;
const MAX_LONG_TEXT = 4_000;
const MAX_LIST = 24;
const MAX_RESEARCH = 30;
const MAX_CONCEPTS = 12;
const MAX_BLOCKERS = 30;
const MAX_HISTORY = 80;
const MAX_REVIEW_ITERATIONS = 3;

const STAGES = [
  "frame",
  "discovery",
  "design",
  "direction_approval",
  "handoff",
  "implementation",
  "review",
  "complete",
] as const;
type Stage = (typeof STAGES)[number];
type Actor = "agent" | "human";
type ReviewVerdict = "Ready" | "Needs Revision" | "Not Ready";
type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Scope {
  profile: string;
  project: string;
  sessionId: string;
}
interface Frame {
  problem: string;
  audience: string;
  desiredOutcome: string;
  constraints: string[];
}
interface ResearchItem {
  id: string;
  kind: string;
  summary: string;
  reference: string | null;
  createdAt: string;
}
interface Brief {
  owner: string;
  mode: string;
  reference: string;
  summary: string;
  createdAt: string;
}
interface Concept {
  id: string;
  title: string;
  summary: string;
  tradeoffs: string[];
  createdAt: string;
}
interface Approval {
  status: ApprovalStatus;
  note: string | null;
  at: string | null;
  actor: "human" | null;
}
interface Direction {
  conceptId: string;
  summary: string;
  proposedAt: string;
  approval: Approval;
}
interface OpenQuestion {
  question: string;
  blocking: boolean;
}
interface TargetItem {
  target: string;
  intent: string;
}
interface SuggestedCheck {
  kind: string;
  summary: string;
}
interface Handoff {
  readiness: "prototype_ready" | "implementation_ready";
  brief: Brief;
  acceptance_criteria: string[];
  non_goals: string[];
  constraints: string[];
  open_questions: OpenQuestion[];
  protected_contracts: string[];
  target_matrix: TargetItem[];
  suggested_checks: SuggestedCheck[];
  goal_criterion_refs: string[];
  createdAt: string;
}
interface Finding {
  severity: "low" | "medium" | "high";
  summary: string;
  reference: string | null;
}
interface Review {
  iteration: number;
  verdict: ReviewVerdict;
  summary: string;
  findings: Finding[];
  evidenceRefs: string[];
  codeEvidenceRefs: string[];
  approval: Approval;
  createdAt: string;
}
interface Blocker {
  id: string;
  summary: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}
interface HistoryItem {
  at: string;
  actor: Actor;
  action: string;
  summary: string;
  revision: number;
}
export interface UXRun {
  id: string;
  revision: number;
  summary: string;
  stage: Stage;
  workspace: string;
  profile: string;
  sessionId: string;
  frame: Frame | null;
  research: ResearchItem[];
  brief: Brief | null;
  concepts: Concept[];
  direction: Direction | null;
  handoff: Handoff | null;
  review: Review | null;
  reviewIterations: number;
  blockers: Blocker[];
  createdAt: string;
  updatedAt: string;
  history: HistoryItem[];
}
export interface WorkflowState {
  schemaVersion: 1;
  profile: string;
  project: string;
  sequence: number;
  runs: Record<string, UXRun>;
}
function nowIso(): string {
  return new Date().toISOString();
}
function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isBoundedString(value: unknown, max = MAX_TEXT): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
function isIso(value: unknown): value is string {
  if (!isBoundedString(value, 80)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function field(value: unknown, label: string, max = MAX_TEXT): string {
  if (!isBoundedString(value, max))
    throw new Error(
      `${label} must be a non-empty string of at most ${max} characters.`,
    );
  return value.trim();
}
function optionalField(
  value: unknown,
  label: string,
  max = MAX_TEXT,
): string | null {
  return value == null ? null : field(value, label, max);
}
function stringList(
  value: unknown,
  label: string,
  {
    required = false,
    max = MAX_LIST,
  }: { required?: boolean; max?: number } = {},
): string[] {
  if (
    !Array.isArray(value) ||
    (required && value.length === 0) ||
    value.length > max
  ) {
    throw new Error(
      `${label} must be ${required ? "a non-empty" : "an"} array with at most ${max} items.`,
    );
  }
  return value.map((item, index) => field(item, `${label}[${index}]`));
}
function hasUniqueIds(items: unknown[]): boolean {
  const ids = items.map((item: any) => item?.id);
  return (
    ids.every((id) => typeof id === "string") &&
    ids.length === new Set(ids).size
  );
}
function approvalPending(): Approval {
  return { status: "pending", note: null, at: null, actor: null };
}
function validApproval(value: unknown): value is Approval {
  return (
    isRecord(value) &&
    ["pending", "approved", "rejected"].includes(value.status) &&
    (value.note === null || isBoundedString(value.note)) &&
    (value.at === null || isIso(value.at)) &&
    (value.actor === null || value.actor === "human") &&
    (value.status === "pending"
      ? value.at === null && value.actor === null
      : value.at !== null && value.actor === "human")
  );
}

function validateBrief(value: unknown): value is Brief {
  return (
    isRecord(value) &&
    isBoundedString(value.owner) &&
    isBoundedString(value.mode) &&
    isBoundedString(value.reference) &&
    isBoundedString(value.summary, MAX_LONG_TEXT) &&
    isIso(value.createdAt)
  );
}
function sameBrief(left: Brief, right: Brief): boolean {
  return (
    left.owner === right.owner &&
    left.mode === right.mode &&
    left.reference === right.reference &&
    left.summary === right.summary &&
    left.createdAt === right.createdAt
  );
}
function validateStoredRun(
  key: string,
  value: unknown,
): asserts value is UXRun {
  if (!isRecord(value))
    throw new Error(`UX Workflow state entry ${key} must be an object.`);
  for (const [name, max] of Object.entries({
    id: 160,
    summary: MAX_LONG_TEXT,
    workspace: 4096,
    profile: 4096,
    sessionId: 240,
  })) {
    if (!isBoundedString(value[name], max))
      throw new Error(`UX Workflow state entry ${key} has invalid ${name}.`);
  }
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !STAGES.includes(value.stage)
  )
    throw new Error(
      `UX Workflow state entry ${key} has invalid revision or stage.`,
    );
  if (!isIso(value.createdAt) || !isIso(value.updatedAt))
    throw new Error(`UX Workflow state entry ${key} has invalid timestamps.`);
  if (
    !Array.isArray(value.research) ||
    value.research.length > MAX_RESEARCH ||
    !Array.isArray(value.concepts) ||
    value.concepts.length > MAX_CONCEPTS ||
    !Array.isArray(value.blockers) ||
    value.blockers.length > MAX_BLOCKERS ||
    !Array.isArray(value.history) ||
    value.history.length === 0 ||
    value.history.length > MAX_HISTORY ||
    !Number.isSafeInteger(value.reviewIterations) ||
    value.reviewIterations < 0 ||
    value.reviewIterations > MAX_REVIEW_ITERATIONS
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has invalid bounded collections.`,
    );
  }
  if (
    value.frame !== null &&
    (!isRecord(value.frame) ||
      !isBoundedString(value.frame.problem, MAX_LONG_TEXT) ||
      !isBoundedString(value.frame.audience) ||
      !isBoundedString(value.frame.desiredOutcome, MAX_LONG_TEXT) ||
      !Array.isArray(value.frame.constraints) ||
      value.frame.constraints.length > MAX_LIST ||
      value.frame.constraints.some((item: unknown) => !isBoundedString(item)))
  ) {
    throw new Error(`UX Workflow state entry ${key} has invalid frame.`);
  }
  if (value.brief !== null && !validateBrief(value.brief))
    throw new Error(
      `UX Workflow state entry ${key} has an invalid design brief.`,
    );
  if (
    !hasUniqueIds(value.research) ||
    value.research.some(
      (item: unknown) =>
        !isRecord(item) ||
        !isBoundedString(item.id, 120) ||
        !isBoundedString(item.kind, 80) ||
        !isBoundedString(item.summary, MAX_LONG_TEXT) ||
        (item.reference !== null && !isBoundedString(item.reference)) ||
        !isIso(item.createdAt),
    )
  )
    throw new Error(`UX Workflow state entry ${key} has invalid research.`);
  if (
    !hasUniqueIds(value.concepts) ||
    value.concepts.some(
      (item: unknown) =>
        !isRecord(item) ||
        !isBoundedString(item.id, 80) ||
        !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.id) ||
        !isBoundedString(item.title) ||
        !isBoundedString(item.summary, MAX_LONG_TEXT) ||
        !Array.isArray(item.tradeoffs) ||
        item.tradeoffs.length > MAX_LIST ||
        item.tradeoffs.some((entry: unknown) => !isBoundedString(entry)) ||
        !isIso(item.createdAt),
    )
  ) {
    throw new Error(`UX Workflow state entry ${key} has invalid concepts.`);
  }
  if (
    value.direction !== null &&
    (!isRecord(value.direction) ||
      !isBoundedString(value.direction.conceptId, 80) ||
      !isBoundedString(value.direction.summary, MAX_LONG_TEXT) ||
      !isIso(value.direction.proposedAt) ||
      !validApproval(value.direction.approval) ||
      !value.concepts.some(
        (concept: Concept) => concept.id === value.direction.conceptId,
      ))
  ) {
    throw new Error(`UX Workflow state entry ${key} has invalid direction.`);
  }
  if (value.handoff !== null)
    validateStoredHandoff(key, value.handoff, value.brief);
  if (value.review !== null)
    validateStoredReview(key, value.review, value.reviewIterations);
  if ((value.review === null) !== (value.reviewIterations === 0)) {
    throw new Error(
      `UX Workflow state entry ${key} has a review counter that does not match its review artifact.`,
    );
  }
  if (
    !hasUniqueIds(value.blockers) ||
    value.blockers.some(
      (item: unknown) =>
        !isRecord(item) ||
        !isBoundedString(item.id, 120) ||
        !isBoundedString(item.summary, MAX_LONG_TEXT) ||
        !["open", "resolved"].includes(item.status) ||
        !isIso(item.createdAt) ||
        (item.resolvedAt !== null && !isIso(item.resolvedAt)) ||
        (item.status === "open"
          ? item.resolvedAt !== null
          : item.resolvedAt === null),
    )
  ) {
    throw new Error(`UX Workflow state entry ${key} has invalid blockers.`);
  }
  for (const item of value.history) {
    if (
      !isRecord(item) ||
      !isIso(item.at) ||
      !["agent", "human"].includes(item.actor) ||
      !isBoundedString(item.action, 120) ||
      !isBoundedString(item.summary, 500) ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 1 ||
      item.revision > value.revision
    ) {
      throw new Error(`UX Workflow state entry ${key} has invalid history.`);
    }
  }
  const expectedKey = value.sessionId;
  if (key !== expectedKey)
    throw new Error(
      `UX Workflow state entry ${key} does not match its scoped identity.`,
    );
  if (value.stage !== "frame" && !value.frame)
    throw new Error(`UX Workflow state entry ${key} advanced without a frame.`);
  if (
    value.stage === "frame" &&
    (value.frame ||
      value.research.length ||
      value.brief ||
      value.concepts.length ||
      value.direction ||
      value.handoff ||
      value.review)
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has artifacts ahead of frame stage.`,
    );
  }
  if (
    value.stage === "discovery" &&
    (value.concepts.length || value.direction || value.handoff || value.review)
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has artifacts ahead of discovery stage.`,
    );
  }
  if (
    value.stage === "design" &&
    (value.direction || value.handoff || value.review)
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has artifacts ahead of design stage.`,
    );
  }
  if (value.stage === "direction_approval" && (value.handoff || value.review)) {
    throw new Error(
      `UX Workflow state entry ${key} has artifacts ahead of direction approval.`,
    );
  }
  if (value.stage === "handoff" && value.review)
    throw new Error(
      `UX Workflow state entry ${key} has review evidence ahead of handoff.`,
    );
  if (
    [
      "design",
      "direction_approval",
      "handoff",
      "implementation",
      "review",
      "complete",
    ].includes(value.stage) &&
    !value.brief
  ) {
    throw new Error(
      `UX Workflow state entry ${key} reached design/approval/handoff without a design brief.`,
    );
  }
  if (
    value.stage === "direction_approval" &&
    (!value.direction || value.direction.approval.status !== "pending")
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has invalid pending direction approval.`,
    );
  }
  if (
    ["handoff", "implementation", "review", "complete"].includes(value.stage) &&
    value.direction?.approval.status !== "approved"
  ) {
    throw new Error(
      `UX Workflow state entry ${key} reached handoff without human direction approval.`,
    );
  }
  if (["implementation", "review", "complete"].includes(value.stage)) {
    if (!value.handoff)
      throw new Error(
        `UX Workflow state entry ${key} reached implementation without handoff.`,
      );
    if (
      value.handoff.open_questions.some((item: OpenQuestion) => item.blocking)
    )
      throw new Error(
        `UX Workflow state entry ${key} reached implementation with blocking open questions.`,
      );
  }
  if (["review", "complete"].includes(value.stage) && !value.review)
    throw new Error(
      `UX Workflow state entry ${key} reached review without a review artifact.`,
    );
  if (value.stage === "review" && value.review?.approval.status === "rejected")
    throw new Error(
      `UX Workflow state entry ${key} retained a rejected review in review stage.`,
    );
  if (
    value.stage === "complete" &&
    (value.review?.verdict !== "Ready" ||
      value.review.approval.status !== "approved" ||
      value.blockers.some((item: Blocker) => item.status === "open"))
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has invalid completion state.`,
    );
  }
}
function validateStoredHandoff(
  key: string,
  value: unknown,
  brief: Brief | null,
): asserts value is Handoff {
  if (
    !isRecord(value) ||
    !["prototype_ready", "implementation_ready"].includes(value.readiness) ||
    !validateBrief(value.brief) ||
    !isIso(value.createdAt)
  )
    throw new Error(`UX Workflow state entry ${key} has invalid handoff.`);
  if (!brief || !sameBrief(value.brief, brief)) {
    throw new Error(
      `UX Workflow state entry ${key} has a handoff brief that does not match the recorded design brief.`,
    );
  }
  for (const name of [
    "acceptance_criteria",
    "non_goals",
    "constraints",
    "protected_contracts",
    "goal_criterion_refs",
  ]) {
    if (
      !Array.isArray(value[name]) ||
      value[name].length > MAX_LIST ||
      (name === "acceptance_criteria" && value[name].length === 0) ||
      value[name].some((item: unknown) => !isBoundedString(item))
    )
      throw new Error(
        `UX Workflow state entry ${key} has invalid handoff ${name}.`,
      );
  }
  if (
    !Array.isArray(value.open_questions) ||
    value.open_questions.length > MAX_LIST ||
    value.open_questions.some(
      (item: unknown) =>
        !isRecord(item) ||
        !isBoundedString(item.question) ||
        typeof item.blocking !== "boolean",
    )
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has invalid open_questions.`,
    );
  }
  if (
    !Array.isArray(value.target_matrix) ||
    value.target_matrix.length === 0 ||
    value.target_matrix.length > MAX_LIST ||
    value.target_matrix.some(
      (item: unknown) =>
        !isRecord(item) ||
        !isBoundedString(item.target) ||
        !isBoundedString(item.intent, MAX_LONG_TEXT),
    )
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has invalid target_matrix.`,
    );
  }
  if (
    !Array.isArray(value.suggested_checks) ||
    value.suggested_checks.length > MAX_LIST ||
    value.suggested_checks.some(
      (item: unknown) =>
        !isRecord(item) ||
        !isBoundedString(item.kind, 80) ||
        !isBoundedString(item.summary),
    )
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has invalid suggested_checks.`,
    );
  }
}
function validateStoredReview(
  key: string,
  value: unknown,
  iterations: number,
): asserts value is Review {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.iteration) ||
    value.iteration < 1 ||
    value.iteration !== iterations ||
    value.iteration > MAX_REVIEW_ITERATIONS ||
    !["Ready", "Needs Revision", "Not Ready"].includes(value.verdict) ||
    !isBoundedString(value.summary, MAX_LONG_TEXT) ||
    !validApproval(value.approval) ||
    !isIso(value.createdAt)
  ) {
    throw new Error(`UX Workflow state entry ${key} has invalid review.`);
  }
  if (
    !Array.isArray(value.findings) ||
    value.findings.length > MAX_LIST ||
    value.findings.some(
      (item: unknown) =>
        !isRecord(item) ||
        !["low", "medium", "high"].includes(item.severity) ||
        !isBoundedString(item.summary) ||
        (item.reference !== null && !isBoundedString(item.reference)),
    )
  ) {
    throw new Error(
      `UX Workflow state entry ${key} has invalid review findings.`,
    );
  }
  for (const name of ["evidenceRefs", "codeEvidenceRefs"]) {
    if (
      !Array.isArray(value[name]) ||
      value[name].length > MAX_LIST ||
      value[name].some((item: unknown) => !isBoundedString(item))
    ) {
      throw new Error(
        `UX Workflow state entry ${key} has invalid review ${name}.`,
      );
    }
  }
  if (value.approval.status === "approved" && value.verdict !== "Ready")
    throw new Error(
      `UX Workflow state entry ${key} approves a non-Ready review.`,
    );
}

function history(
  revision: number,
  actor: Actor,
  action: string,
  summary: string,
): HistoryItem {
  return {
    at: nowIso(),
    actor,
    action,
    summary: String(summary).trim().slice(0, 500) || action,
    revision,
  };
}
function createRun(state: WorkflowState, scope: Scope, args: any): UXRun {
  const summary = field(args.summary, "summary", MAX_LONG_TEXT);
  {
    if (state.runs[scope.sessionId])
      throw new Error(
        "An active UX Workflow already exists for this scope. Clear it with its current revision before creating another.",
      );
    if (Object.keys(state.runs).length >= MAX_SCOPES)
      throw new Error(
        `UX Workflow state already contains ${MAX_SCOPES} scoped runs.`,
      );
    const timestamp = nowIso();
    const run: UXRun = {
      id: `mh-ux-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      revision: 1,
      summary,
      stage: "frame",
      workspace: scope.project,
      profile: scope.profile,
      sessionId: scope.sessionId,
      frame: null,
      research: [],
      brief: null,
      concepts: [],
      direction: null,
      handoff: null,
      review: null,
      reviewIterations: 0,
      blockers: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [history(1, "agent", "workflow_created", summary)],
    };
    state.runs[scope.sessionId] = run;
    return structuredClone(run);
  }
}
function mutateRun(
  state: WorkflowState,
  scope: Scope,
  actor: Actor,
  action: string,
  expectedRevision: number,
  summary: string,
  mutate: (run: UXRun) => void,
): UXRun {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new Error(
      "expected_revision must be the current positive UX Workflow revision.",
    );
  {
    const current = state.runs[scope.sessionId];
    if (!current) throw new Error("No UX Workflow exists for this scope.");
    if (current.stage === "complete")
      throw new Error(
        "Completed UX Workflows are immutable. Clear with the current revision before starting another.",
      );
    if (current.revision !== expectedRevision)
      throw new Error(
        `Stale UX Workflow revision: expected ${expectedRevision}, current ${current.revision}. Read the workflow again before updating.`,
      );
    const next = structuredClone(current);
    mutate(next);
    next.revision += 1;
    next.updatedAt = nowIso();
    next.history = [
      ...next.history,
      history(next.revision, actor, action, summary),
    ].slice(-MAX_HISTORY);
    validateStoredRun(scope.sessionId, next);
    state.runs[scope.sessionId] = next;
    return structuredClone(next);
  }
}
function clearRun(
  state: WorkflowState,
  scope: Scope,
  expectedRevision: number,
): boolean {
  {
    const run = state.runs[scope.sessionId];
    if (!run) return false;
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision !== run.revision
    )
      throw new Error(
        `Clearing UX Workflow requires current revision ${run.revision}.`,
      );
    delete state.runs[scope.sessionId];
    return true;
  }
}
function blockerById(run: UXRun, id: unknown): Blocker {
  const blocker = run.blockers.find((item) => item.id === String(id ?? ""));
  if (!blocker)
    throw new Error(
      `Unknown UX Workflow blocker: ${String(id ?? "<missing>")}`,
    );
  return blocker;
}
function openBlockers(run: UXRun): Blocker[] {
  return run.blockers.filter((item) => item.status === "open");
}

function normalizeBrief(value: any, existingCreatedAt?: string): Brief {
  if (!isRecord(value)) throw new Error("brief must be an object.");
  return {
    owner: field(value.owner, "brief.owner"),
    mode: field(value.mode, "brief.mode"),
    reference: field(value.reference, "brief.reference"),
    summary: field(value.summary, "brief.summary", MAX_LONG_TEXT),
    createdAt: existingCreatedAt ?? nowIso(),
  };
}
function normalizeHandoff(value: any, brief: Brief | null): Handoff {
  if (!brief) throw new Error("Record a design brief before handoff.");
  if (
    !isRecord(value) ||
    !["prototype_ready", "implementation_ready"].includes(value.readiness)
  )
    throw new Error(
      "handoff.readiness must be prototype_ready or implementation_ready.",
    );
  const handoffBrief = normalizeBrief(value.brief, brief.createdAt);
  if (!sameBrief(handoffBrief, brief))
    throw new Error(
      "handoff.brief must exactly match the recorded design brief.",
    );
  if (
    !Array.isArray(value.open_questions) ||
    value.open_questions.length > MAX_LIST
  )
    throw new Error(
      `handoff.open_questions must contain at most ${MAX_LIST} items.`,
    );
  const openQuestions = value.open_questions.map((item: any, index: number) => {
    if (!isRecord(item) || typeof item.blocking !== "boolean")
      throw new Error(
        `handoff.open_questions[${index}] requires question and blocking.`,
      );
    return {
      question: field(
        item.question,
        `handoff.open_questions[${index}].question`,
      ),
      blocking: item.blocking,
    };
  });
  if (
    !Array.isArray(value.target_matrix) ||
    value.target_matrix.length === 0 ||
    value.target_matrix.length > MAX_LIST
  )
    throw new Error("handoff.target_matrix must be a non-empty bounded array.");
  const targetMatrix = value.target_matrix.map((item: any, index: number) => {
    if (!isRecord(item))
      throw new Error(`handoff.target_matrix[${index}] must be an object.`);
    return {
      target: field(item.target, `handoff.target_matrix[${index}].target`),
      intent: field(
        item.intent,
        `handoff.target_matrix[${index}].intent`,
        MAX_LONG_TEXT,
      ),
    };
  });
  if (
    !Array.isArray(value.suggested_checks) ||
    value.suggested_checks.length > MAX_LIST
  )
    throw new Error(
      `handoff.suggested_checks must contain at most ${MAX_LIST} items.`,
    );
  const suggestedChecks = value.suggested_checks.map(
    (item: any, index: number) => {
      if (!isRecord(item))
        throw new Error(
          `handoff.suggested_checks[${index}] must be an object.`,
        );
      return {
        kind: field(item.kind, `handoff.suggested_checks[${index}].kind`, 80),
        summary: field(
          item.summary,
          `handoff.suggested_checks[${index}].summary`,
        ),
      };
    },
  );
  return {
    readiness: value.readiness,
    brief: handoffBrief,
    acceptance_criteria: stringList(
      value.acceptance_criteria,
      "handoff.acceptance_criteria",
      { required: true },
    ),
    non_goals: stringList(value.non_goals, "handoff.non_goals"),
    constraints: stringList(value.constraints, "handoff.constraints"),
    open_questions: openQuestions,
    protected_contracts: stringList(
      value.protected_contracts,
      "handoff.protected_contracts",
    ),
    target_matrix: targetMatrix,
    suggested_checks: suggestedChecks,
    goal_criterion_refs: stringList(
      value.goal_criterion_refs,
      "handoff.goal_criterion_refs",
    ),
    createdAt: nowIso(),
  };
}
function normalizeReview(args: any, iteration: number): Review {
  const verdict = String(args.verdict ?? "") as ReviewVerdict;
  if (!["Ready", "Needs Revision", "Not Ready"].includes(verdict))
    throw new Error(
      "review.verdict must be Ready, Needs Revision, or Not Ready.",
    );
  if (!Array.isArray(args.findings) || args.findings.length > MAX_LIST)
    throw new Error(`review.findings must contain at most ${MAX_LIST} items.`);
  const findings = args.findings.map((item: any, index: number) => {
    if (!isRecord(item) || !["low", "medium", "high"].includes(item.severity))
      throw new Error(`review.findings[${index}] has invalid severity.`);
    return {
      severity: item.severity,
      summary: field(item.summary, `review.findings[${index}].summary`),
      reference: optionalField(
        item.reference,
        `review.findings[${index}].reference`,
      ),
    } as Finding;
  });
  return {
    iteration,
    verdict,
    summary: field(args.summary, "review.summary", MAX_LONG_TEXT),
    findings,
    evidenceRefs: stringList(args.evidence_refs, "review.evidence_refs"),
    codeEvidenceRefs: stringList(
      args.code_evidence_refs,
      "review.code_evidence_refs",
    ),
    approval: approvalPending(),
    createdAt: nowIso(),
  };
}

function updateFromTool(state: WorkflowState, scope: Scope, args: any): UXRun {
  const action = String(args.action ?? "");
  const expected = Number(args.expected_revision);
  return mutateRun(
    state,
    scope,
    "agent",
    action,
    expected,
    args.summary ?? action,
    (run) => {
      if (action === "set_frame") {
        if (run.stage !== "frame")
          throw new Error("set_frame is allowed only in frame stage.");
        run.frame = {
          problem: field(args.problem, "problem", MAX_LONG_TEXT),
          audience: field(args.audience, "audience"),
          desiredOutcome: field(
            args.desired_outcome,
            "desired_outcome",
            MAX_LONG_TEXT,
          ),
          constraints: stringList(args.constraints ?? [], "constraints"),
        };
        run.stage = "discovery";
        return;
      }
      if (action === "add_research") {
        if (run.stage !== "discovery")
          throw new Error("add_research is allowed only in discovery stage.");
        if (run.research.length >= MAX_RESEARCH)
          throw new Error(
            `At most ${MAX_RESEARCH} research records are allowed.`,
          );
        run.research.push({
          id: `research-${randomUUID().slice(0, 10)}`,
          kind: field(args.kind, "kind", 80),
          summary: field(args.summary, "summary", MAX_LONG_TEXT),
          reference: optionalField(args.reference, "reference"),
          createdAt: nowIso(),
        });
        return;
      }
      if (action === "set_brief") {
        if (!["discovery", "design"].includes(run.stage))
          throw new Error(
            "set_brief is allowed only during discovery or design.",
          );
        run.brief = normalizeBrief(args.brief);
        return;
      }
      if (action === "add_concept") {
        if (run.stage !== "design")
          throw new Error("add_concept is allowed only in design stage.");
        if (run.concepts.length >= MAX_CONCEPTS)
          throw new Error(`At most ${MAX_CONCEPTS} concepts are allowed.`);
        const id = field(args.concept_id, "concept_id", 80);
        if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id))
          throw new Error(
            "concept_id must use lowercase letters, numbers, underscores, or hyphens.",
          );
        if (run.concepts.some((item) => item.id === id))
          throw new Error(`Concept ${id} already exists.`);
        run.concepts.push({
          id,
          title: field(args.title, "title"),
          summary: field(args.summary, "summary", MAX_LONG_TEXT),
          tradeoffs: stringList(args.tradeoffs ?? [], "tradeoffs"),
          createdAt: nowIso(),
        });
        return;
      }
      if (action === "propose_direction") {
        if (run.stage !== "design")
          throw new Error("propose_direction is allowed only in design stage.");
        if (!run.brief)
          throw new Error(
            "Record the design brief before proposing a direction.",
          );
        const conceptId = field(args.concept_id, "concept_id", 80);
        if (!run.concepts.some((item) => item.id === conceptId))
          throw new Error(`Unknown concept: ${conceptId}`);
        run.direction = {
          conceptId,
          summary: field(args.summary, "summary", MAX_LONG_TEXT),
          proposedAt: nowIso(),
          approval: approvalPending(),
        };
        run.stage = "direction_approval";
        return;
      }
      if (action === "set_handoff") {
        if (
          run.stage !== "handoff" ||
          run.direction?.approval.status !== "approved"
        )
          throw new Error(
            "set_handoff requires human-approved direction and handoff stage.",
          );
        run.handoff = normalizeHandoff(args.handoff, run.brief);
        return;
      }
      if (action === "set_phase") {
        const phase = String(args.phase ?? "") as Stage;
        if (run.stage === "discovery" && phase === "design") {
          if (!run.brief)
            throw new Error(
              "Record the selected design owner and brief before entering design.",
            );
          run.stage = "design";
          return;
        }
        if (run.stage === "handoff" && phase === "implementation") {
          if (
            !run.brief ||
            run.direction?.approval.status !== "approved" ||
            !run.handoff
          )
            throw new Error(
              "Implementation requires a recorded design brief, human direction approval, and valid handoff.",
            );
          if (
            !["prototype_ready", "implementation_ready"].includes(
              run.handoff.readiness,
            )
          )
            throw new Error(
              "Handoff is not prototype_ready or implementation_ready.",
            );
          const blocking = run.handoff.open_questions.filter(
            (item) => item.blocking,
          );
          if (blocking.length)
            throw new Error(
              `Implementation is blocked by open questions: ${blocking.map((item) => item.question).join("; ")}`,
            );
          run.stage = "implementation";
          return;
        }
        if (run.stage === "review" && phase === "implementation") {
          if (run.review?.approval.status === "approved")
            throw new Error(
              "An approved Ready review cannot return to implementation.",
            );
          if (
            run.review?.verdict === "Ready" &&
            run.review.approval.status === "pending"
          )
            throw new Error(
              "A Ready review awaits human approval or rejection.",
            );
          if (run.reviewIterations >= MAX_REVIEW_ITERATIONS)
            throw new Error(
              `Review is limited to ${MAX_REVIEW_ITERATIONS} iterations.`,
            );
          run.stage = "implementation";
          return;
        }
        throw new Error(
          `Invalid UX Workflow transition: ${run.stage} -> ${phase}.`,
        );
      }
      if (action === "set_review") {
        if (run.stage !== "implementation")
          throw new Error(
            "set_review is allowed only after implementation handoff.",
          );
        if (run.reviewIterations >= MAX_REVIEW_ITERATIONS)
          throw new Error(
            `Review is limited to ${MAX_REVIEW_ITERATIONS} iterations.`,
          );
        run.reviewIterations += 1;
        run.review = normalizeReview(args, run.reviewIterations);
        run.stage = "review";
        return;
      }
      if (action === "add_blocker") {
        if (run.blockers.length >= MAX_BLOCKERS)
          throw new Error(`At most ${MAX_BLOCKERS} blockers are allowed.`);
        run.blockers.push({
          id: `blocker-${randomUUID().slice(0, 10)}`,
          summary: field(args.summary, "summary", MAX_LONG_TEXT),
          status: "open",
          createdAt: nowIso(),
          resolvedAt: null,
        });
        return;
      }
      if (action === "resolve_blocker") {
        const blocker = blockerById(run, args.blocker_id);
        blocker.status = "resolved";
        blocker.resolvedAt = nowIso();
        return;
      }
      if (action === "complete") {
        if (
          run.stage !== "review" ||
          run.review?.verdict !== "Ready" ||
          run.review.approval.status !== "approved"
        )
          throw new Error(
            "UX Workflow completion requires a Ready review with explicit human review approval.",
          );
        if (openBlockers(run).length)
          throw new Error(
            `UX Workflow cannot complete with open blockers: ${openBlockers(run)
              .map((item) => item.id)
              .join(", ")}`,
          );
        run.stage = "complete";
        return;
      }
      throw new Error(`Unsupported UX Workflow action: ${action}`);
    },
  );
}
function humanApproval(
  state: WorkflowState,
  scope: Scope,
  gate: "direction" | "review",
  revision: number,
  conceptId: string | null,
  note: string | null,
  approved: boolean,
): UXRun {
  return mutateRun(
    state,
    scope,
    "human",
    `${gate}_${approved ? "approved" : "rejected"}`,
    revision,
    note ?? `${gate} ${approved ? "approved" : "rejected"}`,
    (run) => {
      const approval: Approval = {
        status: approved ? "approved" : "rejected",
        note,
        at: nowIso(),
        actor: "human",
      };
      if (gate === "direction") {
        if (run.stage !== "direction_approval" || !run.direction)
          throw new Error(
            "Direction approval is available only in direction_approval stage.",
          );
        if (conceptId !== run.direction.conceptId)
          throw new Error(
            `Direction approval must name proposed concept ${run.direction.conceptId}.`,
          );
        run.direction.approval = approval;
        run.stage = approved ? "handoff" : "design";
        if (!approved) run.direction = null;
        return;
      }
      if (run.stage !== "review" || !run.review)
        throw new Error("Review approval is available only in review stage.");
      if (approved && run.review.verdict !== "Ready")
        throw new Error("Only a Ready review can receive human approval.");
      run.review.approval = approval;
      if (!approved) {
        if (run.reviewIterations >= MAX_REVIEW_ITERATIONS)
          throw new Error(
            `Review is limited to ${MAX_REVIEW_ITERATIONS} iterations; reject cannot reopen implementation.`,
          );
        run.stage = "implementation";
      }
    },
  );
}
function reopen(
  state: WorkflowState,
  scope: Scope,
  revision: number,
  note: string | null,
): UXRun {
  return mutateRun(
    state,
    scope,
    "human",
    "workflow_reopened",
    revision,
    note ?? "Reopened by human",
    (run) => {
      if (run.stage === "direction_approval") {
        run.direction = null;
        run.stage = "design";
        return;
      }
      if (run.stage === "review") {
        if (run.reviewIterations >= MAX_REVIEW_ITERATIONS)
          throw new Error(
            `Review is limited to ${MAX_REVIEW_ITERATIONS} iterations.`,
          );
        run.review!.approval = {
          status: "rejected",
          note,
          at: nowIso(),
          actor: "human",
        };
        run.stage = "implementation";
        return;
      }
      throw new Error(
        "reopen is available only at direction_approval or review.",
      );
    },
  );
}

const COORDINATOR_BOUNDARY = [
  "Record the selected human, repository contract, model, or procedure as design owner; this runtime does not choose or replace design doctrine.",
  "The recorded design-owner brief is caller-supplied coordination metadata, not proof that the owner/procedure ran or that the brief is visually adequate; human direction approval remains authoritative.",
  "Attach selected UX and Code Evidence to Goal separately with mh_update_goal. This workflow never mutates, verifies, completes, or claims Goal state.",
];
export function response(run: UXRun | null) {
  return {
    status: run ? "ok" : "empty",
    workflow: run,
    open_blockers: run ? openBlockers(run) : [],
    coordinator_boundary: COORDINATOR_BOUNDARY,
  };
}
export function formatRun(run: UXRun): string {
  return [
    `Mahiro UX Workflow · ${run.stage} · revision ${run.revision}`,
    `Summary: ${run.summary}`,
    `Brief: ${run.brief ? `${run.brief.owner} / ${run.brief.mode} / ${run.brief.reference}` : "not recorded"}`,
    `Direction: ${run.direction ? `${run.direction.conceptId} (${run.direction.approval.status})` : "not proposed"}`,
    `Handoff: ${run.handoff?.readiness ?? "not recorded"}`,
    `Review: ${run.review ? `${run.review.verdict}, iteration ${run.review.iteration}/${MAX_REVIEW_ITERATIONS}, ${run.review.approval.status}` : "not recorded"}`,
    `Open blockers: ${openBlockers(run).length}`,
    ...COORDINATOR_BOUNDARY,
  ].join("\n");
}
export const GET_PARAMETERS = {
  type: "object",
  properties: {},
  additionalProperties: false,
};
export const CREATE_PARAMETERS = {
  type: "object",
  required: ["summary"],
  properties: {
    summary: {
      type: "string",
      maxLength: MAX_LONG_TEXT,
      description:
        "Human-approved UX workflow scope summary; creates frame stage only.",
    },
  },
  additionalProperties: false,
};
const BRIEF_SCHEMA = {
  type: "object",
  required: ["owner", "mode", "reference", "summary"],
  properties: {
    owner: {
      type: "string",
      maxLength: MAX_TEXT,
      description:
        "Explicit human, repository contract, model, or procedure that owns this design direction.",
    },
    mode: { type: "string", maxLength: MAX_TEXT },
    reference: { type: "string", maxLength: MAX_TEXT },
    summary: { type: "string", maxLength: MAX_LONG_TEXT },
  },
  additionalProperties: false,
};
export const UPDATE_PARAMETERS = {
  type: "object",
  required: ["action", "expected_revision"],
  properties: {
    action: {
      type: "string",
      enum: [
        "set_frame",
        "add_research",
        "set_brief",
        "add_concept",
        "propose_direction",
        "set_handoff",
        "set_phase",
        "set_review",
        "add_blocker",
        "resolve_blocker",
        "complete",
      ],
    },
    expected_revision: { type: "integer", minimum: 1 },
    problem: { type: "string", maxLength: MAX_LONG_TEXT },
    audience: { type: "string", maxLength: MAX_TEXT },
    desired_outcome: { type: "string", maxLength: MAX_LONG_TEXT },
    constraints: {
      type: "array",
      maxItems: MAX_LIST,
      items: { type: "string", maxLength: MAX_TEXT },
    },
    kind: { type: "string", maxLength: 80 },
    summary: { type: "string", maxLength: MAX_LONG_TEXT },
    reference: { type: "string", maxLength: MAX_TEXT },
    brief: BRIEF_SCHEMA,
    concept_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
    title: { type: "string", maxLength: MAX_TEXT },
    tradeoffs: {
      type: "array",
      maxItems: MAX_LIST,
      items: { type: "string", maxLength: MAX_TEXT },
    },
    phase: { type: "string", enum: STAGES },
    blocker_id: { type: "string", maxLength: 120 },
    handoff: {
      type: "object",
      required: [
        "readiness",
        "brief",
        "acceptance_criteria",
        "non_goals",
        "constraints",
        "open_questions",
        "protected_contracts",
        "target_matrix",
        "suggested_checks",
        "goal_criterion_refs",
      ],
      properties: {
        readiness: {
          type: "string",
          enum: ["prototype_ready", "implementation_ready"],
        },
        brief: BRIEF_SCHEMA,
        acceptance_criteria: {
          type: "array",
          minItems: 1,
          maxItems: MAX_LIST,
          items: { type: "string", maxLength: MAX_TEXT },
        },
        non_goals: {
          type: "array",
          maxItems: MAX_LIST,
          items: { type: "string", maxLength: MAX_TEXT },
        },
        constraints: {
          type: "array",
          maxItems: MAX_LIST,
          items: { type: "string", maxLength: MAX_TEXT },
        },
        open_questions: {
          type: "array",
          maxItems: MAX_LIST,
          items: {
            type: "object",
            required: ["question", "blocking"],
            properties: {
              question: { type: "string", maxLength: MAX_TEXT },
              blocking: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
        protected_contracts: {
          type: "array",
          maxItems: MAX_LIST,
          items: { type: "string", maxLength: MAX_TEXT },
        },
        target_matrix: {
          type: "array",
          minItems: 1,
          maxItems: MAX_LIST,
          items: {
            type: "object",
            required: ["target", "intent"],
            properties: {
              target: { type: "string", maxLength: MAX_TEXT },
              intent: { type: "string", maxLength: MAX_LONG_TEXT },
            },
            additionalProperties: false,
          },
        },
        suggested_checks: {
          type: "array",
          maxItems: MAX_LIST,
          items: {
            type: "object",
            required: ["kind", "summary"],
            properties: {
              kind: { type: "string", maxLength: 80 },
              summary: { type: "string", maxLength: MAX_TEXT },
            },
            additionalProperties: false,
          },
        },
        goal_criterion_refs: {
          type: "array",
          maxItems: MAX_LIST,
          items: { type: "string", maxLength: MAX_TEXT },
        },
      },
      additionalProperties: false,
    },
    verdict: { type: "string", enum: ["Ready", "Needs Revision", "Not Ready"] },
    findings: {
      type: "array",
      maxItems: MAX_LIST,
      items: {
        type: "object",
        required: ["severity", "summary"],
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high"] },
          summary: { type: "string", maxLength: MAX_TEXT },
          reference: { type: "string", maxLength: MAX_TEXT },
        },
        additionalProperties: false,
      },
    },
    evidence_refs: {
      type: "array",
      maxItems: MAX_LIST,
      items: { type: "string", maxLength: MAX_TEXT },
    },
    code_evidence_refs: {
      type: "array",
      maxItems: MAX_LIST,
      items: { type: "string", maxLength: MAX_TEXT },
    },
  },
  additionalProperties: false,
};
