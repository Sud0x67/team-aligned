import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { ProviderConfig, SkillCatalogRecord } from "@teamaligned/shared";
import { z } from "zod";
import { byLanguage, type RuntimeLanguage } from "./runtime-language.ts";
import { runWebFetch, runWebSearch } from "./web-tools.ts";

const execFileAsync = promisify(execFile);
const MAX_TEXT_READ = 32_000;
const MAX_COMMAND_OUTPUT = 16_000;
const MAX_SEARCH_OUTPUT = 12_000;

export type RuntimeToolInvocationEvent =
  | {
      phase: "start";
      invocationId: string;
      startedAt: number;
      serverId: string;
      serverName: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      phase: "success";
      invocationId: string;
      startedAt: number;
      completedAt: number;
      serverId: string;
      serverName: string;
      toolName: string;
      args: Record<string, unknown>;
      output: string;
    }
  | {
      phase: "error";
      invocationId: string;
      startedAt: number;
      completedAt: number;
      serverId: string;
      serverName: string;
      toolName: string;
      args: Record<string, unknown>;
      error: string;
    };

export type ToolExecutionOperation = "read" | "write" | "command" | "network" | "mcp" | "skill";
export type ToolExecutionRisk = "low" | "medium" | "high";

export type ToolExecutionPolicyRequest = {
  serverId: string;
  serverName: string;
  toolName: string;
  operation: ToolExecutionOperation;
  riskLevel: ToolExecutionRisk;
  args: Record<string, unknown>;
  description: string;
};

export type ToolExecutionPolicyDecision =
  | { allow: true }
  | {
      allow: false;
      reason: string;
      requiresConfirmation?: boolean;
    };

export type ToolExecutionPolicy = (
  request: ToolExecutionPolicyRequest,
) => ToolExecutionPolicyDecision | Promise<ToolExecutionPolicyDecision>;

export class ToolExecutionApprovalRequiredError extends Error {
  constructor(
    message: string,
    readonly request: ToolExecutionPolicyRequest,
  ) {
    super(message);
    this.name = "ToolExecutionApprovalRequiredError";
  }
}

async function ensureToolExecutionAllowed(input: {
  approvalPolicy?: ToolExecutionPolicy;
  request?: ToolExecutionPolicyRequest;
}) {
  if (!input.approvalPolicy || !input.request) {
    return;
  }
  const decision = await input.approvalPolicy(input.request);
  if (decision.allow) {
    return;
  }
  throw new ToolExecutionApprovalRequiredError(decision.reason, input.request);
}

function trimText(value: string, max: number) {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max)}\n...`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isInsideRoot(targetPath: string, rootPath: string) {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`));
}

function resolveAllowedPath(inputPath: string, allowedRoots: string[], defaultRoot: string) {
  const candidate = inputPath.trim();
  const resolved = candidate.startsWith("/")
    ? resolve(candidate)
    : resolve(defaultRoot, candidate.length > 0 ? candidate : ".");

  if (!allowedRoots.some((root) => isInsideRoot(resolved, resolve(root)))) {
    throw new Error("访问路径超出允许范围。");
  }

  return resolved;
}

function listDirEntries(dirPath: string) {
  return readdirSync(dirPath, { withFileTypes: true })
    .slice(0, 80)
    .map((entry) => `${entry.isDirectory() ? "dir" : "file"} ${entry.name}`)
    .join("\n");
}

function detectScriptInterpreter(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".py") return "python3";
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return "node";
  if (extension === ".sh") return "bash";
  return null;
}

