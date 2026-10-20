/**
 * Mahiro Code Evidence — bounded, read-only repository proof for Goal work.
 *
 * It keeps staged, unstaged, untracked, and base-to-HEAD state separate and
 * never stages, commits, mutates source, runs arbitrary commands, or writes
 * Mahiro Goal state.
 */

import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SCHEMA_VERSION = 1;
const STATE_PATH = process.env.MAHIRO_CODE_EVIDENCE_STATE_PATH
  ?? join(homedir(), ".letta", "mods", "mahiro-code-evidence.state.json");
const LOCK_PATH = `${STATE_PATH}.lock`;
const DISABLE_PATH = process.env.MAHIRO_CODE_EVIDENCE_DISABLE_PATH
  ?? join(homedir(), ".letta", "mods", "mahiro-code-evidence.disabled");
const MAX_SCOPES = 256;
const MAX_CHANGE_ENTRIES = 512;
const MAX_RECORDS = 50;
const MAX_TEXT_CHARS = 500;
const MAX_REFERENCE_CHARS = 500;
const MAX_PATH_CHARS = 4_096;
const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;

type EvidenceKind = "file" | "command" | "test" | "browser" | "native" | "manual" | "other";
type EvidenceResult = "passed" | "failed" | "observed" | "blocked";

interface ChangeEntry {
  status: string;
  path: string;
  previousPath: string | null;
}

interface ChangeLane {
  total: number;
  omitted: number;
  digest: string;
  entries: ChangeEntry[];
  shortStat: string | null;
}

