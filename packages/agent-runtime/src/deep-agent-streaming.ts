import { Command } from "@langchain/langgraph";
import type { HITLRequest } from "langchain";
import type { RuntimeToolInvocationEvent } from "./agent-tools.ts";
import { createDeepAgentToolInvocationEmitter } from "./deep-agent-tool-events.ts";

type StreamEventsRunner = {
  streamEvents: (
    input: unknown,
    options?: Record<string, unknown>,
  ) => Promise<AsyncIterable<Record<string, unknown>>> | AsyncIterable<Record<string, unknown>>;
};

type ToolApprovalInterruptHandler = (
  request: HITLRequest,
) => unknown | Promise<unknown>;

type DeepAgentStreamAdapterInput = {
  runner: StreamEventsRunner;
  initialInput: unknown;
  threadId: string;
  extractHitlRequest: (value: unknown) => HITLRequest | null;
  extractTextDelta: (chunk: unknown) => string;
  extractReasoningDelta: (value: unknown) => string;
  onToolApprovalInterrupt?: ToolApprovalInterruptHandler;
  onToolInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  onReasoningStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  shouldStreamText?: boolean;
  shouldStreamReasoning?: boolean;
  nextEventTimeoutMs?: number;
  nextEventTimeoutMessage?: string;
};

export type DeepAgentStreamAdapterResult = {
  finalOutput: unknown;
  streamedText: string;
  reasoningText: string;
};

async function withOptionalTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  message: string | undefined,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return await promise;

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(message || "DeepAgent stream stalled")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readChatModelChunk(event: Record<string, unknown>) {
  return "data" in event &&
    event.data &&
    typeof event.data === "object" &&
    "chunk" in event.data
    ? (event.data as Record<string, unknown>).chunk
    : null;
}

function readGraphOutput(event: Record<string, unknown>, fallback: unknown) {
  if (event.event !== "on_chain_end" && event.event !== "on_graph_end") {
    return fallback;
  }
  return "data" in event &&
    event.data &&
    typeof event.data === "object" &&
    "output" in event.data
    ? (event.data as Record<string, unknown>).output
    : fallback;
}

export async function runDeepAgentStreamWithInterrupts(
  input: DeepAgentStreamAdapterInput,
): Promise<DeepAgentStreamAdapterResult> {
  const emitToolInvocation = createDeepAgentToolInvocationEmitter(input.onToolInvocation);
  let streamedText = "";
  let reasoningText = "";
  let finalOutput: unknown = null;
  let invocationInput = input.initialInput;

  while (true) {
    finalOutput = null;
    let interruptRequest: HITLRequest | null = null;
    const stream = await input.runner.streamEvents(
      invocationInput,
      { configurable: { thread_id: input.threadId }, version: "v2" },
    );
    const iterator = stream[Symbol.asyncIterator]();

    while (true) {
      const { value: event, done } = await withOptionalTimeout(
        iterator.next(),
        input.nextEventTimeoutMs,
        input.nextEventTimeoutMessage,
      );
      if (done) break;
      if (!event || typeof event !== "object") continue;

      await emitToolInvocation(event);
      interruptRequest = input.extractHitlRequest(event) ?? interruptRequest;

      if (event.event === "on_chat_model_stream") {
        const chunk = readChatModelChunk(event);
        const reasoningDelta =
          input.extractReasoningDelta(chunk) || input.extractReasoningDelta(event);
        if (input.shouldStreamReasoning && input.onReasoningStream && reasoningDelta) {
          reasoningText += reasoningDelta;
          await input.onReasoningStream(reasoningText, reasoningDelta);
        }

        if (!input.shouldStreamText || !input.onTextStream) {
          continue;
        }
        const delta = input.extractTextDelta(chunk);
        if (!delta) continue;
        streamedText += delta;
        await input.onTextStream(streamedText, delta);
        continue;
      }

      finalOutput = readGraphOutput(event, finalOutput);
    }

    interruptRequest = input.extractHitlRequest(finalOutput) ?? interruptRequest;
    if (interruptRequest) {
      if (!input.onToolApprovalInterrupt) {
        throw new Error("Tool approval interrupt was not handled.");
      }
      invocationInput = new Command({
        resume: await input.onToolApprovalInterrupt(interruptRequest),
      });
      continue;
    }

    return { finalOutput, streamedText, reasoningText };
  }
}
