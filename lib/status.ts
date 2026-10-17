import { execFile } from "node:child_process";

export const TTL_MS = 30_000;
export const HEARTBEAT_MS = 10_000;
export const GIT_INTERVAL_MS = 5_000;
export const TOKENS = ["mahiro_sidebar_model", "mahiro_sidebar_provider", "mahiro_sidebar_context"] as const;

export function text(value: unknown, limit = 100): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(clean))
    .slice(0, limit).map(part => part.segment).join("");
}

// Porcelain v1 -z: rename/copy records consume a second path, even when it
// looks like another status/header. Filenames themselves are never rendered.
export function gitStatus(output: string): string {
  const records = output.split("\0");
  let dirty = 0, untracked = 0, ahead = 0, behind = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith("## ")) {
      ahead = Number(record.match(/\bahead (\d+)/)?.[1] ?? 0);
      behind = Number(record.match(/\bbehind (\d+)/)?.[1] ?? 0);
    } else if (record.startsWith("?? ")) {
      untracked++;
    } else if (record.length >= 3 && record[2] === " ") {
      dirty++;
      if (/[RC]/.test(record.slice(0, 2))) i++;
    }
  }
  return `git ${dirty ? `dirty:${dirty}` : "clean"}${untracked ? ` ?:${untracked}` : ""}${ahead ? ` ahead:${ahead}` : ""}${behind ? ` behind:${behind}` : ""}`;
}

export interface SnapshotContext {
  model?: { id: string; name?: string; provider: string };
  thinkingLevel?: string;
  getContextUsage(): { percent: number | null } | undefined;
}

interface UsageMessage {
  model?: string;
  provider?: string;
  stopReason?: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

export function freshUsage(message: UsageMessage | undefined, model: SnapshotContext["model"]): boolean {
  if (!model || !message || message.model !== model.id || message.provider !== model.provider
    || !["stop", "length", "toolUse"].includes(message.stopReason ?? "")) return false;
  const values = [message.usage?.input, message.usage?.output, message.usage?.cacheRead, message.usage?.cacheWrite];
  return values.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)
    && values.reduce<number>((sum, value) => sum + (value ?? 0), 0) > 0;
}

export function display(ctx: SnapshotContext, hideContext = false): string[] {
  const id = text(ctx.model?.id);
  const provider = text(ctx.model?.provider);
  const effort = text(ctx.thinkingLevel, 24);
  const model = id ? `${text(ctx.model?.name) || id}${effort ? ` · ${effort}` : ""}` : "";
  let percent: number | null | undefined;
  try { percent = hideContext ? undefined : ctx.getContextUsage()?.percent; } catch { /* unknown */ }
  let context = "";
  if (typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
    let filled = Math.round(percent / 100 * 6);
    if (percent > 0 && percent < 100) filled = Math.max(1, Math.min(5, filled));
    context = `ctx ${"▰".repeat(filled)}${"▱".repeat(6 - filled)} ${Math.round(percent)}%`;
  }
  return [model, provider, context];
}

export interface Job { promise: Promise<string>; cancel(): void }
export type Run = (command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv) => Job;

