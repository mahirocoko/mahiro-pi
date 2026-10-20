import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
const SCHEMA_VERSION = 1;
const MAX_SCOPES = 256;
const MAX_CHANGE_ENTRIES = 512;
const MAX_RECORDS = 50;
const MAX_TEXT_CHARS = 500;
const MAX_REFERENCE_CHARS = 500;
const MAX_PATH_CHARS = 4096;

export type EvidenceKind =
  | "file"
  | "command"
  | "test"
  | "browser"
  | "native"
  | "manual"
  | "other";
export type EvidenceResult = "passed" | "failed" | "observed" | "blocked";

export interface ChangeEntry {
  status: string;
  path: string;
  previousPath: string | null;
}

export interface ChangeLane {
  total: number;
  omitted: number;
  digest: string;
  entries: ChangeEntry[];
  shortStat: string | null;
}

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  result: EvidenceResult;
  summary: string;
  reference: string | null;
  command: string | null;
  criterionIds: string[];
  collectionId: string;
  headCommit: string;
  actor: "agent";
  createdAt: string;
}

export interface CodeEvidenceReport {
  revision: number;
  collectionId: string;
  fingerprint: string;
  profile: string;
  sessionId: string;
  requestedWorkspace: string;
  repositoryRoot: string;
  branch: string | null;
  headCommit: string;
  baseCommit: string | null;
  baseSource: "explicit" | "upstream" | "none";
  baseReference: string | null;
  collectedAt: string;
  updatedAt: string;
  staged: ChangeLane;
  unstaged: ChangeLane;
  untracked: ChangeLane;
  baseToHead: ChangeLane | null;
  records: EvidenceRecord[];
  freshness?: {
    isCurrent: boolean;
    currentHead: string | null;
    reason: string;
  };
}

