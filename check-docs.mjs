import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const pages = ["README.md", "AGENTS.md", "THIRD_PARTY_NOTICES.md"];
async function collect(directory) {
  for (const entry of await readdir(resolve(root, directory), {
    withFileTypes: true,
  })) {
    assert.ok(
      !entry.isSymbolicLink(),
      `${directory}/${entry.name}: linked documentation`,
    );
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(name);
    else if (name.endsWith(".md")) pages.push(name);
  }
}
await collect("docs");
const texts = new Map(
  await Promise.all(
    pages.map(async (name) => [
      name,
      await readFile(resolve(root, name), "utf8"),
    ]),
  ),
);
function headings(text) {
  const counts = new Map();
  const ids = new Set();
  // Ignore fenced code: sample headings are not rendered document anchors.
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "");
  for (const match of prose.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1]
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
      .replace(/ /g, "-");
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    ids.add(count ? `${base}-${count}` : base);
  }
  return ids;
}
let links = 0;
for (const [name, text] of texts) {
  assert.ok(text.endsWith("\n"), `${name}: missing final newline`);
  assert.ok(!/[\t ]+$/m.test(text), `${name}: trailing whitespace`);
  for (const match of text.matchAll(
    /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const target = match[1];
    if (/^(?:https?:|mailto:)/.test(target)) continue;
    const [path, fragment] = target.split("#");
    const absolute = path
      ? resolve(root, dirname(name), decodeURIComponent(path))
      : resolve(root, name);
    assert.ok(
      absolute.startsWith(root),
      `${name}: link escapes repository: ${target}`,
    );
    const info = await stat(absolute).catch(() => undefined);
    assert.ok(info, `${name}: missing local target: ${target}`);
    if (fragment && absolute.endsWith(".md")) {
      const targetText =
        texts.get(relative(root, absolute)) ??
        (await readFile(absolute, "utf8"));
      assert.ok(
        headings(targetText).has(decodeURIComponent(fragment)),
        `${name}: missing anchor: ${target}`,
      );
    }
    links++;
  }
}
const guides = [
  "claude-ui.md",
  "status.md",
  "rtk.md",
  "agent-memory.md",
  "continuity.md",
  "guards.md",
  "utilities.md",
  "code-map.md",
  "goal.md",
  "evidence.md",
  "ux-workflow.md",
  "execution-run.md",
  "worker-activity.md",
  "finish-voice.md",
  "agents.md",
];
for (const guide of guides) {
  assert.ok(
    texts.get("README.md").includes(`(docs/${guide})`),
    `README missing feature guide ${guide}`,
  );
  assert.ok(
    texts.get("docs/README.md").includes(`(${guide})`),
    `Feature index missing ${guide}`,
  );
}
assert.ok(
  texts.get("README.md").includes(`v${manifest.version}`),
  "README/version drift",
);
assert.ok(
  texts.has(`docs/releases/${manifest.version}.md`),
  "Missing current release notes",
);
const provenance = await readFile(
  resolve(root, "lib/guards/provenance.mjs"),
  "utf8",
);
const versions = [...provenance.matchAll(/pkg\.version === "([^"]+)"/g)].map(
  (match) => match[1],
);
assert.equal(versions.length, 8, "Expected eight exact provenance pins");
assert.ok(
  versions.every((version) => version === manifest.version),
  "Guard/package version drift",
);
for (const name of [
  "docs/goal.md",
  "docs/evidence.md",
  "docs/ux-workflow.md",
  "docs/execution-run.md",
]) {
  assert.ok(
    texts.get(name).includes(manifest.version),
    `${name}: current provenance version missing`,
  );
}
const attributes = await readFile(resolve(root, ".gitattributes"), "utf8");
assert.match(attributes, /^\.agent-state export-ignore$/m);
assert.match(attributes, /^\.pi export-ignore$/m);
console.log(
  `Documentation checks passed: ${pages.length} pages, ${links} local links, ${guides.length} feature guides, version ${manifest.version}. External links and semantic truth require separate review.`,
);
