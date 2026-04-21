import { createDeepAgent, FilesystemBackend } from "deepagents";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import type {
  AgentRecord,
  McpCatalogRecord,
  McpConnectionRecord,
  ProviderConfig,
  TeamContext,
  TeamRecord,
  UserProfile,
} from "@teamaligned/shared";
import {
  createProviderModel,
  extractAgentText,
  normalizeMessageContent,
} from "./deep-agent.ts";
import { buildMcpLangChainTools, type McpInvocationEvent } from "./mcp-tools.ts";

export const TEAM_MEMBER_LIMIT = 5;
export const MAX_AGENT_MESSAGES_PER_TURN = 10;
export const MAX_AGENT_WORK_ITEMS = 5;
export const MAX_TEAM_TURN_MESSAGES = 50;
export const MAX_TEAM_SUBROUNDS = 5;
export const MAX_PARALLEL_TEAM_EXECUTIONS = 5;

export type NaturalTeamMode = "focused" | "multi_voice" | "collaboration";

export type NaturalTeamSpeakerSelection = {
  mode: NaturalTeamMode;
  speakers: AgentRecord[];
  reason: string;
  activeTask: string;
  nextPhase: string;
  decision: string;
};

export type NaturalTeamAgentMessage = {
  speaker: AgentRecord;
  kind: "reply" | "suggestion" | "question" | "handoff" | "result";
  content: string;
  mentions: string[];
  roundIndex: number;
};

export type TeamExecutionWorkItem = {
  id: string;
  owner: AgentRecord;
  summary: string;
  kickoffMessage: string;
  readTargets: string[];
  writeTargets: string[];
  dependsOnAgentIds: string[];
  canRunInParallel: boolean;
};

export type TeamExecutionPlan = {
  reason: string;
  activeTask: string;
  nextPhase: string;
  decision: string;
  workItems: TeamExecutionWorkItem[];
};

const executionPlanSchema = z.object({
  shouldExecute: z.boolean().default(false),
  reason: z.string().default(""),
  activeTask: z.string().default(""),
  nextPhase: z.string().default(""),
  decision: z.string().default(""),
  workItems: z
    .array(
      z.object({
        ownerAgentId: z.string(),
        summary: z.string().default(""),
        kickoffMessage: z.string().default(""),
        readTargets: z.array(z.string()).max(8).default([]),
        writeTargets: z.array(z.string()).max(8).default([]),
        dependsOnAgentIds: z.array(z.string()).max(5).default([]),
        canRunInParallel: z.boolean().default(true),
      }),
    )
    .max(TEAM_MEMBER_LIMIT * MAX_AGENT_WORK_ITEMS)
    .default([]),
});

const naturalSelectionSchema = z.object({
  mode: z.enum(["focused", "multi_voice", "collaboration"]).default("focused"),
  speakerIds: z.array(z.string()).max(TEAM_MEMBER_LIMIT).default([]),
  reason: z.string().default(""),
  activeTask: z.string().default(""),
  nextPhase: z.string().default(""),
  decision: z.string().default(""),
});

const naturalAgentReplySchema = z.object({
  shouldSpeak: z.boolean().default(true),
  kind: z.enum(["reply", "suggestion", "question", "handoff", "result"]).default("reply"),
  content: z.string().default(""),
  nextSpeakerIds: z.array(z.string()).max(TEAM_MEMBER_LIMIT).default([]),
});