export const run: Run = (command, args, cwd, env) => {
  let child: ReturnType<typeof execFile> | undefined;
  const promise = new Promise<string>((resolve, reject) => {
    child = execFile(command, args, {
      cwd, env, timeout: 1_500, killSignal: "SIGKILL", maxBuffer: 256 * 1024, encoding: "utf8",
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  return { promise, cancel: () => { child?.kill("SIGKILL"); } };
};

export function herdrBinding(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv | undefined {
  if (env.HERDR_ENV !== "1") return;
  // Keep the exact inherited socket, pane and session routing. Never infer a
  // destination from focus, cwd, config files, or another process.
  if (![env.HERDR_PANE_ID, env.HERDR_SOCKET_PATH].every(value =>
    value && value.length <= 1024 && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !value.startsWith("-"))) return;
  return { ...env };
}

export function metadataArgs(pane: string, values: string[], seq: number): string[] {
  const args = ["pane", "report-metadata", pane, "--source", "mahiro:pi-display", "--agent", "pi",
    "--seq", String(seq), "--ttl-ms", String(TTL_MS)];
  TOKENS.forEach((key, i) => {
    args.push(...(values[i] ? ["--token", `${key}=${values[i]}`] : ["--clear-token", key]));
  });
  return args;
}

// Child sessions can inherit HERDR_* from their parent. Environment identity
// alone must never give a background Pi authority over the parent's display.
export function publishMetadata(execute: Run, binding: NodeJS.ProcessEnv, args: string[], pid = process.pid): Job {
  let cancelled = false;
  let active = execute("herdr", ["pane", "process-info", "--pane", binding.HERDR_PANE_ID!], undefined, binding);
  const promise = active.promise.then(output => {
    if (cancelled) throw new Error("Display publication cancelled");
    const info = JSON.parse(output)?.result?.process_info;
    if (info?.pane_id !== binding.HERDR_PANE_ID || !Array.isArray(info.foreground_processes)
      || !info.foreground_processes.some((item: { pid?: unknown }) => item?.pid === pid)) {
      throw new Error("Pi does not own the foreground pane");
    }
    active = execute("herdr", args, undefined, binding);
    return active.promise;
  });
  return { promise, cancel() { cancelled = true; active.cancel(); } };
}

export interface SharedOwner { seq: number; dispose?: () => void }
const ownerKey = Symbol.for("mahirocoko.pi-display.owner.v1");
export function sharedOwner(): SharedOwner {
  const root = globalThis as typeof globalThis & { [ownerKey]?: SharedOwner };
  return root[ownerKey] ??= { seq: Date.now() * 1000 };
}

interface Context extends SnapshotContext {
  cwd: string;
  mode: string;
  isIdle(): boolean;
  ui: { setStatus(key: string, value: string | undefined): void };
}
interface Options {
  run?: Run;
  publish?: typeof publishMetadata;
  env?: NodeJS.ProcessEnv;
  owner?: SharedOwner;
  now?: () => number;
  every?: (callback: () => void, ms: number) => () => void;
  presentation?: {
    render(state: { git: string; activity: string; hideContext: boolean }): void;
    tick(): void;
    tokens(): Record<string, string>;
    invalidate?(model?: SnapshotContext["model"]): void;
    dispose(): void;
  };
}

export function start(ctx: Context, options: Options = {}) {
  // SDK child sessions may share this process. A non-TUI session must not
  // claim or dispose the interactive session's process-global display owner.
  if (ctx.mode !== "tui") {
    const noop = () => {};
    return { tick: noop, dispose: noop, toolStart: (_id: string, _name: string) => {},
      toolEnd: (_id: string) => {}, settled: noop, contextFresh: (_message?: UsageMessage) => {}, modelChanged: (_model?: SnapshotContext["model"]) => {} };
  }
  const execute = options.run ?? run;
  const owner = options.owner ?? sharedOwner();
  owner.dispose?.();
  const now = options.now ?? Date.now;
  const binding = herdrBinding(options.env ?? process.env);
  const tools = new Map<string, string>();
  let alive = true, git = "git unknown", gitAt = -Infinity, metadataAt = -Infinity;
  let gitJob: Job | undefined, metadataJob: Job | undefined;
  let lastValues = "", identity = "", hideContext = false;
  let revision = 0;
  let pendingModel: SnapshotContext["model"];
  let stopTimer = () => {};

  function render() {
    if (!alive || ctx.mode !== "tui") return;
    const active = [...tools.values()];
    const activity = active.length ? `tool ${active.slice(0, 2).join(", ")}${active.length > 2 ? ` +${active.length - 2}` : ""}`
      : ctx.isIdle() ? "idle" : "working";
    if (options.presentation) options.presentation.render({ git, activity, hideContext });
    else ctx.ui.setStatus("mahiro-status", `${git} · ${activity}`);
  }

  function cancelMetadata() {
    metadataJob?.cancel();
    metadataJob = undefined;
  }

  function tick() {
    if (!alive || ctx.mode !== "tui") return;
    try {
      const nextIdentity = JSON.stringify([ctx.model?.provider, ctx.model?.id]);
      if (pendingModel?.provider === ctx.model?.provider && pendingModel?.id === ctx.model?.id) pendingModel = undefined;
      if (identity && nextIdentity !== identity) { hideContext = true; revision++; cancelMetadata(); }
      identity = nextIdentity;
      options.presentation?.tick();
      render();
      if (!gitJob && now() - gitAt >= GIT_INTERVAL_MS) {
        gitAt = now();
        const job = execute("git", ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--branch", "--untracked-files=normal"], ctx.cwd);
        gitJob = job;
        job.promise.then(output => { if (alive) { git = gitStatus(output); render(); } }, () => {
          if (alive) { git = "git unknown"; render(); }
        }).finally(() => { if (gitJob === job) gitJob = undefined; });
      }
      if (!binding || metadataJob) return;
      const values = display(ctx, hideContext);
      const quota = options.presentation?.tokens() ?? {};
      const serialized = JSON.stringify([values, quota]);
      if (serialized === lastValues && now() - metadataAt < HEARTBEAT_MS) return;
      const sentRevision = revision;
      const args = metadataArgs(binding.HERDR_PANE_ID!, values, ++owner.seq);
      // Direct OpenAI sidebar quota belongs to Herdr's shared Codex adapter,
      // including model_select before the host refreshes ctx.model.
      if (options.presentation && ctx.model?.provider !== "openai" && pendingModel?.provider !== "openai") for (const i of [1, 2]) for (const severity of ["ok", "warn", "critical"]) {
        const key = `mahiro_sidebar_q${i}_${severity}`;
        args.push(...(quota[key] ? ["--token", `${key}=${quota[key]}`] : ["--clear-token", key]));
      }
      const job = (options.publish ?? publishMetadata)(execute, binding, args);
      metadataJob = job;
      job.promise.then(() => {
        if (alive && revision === sentRevision) { lastValues = serialized; metadataAt = now(); }
      }, () => { /* optional display transport; retry on the next poll */ }).finally(() => {
        if (metadataJob === job) metadataJob = undefined;
      });
    } catch { /* A missing optional executable or unavailable context must not break Pi. */ }
  }

  function dispose() {
    if (!alive) return;
    alive = false;
    stopTimer();
    gitJob?.cancel();
    metadataJob?.cancel();
    tools.clear();
    if (owner.dispose === dispose) {
      owner.dispose = undefined;
      if (ctx.mode === "tui") {
        if (options.presentation) options.presentation.dispose();
        else ctx.ui.setStatus("mahiro-status", undefined);
      }
    }
    // No shutdown report: let display TTL expire; native Pi owns lifecycle.
  }
  owner.dispose = dispose;
  const every = options.every ?? ((callback, ms) => {
    const timer = setInterval(callback, ms);
    timer.unref();
    return () => clearInterval(timer);
  });
  if (ctx.mode === "tui") {
    stopTimer = every(tick, 1_000);
    tick();
  }
  return {
    tick,
    dispose,
    toolStart(id: string, name: string) { if (alive) { tools.set(id, text(name, 40) || "tool"); render(); } },
    toolEnd(id: string) { if (alive) { tools.delete(id); render(); } },
    settled() { if (alive) { tools.clear(); tick(); } },
    contextFresh(message?: UsageMessage) {
      if (alive && freshUsage(message, ctx.model)) {
        const nextIdentity = JSON.stringify([ctx.model?.provider, ctx.model?.id]);
        if (identity !== nextIdentity) { revision++; cancelMetadata(); }
        identity = nextIdentity;
        hideContext = false;
        tick();
      }
    },
    // model_select may arrive before ctx.model is refreshed. Clear old context
    // immediately, then the polling identity guard handles the refreshed model.
    modelChanged(model?: SnapshotContext["model"]) { if (alive) { pendingModel = model; hideContext = true; revision++; cancelMetadata(); lastValues = ""; options.presentation?.invalidate?.(model); tick(); } },
  };
}
