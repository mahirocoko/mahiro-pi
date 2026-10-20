import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const FORBIDDEN = [
  "Generated with [Letta Code](https://letta.com)",
  "Co-Authored-By: Letta Code <noreply@letta.com>",
];
const REMOVALS = [`👾 ${FORBIDDEN[0]}`, ...FORBIDDEN];

const SHELL_TOOLS = new Set(["Bash", "bash", "Shell", "shell", "ShellCommand", "shell_command", "exec_command"]);
const INLINE_COMMIT = /(^|[;&|()\n]\s*)(?:rtk\s+)?git\s+commit(?=\s|$)/;

function commandEntry(event) {
  const args = event?.args;
  if (!args || typeof args !== "object") return;
  if (args.command) return ["command", args.command];
  if (args.cmd) return ["cmd", args.cmd];
}

function commandText(value) {
  return Array.isArray(value) ? value.map(String).join(" ") : String(value ?? "");
}

function hasUnquotedHeredoc(command) {
  let quote = null;
  for (let cursor = 0; cursor < command.length - 1; cursor += 1) {
    const char = command[cursor];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === "\\") cursor += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "\\") cursor += 1;
    else if (char === "'" || char === '"') quote = char;
    else if (char === "<" && command[cursor + 1] === "<") return true;
  }
  return false;
}

function hasUnquotedComment(command) {
  let quote = null;
  for (let cursor = 0; cursor < command.length; cursor += 1) {
    const char = command[cursor];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"') quote = quote === '"' ? null : '"';
    else if (char === "\\") cursor += 1;
    else if (char === "'" && quote !== '"') quote = "'";
    else if (quote === null && char === "#" && (cursor === 0 || /[\s;&|()]/.test(command[cursor - 1]))) return true;
  }
  return false;
}

function hasDynamicShell(command) {
  let quote = null;
  for (let cursor = 0; cursor < command.length; cursor += 1) {
    const char = command[cursor];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (char === "'") quote = quote === '"' ? quote : "'";
    else if (char === '"') quote = quote === '"' ? null : '"';
    else if (char === "`"
      || (char === "$" && command[cursor + 1] === "(")
      || (char === "(" && command[cursor + 1] === "(")
      || ((char === "<" || char === ">") && command[cursor + 1] === "(")) return true;
  }
  return false;
}

function commandSegmentEnd(command, start) {
  let quote = null;
  for (let cursor = start; cursor < command.length; cursor += 1) {
    const char = command[cursor];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === "\\") cursor += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "\\") cursor += 1;
    else if (char === "'" || char === '"') quote = char;
    else if (";&|)\n".includes(char)) return cursor;
  }
  return command.length;
}

function hasUnquotedRedirect(command) {
  let quote = null;
  for (let cursor = 0; cursor < command.length; cursor += 1) {
    const char = command[cursor];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === "\\") cursor += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "\\") cursor += 1;
    else if (char === "'" || char === '"') quote = char;
    else if (char === "<" || char === ">") return true;
  }
  return false;
}

function hasShellExpansion(command) {
  let quote = null;
  for (let cursor = 0; cursor < command.length; cursor += 1) {
    const char = command[cursor];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === "\\") return true;
    if (char === "'" && quote === null) quote = "'";
    else if (char === '"') quote = quote === '"' ? null : '"';
    else if (char === "$" || char === "`" || (quote === null && /[?*{}\[\]~]/.test(char))) return true;
  }
  return quote !== null;
}

function shellTokens(command, start, end) {
  const tokens = [];
  let cursor = start;
  while (cursor < end) {
    while (cursor < end && /\s/.test(command[cursor])) cursor += 1;
    if (cursor >= end) break;
    const tokenStart = cursor;
    let quote = null;
    while (cursor < end) {
      const char = command[cursor];
      if (quote === "'") {
        cursor += 1;
        if (char === "'") quote = null;
        continue;
      }
      if (quote === '"') {
        if (char === "\\" && cursor + 1 < end) cursor += 2;
        else {
          cursor += 1;
          if (char === '"') quote = null;
        }
        continue;
      }
      if (/\s/.test(char)) break;
      if (char === "\\" && cursor + 1 < end) cursor += 2;
      else {
        cursor += 1;
        if (char === "'" || char === '"') quote = char;
      }
    }
    tokens.push({ start: tokenStart, end: cursor, raw: command.slice(tokenStart, cursor) });
  }
  return tokens;
}

