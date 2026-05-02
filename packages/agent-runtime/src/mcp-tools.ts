import { tool } from "@langchain/core/tools";
import type { McpCatalogRecord, McpConnectionRecord } from "@teamaligned/shared";
import { nanoid } from "nanoid";
import { callMcpTool } from "./mcp-runtime.ts";
import type { RuntimeLanguage } from "./runtime-language.ts";
import { ToolExecutionApprovalRequiredError, type ToolExecutionPolicy } from "./agent-tools.ts";

function sanitizeToolName(serverSlug: string, toolName: string) {
  const normalized = `${serverSlug}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, "_");
  return normalized.slice(0, 64);
}

export function formatMcpToolList(connection: McpConnectionRecord | null, fallback: string[] = []) {
  const names = connection?.discoveredTools.map((toolItem) => toolItem.name) ?? fallback;
  return names.join("、") || "暂无";
}

export function summarizeAvailableMcps(input: {
  servers: McpCatalogRecord[];
  connections: McpConnectionRecord[];
}) {
  const connectionMap = new Map(input.connections.map((item) => [item.serverId, item]));
  return input.servers
    .map((server) => {
      const connection = connectionMap.get(server.id) ?? null;
      const tools = formatMcpToolList(connection, server.declaredTools);
      return `${server.name}（${tools}）`;
    })
    .join("；");
}

export type McpInvocationEvent =
  | {
      phase: "start";
      invocationId: string;
      startedAt: number;
      server: McpCatalogRecord;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      phase: "success";
      invocationId: string;
      startedAt: number;
      completedAt: number;
      server: McpCatalogRecord;
      toolName: string;
      args: Record<string, unknown>;
      output: string;
    }
  | {
      phase: "error";
      invocationId: string;
      startedAt: number;
      completedAt: number;
      server: McpCatalogRecord;
      toolName: string;
      args: Record<string, unknown>;
      error: string;
    };

export function buildMcpLangChainTools(input: {
  servers: McpCatalogRecord[];
  connections?: McpConnectionRecord[];
  connectionsById?: Map<string, McpConnectionRecord>;
  workspacePath: string;
  pinnedServerId?: string | null;
  onInvocation?: (event: McpInvocationEvent) => void | Promise<void>;
  onConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
  responseLanguage?: RuntimeLanguage;
  approvalPolicy?: ToolExecutionPolicy;
}) {
  const connectionMap =
    input.connectionsById ?? new Map((input.connections ?? []).map((item) => [item.serverId, item]));
  const orderedServers = [...input.servers].sort((left, right) => {
    if (left.id === input.pinnedServerId) return -1;
    if (right.id === input.pinnedServerId) return 1;
    return left.name.localeCompare(right.name, "en");
  });

  return orderedServers.flatMap((server) => {
    const connection = connectionMap.get(server.id);
    if (!connection || connection.status !== "connected" || !connection.enabled) {
      return [];
    }

    return connection.discoveredTools.map((toolItem) =>
      tool(
        async (toolInput) => {
          const args = (toolInput as Record<string, unknown>) ?? {};
          const decision = input.approvalPolicy
            ? await input.approvalPolicy({
                serverId: server.id,
                serverName: server.name,
                toolName: toolItem.name,
                operation: "mcp",
                riskLevel: server.riskLevel,
                args,
                description: `Call MCP tool ${server.name}.${toolItem.name}.`,
              })
            : { allow: true as const };
          if (!decision.allow) {
            throw new ToolExecutionApprovalRequiredError(decision.reason, {
              serverId: server.id,
              serverName: server.name,
              toolName: toolItem.name,
              operation: "mcp",
              riskLevel: server.riskLevel,
              args,
              description: `Call MCP tool ${server.name}.${toolItem.name}.`,
            });
          }
          const invocationId = nanoid();
          const startedAt = Date.now();

          await input.onInvocation?.({
            phase: "start",
            invocationId,
            startedAt,
            server,
            toolName: toolItem.name,
            args,
          });

          try {
            const output = await callMcpTool({
              catalog: server,
              connection,
              workspacePath: input.workspacePath,
              toolName: toolItem.name,
              args,
              responseLanguage: input.responseLanguage,
              onConnectionUpdated: input.onConnectionUpdated,
            });
            await input.onInvocation?.({
              phase: "success",
              invocationId,
              startedAt,
              completedAt: Date.now(),
              server,
              toolName: toolItem.name,
              args,
              output,
            });
            return output;
          } catch (error) {
            await input.onInvocation?.({
              phase: "error",
              invocationId,
              startedAt,
              completedAt: Date.now(),
              server,
              toolName: toolItem.name,
              args,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        {
          name: sanitizeToolName(server.slug, toolItem.name),
          description:
            toolItem.description?.trim() ||
            `${server.name} 提供的 MCP 工具 ${toolItem.name}。优先在需要 ${server.name} 能力时使用。`,
          schema:
            Object.keys(toolItem.inputSchema || {}).length > 0
              ? toolItem.inputSchema
              : {
                  type: "object",
                  properties: {},
                },
        },
      ),
    );
  });
}
