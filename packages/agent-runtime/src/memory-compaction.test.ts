import test from "node:test";
import assert from "node:assert/strict";
import {
  compactMemoryContent,
  defaultMemoryCompactionOptions,
  formatMemoryEntry,
  memoryEntryEndMarker,
  memoryEntryStartMarker,
} from "./memory-compaction.ts";

test("formatMemoryEntry preserves full multiline content without headline truncation", () => {
  const longInput = `${"用户输入".repeat(80)}\n第二行`;
  const longOutput = `${"模型输出".repeat(80)}\n包含 markdown\n\n- item`;

  const entry = formatMemoryEntry({
    timestamp: "2026-05-04T00:00:00.000Z",
    kind: "agent",
    inputLabel: "任务",
    input: longInput,
    outputLabel: "输出",
    output: longOutput,
  });

  assert.match(entry, new RegExp(memoryEntryStartMarker));
  assert.match(entry, new RegExp(memoryEntryEndMarker));
  assert.match(entry, /第二行/);
  assert.match(entry, /包含 markdown/);
  assert.equal(entry.includes(`${longInput.slice(0, 120)}...`), false);
  assert.equal(entry.includes(longInput), true);
  assert.equal(entry.includes(longOutput), true);
});

test("compactMemoryContent summarizes old entries and keeps recent entries raw", async () => {
  const entries = Array.from({ length: 6 }, (_, index) =>
    formatMemoryEntry({
      timestamp: `2026-05-04T00:00:0${index}.000Z`,
      kind: "agent",
      inputLabel: "Task",
      input: `task-${index} ${"x".repeat(80)}`,
      outputLabel: "Output",
      output: `output-${index} ${"y".repeat(80)}`,
    }),
  );
  const content = `# MEMORY\n\n${entries.join("\n\n")}`;
  let summarized = "";

  const result = await compactMemoryContent(content, {
    title: "MEMORY",
    maxChars: 200,
    summaryMaxChars: 500,
    keepRecentEntries: 2,
    now: new Date("2026-05-04T00:00:00.000Z"),
    summarize: async ({ contentToSummarize }) => {
      summarized = contentToSummarize;
      return "Older user preferences and outcomes were summarized.";
    },
  });

  assert.equal(result.compacted, true);
  assert.equal(result.keptEntryCount, 2);
  assert.equal(result.summarizedEntryCount, 4);
  assert.match(summarized, /task-0/);
  assert.match(summarized, /output-3/);
  assert.match(result.content, /Compacted Memory Summary/);
  assert.match(result.content, /task-4/);
  assert.match(result.content, /output-5/);
  assert.equal(result.content.includes("task-0"), false);
});

test("compactMemoryContent leaves small memory files unchanged", async () => {
  const content = `# MEMORY\n\n${formatMemoryEntry({
    timestamp: "2026-05-04T00:00:00.000Z",
    kind: "team",
    inputLabel: "Topic",
    input: "hello",
    outputLabel: "Conclusion",
    output: "world",
  })}`;
  let called = false;

  const result = await compactMemoryContent(content, {
    title: "MEMORY",
    maxChars: defaultMemoryCompactionOptions.maxChars,
    summarize: async () => {
      called = true;
      return "summary";
    },
  });

  assert.equal(result.compacted, false);
  assert.equal(result.content, content);
  assert.equal(called, false);
});
