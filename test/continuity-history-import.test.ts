import assert from "node:assert/strict";
import test from "node:test";
import { projectTranscriptEntry } from "../lib/continuity/history-import.ts";

const policy = {
  excludedProjectIds: ["onedee", "onedeex-frontend"],
  excludedPaths: [],
};
const source = {
  agentId: "main-agent",
  conversationId: "old-conversation",
  projectId: "demo",
  path: "/fixtures/messages.jsonl",
};
const entry = (role: string, content: unknown[]) => ({
  type: "message",
  id: "entry-id",
  timestamp: "2026-10-18T00:00:00.000Z",
  message: { id: "message-id", role, content },
});

test("native history adapter projects only visible text with bound source identity", () => {
  const raw = entry("assistant", [
    { type: "thinking", thinking: "PRIVATE-REASONING" },
    { type: "toolCall", arguments: { text: "PRIVATE-TOOL-ARGUMENT" } },
    { type: "text", text: "Visible explanation" },
  ]);
  const result = projectTranscriptEntry(raw, source, policy);
  assert.equal(result.reason, "accepted-visible-text");
  assert.equal(result.records[0].sourceKind, "letta_message");
  assert.equal(result.records[0].messageId, "message-id");
  assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
  assert.equal(result.records[0].text, "Visible explanation");
  assert.deepEqual(projectTranscriptEntry(raw, source, policy), result);
  assert.notEqual(
    projectTranscriptEntry(
      raw,
      { ...source, conversationId: "another-conversation" },
      policy,
    ).records[0].id,
    result.records[0].id,
  );
});

test("native history adapter excludes tools, automation, failed output and oversized visible text", () => {
  assert.equal(
    projectTranscriptEntry(
      entry("toolResult", [{ type: "text", text: "RAW-TOOL" }]),
      source,
      policy,
    ).records.length,
    0,
  );
  assert.equal(
    projectTranscriptEntry(
      entry("system", [{ type: "text", text: "RAW-SYSTEM" }]),
      source,
      policy,
    ).records.length,
    0,
  );
  assert.equal(
    projectTranscriptEntry(
      entry("user", [
        {
          type: "text",
          text: "<task-notification>automated</task-notification>",
        },
      ]),
      source,
      policy,
    ).records.length,
    0,
  );
  const failed = entry("assistant", [
    { type: "text", text: "Failed partial claim" },
  ]);
  Object.assign(failed.message, { stopReason: "error" });
  assert.equal(
    projectTranscriptEntry(failed, source, policy).reason,
    "failed-assistant",
  );
  assert.equal(
    projectTranscriptEntry(
      entry("user", [{ type: "text", text: "x".repeat(65537) }]),
      source,
      policy,
    ).reason,
    "visible-message-byte-bound",
  );
});

test("native history adapter rejects credentials, retires name-only ban and retains explicit import exclusions", () => {
  const marker = "ghp_" + "Z".repeat(24);
  const secret = projectTranscriptEntry(
    entry("user", [{ type: "text", text: marker }]),
    source,
    policy,
  );
  assert.equal(secret.records.length, 0);
  assert.ok(!JSON.stringify(secret).includes(marker));
  for (const text of ["OneDee", "onedeex-frontend", "ONEDEE"]) {
    const excluded = projectTranscriptEntry(
      entry("user", [{ type: "text", text }]),
      source,
      policy,
    );
    assert.equal(excluded.records.length, 1);
    assert.equal(excluded.excludeConversation, undefined);
    assert.equal(
      projectTranscriptEntry(
        entry("user", [{ type: "text", text }]),
        { ...source, projectId: "onedee" },
        policy,
      ).records.length,
      0,
    );
  }
});

test("accepted human text never retains the stripped automation input", () => {
  const result = projectTranscriptEntry(
    entry("user", [
      {
        type: "text",
        text: "<system-reminder>PRIVATE-WRAPPER</system-reminder>Actual human question",
      },
    ]),
    source,
    policy,
  );
  assert.equal(result.records[0].text, "Actual human question");
  assert.ok(!JSON.stringify(result).includes("PRIVATE-WRAPPER"));
});
