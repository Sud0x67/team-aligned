import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileBackedMemorySaver } from "./persistent-checkpointer.ts";

function createTempRoot() {
  return mkdtempSync(join(tmpdir(), "teamaligned-checkpointer-"));
}

function checkpoint(id: string) {
  return {
    v: 4,
    id,
    ts: new Date(0).toISOString(),
    channel_values: { messages: [`message-${id}`] },
    channel_versions: { messages: 1 },
    versions_seen: {},
  };
}

test("FileBackedMemorySaver persists checkpoints across instances", async () => {
  const root = createTempRoot();
  try {
    const filePath = join(root, "checkpoints", "deep-agent.json");
    const saver = new FileBackedMemorySaver(filePath);
    await saver.put(
      { configurable: { thread_id: "conv-a" } },
      checkpoint("checkpoint-a") as never,
      { source: "input", step: 0, writes: null } as never,
    );

    const reloaded = new FileBackedMemorySaver(filePath);
    const tuple = await reloaded.getTuple({ configurable: { thread_id: "conv-a" } });

    assert.equal(reloaded.hasThread("conv-a"), true);
    assert.equal(tuple?.checkpoint.id, "checkpoint-a");
    assert.deepEqual(tuple?.checkpoint.channel_values, { messages: ["message-checkpoint-a"] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FileBackedMemorySaver clears conversation-prefixed team worker threads", async () => {
  const root = createTempRoot();
  try {
    const filePath = join(root, "checkpoints", "deep-agent.json");
    const saver = new FileBackedMemorySaver(filePath);
    await saver.put(
      { configurable: { thread_id: "conv-a:run-1:agent-coder:execution" } },
      checkpoint("checkpoint-worker") as never,
      { source: "input", step: 0, writes: null } as never,
    );
    await saver.put(
      { configurable: { thread_id: "conv-b" } },
      checkpoint("checkpoint-other") as never,
      { source: "input", step: 0, writes: null } as never,
    );

    await saver.deleteThreadPrefix("conv-a:");
    const reloaded = new FileBackedMemorySaver(filePath);

    assert.equal(reloaded.hasThread("conv-a:run-1:agent-coder:execution"), false);
    assert.equal(reloaded.hasThread("conv-b"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
