import { tool } from "@langchain/core/tools";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import type {
  McpCatalogRecord,
  McpConnectionRecord,
  McpToolRecord,
} from "@teamaligned/shared";
import { resolveWorkspaceAwareArgs } from "./mcp-registry.ts";

const MCP_CONNECT_TIMEOUT_MS = 15_000;
const MCP_TOOL_TIMEOUT_MS = 30_000;

function compact(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function normalizeMcpError(catalog: McpCatalogRecord, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/unauthorized|401/i.test(message)) {
    if (catalog.slug === "figma") {
      return "Figma 远端 MCP 返回未授权。请确认当前客户端是否在 Figma 允许接入的客户端列表中，或改用本地桌面版 MCP。";
    }

    return "远端 MCP 返回未授权。请检查请求头、Token 或服务端接入权限。";
  }

  if (/forbidden|403/i.test(message)) {
    return "远端 MCP 拒绝了当前请求。请检查鉴权信息或服务端的客户端接入限制。";
  }

  if (/timeout|aborted|abort/i.test(message)) {
    return "远端 MCP 连接超时。请检查 URL 是否可访问，或稍后重试。";
  }

  return message;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function getRequiredConfigError(catalog: McpCatalogRecord, connection: McpConnectionRecord) {
  if (catalog.authType === "env") {
    const missing = catalog.authFields.filter((field) => field.required && !connection.envEntries[field.key]?.trim());
    if (missing.length > 0) {
      return `缺少必填环境变量：${missing.map((field) => field.key).join("、")}`;
    }
  }

  if (catalog.authType === "header") {
    const missing = catalog.authFields.filter((field) => field.required && !connection.headers[field.key]?.trim());
    if (missing.length > 0) {
      return `缺少必填请求头：${missing.map((field) => field.key).join("、")}`;
    }
  }

  if (catalog.transport === "stdio" && !connection.command?.trim()) {
    return "缺少本地启动命令。";
  }

  if (catalog.transport === "http" && !connection.url?.trim()) {
    return "缺少远端 MCP URL。";
  }

  if (catalog.transport === "http" && connection.url && !/^https?:\/\//i.test(connection.url)) {
    return "远端 MCP URL 必须以 http:// 或 https:// 开头。";
  }

  return null;
}

function mapTools(tools: Array<Record<string, unknown>>): McpToolRecord[] {
  return tools.map((item) => ({
    name: String(item.name ?? "unknown_tool"),
    title: typeof item.title === "string" ? item.title : null,
    description: typeof item.description === "string" ? item.description : "",
    inputSchema:
      item.inputSchema && typeof item.inputSchema === "object"
        ? (item.inputSchema as Record<string, unknown>)
        : { type: "object", properties: {} },
    outputSchema:
      item.outputSchema && typeof item.outputSchema === "object"
        ? (item.outputSchema as Record<string, unknown>)
        : null,
    annotations:
      item.annotations && typeof item.annotations === "object"
        ? (item.annotations as Record<string, unknown>)
        : null,
  }));
}

async function withMcpClient<T>(
  input: {
    catalog: McpCatalogRecord;
    connection: McpConnectionRecord;
    workspacePath: string;
  },
  execute: (client: Client, transport: StdioClientTransport | StreamableHTTPClientTransport) => Promise<T>,
) {
  const client = new Client({
    name: "teamaligned",
    version: "0.1.0",
  });

  if (input.catalog.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: input.connection.command!,
      args: resolveWorkspaceAwareArgs(input.connection.args, input.workspacePath),
      env: Object.fromEntries(
        Object.entries({
          ...process.env,
          ...input.connection.envEntries,
        }).filter(([, value]) => typeof value === "string"),
      ) as Record<string, string>,
      cwd: input.connection.cwd || input.workspacePath,
      stderr: "pipe",
    });
    try {
      await withTimeout(
        client.connect(transport),
        MCP_CONNECT_TIMEOUT_MS,
        `连接 MCP 超时（>${Math.round(MCP_CONNECT_TIMEOUT_MS / 1000)}s）。`,
      );
      return await withTimeout(
        execute(client, transport),
        MCP_TOOL_TIMEOUT_MS,
        `MCP 操作超时（>${Math.round(MCP_TOOL_TIMEOUT_MS / 1000)}s）。`,
      );
    } finally {
      await transport.close().catch(() => undefined);
    }
  }

  const transport = new StreamableHTTPClientTransport(new URL(input.connection.url!), {
    requestInit: {
      signal: AbortSignal.timeout(MCP_CONNECT_TIMEOUT_MS),
      headers: Object.fromEntries(
        Object.entries(input.connection.headers).filter(([, value]) => value.trim().length > 0),
      ),
    },
  });
  try {
    await withTimeout(
      client.connect(transport),
      MCP_CONNECT_TIMEOUT_MS,
      `连接远端 MCP 超时（>${Math.round(MCP_CONNECT_TIMEOUT_MS / 1000)}s）。`,
    );
    return await withTimeout(
      execute(client, transport),
      MCP_TOOL_TIMEOUT_MS,
      `远端 MCP 操作超时（>${Math.round(MCP_TOOL_TIMEOUT_MS / 1000)}s）。`,
    );
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export async function checkMcpConnection(input: {
  catalog: McpCatalogRecord;
  connection: McpConnectionRecord;
  workspacePath: string;
}) {
  const requiredConfigError = getRequiredConfigError(input.catalog, input.connection);
  if (requiredConfigError) {
    return {
      ...input.connection,
      enabled: false,
      status: "configured" as const,
      lastCheckedAt: Date.now(),
      lastError: requiredConfigError,
    };
  }

  try {
    const discoveredTools = await withMcpClient(input, async (client) => {
      const result = await client.listTools();
      return mapTools(result.tools as Array<Record<string, unknown>>);
    });

    return {
      ...input.connection,
      enabled: true,
      status: "connected" as const,
      discoveredTools,
      lastCheckedAt: Date.now(),
      lastError: null,
    };
  } catch (error) {
    return {
      ...input.connection,
      enabled: false,
      status: "error" as const,
      lastCheckedAt: Date.now(),
      lastError: normalizeMcpError(input.catalog, error),
    };
  }
}

function serializeCallToolResult(result: Record<string, unknown>) {
  const content = Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : [];
  const structuredContent =
    result.structuredContent && typeof result.structuredContent === "object"
      ? (result.structuredContent as Record<string, unknown>)
      : null;
  const textParts = content
    .map((item) => {
      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
      if (item.type === "resource" && item.resource && typeof item.resource === "object") {
        if ("text" in item.resource && typeof item.resource.text === "string") {
          return item.resource.text;
        }
        if ("uri" in item.resource) {
          return `resource: ${String(item.resource.uri)}`;
        }
      }
      if (item.type === "resource_link" && typeof item.uri === "string") {
        return `resource_link: ${item.uri}`;
      }
      return "";
    })
    .filter(Boolean);

  if (textParts.length > 0) {
    return textParts.join("\n\n").trim();
  }

  if (structuredContent && Object.keys(structuredContent).length > 0) {
    return JSON.stringify(structuredContent, null, 2);
  }

  return "MCP 已成功执行，但没有返回可显示的文本内容。";
}

export async function callMcpTool(input: {
  catalog: McpCatalogRecord;
  connection: McpConnectionRecord;
  workspacePath: string;
  toolName: string;
  args: Record<string, unknown>;
}) {
  return withMcpClient(input, async (client) => {
    const result = await client.callTool({
      name: input.toolName,
      arguments: input.args,
    });

    return serializeCallToolResult(result);
  });
}

function sanitizeToolName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function createDiscoveredMcpTools(input: {
  catalogs: McpCatalogRecord[];
  connections: McpConnectionRecord[];
  workspacePath: string;
}) {
  const tools = [];
  const summaries: string[] = [];

  for (const connection of input.connections) {
    const catalog = input.catalogs.find((item) => item.id === connection.serverId);
    if (!catalog || connection.status !== "connected" || !connection.enabled) {
      continue;
    }

    for (const discoveredTool of connection.discoveredTools) {
      const name = sanitizeToolName(`${catalog.slug}_${discoveredTool.name}`);
      tools.push(
        tool(
          async (toolInput) => {
            return callMcpTool({
              catalog,
              connection,
              workspacePath: input.workspacePath,
              toolName: discoveredTool.name,
              args: ((toolInput ?? {}) as Record<string, unknown>),
            });
          },
          {
            name,
            description: compact(
              [
                `MCP server: ${catalog.name}.`,
                `Original tool: ${discoveredTool.name}.`,
                discoveredTool.description || "",
              ]
                .filter(Boolean)
                .join(" "),
            ),
            schema:
              discoveredTool.inputSchema && Object.keys(discoveredTool.inputSchema).length > 0
                ? discoveredTool.inputSchema
                : {
                    type: "object",
                    properties: {},
                  },
          },
        ),
      );
      summaries.push(`${catalog.name}.${discoveredTool.name}`);
    }
  }

  return {
    tools,
    summary: summaries.join("、"),
  };
}
