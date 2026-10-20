import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface ICommandResult {
  ok: boolean;
  output: string;
}

type IMode = "off" | "suggest" | "rewrite-safe" | "rewrite-rtk";

interface IRewriteLogItem {
  timestamp: string;
  mode: IMode;
  action: "suggested" | "rewritten" | "skipped";
  toolName: string;
  cwd: string | null;
  input: string;
  output?: string;
  reason?: string;
}

interface IState {
  mode: IMode;
  updatedAt: string;
  recent: IRewriteLogItem[];
}

interface IToolStartEvent {
  toolName: string;
  args: Record<string, unknown>;
}

const HOME = homedir();
const SETTINGS_PATHS = [
  join(HOME, ".letta", "settings.json"),
  join(HOME, ".letta", "settings.local.json"),
];

const STATE_PATH = join(HOME, ".letta", "mods", "rtk-control.state.json");
const DISABLE_PATH = process.env.MAHIRO_RTK_CONTROL_DISABLE_PATH
  ?? join(HOME, ".letta", "mods", "mahiro-rtk-control.disabled");
const RTK_HISTORY_DB = join(HOME, "Library", "Application Support", "rtk", "history.db");
const VALID_MODES = new Set<IMode>(["off", "suggest", "rewrite-safe", "rewrite-rtk"]);

const run = (command: string, args: string[] = []): ICommandResult => {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    return { ok: true, output };
  } catch (error) {
    const maybeProcessError = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      message?: string;
    };
    const stdout = maybeProcessError.stdout?.toString?.().trim() ?? "";
    const stderr = maybeProcessError.stderr?.toString?.().trim() ?? "";
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: stdout || stderr || message };
  }
};

const commandExists = (command: string): boolean => run("which", [command]).ok;

const defaultState = (): IState => ({
  mode: "off",
  updatedAt: new Date().toISOString(),
  recent: [],
});

const normalizeMode = (value: unknown): IMode => {
  if (value === "rewrite") return "rewrite-safe";
  return VALID_MODES.has(value as IMode) ? (value as IMode) : "off";
};


const readJsonFile = (path: string): unknown => {
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const readState = (): IState => {
  const raw = readJsonFile(STATE_PATH) as Partial<IState> | null;
  const mode = normalizeMode(raw?.mode);
  const recent = Array.isArray(raw?.recent) ? raw.recent.slice(0, 20) as IRewriteLogItem[] : [];

  return {
    mode,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    recent,
  };
};

const writeState = (state: IState): void => {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const setMode = (mode: IMode): IState => {
  const state = readState();
  const next = { ...state, mode, updatedAt: new Date().toISOString() };
  writeState(next);
  return next;
};

const appendLog = (item: Omit<IRewriteLogItem, "timestamp">): void => {
  const state = readState();
  const next: IState = {
    ...state,
    updatedAt: new Date().toISOString(),
    recent: [{ ...item, timestamp: new Date().toISOString() }, ...state.recent].slice(0, 20),
  };
  writeState(next);
};

const collectStringMatches = (value: unknown, needle: RegExp, path = ""): string[] => {
  if (typeof value === "string") {
    return needle.test(value) ? [`${path || "$"}: ${value}`] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectStringMatches(item, needle, `${path}[${index}]`),
    );
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      collectStringMatches(item, needle, path ? `${path}.${key}` : key),
    );
  }

  return [];
};

const getHookRefs = (): string[] => {
  const refs: string[] = [];

  for (const path of SETTINGS_PATHS) {
    const json = readJsonFile(path);
    if (!json) continue;

    for (const match of collectStringMatches(json, /\b(rtk|hypa)\b/i)) {
      refs.push(`${path}: ${match}`);
    }
  }

  return refs;
};

const getModListHypaLine = (): string | null => {
  const result = run("letta", ["mods", "list"]);
  if (!result.ok) return null;

  return result.output
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().includes("@letta-ai/hypa"))
    ?.trim() ?? null;
};

const getVersion = (binary: string): string => {
  if (!commandExists(binary)) return "missing";

  const version = run(binary, ["--version"]);
  if (!version.ok || !version.output) return "present, version unknown";
  return version.output.split(/\r?\n/)[0] ?? "present, version unknown";
};