function quotedContentSpan(token, prefixLength = 0) {
  const raw = token.raw.slice(prefixLength);
  const quote = raw[0];
  if ((quote !== "'" && quote !== '"') || raw.length < 2) return;
  let closing = -1;
  for (let cursor = 1; cursor < raw.length; cursor += 1) {
    if (quote === '"' && raw[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (raw[cursor] === quote) {
      closing = cursor;
      break;
    }
  }
  if (closing !== raw.length - 1) return;
  return { start: token.start + prefixLength + 1, end: token.start + prefixLength + closing, quote };
}

function commitMessageSpans(command) {
  if (!/^git\s+commit(?=\s|$)/.test(command)) return [];
  const spans = [];
  const tokens = shellTokens(command, 0, commandSegmentEnd(command, 0));
  if (tokens[0]?.raw !== "git" || tokens[1]?.raw !== "commit") return [];
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.raw === "-m" || token.raw === "--message") {
      const span = tokens[index + 1] && quotedContentSpan(tokens[index + 1]);
      if (span) spans.push(span);
      index += 1;
    } else if (token.raw.startsWith("--message=")) {
      const span = quotedContentSpan(token, "--message=".length);
      if (span) spans.push(span);
    } else if (token.raw.startsWith("-m") && token.raw.length > 2) {
      const span = quotedContentSpan(token, 2);
      if (span) spans.push(span);
    }
  }
  return spans;
}

function occurrenceSpans(command) {
  const occurrences = [];
  for (const pattern of FORBIDDEN) {
    let start = command.indexOf(pattern);
    while (start !== -1) {
      occurrences.push({ start, end: start + pattern.length });
      start = command.indexOf(pattern, start + pattern.length);
    }
  }
  return occurrences;
}

function sanitizeString(command) {
  if (hasUnquotedHeredoc(command) || hasUnquotedComment(command) || hasDynamicShell(command)) return;
  const spans = commitMessageSpans(command);
  const occurrences = occurrenceSpans(command);
  if (!spans.length || !occurrences.length) return;
  if (occurrences.some((occurrence) => !spans.some((span) => occurrence.start >= span.start && occurrence.end <= span.end))) return;
  let result = command;
  for (const span of [...spans].sort((left, right) => right.start - left.start)) {
    const value = result.slice(span.start, span.end);
    const sanitized = REMOVALS.reduce((current, pattern) => current.replaceAll(pattern, ""), value);
    result = result.slice(0, span.start) + sanitized + result.slice(span.end);
  }
  return result === command ? undefined : result;
}

function sanitizeArray(value) {
  if (String(value[0]) !== "git" || String(value[1]) !== "commit") return;
  const messageIndexes = new Set();
  for (let index = 2; index < value.length; index += 1) {
    const token = String(value[index]);
    if (token === "-m" || token === "--message") {
      if (index + 1 < value.length) messageIndexes.add(index + 1);
      index += 1;
    } else if (token.startsWith("--message=")) messageIndexes.add(index);
    else if (token.startsWith("-m") && token.length > 2) messageIndexes.add(index);
  }
  const attributedIndexes = value.flatMap((part, index) => FORBIDDEN.some((pattern) => String(part).includes(pattern)) ? [index] : []);
  if (!attributedIndexes.length || attributedIndexes.some((index) => !messageIndexes.has(index))) return;
  const result = value.map((part, index) => {
    if (!messageIndexes.has(index) || typeof part !== "string") return part;
    return REMOVALS.reduce((current, pattern) => current.replaceAll(pattern, ""), part);
  });
  return commandText(result) === commandText(value) ? undefined : result;
}