interface EvidenceRecord {
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

interface CodeEvidenceReport {
  revision: number;
  collectionId: string;
  fingerprint: string;
  agentId: string;
  conversationId: string;
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

interface EvidenceState {
  schemaVersion: 1;
  reports: Record<string, CodeEvidenceReport>;
}

interface LockHandle {
  tokenPath: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function compactText(value: unknown, max = MAX_TEXT_CHARS): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function evidenceField(value: unknown, label: string, max: number): string {
  const raw = String(value ?? "");
  if (!raw.trim()) throw new Error(`${label} must not be empty.`);
  if (raw.length > max) throw new Error(`${label} exceeds the bounded ${max}-character summary limit.`);
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new Error(`${label} must be a single-line summary/reference, not raw output.`);
  if (/(?:^|\s)(?:diff --git|@@\s|--- a\/|\+\+\+ b\/)/i.test(raw)) throw new Error(`${label} appears to contain raw diff output; record a concise summary/reference instead.`);
  return raw.trim();
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

function emptyState(): EvidenceState {
  return { schemaVersion: SCHEMA_VERSION, reports: {} };
}

function scopeKey(agentId: string, conversationId: string, repositoryRoot: string): string {
  return JSON.stringify([agentId, conversationId, resolve(repositoryRoot)]);
}

function identityFrom(ctx: any) {
  const agentId = compactText(ctx?.agent?.id ?? ctx?.agentId, 240);
  const conversationId = compactText(ctx?.conversation?.id ?? ctx?.conversationId, 240);
  if (!agentId || !conversationId) throw new Error("Code Evidence requires explicit agent and conversation identity; refusing a shared fallback scope.");
  return { agentId, conversationId };
}

function scopeFrom(ctx: any, repositoryRoot: string) {
  const { agentId, conversationId } = identityFrom(ctx);
  return { agentId, conversationId, key: scopeKey(agentId, conversationId, repositoryRoot) };
}

function validateLane(lane: unknown): lane is ChangeLane {
  if (!isRecord(lane)
    || !Number.isSafeInteger(lane.total)
    || lane.total < 0
    || !Number.isSafeInteger(lane.omitted)
    || lane.omitted < 0
    || typeof lane.digest !== "string"
    || !/^[0-9a-f]{64}$/.test(lane.digest)
    || !Array.isArray(lane.entries)
    || lane.entries.length > MAX_CHANGE_ENTRIES
    || lane.total !== lane.entries.length + lane.omitted
    || (lane.shortStat !== null && !isBoundedString(lane.shortStat, 500))) return false;
  return lane.entries.every((entry: unknown) => isRecord(entry)
    && isBoundedString(entry.status, 16)
    && isBoundedString(entry.path, MAX_PATH_CHARS)
    && (entry.previousPath === null || isBoundedString(entry.previousPath, MAX_PATH_CHARS)));
}

function validateReport(key: string, value: unknown): asserts value is CodeEvidenceReport {
  if (!isRecord(value)) throw new Error(`Code Evidence state entry ${key} must be an object.`);
  for (const field of ["collectionId", "agentId", "conversationId", "requestedWorkspace", "repositoryRoot", "headCommit", "fingerprint"]) {
    if (!isBoundedString(value[field], field.includes("Workspace") || field.includes("Root") ? MAX_PATH_CHARS : 240)) {
      throw new Error(`Code Evidence state entry ${key} has invalid ${field}.`);
    }
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error(`Code Evidence state entry ${key} has invalid revision.`);
  if (!/^[0-9a-f]{40,64}$/.test(value.headCommit) || !/^[0-9a-f]{64}$/.test(value.fingerprint)) throw new Error(`Code Evidence state entry ${key} has invalid Git identity/fingerprint.`);
  if (!isIsoTimestamp(value.collectedAt) || !isIsoTimestamp(value.updatedAt)) throw new Error(`Code Evidence state entry ${key} has invalid timestamps.`);
  if (value.branch !== null && !isBoundedString(value.branch, 500)) throw new Error(`Code Evidence state entry ${key} has invalid branch.`);
  if (value.baseCommit !== null && !isBoundedString(value.baseCommit, 80)) throw new Error(`Code Evidence state entry ${key} has invalid baseCommit.`);
  if (!["explicit", "upstream", "none"].includes(value.baseSource)) throw new Error(`Code Evidence state entry ${key} has invalid baseSource.`);
  if (value.baseReference !== null && !isBoundedString(value.baseReference, 500)) throw new Error(`Code Evidence state entry ${key} has invalid baseReference.`);
  if ((value.baseSource === "none") !== (value.baseCommit === null && value.baseReference === null)) throw new Error(`Code Evidence state entry ${key} has inconsistent base identity.`);
  if (!validateLane(value.staged) || !validateLane(value.unstaged) || !validateLane(value.untracked)) throw new Error(`Code Evidence state entry ${key} has an invalid change lane.`);
  if (value.baseToHead !== null && !validateLane(value.baseToHead)) throw new Error(`Code Evidence state entry ${key} has invalid baseToHead evidence.`);
  if ((value.baseCommit === null) !== (value.baseToHead === null)) throw new Error(`Code Evidence state entry ${key} has inconsistent base lane presence.`);
  if (value.fingerprint !== collectionFingerprint(value.headCommit, value.baseCommit, value.staged, value.unstaged, value.untracked, value.baseToHead)) {
    throw new Error(`Code Evidence state entry ${key} has an inconsistent repository fingerprint.`);
  }
  if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS) throw new Error(`Code Evidence state entry ${key} has invalid evidence records.`);
  const recordIds = new Set<string>();
  for (const record of value.records) {
    if (!isRecord(record)
      || !isBoundedString(record.id, 120)
      || !["file", "command", "test", "browser", "native", "manual", "other"].includes(record.kind)
      || !["passed", "failed", "observed", "blocked"].includes(record.result)
      || !isBoundedString(record.summary, MAX_TEXT_CHARS)
      || (record.reference !== null && !isBoundedString(record.reference, MAX_REFERENCE_CHARS))
      || (record.command !== null && !isBoundedString(record.command, 500))
      || !Array.isArray(record.criterionIds)
      || record.criterionIds.length > 20
      || record.criterionIds.some((id: unknown) => !isBoundedString(id, 120))
      || !isBoundedString(record.collectionId, 120)
      || !isBoundedString(record.headCommit, 80)
      || record.actor !== "agent"
      || !isIsoTimestamp(record.createdAt)
      || recordIds.has(record.id)) {
      throw new Error(`Code Evidence state entry ${key} has an invalid evidence record.`);
    }
    if (!/^[0-9a-f]{40,64}$/.test(record.headCommit)) throw new Error(`Code Evidence state entry ${key} has an invalid record HEAD.`);
    if (record.collectionId === value.collectionId && record.headCommit !== value.headCommit) throw new Error(`Code Evidence state entry ${key} has a current record bound to another HEAD.`);
    recordIds.add(record.id);
  }
  const expectedKey = scopeKey(value.agentId, value.conversationId, value.repositoryRoot);
  if (key !== expectedKey) throw new Error(`Code Evidence state entry ${key} does not match its scoped identity.`);
}

function readState(): EvidenceState {
  if (!existsSync(STATE_PATH)) return emptyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse Code Evidence state: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== SCHEMA_VERSION || !isRecord(parsed.reports)) {
    throw new Error(`Unsupported Code Evidence state schema. Expected ${SCHEMA_VERSION}.`);
  }
  const entries = Object.entries(parsed.reports);
  if (entries.length > MAX_SCOPES) throw new Error(`Code Evidence state exceeds ${MAX_SCOPES} scoped reports.`);
  for (const [key, report] of entries) validateReport(key, report);
  return parsed as EvidenceState;
}

function writeState(state: EvidenceState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tempPath = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, STATE_PATH);
    const directoryFd = openSync(dirname(STATE_PATH), "r");
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
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
    const directoryFd = openSync(candidatePath, "r");
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
    renameSync(candidatePath, LOCK_PATH);
    return { tokenPath: join(LOCK_PATH, token) };
  } catch (error: any) {
    if (fd !== null) closeSync(fd);
    rmSync(candidatePath, { recursive: true, force: true });
    if (["EEXIST", "ENOTEMPTY", "EISDIR", "ENOTDIR"].includes(error?.code)) {
      throw new Error("Code Evidence state is busy in another Letta process. Retry after the current evidence mutation finishes.");
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

function withLockedState<T>(mutate: (state: EvidenceState) => T): T {
  const lock = acquireStateLock();
  try {
    const state = readState();
    const before = JSON.stringify(state);
    const result = mutate(state);
    if (JSON.stringify(state) !== before) writeState(state);
    return result;
  } finally {
    releaseStateLock(lock);
  }
}

function forceUnlock(): boolean {
  if (!existsSync(LOCK_PATH)) return false;
  const quarantine = `${LOCK_PATH}.abandoned-${Date.now()}-${randomUUID().slice(0, 8)}`;
  renameSync(LOCK_PATH, quarantine);
  rmSync(quarantine, { recursive: lstatSync(quarantine).isDirectory(), force: true });
  return true;
}

function validateWorkspace(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!isBoundedString(raw, MAX_PATH_CHARS)) throw new Error("workspace must be a non-empty bounded path.");
  const absolute = resolve(raw);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) throw new Error(`Workspace directory does not exist: ${absolute}`);
  return realpathSync(absolute);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result: any = await execFile("git", args, {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    return String(result?.stdout ?? "");
  } catch (error: any) {
    const stderr = String(error?.stderr ?? "").trim();
    const message = stderr || error?.message || String(error);
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${compactText(message, 500)}`);
  }
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runGit(cwd, args);
  } catch {
    return null;
  }
}

async function resolveGitRoot(workspace: string): Promise<string> {
  const root = (await runGit(workspace, ["rev-parse", "--show-toplevel"])).trim();
  if (!root) throw new Error(`No Git repository found from ${workspace}.`);
  return resolve(root);
}

function parseNameStatus(output: string): ChangeEntry[] {
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
      entries.push({ status, path: boundedGitPath(nextPath), previousPath: boundedGitPath(firstPath) });
    } else {
      entries.push({ status, path: boundedGitPath(firstPath), previousPath: null });
    }
  }
  return entries;
}

function boundedGitPath(value: string): string {
  if (!isBoundedString(value, MAX_PATH_CHARS)) throw new Error("Git evidence contains an empty or oversized path and was not persisted.");
  const escaped = value.replace(/[\u0000-\u001f\u007f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (escaped.length > MAX_PATH_CHARS) throw new Error("Git evidence contains a path that exceeds the safe escaped limit and was not persisted.");
  return escaped;
}

function capLane(entries: ChangeEntry[], shortStat: string | null, digestSource: string): ChangeLane {
  return {
    total: entries.length,
    omitted: Math.max(0, entries.length - MAX_CHANGE_ENTRIES),
    digest: createHash("sha256").update(digestSource).digest("hex"),
    entries: entries.slice(0, MAX_CHANGE_ENTRIES),
    shortStat: shortStat ? compactText(shortStat, 500) : null,
  };
}

function collectionFingerprint(
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

async function collectDiffLane(root: string, args: string[]): Promise<ChangeLane> {
  const safeArgs = ["--no-ext-diff", "--no-textconv", ...args];
  const rawNames = await runGit(root, ["diff", ...safeArgs, "--name-status", "-z", "--"]);
  const names = parseNameStatus(rawNames);
  const shortStat = (await runGit(root, ["diff", ...safeArgs, "--shortstat", "--"])).trim() || null;
  const boundedPatch = await runGit(root, ["diff", ...safeArgs, "--binary", "--"]);
  return capLane(names, shortStat, boundedPatch);
}

async function collectUntrackedLane(root: string): Promise<ChangeLane> {
  const output = await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = output.split("\0").filter(Boolean);
  const metadata = paths.slice(0, MAX_CHANGE_ENTRIES).map((path) => {
    const stats = lstatSync(join(root, path));
    return `${path}\0${stats.size}\0${stats.mtimeMs}\0${stats.mode}`;
  }).join("\0");
  return capLane(paths.map((path) => ({ status: "??", path: boundedGitPath(path), previousPath: null })), null, `${output}\0${metadata}`);
}

function validateBaseRef(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!isBoundedString(text, 200) || text.startsWith("-") || /[\0\r\n]/.test(text)) {
    throw new Error("base_ref must be a bounded Git ref and must not begin with '-'.");
  }
  return text;
}

async function resolveBase(root: string, explicitRef: string | null) {
  if (explicitRef) {
    const commit = (await runGit(root, ["rev-parse", "--verify", "--end-of-options", `${explicitRef}^{commit}`])).trim();
    return { commit, source: "explicit" as const, reference: explicitRef };
  }
  const upstream = (await tryGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]))?.trim();
  if (upstream) {
    const commit = (await runGit(root, ["merge-base", "HEAD", upstream])).trim();
    return { commit, source: "upstream" as const, reference: upstream };
  }
  return { commit: null, source: "none" as const, reference: null };
}

async function collectRepositoryEvidence(workspaceInput: unknown, fallbackCwd: string, baseRefInput?: unknown) {
  const requestedWorkspace = validateWorkspace(workspaceInput, fallbackCwd);
  const repositoryRoot = await resolveGitRoot(requestedWorkspace);
  const headCommit = (await runGit(repositoryRoot, ["rev-parse", "HEAD"])).trim();
  const branch = (await runGit(repositoryRoot, ["branch", "--show-current"])).trim() || null;
  const base = await resolveBase(repositoryRoot, validateBaseRef(baseRefInput));
  const [staged, unstaged, untracked, baseToHead] = await Promise.all([
    collectDiffLane(repositoryRoot, ["--cached"]),
    collectDiffLane(repositoryRoot, []),
    collectUntrackedLane(repositoryRoot),
    base.commit ? collectDiffLane(repositoryRoot, [base.commit, headCommit]) : Promise.resolve(null),
  ]);
  return {
    collectionId: `collection-${randomUUID().slice(0, 12)}`,
    requestedWorkspace,
    repositoryRoot,
    branch,
    headCommit,
    baseCommit: base.commit,
    baseSource: base.source,
    baseReference: base.reference,
    fingerprint: collectionFingerprint(headCommit, base.commit, staged, unstaged, untracked, baseToHead),
    collectedAt: nowIso(),
    staged,
    unstaged,
    untracked,
    baseToHead,
  };
}

function saveCollection(ctx: any, collected: Awaited<ReturnType<typeof collectRepositoryEvidence>>): CodeEvidenceReport {
  const report = withLockedState((state) => {
    const scope = scopeFrom(ctx, collected.repositoryRoot);
    const existing = state.reports[scope.key];
    if (!existing && Object.keys(state.reports).length >= MAX_SCOPES) throw new Error(`Code Evidence state already contains ${MAX_SCOPES} scoped reports.`);
    const report: CodeEvidenceReport = {
      ...collected,
      revision: (existing?.revision ?? 0) + 1,
      agentId: scope.agentId,
      conversationId: scope.conversationId,
      updatedAt: nowIso(),
      records: existing?.records.slice(-20) ?? [],
    };
    state.reports[scope.key] = report;
    return structuredClone(report);
  });
  const untrackedComplete = report.untracked.omitted === 0;
  return {
    ...report,
    freshness: {
      isCurrent: untrackedComplete,
      currentHead: report.headCommit,
      reason: untrackedComplete
        ? "Freshly collected repository state."
        : "Untracked path count exceeds the bounded metadata fingerprint; narrow or inspect that scope before recording proof.",
    },
  };
}

function conversationReports(state: EvidenceState, ctx: any): CodeEvidenceReport[] {
  const { agentId, conversationId } = identityFrom(ctx);
  return Object.values(state.reports)
    .filter((report) => report.agentId === agentId && report.conversationId === conversationId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function sampleRepository(report: CodeEvidenceReport) {
  const headBefore = (await runGit(report.repositoryRoot, ["rev-parse", "HEAD"])).trim();
  const [staged, unstaged, untracked, baseToHead] = await Promise.all([
    collectDiffLane(report.repositoryRoot, ["--cached"]),
    collectDiffLane(report.repositoryRoot, []),
    collectUntrackedLane(report.repositoryRoot),
    report.baseCommit ? collectDiffLane(report.repositoryRoot, [report.baseCommit, headBefore]) : Promise.resolve(null),
  ]);
  const headAfter = (await runGit(report.repositoryRoot, ["rev-parse", "HEAD"])).trim();
  return {
    stableHead: headBefore === headAfter,
    headCommit: headAfter,
    fingerprint: collectionFingerprint(headAfter, report.baseCommit, staged, unstaged, untracked, baseToHead),
    untrackedComplete: untracked.omitted === 0,
  };
}

async function assessFreshness(report: CodeEvidenceReport): Promise<CodeEvidenceReport> {
  try {
    if (report.untracked.omitted > 0) {
      return {
        ...structuredClone(report),
        freshness: {
          isCurrent: false,
          currentHead: report.headCommit,
          reason: "Untracked path count exceeds the bounded metadata fingerprint; recollect after narrowing or explicitly inspect the omitted scope.",
        },
      };
    }
    const first = await sampleRepository(report);
    const second = await sampleRepository(report);
    const stableSample = first.stableHead
      && second.stableHead
      && first.headCommit === second.headCommit
      && first.fingerprint === second.fingerprint
      && first.untrackedComplete
      && second.untrackedComplete;
    const isCurrent = stableSample
      && second.headCommit === report.headCommit
      && second.fingerprint === report.fingerprint;
    return {
      ...structuredClone(report),
      freshness: {
        isCurrent,
        currentHead: second.headCommit,
        reason: isCurrent
          ? "Two consecutive bounded samples match the collection's HEAD and Git lanes."
          : stableSample
            ? "Repository HEAD or Git lanes changed after collection; recollect before attaching evidence."
            : "Repository changed while freshness was sampled; retry collection after the repository is quiet.",
      },
    };
  } catch (error) {
    return {
      ...structuredClone(report),
      freshness: {
        isCurrent: false,
        currentHead: null,
        reason: `Repository freshness could not be confirmed: ${compactText(error instanceof Error ? error.message : String(error), 500)}`,
      },
    };
  }
}

async function findReport(ctx: any, workspaceInput?: unknown): Promise<CodeEvidenceReport | null> {
  const state = readState();
  if (workspaceInput != null && String(workspaceInput).trim()) {
    const workspace = validateWorkspace(workspaceInput, ctx.cwd);
    const root = await resolveGitRoot(workspace);
    const report = state.reports[scopeFrom(ctx, root).key];
    return report ? assessFreshness(report) : null;
  }
  try {
    const root = await resolveGitRoot(validateWorkspace(null, ctx.cwd));
    const report = state.reports[scopeFrom(ctx, root).key];
    if (report) return assessFreshness(report);
  } catch {
    // A conversation may run from a non-repository parent while collecting an
    // explicitly selected repository.
  }
  const reports = conversationReports(state, ctx);
  return reports.length === 1 ? assessFreshness(reports[0]) : null;
}

function evidenceVerdict(report: CodeEvidenceReport) {
  if (report.freshness?.isCurrent !== true) {
    return { verdict: "needs_evidence", reason: report.freshness?.reason ?? "Repository freshness is unknown; recollect before attaching evidence." };
  }
  if ([report.staged, report.unstaged, report.untracked, report.baseToHead].some((lane) => lane && lane.omitted > 0)) {
    return { verdict: "needs_evidence", reason: "One or more Git evidence lanes exceed the bounded path list; narrow or inspect the omitted scope before attaching criterion evidence." };
  }
  const currentRecords = report.records.filter((record) => record.collectionId === report.collectionId && record.headCommit === report.headCommit);
  if (currentRecords.some((record) => record.result === "failed" || record.result === "blocked")) {
    return { verdict: "needs_work", reason: "One or more recorded checks are failed or blocked." };
  }
  if (currentRecords.length === 0) {
    return { verdict: "needs_evidence", reason: "Repository state is collected but no external check/browser/native/manual evidence is recorded." };
  }
  if (!currentRecords.some((record) => record.criterionIds.length > 0)) {
    return { verdict: "needs_evidence", reason: "External evidence exists but is not mapped to any Goal criterion." };
  }
  return { verdict: "evidence_ready", reason: "Bounded repository state and external evidence are present; Goal criteria still require explicit attachment/claim and human verification where applicable." };
}

function reportSummary(report: CodeEvidenceReport) {
  const verdict = evidenceVerdict(report);
  const repositoryCurrent = report.freshness?.isCurrent === true;
  const currentRecords = repositoryCurrent
    ? report.records.filter((record) => record.collectionId === report.collectionId && record.headCommit === report.headCommit)
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
      freshness: report.freshness ?? { isCurrent: false, currentHead: null, reason: "Repository freshness was not assessed." },
    },
    collectedAt: report.collectedAt,
    changes: {
      staged: { total: report.staged.total, omitted: report.staged.omitted, digest: report.staged.digest, entries: report.staged.entries, shortStat: report.staged.shortStat },
      unstaged: { total: report.unstaged.total, omitted: report.unstaged.omitted, digest: report.unstaged.digest, entries: report.unstaged.entries, shortStat: report.unstaged.shortStat },
      untracked: { total: report.untracked.total, omitted: report.untracked.omitted, digest: report.untracked.digest, entries: report.untracked.entries },
      baseToHead: report.baseToHead,
    },
    records: report.records.map((record) => ({
      ...record,
      stale: !repositoryCurrent || record.collectionId !== report.collectionId || record.headCommit !== report.headCommit,
    })),
    verdict,
    goalHandoff: {
      boundary: "Attach selected items with mh_update_goal add_evidence. Code Evidence never changes Goal state, claims criteria, verifies human criteria, or completes a Goal.",
      repositoryEvidence: {
        kind: "command",
        summary: `Git evidence at ${report.headCommit.slice(0, 12)}: ${report.staged.total} staged, ${report.unstaged.total} unstaged, ${report.untracked.total} untracked, ${report.baseToHead?.total ?? 0} base-to-HEAD.`,
        reference: `${report.repositoryRoot}@${report.headCommit}#code-evidence-r${report.revision}`,
      },
      criterionMappings: (verdict.verdict === "evidence_ready" ? currentRecords : [])
        .filter((record) => record.result === "passed" || record.result === "observed")
        .flatMap((record) => record.criterionIds.map((criterionId) => ({
        criterionId,
        evidenceId: record.id,
        kind: record.kind,
        summary: record.summary,
        reference: record.reference,
        result: record.result,
      }))),
    },
  };
}

async function recordEvidence(ctx: any, args: any): Promise<CodeEvidenceReport> {
  const workspace = validateWorkspace(args.workspace, ctx.cwd);
  const kind = String(args.kind ?? "other") as EvidenceKind;
  const result = String(args.result ?? "observed") as EvidenceResult;
  if (!["file", "command", "test", "browser", "native", "manual", "other"].includes(kind)) throw new Error(`Unsupported evidence kind: ${kind}`);
  if (!["passed", "failed", "observed", "blocked"].includes(result)) throw new Error(`Unsupported evidence result: ${result}`);
  const summary = evidenceField(args.summary, "Evidence summary", MAX_TEXT_CHARS);
  const reference = args.reference == null ? null : evidenceField(args.reference, "Evidence reference", MAX_REFERENCE_CHARS);
  const command = args.command == null ? null : evidenceField(args.command, "Evidence command", 300);
  const criterionIds = Array.isArray(args.criterion_ids)
    ? [...new Set(args.criterion_ids.map((id: unknown) => evidenceField(id, "criterion_id", 120)))]
    : [];
  if (criterionIds.length > 20) throw new Error("At most 20 criterion_ids may be attached to one evidence record.");
  const expectedRevision = Number(args.expected_revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("expected_revision must be a positive safe integer.");

  const lock = acquireStateLock();
  try {
    const state = readState();
    const reports = conversationReports(state, ctx);
    const matching = reports.filter((report) => workspace === report.repositoryRoot || workspace === report.requestedWorkspace || workspace.startsWith(`${report.repositoryRoot}/`));
    if (matching.length !== 1) throw new Error(`Expected exactly one collected report for ${workspace}; run mh_code_evidence with action "collect" first and pass an explicit workspace.`);
    const report = state.reports[scopeFrom(ctx, matching[0].repositoryRoot).key];
    if (report.revision !== expectedRevision) throw new Error(`Stale Code Evidence revision ${expectedRevision}; current revision is ${report.revision}.`);
    if (report.records.length >= MAX_RECORDS) throw new Error(`Code Evidence report already contains ${MAX_RECORDS} records.`);
    const before = await assessFreshness(report);
    if (before.freshness?.isCurrent !== true) throw new Error(before.freshness?.reason ?? "Repository changed after collection; recollect before recording proof.");
    report.records.push({
      id: `evidence-${randomUUID().slice(0, 12)}`,
      kind,
      result,
      summary,
      reference,
      command,
      criterionIds,
      collectionId: report.collectionId,
      headCommit: report.headCommit,
      actor: "agent",
      createdAt: nowIso(),
    });
    const after = await assessFreshness(report);
    if (after.freshness?.isCurrent !== true) throw new Error(after.freshness?.reason ?? "Repository changed while evidence was being recorded; recollect and retry.");
    report.revision += 1;
    report.updatedAt = nowIso();
    writeState(state);
    return {
      ...structuredClone(report),
      freshness: {
        isCurrent: true,
        currentHead: report.headCommit,
        reason: "Repository state matched two bounded samples before and after the evidence mutation.",
      },
    };
  } finally {
    releaseStateLock(lock);
  }
}

async function clearReport(ctx: any, workspaceInput: unknown, expectedRevision: number): Promise<boolean> {
  const workspace = validateWorkspace(workspaceInput, ctx.cwd);
  const root = await resolveGitRoot(workspace);
  return withLockedState((state) => {
    const key = scopeFrom(ctx, root).key;
    const report = state.reports[key];
    if (!report) return false;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== report.revision) {
      throw new Error(`Stale Code Evidence revision ${expectedRevision}; current revision is ${report.revision}.`);
    }
    delete state.reports[key];
    return true;
  });
}

function commandOutput(output: string, success = true) {
  return { type: "output" as const, output, success };
}

function formatReport(report: CodeEvidenceReport): string {
  const summary = reportSummary(report);
  const currentRecords = report.freshness?.isCurrent === true
    ? report.records.filter((record) => record.collectionId === report.collectionId && record.headCommit === report.headCommit)
    : [];
  const failed = currentRecords.filter((record) => record.result === "failed" || record.result === "blocked").length;
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

async function runCommand(ctx: any) {
  const input = String(ctx.args ?? "").trim();
  const [subcommand = "status", ...rest] = input.split(/\s+/);
  const tail = rest.join(" ").trim();
  try {
    if (["help", "-h", "--help"].includes(subcommand)) {
      return commandOutput([
        "Mahiro Code Evidence",
        "  /mh-evidence status [workspace]",
        "  /mh-evidence collect [workspace]",
        "  /mh-evidence report [workspace]",
        "  /mh-evidence clear <revision> [workspace]",
        "  /mh-evidence unlock --force",
        "Collection is fixed read-only Git inspection. The agent uses mh_code_evidence actions to collect, read, or record external checks.",
      ].join("\n"));
    }
    if (subcommand === "collect") {
      const collected = await collectRepositoryEvidence(tail || null, ctx.cwd);
      const report = saveCollection(ctx, collected);
      return commandOutput(formatReport(report));
    }
    if (subcommand === "status" || subcommand === "report") {
      const report = await findReport(ctx, tail || null);
      return commandOutput(report ? formatReport(report) : "No Code Evidence report is available for this conversation/workspace.");
    }
    if (subcommand === "clear") {
      const revision = Number(rest.shift());
      const workspace = rest.join(" ").trim() || ctx.cwd;
      const removed = await clearReport(ctx, workspace, revision);
      return commandOutput(removed ? "Code Evidence report cleared." : "No Code Evidence report exists for that workspace.");
    }
    if (subcommand === "unlock" && rest.join(" ") === "--force") {
      return commandOutput(forceUnlock() ? "Code Evidence mutation lock quarantined and removed by explicit human override." : "No Code Evidence mutation lock exists.");
    }
    return commandOutput("Usage: /mh-evidence [status|collect|report|clear]", false);
  } catch (error) {
    return commandOutput(error instanceof Error ? error.message : String(error), false);
  }
}

// Isolated repository smoke seam; normal packaged runtimes export null.
export const __testing = process.env.MAHIRO_CODE_EVIDENCE_TESTING === "1"
  ? Object.freeze({ collectRepositoryEvidence, readState, reportSummary, statePath: STATE_PATH, lockPath: LOCK_PATH, disablePath: DISABLE_PATH })
  : null;

const CODE_EVIDENCE_PARAMETERS = {
  type: "object",
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["get", "collect", "record"] },
    workspace: { type: "string", description: "Repository or child path. Optional for get/collect; required for record." },
    base_ref: { type: "string", description: "Optional explicit Git base ref for collect. Without it, uses the upstream merge-base when available." },
    expected_revision: { type: "integer", minimum: 1 },
    kind: { type: "string", enum: ["file", "command", "test", "browser", "native", "manual", "other"] },
    result: { type: "string", enum: ["passed", "failed", "observed", "blocked"] },
    summary: { type: "string", maxLength: MAX_TEXT_CHARS },
    reference: { type: "string", maxLength: MAX_REFERENCE_CHARS },
    command: { type: "string", maxLength: 500 },
    criterion_ids: { type: "array", maxItems: 20, items: { type: "string", maxLength: 120 } },
  },
  additionalProperties: false,
};

