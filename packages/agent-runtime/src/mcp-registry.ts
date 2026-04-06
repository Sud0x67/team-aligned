import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { McpCatalogRecord, McpConnectionRecord, McpToolRecord } from "@teamaligned/shared";

type RemoteMcpCatalog = {
  generatedAt?: string;
  count?: number;
  servers: RemoteMcpCatalogEntry[];
};

type RemoteMcpCatalogEntry = {
  id: string;
  slug?: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  transport: "stdio" | "http";
  launcher?: {
    command?: string;
    args?: string[];
  };
  remote?: {
    url?: string;
  };
  auth?: {
    type?: "none" | "env" | "header";
    fields?: Array<{
      key: string;
      label: string;
      required?: boolean;
      secret?: boolean;
      placeholder?: string;
    }>;
  };
  capabilities?: string[];
  declaredTools?: string[];
  recommendedFor?: string[];
  riskLevel?: "low" | "medium" | "high";
  tags?: string[];
  docsUrl?: string;
  homepage?: string;
  sources?: string[];
};

const DEFAULT_BRANCH = process.env.TEAMALIGNED_MCP_REGISTRY_BRANCH?.trim() || "main";
const DEFAULT_REPO_URL = "https://github.com/Sud0x67/team-aligned-mcps";

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isGitHubRepoUrl(value: string) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(value.replace(/\.git$/i, ""));
}

function resolveRegistrySource() {
  const configured = process.env.TEAMALIGNED_MCP_REGISTRY_SOURCE?.trim();
  return configured || DEFAULT_REPO_URL;
}

function toCatalogLocation(source: string, branch: string) {
  if (!isHttpUrl(source)) {
    return join(source, "catalog", "servers.json");
  }

  if (source.endsWith(".json")) {
    return source;
  }

  if (!isGitHubRepoUrl(source)) {
    throw new Error(`当前仅支持 GitHub repo URL 或本地目录作为 MCP registry：${source}`);
  }

  const normalized = source.replace(/\.git$/i, "").replace(/\/+$/g, "");
  const [, owner, repo] = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i) ?? [];
  if (!owner || !repo) {
    throw new Error(`无法解析 GitHub MCP registry 地址：${source}`);
  }

  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/catalog/servers.json`;
}

function mapRemoteCatalog(catalog: RemoteMcpCatalog, sourceRepo: string, branch: string): McpCatalogRecord[] {
  return catalog.servers.map((item) => ({
    id: item.id,
    slug: item.slug || item.id.replace(/^mcp-/, ""),
    name: item.name,
    description: item.description,
    version: item.version,
    author: item.author || "Unknown",
    transport: item.transport,
    sourceRepo,
    sourceBranch: branch,
    sourcePath: `servers/${item.slug || item.id.replace(/^mcp-/, "")}`,
    launcherCommand: item.launcher?.command || null,
    launcherArgs: item.launcher?.args || [],
    remoteUrl: item.remote?.url || null,
    authType: item.auth?.type || "none",
    authFields: (item.auth?.fields || []).map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required ?? true,
      secret: field.secret ?? true,
      placeholder: field.placeholder,
    })),
    capabilities: item.capabilities || [],
    declaredTools: item.declaredTools || [],
    recommendedFor: item.recommendedFor || [],
    riskLevel: item.riskLevel || "medium",
    docsUrl: item.docsUrl || null,
    homepage: item.homepage || null,
    metadata: {
      tags: item.tags || [],
      sources: item.sources || [],
    },
  }));
}

export async function fetchMcpCatalog() {
  const source = resolveRegistrySource();
  const branch = DEFAULT_BRANCH;
  const catalogLocation = toCatalogLocation(source, branch);

  if (!isHttpUrl(catalogLocation)) {
    const content = readFileSync(catalogLocation, "utf8");
    return mapRemoteCatalog(JSON.parse(content) as RemoteMcpCatalog, source, branch);
  }

  const response = await fetch(catalogLocation);
  if (!response.ok) {
    throw new Error(`拉取 MCP catalog 失败：${response.status} ${response.statusText}`);
  }

  return mapRemoteCatalog((await response.json()) as RemoteMcpCatalog, source, branch);
}

function createPlaceholderTools(names: string[]): McpToolRecord[] {
  return names.map((name) => ({
    name,
    title: null,
    description: "",
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: null,
    annotations: null,
  }));
}

export function buildMcpConnection(catalog: McpCatalogRecord): McpConnectionRecord {
  const envEntries =
    catalog.authType === "env"
      ? Object.fromEntries(catalog.authFields.map((field) => [field.key, ""]))
      : {};
  const headers =
    catalog.authType === "header"
      ? Object.fromEntries(catalog.authFields.map((field) => [field.key, ""]))
      : {};
  const needsConfiguration = catalog.authFields.some((field) => field.required);

  return {
    serverId: catalog.id,
    enabled: !needsConfiguration,
    transport: catalog.transport,
    command: catalog.launcherCommand,
    args: [...catalog.launcherArgs],
    url: catalog.remoteUrl,
    envEntries,
    headers,
    cwd: null,
    discoveredTools: createPlaceholderTools(catalog.declaredTools),
    status: needsConfiguration ? "configured" : "disconnected",
    lastCheckedAt: null,
    lastError: needsConfiguration ? "需要先补全本地连接配置。" : null,
  };
}

export function validateLocalMcpLauncher(catalog: McpCatalogRecord) {
  if (catalog.transport !== "stdio" || !catalog.launcherCommand) {
    return null;
  }

  const result = spawnSync("which", [catalog.launcherCommand], { encoding: "utf8" });
  if (result.status !== 0) {
    return `本机缺少启动命令：${catalog.launcherCommand}`;
  }

  return null;
}

export function resolveWorkspaceAwareArgs(args: string[], workspacePath: string) {
  return args.map((arg) => arg.replaceAll("${workspacePath}", workspacePath));
}