export interface EvidenceState {
  schemaVersion: 1;
  profile: string;
  project: string;
  sequence: number;
  reports: Record<string, CodeEvidenceReport>;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function compactText(value: unknown, max = MAX_TEXT_CHARS): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function evidenceField(
  value: unknown,
  label: string,
  max: number,
): string {
  const raw = String(value ?? "");
  if (!raw.trim()) throw new Error(`${label} must not be empty.`);
  if (raw.length > max)
    throw new Error(
      `${label} exceeds the bounded ${max}-character summary limit.`,
    );
  if (/[\u0000-\u001f\u007f]/.test(raw))
    throw new Error(
      `${label} must be a single-line summary/reference, not raw output.`,
    );
  if (/(?:^|\s)(?:diff --git|@@\s|--- a\/|\+\+\+ b\/)/i.test(raw))
    throw new Error(
      `${label} appears to contain raw diff output; record a concise summary/reference instead.`,
    );
  return raw.trim();
}

export function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isBoundedString(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}

export function isIsoTimestamp(value: unknown): value is string {
  if (!isBoundedString(value, 80)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export interface Scope {
  profile: string;
  project: string;
  sessionId: string;
}
export function emptyState(profile: string, project: string): EvidenceState {
  return { schemaVersion: 1, profile, project, sequence: 0, reports: {} };
}
export function scopeKey(profile: string, sessionId: string, project: string) {
  return JSON.stringify([profile, sessionId, project]);
}
export function validateState(
  state: any,
  profile: string,
  project: string,
): asserts state is EvidenceState {
  if (
    !isRecord(state) ||
    state.schemaVersion !== 1 ||
    state.profile !== profile ||
    state.project !== project ||
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 0 ||
    !isRecord(state.reports) ||
    Object.keys(state.reports).length > 256
  )
    throw Error("Invalid Evidence envelope");
  for (const [key, report] of Object.entries(state.reports)) {
    validateReport(key, report);
    if (report.profile !== profile || report.repositoryRoot !== project)
      throw Error("Foreign Evidence report");
  }
}
export function reportAt(state: EvidenceState, scope: Scope) {
  return (
    state.reports[scopeKey(scope.profile, scope.sessionId, scope.project)] ??
    null
  );
}
export function validateLane(lane: unknown): lane is ChangeLane {
  if (
    !isRecord(lane) ||
    !Number.isSafeInteger(lane.total) ||
    lane.total < 0 ||
    !Number.isSafeInteger(lane.omitted) ||
    lane.omitted < 0 ||
    typeof lane.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(lane.digest) ||
    !Array.isArray(lane.entries) ||
    lane.entries.length > MAX_CHANGE_ENTRIES ||
    lane.total !== lane.entries.length + lane.omitted ||
    (lane.shortStat !== null && !isBoundedString(lane.shortStat, 500))
  )
    return false;
  return lane.entries.every(
    (entry: unknown) =>
      isRecord(entry) &&
      isBoundedString(entry.status, 16) &&
      isBoundedString(entry.path, MAX_PATH_CHARS) &&
      (entry.previousPath === null ||
        isBoundedString(entry.previousPath, MAX_PATH_CHARS)),
  );
}

export function validateReport(
  key: string,
  value: unknown,
): asserts value is CodeEvidenceReport {
  if (!isRecord(value))
    throw new Error(`Code Evidence state entry ${key} must be an object.`);
  for (const field of [
    "collectionId",
    "profile",
    "sessionId",
    "requestedWorkspace",
    "repositoryRoot",
    "headCommit",
    "fingerprint",
  ]) {
    if (
      !isBoundedString(
        value[field],
        field === "profile" ||
          field.includes("Workspace") ||
          field.includes("Root")
          ? MAX_PATH_CHARS
          : 240,
      )
    ) {
      throw new Error(`Code Evidence state entry ${key} has invalid ${field}.`);
    }
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new Error(`Code Evidence state entry ${key} has invalid revision.`);
  if (
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.headCommit) ||
    !/^[0-9a-f]{64}$/.test(value.fingerprint)
  )
    throw new Error(
      `Code Evidence state entry ${key} has invalid Git identity/fingerprint.`,
    );
  if (!isIsoTimestamp(value.collectedAt) || !isIsoTimestamp(value.updatedAt))
    throw new Error(`Code Evidence state entry ${key} has invalid timestamps.`);
  if (value.branch !== null && !isBoundedString(value.branch, 500))
    throw new Error(`Code Evidence state entry ${key} has invalid branch.`);
  if (value.baseCommit !== null && !isBoundedString(value.baseCommit, 80))
    throw new Error(`Code Evidence state entry ${key} has invalid baseCommit.`);
  if (!["explicit", "upstream", "none"].includes(value.baseSource))
    throw new Error(`Code Evidence state entry ${key} has invalid baseSource.`);
  if (
    value.baseReference !== null &&
    !isBoundedString(value.baseReference, 500)
  )
    throw new Error(
      `Code Evidence state entry ${key} has invalid baseReference.`,
    );
  if (
    (value.baseSource === "none") !==
    (value.baseCommit === null && value.baseReference === null)
  )
    throw new Error(
      `Code Evidence state entry ${key} has inconsistent base identity.`,
    );
  if (
    !validateLane(value.staged) ||
    !validateLane(value.unstaged) ||
    !validateLane(value.untracked)
  )
    throw new Error(
      `Code Evidence state entry ${key} has an invalid change lane.`,
    );
  if (value.baseToHead !== null && !validateLane(value.baseToHead))
    throw new Error(
      `Code Evidence state entry ${key} has invalid baseToHead evidence.`,
    );
  if ((value.baseCommit === null) !== (value.baseToHead === null))
    throw new Error(
      `Code Evidence state entry ${key} has inconsistent base lane presence.`,
    );
  if (
    value.fingerprint !==
    collectionFingerprint(
      value.headCommit,
      value.baseCommit,
      value.staged,
      value.unstaged,
      value.untracked,
      value.baseToHead,
    )
  ) {
    throw new Error(
      `Code Evidence state entry ${key} has an inconsistent repository fingerprint.`,
    );
  }
  if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS)
    throw new Error(
      `Code Evidence state entry ${key} has invalid evidence records.`,
    );
  const recordIds = new Set<string>();
  for (const record of value.records) {
    if (
      !isRecord(record) ||
      !isBoundedString(record.id, 120) ||
      ![
        "file",
        "command",
        "test",
        "browser",
        "native",
        "manual",
        "other",
      ].includes(record.kind) ||
      !["passed", "failed", "observed", "blocked"].includes(record.result) ||
      !isBoundedString(record.summary, MAX_TEXT_CHARS) ||
      (record.reference !== null &&
        !isBoundedString(record.reference, MAX_REFERENCE_CHARS)) ||
      (record.command !== null && !isBoundedString(record.command, 500)) ||
      !Array.isArray(record.criterionIds) ||
      record.criterionIds.length > 20 ||
      record.criterionIds.some((id: unknown) => !isBoundedString(id, 120)) ||
      !isBoundedString(record.collectionId, 120) ||
      !isBoundedString(record.headCommit, 80) ||
      record.actor !== "agent" ||
      !isIsoTimestamp(record.createdAt) ||
      recordIds.has(record.id)
    ) {
      throw new Error(
        `Code Evidence state entry ${key} has an invalid evidence record.`,
      );
    }
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(record.headCommit))
      throw new Error(
        `Code Evidence state entry ${key} has an invalid record HEAD.`,
      );
    if (
      record.collectionId === value.collectionId &&
      record.headCommit !== value.headCommit
    )
      throw new Error(
        `Code Evidence state entry ${key} has a current record bound to another HEAD.`,
      );
    recordIds.add(record.id);
  }
  const expectedKey = scopeKey(
    value.profile,
    value.sessionId,
    value.repositoryRoot,
  );
  if (key !== expectedKey)
    throw new Error(
      `Code Evidence state entry ${key} does not match its scoped identity.`,
    );
}

export function parseNameStatus(output: string): ChangeEntry[] {
  if (!output) return [];
  const tokens = output.split("\0");
  const entries: ChangeEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index++];
    if (!status) continue;
    const firstPath = tokens[index++];
    if (!firstPath) break;
    if (/^[RC]/.test(status)) {
      const nextPath = tokens[index++];
      if (!nextPath) break;
      entries.push({
        status,
        path: boundedGitPath(nextPath),
        previousPath: boundedGitPath(firstPath),
      });
    } else {
      entries.push({
        status,
        path: boundedGitPath(firstPath),
        previousPath: null,
      });
    }
  }
  return entries;
}