export default function activate(letta: any) {
  if (existsSync(DISABLE_PATH)) return;
  const disposers: Array<() => void> = [];

  if (letta.capabilities?.commands && letta.commands?.register) {
    disposers.push(letta.commands.register({
      id: "mh-evidence",
      description: "Collect and inspect bounded read-only repository evidence for Mahiro Goal work",
      args: "[status|collect|report|clear] [workspace]",
      run: runCommand,
    }));
  }

  if (letta.capabilities?.tools && letta.tools?.register) {
    disposers.push(letta.tools.register({
      name: "mh_code_evidence",
      description: "Unified bounded Code Evidence actions: get the latest report, collect fixed read-only Git metadata, or record a summary of an already-performed check. Never runs arbitrary commands, verifies human criteria, or mutates Goal state.",
      parameters: CODE_EVIDENCE_PARAMETERS,
      parallelSafe: false,
      async run(ctx: any) {
        const args = ctx.args ?? {};
        if (args.action === "get") {
          const report = await findReport(ctx, args.workspace);
          if (report) return reportSummary(report);
          const reports = conversationReports(readState(), ctx).map((item) => ({ repositoryRoot: item.repositoryRoot, revision: item.revision, updatedAt: item.updatedAt }));
          return { status: "empty", message: "No unique Code Evidence report found. Pass workspace or collect first.", reports };
        }
        if (args.action === "collect") {
          const collected = await collectRepositoryEvidence(args.workspace, ctx.cwd, args.base_ref);
          return reportSummary(saveCollection(ctx, collected));
        }
        if (args.action === "record") {
          for (const field of ["workspace", "expected_revision", "kind", "result", "summary"]) {
            if (args[field] == null || args[field] === "") throw new Error(`Code Evidence record action requires ${field}.`);
          }
          return reportSummary(await recordEvidence(ctx, args));
        }
        throw new Error('Code Evidence action must be "get", "collect", or "record".');
      },
    }));
  }

  if (disposers.length === 0) {
    letta.diagnostics?.report?.({ severity: "warning", message: "Mahiro Code Evidence requires commands or tools capability." });
    return;
  }

  return () => {
    if (letta.signal?.aborted) return;
    for (const dispose of disposers.reverse()) dispose();
  };
}
