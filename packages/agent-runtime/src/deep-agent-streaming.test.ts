import test from "node:test";
import assert from "node:assert/strict";
import { Command } from "@langchain/langgraph";
import { runDeepAgentStreamWithInterrupts } from "./deep-agent-streaming.ts";
import type { RuntimeToolInvocationEvent } from "./agent-tools.ts";

async function* streamEvents(events: Record<string, unknown>[]) {
  for (const event of events) {
    yield event;
  }
}

test("DeepAgent stream adapter forwards text, reasoning, tool events, and final output", async () => {
  const toolEvents: RuntimeToolInvocationEvent[] = [];
  const textUpdates: string[] = [];
  const reasoningUpdates: string[] = [];

  const result = await runDeepAgentStreamWithInterrupts({
    runner: {
      streamEvents: () =>
        streamEvents([
          {
            event: "on_tool_start",
            name: "write_file",
            run_id: "tool-1",
            data: { input: { file_path: "/notes.md", content: "secret body" } },
          },
          {
            event: "on_chat_model_stream",
            data: {
              chunk: {
                reasoning_content: "thinking",
                content: "hello",
              },
            },
          },
          {
            event: "on_chat_model_stream",
            data: { chunk: { content: " world" } },
          },
          {
            event: "on_graph_end",
            data: { output: { messages: [{ content: "final answer" }] } },
          },
        ]),
    },
    initialInput: { messages: [{ role: "user", content: "hi" }] },
    threadId: "conv-stream-test",
    extractHitlRequest: () => null,
    extractTextDelta: (chunk) =>
      chunk && typeof chunk === "object" && "content" in chunk
        ? String((chunk as { content: unknown }).content)
        : "",
    extractReasoningDelta: (value) =>
      value && typeof value === "object" && "reasoning_content" in value
        ? String((value as { reasoning_content: unknown }).reasoning_content)
        : "",
    onToolInvocation: (event) => {
      toolEvents.push(event);
    },
    onTextStream: (aggregated) => {
      textUpdates.push(aggregated);
    },
    onReasoningStream: (aggregated) => {
      reasoningUpdates.push(aggregated);
    },
    shouldStreamText: true,
    shouldStreamReasoning: true,
  });

  assert.equal(result.streamedText, "hello world");
  assert.equal(result.reasoningText, "thinking");
  assert.deepEqual(textUpdates, ["hello", "hello world"]);
  assert.deepEqual(reasoningUpdates, ["thinking"]);
  assert.deepEqual(result.finalOutput, { messages: [{ content: "final answer" }] });
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0]?.toolName, "write_file");
  assert.deepEqual(toolEvents[0]?.args, { file_path: "/notes.md" });
});

test("DeepAgent stream adapter resumes after a human-in-the-loop decision", async () => {
  const requests = [{ actionRequests: [{ name: "workspace_run_command", args: { command: "npm test" } }] }];
  const invocationInputs: unknown[] = [];

  const result = await runDeepAgentStreamWithInterrupts({
    runner: {
      streamEvents: (input) => {
        invocationInputs.push(input);
        return streamEvents(
          invocationInputs.length === 1
            ? [
                {
                  event: "on_graph_end",
                  data: { output: { __interrupt__: requests } },
                },
              ]
            : [
                {
                  event: "on_graph_end",
                  data: { output: { messages: [{ content: "continued after denial" }] } },
                },
              ],
        );
      },
    },
    initialInput: { messages: [{ role: "user", content: "run command" }] },
    threadId: "conv-hitl-test",
    extractHitlRequest: (value) => {
      if (value && typeof value === "object" && "__interrupt__" in value) {
        return requests[0] as never;
      }
      return null;
    },
    extractTextDelta: () => "",
    extractReasoningDelta: () => "",
    onToolApprovalInterrupt: () => ({
      decisions: [
        {
          type: "reject",
          message: "User denied this command. Do not request the same command again.",
        },
      ],
    }),
  });

  assert.equal(invocationInputs.length, 2);
  assert.ok(invocationInputs[1] instanceof Command);
  assert.deepEqual(result.finalOutput, { messages: [{ content: "continued after denial" }] });
});