function compact(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function buildRecentHistory(history: string[]) {
  if (history.length === 0) {
    return "最近没有可参考的公开对话。";
  }

  return history.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

function buildContextText(team: TeamRecord, context: TeamContext) {
  return [
    `群组：${team.name}`,
    `群组目标：${team.objective}`,
    `当前阶段：${context.phase}`,
    `约束：${context.constraints.join("；") || "无"}`,
    `当前任务：${context.activeTasks.join("；") || "无"}`,
    `最近决策：${context.recentDecisions.join("；") || "无"}`,
    `Pinned Artifacts：${context.pinnedArtifacts.join("；") || "无"}`,
    `Workspace 摘要：${context.workspaceSummary || "无"}`,
  ].join("\n");
}

function selectPublicHistory(history: { senderName: string; visibility: string; content: string }[]) {
  return history
    .filter((message) => message.visibility === "public")
    .slice(-8)
    .map((message) => `${message.senderName}：${compact(message.content)}`);
}

function buildNaturalRoster(members: AgentRecord[]) {
  if (members.length === 0) {
    return "当前群组没有可发言的 Agent。";
  }

  return members
    .map(
      (agent) =>
        `- id=${agent.id} | name=${agent.name} | role=${agent.role} | capabilities=${agent.capabilities.join("、") || "未设置"}`,
    )
    .join("\n");
}

function clampSpeakersForMode(input: {
  mode: NaturalTeamMode;
  speakers: AgentRecord[];
  members: AgentRecord[];
}) {
  const max =
    input.mode === "focused" ? 2 : input.mode === "multi_voice" ? 4 : TEAM_MEMBER_LIMIT;
  let speakers = input.speakers.slice(0, max);

  if (input.mode === "collaboration" && speakers.length < Math.min(3, input.members.length)) {
    const existingIds = new Set(speakers.map((agent) => agent.id));
    speakers = [
      ...speakers,
      ...input.members.filter((agent) => !existingIds.has(agent.id)),
    ].slice(0, Math.min(TEAM_MEMBER_LIMIT, input.members.length));
  }

  return speakers;
}

function selectFallbackSpeakers(input: {
  members: AgentRecord[];
  explicitMentionIds: string[];
  userInput: string;
}) {
  const memberMap = new Map(input.members.map((agent) => [agent.id, agent]));
  const explicit = input.explicitMentionIds
    .map((id) => memberMap.get(id))
    .filter((item): item is AgentRecord => item !== undefined);

  if (explicit.length > 0) {
    const mode: NaturalTeamMode =
      explicit.length >= 3 ? "collaboration" : explicit.length === 2 ? "multi_voice" : "focused";
    return {
      mode,
      speakers: explicit.slice(0, TEAM_MEMBER_LIMIT),
      reason: "用户显式 @ 了这些 Agent。",
    };
  }

  const normalized = input.userInput.toLowerCase();
  const scored = input.members.map((agent) => {
    const haystack = `${agent.name} ${agent.role} ${agent.capabilities.join(" ")}`.toLowerCase();
    let score = 0;
    for (const token of normalized.split(/\s+|，|。|,|\.|；|;|：|:/).filter(Boolean)) {
      if (token.length >= 2 && haystack.includes(token)) score += 2;
    }
    if (/ui|ux|设计|界面|视觉|交互|figma/.test(normalized) && /设计|ui|ux|designer/.test(haystack)) score += 5;
    if (/代码|实现|开发|bug|报错|构建|electron|react|typescript|node/.test(normalized) && /开发|代码|coder|工程|前端|后端/.test(haystack)) score += 5;
    if (/测试|质量|验证|回归|用例/.test(normalized) && /测试|质量|qa|tester/.test(haystack)) score += 5;
    if (/计划|拆解|规划|优先级|路线|todo/.test(normalized) && /计划|项目|planner|经理|pm/.test(haystack)) score += 5;
    if (/数据|分析|指标|统计|图表/.test(normalized) && /数据|分析|analyst|nova/.test(haystack)) score += 5;
    if (/研究|调研|竞品|资料|搜索/.test(normalized) && /研究|调研|research/.test(haystack)) score += 5;
    return { agent, score };
  });

  const complex = /大家|一起|讨论|脑暴|brainstorm|多角度|分工|协作|分别|评审|review/.test(normalized);
  const mode: NaturalTeamMode = complex ? "collaboration" : "focused";
  const take = complex ? Math.min(TEAM_MEMBER_LIMIT, input.members.length) : Math.min(2, input.members.length);
  return {
    mode,
    speakers: scored
      .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name, "zh-Hans-CN"))
      .map((item) => item.agent)
      .slice(0, take),
    reason: complex ? "用户表达了多 Agent 协作意图。" : "根据角色和能力选择最相关 Agent。",
  };
}

function extractMentionedAgentIds(content: string, members: AgentRecord[]) {
  const names = [...content.matchAll(/@([\w\u4e00-\u9fa5-]+)/g)].map((item) => item[1].toLowerCase());
  return members
    .filter((agent) => names.includes(agent.name.toLowerCase()))
    .map((agent) => agent.id);
}

