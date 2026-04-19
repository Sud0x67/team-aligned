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
export const MAX_TEAM_TURN_MESSAGES = 8;
export const MAX_TEAM_SUBROUNDS = 2;

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
  additionalTools?: StructuredToolInterface[];
}) {
  const worker = createEphemeralWorker(input);
  const result = await worker.invoke(
    {
      messages: [{ role: "user" as const, content: input.message }],
    },
    { configurable: { thread_id: input.threadId } },
  );

  return (
    extractAgentText(result) ||
    normalizeMessageContent(result) ||
    "模型已完成调用，但没有返回可显示的文本内容。"
  );
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
  additionalTools?: StructuredToolInterface[];
}) {
  const replyModel = createProviderModel(input.provider).withStructuredOutput(naturalAgentReplySchema);
  const previousText =
    input.previousTurnMessages.length > 0
      ? input.previousTurnMessages
          .map((message) => `${message.speaker.name}：${message.content}`)
          .join("\n")
      : "本轮还没有其他 Agent 发言。";

  const result = naturalAgentReplySchema.parse(
    await replyModel.invoke([
      `你是 ${input.team.name} 群聊中的成员 ${input.speaker.name}。`,
      `你的角色：${input.speaker.role}。`,
      `你的能力：${input.speaker.capabilities.join("、") || "未设置"}。`,
      "你正在真实群聊里发言，不是写报告，也不是 manager 汇总。",
      "请像人类群成员一样自然、简洁、具体地说话。",
      "",
      "硬性规则：",
      "- 如果你的观点和前面 Agent 重复，请返回 shouldSpeak=false",
      "- 如果你没有明显贡献，请返回 shouldSpeak=false",
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
      "",
      "用户消息：",
      input.userInput,
      "",
      "本轮已有发言：",
      previousText,
      "",
      "输出要求：",
      "- 你必须返回一个合法的 JSON 对象（json object），不要输出 markdown，不要输出额外解释",
      "- content 是你要发到群里的自然语言消息",
      "- nextSpeakerIds 只能包含 roster 中的 id，只有当你明确 @ 对方时才填写",
      "- 如果 shouldSpeak=false，content 可以为空",
      "- kind 可用 reply / suggestion / question / handoff / result",
    ].filter(Boolean).join("\n")),
  );

  if (!result.shouldSpeak || !compact(result.content)) {
    return null;
  }

  const memberIds = new Set(input.members.map((agent) => agent.id));
  const mentionIds = Array.from(
    new Set([
      ...result.nextSpeakerIds.filter((id) => memberIds.has(id)),
      ...extractMentionedAgentIds(result.content, input.members),
    ]),
  ).filter((id) => id !== input.speaker.id);

  return {
    speaker: input.speaker,
    kind: result.kind ?? "reply",
    content: result.content.trim(),
    mentions: mentionIds,
    roundIndex: input.roundIndex,
  } satisfies NaturalTeamAgentMessage;
}
