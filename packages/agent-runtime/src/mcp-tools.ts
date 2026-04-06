import { tool } from "@langchain/core/tools";
import type { McpCatalogRecord, McpConnectionRecord } from "@teamaligned/shared";
import { callMcpTool } from "./mcp-runtime.ts";

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

export function buildMcpLangChainTools(input: {
  servers: McpCatalogRecord[];
  connections?: McpConnectionRecord[];
  connectionsById?: Map<string, McpConnectionRecord>;
  workspacePath: string;
  pinnedServerId?: string | null;
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
        async (toolInput) =>
          callMcpTool({
            catalog: server,
            connection,
            workspacePath: input.workspacePath,
            toolName: toolItem.name,
            args: (toolInput as Record<string, unknown>) ?? {},
          }),
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