function normalizeTargetPath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function pathOverlaps(left: string, right: string) {
  const a = normalizeTargetPath(left);
  const b = normalizeTargetPath(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function isExecutionIntent(userInput: string) {
  return /开始做|开始改|直接改|帮我做|实现|修复|写代码|创建文件|新建文件|改一下|落地|重构|执行|build|implement|fix|create|write|refactor|update|设计页面|设计一个|做个页面|做一个页面|做静态网页|静态网页|原型|线框图|设计稿|页面结构|页面布局/.test(
    userInput.toLowerCase(),
  );
}

function createEphemeralWorker(input: {
  name: string;
  provider: ProviderConfig;
  workspacePath: string;
  systemPrompt: string;
  memoryPaths?: string[];
  mcpServers?: McpCatalogRecord[];
  mcpConnections?: McpConnectionRecord[];
  onMcpInvocation?: (event: McpInvocationEvent) => void | Promise<void>;
  additionalTools?: StructuredToolInterface[];
}) {
  const tools = buildMcpLangChainTools({
    servers: input.mcpServers ?? [],
    connectionsById: new Map((input.mcpConnections ?? []).map((connection) => [connection.serverId, connection])),
    workspacePath: input.workspacePath,
    onInvocation: input.onMcpInvocation,
  });
  return createDeepAgent({
    name: input.name,
    model: createProviderModel(input.provider),
    systemPrompt: input.systemPrompt,
    tools: [...(input.additionalTools ?? []), ...tools],
    backend: new FilesystemBackend({
      rootDir: input.workspacePath,
      virtualMode: true,
    }),
    checkpointer: new MemorySaver(),
    memory: input.memoryPaths ?? [],
  });
}

async function invokeWorkerText(input: {
  name: string;
  provider: ProviderConfig;
  workspacePath: string;
  systemPrompt: string;
  message: string;
  threadId: string;
  memoryPaths?: string[];
  mcpServers?: McpCatalogRecord[];
  mcpConnections?: McpConnectionRecord[];
  onMcpInvocation?: (event: McpInvocationEvent) => void | Promise<void>;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  additionalTools?: StructuredToolInterface[];
}) {
  const worker = createEphemeralWorker(input);
  const messages = [{ role: "user" as const, content: input.message }];

  if (
    input.provider.supportsStreaming &&
    input.onTextStream &&
    typeof (worker as { streamEvents?: unknown }).streamEvents === "function"
  ) {
    try {
      let streamedText = "";
      let finalOutput: unknown = null;
      const stream = await (worker as {
        streamEvents: (
          input: unknown,
          options?: Record<string, unknown>,
        ) => Promise<AsyncIterable<Record<string, unknown>>> | AsyncIterable<Record<string, unknown>>;
      }).streamEvents(
        { messages },
        { configurable: { thread_id: input.threadId }, version: "v2" },
      );

      for await (const event of stream) {
        if (!event || typeof event !== "object") continue;
        if (event.event === "on_chat_model_stream") {
          const chunk =
            "data" in event && event.data && typeof event.data === "object" && "chunk" in event.data
              ? event.data.chunk
              : null;
          const delta = extractStreamText(chunk);
          if (!delta) continue;
          streamedText += delta;
          await input.onTextStream(streamedText, delta);
          continue;
        }

        if (event.event === "on_chain_end" || event.event === "on_graph_end") {
          finalOutput =
            "data" in event && event.data && typeof event.data === "object" && "output" in event.data
              ? event.data.output
              : finalOutput;
        }
      }

      const finalText = extractAgentText(finalOutput) || streamedText.trim();
      if (finalText) {
        return finalText;
      }
    } catch {
      // Fallback to non-streaming invoke below.
    }
  }

  const result = await worker.invoke({ messages }, { configurable: { thread_id: input.threadId } });
  return extractAgentText(result) || normalizeMessageContent(result) || "模型已完成调用，但没有返回可显示的文本内容。";
}

function extractStreamText(chunk: unknown) {
  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  if ("content" in chunk) {
    return normalizeMessageContent(chunk.content);
  }

  if ("text" in chunk && typeof chunk.text === "string") {
    return chunk.text;
  }

  return "";
}

export async function selectNaturalTeamSpeakers(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  members: AgentRecord[];
  profile: UserProfile;
  context: TeamContext;
  history: { senderName: string; visibility: string; content: string }[];
  userInput: string;
  explicitMentionIds: string[];
  mcpServers: McpCatalogRecord[];
}) {
  const cappedMembers = input.members.slice(0, TEAM_MEMBER_LIMIT);
  const fallback = selectFallbackSpeakers({
    members: cappedMembers,
    explicitMentionIds: input.explicitMentionIds,
    userInput: input.userInput,
  });

  if (cappedMembers.length === 0) {
    return {
      mode: "focused",
      speakers: [],
      reason: "群组没有可用成员。",
      activeTask: "",
      nextPhase: "",
      decision: "",
    } satisfies NaturalTeamSpeakerSelection;
  }

  if (input.explicitMentionIds.length > 0) {
    return {
      mode: fallback.mode,
      speakers: clampSpeakersForMode({
        mode: fallback.mode,
        speakers: fallback.speakers,
        members: cappedMembers,
      }),
      reason: fallback.reason,
      activeTask: compact(input.userInput),
      nextPhase: "",
      decision: "",
    } satisfies NaturalTeamSpeakerSelection;
  }

  try {
    const model = createProviderModel(input.provider).withStructuredOutput(naturalSelectionSchema);
    const result = naturalSelectionSchema.parse(
      await model.invoke([
        "你是 teamaligned 群聊中的不可见 system orchestrator。",
        "你的任务不是作为群成员发言，而是选择本轮应该发言的 Agent。",
        "请让群聊像真实人类群聊一样自然：该谁说谁说，没必要全员发言。",
        `群组最多激活 ${TEAM_MEMBER_LIMIT} 个 Agent。`,
        "普通问题选择 1 到 2 个 Agent；多视角问题选择 2 到 4 个 Agent；明确脑暴、分工、复杂协作选择 3 到 5 个 Agent。",
        "如果某个 Agent 没有明显贡献，不要选择它。",
        "",
        "模式定义：focused / multi_voice / collaboration。",
        "",
        "当前用户资料：",
        `- 姓名：${input.profile.name}`,
        `- 角色：${input.profile.role || "未设置"}`,
        `- 团队：${input.profile.team || "未设置"}`,
        "",
        "群组上下文：",
        buildContextText(input.team, input.context),
        "",
        "Agent roster：",
        buildNaturalRoster(cappedMembers),
        "",
        `当前可用 MCP 服务：${input.mcpServers.map((server) => server.name).join("、") || "无"}`,
        "",
        "最近公开对话：",
        buildRecentHistory(selectPublicHistory(input.history)),
        "",
        "用户最新输入：",
        input.userInput,
        "",
        "输出要求：",
        "- 你必须返回一个合法的 JSON 对象（json object），不要输出 markdown，不要输出额外解释",
        "- speakerIds 必须来自 roster id",
      ].join("\n")),
    );

    const memberMap = new Map(cappedMembers.map((agent) => [agent.id, agent]));
    const rawSpeakers = result.speakerIds
      .map((id) => memberMap.get(id))
      .filter((item): item is AgentRecord => item !== undefined);
    const speakers = rawSpeakers.length > 0 ? rawSpeakers : fallback.speakers;
    const mode = result.mode ?? fallback.mode;

    return {
      mode,
      speakers: clampSpeakersForMode({ mode, speakers, members: cappedMembers }),
      reason: compact(result.reason) || fallback.reason,
      activeTask: compact(result.activeTask ?? ""),
      nextPhase: compact(result.nextPhase ?? ""),
      decision: compact(result.decision ?? ""),
    } satisfies NaturalTeamSpeakerSelection;
  } catch {
    return {
      mode: fallback.mode,
      speakers: clampSpeakersForMode({
        mode: fallback.mode,
        speakers: fallback.speakers,
        members: cappedMembers,
      }),
      reason: fallback.reason,
      activeTask: compact(input.userInput),
      nextPhase: "",
      decision: "",
    } satisfies NaturalTeamSpeakerSelection;
  }
}

function buildFallbackExecutionPlan(input: {
  members: AgentRecord[];
  explicitMentionIds: string[];
  userInput: string;
}) {
  const fallback = selectFallbackSpeakers(input);
  const owners = fallback.speakers.slice(0, MAX_PARALLEL_TEAM_EXECUTIONS);
  const workItems = owners.map((owner, index) => ({
    id: `work-${index + 1}`,
    owner,
    summary: `处理“${compact(input.userInput)}”中与 ${owner.role} 相关的部分`,
    kickoffMessage: index === 0 ? "我先开始处理这个部分。" : "我这边也同步处理一部分。",
    readTargets: [],
    writeTargets: [],
    dependsOnAgentIds: [],
    canRunInParallel: true,
  }));

  return {
    reason: input.explicitMentionIds.length > 0 ? "用户明确要求相关 Agent 直接开始执行。" : "用户表达了明确的执行意图。",
    activeTask: compact(input.userInput),
    nextPhase: "执行中",
    decision: "启动第一版群聊执行模式。",
    workItems,
  } satisfies TeamExecutionPlan;
}

export async function planTeamExecution(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  members: AgentRecord[];
  profile: UserProfile;
  context: TeamContext;
  history: { senderName: string; visibility: string; content: string }[];
  userInput: string;
  explicitMentionIds: string[];
  mcpServers: McpCatalogRecord[];
}) {
  const cappedMembers = input.members.slice(0, TEAM_MEMBER_LIMIT);
  if (!isExecutionIntent(input.userInput)) {
    return null;
  }

  const fallback = buildFallbackExecutionPlan({
    members: cappedMembers,
    explicitMentionIds: input.explicitMentionIds,
    userInput: input.userInput,
  });

  if (input.explicitMentionIds.length > 0) {
    return fallback;
  }

  try {
    const model = createProviderModel(input.provider).withStructuredOutput(executionPlanSchema);
    const result = executionPlanSchema.parse(
      await model.invoke([
        "你是 teamaligned 群聊中的不可见 system orchestrator。",
        "你的任务是判断这条用户消息是否应该进入执行模式，并把任务拆成可执行 work items。",
        "系统支持并行和串行执行，但必须避免文件冲突和无意义并行。",
        `群组最多 ${TEAM_MEMBER_LIMIT} 个成员，同时最多 ${MAX_PARALLEL_TEAM_EXECUTIONS} 个 work item 并行执行。`,
        "",
        "执行模式规则：",
        "- 只有明确要实现、修改、创建、修复、落地、写代码时才 shouldExecute=true",
        "- work item 应尽量让不同角色处理不同文件或不同分工",
        "- 如果任务依赖另一个 Agent 的输出，请填写 dependsOnAgentIds",
        "- 如果两个任务可能修改相同文件，请把 canRunInParallel 设为 false",
        "- writeTargets 和 readTargets 尽量使用 workspace 相对路径",
        `- 每个 Agent 最多 ${MAX_AGENT_WORK_ITEMS} 个 work item`,
        "",
        "当前用户资料：",
        `- 姓名：${input.profile.name}`,
        `- 角色：${input.profile.role || "未设置"}`,
        "",
        "群组上下文：",
        buildContextText(input.team, input.context),
        "",
        "Agent roster：",
        buildNaturalRoster(cappedMembers),
        "",
        `当前可用 MCP 服务：${input.mcpServers.map((server) => server.name).join("、") || "无"}`,
        "",
        "最近公开对话：",
        buildRecentHistory(selectPublicHistory(input.history)),
        "",
        "用户最新输入：",
        input.userInput,
        "",
        `用户显式提及的成员 id：${input.explicitMentionIds.join("、") || "无"}`,
        "",
        "输出要求：",
        "- 你必须返回一个合法的 JSON 对象（json object），不要输出 markdown，不要输出额外解释",
        "- ownerAgentId 必须来自 roster id",
      ].join("\n")),
    );

    if (!result.shouldExecute || result.workItems.length === 0) {
      return null;
    }

    const memberMap = new Map(cappedMembers.map((agent) => [agent.id, agent]));
    const ownerCounts = new Map<string, number>();
    const workItems: TeamExecutionWorkItem[] = [];
    for (const [index, item] of result.workItems.entries()) {
      const owner = memberMap.get(item.ownerAgentId);
      if (!owner) continue;
      const currentCount = ownerCounts.get(owner.id) ?? 0;
      if (currentCount >= MAX_AGENT_WORK_ITEMS) continue;
      ownerCounts.set(owner.id, currentCount + 1);
      workItems.push({
        id: `work-${index + 1}`,
        owner,
        summary: compact(item.summary) || `处理与 ${owner.role} 相关的部分`,
        kickoffMessage: compact(item.kickoffMessage) || `我来处理和 ${owner.role} 相关的部分。`,
        readTargets: item.readTargets.map(normalizeTargetPath).filter(Boolean),
        writeTargets: item.writeTargets.map(normalizeTargetPath).filter(Boolean),
        dependsOnAgentIds: item.dependsOnAgentIds.filter((id) => memberMap.has(id)),
        canRunInParallel: item.canRunInParallel,
      });
    }

    if (workItems.length === 0) {
      return fallback;
    }

    return {
      reason: compact(result.reason) || fallback.reason,
      activeTask: compact(result.activeTask) || fallback.activeTask,
      nextPhase: compact(result.nextPhase) || "执行中",
      decision: compact(result.decision) || fallback.decision,
      workItems,
    } satisfies TeamExecutionPlan;
  } catch {
    return fallback;
  }
}

