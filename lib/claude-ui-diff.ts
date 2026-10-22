import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Geometry } from "./claude-ui.ts";

// Clean implementation over captured native result data only. No file paths,
// calls, execution owners or upstream helper source enter this module.
export const DIFF_LIMITS = {
  chars: 131072,
  lines: 2000,
  line: 8192,
  cells: 131072,
};
type Span = { text: string; changed: boolean };
export type DiffCell = { number: number; text: string; spans?: Span[] };
export type DiffRow = {
  old?: DiffCell;
  next?: DiffCell;
  context?: boolean;
  note?: string;
};
export type DiffModel = {
  rows: DiffRow[];
  added: number;
  removed: number;
  highlightsLimited: boolean;
};
const words = new Intl.Segmenter(undefined, { granularity: "word" });

/** Convert one complete unified file patch, or decline the ENTIRE capture.
 * Hunk counts own body boundaries: header-like content is still content while
 * counts remain. Multi-file/unsupported metadata is deliberately plain-only. */
export function unifiedToNative(text: string): string | undefined {
  if (!text || text.length > DIFF_LIMITS.chars) return undefined;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > DIFF_LIMITS.lines) return undefined;
  const trailing = lines.at(-1) === "";
  if (trailing) lines.pop();
  const output: string[] = [];
  let old = 0,
    next = 0,
    oldLeft = 0,
    nextLeft = 0;
  let hunks = 0,
    headers = 0,
    body = false;
  let oldEnd = 0,
    nextEnd = 0;
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/.exec(line);
    if (hunk) {
      if (oldLeft || nextLeft || headers === 1) return undefined;
      const values = [hunk[1], hunk[2] ?? "1", hunk[3], hunk[4] ?? "1"].map(
        Number,
      );
      const [o, oc, n, nc] = values as [number, number, number, number];
      if (
        values.some((v) => !Number.isSafeInteger(v) || v < 0) ||
        (oc > 0 && o === 0) ||
        (nc > 0 && n === 0) ||
        !Number.isSafeInteger(o + oc) ||
        !Number.isSafeInteger(n + nc) ||
        (hunks > 0 && (o < oldEnd || n < nextEnd))
      )
        return undefined;
      old = o;
      next = n;
      oldLeft = oc;
      nextLeft = nc;
      oldEnd = o + oc;
      nextEnd = n + nc;
      hunks++;
      body = false;
      output.push(line);
    } else if (line === "\\ No newline at end of file") {
      if (!body) return undefined;
      body = false;
      output.push(line);
    } else if (oldLeft || nextLeft) {
      const prefix = line[0];
      if (prefix === "-" && oldLeft > 0) {
        output.push(`-${old++} ${line.slice(1)}`);
        oldLeft--;
      } else if (prefix === "+" && nextLeft > 0) {
        output.push(`+${next++} ${line.slice(1)}`);
        nextLeft--;
      } else if (prefix === " " && oldLeft > 0 && nextLeft > 0) {
        output.push(` ${old++} ${line.slice(1)}`);
        next++;
        oldLeft--;
        nextLeft--;
      } else return undefined;
      body = true;
    } else if (hunks === 0) {
      if (headers === 0 && /^(?:diff --git |index )/.test(line)) {
        output.push(line);
      } else if (headers === 0 && line.startsWith("--- ")) {
        headers = 1;
        output.push(line);
      } else if (headers === 1 && line.startsWith("+++ ")) {
        headers = 2;
        output.push(line);
      } else return undefined;
    } else return undefined;
  }
  if (!hunks || oldLeft || nextLeft) return undefined;
  return output.join("\n") + (trailing ? "\n" : "");
}