const formatCount = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
};

const parseNumber = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const compactPath = (path: string): string => {
  if (!path || path === "(unknown)") return "(unknown)";
  const homePrefix = `${HOME}/`;
  const normalized = path.startsWith(homePrefix) ? `~/${path.slice(homePrefix.length)}` : path;
  if (normalized.length <= 72) return normalized;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return normalized.slice(0, 69) + "...";
  return `.../${parts.slice(-3).join("/")}`;
};

const scopeWhereClause = (scope: string): string => {
  if (scope === "today") return "WHERE date(timestamp)=date('now')";
  if (scope === "all") return "";
  return "WHERE datetime(timestamp) >= datetime('now','-7 days')";
};

const scopeLabel = (scope: string): string => {
  if (scope === "today") return "Today";
  if (scope === "all") return "All-time";
  return "Last 7 days";
};

const queryRtkHistory = (sql: string): string | null => {
  if (!existsSync(RTK_HISTORY_DB)) return null;
  const result = run("sqlite3", ["-noheader", "-separator", "\t", RTK_HISTORY_DB, sql]);
  if (!result.ok) return null;
  return result.output;
};

const buildRtkProjects = (args: string): string => {
  const requested = args.trim().split(/\s+/)[1]?.toLowerCase() ?? "7d";
  const scope = requested === "all" || requested === "today" ? requested : "7d";
  const where = scopeWhereClause(scope);
  const rows = queryRtkHistory(
    `SELECT CASE WHEN project_path='' THEN '(unknown)' ELSE project_path END, COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(saved_tokens),0), ROUND(100.0*COALESCE(SUM(saved_tokens),0)/NULLIF(SUM(input_tokens),0),2) FROM commands ${where} GROUP BY project_path ORDER BY SUM(saved_tokens) DESC LIMIT 12;`,
  );

  const lines = [`RTK Projects (${scopeLabel(scope)})`, ""];
  if (!rows) {
    lines.push("No RTK project history found for this scope.");
    return lines.join("\n");
  }

  for (const row of rows.split(/\r?\n/).filter(Boolean)) {
    const [project, commands, input, output, saved, pct] = row.split("\t");
    lines.push(
      `- ${compactPath(project)}: ${formatCount(parseNumber(saved))} saved / ${formatCount(parseNumber(input))} input (${parseNumber(pct).toFixed(1)}%, ${formatCount(parseNumber(commands))} cmds, out ${formatCount(parseNumber(output))})`,
    );
  }

  lines.push("", "Scopes: /rtk projects today | /rtk projects 7d | /rtk projects all");
  return lines.join("\n");
};

