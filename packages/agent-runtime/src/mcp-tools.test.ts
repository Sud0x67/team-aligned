import test from "node:test";
import assert from "node:assert/strict";
import type { McpCatalogRecord, McpConnectionRecord } from "@teamaligned/shared";
import { ToolExecutionApprovalRequiredError } from "./agent-tools.ts";
import { buildMcpLangChainTools } from "./mcp-tools.ts";

function makeCatalog(input?: Partial<McpCatalogRecord>): McpCatalogRecord {
  return {
    id: "mcp-test",
    slug: "test",
    name: "Test MCP",
    description: "Test MCP",
    version: "1.0.0",
    author: "TeamAligned",
    transport: "http",
    sourceRepo: "local",
    sourceBranch: "main",
    sourcePath: "servers/test",
    launcherCommand: null,
    launcherArgs: [],
    remoteUrl: "https://example.com/mcp",
    authType: "none",
    authFields: [],
    capabilities: [],
    declaredTools: [],
    recommendedFor: [],
    riskLevel: "medium",
    docsUrl: null,
    homepage: null,
    metadata: null,
    ...input,
  };
}

function makeConnection(server: McpCatalogRecord): McpConnectionRecord {
  return {
    serverId: server.id,
    enabled: true,
    transport: server.transport,
    command: null,
    args: [],
    url: server.remoteUrl,
    envEntries: {},
    headers: {},
    cwd: null,
    oauth: null,
    discoveredTools: [
      {
        name: "write_note",
        title: "Write note",
        description: "Write a note through MCP.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
        },
        outputSchema: null,
        annotations: null,
      },
    ],
    status: "connected",
    lastCheckedAt: Date.now(),
    lastError: null,
  };
}

test("MCP tools honor approval policy before connecting to the server", async () => {
  const server = makeCatalog();
  const tools = buildMcpLangChainTools({
    servers: [server],
    connections: [makeConnection(server)],
    workspacePath: "/tmp",
    approvalPolicy: () => ({ allow: false, reason: "needs approval", requiresConfirmation: true }),
  });
  const mcpTool = tools.find((tool) => tool.name === "test_write_note");
  assert.ok(mcpTool);

  await assert.rejects(
    () => mcpTool.invoke({ text: "blocked" }),
    ToolExecutionApprovalRequiredError,
  );
});