function workItemsConflict(left: TeamExecutionWorkItem, right: TeamExecutionWorkItem) {
  if (!left.canRunInParallel || !right.canRunInParallel) {
    return true;
  }
  if (left.dependsOnAgentIds.includes(right.owner.id) || right.dependsOnAgentIds.includes(left.owner.id)) {
    return true;
  }
  const leftWrites = left.writeTargets;
  const rightWrites = right.writeTargets;
  const leftReads = left.readTargets;
  const rightReads = right.readTargets;

  return (
    leftWrites.some((target) => rightWrites.some((other) => pathOverlaps(target, other))) ||
    leftWrites.some((target) => rightReads.some((other) => pathOverlaps(target, other))) ||
    rightWrites.some((target) => leftReads.some((other) => pathOverlaps(target, other)))
  );
}

export function buildExecutionBatches(workItems: TeamExecutionWorkItem[]) {
  const pending = [...workItems];
  const batches: TeamExecutionWorkItem[][] = [];

  while (pending.length > 0) {
    const batch: TeamExecutionWorkItem[] = [];
    const nextPending: TeamExecutionWorkItem[] = [];

    for (const item of pending) {
      const completedOwners = new Set(batches.flatMap((batch) => batch.map((workItem) => workItem.owner.id)));
      const depsSatisfied = item.dependsOnAgentIds.every((id) => completedOwners.has(id));
      const conflicts = batch.some((existing) => workItemsConflict(existing, item));
      if (depsSatisfied && !conflicts && batch.length < MAX_PARALLEL_TEAM_EXECUTIONS) {
        batch.push(item);
      } else {
        nextPending.push(item);
      }
    }

    if (batch.length === 0) {
      batch.push(nextPending.shift()!);
    }
    batches.push(batch);
    pending.splice(0, pending.length, ...nextPending);
  }

  return batches;
}