const buildRtkGain = (): string => {
  const allTime = run("rtk", ["gain", "--format", "json"]);
  const lines = ["RTK Gain", ""];

  if (allTime.ok) {
    try {
      const parsed = JSON.parse(allTime.output) as {
        summary?: {
          total_commands?: number;
          total_input?: number;
          total_output?: number;
          total_saved?: number;
          avg_savings_pct?: number;
        };
      };
      const summary = parsed.summary ?? {};
      const saved = parseNumber(summary.total_saved);
      const input = parseNumber(summary.total_input);
      const output = parseNumber(summary.total_output);
      const pct = parseNumber(summary.avg_savings_pct);
      lines.push(
        `All-time: ${formatCount(saved)} saved / ${formatCount(input)} input (${pct.toFixed(1)}%)`,
        `Commands: ${formatCount(parseNumber(summary.total_commands))}; output after RTK: ${formatCount(output)}`,
      );
    } catch {
      lines.push("All-time: unable to parse `rtk gain --format json`.");
    }
  } else {
    lines.push(`All-time: unable to run rtk gain (${allTime.output})`);
  }

  const today = queryRtkHistory(
    "SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(saved_tokens),0), ROUND(100.0*COALESCE(SUM(saved_tokens),0)/NULLIF(SUM(input_tokens),0),2) FROM commands WHERE date(timestamp)=date('now');",
  );

  if (today) {
    const [commands, input, output, saved, pct] = today.split("\t");
    lines.push(
      "",
      `Today: ${formatCount(parseNumber(saved))} saved / ${formatCount(parseNumber(input))} input (${parseNumber(pct).toFixed(1)}%)`,
      `Commands: ${formatCount(parseNumber(commands))}; output after RTK: ${formatCount(parseNumber(output))}`,
    );

    const topToday = queryRtkHistory(
      "SELECT rtk_cmd, COUNT(*), COALESCE(SUM(saved_tokens),0), ROUND(AVG(savings_pct),1) FROM commands WHERE date(timestamp)=date('now') GROUP BY rtk_cmd ORDER BY SUM(saved_tokens) DESC LIMIT 3;",
    );

    if (topToday) {
      lines.push("", "Top today savers:");
      for (const row of topToday.split(/\r?\n/).filter(Boolean)) {
        const [cmd, count, savedTokens, avgPct] = row.split("\t");
        if (parseNumber(savedTokens) <= 0) continue;
        lines.push(`- ${cmd}: ${formatCount(parseNumber(savedTokens))} saved (${count}x, avg ${parseNumber(avgPct).toFixed(1)}%)`);
      }
    }
  }

  const sevenDay = queryRtkHistory(
    "SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(saved_tokens),0), ROUND(100.0*COALESCE(SUM(saved_tokens),0)/NULLIF(SUM(input_tokens),0),2) FROM commands WHERE datetime(timestamp) >= datetime('now','-7 days');",
  );

  if (sevenDay) {
    const [commands, input, output, saved, pct] = sevenDay.split("\t");
    lines.push(
      "",
      `Last 7 days: ${formatCount(parseNumber(saved))} saved / ${formatCount(parseNumber(input))} input (${parseNumber(pct).toFixed(1)}%)`,
      `Commands: ${formatCount(parseNumber(commands))}; output after RTK: ${formatCount(parseNumber(output))}`,
    );

    const top = queryRtkHistory(
      "SELECT rtk_cmd, COUNT(*), COALESCE(SUM(saved_tokens),0), ROUND(AVG(savings_pct),1) FROM commands WHERE datetime(timestamp) >= datetime('now','-7 days') GROUP BY rtk_cmd ORDER BY SUM(saved_tokens) DESC LIMIT 5;",
    );

    if (top) {
      lines.push("", "Top 7-day savers:");
      for (const row of top.split(/\r?\n/).filter(Boolean)) {
        const [cmd, count, savedTokens, avgPct] = row.split("\t");
        lines.push(`- ${cmd}: ${formatCount(parseNumber(savedTokens))} saved (${count}x, avg ${parseNumber(avgPct).toFixed(1)}%)`);
      }
    }
  } else {
    lines.push("", "Last 7 days: no RTK history DB available.");
  }

  lines.push("", "Read-only: this command reads RTK history only; it does not enable hooks or rewrite commands.");
  return lines.join("\n");
};

const buildRewritePreview = (command: string): string => {
  const trimmed = command.trim();
  if (!trimmed) {
    return "Usage: /rtk rewrite <raw command>\nExample: /rtk rewrite git diff";
  }

  const rewrite = getRtkRewrite(trimmed);
  if (!rewrite) {
    return [
      "RTK rewrite preview",
      "",
      `Input: ${trimmed}`,
      "Output: no RTK rewrite available; use the raw command.",
      "",
      "Read-only: preview only. Nothing was executed or installed.",
    ].join("\n");
  }

  return [
    "RTK rewrite preview",
    "",
    `Input:  ${trimmed}`,
    `Output: ${rewrite}`,
    "",
    "Read-only: preview only. Nothing was executed or installed.",
  ].join("\n");
};

const getRtkRewrite = (command: string): string | null => {
  const result = run("rtk", ["rewrite", command.trim()]);
  if (!result.output || result.output.startsWith("Command failed:")) return null;
  return result.output.trim();
};

const isShellTool = (toolName: string): boolean => {
  const normalized = toolName.toLowerCase();
  return normalized === "exec_command" || normalized === "bash" || normalized === "shellcommand" || normalized === "shell-command";
};

const getCommandArgKey = (args: Record<string, unknown>): "cmd" | "command" | null => {
  if (typeof args.cmd === "string") return "cmd";
  if (typeof args.command === "string") return "command";
  return null;
};

