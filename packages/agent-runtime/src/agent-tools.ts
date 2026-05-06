import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import {
  TEAMALIGNED_ASSISTANT_SKILL_DEFINITION,
  isSystemBuiltinSkill,
  type ProviderConfig,
  type SkillCatalogRecord,
} from "@teamaligned/shared";
import { z } from "zod";
import { byLanguage, type RuntimeLanguage } from "./runtime-language.ts";
import { runWebFetch, runWebSearch } from "./web-tools.ts";
import {
  createReservedWorkspacePathError,
  isReservedWorkspacePath,
  reservedWorkspaceDirNames,
} from "./workspace-reserved-paths.ts";

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
  workspaceScoped?: boolean;
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
    return { allow: true } as const;
  }
  const decision = await input.approvalPolicy(input.request);
  if (decision.allow) {
    return { allow: true } as const;
  }
  if (decision.requiresConfirmation) {
    throw new ToolExecutionApprovalRequiredError(decision.reason, input.request);
  }
  return {
    allow: false,
    reason: decision.reason,
  } as const;
}

function formatToolExecutionDeniedOutput(reason: string) {
  return [
    "TOOL_EXECUTION_DENIED",
    `Reason: ${reason}`,
    "Required: do not re-request the same permission automatically. Explain to the user that the action was not executed, and offer an alternative approach.",
  ].join("\n");
}

async function emitDeniedInvocation(input: {
  invocationId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  onInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  error: string;
}) {
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
  await input.onInvocation?.({
    phase: "error",
    invocationId: input.invocationId,
    startedAt,
    completedAt: Date.now(),
    serverId: input.serverId,
    serverName: input.serverName,
    toolName: input.toolName,
    args: input.args,
    error: input.error,
  });
}

async function withDeniedToolResult<T>(
  input: {
    invocationId: string;
    serverId: string;
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
    onInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  },
  reason: string,
): Promise<T> {
  await emitDeniedInvocation({
    ...input,
    error: reason,
  });
  return formatToolExecutionDeniedOutput(reason) as T;
}

async function ensureOrReturnDenied<T>(input: {
  approvalPolicy?: ToolExecutionPolicy;
  request?: ToolExecutionPolicyRequest;
  invocation: {
    invocationId: string;
    serverId: string;
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
    onInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  };
}): Promise<{ deniedResult: T | null }> {
  if (!input.approvalPolicy || !input.request) {
    return { deniedResult: null };
  }
  const decision = await ensureToolExecutionAllowed(input);
  if (decision.allow) {
    return { deniedResult: null };
  }
  return {
    deniedResult: await withDeniedToolResult<T>(input.invocation, decision.reason),
  };
}

