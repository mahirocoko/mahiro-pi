import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareMemoryDocuments,
  type ISourceMemoryDocument,
} from "../lib/continuity/memory-import.ts";
import { bytes, digest, normalize } from "../lib/continuity/records.ts";

const policy = { excludedProjectIds: ["onedee"], excludedPaths: [] };
const document = (text: string): ISourceMemoryDocument => ({
  relativePath: "demo/overview.md",
  sourcePath: "/approved/source/demo/overview.md",
  sourceSha256: digest(text),
  projectId: "demo",
  text,
});

test("memory import chunks exact Unicode documents without weakening record bounds", () => {
  const text = "\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\ud83d\udc31\n".repeat(
    12000,
  );
  const source = document(text);
  const result = prepareMemoryDocuments([source], policy);
  assert.ok(result.imports.length > 1);
  assert.equal(result.quarantine.length, 0);
  assert.equal(result.imports.map((entry) => entry.markdown).join(""), text);
  for (const entry of result.imports) {
    assert.ok(bytes(entry.markdown!) <= 32768);
    assert.ok(!entry.markdown!.includes("\ufffd"));
  }
  assert.equal(
    normalize(result.imports, policy).records.length,
    result.imports.length,
  );
  assert.ok(
    result.sources.every(
      (entry) => entry.originalSha256 === source.sourceSha256,
    ),
  );
  assert.equal(result.sources[0].firstLine, 1);
  assert.deepEqual(prepareMemoryDocuments([source], policy), result);
});

test("memory import withholds uncertain lines and never retains private-key body", () => {
  const marker = "ghp_" + "Z".repeat(24);
  const result = prepareMemoryDocuments(
    [document(`before\ncredential = ${marker}\nafter\n`)],
    policy,
  );
  assert.equal(result.imports.length, 1);
  assert.ok(!JSON.stringify(result).includes(marker));
  assert.ok(result.imports[0].markdown!.includes("before\n"));
  assert.ok(result.imports[0].markdown!.includes("after\n"));
  assert.equal(result.sources[0].redactedLines, 1);
  const privateBlock = prepareMemoryDocuments(
    [
      document(
        "-----BEGIN PRIVATE KEY-----\nSYNTHETIC-BODY\n-----END PRIVATE KEY-----\n",
      ),
    ],
    policy,
  );
  assert.equal(privateBlock.imports.length, 0);
  assert.equal(privateBlock.quarantine.length, 1);
  assert.ok(!JSON.stringify(privateBlock).includes("SYNTHETIC-BODY"));
  const multiline = prepareMemoryDocuments(
    [document("before\nBearer\nSYNTHETIC-VALUE\nafter")],
    policy,
  );
  assert.equal(multiline.imports.length, 0);
});

test("memory import validates source hashes, paths, exclusions and opaque metadata", () => {
  const source = document(
    "literal <T> and <system-reminder>documentation</system-reminder>\n",
  );
  assert.equal(
    prepareMemoryDocuments([source], policy).imports[0].markdown,
    source.text,
  );
  assert.throws(
    () =>
      prepareMemoryDocuments(
        [{ ...source, sourceSha256: "0".repeat(64) }],
        policy,
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      prepareMemoryDocuments(
        [{ ...source, relativePath: "../escape.md" }],
        policy,
      ),
    /Invalid/,
  );
  assert.equal(
    prepareMemoryDocuments([{ ...source, projectId: "OneDee" }], policy).imports
      .length,
    0,
  );
  const marker = "ghp_" + "Z".repeat(24);
  const result = prepareMemoryDocuments(
    [{ ...source, sourcePath: `/approved/${marker}.md` }],
    policy,
  );
  assert.equal(result.imports.length, 0);
  assert.ok(!JSON.stringify(result).includes(marker));
});