// Only a direct commit in this agent's actual MemFS Git root is outside the
// product-repository attribution policy. Unsupported shell shapes retain the
// existing sanitizer/denial behavior rather than inheriting an exemption.
function isMemfsCommit(event, ctx) {
  const toolName = event?.toolName?.split(".").at(-1);
  if (!SHELL_TOOLS.has(toolName) || ctx?.memfs?.enabled !== true) return false;
  if (!event.agentId || event.agentId !== ctx.agent?.id) return false;
  const memoryDir = ctx.memfs.memoryDir;
  if (typeof memoryDir !== "string" || !isAbsolute(memoryDir)) return false;
  const entry = commandEntry(event);
  const command = entry?.[1];
  if (typeof command !== "string" || !/^git\s+commit(?=\s|$)/.test(command)) return false;
  if (commandSegmentEnd(command, 0) !== command.length
    || hasUnquotedHeredoc(command) || hasUnquotedComment(command)
    || hasDynamicShell(command) || hasUnquotedRedirect(command) || hasShellExpansion(command)) return false;
  if (/(?:^|\s)--(?:git-dir|work-tree|config-env)(?:=|\s|$)/.test(command)) return false;

  const args = event.args;
  if (args.shell !== undefined || args.env !== undefined) return false;
  if (args.secretEnv !== undefined && (typeof args.secretEnv !== "object" || args.secretEnv === null)) return false;
  const hasGitOverride = (env) => Object.keys(env).some((key) => key.startsWith("GIT_") && key !== "GIT_PAGER");
  if (hasGitOverride(args.secretEnv ?? {}) || hasGitOverride(process.env)) return false;

  const hasWorkdir = Object.hasOwn(args, "workdir");
  if (hasWorkdir && (toolName !== "exec_command" || typeof args.workdir !== "string" || !isAbsolute(args.workdir))) return false;
  const eventCwd = event.cwd ?? event.workingDirectory;
  const target = hasWorkdir ? args.workdir : eventCwd ?? ctx.cwd;
  if (typeof target !== "string" || !isAbsolute(target)) return false;
  try {
    const root = lstatSync(memoryDir);
    const git = lstatSync(join(memoryDir, ".git"));
    if (!root.isDirectory() || root.isSymbolicLink() || !git.isDirectory() || git.isSymbolicLink()) return false;
    const canonicalRoot = realpathSync(memoryDir);
    if (realpathSync(target) !== canonicalRoot) return false;
    if (!hasWorkdir && event.cwd && event.workingDirectory
      && realpathSync(event.cwd) !== realpathSync(event.workingDirectory)) return false;
    if (!hasWorkdir && eventCwd && ctx.cwd && realpathSync(ctx.cwd) !== realpathSync(eventCwd)) return false;
    return true;
  } catch {
    return false;
  }
}

function inspect(event) {
  const toolName = event?.toolName?.split(".").at(-1);
  if (!SHELL_TOOLS.has(toolName)) return;
  const entry = commandEntry(event);
  if (!entry) return;
  const [key, value] = entry;
  const command = commandText(value);
  if (!INLINE_COMMIT.test(command)) return;
  const found = FORBIDDEN.filter((pattern) => command.includes(pattern));
  if (!found.length) return;
  return { key, value, found };
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return sanitizeArray(value);
  if (typeof value === "string") return sanitizeString(value);
}

function transform(event, ctx) {
  const match = inspect(event);
  if (!match) return;
  if (isMemfsCommit(event, ctx)) return;
  const value = sanitizeValue(match.value);
  if (value === undefined || commandText(value) === commandText(match.value)) return;
  return { args: { ...event.args, [match.key]: value } };
}

// Deliberately preserves the hook's lexical scope, not a shell/git parser.
function check(event, { canTransform = false, ctx } = {}) {
  const match = inspect(event);
  if (!match) return;
  if (isMemfsCommit(event, ctx)) return;
  if (canTransform && event.phase === "approval" && transform(event)) return;
  return {
    decision: "deny",
    reason: "Blocked git commit: commit message contains Letta attribution trailers that Mahiro's repos should not include:\n"
      + match.found.map((pattern) => `- ${pattern}`).join("\n")
      + "\nCreate the commit without generated-by or Co-Authored-By Letta lines.",
  };
}

export default function activate(letta) {
  if (letta.signal?.aborted) return;
  if (!letta.capabilities?.permissions || typeof letta.permissions?.register !== "function") {
    letta.diagnostics?.report?.({ severity: "warning", message: "Commit attribution guard inactive: permissions unavailable; retain the legacy hook." });
    return;
  }
  const disposers = [];
  const canTransform = Boolean(letta.capabilities?.events?.tools && typeof letta.events?.on === "function");
  const permissionDispose = letta.permissions.register({
    id: "mahiro-commit-attribution-guard",
    description: canTransform
      ? "Strip exact Letta attribution strings from inline git commits before execution and deny any remainder."
      : "Deny the legacy hook's inline git commit attribution patterns at approval and execution.",
    check: (event, ctx) => check(event, { canTransform, ctx }),
  });
  disposers.push(permissionDispose);
  if (canTransform) {
    try {
      disposers.push(letta.events.on("tool_start", (event, ctx) => transform(event, ctx)));
    } catch (error) {
      if (!letta.signal?.aborted) permissionDispose();
      throw error;
    }
  }
  return () => {
    if (letta.signal?.aborted) return;
    for (const dispose of disposers.reverse()) dispose();
  };
}

export const __testing = { check, transform, isMemfsCommit, sanitizeValue, FORBIDDEN };