export async function executeNaturalTeamWorkItem(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  workItem: TeamExecutionWorkItem;
  members: AgentRecord[];
  profile: UserProfile;
  context: TeamContext;
  userInput: string;
  workspacePath: string;
  conversationId: string;
  runId: string;
  previousOutputs: string[];
  mcpServers: McpCatalogRecord[];
  mcpConnections: McpConnectionRecord[];
  onMcpInvocation?: (event: McpInvocationEvent) => void | Promise<void>;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  additionalTools?: StructuredToolInterface[];
}) {
  const systemPrompt = [
    `你是 ${input.team.name} 群聊中的成员 ${input.workItem.owner.name}。`,
    `你的角色：${input.workItem.owner.role}。`,
    `你的能力：${input.workItem.owner.capabilities.join("、") || "未设置"}。`,
    "当前已经进入执行模式，请真正完成分配给你的工作，而不是只讨论。",
    "你可以使用已经注入的文件、搜索、命令和 MCP 工具。",
    "请只在当前 workspace 内工作。",
    "如果任务无法执行，请明确说明阻塞原因。",
    "",
    "本次 work item：",
    `- 摘要：${input.workItem.summary}`,
    `- 读取范围：${input.workItem.readTargets.join("、") || "未指定"}`,
    `- 写入范围：${input.workItem.writeTargets.join("、") || "未指定"}`,
    `- 并行：${input.workItem.canRunInParallel ? "可并行" : "需要串行"}`,
    "",
    "群组上下文：",
    buildContextText(input.team, input.context),
    "",
    "本轮其他执行结果：",
    input.previousOutputs.length > 0 ? input.previousOutputs.join("\n\n") : "暂无",
  ].join("\n");

  const message = [
    `用户原始请求：${input.userInput}`,
    `你需要执行的任务：${input.workItem.summary}`,
    "请直接执行，并在完成后用自然群聊口吻汇报：做了什么、结果是什么、如果改了文件请简要提及。",
  ].join("\n");

  return invokeWorkerText({
    name: input.workItem.owner.name,
    provider: input.provider,
    workspacePath: input.workspacePath,
    systemPrompt,
    message,
    threadId: `${input.conversationId}:${input.runId}:${input.workItem.owner.id}:execution`,
    memoryPaths: ["/memory/MEMORY.md"],
    mcpServers: input.mcpServers,
    mcpConnections: input.mcpConnections,
    onMcpInvocation: input.onMcpInvocation,
    onTextStream: input.onTextStream,
    additionalTools: input.additionalTools,
  });
}