// Bounded token LCS, shared work budget across the entire captured diff. Word
// segmentation preserves Thai words, combining marks and emoji graphemes.
function highlight(
  old: DiffCell,
  next: DiffCell,
  budget: { left: number },
): boolean {
  if (old.text.length > DIFF_LIMITS.line || next.text.length > DIFF_LIMITS.line)
    return false;
  const a = Array.from(words.segment(old.text), (s) => s.segment);
  const b = Array.from(words.segment(next.text), (s) => s.segment);
  const work = (a.length + 1) * (b.length + 1);
  if (work > budget.left || a.length > 256 || b.length > 256) return false;
  budget.left -= work;
  const cols = b.length + 1;
  const table = new Uint16Array(work);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] =
        a[i] === b[j]
          ? 1 + table[(i + 1) * cols + j + 1]!
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
  const left: Span[] = [],
    right: Span[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      left.push({ text: a[i++]!, changed: false });
      right.push({ text: b[j++]!, changed: false });
    } else if (
      i < a.length &&
      (j === b.length || table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!)
    ) {
      left.push({ text: a[i++]!, changed: true });
    } else right.push({ text: b[j++]!, changed: true });
  }
  old.spans = left;
  next.spans = right;
  return true;
}

/** Parse numbered native display diff. Unknown syntax returns a full fallback,
 * never a guessed before-image. Context numbers in native diffs are old-side. */
export function prepareDiff(text: string): DiffModel | undefined {
  if (!text || text.length > DIFF_LIMITS.chars) return undefined;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > DIFF_LIMITS.lines) return undefined;
  if (lines.at(-1) === "") lines.pop();
  const model: DiffModel = {
    rows: [],
    added: 0,
    removed: 0,
    highlightsLimited: false,
  };
  let delta = 0;
  const budget = { left: DIFF_LIMITS.cells };
  let removed: DiffCell[] = [],
    added: DiffCell[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      const old = removed[i],
        next = added[i];
      if (old && next && !highlight(old, next, budget))
        model.highlightsLimited = true;
      model.rows.push({ old, next });
    }
    removed = [];
    added = [];
  };
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@.*$/.exec(line);
    if (hunk) {
      flush();
      delta = Number(hunk[2]) - Number(hunk[1]);
      model.rows.push({ note: line });
      continue;
    }
    if (
      /^(?:--- |\+\+\+ |diff --git |index |\\ No newline at end of file)/.test(
        line,
      ) ||
      /^\s+\.\.\.$/.test(line)
    ) {
      flush();
      model.rows.push({ note: line });
      continue;
    }
    const match = /^([ +\-])\s*(\d+) (.*)$/.exec(line);
    if (!match) return undefined;
    const n = Number(match[2]);
    if (!Number.isSafeInteger(n) || n < 0) return undefined;
    const cell = { number: n, text: match[3]! };
    if (match[1] === "-") {
      if (added.length) flush();
      removed.push(cell);
      model.removed++;
      delta--;
    } else if (match[1] === "+") {
      added.push(cell);
      model.added++;
      delta++;
    } else {
      flush();
      const nextNumber = n + delta;
      if (!Number.isSafeInteger(nextNumber) || nextNumber < 0) return undefined;
      model.rows.push({
        old: cell,
        next: { ...cell, number: nextNumber },
        context: true,
      });
    }
  }
  flush();
  return model.rows.length ? model : undefined;
}