const hasShellMetacharacters = (command: string): boolean => /[;&|`<>$]/.test(command);
const isDirectGitCommit = (command: string): boolean => /^git\s+commit(?=\s|$)/.test(command);

const isSafeRewriteCandidate = (command: string): { ok: boolean; reason?: string } => {
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, reason: "empty command" };
  if (trimmed.includes("\n")) return { ok: false, reason: "multiline commands stay raw" };
  if (hasShellMetacharacters(trimmed)) return { ok: false, reason: "shell metacharacters stay raw" };
  if (/^(rtk|hypa)\b/.test(trimmed)) return { ok: false, reason: "already explicit RTK/Hypa" };
  if (/^git\s+(commit|push|pull|merge|rebase|reset|checkout|switch|tag|add|restore|clean|stash)\b/.test(trimmed)) {
    return { ok: false, reason: "write-capable git commands stay raw" };
  }
  if (/^(rm|mv|cp|install|brew|npm\s+install|pnpm\s+install|yarn\s+install|bun\s+install)\b/.test(trimmed)) {
    return { ok: false, reason: "write/install commands stay raw" };
  }

  if (/^git\s+(diff|status|log|show|branch|worktree\s+list)\b/.test(trimmed)) return { ok: true };
  if (/^(rg|grep|find|ls|tree|wc)\b/.test(trimmed)) return { ok: true };
  if (/^(cat|head|tail)\b/.test(trimmed)) return { ok: true };
  if (/^sed\s+-n\b/.test(trimmed)) return { ok: true };

  return { ok: false, reason: "not in RTK mod allowlist" };
};

const handleToolStart = (event: IToolStartEvent, ctx: { cwd?: string } = {}): { args: Record<string, unknown> } | undefined => {
  const state = readState();
  if (state.mode === "off") return;
  if (!isShellTool(event.toolName)) return;

  const argKey = getCommandArgKey(event.args);
  if (!argKey) return;

  const original = String(event.args[argKey] ?? "").trim();
  // Keep commits byte-for-byte raw in every mode; a full-mode RTK wrapper
  // changes the command shape before the commit guard's final recheck.
  if (isDirectGitCommit(original)) return;
  const isFullRtkMode = state.mode === "rewrite-rtk";

  if (!isFullRtkMode) {
    const safe = isSafeRewriteCandidate(original);
    if (!safe.ok) {
      appendLog({
        mode: state.mode,
        action: "skipped",
        toolName: event.toolName,
        cwd: ctx.cwd ?? null,
        input: original,
        reason: safe.reason,
      });
      return;
    }
  } else if (!original) {
    appendLog({
      mode: state.mode,
      action: "skipped",
      toolName: event.toolName,
      cwd: ctx.cwd ?? null,
      input: original,
      reason: "empty command",
    });
    return;
  }

  const rewrite = getRtkRewrite(original);
  if (!rewrite || rewrite === original) {
    // Avoid noisy logs for ordinary commands that RTK intentionally does not rewrite.
    return;
  }

  if (state.mode === "suggest") {
    appendLog({
      mode: state.mode,
      action: "suggested",
      toolName: event.toolName,
      cwd: ctx.cwd ?? null,
      input: original,
      output: rewrite,
    });
    return;
  }

  const nextArgs = { ...event.args, [argKey]: rewrite };
  appendLog({
    mode: state.mode,
    action: "rewritten",
    toolName: event.toolName,
    cwd: ctx.cwd ?? null,
    input: original,
    output: rewrite,
  });
  return { args: nextArgs };
};

const buildStatus = (): string => {
  const hookRefs = getHookRefs();
  const hypaLine = getModListHypaLine();
  const state = readState();

  const lines = [
    "RTK Control",
    "",
    `RTK binary: ${getVersion("rtk")}`,
    `Hypa binary: ${getVersion("hypa")}`,
    `Hypa Letta mod: ${hypaLine ?? "not installed/list unavailable"}`,
    `Hook refs: ${hookRefs.length === 0 ? "none" : `${hookRefs.length} found`}`,
    `Mode: ${state.mode}`,
    `Control state: ${existsSync(STATE_PATH) ? STATE_PATH : "none"}`,
  ];

  if (hookRefs.length > 0) {
    lines.push("", "Hook refs:", ...hookRefs.map((ref) => `- ${ref}`));
  }

  const recent = state.recent.slice(0, 3);
  if (recent.length > 0) {
    lines.push("", "Recent RTK mod activity:");
    for (const item of recent) {
      const arrow = item.output ? ` -> ${item.output}` : item.reason ? ` (${item.reason})` : "";
      lines.push(`- ${item.action}: ${item.input}${arrow}`);
    }
  }

  lines.push(
    "",
    "Recommended posture:",
    "- Mode off by default.",
    "- Use suggest to log recommendations without rewriting.",
    "- Use rewrite-safe for conservative read-only rewrites.",
    "- Use rewrite-rtk only when you want broader RTK hook-like behavior.",
    "- No separate settings hooks are required.",
  );

  return lines.join("\n");
};

const buildDoctor = (): string => {
  const status = buildStatus();
  const issues: string[] = [];
  const hookRefs = getHookRefs();
  const hypaLine = getModListHypaLine();

  if (hookRefs.some((ref) => /rtk-letta-rewrite|rtk-suggest-heavy|hypa/i.test(ref))) {
    issues.push("Hook rewrite refs are present; inspect before assuming mod-only RTK behavior.");
  }

  if (hypaLine?.startsWith("enabled")) {
    issues.push("Hypa Letta mod is enabled; run `letta mods disable npm:@letta-ai/hypa` then `/reload` if you want it off.");
  }

  if (!commandExists("rtk")) {
    issues.push("RTK binary is missing; keep this mod status-only until RTK is installed.");
  }

  return [
    status,
    "",
    "Doctor:",
    ...(issues.length === 0 ? ["- No active external RTK/Hypa hook integration detected.", "- rewrite-safe is conservative; rewrite-rtk is the broader RTK hook-like mode."] : issues.map((issue) => `- ${issue}`)),
  ].join("\n");
};

const buildModeOutput = (args: string): string => {
  const rawRequested = args.trim().split(/\s+/)[1];
  const requested = rawRequested === "rewrite" ? "rewrite-safe" : rawRequested as IMode | undefined;
  if (!requested) {
    const state = readState();
    return [
      `RTK mode: ${state.mode}`,
      "",
      "Modes:",
      "- off: do nothing (default)",
      "- suggest: log safe RTK rewrites but execute raw commands",
      "- rewrite-safe: rewrite conservative read-only allowlist only",
      "- rewrite-rtk: rewrite using RTK's broader `rtk rewrite` result",
      "",
      "Use: /rtk mode off|suggest|rewrite-safe|rewrite-rtk",
      "Alias: /rtk mode rewrite -> rewrite-safe",
    ].join("\n");
  }

  if (!VALID_MODES.has(requested)) {
    return "Usage: /rtk mode off|suggest|rewrite-safe|rewrite-rtk";
  }

  const state = setMode(requested);
  return [
    `RTK mode set to: ${state.mode}`,
    "",
    state.mode === "rewrite-safe"
      ? "Safe read-only shell commands may now be rewritten through RTK by this mod. Write-capable commands stay raw."
      : state.mode === "rewrite-rtk"
        ? "Broader RTK hook-like rewrites are enabled through `rtk rewrite`. Use /rtk log to inspect activity."
        : state.mode === "suggest"
          ? "Safe RTK rewrite opportunities will be logged but not executed."
          : "RTK command rewriting is off.",
    "No settings hooks were installed or changed.",
  ].join("\n");
};

const truncateOneLine = (value: string | undefined, maxLength = 96): string => {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
};

const formatLocalTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const buildLog = (args: string): string => {
  const state = readState();
  const parts = args.trim().split(/\s+/).slice(1);
  const first = parts[0]?.toLowerCase();

  if (first === "clear") {
    writeState({ ...state, updatedAt: new Date().toISOString(), recent: [] });
    return `RTK mod activity log cleared. Mode remains ${state.mode}.`;
  }

  const requestedLimit = first ? Number(first) : 10;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(50, Math.floor(requestedLimit)))
    : 10;

  if (state.recent.length === 0) {
    return [
      "RTK mod activity log is empty.",
      "",
      `Mode: ${state.mode}`,
      "Use /rtk log after commands run, or /rtk log clear to reset the recent log.",
    ].join("\n");
  }

  const lines = [
    `RTK mod activity (last ${Math.min(limit, state.recent.length)} of ${state.recent.length}; mode ${state.mode})`,
    "",
  ];

  for (const item of state.recent.slice(0, limit)) {
    const cwd = item.cwd ? ` @ ${compactPath(item.cwd)}` : "";
    const reason = item.reason ? ` (${item.reason})` : "";
    lines.push(`- ${formatLocalTime(item.timestamp)} ${item.action}${cwd}`);
    lines.push(`  in : ${truncateOneLine(item.input, 112)}`);
    if (item.output) lines.push(`  out: ${truncateOneLine(item.output, 112)}`);
    if (reason) lines.push(`  note:${reason}`);
  }

  lines.push("", "Use /rtk log <n> for more entries, /rtk log clear to reset.");
  return lines.join("\n");
};

const help = [
  "RTK control commands:",
  "- /rtk or /rtk status — show RTK/Hypa integration state",
  "- /rtk doctor — status plus warnings",
  "- /rtk guidance — show recommended architecture and guardrail differences from RTK hooks",
  "- /rtk gain — show RTK all-time/today/7-day token savings",
  "- /rtk projects [today|7d|all] — show token savings by project",
  "- /rtk rewrite <command> — preview raw command -> RTK command",
  "- /rtk mode [off|suggest|rewrite-safe|rewrite-rtk] — control mod-based rewrite mode",
  "- /rtk log [n|clear] — show or clear recent mod suggestions/rewrites/skips",
  "",
  "Default mode is off. This mod never installs settings hooks.",
].join("\n");

const guidance = [
  "RTK mod direction:",
  "- Mod = control-plane + optional tool_start rewrite layer.",
  "- Separate settings hooks are not needed for Letta Code when this mod is active.",
  "- rewrite-safe is intentionally conservative: safe read-only allowlist only.",
  "- rewrite-rtk uses RTK's broader `rtk rewrite` result and is closer to RTK hook behavior.",
  "- Default mode remains off; suggest logs safe opportunities; choose rewrite-rtk explicitly for broader behavior.",
  "- Compression should stay visible through /rtk status and /rtk log.",
].join("\n");

export default function activate(letta: any) {
  if (existsSync(DISABLE_PATH)) return;
  const disposers: Array<() => void> = [];

  if (letta.capabilities.commands) {
    disposers.push(letta.commands.register({
      id: "rtk",
      description: "Show and control RTK integration state, savings, and safe mod-based rewrites",
      args: "[status|doctor|guidance|gain|projects [today|7d|all]|rewrite <cmd>|mode <off|suggest|rewrite-safe|rewrite-rtk>|log]",
      run(ctx: { args?: string }) {
        const rawArgs = (ctx.args ?? "").trim();
        const command = rawArgs.split(/\s+/, 1)[0]?.toLowerCase() ?? "";

        if (!rawArgs || command === "status") return { type: "output", output: buildStatus() };
        if (command === "doctor") return { type: "output", output: buildDoctor() };
        if (command === "guidance") return { type: "output", output: guidance };
        if (command === "gain") return { type: "output", output: buildRtkGain() };
        if (command === "projects") return { type: "output", output: buildRtkProjects(rawArgs) };
        if (command === "rewrite") return { type: "output", output: buildRewritePreview(rawArgs.slice("rewrite".length)) };
        if (command === "mode") return { type: "output", output: buildModeOutput(rawArgs) };
        if (command === "log") return { type: "output", output: buildLog(rawArgs) };

        return { type: "output", output: help };
      },
    }));
  }

  if (letta.capabilities.events?.tools) {
    disposers.push(letta.events.on("tool_start", handleToolStart));
  }

  return () => {
    if (letta.signal?.aborted) return;
    for (const dispose of disposers.reverse()) dispose();
  };
}

export const __testing = { isDirectGitCommit };