export async function generateNaturalTeamAgentMessage(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  speaker: AgentRecord;
  members: AgentRecord[];
  profile: UserProfile;
  context: TeamContext;
  mode: NaturalTeamMode;
  userInput: string;
  roundIndex: number;
  previousTurnMessages: NaturalTeamAgentMessage[];
  workspacePath: string;
  conversationId: string;
  runId: string;
  isFinalSpeaker: boolean;
  mcpServers: McpCatalogRecord[];
  mcpConnections: McpConnectionRecord[];
  onMcpInvocation?: (event: McpInvocationEvent) => void | Promise<void>;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  additionalTools?: StructuredToolInterface[];
}) {
  const previousText =
    input.previousTurnMessages.length > 0
      ? input.previousTurnMessages
          .map((message) => `${message.speaker.name}：${message.content}`)
          .join("\n")
      : "本轮还没有其他 Agent 发言。";
  const systemPrompt = [
    `你是 ${input.team.name} 群聊中的成员 ${input.speaker.name}。`,
    `你的角色：${input.speaker.role}。`,
    `你的能力：${input.speaker.capabilities.join("、") || "未设置"}。`,
    "你正在真实群聊里发言，不是写报告，也不是 manager 汇总。",
    "请像人类群成员一样自然、简洁、具体地说话。",
    "",
    "硬性规则：",
    "- 如果你的观点和前面 Agent 重复，或者没有明显贡献，请只输出 [SKIP]",
    "- 不要为了发言而发言",
    "- 除非用户要求详细分析，否则保持简短",
    "- 你可以 @ 其他 Agent，但只有确实需要对方补充时才这么做",
    input.isFinalSpeaker ? "- 你是本轮最后一位发言者，请尽量给出阶段性结论或下一步" : "",
    `- 当前模式：${input.mode}`,
    `- 当前小轮：${input.roundIndex + 1} / ${MAX_TEAM_SUBROUNDS}`,
    "",
    "群组上下文：",
    buildContextText(input.team, input.context),
    "",
    "当前群成员：",
    buildNaturalRoster(input.members),
    "",
    `当前可用 MCP 服务：${input.mcpServers.map((server) => server.name).join("、") || "无"}`,
    "",
    "用户资料：",
    `- 姓名：${input.profile.name}`,
    `- 角色：${input.profile.role || "未设置"}`,
  ].filter(Boolean).join("\n");

  const message = [
    `用户消息：${input.userInput}`,
    "",
    "本轮已有发言：",
    previousText,
    "",
    "请直接输出你要发到群里的那条自然语言消息。",
  ].join("\n");

  const content = compact(
    await invokeWorkerText({
      name: input.speaker.name,
      provider: input.provider,
      workspacePath: input.workspacePath,
      systemPrompt,
      message,
      threadId: `${input.conversationId}:${input.runId}:${input.speaker.id}:chat:${input.roundIndex}`,
      memoryPaths: ["/memory/MEMORY.md"],
      mcpServers: input.mcpServers,
      mcpConnections: input.mcpConnections,
      onMcpInvocation: input.onMcpInvocation,
      onTextStream: input.onTextStream,
      additionalTools: input.additionalTools,
    }),
  );

  if (!content || content === "[SKIP]") {
    return null;
  }

  const memberIds = new Set(input.members.map((agent) => agent.id));
  const mentionIds = Array.from(
    new Set([
      ...extractMentionedAgentIds(content, input.members),
    ]),
  ).filter((id) => id !== input.speaker.id);

  return {
    speaker: input.speaker,
    kind: mentionIds.length > 0 ? "handoff" : input.isFinalSpeaker ? "result" : "reply",
    content,
    mentions: mentionIds,
    roundIndex: input.roundIndex,
  } satisfies NaturalTeamAgentMessage;
}