/** Render all captured rows. Caller owns collapse/expansion, never this module. */
export function renderPreparedDiff(
  model: DiffModel,
  width: number,
  theme: Theme,
  g: Geometry,
  split = true,
): string[] {
  if (width <= 0) return [];
  const fit = (s: string, size: number) => {
    const cut = g.truncateToWidth(s, size, "");
    return cut + " ".repeat(Math.max(0, size - g.visibleWidth(cut)));
  };
  const digits = Math.max(
    1,
    ...model.rows
      .flatMap((r) => [r.old?.number ?? 0, r.next?.number ?? 0])
      .map((n) => String(n).length),
  );
  const leftWidth = Math.floor((width - 3) / 2),
    rightWidth = width - 3 - leftWidth;
  const widthGate = width >= Math.max(72, 2 * (digits + 14) + 3);
  // Same prefix the cells draw. Display columns, not UTF-16 length, so CJK
  // and emoji can force unified while the terminal is still wide enough.
  const samplePrefix =
    leftWidth > digits + 4 ? `${"0".padStart(digits)} − ` : "";
  const contentWidth = Math.max(1, leftWidth - g.visibleWidth(samplePrefix));
  let pressure = false;
  if (split && widthGate) {
    let seen = 0;
    for (const row of model.rows) {
      if (pressure || seen >= 256) break;
      for (const cell of row.context ? [row.old] : [row.old, row.next]) {
        if (!cell || pressure || seen >= 256) continue;
        seen++;
        if (g.visibleWidth(cell.text) > contentWidth) pressure = true;
      }
    }
  }
  const wide = split && widthGate && !pressure;
  const cell = (
    value: DiffCell | undefined,
    size: number,
    side: "old" | "new",
    context = false,
  ): string[] => {
    if (!value) return [theme.fg("dim", " ".repeat(size))];
    const token = context
      ? "toolDiffContext"
      : side === "old"
        ? "toolDiffRemoved"
        : "toolDiffAdded";
    const bg = context
      ? undefined
      : side === "old"
        ? "toolErrorBg"
        : "toolSuccessBg";
    const prefix =
      size > digits + 4
        ? `${String(value.number).padStart(digits)} ${context ? " " : side === "old" ? "−" : "+"} `
        : "";
    const contentWidth = Math.max(1, size - g.visibleWidth(prefix));
    const text =
      value.spans
        ?.map((s) =>
          s.changed ? theme.style(s.text, { inverse: true }) : s.text,
        )
        .join("") ?? value.text;
    return g
      .wrapTextWithAnsi(theme.fg(token, text), contentWidth)
      .map((row, i) =>
        theme.style(
          fit((i === 0 ? prefix : " ".repeat(prefix.length)) + row, size),
          { fg: token, bg },
        ),
      );
  };
  const output = [
    theme.fg(
      "muted",
      `+${model.added} −${model.removed} · stored edit diff${model.highlightsLimited ? " · word highlights limited" : ""}`,
    ),
  ];
  if (wide)
    output.push(
      theme.fg("toolDiffRemoved", fit("old", leftWidth)) +
        theme.fg("borderMuted", " │ ") +
        theme.fg("toolDiffAdded", fit("new", rightWidth)),
    );
  else output.push(theme.fg("muted", "old / new · unified"));
  for (const row of model.rows) {
    if (row.note !== undefined) {
      output.push(...g.wrapTextWithAnsi(theme.fg("dim", row.note), width));
    } else if (wide) {
      const a = cell(row.old, leftWidth, "old", row.context),
        b = cell(row.next, rightWidth, "new", row.context);
      for (let i = 0; i < Math.max(a.length, b.length); i++)
        output.push(
          (a[i] ?? " ".repeat(leftWidth)) +
            theme.fg("borderMuted", " │ ") +
            (b[i] ?? " ".repeat(rightWidth)),
        );
    } else if (row.context) {
      // Context has two independently captured/derived numbers, not a reused
      // new-side number on the old side. Show both even after insertions.
      const numbers = `${row.old!.number}/${row.next!.number} `;
      const prefix = g.visibleWidth(numbers) < width - 1 ? numbers : "";
      const lines = g.wrapTextWithAnsi(
        theme.fg("toolDiffContext", row.old!.text),
        Math.max(1, width - prefix.length),
      );
      output.push(
        ...lines.map(
          (line, i) => (i === 0 ? prefix : " ".repeat(prefix.length)) + line,
        ),
      );
    } else {
      if (row.old) output.push(...cell(row.old, width, "old"));
      if (row.next) output.push(...cell(row.next, width, "new"));
    }
  }
  return output.flatMap((line) => g.wrapTextWithAnsi(line, width));
}
