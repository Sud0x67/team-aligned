import test from "node:test";
import assert from "node:assert/strict";
import type { McpCatalogRecord, McpConnectionRecord } from "@teamaligned/shared";
import { buildMcpConnection } from "./mcp-registry.ts";
import {
  checkMcpConnection,
  getManualOAuthClientSetupMessage,
  normalizeMcpError,
  resolveOAuthClientInformation,
} from "./mcp-runtime.ts";

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

test("buildMcpConnection initializes OAuth MCP as pending authorization", () => {
  const catalog = makeCatalog({ authType: "oauth" });
  const connection = buildMcpConnection(catalog);

  assert.equal(connection.enabled, false);
  assert.equal(connection.status, "configured");
  assert.equal(connection.oauth?.status, "unauthenticated");
  assert.match(connection.lastError ?? "", /OAuth|授权/);
});

test("checkMcpConnection keeps OAuth MCP configured until authorization completes", async () => {
  const catalog = makeCatalog({ authType: "oauth" });
  const connection = buildMcpConnection(catalog);

  const checked = await checkMcpConnection({
    catalog,
    connection,
    workspacePath: "/tmp",
    responseLanguage: "en",
  });

  assert.equal(checked.enabled, false);
  assert.equal(checked.status, "configured");
  assert.equal(checked.oauth?.status, "unauthenticated");
  assert.match(checked.lastError ?? "", /OAuth authorization is required/i);
});

test("normalizeMcpError returns OAuth-specific guidance", () => {
  const message = normalizeMcpError(
    makeCatalog({ authType: "oauth" }),
    new Error("401 Unauthorized"),
    "en",
  );

  assert.match(message, /OAuth authorization/i);
});

test("normalizeMcpError explains manual OAuth client setup when dynamic registration is unsupported", () => {
  const message = normalizeMcpError(
    makeCatalog({ id: "mcp-slack", slug: "slack", name: "Slack", authType: "oauth" }),
    new Error("Incompatible auth server: does not support dynamic client registration"),
    "zh",
  );

  assert.match(message, /Slack/);
  assert.match(message, /Client ID/);
  assert.match(message, /127\.0\.0\.1:37371/);
});

test("resolveOAuthClientInformation reads manual OAuth client fields", () => {
  const catalog = makeCatalog({ slug: "slack", authType: "oauth" });
  const connection = {
    ...buildMcpConnection(catalog),
    envEntries: {
      client_id: "client-123",
      client_secret: "secret-456",
    },
  };

  const clientInformation = resolveOAuthClientInformation(catalog, connection);

  assert.equal(clientInformation?.client_id, "client-123");
  assert.equal(clientInformation?.client_secret, "secret-456");
  assert.equal(
    (clientInformation as Record<string, unknown> | undefined)?.token_endpoint_auth_method,
    "client_secret_post",
  );
});

test("manual OAuth setup message includes server-specific redirect URL", () => {
  const message = getManualOAuthClientSetupMessage(
    makeCatalog({ id: "mcp-custom", name: "Custom MCP", authType: "oauth" }),
    "en",
  );

  assert.match(message, /Custom MCP/);
  assert.match(message, /http:\/\/127\.0\.0\.1:37371\/mcp\/oauth\/callback\/mcp-custom/);
});
