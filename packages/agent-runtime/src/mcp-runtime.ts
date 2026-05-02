import { createServer, type Server } from "node:http";
import { tool } from "@langchain/core/tools";
import {
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth";
import type {
  McpCatalogRecord,
  McpConnectionRecord,
  McpOAuthStateRecord,
  McpToolRecord,
} from "@teamaligned/shared";
import { resolveWorkspaceAwareArgs } from "./mcp-registry.ts";
import { byLanguage, type RuntimeLanguage } from "./runtime-language.ts";

const MCP_CONNECT_TIMEOUT_MS = 15_000;
const MCP_TOOL_TIMEOUT_MS = 30_000;
const MCP_OAUTH_TIMEOUT_MS = 180_000;

function compact(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

export class McpOAuthAuthorizationRequiredError extends Error {
  constructor(
    message: string,
    readonly serverId: string,
    readonly serverName: string,
    readonly authorizationUrl: string | null,
  ) {
    super(message);
    this.name = "McpOAuthAuthorizationRequiredError";
  }
}

function createDefaultOAuthState(status: McpOAuthStateRecord["status"] = "unauthenticated"): McpOAuthStateRecord {
  return {
    status,
    authorizationUrl: null,
    tokens: null,
    clientInformation: null,
    codeVerifier: null,
    discoveryState: null,
    lastUpdatedAt: null,
    lastError: null,
  };
}

function ensureOAuthConnection(catalog: McpCatalogRecord, connection: McpConnectionRecord) {
  if (catalog.authType !== "oauth") return connection;
  return {
    ...connection,
    oauth: connection.oauth ?? createDefaultOAuthState(),
  };
}

function updateOAuthState(
  connection: McpConnectionRecord,
  patch: Partial<McpOAuthStateRecord>,
) {
  const base = connection.oauth ?? createDefaultOAuthState();
  return {
    ...connection,
    oauth: {
      ...base,
      ...patch,
      lastUpdatedAt: Date.now(),
    },
  };
}

function isUnauthorizedError(error: unknown) {
  return (
    error instanceof UnauthorizedError ||
    (error instanceof Error && /unauthorized|401|authorization required|oauth/i.test(error.message))
  );
}

function createOAuthRequiredError(
  catalog: McpCatalogRecord,
  connection: McpConnectionRecord,
  language: RuntimeLanguage,
) {
  const authorizationUrl = connection.oauth?.authorizationUrl ?? null;
  return new McpOAuthAuthorizationRequiredError(
    byLanguage(language, {
      zh: authorizationUrl
        ? `${catalog.name} 需要 OAuth 授权。请打开授权链接完成登录：${authorizationUrl}`
        : `${catalog.name} 需要 OAuth 授权或重新登录。请点击聊天中的授权按钮，或在扩展页对该 MCP 执行授权。`,
      en: authorizationUrl
        ? `${catalog.name} requires OAuth authorization. Open the authorization link to sign in: ${authorizationUrl}`
        : `${catalog.name} requires OAuth authorization or sign-in again. Use the chat authorization button or authorize it from Extensions.`,
    }),
    catalog.id,
    catalog.name,
    authorizationUrl,
  );
}

function createOAuthProvider(input: {
  catalog: McpCatalogRecord;
  connection: McpConnectionRecord;
  redirectUrl: string;
  onConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
  onAuthorizationUrl?: (authorizationUrl: string) => void | Promise<void>;
}) {
  let connection = ensureOAuthConnection(input.catalog, input.connection);

  const saveConnection = async (patch: Partial<McpOAuthStateRecord>) => {
    connection = updateOAuthState(connection, patch);
    await input.onConnectionUpdated?.(connection);
  };

  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return input.redirectUrl;
    },
    get clientMetadata() {
      return {
        client_name: "TeamAligned",
        redirect_uris: [input.redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },
    clientInformation() {
      return connection.oauth?.clientInformation as OAuthClientInformationMixed | undefined;
    },
    async saveClientInformation(clientInformation) {
      await saveConnection({
        clientInformation: clientInformation as Record<string, unknown>,
      });
    },
    tokens() {
      return connection.oauth?.tokens as OAuthTokens | undefined;
    },
    async saveTokens(tokens) {
      await saveConnection({
        status: "authorized",
        tokens: tokens as Record<string, unknown>,
        authorizationUrl: null,
        lastError: null,
      });
    },
    async redirectToAuthorization(authorizationUrl) {
      const url = authorizationUrl.toString();
      await saveConnection({
        status: "authorization_pending",
        authorizationUrl: url,
        lastError: null,
      });
      await input.onAuthorizationUrl?.(url);
    },
    async saveCodeVerifier(codeVerifier) {
      await saveConnection({ codeVerifier });
    },
    codeVerifier() {
      const codeVerifier = connection.oauth?.codeVerifier;
      if (!codeVerifier) {
        throw new Error("Missing OAuth code verifier.");
      }
      return codeVerifier;
    },
    async saveDiscoveryState(state: OAuthDiscoveryState) {
      await saveConnection({ discoveryState: state as unknown as Record<string, unknown> });
    },
    discoveryState() {
      return connection.oauth?.discoveryState as unknown as OAuthDiscoveryState | undefined;
    },
    async invalidateCredentials(scope) {
      if (scope === "all") {
        await saveConnection(createDefaultOAuthState());
        return;
      }
      if (scope === "tokens") {
        await saveConnection({ tokens: null, status: "unauthenticated" });
      }
      if (scope === "client") {
        await saveConnection({ clientInformation: null });
      }
      if (scope === "verifier") {
        await saveConnection({ codeVerifier: null });
      }
      if (scope === "discovery") {
        await saveConnection({ discoveryState: null });
      }
    },
  };

  return {
    provider,
    getConnection: () => connection,
  };
}

export function normalizeMcpError(
  catalog: Pick<McpCatalogRecord, "slug" | "name" | "transport" | "authType">,
  error: unknown,
  language: RuntimeLanguage = "zh",
) {
  const message = error instanceof Error ? error.message : String(error);

  if (
    error instanceof McpOAuthAuthorizationRequiredError ||
    catalog.authType === "oauth" && /unauthorized|401|authorization required|oauth|授权/i.test(message)
  ) {
    return byLanguage(language, {
      zh: message.includes("http") ? message : `${catalog.name} 需要 OAuth 授权或授权已过期。请重新授权后再重试。`,
      en: message.includes("http") ? message : `${catalog.name} requires OAuth authorization or the authorization expired. Re-authorize it, then retry.`,
    });
  }

  if (/unauthorized|401/i.test(message)) {
    if (catalog.slug === "figma") {
      return byLanguage(language, {
        zh: "Figma 远端 MCP 返回未授权。请确认当前客户端是否在 Figma 允许接入的客户端列表中，或改用本地桌面版 MCP。",
        en: "The Figma remote MCP returned unauthorized. Check whether this client is allowed by Figma, or use the local desktop MCP instead.",
      });
    }

    return byLanguage(language, {
      zh: "远端 MCP 返回未授权。请检查请求头、Token 或服务端接入权限。",
      en: "The remote MCP returned unauthorized. Check request headers, token, or server access permissions.",
    });
  }

  if (/forbidden|403/i.test(message)) {
    return byLanguage(language, {
      zh: "远端 MCP 拒绝了当前请求。请检查鉴权信息或服务端的客户端接入限制。",
      en: "The remote MCP rejected the request. Check authentication or server-side client access restrictions.",
    });
  }

  if (/timeout|timed out|aborted|abort|超时/i.test(message)) {
    return catalog.transport === "stdio"
      ? byLanguage(language, {
          zh: "MCP 连接超时。请确认本地命令可以独立启动；如果使用 npx，首次下载依赖可能较慢，也可以先在终端预热一次。",
          en: "MCP connection timed out. Make sure the local command can start independently. If it uses npx, the first dependency download may be slow; try warming it up in a terminal first.",
        })
      : byLanguage(language, {
          zh: "远端 MCP 连接超时。请检查 URL 是否可访问、鉴权是否正确，或稍后重试。",
          en: "Remote MCP connection timed out. Check URL reachability and authentication, then retry later.",
        });
  }

  if (/enotfound|econnrefused|fetch failed|network|dns/i.test(message)) {
    return byLanguage(language, {
      zh: "无法连接到 MCP 服务。请检查 URL、网络、代理或本地服务是否已启动。",
      en: "Cannot connect to the MCP service. Check the URL, network/proxy settings, or whether the local service is running.",
    });
  }

  if (/enoent|command not found|spawn .* not found/i.test(message)) {
    return byLanguage(language, {
      zh: "本机缺少 MCP 启动命令。请先安装对应命令，或检查配置中的 command。",
      en: "The MCP launch command is missing on this machine. Install the command first or check the configured command.",
    });
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

function createOAuthCallbackServer(input: {
  serverId: string;
  responseLanguage: RuntimeLanguage;
}) {
  let server: Server | null = null;
  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const close = () =>
    new Promise<void>((resolve) => {
      if (!server || !server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });

  const complete = (result: { code?: string; error?: string }) => {
    if (settled) return;
    settled = true;
    if (result.code) {
      resolveCode(result.code);
      return;
    }
    rejectCode(new Error(result.error || "OAuth authorization failed."));
  };

  server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const code = requestUrl.searchParams.get("code");
    const error = requestUrl.searchParams.get("error");
    const description = requestUrl.searchParams.get("error_description");
    const okHtml = byLanguage(input.responseLanguage, {
      zh: "TeamAligned 已收到授权结果，你可以回到应用继续使用 MCP。",
      en: "TeamAligned received the authorization result. You can return to the app and continue using MCP.",
    });
    const errorHtml = byLanguage(input.responseLanguage, {
      zh: "TeamAligned 授权失败，请回到应用重试。",
      en: "TeamAligned authorization failed. Return to the app and try again.",
    });

    if (code) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<html><body><h2>${okHtml}</h2></body></html>`);
      complete({ code });
      void close();
      return;
    }

    if (error) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(`<html><body><h2>${errorHtml}</h2><p>${description || error}</p></body></html>`);
      complete({ error: description || error });
      void close();
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found.");
  });

  const ready = new Promise<string>((resolveReady, rejectReady) => {
    server?.once("error", rejectReady);
    server?.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (!address || typeof address === "string") {
        rejectReady(new Error("Unable to start OAuth callback server."));
        return;
      }
      resolveReady(`http://127.0.0.1:${address.port}/mcp/oauth/callback/${encodeURIComponent(input.serverId)}`);
    });
  });

  return {
    ready,
    waitForCode: codePromise,
    close,
  };
}

function getRequiredConfigError(
  catalog: McpCatalogRecord,
  connection: McpConnectionRecord,
  language: RuntimeLanguage,
) {
  if (catalog.authType === "env") {
    const missing = catalog.authFields.filter((field) => field.required && !connection.envEntries[field.key]?.trim());
    if (missing.length > 0) {
      return byLanguage(language, {
        zh: `缺少必填环境变量：${missing.map((field) => field.key).join("、")}`,
        en: `Missing required environment variables: ${missing.map((field) => field.key).join(", ")}`,
      });
    }
  }

  if (catalog.authType === "header") {
    const missing = catalog.authFields.filter((field) => field.required && !connection.headers[field.key]?.trim());
    if (missing.length > 0) {
      return byLanguage(language, {
        zh: `缺少必填请求头：${missing.map((field) => field.key).join("、")}`,
        en: `Missing required request headers: ${missing.map((field) => field.key).join(", ")}`,
      });
    }
  }

  if (catalog.authType === "oauth" && connection.oauth?.status !== "authorized") {
    return byLanguage(language, {
      zh: "需要先完成 OAuth 授权。",
      en: "OAuth authorization is required first.",
    });
  }

  if (catalog.transport === "stdio" && !connection.command?.trim()) {
    return byLanguage(language, {
      zh: "缺少本地启动命令。",
      en: "Missing local launch command.",
    });
  }

  if (catalog.transport === "http" && !connection.url?.trim()) {
    return byLanguage(language, {
      zh: "缺少远端 MCP URL。",
      en: "Missing remote MCP URL.",
    });
  }

  if (catalog.transport === "http" && connection.url && !/^https?:\/\//i.test(connection.url)) {
    return byLanguage(language, {
      zh: "远端 MCP URL 必须以 http:// 或 https:// 开头。",
      en: "Remote MCP URL must start with http:// or https://.",
    });
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
    responseLanguage?: RuntimeLanguage;
    oauthRedirectUrl?: string;
    onConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
    onOAuthAuthorizationUrl?: (authorizationUrl: string) => void | Promise<void>;
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

  let latestConnection = ensureOAuthConnection(input.catalog, input.connection);
  const oauth =
    input.catalog.authType === "oauth"
      ? createOAuthProvider({
          catalog: input.catalog,
          connection: latestConnection,
          redirectUrl: input.oauthRedirectUrl ?? "http://127.0.0.1:37371/mcp/oauth/callback",
          onConnectionUpdated: async (connection) => {
            latestConnection = connection;
            await input.onConnectionUpdated?.(connection);
          },
          onAuthorizationUrl: input.onOAuthAuthorizationUrl,
        })
      : null;
  const transport = new StreamableHTTPClientTransport(new URL(latestConnection.url!), {
    authProvider: oauth?.provider,
    requestInit: {
      signal: AbortSignal.timeout(MCP_CONNECT_TIMEOUT_MS),
      headers: Object.fromEntries(
        Object.entries(latestConnection.headers).filter(([, value]) => value.trim().length > 0),
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
  } catch (error) {
    if (input.catalog.authType === "oauth" && isUnauthorizedError(error)) {
      const pendingConnection = {
        ...(oauth?.getConnection() ?? latestConnection),
        enabled: false,
        status: "configured" as const,
        lastCheckedAt: Date.now(),
        oauth: {
          ...((oauth?.getConnection() ?? latestConnection).oauth ?? createDefaultOAuthState()),
          status: "unauthenticated" as const,
          tokens: null,
          authorizationUrl: null,
          lastError: byLanguage(input.responseLanguage ?? "zh", {
            zh: "OAuth 授权已失效或需要重新登录。",
            en: "OAuth authorization expired or needs sign-in again.",
          }),
          lastUpdatedAt: Date.now(),
        },
      };
      const authorizationError = createOAuthRequiredError(
        input.catalog,
        pendingConnection,
        input.responseLanguage ?? "zh",
      );
      await input.onConnectionUpdated?.({
        ...pendingConnection,
        lastError: authorizationError.message,
      });
      throw authorizationError;
    }
    throw error;
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export async function checkMcpConnection(input: {
  catalog: McpCatalogRecord;
  connection: McpConnectionRecord;
  workspacePath: string;
  responseLanguage?: RuntimeLanguage;
  onConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
}): Promise<McpConnectionRecord> {
  const responseLanguage = input.responseLanguage ?? "zh";
  let latestConnection = ensureOAuthConnection(input.catalog, input.connection);
  const requiredConfigError = getRequiredConfigError(input.catalog, latestConnection, responseLanguage);
  if (requiredConfigError) {
    return {
      ...latestConnection,
      enabled: false,
      status: "configured" as const,
      lastCheckedAt: Date.now(),
      lastError: requiredConfigError,
      oauth:
        input.catalog.authType === "oauth"
          ? {
              ...(latestConnection.oauth ?? createDefaultOAuthState()),
              status:
                latestConnection.oauth?.status === "authorization_pending"
                  ? "authorization_pending"
                  : "unauthenticated" as McpOAuthStateRecord["status"],
              lastError: requiredConfigError,
              lastUpdatedAt: Date.now(),
            }
          : latestConnection.oauth,
    };
  }

  try {
    const discoveredTools = await withMcpClient(
      {
        ...input,
        connection: latestConnection,
        onConnectionUpdated: async (connection) => {
          latestConnection = connection;
          await input.onConnectionUpdated?.(connection);
        },
      },
      async (client) => {
        const result = await client.listTools();
        return mapTools(result.tools as Array<Record<string, unknown>>);
      },
    );

    return {
      ...latestConnection,
      enabled: true,
      status: "connected" as const,
      discoveredTools,
      lastCheckedAt: Date.now(),
      lastError: null,
    };
  } catch (error) {
    return {
      ...latestConnection,
      enabled: false,
      status: error instanceof McpOAuthAuthorizationRequiredError ? "configured" as const : "error" as const,
      lastCheckedAt: Date.now(),
      lastError: normalizeMcpError(input.catalog, error, responseLanguage),
      oauth:
        input.catalog.authType === "oauth"
          ? {
              ...(latestConnection.oauth ?? createDefaultOAuthState()),
              status:
                error instanceof McpOAuthAuthorizationRequiredError
                  ? "authorization_pending"
                  : "error" as McpOAuthStateRecord["status"],
              authorizationUrl:
                error instanceof McpOAuthAuthorizationRequiredError
                  ? error.authorizationUrl
                  : latestConnection.oauth?.authorizationUrl ?? null,
              lastError: normalizeMcpError(input.catalog, error, responseLanguage),
              lastUpdatedAt: Date.now(),
            }
          : latestConnection.oauth,
    };
  }
}

export async function authorizeMcpConnection(input: {
  catalog: McpCatalogRecord;
  connection: McpConnectionRecord;
  workspacePath: string;
  responseLanguage?: RuntimeLanguage;
  openAuthorizationUrl?: (authorizationUrl: string) => void | Promise<void>;
  onConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
}): Promise<McpConnectionRecord> {
  const responseLanguage = input.responseLanguage ?? "zh";
  let latestConnection = ensureOAuthConnection(input.catalog, input.connection);

  if (input.catalog.transport !== "http" || input.catalog.authType !== "oauth") {
    return checkMcpConnection({
      catalog: input.catalog,
      connection: latestConnection,
      workspacePath: input.workspacePath,
      responseLanguage,
      onConnectionUpdated: input.onConnectionUpdated,
    });
  }

  const callback = createOAuthCallbackServer({
    serverId: input.catalog.id,
    responseLanguage,
  });
  const redirectUrl = await callback.ready;
  let authorizationUrl = latestConnection.oauth?.authorizationUrl ?? null;
  let authorizationOpened = false;

  try {
    const client = new Client({
      name: "teamaligned",
      version: "0.1.0",
    });
    const oauth = createOAuthProvider({
      catalog: input.catalog,
      connection: latestConnection,
      redirectUrl,
      onConnectionUpdated: async (connection) => {
        latestConnection = connection;
        await input.onConnectionUpdated?.(connection);
      },
      onAuthorizationUrl: async (url) => {
        authorizationUrl = url;
        authorizationOpened = true;
        await input.openAuthorizationUrl?.(url);
      },
    });
    const transport = new StreamableHTTPClientTransport(new URL(latestConnection.url!), {
      authProvider: oauth.provider,
      requestInit: {
        signal: AbortSignal.timeout(MCP_CONNECT_TIMEOUT_MS),
        headers: Object.fromEntries(
          Object.entries(latestConnection.headers).filter(([, value]) => value.trim().length > 0),
        ),
      },
    });

    try {
      await client.connect(transport);
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        throw error;
      }
      if (!authorizationUrl) {
        authorizationUrl = oauth.getConnection().oauth?.authorizationUrl ?? null;
      }
      if (!authorizationUrl) {
        throw createOAuthRequiredError(input.catalog, oauth.getConnection(), responseLanguage);
      }
      if (!authorizationOpened) {
        authorizationOpened = true;
        await input.openAuthorizationUrl?.(authorizationUrl);
      }
      const code = await withTimeout(
        callback.waitForCode,
        MCP_OAUTH_TIMEOUT_MS,
        byLanguage(responseLanguage, {
          zh: "等待 OAuth 授权超时，请重新发起授权。",
          en: "Timed out waiting for OAuth authorization. Please start authorization again.",
        }),
      );
      await transport.finishAuth(code);
      latestConnection = oauth.getConnection();
    } finally {
      await transport.close().catch(() => undefined);
    }

    const checked = await checkMcpConnection({
      catalog: input.catalog,
      connection: latestConnection,
      workspacePath: input.workspacePath,
      responseLanguage,
      onConnectionUpdated: async (connection) => {
        latestConnection = connection;
        await input.onConnectionUpdated?.(connection);
      },
    });
    return checked;
  } catch (error) {
    const normalizedError = normalizeMcpError(input.catalog, error, responseLanguage);
    const failedConnection = updateOAuthState(latestConnection, {
      status:
        error instanceof McpOAuthAuthorizationRequiredError || authorizationUrl
          ? "authorization_pending"
          : "error",
      authorizationUrl,
      lastError: normalizedError,
    });
    await input.onConnectionUpdated?.(failedConnection);
    return {
      ...failedConnection,
      enabled: false,
      status: "configured" as const,
      lastCheckedAt: Date.now(),
      lastError: normalizedError,
    };
  } finally {
    await callback.close();
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
  responseLanguage?: RuntimeLanguage;
  onConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
}) {
  try {
    return await withMcpClient(
      {
        ...input,
        responseLanguage: input.responseLanguage,
        onConnectionUpdated: input.onConnectionUpdated,
      },
      async (client) => {
        const result = await client.callTool({
          name: input.toolName,
          arguments: input.args,
        });

        return serializeCallToolResult(result);
      },
    );
  } catch (error) {
    throw new Error(normalizeMcpError(input.catalog, error, input.responseLanguage ?? "zh"));
  }
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
