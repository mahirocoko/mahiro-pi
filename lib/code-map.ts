/** Native port of canonical Mods Code Map bounds and formatting; no host I/O. */
const MAX_OUTPUT_CHARS = 3_000;
const MAX_QUERY_CHARS = 500;
const MAX_WORKSPACE_CHARS = 4_096;
const MAX_PATH_CHARS = 4_096;
const MAX_SUMMARY_CHARS = 500;
const MAX_NAVIGATION_ENTRIES = 40;
const MAX_PATH_HINTS = 12;
const MAX_LANGUAGE_HINTS = 8;
const MAX_REFERENCE_ITEMS = 8;
const MAX_REFERENCE_CHARS = 120;

const INTENTS = ["semantic", "exact", "outline"] as const;
const NAVIGATION_SOURCES = ["filename", "exact", "outline", "other"] as const;
type Intent = (typeof INTENTS)[number];
type NavigationSource = (typeof NAVIGATION_SOURCES)[number];

interface NavigationEntry {
  source: NavigationSource;
  path: string;
  lineStart: number | null;
  lineEnd: number | null;
  symbol: string | null;
  summary: string | null;
}

interface LargeReadGuidance {
  requested: boolean;
  reason: string | null;
  maxFiles: number;
  maxCharsPerFile: number;
}