export function boundedGitPath(value: string): string {
  if (!isBoundedString(value, MAX_PATH_CHARS))
    throw new Error(
      "Git evidence contains an empty or oversized path and was not persisted.",
    );
  const escaped = value.replace(
    /[\u0000-\u001f\u007f]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  if (escaped.length > MAX_PATH_CHARS)
    throw new Error(
      "Git evidence contains a path that exceeds the safe escaped limit and was not persisted.",
    );
  return escaped;
}

export function capLane(
  entries: ChangeEntry[],
  shortStat: string | null,
  digestSource: string,
): ChangeLane {
  return {
    total: entries.length,
    omitted: Math.max(0, entries.length - MAX_CHANGE_ENTRIES),
    digest: createHash("sha256").update(digestSource).digest("hex"),
    entries: entries.slice(0, MAX_CHANGE_ENTRIES),
    shortStat: shortStat ? compactText(shortStat, 500) : null,
  };
}

export function collectionFingerprint(
  headCommit: string,
  baseCommit: string | null,
  staged: ChangeLane,
  unstaged: ChangeLane,
  untracked: ChangeLane,
  baseToHead: ChangeLane | null,
): string {
  const shape = {
    headCommit,
    baseCommit,
    stagedDigest: staged.digest,
    stagedTotal: staged.total,
    unstagedDigest: unstaged.digest,
    unstagedTotal: unstaged.total,
    untrackedDigest: untracked.digest,
    untrackedTotal: untracked.total,
    baseToHeadDigest: baseToHead?.digest ?? null,
    baseToHeadTotal: baseToHead?.total ?? null,
  };
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

export function validateBaseRef(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (
    !isBoundedString(text, 200) ||
    text.startsWith("-") ||
    /[\x00-\x20\x7f]/.test(text)
  ) {
    throw new Error(
      "base_ref must be a bounded Git ref and must not begin with '-'.",
    );
  }
  return text;
}

export function evidenceVerdict(report: CodeEvidenceReport) {
  if (report.freshness?.isCurrent !== true) {
    return {
      verdict: "needs_evidence",
      reason:
        report.freshness?.reason ??
        "Repository freshness is unknown; recollect before attaching evidence.",
    };
  }
  if (
    [report.staged, report.unstaged, report.untracked, report.baseToHead].some(
      (lane) => lane && lane.omitted > 0,
    )
  ) {
    return {
      verdict: "needs_evidence",
      reason:
        "One or more Git evidence lanes exceed the bounded path list; narrow or inspect the omitted scope before attaching criterion evidence.",
    };
  }
  const currentRecords = report.records.filter(
    (record) =>
      record.collectionId === report.collectionId &&
      record.headCommit === report.headCommit,
  );
  if (
    currentRecords.some(
      (record) => record.result === "failed" || record.result === "blocked",
    )
  ) {
    return {
      verdict: "needs_work",
      reason: "One or more recorded checks are failed or blocked.",
    };
  }
  if (currentRecords.length === 0) {
    return {
      verdict: "needs_evidence",
      reason:
        "Repository state is collected but no external check/browser/native/manual evidence is recorded.",
    };
  }
  if (!currentRecords.some((record) => record.criterionIds.length > 0)) {
    return {
      verdict: "needs_evidence",
      reason:
        "External evidence exists but is not mapped to any Goal criterion.",
    };
  }
  return {
    verdict: "evidence_ready",
    reason:
      "Bounded repository state and external evidence are present; Goal criteria still require explicit attachment/claim and human verification where applicable.",
  };
}

export function reportSummary(report: CodeEvidenceReport) {
  const verdict = evidenceVerdict(report);
  const repositoryCurrent = report.freshness?.isCurrent === true;
  const currentRecords = repositoryCurrent
    ? report.records.filter(
        (record) =>
          record.collectionId === report.collectionId &&
          record.headCommit === report.headCommit,
      )
    : [];
  return {
    status: "ok",
    revision: report.revision,
    repository: {
      root: report.repositoryRoot,
      branch: report.branch,
      headCommit: report.headCommit,
      baseCommit: report.baseCommit,
      baseSource: report.baseSource,
      baseReference: report.baseReference,
      freshness: report.freshness ?? {
        isCurrent: false,
        currentHead: null,
        reason: "Repository freshness was not assessed.",
      },
    },
    collectedAt: report.collectedAt,
    changes: {
      staged: {
        total: report.staged.total,
        omitted: report.staged.omitted,
        digest: report.staged.digest,
        entries: report.staged.entries,
        shortStat: report.staged.shortStat,
      },
      unstaged: {
        total: report.unstaged.total,
        omitted: report.unstaged.omitted,
        digest: report.unstaged.digest,
        entries: report.unstaged.entries,
        shortStat: report.unstaged.shortStat,
      },
      untracked: {
        total: report.untracked.total,
        omitted: report.untracked.omitted,
        digest: report.untracked.digest,
        entries: report.untracked.entries,
      },
      baseToHead: report.baseToHead,
    },
    records: report.records.map((record) => ({
      ...record,
      stale:
        !repositoryCurrent ||
        record.collectionId !== report.collectionId ||
        record.headCommit !== report.headCommit,
    })),
    verdict,
    metadataOnly:
      "Ready for explicit selection, NOT verified execution or Goal completion. Caller command is descriptive only.",
    goalHandoff: {
      boundary:
        "Reference-only handoff: explicitly select and attach items through the separately authorized Goal owner. Code Evidence never changes Goal state, claims criteria, verifies human criteria, or completes a Goal.",
      repositoryEvidence: {
        kind: "command",
        summary: `Git evidence at ${report.headCommit.slice(0, 12)}: ${report.staged.total} staged, ${report.unstaged.total} unstaged, ${report.untracked.total} untracked, ${report.baseToHead?.total ?? 0} base-to-HEAD.`,
        reference: `${report.repositoryRoot}@${report.headCommit}#code-evidence-r${report.revision}`,
      },
      criterionMappings: (verdict.verdict === "evidence_ready"
        ? currentRecords
        : []
      )
        .filter(
          (record) =>
            record.result === "passed" || record.result === "observed",
        )
        .flatMap((record) =>
          record.criterionIds.map((criterionId) => ({
            criterionId,
            evidenceId: record.id,
            kind: record.kind,
            summary: record.summary,
            reference: record.reference,
            result: record.result,
          })),
        ),
    },
  };
}

export function formatReport(report: CodeEvidenceReport): string {
  const summary = reportSummary(report);
  const currentRecords =
    report.freshness?.isCurrent === true
      ? report.records.filter(
          (record) =>
            record.collectionId === report.collectionId &&
            record.headCommit === report.headCommit,
        )
      : [];
  const failed = currentRecords.filter(
    (record) => record.result === "failed" || record.result === "blocked",
  ).length;
  return [
    `Mahiro Code Evidence · revision ${report.revision} · ${summary.verdict.verdict}`,
    `Repository: ${report.repositoryRoot}`,
    `Branch/HEAD: ${report.branch ?? "detached"} · ${report.headCommit.slice(0, 12)}`,
    `Base: ${report.baseCommit?.slice(0, 12) ?? "none"} (${report.baseSource}${report.baseReference ? `: ${report.baseReference}` : ""})`,
    `Changes: ${report.staged.total} staged · ${report.unstaged.total} unstaged · ${report.untracked.total} untracked · ${report.baseToHead?.total ?? 0} base→HEAD`,
    `External evidence: ${currentRecords.length} current · ${report.records.length - currentRecords.length} stale · ${failed} failed/blocked`,
    `Reason: ${summary.verdict.reason}`,
    "Boundary: use mh_update_goal to attach selected evidence; this report never verifies or completes Goal criteria.",
  ].join("\n");
}

export const CODE_EVIDENCE_PARAMETERS = {
  type: "object",
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["get", "collect", "record"] },
    workspace: {
      type: "string",
      description:
        "Repository or child path. Optional for get/collect; required for record.",
    },
    base_ref: {
      type: "string",
      description:
        "Optional explicit Git base ref for collect. Without it, uses the upstream merge-base when available.",
    },
    expected_revision: { type: "integer", minimum: 1 },
    kind: {
      type: "string",
      enum: ["file", "command", "test", "browser", "native", "manual", "other"],
    },
    result: {
      type: "string",
      enum: ["passed", "failed", "observed", "blocked"],
    },
    summary: { type: "string", maxLength: MAX_TEXT_CHARS },
    reference: { type: "string", maxLength: MAX_REFERENCE_CHARS },
    command: { type: "string", maxLength: 500 },
    criterion_ids: {
      type: "array",
      maxItems: 20,
      items: { type: "string", maxLength: 120 },
    },
  },
  additionalProperties: false,
};