function trimText(value: string, max: number) {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max)}\n...`;
}

function stringifyToolError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function appendOriginalError(message: string, rawError: string, language: RuntimeLanguage) {
  const detail = trimText(rawError, 320);
  if (!detail) return message;
  return byLanguage(language, {
    zh: `${message}\n原始错误：${detail}`,
    en: `${message}\nOriginal error: ${detail}`,
  });
}

export function normalizeRuntimeToolErrorMessage(input: {
  toolName: string;
  serverName?: string;
  error: unknown;
  responseLanguage?: RuntimeLanguage;
}) {
  const responseLanguage = input.responseLanguage ?? "zh";
  const toolName = input.toolName.replace(/^workspace_/, "");
  const source = input.serverName ? `${input.serverName}.${toolName}` : toolName;
  const rawError = stringifyToolError(input.error).trim();
  const normalized = rawError.toLowerCase();
  const has = (pattern: RegExp) => pattern.test(rawError) || pattern.test(normalized);
  const base = (messages: { zh: string; en: string }) =>
    appendOriginalError(byLanguage(responseLanguage, messages), rawError, responseLanguage);

  if (has(/approval|required|confirm|确认|拒绝|denied|安全策略|policy/)) {
    return base({
      zh: `${source} 需要确认后才能继续。请在聊天中的确认卡片选择允许，或调整请求后重试。`,
      en: `${source} needs confirmation before continuing. Approve it in the chat card, or adjust the request and retry.`,
    });
  }

  if (has(/system directory is reserved|系统保留目录|teamaligned 系统保留|\.teamaligned/)) {
    return base({
      zh: `${source} 试图访问 TeamAligned 系统保留目录。请改用普通 workspace 路径，不要读取或写入 .teamaligned。`,
      en: `${source} tried to access a TeamAligned system-reserved directory. Use a normal workspace path instead of .teamaligned.`,
    });
  }

  if (has(/oauth|authorize|authorization|unauthorized|401|403|permission|权限|鉴权|授权/)) {
    return base({
      zh: `${source} 的授权或权限不可用。请在扩展页重新授权，或检查 API Key / OAuth 权限后重试。`,
      en: `${source} does not have valid authorization or permissions. Re-authorize it in Extensions, or check the API Key / OAuth scopes and retry.`,
    });
  }

  if (has(/超出允许范围|outside|not inside|path.*allow|allowed range/)) {
    return base({
      zh: `${source} 试图访问当前 workspace 之外的路径。请改用 workspace 内路径、上传附件，或通过 # 引用文件。`,
      en: `${source} tried to access a path outside the current workspace. Use a workspace path, upload the file, or reference it with #.`,
    });
  }

  if (toolName === "run_workspace_command" || has(/command not found|exit code|spawn|shell|zsh/)) {
    if (has(/command not found|enoent|spawn .* enoent/)) {
      return base({
        zh: `${source} 要执行的命令不可用。请确认依赖已安装，或让 Agent 先检查 package scripts / PATH。`,
        en: `${source} tried to run a command that is not available. Install the dependency, or ask the Agent to inspect package scripts / PATH first.`,
      });
    }
    return base({
      zh: `${source} 命令执行失败。请检查命令、依赖和当前工作目录；必要时先运行更小的诊断命令。`,
      en: `${source} command execution failed. Check the command, dependencies, and current working directory; run a smaller diagnostic command if needed.`,
    });
  }

  if (has(/不存在|not found|no such file|enoent|目标不是文件|目标不是目录/)) {
    return base({
      zh: `${source} 找不到目标文件或目录。请确认路径是否存在，或先让 Agent 列目录 / 使用 # 选择文件。`,
      en: `${source} could not find the target file or directory. Check the path, or ask the Agent to list files / select one with # first.`,
    });
  }

  if (has(/eacces|permission denied|operation not permitted|eperm/)) {
    return base({
      zh: `${source} 没有足够的本地文件权限。请检查文件权限、工作目录，或换到可写的 workspace 路径后重试。`,
      en: `${source} does not have enough local file permissions. Check file permissions, the working directory, or retry inside a writable workspace path.`,
    });
  }

  if (has(/timeout|timed out|aborted|aborterror|etimedout|超时/)) {
    return base({
      zh: `${source} 执行超时。请稍后重试；如果是 MCP 或网络工具，请先做健康检查或重新连接。`,
      en: `${source} timed out. Try again later; for MCP or web tools, run a health check or reconnect first.`,
    });
  }

  if (toolName === "web_fetch" || toolName === "web_search" || has(/fetch failed|enotfound|econnreset|econnrefused|network|dns|http|url/)) {
    if (has(/only http|http\(s\)|invalid url|unsupported protocol|非 http/)) {
      return base({
        zh: `${source} 只支持 http(s) 网页地址。请换成完整的 https:// 链接后重试。`,
        en: `${source} only supports http(s) URLs. Use a full https:// link and retry.`,
      });
    }
    return base({
      zh: `${source} 网络请求失败。请确认链接可访问、网络正常，或稍后重试。`,
      en: `${source} failed during a network request. Check that the link is reachable and the network is available, then retry.`,
    });
  }

  return base({
    zh: `${source} 执行失败。可以重试，或补充更具体的上下文让 Agent 换一种方式处理。`,
    en: `${source} failed. You can retry, or provide more specific context so the Agent can use another approach.`,
  });
}

function isInsideRoot(targetPath: string, rootPath: string) {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`));
}

function resolveAllowedPath(
  inputPath: string,
  allowedRoots: string[],
  defaultRoot: string,
  options: {
    reservedWorkspaceRoot?: string;
    reservedBypassRoots?: string[];
  } = {},
) {
  const candidate = inputPath.trim();
  const resolved = candidate.startsWith("/")
    ? resolve(candidate)
    : resolve(defaultRoot, candidate.length > 0 ? candidate : ".");

  if (!allowedRoots.some((root) => isInsideRoot(resolved, resolve(root)))) {
    throw new Error("访问路径超出允许范围。");
  }

  if (
    options.reservedWorkspaceRoot &&
    isReservedWorkspacePath(resolved, options.reservedWorkspaceRoot)
  ) {
    const bypassAllowed = (options.reservedBypassRoots ?? []).some((root) =>
      isInsideRoot(resolved, resolve(root)),
    );
    if (!bypassAllowed) {
      throw new Error(createReservedWorkspacePathError("zh"));
    }
  }

  return resolved;
}

function commandMentionsReservedWorkspaceDirectory(command: string) {
  return reservedWorkspaceDirNames.some((dirName) => {
    const escaped = dirName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[\\s"'./])${escaped}($|[\\s"'/])`).test(command);
  });
}