interface CodeMapInput {
  intent: Intent;
  query: string;
  workspace: string | null;
  pathHints: string[];
  languageHints: string[];
  navigationEntries: NavigationEntry[];
  largeRead: LargeReadGuidance;
  goalCriterionRefs: string[];
  codeEvidenceRefs: string[];
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function field(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (value.length > max)
    throw new Error(`${label} exceeds ${max} characters.`);
  if (
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(
      value,
    )
  ) {
    throw new Error(
      `${label} must be single-line metadata without control, line-separator, or bidirectional characters.`,
    );
  }
  return value.trim();
}

function optionalField(
  value: unknown,
  label: string,
  max: number,
): string | null {
  return value == null ? null : field(value, label, max);
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return Number(value);
}

function stringList(
  value: unknown,
  label: string,
  maxItems: number,
  maxChars: number,
): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${label} must contain at most ${maxItems} items.`);
  }
  return value.map((item, index) =>
    field(item, `${label}[${index}]`, maxChars),
  );
}

function assertKnownKeys(
  value: Record<string, any>,
  allowed: string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new Error(
      `${label} contains unsupported fields: ${unknown.join(", ")}.`,
    );
}

function parseNavigationEntries(value: unknown): NavigationEntry[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_NAVIGATION_ENTRIES) {
    throw new Error(
      `navigation_entries must contain at most ${MAX_NAVIGATION_ENTRIES} caller-supplied entries.`,
    );
  }
  return value.map((entry, index) => {
    if (!isRecord(entry))
      throw new Error(`navigation_entries[${index}] must be an object.`);
    assertKnownKeys(
      entry,
      ["source", "path", "line_start", "line_end", "symbol", "summary"],
      `navigation_entries[${index}]`,
    );
    if (!NAVIGATION_SOURCES.includes(entry.source)) {
      throw new Error(
        `navigation_entries[${index}].source must be one of ${NAVIGATION_SOURCES.join(", ")}.`,
      );
    }
    const lineStart =
      entry.line_start == null
        ? null
        : integer(
            entry.line_start,
            `navigation_entries[${index}].line_start`,
            1,
            10_000_000,
          );
    const lineEnd =
      entry.line_end == null
        ? null
        : integer(
            entry.line_end,
            `navigation_entries[${index}].line_end`,
            1,
            10_000_000,
          );
    if (lineEnd !== null && lineStart === null)
      throw new Error(
        `navigation_entries[${index}].line_end requires line_start.`,
      );
    if (lineStart !== null && lineEnd !== null && lineEnd < lineStart) {
      throw new Error(
        `navigation_entries[${index}].line_end must not precede line_start.`,
      );
    }
    return {
      source: entry.source,
      path: field(
        entry.path,
        `navigation_entries[${index}].path`,
        MAX_PATH_CHARS,
      ),
      lineStart,
      lineEnd,
      symbol: optionalField(
        entry.symbol,
        `navigation_entries[${index}].symbol`,
        240,
      ),
      summary: optionalField(
        entry.summary,
        `navigation_entries[${index}].summary`,
        MAX_SUMMARY_CHARS,
      ),
    };
  });
}

function parseLargeRead(value: unknown): LargeReadGuidance {
  if (value == null)
    return {
      requested: false,
      reason: null,
      maxFiles: 2,
      maxCharsPerFile: 6_000,
    };
  if (!isRecord(value))
    throw new Error("large_read must be an object when explicitly requested.");
  assertKnownKeys(
    value,
    ["reason", "max_files", "max_chars_per_file"],
    "large_read",
  );
  return {
    requested: true,
    reason: field(value.reason, "large_read.reason", MAX_SUMMARY_CHARS),
    maxFiles:
      value.max_files == null
        ? 6
        : integer(value.max_files, "large_read.max_files", 3, 12),
    maxCharsPerFile:
      value.max_chars_per_file == null
        ? 12_000
        : integer(
            value.max_chars_per_file,
            "large_read.max_chars_per_file",
            6_000,
            20_000,
          ),
  };
}

function parseInput(value: unknown): CodeMapInput {
  if (!isRecord(value)) throw new Error("Code Map input must be an object.");
  assertKnownKeys(
    value,
    [
      "intent",
      "query",
      "workspace",
      "path_hints",
      "language_hints",
      "navigation_entries",
      "large_read",
      "goal_criterion_refs",
      "code_evidence_refs",
    ],
    "Code Map input",
  );
  if (!INTENTS.includes(value.intent))
    throw new Error(`intent must be one of ${INTENTS.join(", ")}.`);
  return {
    intent: value.intent,
    query: field(value.query, "query", MAX_QUERY_CHARS),
    workspace: optionalField(value.workspace, "workspace", MAX_WORKSPACE_CHARS),
    pathHints: stringList(
      value.path_hints,
      "path_hints",
      MAX_PATH_HINTS,
      MAX_PATH_CHARS,
    ),
    languageHints: stringList(
      value.language_hints,
      "language_hints",
      MAX_LANGUAGE_HINTS,
      80,
    ),
    navigationEntries: parseNavigationEntries(value.navigation_entries),
    largeRead: parseLargeRead(value.large_read),
    goalCriterionRefs: stringList(
      value.goal_criterion_refs,
      "goal_criterion_refs",
      MAX_REFERENCE_ITEMS,
      MAX_REFERENCE_CHARS,
    ),
    codeEvidenceRefs: stringList(
      value.code_evidence_refs,
      "code_evidence_refs",
      MAX_REFERENCE_ITEMS,
      MAX_REFERENCE_CHARS,
    ),
  };
}

function compact(value: string, max: number): string {
  return value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function safeDisplay(value: string, max: number): string {
  return compact(value, max).replaceAll("<", "‹").replaceAll(">", "›");
}

function compactList(values: string[], itemMax: number): string {
  return values.length === 0
    ? "none"
    : values.map((value) => safeDisplay(value, itemMax)).join(", ");
}

function routeFor(intent: Intent): { name: string; action: string } {
  if (intent === "semantic") {
    return {
      name: "bounded source navigation",
      action:
        "No semantic engine is provided. Start with filename/path hints and exact text search, then inspect the smallest likely owner-local sources and verify with targeted reads/checks.",
    };
  }
  if (intent === "exact") {
    return {
      name: "exact search",
      action:
        "Use rg or an appropriate syntax-aware exact search for the named symbol, path, or string; do not build an index merely for exact lookup.",
    };
  }
  return {
    name: "bounded outline guidance",
    action:
      "Use an existing trusted outline/symbol surface outside this mod when available, otherwise inspect the smallest confirmed owner-local sections. This mod does not generate outlines.",
  };
}

function formatNavigationEntry(entry: NavigationEntry): string {
  let location = safeDisplay(entry.path, 150);
  if (entry.lineStart !== null)
    location += `:${entry.lineStart}${entry.lineEnd !== null && entry.lineEnd !== entry.lineStart ? `-${entry.lineEnd}` : ""}`;
  const symbol = entry.symbol ? ` · ${safeDisplay(entry.symbol, 70)}` : "";
  const summary = entry.summary ? ` — ${safeDisplay(entry.summary, 140)}` : "";
  return `- [${entry.source}] ${location}${symbol}${summary}`;
}

function renderGuidance(hostWorkspace: string, input: CodeMapInput): string {
  const route = routeFor(input.intent);
  const workspace = input.workspace ?? hostWorkspace;
  const before = [
    `Mahiro Code Map · ${input.intent}`,
    `Workspace: ${safeDisplay(workspace, 300)} (${input.workspace === null ? "host context" : "caller-supplied metadata"})`,
    `Query: ${safeDisplay(input.query, 300)}`,
    `Route: ${route.name}`,
    route.action,
    `Path hints: ${compactList(input.pathHints, 100)}`,
    `Language hints: ${compactList(input.languageHints, 40)}`,
  ];
  const after = [
    input.largeRead.requested
      ? `Read guidance: explicit large-read request recorded (${input.largeRead.maxFiles} files × ${input.largeRead.maxCharsPerFile} chars/file; reason: ${safeDisplay(input.largeRead.reason ?? "", 180)}). Advisory only—not permission or a security boundary.`
      : `Read guidance: targeted default (${input.largeRead.maxFiles} files × ${input.largeRead.maxCharsPerFile} chars/file). Supply large_read explicitly to request broader bounded guidance.`,
    `Goal criterion refs: ${compactList(input.goalCriterionRefs, 80)} (caller-supplied metadata only)`,
    `Code Evidence refs: ${compactList(input.codeEvidenceRefs, 80)} (caller-supplied metadata only)`,
    "Trust boundary: search/outline entries are navigation metadata, not verification evidence. Verify behavior with current source, tests, browser/native/manual proof as appropriate.",
    "Side effects: none. Code Map does not read or scan source, index repositories, run subprocesses, generate outlines, mutate files/Git/indexes, or read/write Goal or Code Evidence state.",
  ];

  const lines = [...before];
  let included = 0;
  for (const entry of input.navigationEntries) {
    const candidate = formatNavigationEntry(entry);
    const remainingFooter = [
      `Navigation: ${input.navigationEntries.length} caller-supplied; included ${included + 1}; omitted ${input.navigationEntries.length - included - 1}.`,
      ...after,
    ];
    if (
      [...lines, candidate, ...remainingFooter].join("\n").length >
      MAX_OUTPUT_CHARS
    )
      break;
    lines.push(candidate);
    included += 1;
  }
  lines.push(
    `Navigation: ${input.navigationEntries.length} caller-supplied; included ${included}; omitted ${input.navigationEntries.length - included}.`,
  );
  lines.push(...after);
  const output = lines.join("\n");
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const suffix = "\n[bounded output truncated]";
  return `${output.slice(0, MAX_OUTPUT_CHARS - suffix.length)}${suffix}`;
}

const NAVIGATION_ENTRY_SCHEMA = {
  type: "object",
  required: ["source", "path"],
  properties: {
    source: { type: "string", enum: NAVIGATION_SOURCES },
    path: {
      type: "string",
      maxLength: MAX_PATH_CHARS,
      description: "Caller-supplied navigation path; Code Map never reads it.",
    },
    line_start: { type: "integer", minimum: 1, maximum: 10_000_000 },
    line_end: { type: "integer", minimum: 1, maximum: 10_000_000 },
    symbol: { type: "string", maxLength: 240 },
    summary: { type: "string", maxLength: MAX_SUMMARY_CHARS },
  },
  additionalProperties: false,
};

export const codeMapParameters = {
  type: "object",
  required: ["intent", "query"],
  properties: {
    intent: {
      type: "string",
      enum: INTENTS,
      description:
        "semantic → filename/exact search and bounded source reads (no semantic engine); exact → exact search; outline → bounded external outline guidance.",
    },
    query: { type: "string", maxLength: MAX_QUERY_CHARS },
    workspace: {
      type: "string",
      maxLength: MAX_WORKSPACE_CHARS,
      description:
        "Optional caller-supplied target workspace metadata; Code Map never reads or resolves it.",
    },
    path_hints: {
      type: "array",
      maxItems: MAX_PATH_HINTS,
      items: { type: "string", maxLength: MAX_PATH_CHARS },
    },
    language_hints: {
      type: "array",
      maxItems: MAX_LANGUAGE_HINTS,
      items: { type: "string", maxLength: 80 },
    },
    navigation_entries: {
      type: "array",
      maxItems: MAX_NAVIGATION_ENTRIES,
      items: NAVIGATION_ENTRY_SCHEMA,
      description:
        "Caller-supplied search/outline metadata; never verification proof.",
    },
    large_read: {
      type: "object",
      required: ["reason"],
      properties: {
        reason: { type: "string", maxLength: MAX_SUMMARY_CHARS },
        max_files: { type: "integer", minimum: 3, maximum: 12 },
        max_chars_per_file: {
          type: "integer",
          minimum: 6_000,
          maximum: 20_000,
        },
      },
      additionalProperties: false,
      description:
        "Explicit opt-in bounded read guidance; advisory only and never an authorization boundary.",
    },
    goal_criterion_refs: {
      type: "array",
      maxItems: MAX_REFERENCE_ITEMS,
      items: { type: "string", maxLength: MAX_REFERENCE_CHARS },
    },
    code_evidence_refs: {
      type: "array",
      maxItems: MAX_REFERENCE_ITEMS,
      items: { type: "string", maxLength: MAX_REFERENCE_CHARS },
    },
  },
  additionalProperties: false,
};

/** Pure caller-input formatter. No source access, state, inference or authority. */
export function formatCodeMap(hostWorkspace: unknown, input: unknown): string {
  return renderGuidance(
    field(hostWorkspace, "workspace", MAX_WORKSPACE_CHARS),
    parseInput(input),
  );
}