export function collectReport(
  state: EvidenceState,
  scope: Scope,
  collected: any,
): CodeEvidenceReport {
  const key = scopeKey(scope.profile, scope.sessionId, scope.project),
    existing = state.reports[key];
  if (!existing && Object.keys(state.reports).length >= 256)
    throw Error("Evidence scope bound");
  const report = {
    ...collected,
    revision: (existing?.revision ?? 0) + 1,
    profile: scope.profile,
    sessionId: scope.sessionId,
    updatedAt: nowIso(),
    records: existing?.records.slice(-20) ?? [],
  };
  delete report.stableHead;
  state.reports[key] = report;
  return structuredClone(report);
}
export function recordReport(state: EvidenceState, scope: Scope, args: any) {
  const report = reportAt(state, scope);
  if (!report || report.revision !== args.expected_revision)
    throw Error(
      "Stale Code Evidence revision; collect/read exact native scope first",
    );
  if (report.records.length >= 50) throw Error("Evidence record bound");
  if (
    ![
      "file",
      "command",
      "test",
      "browser",
      "native",
      "manual",
      "other",
    ].includes(args.kind) ||
    !["passed", "failed", "observed", "blocked"].includes(args.result)
  )
    throw Error("Unsupported Evidence kind/result");
  const criterionIds =
    args.criterion_ids == null
      ? []
      : [
          ...new Set(
            args.criterion_ids.map((id: unknown) =>
              evidenceField(id, "criterion_id", 120),
            ),
          ),
        ];
  if (criterionIds.length > 20) throw Error("Criterion bound");
  report.records.push({
    id: `evidence-${randomUUID().slice(0, 12)}`,
    kind: args.kind,
    result: args.result,
    summary: evidenceField(args.summary, "Evidence summary", 500),
    reference:
      args.reference == null
        ? null
        : evidenceField(args.reference, "Evidence reference", 500),
    command:
      args.command == null
        ? null
        : evidenceField(args.command, "Evidence command", 300),
    criterionIds: criterionIds as string[],
    collectionId: report.collectionId,
    headCommit: report.headCommit,
    actor: "agent",
    createdAt: nowIso(),
  });
  report.revision++;
  report.updatedAt = nowIso();
  return structuredClone(report);
}
