import type { RuntimeToolInvocationEvent } from "./agent-tools.ts";

const VISIBLE_DEEP_AGENT_TOOL_NAMES = new Set(["read_file", "write_file", "edit_file"]);
const MAX_DEEP_AGENT_TOOL_OUTPUT = 12_000;

type DeepAgentToolInvocationObserver = (
  event: RuntimeToolInvocationEvent,
) => void | Promise<void>;

type TrackedToolInvocation = {
  invocationId: string;
  startedAt: number;
  toolName: string;
  args: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function trimToolOutput(value: string) {
  const text = value.trim();
  return text.length <= MAX_DEEP_AGENT_TOOL_OUTPUT
    ? text
    : `${text.slice(0, MAX_DEEP_AGENT_TOOL_OUTPUT)}\n...`;
}

function stringifyToolValue(value: unknown): string {
  if (typeof value === "string") {
    return trimToolOutput(value);
  }

  if (value instanceof Error) {
    return trimToolOutput(value.message || value.name);
  }

  if (Array.isArray(value)) {
    return trimToolOutput(
      value
        .map((item) => stringifyToolValue(item))
        .filter(Boolean)
        .join("\n"),
    );
  }

  const record = asRecord(value);
  if (record) {
    const content = record.content;
    if (typeof content === "string" || Array.isArray(content)) {
      return stringifyToolValue(content);
    }
    const text = readString(record, "text");
    if (text) {
      return trimToolOutput(text);
    }
    try {
      return trimToolOutput(JSON.stringify(record));
    } catch {
      return "";
    }
  }

  return value == null ? "" : trimToolOutput(String(value));
}

function readEventData(event: Record<string, unknown>) {
  return asRecord(event.data) ?? {};
}

function readEventInput(event: Record<string, unknown>) {
  const data = readEventData(event);
  return asRecord(data.input) ?? asRecord(data.inputs) ?? {};
}

function sanitizeToolArgs(toolName: string, rawArgs: Record<string, unknown>) {
  const filePath = rawArgs.file_path ?? rawArgs.path;
  if (toolName === "read_file") {
    return {
      ...(typeof filePath === "string" ? { file_path: filePath } : {}),
      ...(typeof rawArgs.offset === "number" ? { offset: rawArgs.offset } : {}),
      ...(typeof rawArgs.limit === "number" ? { limit: rawArgs.limit } : {}),
    };
  }

  return typeof filePath === "string" ? { file_path: filePath } : {};
}

function createInvocationId(toolName: string, runId: string | null) {
  const suffix = runId ?? Math.random().toString(36).slice(2, 10);
  return `deep_agent_${toolName}_${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function readToolOutput(event: Record<string, unknown>) {
  const data = readEventData(event);
  if ("output" in data) {
    return stringifyToolValue(data.output);
  }
  if ("result" in data) {
    return stringifyToolValue(data.result);
  }
  return "";
}

function readToolError(event: Record<string, unknown>) {
  const data = readEventData(event);
  if ("error" in data) {
    return stringifyToolValue(data.error) || "Tool call failed.";
  }
  return "Tool call failed.";
}

export function createDeepAgentToolInvocationEmitter(
  onInvocation?: DeepAgentToolInvocationObserver,
) {
  const activeInvocations = new Map<string, TrackedToolInvocation>();

  return async (rawEvent: Record<string, unknown>) => {
    if (!onInvocation) return;

    const eventName = readString(rawEvent, "event");
    if (
      eventName !== "on_tool_start" &&
      eventName !== "on_tool_end" &&
      eventName !== "on_tool_error"
    ) {
      return;
    }

    const toolName = readString(rawEvent, "name");
    if (!toolName || !VISIBLE_DEEP_AGENT_TOOL_NAMES.has(toolName)) {
      return;
    }

    const runId = readString(rawEvent, "run_id") ?? readString(rawEvent, "runId");
    const args = sanitizeToolArgs(toolName, readEventInput(rawEvent));
    const key = runId ?? `${toolName}:${JSON.stringify(args)}`;

    if (eventName === "on_tool_start") {
      const startedAt = Date.now();
      const tracked = {
        invocationId: createInvocationId(toolName, runId),
        startedAt,
        toolName,
        args,
      };
      activeInvocations.set(key, tracked);
      await onInvocation({
        phase: "start",
        invocationId: tracked.invocationId,
        startedAt,
        serverId: "deep-agent-filesystem",
        serverName: "DeepAgent Filesystem",
        toolName,
        args,
      });
      return;
    }

    let tracked = activeInvocations.get(key);
    if (!tracked) {
      tracked = {
        invocationId: createInvocationId(toolName, runId),
        startedAt: Date.now(),
        toolName,
        args,
      };
      activeInvocations.set(key, tracked);
      await onInvocation({
        phase: "start",
        invocationId: tracked.invocationId,
        startedAt: tracked.startedAt,
        serverId: "deep-agent-filesystem",
        serverName: "DeepAgent Filesystem",
        toolName,
        args,
      });
    }

    activeInvocations.delete(key);

    if (eventName === "on_tool_error") {
      await onInvocation({
        phase: "error",
        invocationId: tracked.invocationId,
        startedAt: tracked.startedAt,
        completedAt: Date.now(),
        serverId: "deep-agent-filesystem",
        serverName: "DeepAgent Filesystem",
        toolName: tracked.toolName,
        args: tracked.args,
        error: readToolError(rawEvent),
      });
      return;
    }

    await onInvocation({
      phase: "success",
      invocationId: tracked.invocationId,
      startedAt: tracked.startedAt,
      completedAt: Date.now(),
      serverId: "deep-agent-filesystem",
      serverName: "DeepAgent Filesystem",
      toolName: tracked.toolName,
      args: tracked.args,
      output: readToolOutput(rawEvent),
    });
  };
}
