import test from "node:test";
import assert from "node:assert/strict";
import { createDeepAgentToolInvocationEmitter } from "./deep-agent-tool-events.ts";
import type { RuntimeToolInvocationEvent } from "./agent-tools.ts";

test("maps DeepAgent write_file stream events to visible tool invocations", async () => {
  const events: RuntimeToolInvocationEvent[] = [];
  const emit = createDeepAgentToolInvocationEmitter((event) => {
    events.push(event);
  });

  await emit({
    event: "on_tool_start",
    name: "write_file",
    run_id: "write-run-1",
    data: {
      input: {
        file_path: "/notes/hello.md",
        content: "full file content should not be persisted in invocation args",
      },
    },
  });
  await emit({
    event: "on_tool_end",
    name: "write_file",
    run_id: "write-run-1",
    data: {
      output: {
        content: "Successfully wrote to '/notes/hello.md'",
      },
    },
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].phase, "start");
  assert.equal(events[0].toolName, "write_file");
  assert.deepEqual(events[0].args, { file_path: "/notes/hello.md" });
  assert.equal(events[1].phase, "success");
  assert.match(events[1].phase === "success" ? events[1].output : "", /Successfully wrote/);
});

test("maps DeepAgent read_file errors and ignores non-filesystem tools", async () => {
  const events: RuntimeToolInvocationEvent[] = [];
  const emit = createDeepAgentToolInvocationEmitter((event) => {
    events.push(event);
  });

  await emit({
    event: "on_tool_start",
    name: "write_todos",
    run_id: "todo-run",
    data: { input: { todos: [] } },
  });
  await emit({
    event: "on_tool_error",
    name: "read_file",
    run_id: "read-run-1",
    data: {
      input: {
        file_path: "/missing.md",
        limit: 100,
      },
      error: new Error("file missing"),
    },
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].phase, "start");
  assert.equal(events[0].toolName, "read_file");
  assert.deepEqual(events[0].args, { file_path: "/missing.md", limit: 100 });
  assert.equal(events[1].phase, "error");
  assert.match(events[1].phase === "error" ? events[1].error : "", /file missing/);
});