function filterReservedWorkspaceSearchOutput(output: string, workspaceRoot: string) {
  return output
    .split("\n")
    .filter((line) => {
      const match = line.match(/^(.+?):\d+:/);
      if (!match) return true;
      const matchedPath = match[1] ?? "";
      const absolutePath = matchedPath.startsWith("/")
        ? matchedPath
        : resolve(workspaceRoot, matchedPath);
      return !isReservedWorkspacePath(absolutePath, workspaceRoot);
    })
    .join("\n");
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

function getSkillLabel(skill: SkillCatalogRecord) {
  return skill.displayName || skill.name || skill.slug || skill.id;
}

function normalizeSkillKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizeAvailableSkills(skills: SkillCatalogRecord[] | undefined) {
  const byId = new Map<string, SkillCatalogRecord>();
  for (const skill of skills ?? []) {
    if (!skill.installed) continue;
    if (!isSystemBuiltinSkill(skill) && !skill.installPath) continue;
    byId.set(skill.id, skill);
  }
  return Array.from(byId.values()).sort((left, right) =>
    getSkillLabel(left).localeCompare(getSkillLabel(right)),
  );
}

function findAvailableSkill(skills: SkillCatalogRecord[], value: string) {
  const expected = normalizeSkillKey(value);
  return (
    skills.find((skill) =>
      [skill.id, skill.slug, skill.name, skill.displayName]
        .filter(Boolean)
        .map(normalizeSkillKey)
        .includes(expected),
    ) ?? null
  );
}

function readSkillDefinition(skill: SkillCatalogRecord) {
  if (isSystemBuiltinSkill(skill)) {
    return TEAMALIGNED_ASSISTANT_SKILL_DEFINITION;
  }
  if (!skill.installPath) {
    throw new Error(`Skill ${getSkillLabel(skill)} 尚未安装。`);
  }
  const skillRoot = resolve(skill.installPath);
  const entryPath = resolveAllowedPath(skill.entryFile || "SKILL.md", [skillRoot], skillRoot);
  if (!existsSync(entryPath)) {
    throw new Error(`Skill 入口文件不存在：${skill.entryFile || "SKILL.md"}`);
  }
  return readFileSync(entryPath, "utf8");
}

function listSkillTopLevelFiles(skill: SkillCatalogRecord) {
  if (isSystemBuiltinSkill(skill) || !skill.installPath || !existsSync(skill.installPath)) {
    return "file SKILL.md";
  }
  return listDirEntries(skill.installPath);
}

function readSkillRelativeFile(skill: SkillCatalogRecord, relativePath: string | undefined) {
  const requestedPath = relativePath?.trim() || skill.entryFile || "SKILL.md";
  if (isSystemBuiltinSkill(skill)) {
    if (requestedPath === "SKILL.md" || requestedPath === skill.entryFile) {
      return TEAMALIGNED_ASSISTANT_SKILL_DEFINITION;
    }
    throw new Error("系统内置 TeamAligned Assistant Skill 只提供 SKILL.md。");
  }
  if (!skill.installPath) {
    throw new Error(`Skill ${getSkillLabel(skill)} 尚未安装。`);
  }
  const skillRoot = resolve(skill.installPath);
  const targetPath = resolveAllowedPath(requestedPath, [skillRoot], skillRoot);
  if (!existsSync(targetPath)) {
    throw new Error(`Skill 文件不存在：${requestedPath}`);
  }
  const stats = statSync(targetPath);
  if (stats.isDirectory()) {
    return `目录：${targetPath}\n\n${listDirEntries(targetPath) || "目录为空。"}`;
  }
  if (!stats.isFile()) {
    throw new Error(`Skill 路径不是文件：${requestedPath}`);
  }
  return trimText(readFileSync(targetPath, "utf8"), MAX_TEXT_READ);
}

function formatSkillCatalogSummary(input: {
  skills: SkillCatalogRecord[];
  activeSkill: SkillCatalogRecord | null;
  language: RuntimeLanguage;
}) {
  if (input.skills.length === 0) {
    return byLanguage(input.language, {
      zh: "当前 Agent 没有可用的白名单 Skills。",
      en: "This agent has no allowlisted Skills available.",
    });
  }

  const rows = input.skills
    .slice(0, 24)
    .map((skill) => {
      const description = trimText(skill.description.replace(/\s+/g, " "), 160);
      return `- /${skill.slug} (${skill.id}) — ${getSkillLabel(skill)}: ${description}`;
    })
    .join("\n");
  const active = input.activeSkill ? getSkillLabel(input.activeSkill) : null;

  return byLanguage(input.language, {
    zh: [
      "白名单 Skills 已按标准 Skill 用法接入：不要因为用户没有显式输入 /skill-id 就忽略它们。",
      active ? `当前会话偏好 Skill：${active}。如果任务相关，请优先调用 skill_load 加载完整说明。` : "",
      "可用 Skills（先根据描述判断是否相关，相关时调用 skill_load；需要附属材料时用 skill_read_file；需要脚本时用 skill_run_script）：",
      rows,
    ].filter(Boolean).join("\n"),
    en: [
      "Allowlisted Skills are available with standard progressive disclosure: do not ignore them just because the user did not type /skill-id.",
      active ? `Preferred Skill for this conversation: ${active}. If relevant, call skill_load before using it.` : "",
      "Available Skills (judge relevance from descriptions, call skill_load when relevant, use skill_read_file for bundled references/templates/assets, and skill_run_script for scripts):",
      rows,
    ].filter(Boolean).join("\n"),
  });
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
  const approvalCheck = await ensureOrReturnDenied<T>({
    approvalPolicy: input.approvalPolicy,
    request: input.policyRequest,
    invocation: {
      invocationId: input.invocationId,
      serverId: input.serverId,
      serverName: input.serverName,
      toolName: input.toolName,
      args: input.args,
      onInvocation: input.onInvocation,
    },
  });
  if (approvalCheck.deniedResult !== null) {
    return approvalCheck.deniedResult;
  }
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
  availableSkills?: SkillCatalogRecord[];
  onInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  approvalPolicy?: ToolExecutionPolicy;
}) {
  const workspaceRoot = resolve(input.workspacePath);
  const allowedRoots = [workspaceRoot, ...input.attachmentRoots.map((root) => resolve(root))];
  const reservedPathOptions = {
    reservedWorkspaceRoot: workspaceRoot,
    reservedBypassRoots: input.attachmentRoots,
  };
  const availableSkills = normalizeAvailableSkills([
    ...(input.availableSkills ?? []),
    ...(input.activeSkill ? [input.activeSkill] : []),
  ]);
  const activeSkill = input.activeSkill ? findAvailableSkill(availableSkills, input.activeSkill.id) : null;

  const tools: StructuredToolInterface[] = [
    tool(
      async ({ path }) => {
        const targetPath = resolveAllowedPath(path, allowedRoots, workspaceRoot, reservedPathOptions);
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
              description: "List files in the current workspace or allowed attachment roots.",
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
        description: "列出 workspace 或附件目录中的文件和子目录。Skill 附属文件请使用 skill_read_file。",
        schema: z.object({
          path: z.string().default(".").describe("相对或绝对目录路径。"),
        }),
      },
    ),
    tool(
      async ({ path }) => {
        const targetPath = resolveAllowedPath(path, allowedRoots, workspaceRoot, reservedPathOptions);
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
              description: "Read a text file from the current workspace or allowed attachment roots.",
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
        description: "读取 workspace 或附件目录中的文本文件内容。Skill 附属文件请使用 skill_read_file。",
        schema: z.object({
          path: z.string().describe("相对或绝对文件路径。"),
        }),
      },
    ),
    tool(
      async ({ path, content }) => {
        const targetPath = resolveAllowedPath(path, [workspaceRoot], workspaceRoot, {
          reservedWorkspaceRoot: workspaceRoot,
        });
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
              workspaceScoped: true,
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
            const searchArgs = [
              "--line-number",
              "--hidden",
              "--smart-case",
              ...reservedWorkspaceDirNames.flatMap((dirName) => ["-g", `!${dirName}/**`]),
              pattern,
              workspaceRoot,
            ];
            if (glob?.trim()) {
              searchArgs.unshift("-g", glob.trim());
            }
            try {
              const { stdout, stderr } = await execFileAsync("rg", searchArgs, {
                cwd: workspaceRoot,
                maxBuffer: 1024 * 1024,
              });
              const safeOutput = filterReservedWorkspaceSearchOutput(stdout, workspaceRoot);
              const output = trimText((safeOutput || stderr || "没有搜索结果。").trim(), MAX_SEARCH_OUTPUT);
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
            if (commandMentionsReservedWorkspaceDirectory(command)) {
              throw new Error(createReservedWorkspacePathError(input.responseLanguage));
            }
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

  tools.push(
    tool(
      async () => {
        return withInvocation(
          {
            invocationId: createInvocationId("skill_list"),
            serverId: "teamaligned-skills",
            serverName: "TeamAligned Skills",
            toolName: "skill_list",
            args: {},
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: "teamaligned-skills",
              serverName: "TeamAligned Skills",
              toolName: "skill_list",
              operation: "skill",
              riskLevel: "low",
              args: {},
              description: "List allowlisted Skills available to this agent.",
            },
          },
          async () => {
            if (availableSkills.length === 0) {
              return byLanguage(input.responseLanguage, {
                zh: "当前 Agent 没有可用的白名单 Skills。",
                en: "This agent has no allowlisted Skills available.",
              });
            }
            return JSON.stringify(
              availableSkills.map((skill) => ({
                id: skill.id,
                slug: skill.slug,
                name: getSkillLabel(skill),
                description: skill.description,
                version: skill.installedVersion ?? skill.version,
                entryFile: skill.entryFile || "SKILL.md",
                files: listSkillTopLevelFiles(skill).split("\n").filter(Boolean),
                systemBuiltin: isSystemBuiltinSkill(skill),
              })),
              null,
              2,
            );
          },
          (result) => result,
        );
      },
      {
        name: "skill_list",
        description: byLanguage(input.responseLanguage, {
          zh: "列出当前 Agent 白名单中可按需加载的 Skills。用于先判断哪些 Skill 可能适合当前任务。",
          en: "List allowlisted Skills that can be loaded on demand for this agent.",
        }),
        schema: z.object({}),
      },
    ),
    tool(
      async ({ skillId }) => {
        const skill = findAvailableSkill(availableSkills, skillId);
        return withInvocation(
          {
            invocationId: createInvocationId("skill_load"),
            serverId: skill?.id ?? "teamaligned-skills",
            serverName: skill ? getSkillLabel(skill) : "TeamAligned Skills",
            toolName: "skill_load",
            args: { skillId },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: skill?.id ?? "teamaligned-skills",
              serverName: skill ? getSkillLabel(skill) : "TeamAligned Skills",
              toolName: "skill_load",
              operation: "skill",
              riskLevel: "low",
              args: { skillId },
              description: "Load the full SKILL.md instructions for an allowlisted Skill.",
            },
          },
          async () => {
            if (!skill) {
              throw new Error(`当前 Agent 白名单中没有这个 Skill：${skillId}`);
            }
            return JSON.stringify(
              {
                id: skill.id,
                slug: skill.slug,
                name: getSkillLabel(skill),
                description: skill.description,
                version: skill.installedVersion ?? skill.version,
                entryFile: skill.entryFile || "SKILL.md",
                files: listSkillTopLevelFiles(skill).split("\n").filter(Boolean),
                definition: readSkillDefinition(skill),
              },
              null,
              2,
            );
          },
          (result) => result,
        );
      },
      {
        name: "skill_load",
        description: byLanguage(input.responseLanguage, {
          zh: "按需加载某个白名单 Skill 的完整 SKILL.md。任务与 Skill 描述相关时，即使用户没显式输入 /skill-id 也应调用。",
          en: "Load the full SKILL.md for an allowlisted Skill. Use when the task matches a Skill description, even without explicit /skill-id.",
        }),
        schema: z.object({
          skillId: z.string().describe("Skill 的 id、slug、name 或 displayName。"),
        }),
      },
    ),
    tool(
      async ({ skillId, relativePath }) => {
        const skill = findAvailableSkill(availableSkills, skillId);
        return withInvocation(
          {
            invocationId: createInvocationId("skill_read"),
            serverId: skill?.id ?? "teamaligned-skills",
            serverName: skill ? getSkillLabel(skill) : "TeamAligned Skills",
            toolName: "skill_read_file",
            args: { skillId, relativePath },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: skill?.id ?? "teamaligned-skills",
              serverName: skill ? getSkillLabel(skill) : "TeamAligned Skills",
              toolName: "skill_read_file",
              operation: "skill",
              riskLevel: "low",
              args: { skillId, relativePath },
              description: "Read a bundled reference/template/asset file from an allowlisted Skill.",
            },
          },
          async () => {
            if (!skill) {
              throw new Error(`当前 Agent 白名单中没有这个 Skill：${skillId}`);
            }
            return readSkillRelativeFile(skill, relativePath);
          },
          (result) => result,
        );
      },
      {
        name: "skill_read_file",
        description: byLanguage(input.responseLanguage, {
          zh: "读取白名单 Skill 中的附属文件，例如 references、templates、assets 或 SKILL.md。",
          en: "Read bundled files from an allowlisted Skill, such as references, templates, assets, or SKILL.md.",
        }),
        schema: z.object({
          skillId: z.string().describe("Skill 的 id、slug、name 或 displayName。"),
          relativePath: z.string().describe("Skill 目录内的相对路径，例如 references/checklist.md。"),
        }),
      },
    ),
    tool(
      async ({ skillId, scriptPath, argumentsLine }) => {
        const skill = findAvailableSkill(availableSkills, skillId);
        return withInvocation(
          {
            invocationId: createInvocationId("skill_script"),
            serverId: skill?.id ?? "teamaligned-skills",
            serverName: skill ? getSkillLabel(skill) : "TeamAligned Skills",
            toolName: "skill_run_script",
            args: { skillId, scriptPath, argumentsLine },
            onInvocation: input.onInvocation,
            approvalPolicy: input.approvalPolicy,
            policyRequest: {
              serverId: skill?.id ?? "teamaligned-skills",
              serverName: skill ? getSkillLabel(skill) : "TeamAligned Skills",
              toolName: "skill_run_script",
              operation: "skill",
              riskLevel: "medium",
              args: { skillId, scriptPath, argumentsLine },
              description: "Run a bundled script from an allowlisted Skill.",
            },
          },
          async () => {
            if (!skill) {
              throw new Error(`当前 Agent 白名单中没有这个 Skill：${skillId}`);
            }
            if (isSystemBuiltinSkill(skill)) {
              throw new Error("系统内置 TeamAligned Assistant Skill 不提供可执行脚本。");
            }
            if (!skill.installPath) {
              throw new Error(`Skill ${getSkillLabel(skill)} 尚未安装。`);
            }
            const skillRoot = resolve(skill.installPath);
            const scriptsRoot = resolve(skillRoot, "scripts");
            const normalizedScriptPath = scriptPath.trim().startsWith("scripts/")
              ? scriptPath.trim().slice("scripts/".length)
              : scriptPath.trim();
            const targetScript = resolveAllowedPath(normalizedScriptPath, [scriptsRoot], scriptsRoot);
            if (!existsSync(targetScript)) {
              throw new Error(`Skill 脚本不存在：${scriptPath}`);
            }
            const stats = statSync(targetScript);
            if (!stats.isFile()) {
              throw new Error(`Skill 脚本路径不是文件：${scriptPath}`);
            }
            const interpreter = detectScriptInterpreter(targetScript);
            if (!interpreter) {
              throw new Error(`不支持的 Skill 脚本类型：${scriptPath}`);
            }
            const command = `${interpreter} "${targetScript}" ${argumentsLine?.trim() || ""}`.trim();
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
        name: "skill_run_script",
        description: byLanguage(input.responseLanguage, {
          zh: "执行白名单 Skill 的 scripts/ 目录内脚本。用于 Skill 明确要求脚本辅助完成任务时。",
          en: "Run a script from an allowlisted Skill's scripts/ directory when the Skill calls for it.",
        }),
        schema: z.object({
          skillId: z.string().describe("Skill 的 id、slug、name 或 displayName。"),
          scriptPath: z.string().describe("scripts/ 内脚本路径，例如 analyze.py 或 scripts/analyze.py。"),
          argumentsLine: z
            .string()
            .optional()
            .describe("直接传给脚本的一整行参数，例如 --design-system -p \"Project Name\"。"),
        }),
      },
    ),
  );

  return {
    tools,
    summary: [
      byLanguage(input.responseLanguage, {
        zh: "Workspace 文件、搜索、命令与网页工具（web_search / web_fetch）已可用。",
        en: "Workspace file/search/command tools and web tools (web_search / web_fetch) are available.",
      }),
      formatSkillCatalogSummary({
        skills: availableSkills,
        activeSkill,
        language: input.responseLanguage,
      }),
    ].join("\n\n"),
  };
}