async function withInvocation<T>(
  input: {
    invocationId: string;
    serverId: string;
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
    onInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
    approvalPolicy?: ToolExecutionPolicy;
    policyRequest?: ToolExecutionPolicyRequest;
  },
  execute: () => Promise<T>,
  serialize: (result: T) => string,
) {
  await ensureToolExecutionAllowed({
    approvalPolicy: input.approvalPolicy,
    request: input.policyRequest,
  });
  const startedAt = Date.now();
  await input.onInvocation?.({
    phase: "start",
    invocationId: input.invocationId,
    startedAt,
    serverId: input.serverId,
    serverName: input.serverName,
    toolName: input.toolName,
    args: input.args,
  });

  try {
    const result = await execute();
    await input.onInvocation?.({
      phase: "success",
      invocationId: input.invocationId,
      startedAt,
      completedAt: Date.now(),
      serverId: input.serverId,
      serverName: input.serverName,
      toolName: input.toolName,
      args: input.args,
      output: serialize(result),
    });
    return result;
  } catch (error) {
    await input.onInvocation?.({
      phase: "error",
      invocationId: input.invocationId,
      startedAt,
      completedAt: Date.now(),
      serverId: input.serverId,
      serverName: input.serverName,
      toolName: input.toolName,
      args: input.args,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function readCommandFailureOutput(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  return `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim();
}

function createInvocationId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildRuntimeLangChainTools(input: {
  workspacePath: string;
  attachmentRoots: string[];
  provider: ProviderConfig | null;
  responseLanguage: RuntimeLanguage;
  activeSkill: SkillCatalogRecord | null;
  onInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  approvalPolicy?: ToolExecutionPolicy;
}) {
  const workspaceRoot = resolve(input.workspacePath);
  const allowedRoots = [workspaceRoot, ...input.attachmentRoots.map((root) => resolve(root))];
  if (input.activeSkill?.installPath) {
    allowedRoots.push(resolve(input.activeSkill.installPath));
  }

  const tools: StructuredToolInterface[] = [
    tool(
      async ({ path }) => {
        const targetPath = resolveAllowedPath(path, allowedRoots, workspaceRoot);
        return withInvocation(
          {
            invocationId: createInvocationId("local_list"),
            serverId: "local-workspace",
            serverName: "Workspace",
            toolName: "list_directory",
            args: { path },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: "local-workspace",
              serverName: "Workspace",
              toolName: "list_directory",
              operation: "read",
              riskLevel: "low",
              args: { path },
              description: "List files in the current workspace or allowed attachment/skill roots.",
            },
          },
          async () => {
            if (!existsSync(targetPath)) {
              throw new Error(`目录不存在：${path}`);
            }
            const stats = statSync(targetPath);
            if (!stats.isDirectory()) {
              throw new Error(`目标不是目录：${path}`);
            }
            return `目录：${targetPath}\n\n${listDirEntries(targetPath) || "目录为空。"}`;
          },
          (result) => result,
        );
      },
      {
        name: "workspace_list_directory",
        description: "列出 workspace、附件目录或当前激活 skill 目录中的文件和子目录。",
        schema: z.object({
          path: z.string().default(".").describe("相对或绝对目录路径。"),
        }),
      },
    ),
    tool(
      async ({ path }) => {
        const targetPath = resolveAllowedPath(path, allowedRoots, workspaceRoot);
        return withInvocation(
          {
            invocationId: createInvocationId("local_read"),
            serverId: "local-workspace",
            serverName: "Workspace",
            toolName: "read_text_file",
            args: { path },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: "local-workspace",
              serverName: "Workspace",
              toolName: "read_text_file",
              operation: "read",
              riskLevel: "low",
              args: { path },
              description: "Read a text file from the current workspace or allowed attachment/skill roots.",
            },
          },
          async () => {
            if (!existsSync(targetPath)) {
              throw new Error(`文件不存在：${path}`);
            }
            const stats = statSync(targetPath);
            if (!stats.isFile()) {
              throw new Error(`目标不是文件：${path}`);
            }
            return trimText(readFileSync(targetPath, "utf8"), MAX_TEXT_READ);
          },
          (result) => result,
        );
      },
      {
        name: "workspace_read_text_file",
        description: "读取 workspace、附件目录或当前激活 skill 目录中的文本文件内容。",
        schema: z.object({
          path: z.string().describe("相对或绝对文件路径。"),
        }),
      },
    ),
    tool(
      async ({ path, content }) => {
        const targetPath = resolveAllowedPath(path, [workspaceRoot], workspaceRoot);
        return withInvocation(
          {
            invocationId: createInvocationId("local_write"),
            serverId: "local-workspace",
            serverName: "Workspace",
            toolName: "write_text_file",
            args: { path },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: "local-workspace",
              serverName: "Workspace",
              toolName: "write_text_file",
              operation: "write",
              riskLevel: "high",
              args: { path },
              description: "Write or overwrite a text file inside the current workspace.",
            },
          },
          async () => {
            mkdirSync(dirname(targetPath), { recursive: true });
            writeFileSync(targetPath, content, "utf8");
            return `已写入文件：${targetPath}`;
          },
          (result) => result,
        );
      },
      {
        name: "workspace_write_text_file",
        description: "在当前 workspace 内写入或覆盖文本文件。",
        schema: z.object({
          path: z.string().describe("相对 workspace 的文件路径。"),
          content: z.string().describe("要写入的完整文本内容。"),
        }),
      },
    ),
    tool(
      async ({ pattern, glob }) => {
        return withInvocation(
          {
            invocationId: createInvocationId("local_search"),
            serverId: "local-search",
            serverName: "Workspace Search",
            toolName: "search_workspace",
            args: { pattern, glob },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: "local-search",
              serverName: "Workspace Search",
              toolName: "search_workspace",
              operation: "read",
              riskLevel: "low",
              args: { pattern, glob },
              description: "Search text in the current workspace.",
            },
          },
          async () => {
            const searchArgs = ["--line-number", "--hidden", "--smart-case", pattern, workspaceRoot];
            if (glob?.trim()) {
              searchArgs.unshift("-g", glob.trim());
            }
            try {
              const { stdout, stderr } = await execFileAsync("rg", searchArgs, {
                cwd: workspaceRoot,
                maxBuffer: 1024 * 1024,
              });
              const output = trimText((stdout || stderr || "没有搜索结果。").trim(), MAX_SEARCH_OUTPUT);
              return output || "没有搜索结果。";
            } catch (error) {
              if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                Number(error.code) === 1
              ) {
                return "没有搜索结果。";
              }
              throw error;
            }
          },
          (result) => result,
        );
      },
      {
        name: "workspace_search_rg",
        description: "使用 ripgrep 在当前 workspace 中搜索文本、代码或文件内容。",
        schema: z.object({
          pattern: z.string().describe("要搜索的文本或正则模式。"),
          glob: z.string().optional().describe("可选 glob，例如 src/**/*.ts。"),
        }),
      },
    ),
    tool(
      async ({ command }) => {
        return withInvocation(
          {
            invocationId: createInvocationId("local_cmd"),
            serverId: "local-shell",
            serverName: "Workspace Shell",
            toolName: "run_workspace_command",
            args: { command },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: "local-shell",
              serverName: "Workspace Shell",
              toolName: "run_workspace_command",
              operation: "command",
              riskLevel: "high",
              args: { command },
              description: "Run a shell command in the current workspace.",
            },
          },
          async () => {
            try {
              const { stdout, stderr } = await execFileAsync("zsh", ["-lc", command], {
                cwd: workspaceRoot,
                maxBuffer: 1024 * 1024,
              });
              return trimText(
                `${stdout || ""}${stderr ? `\n${stderr}` : ""}` || "命令执行完成，没有输出。",
                MAX_COMMAND_OUTPUT,
              );
            } catch (error) {
              const output = readCommandFailureOutput(error);
              if (output) {
                return trimText(output, MAX_COMMAND_OUTPUT);
              }
              throw error;
            }
          },
          (result) => result,
        );
      },
      {
        name: "workspace_run_command",
        description: "在当前 workspace 中执行 shell 命令，适合构建、测试、目录检查和轻量脚本执行。",
        schema: z.object({
          command: z.string().describe("要执行的 shell 命令。"),
        }),
      },
    ),
  ];

  tools.push(
    tool(
      async ({ url, extractMode, maxChars }) => {
        return withInvocation(
          {
            invocationId: createInvocationId("local_webfetch"),
            serverId: "local-web",
            serverName: "Web Fetch",
            toolName: "web_fetch",
            args: { url, extractMode, maxChars },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: "local-web",
              serverName: "Web Fetch",
              toolName: "web_fetch",
              operation: "network",
              riskLevel: "low",
              args: { url, extractMode, maxChars },
              description: "Fetch and extract content from a public webpage.",
            },
          },
          async () => {
            const result = await runWebFetch({
              url,
              extractMode,
              maxChars,
            });
            return JSON.stringify(result, null, 2);
          },
          (result) => result,
        );
      },
      {
        name: "web_fetch",
        description: byLanguage(input.responseLanguage, {
          zh: "抓取公开网页并提取主要文本内容。适合先检索来源再读取正文。",
          en: "Fetch a public webpage and extract its main text content.",
        }),
        schema: z.object({
          url: z.string().describe("目标网页 URL，必须是 http(s)。"),
          extractMode: z
            .enum(["markdown", "text"])
            .default("markdown")
            .describe("输出格式：markdown 或 text。"),
          maxChars: z
            .number()
            .int()
            .min(512)
            .max(32_000)
            .optional()
            .describe("可选，正文最大字符数。"),
        }),
      },
    ),
    tool(
      async ({ query, maxResults }) => {
        return withInvocation(
          {
            invocationId: createInvocationId("local_websearch"),
            serverId: "local-web",
            serverName: "Web Search",
            toolName: "web_search",
            args: { query, maxResults },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: "local-web",
              serverName: "Web Search",
              toolName: "web_search",
              operation: "network",
              riskLevel: "low",
              args: { query, maxResults },
              description: "Search public web information.",
            },
          },
          async () => {
            const result = await runWebSearch({
              provider: input.provider,
              query,
              maxResults,
            });
            return JSON.stringify(result, null, 2);
          },
          (result) => result,
        );
      },
      {
        name: "web_search",
        description: byLanguage(input.responseLanguage, {
          zh: "搜索公开网页信息。优先使用 provider 原生 web search，不可用时自动回退。",
          en: "Search public web information. Prefers provider-native web search and falls back automatically.",
        }),
        schema: z.object({
          query: z.string().describe("搜索关键词或问题。"),
          maxResults: z
            .number()
            .int()
            .min(1)
            .max(8)
            .optional()
            .describe("可选，返回结果数量上限。"),
        }),
      },
    ),
  );

  if (!input.activeSkill?.installPath) {
    return {
      tools,
      summary: byLanguage(input.responseLanguage, {
        zh: "Workspace 文件、搜索、命令与网页工具（web_search / web_fetch）已可用。",
        en: "Workspace file/search/command tools and web tools (web_search / web_fetch) are available.",
      }),
    };
  }

  const skillRoot = resolve(input.activeSkill.installPath);
  const skillScriptsDir = join(skillRoot, "scripts");
  const skillFiles = readdirSync(skillRoot, { withFileTypes: true }).map((entry) => entry.name);

  tools.push(
    tool(
      async ({ relativePath }) => {
        return withInvocation(
          {
            invocationId: createInvocationId("skill_read"),
            serverId: input.activeSkill!.id,
            serverName: input.activeSkill!.displayName,
            toolName: "read_skill_bundle",
            args: { relativePath },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: input.activeSkill!.id,
              serverName: input.activeSkill!.displayName,
              toolName: "read_skill_bundle",
              operation: "skill",
              riskLevel: "low",
              args: { relativePath },
              description: "Read bundled files from the active skill.",
            },
          },
          async () => {
            if (!relativePath?.trim()) {
              return [
                `技能：${input.activeSkill!.displayName}`,
                `目录：${skillRoot}`,
                `入口：${input.activeSkill!.entryFile}`,
                `文件：${skillFiles.join("、") || "无"}`,
              ].join("\n");
            }
            const targetPath = resolveAllowedPath(relativePath, [skillRoot], skillRoot);
            if (!existsSync(targetPath)) {
              throw new Error(`技能文件不存在：${relativePath}`);
            }
            const stats = statSync(targetPath);
            if (stats.isDirectory()) {
              return `目录：${targetPath}\n\n${listDirEntries(targetPath) || "目录为空。"}`;
            }
            return trimText(readFileSync(targetPath, "utf8"), MAX_TEXT_READ);
          },
          (result) => result,
        );
      },
      {
        name: `skill_${slugify(input.activeSkill.slug)}_bundle`,
        description: `查看技能 ${input.activeSkill.displayName} 的入口文件、脚本和附属数据文件。`,
        schema: z.object({
          relativePath: z.string().optional().describe("技能目录内的相对路径；留空则返回技能概览。"),
        }),
      },
    ),
  );

  if (existsSync(skillScriptsDir)) {
    const scriptFiles = readdirSync(skillScriptsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(skillScriptsDir, entry.name))
      .filter((filePath) => detectScriptInterpreter(filePath));

    for (const scriptPath of scriptFiles) {
      const interpreter = detectScriptInterpreter(scriptPath);
      if (!interpreter) continue;
      const toolName = `skill_${slugify(input.activeSkill.slug)}_${slugify(basename(scriptPath, extname(scriptPath)))}`;

      tools.push(
        tool(
          async ({ argumentsLine }) => {
            return withInvocation(
              {
                invocationId: createInvocationId("skill_script"),
                serverId: input.activeSkill!.id,
                serverName: input.activeSkill!.displayName,
                toolName,
                args: { argumentsLine },
                onInvocation: input.onInvocation,
                approvalPolicy: input.approvalPolicy,
                policyRequest: {
                  serverId: input.activeSkill!.id,
                  serverName: input.activeSkill!.displayName,
                  toolName,
                  operation: "skill",
                  riskLevel: "medium",
                  args: { argumentsLine },
                  description: `Run bundled script ${basename(scriptPath)} from the active skill.`,
                },
              },
              async () => {
                const command = `${interpreter} "${scriptPath}" ${argumentsLine?.trim() || ""}`.trim();
                try {
                  const { stdout, stderr } = await execFileAsync("zsh", ["-lc", command], {
                    cwd: skillRoot,
                    maxBuffer: 1024 * 1024,
                  });
                  return trimText(
                    `${stdout || ""}${stderr ? `\n${stderr}` : ""}` || "脚本执行完成，没有输出。",
                    MAX_COMMAND_OUTPUT,
                  );
                } catch (error) {
                  const output = readCommandFailureOutput(error);
                  if (output) {
                    return trimText(output, MAX_COMMAND_OUTPUT);
                  }
                  throw error;
                }
              },
              (result) => result,
            );
          },
          {
            name: toolName,
            description: `执行技能 ${input.activeSkill.displayName} 附带脚本 ${basename(scriptPath)}。需要时可传入原始命令参数。`,
            schema: z.object({
              argumentsLine: z
                .string()
                .optional()
                .describe("直接传给脚本的一整行参数，例如 --design-system -p \"Project Name\"。"),
            }),
          },
        ),
      );
    }
  }

  return {
    tools,
    summary: byLanguage(input.responseLanguage, {
      zh: `Workspace 与网页工具已可用，当前技能 ${input.activeSkill.displayName} 也已接入 bundle 和脚本工具。`,
      en: `Workspace and web tools are available. Active skill ${input.activeSkill.displayName} also has bundle/script tools enabled.`,
    }),
  };
}
