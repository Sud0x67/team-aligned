import test from "node:test";
import assert from "node:assert/strict";
import type { McpCatalogRecord, McpConnectionRecord } from "@teamaligned/shared";
import { buildMcpConnection } from "./mcp-registry.ts";
import { checkMcpConnection, normalizeMcpError } from "./mcp-runtime.ts";

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

test("normalizeMcpError returns actionable timeout guidance for stdio MCP", () => {
  const message = normalizeMcpError(
    makeCatalog({ transport: "stdio", launcherCommand: "npx", remoteUrl: null }),
    new Error("连接 MCP 超时（>15s）。"),
  );

  assert.match(message, /独立启动/);
  assert.match(message, /npx/);
});

test("normalizeMcpError returns English remote auth guidance", () => {
  const message = normalizeMcpError(makeCatalog(), new Error("401 Unauthorized"), "en");

  assert.match(message, /unauthorized/i);
  assert.match(message, /headers|token|permissions/i);
});

test("checkMcpConnection reports missing header configuration in selected language", async () => {
  const catalog = makeCatalog({
    authType: "header",
    authFields: [
      {
        key: "Authorization",
        label: "Authorization",
        required: true,
        secret: true,
      },
    ],
  });
  const connection: McpConnectionRecord = {
    ...buildMcpConnection(catalog),
    headers: {
      Authorization: "",
    },
  };

  const checked = await checkMcpConnection({
    catalog,
    connection,
    workspacePath: "/tmp",
    responseLanguage: "en",
  });

  assert.equal(checked.status, "configured");
  assert.match(checked.lastError ?? "", /Missing required request headers/i);
});
