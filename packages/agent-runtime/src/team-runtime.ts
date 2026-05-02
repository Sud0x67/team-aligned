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
  normalizeProviderErrorMessage,
  normalizeMessageContent,
} from "./deep-agent.ts";
import type { RuntimeToolInvocationEvent } from "./agent-tools.ts";
import { createDeepAgentToolInvocationEmitter } from "./deep-agent-tool-events.ts";
import { buildMcpLangChainTools, type McpInvocationEvent } from "./mcp-tools.ts";
import { byLanguage, formatList, type RuntimeLanguage } from "./runtime-language.ts";

export const TEAM_MEMBER_LIMIT = 5;
export const MAX_AGENT_MESSAGES_PER_TURN = 10;
export const MAX_AGENT_WORK_ITEMS = 5;
export const MAX_TEAM_TURN_MESSAGES = 50;
export const MAX_TEAM_SUBROUNDS = 5;
export const MAX_PARALLEL_TEAM_EXECUTIONS = 5;

export type NaturalTeamMode = "focused" | "multi_voice" | "collaboration";

export type TeamHandoffState = {
  activeAgentId: string | null;
  lastSpeakerId: string | null;
  nextAgentIds: string[];
  reason: string;
  revision: number;
  updatedAt: number;
};

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

export type TeamTurnIntent = "chat" | "execute";

export type TeamTurnPlan = NaturalTeamSpeakerSelection & {
  intent: TeamTurnIntent;
  workItems: TeamExecutionWorkItem[];
};

export type MentionResolution<T extends { id: string; name: string }> = {
  tokens: string[];
  matchedMembers: T[];
  matchedIds: string[];
  unresolvedTokens: string[];
};

const workItemSchema = z.object({
  ownerAgentId: z.string(),
  summary: z.string().default(""),
  kickoffMessage: z.string().default(""),
  readTargets: z.array(z.string()).max(8).default([]),
  writeTargets: z.array(z.string()).max(8).default([]),
  dependsOnAgentIds: z.array(z.string()).max(5).default([]),
  canRunInParallel: z.boolean().default(true),
});

const teamTurnPlanSchema = z.object({
  intent: z.enum(["chat", "execute"]).default("chat"),
  mode: z.enum(["focused", "multi_voice", "collaboration"]).default("focused"),
  speakerIds: z.array(z.string()).max(TEAM_MEMBER_LIMIT).default([]),
  reason: z.string().default(""),
  activeTask: z.string().default(""),
  nextPhase: z.string().default(""),
  decision: z.string().default(""),
  workItems: z
    .array(workItemSchema)
    .max(TEAM_MEMBER_LIMIT * MAX_AGENT_WORK_ITEMS)
    .default([]),
});

const naturalAgentReplySchema = z.object({
  shouldSpeak: z.boolean().default(true),
  kind: z.enum(["reply", "suggestion", "question", "handoff", "result"]).default("reply"),
  content: z.string().default(""),
  nextSpeakerIds: z.array(z.string()).max(TEAM_MEMBER_LIMIT).default([]),
});

type RawTeamTurnPlan = z.infer<typeof teamTurnPlanSchema>;

type StructuredTeamTurnPlanner = {
  invoke(input: string): Promise<unknown> | unknown;
};

function compact(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function buildRecentHistory(history: string[], language: RuntimeLanguage) {
  if (history.length === 0) {
    return byLanguage(language, {
      zh: "最近没有可参考的公开对话。",
      en: "No recent public messages are available.",
    });
  }

  return history.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

function buildContextText(team: TeamRecord, context: TeamContext, language: RuntimeLanguage) {
  const noneText = byLanguage(language, { zh: "无", en: "none" });
  return [
    byLanguage(language, { zh: `群组：${team.name}`, en: `Team: ${team.name}` }),
    byLanguage(language, { zh: `当前阶段：${context.phase}`, en: `Current phase: ${context.phase}` }),
    byLanguage(language, {
      zh: `约束：${context.constraints.join("；") || noneText}`,
      en: `Constraints: ${context.constraints.join("; ") || noneText}`,
    }),
    byLanguage(language, {
      zh: `当前任务：${context.activeTasks.join("；") || noneText}`,
      en: `Active tasks: ${context.activeTasks.join("; ") || noneText}`,
    }),
    byLanguage(language, {
      zh: `最近决策：${context.recentDecisions.join("；") || noneText}`,
      en: `Recent decisions: ${context.recentDecisions.join("; ") || noneText}`,
    }),
    byLanguage(language, {
      zh: `Pinned Artifacts：${context.pinnedArtifacts.join("；") || noneText}`,
      en: `Pinned artifacts: ${context.pinnedArtifacts.join("; ") || noneText}`,
    }),
    byLanguage(language, {
      zh: `Workspace 摘要：${context.workspaceSummary || noneText}`,
      en: `Workspace summary: ${context.workspaceSummary || noneText}`,
    }),
  ].join("\n");
}

function selectPublicHistory(history: { senderName: string; visibility: string; content: string }[]) {
  return history
    .filter((message) => message.visibility === "public")
    .slice(-8)
    .map((message) => `${message.senderName}：${compact(message.content)}`);
}

function buildNaturalRoster(members: AgentRecord[], language: RuntimeLanguage) {
  if (members.length === 0) {
    return byLanguage(language, {
      zh: "当前群组没有可发言的 Agent。",
      en: "No available agents can speak in this team right now.",
    });
  }

  return members
    .map(
      (agent) =>
        `- id=${agent.id} | name=${agent.name} | role=${agent.role} | capabilities=${
          agent.capabilities.length > 0
            ? formatList(agent.capabilities, language)
            : byLanguage(language, { zh: "未设置", en: "not set" })
        }`,
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

function resolveSpeakersByIds(ids: string[], members: AgentRecord[]) {
  const memberMap = new Map(members.map((agent) => [agent.id, agent]));
  const seen = new Set<string>();
  const speakers: AgentRecord[] = [];
  for (const id of ids) {
    const agent = memberMap.get(id);
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    speakers.push(agent);
  }
  return speakers;
}

function ensureExplicitSpeakers(input: {
  explicitMentionIds: string[];
  speakers: AgentRecord[];
  members: AgentRecord[];
}) {
  if (input.explicitMentionIds.length === 0) {
    return input.speakers;
  }

  const explicit = resolveSpeakersByIds(input.explicitMentionIds, input.members);
  const explicitIds = new Set(explicit.map((agent) => agent.id));
  return [
    ...explicit,
    ...input.speakers.filter((agent) => !explicitIds.has(agent.id)),
  ].slice(0, TEAM_MEMBER_LIMIT);
}

function fallbackModeForInput(userInput: string): NaturalTeamMode {
  const normalized = userInput.toLowerCase();
  if (/报数|点名|全员|所有人|大家|一起|讨论|脑暴|brainstorm|all[-\s]?hands|roll[-\s]?call|everyone|多角度|分工|协作|分别|评审|review/.test(normalized)) {
    return "collaboration";
  }
  if (/对比|方案|建议|怎么看|意见|看法|multi|perspective|compare|options/.test(normalized)) {
    return "multi_voice";
  }
  return "focused";
}

function selectFallbackSpeakers(input: {
  members: AgentRecord[];
  explicitMentionIds: string[];
  activeAgentId?: string | null;
  userInput: string;
  responseLanguage: RuntimeLanguage;
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
      reason: byLanguage(input.responseLanguage, {
        zh: "用户显式 @ 了这些 Agent。",
        en: "The user explicitly @ mentioned these agents.",
      }),
    };
  }

  const normalized = input.userInput.toLowerCase();
  const mode = fallbackModeForInput(input.userInput);
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
    if (input.activeAgentId && input.activeAgentId === agent.id) score += 4;
    return { agent, score };
  });

  const take =
    mode === "collaboration"
      ? Math.min(TEAM_MEMBER_LIMIT, input.members.length)
      : mode === "multi_voice"
        ? Math.min(4, input.members.length)
        : Math.min(2, input.members.length);
  return {
    mode,
    speakers: scored
      .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name, "zh-Hans-CN"))
      .map((item) => item.agent)
      .slice(0, take),
    reason: byLanguage(input.responseLanguage, {
      zh: mode === "collaboration" ? "用户表达了多 Agent 协作意图。" : "根据角色和能力选择最相关 Agent。",
      en: mode === "collaboration"
        ? "The user is asking for multi-agent collaboration."
        : "Selected the most relevant agents based on roles and capabilities.",
    }),
  };
}

function applyHandoffPreference(input: {
  mode: NaturalTeamMode;
  speakers: AgentRecord[];
  members: AgentRecord[];
  activeAgentId?: string | null;
}) {
  if (!input.activeAgentId) {
    return input.speakers;
  }
  const active = input.members.find((agent) => agent.id === input.activeAgentId);
  if (!active) {
    return input.speakers;
  }
  const others = input.speakers.filter((agent) => agent.id !== active.id);
  return [active, ...others];
}

function extractMentionTokens(input: string) {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const pattern = /(?:^|[\s([{（【,，。.!?！？;；:：])[@＠]([^\s@＠,，。.!?！？;；:：)）\]】}]+)/g;
  for (const match of input.matchAll(pattern)) {
    const token = match[1]?.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

function normalizeMentionToken(value: string) {
  return value.trim().toLowerCase();
}

function isUserMentionToken(token: string, profile: Pick<UserProfile, "name">) {
  const normalized = normalizeMentionToken(token);
  const profileName = normalizeMentionToken(profile.name || "");
  return (
    normalized === "user" ||
    normalized === "你" ||
    normalized === "用户" ||
    (profileName.length > 0 && normalized === profileName)
  );
}

export function resolveMentionedMembers<T extends { id: string; name: string }>(
  content: string,
  members: T[],
): MentionResolution<T> {
  const tokens = extractMentionTokens(content);
  const matchedMembers: T[] = [];
  const matchedIds: string[] = [];
  const unresolvedTokens: string[] = [];
  const matchedSet = new Set<string>();

  for (const token of tokens) {
    const normalizedToken = normalizeMentionToken(token);
    const idWithoutPrefix = normalizedToken.replace(/^agent-/, "");
    const match =
      members.find((member) => normalizeMentionToken(member.name) === normalizedToken) ??
      members.find((member) => normalizeMentionToken(member.id) === normalizedToken) ??
      members.find(
        (member) => normalizeMentionToken(member.id).replace(/^agent-/, "") === idWithoutPrefix,
      );
    if (!match) {
      unresolvedTokens.push(token);
      continue;
    }
    if (matchedSet.has(match.id)) {
      continue;
    }
    matchedSet.add(match.id);
    matchedMembers.push(match);
    matchedIds.push(match.id);
  }

  return {
    tokens,
    matchedMembers,
    matchedIds,
    unresolvedTokens,
  } satisfies MentionResolution<T>;
}

function extractMentionedAgentIds(content: string, members: AgentRecord[]) {
  return resolveMentionedMembers(content, members).matchedIds;
}

export function resolveTeamMessageMentions(
  content: string,
  members: AgentRecord[],
  profile: Pick<UserProfile, "name">,
) {
  const agentMentionIds = extractMentionedAgentIds(content, members);
  const hasUserMention = extractMentionTokens(content).some((token) => isUserMentionToken(token, profile));
  return Array.from(new Set([...agentMentionIds, ...(hasUserMention ? (["user"] as const) : [])]));
}

export function normalizeTeamHandoffState(
  context: TeamContext,
  members: AgentRecord[],
  responseLanguage: RuntimeLanguage = "zh",
): TeamHandoffState {
  const memberIds = new Set(members.map((member) => member.id));
  const raw = context.handoff;
  const activeAgentId =
    raw?.activeAgentId && memberIds.has(raw.activeAgentId) ? raw.activeAgentId : null;
  const lastSpeakerId =
    raw?.lastSpeakerId && memberIds.has(raw.lastSpeakerId) ? raw.lastSpeakerId : null;
  const nextAgentIds = (raw?.nextAgentIds ?? [])
    .filter((id) => memberIds.has(id))
    .slice(0, TEAM_MEMBER_LIMIT);

  return {
    activeAgentId,
    lastSpeakerId,
    nextAgentIds,
    reason:
      raw?.reason?.trim() ||
      byLanguage(responseLanguage, { zh: "等待接棒", en: "Waiting for handoff" }),
    revision: typeof raw?.revision === "number" ? raw.revision : 0,
    updatedAt: typeof raw?.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

export function buildNextHandoffState(input: {
  current: TeamHandoffState;
  members: AgentRecord[];
  turnMessages: NaturalTeamAgentMessage[];
  defaultSpeakerId?: string | null;
  reason: string;
}) {
  const memberIds = new Set(input.members.map((member) => member.id));
  const latest = input.turnMessages.at(-1) ?? null;
  const nextAgentIds =
    latest?.mentions
      .filter((id) => memberIds.has(id) && id !== latest.speaker.id)
      .slice(0, TEAM_MEMBER_LIMIT) ?? [];
  const activeAgentId = nextAgentIds[0] ?? latest?.speaker.id ?? input.defaultSpeakerId ?? null;
  const lastSpeakerId = latest?.speaker.id ?? input.current.lastSpeakerId;

  return {
    activeAgentId,
    lastSpeakerId: lastSpeakerId && memberIds.has(lastSpeakerId) ? lastSpeakerId : null,
    nextAgentIds,
    reason: input.reason,
    revision: input.current.revision + 1,
    updatedAt: Date.now(),
  } satisfies TeamHandoffState;
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

function hasFallbackExecutionIntent(userInput: string) {
  return /开始做|开始改|直接改|帮我做|实现|修复|写代码|创建|新建|生成|搭建|制作|编写|改一下|落地|重构|执行|build|implement|fix|create|write|refactor|update|设计页面|设计一个|做个页面|做一个页面|做静态网页|静态网页|原型|线框图|设计稿|页面结构|页面布局/.test(
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
  onDeepAgentToolInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  additionalTools?: StructuredToolInterface[];
  responseLanguage?: RuntimeLanguage;
}) {
  const worker = createEphemeralWorker(input);
  const messages = [{ role: "user" as const, content: input.message }];

  if (
    ((input.provider.supportsStreaming && input.onTextStream) || input.onDeepAgentToolInvocation) &&
    typeof (worker as { streamEvents?: unknown }).streamEvents === "function"
  ) {
    try {
      let streamedText = "";
      let finalOutput: unknown = null;
      const emitDeepAgentToolInvocation = createDeepAgentToolInvocationEmitter(
        input.onDeepAgentToolInvocation,
      );
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
        await emitDeepAgentToolInvocation(event);
        if (event.event === "on_chat_model_stream") {
          if (!input.provider.supportsStreaming || !input.onTextStream) {
            continue;
          }
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
  return (
    extractAgentText(result) ||
    normalizeMessageContent(result) ||
    byLanguage(input.responseLanguage ?? "zh", {
      zh: "模型已完成调用，但没有返回可显示的文本内容。",
      en: "The model finished the call, but returned no displayable text.",
    })
  );
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

function createTeamIntentAgent(input: { provider: ProviderConfig }): StructuredTeamTurnPlanner {
  return createProviderModel(input.provider).withStructuredOutput(teamTurnPlanSchema);
}

function buildFallbackExecutionPlan(input: {
  members: AgentRecord[];
  explicitMentionIds: string[];
  activeAgentId?: string | null;
  userInput: string;
  responseLanguage: RuntimeLanguage;
}) {
  const fallback = selectFallbackSpeakers(input);
  const owners = fallback.speakers.slice(0, MAX_PARALLEL_TEAM_EXECUTIONS);
  const normalizedInput = input.userInput.toLowerCase();
  const prefersParallel = /并行|同时|simultaneous|in parallel|parallel/.test(normalizedInput);
  const prefersSequential =
    !prefersParallel &&
    /(先.*(再|然后)|完成后|结束后|基于.*结果|依赖|等待|after|then|once)/.test(normalizedInput);
  const workItems = owners.map((owner, index) => ({
    id: `work-${index + 1}`,
    owner,
    summary: byLanguage(input.responseLanguage, {
      zh: `处理“${compact(input.userInput)}”中与 ${owner.role} 相关的部分`,
      en: `Handle the part of "${compact(input.userInput)}" related to ${owner.role}`,
    }),
    kickoffMessage:
      index === 0
        ? byLanguage(input.responseLanguage, { zh: "我先开始处理这个部分。", en: "I'll start with this part first." })
        : prefersSequential
          ? byLanguage(input.responseLanguage, { zh: "我会等前置部分完成后继续接棒。", en: "I'll wait for prerequisites to finish, then continue." })
          : byLanguage(input.responseLanguage, { zh: "我这边也同步处理一部分。", en: "I'll handle another part in parallel." }),
    readTargets: [],
    writeTargets: [],
    dependsOnAgentIds: prefersSequential && index > 0 ? [owners[index - 1]?.id].filter(Boolean) : [],
    canRunInParallel: prefersParallel || !prefersSequential,
  }));

  return {
    reason: byLanguage(input.responseLanguage, {
      zh: input.explicitMentionIds.length > 0 ? "用户明确要求相关 Agent 直接开始执行。" : "用户表达了明确的执行意图。",
      en: input.explicitMentionIds.length > 0
        ? "The user explicitly asked these agents to execute immediately."
        : "The user expressed a clear execution intent.",
    }),
    activeTask: compact(input.userInput),
    nextPhase: byLanguage(input.responseLanguage, { zh: "执行中", en: "Executing" }),
    decision: byLanguage(input.responseLanguage, {
      zh: "启动第一版群聊执行模式。",
      en: "Start the first version of execution mode in group chat.",
    }),
    workItems,
  } satisfies TeamExecutionPlan;
}

function mapExecutionWorkItems(input: {
  rawWorkItems: RawTeamTurnPlan["workItems"];
  members: AgentRecord[];
  responseLanguage: RuntimeLanguage;
}) {
  const memberMap = new Map(input.members.map((agent) => [agent.id, agent]));
  const ownerCounts = new Map<string, number>();
  const workItems: TeamExecutionWorkItem[] = [];
  for (const [index, item] of input.rawWorkItems.entries()) {
    const owner = memberMap.get(item.ownerAgentId);
    if (!owner) continue;
    const currentCount = ownerCounts.get(owner.id) ?? 0;
    if (currentCount >= MAX_AGENT_WORK_ITEMS) continue;
    ownerCounts.set(owner.id, currentCount + 1);
    workItems.push({
      id: `work-${index + 1}`,
      owner,
      summary:
        compact(item.summary) ||
        byLanguage(input.responseLanguage, {
          zh: `处理与 ${owner.role} 相关的部分`,
          en: `Handle the part related to ${owner.role}`,
        }),
      kickoffMessage:
        compact(item.kickoffMessage) ||
        byLanguage(input.responseLanguage, {
          zh: `我来处理和 ${owner.role} 相关的部分。`,
          en: `I'll take the part related to ${owner.role}.`,
        }),
      readTargets: item.readTargets.map(normalizeTargetPath).filter(Boolean),
      writeTargets: item.writeTargets.map(normalizeTargetPath).filter(Boolean),
      dependsOnAgentIds: item.dependsOnAgentIds.filter((id) => memberMap.has(id)),
      canRunInParallel: item.canRunInParallel,
    });
  }
  return workItems;
}

function ensureExplicitExecutionWorkItems(input: {
  workItems: TeamExecutionWorkItem[];
  fallbackWorkItems: TeamExecutionWorkItem[];
  explicitMentionIds: string[];
  members: AgentRecord[];
  userInput: string;
  responseLanguage: RuntimeLanguage;
}) {
  if (input.explicitMentionIds.length === 0) {
    return input.workItems;
  }

  const memberMap = new Map(input.members.map((agent) => [agent.id, agent]));
  const fallbackByOwnerId = new Map(input.fallbackWorkItems.map((item) => [item.owner.id, item]));
  const workItems = input.workItems.map((item, index) => ({
    ...item,
    id: `work-${index + 1}`,
  }));
  const ownerCounts = new Map<string, number>();
  for (const item of workItems) {
    ownerCounts.set(item.owner.id, (ownerCounts.get(item.owner.id) ?? 0) + 1);
  }

  for (const agentId of input.explicitMentionIds) {
    const owner = memberMap.get(agentId);
    if (!owner || (ownerCounts.get(owner.id) ?? 0) > 0) {
      continue;
    }
    const fallback = fallbackByOwnerId.get(owner.id);
    workItems.push(
      fallback
        ? {
            ...fallback,
            id: `work-${workItems.length + 1}`,
          }
        : {
            id: `work-${workItems.length + 1}`,
            owner,
            summary: byLanguage(input.responseLanguage, {
              zh: `处理用户明确 @ 你的任务：${compact(input.userInput)}`,
              en: `Handle the task the user explicitly @ mentioned you for: ${compact(input.userInput)}`,
            }),
            kickoffMessage: byLanguage(input.responseLanguage, {
              zh: "我被直接 @ 了，会先开始处理这部分。",
              en: "I was mentioned directly, so I'll start handling this part.",
            }),
            readTargets: [],
            writeTargets: [],
            dependsOnAgentIds: [],
            canRunInParallel: true,
          },
    );
    ownerCounts.set(owner.id, 1);
  }

  return workItems.slice(0, TEAM_MEMBER_LIMIT * MAX_AGENT_WORK_ITEMS);
}

function buildFallbackTeamTurnPlan(input: {
  members: AgentRecord[];
  explicitMentionIds: string[];
  activeAgentId?: string | null;
  userInput: string;
  responseLanguage: RuntimeLanguage;
}) {
  const fallback = selectFallbackSpeakers(input);
  const baseSpeakers =
    input.explicitMentionIds.length > 0
      ? ensureExplicitSpeakers({
          explicitMentionIds: input.explicitMentionIds,
          speakers: fallback.speakers,
          members: input.members,
        })
      : applyHandoffPreference({
          mode: fallback.mode,
          speakers: fallback.speakers,
          members: input.members,
          activeAgentId: input.activeAgentId ?? null,
        });
  const clampedSpeakers = clampSpeakersForMode({
    mode: fallback.mode,
    speakers: baseSpeakers,
    members: input.members,
  });

  if (!hasFallbackExecutionIntent(input.userInput)) {
    return {
      intent: "chat",
      mode: fallback.mode,
      speakers: clampedSpeakers,
      reason: fallback.reason,
      activeTask: compact(input.userInput),
      nextPhase: "",
      decision: "",
      workItems: [],
    } satisfies TeamTurnPlan;
  }

  const executionPlan = buildFallbackExecutionPlan(input);
  const executionOwners = Array.from(
    new Map(executionPlan.workItems.map((item) => [item.owner.id, item.owner])).values(),
  );

  return {
    intent: "execute",
    mode: fallback.mode,
    speakers:
      executionOwners.length > 0
        ? clampSpeakersForMode({
            mode: fallback.mode,
            speakers: executionOwners,
            members: input.members,
          })
        : clampedSpeakers,
    reason: executionPlan.reason,
    activeTask: executionPlan.activeTask,
    nextPhase: executionPlan.nextPhase,
    decision: executionPlan.decision,
    workItems: executionPlan.workItems,
  } satisfies TeamTurnPlan;
}

export async function planTeamTurn(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  members: AgentRecord[];
  profile: UserProfile;
  context: TeamContext;
  handoff: TeamHandoffState | null;
  history: { senderName: string; visibility: string; content: string }[];
  userInput: string;
  explicitMentionIds: string[];
  mcpServers: McpCatalogRecord[];
  planner?: StructuredTeamTurnPlanner;
  responseLanguage?: RuntimeLanguage;
}) {
  const responseLanguage = input.responseLanguage ?? "zh";
  const cappedMembers = input.members.slice(0, TEAM_MEMBER_LIMIT);
  if (cappedMembers.length === 0) {
    return {
      intent: "chat",
      mode: "focused",
      speakers: [],
      reason: byLanguage(responseLanguage, {
        zh: "群组没有可用成员。",
        en: "No available members in this team.",
      }),
      activeTask: "",
      nextPhase: "",
      decision: "",
      workItems: [],
    } satisfies TeamTurnPlan;
  }

  const fallback = buildFallbackTeamTurnPlan({
    members: cappedMembers,
    explicitMentionIds: input.explicitMentionIds,
    activeAgentId: input.handoff?.activeAgentId ?? null,
    userInput: input.userInput,
    responseLanguage,
  });

  try {
    const planner = input.planner ?? createTeamIntentAgent({ provider: input.provider });
    const rawResult = await planner.invoke(
        byLanguage(responseLanguage, {
          zh: [
            "你是 teamaligned 群聊中的不可见 system orchestrator。",
            "你的任务是做群聊意图识别与回合编排：判断是 chat 还是 execute，并给出 mode / speakerIds / workItems。",
            "系统支持并行和串行执行，但必须避免文件冲突和无意义并行。执行模式必须可落地。",
            `群组最多激活 ${TEAM_MEMBER_LIMIT} 个 Agent，同时最多 ${MAX_PARALLEL_TEAM_EXECUTIONS} 个 work item 并行执行。`,
            "",
            "意图识别规则：",
            "- 明确要实现、修改、创建、修复、落地、写代码 => intent=execute",
            "- 讨论、评审、问答、澄清 => intent=chat",
            "",
            "mode 规则（无论 chat/execute 都要给出）：",
            "- focused: 1-2 个 Agent",
            "- multi_voice: 2-4 个 Agent",
            "- collaboration: 3-5 个 Agent",
            "- 如果用户显式 @，这些 Agent 必须出现在 speakerIds 或 work item owner 中",
            "",
            "execute 规则：",
            "- work item 应尽量让不同角色处理不同文件或不同分工",
            "- 如果任务依赖另一个 Agent 的输出，请填写 dependsOnAgentIds",
            "- 如果两个任务可能修改相同文件，请把 canRunInParallel 设为 false",
            "- writeTargets 和 readTargets 尽量使用 workspace 相对路径",
            `- 每个 Agent 最多 ${MAX_AGENT_WORK_ITEMS} 个 work item`,
            "",
            "chat 规则：",
            "- workItems 必须为空数组",
            "",
            "当前用户资料：",
            `- 姓名：${input.profile.name}`,
            `- 简介：${input.profile.bio || "未设置"}`,
            "",
            "群组上下文：",
            buildContextText(input.team, input.context, responseLanguage),
            "",
            "Agent roster：",
            buildNaturalRoster(cappedMembers, responseLanguage),
            "",
            `当前可用 MCP 服务：${formatList(input.mcpServers.map((server) => server.name), responseLanguage)}`,
            "",
            "最近公开对话：",
            buildRecentHistory(selectPublicHistory(input.history), responseLanguage),
            "",
            "用户最新输入：",
            input.userInput,
            "",
            `用户显式提及的成员 id：${formatList(input.explicitMentionIds, responseLanguage)}`,
            "",
            "输出要求：",
            "- 你必须返回一个合法的 JSON 对象（json object），不要输出 markdown，不要输出额外解释",
            "- speakerIds 与 ownerAgentId 必须来自 roster id",
          ],
          en: [
            "You are the invisible system orchestrator in TeamAligned group chat.",
            "Your task is intent recognition plus turn orchestration: decide chat vs execute, then produce mode / speakerIds / workItems.",
            "The system supports both parallel and sequential execution, but avoid file conflicts and meaningless parallelism.",
            `At most ${TEAM_MEMBER_LIMIT} agents can be active, and at most ${MAX_PARALLEL_TEAM_EXECUTIONS} work items can run in parallel.`,
            "",
            "Intent rules:",
            "- Clear implement/modify/create/fix/deliver/code asks => intent=execute",
            "- Discussion/review/Q&A/clarification => intent=chat",
            "",
            "Mode rules (always required):",
            "- focused: 1-2 agents",
            "- multi_voice: 2-4 agents",
            "- collaboration: 3-5 agents",
            "- If users explicitly @ mention agents, those agents must appear in speakerIds or work item owners",
            "",
            "Execution rules:",
            "- Work items should let different roles own different files or responsibilities",
            "- If a task depends on another agent's output, include dependsOnAgentIds",
            "- If two tasks might touch the same file, set canRunInParallel=false",
            "- Prefer workspace-relative paths for writeTargets/readTargets",
            `- Each agent can own at most ${MAX_AGENT_WORK_ITEMS} work items`,
            "",
            "Chat rules:",
            "- workItems must be an empty array",
            "",
            "Current user profile:",
            `- Name: ${input.profile.name}`,
            `- Bio: ${input.profile.bio || "not set"}`,
            "",
            "Group context:",
            buildContextText(input.team, input.context, responseLanguage),
            "",
            "Agent roster:",
            buildNaturalRoster(cappedMembers, responseLanguage),
            "",
            `Available MCP servers: ${formatList(input.mcpServers.map((server) => server.name), responseLanguage)}`,
            "",
            "Recent public messages:",
            buildRecentHistory(selectPublicHistory(input.history), responseLanguage),
            "",
            "Latest user input:",
            input.userInput,
            "",
            `Explicitly mentioned member ids: ${formatList(input.explicitMentionIds, responseLanguage)}`,
            "",
            "Output requirements:",
            "- Return only a valid JSON object. No markdown. No extra commentary.",
            "- speakerIds and ownerAgentId must come from roster ids.",
          ],
        }).join("\n"),
    );
    const result = teamTurnPlanSchema.parse(rawResult);
    const plannerIntent =
      result.intent === "chat" && fallback.intent === "execute" && input.explicitMentionIds.length > 0
        ? "execute"
        : result.intent;
    const mode = result.mode ?? fallback.mode;
    const rawSpeakers = resolveSpeakersByIds(result.speakerIds, cappedMembers);
    const preferredSpeakers =
      input.explicitMentionIds.length > 0
        ? ensureExplicitSpeakers({
            explicitMentionIds: input.explicitMentionIds,
            speakers: rawSpeakers.length > 0 ? rawSpeakers : fallback.speakers,
            members: cappedMembers,
          })
        : applyHandoffPreference({
            mode,
            speakers: rawSpeakers.length > 0 ? rawSpeakers : fallback.speakers,
            members: cappedMembers,
            activeAgentId: input.handoff?.activeAgentId ?? null,
          });
    const speakers = clampSpeakersForMode({
      mode,
      speakers: preferredSpeakers,
      members: cappedMembers,
    });

    const mappedWorkItems = mapExecutionWorkItems({
      rawWorkItems: result.workItems ?? [],
      members: cappedMembers,
      responseLanguage,
    });

    if (plannerIntent === "execute") {
      const candidateWorkItems = mappedWorkItems.length > 0 ? mappedWorkItems : fallback.workItems;
      const workItems = ensureExplicitExecutionWorkItems({
        workItems: candidateWorkItems,
        fallbackWorkItems: fallback.workItems,
        explicitMentionIds: input.explicitMentionIds,
        members: cappedMembers,
        userInput: input.userInput,
        responseLanguage,
      });
      if (workItems.length === 0) {
        return {
          ...fallback,
          intent: "chat",
          workItems: [],
        } satisfies TeamTurnPlan;
      }

      const workOwners = Array.from(new Map(workItems.map((item) => [item.owner.id, item.owner])).values());
      const executeSpeakers = clampSpeakersForMode({
        mode,
        speakers:
          input.explicitMentionIds.length > 0
            ? ensureExplicitSpeakers({
                explicitMentionIds: input.explicitMentionIds,
                speakers: workOwners.length > 0 ? workOwners : speakers,
                members: cappedMembers,
              })
            : workOwners.length > 0
              ? workOwners
              : speakers,
        members: cappedMembers,
      });

      return {
        intent: "execute",
        mode,
        speakers: executeSpeakers,
        reason: plannerIntent !== result.intent ? fallback.reason : compact(result.reason) || fallback.reason,
        activeTask:
          plannerIntent !== result.intent
            ? fallback.activeTask
            : compact(result.activeTask) || compact(input.userInput),
        nextPhase:
          plannerIntent !== result.intent
            ? fallback.nextPhase
            : compact(result.nextPhase) ||
              byLanguage(responseLanguage, { zh: "执行中", en: "Executing" }),
        decision: plannerIntent !== result.intent ? fallback.decision : compact(result.decision),
        workItems,
      } satisfies TeamTurnPlan;
    }

    return {
      intent: "chat",
      mode,
      speakers,
      reason: compact(result.reason) || fallback.reason,
      activeTask: compact(result.activeTask),
      nextPhase: compact(result.nextPhase),
      decision: compact(result.decision),
      workItems: [],
    } satisfies TeamTurnPlan;
  } catch {
    return fallback;
  }
}

export async function selectNaturalTeamSpeakers(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  members: AgentRecord[];
  profile: UserProfile;
  context: TeamContext;
  handoff: TeamHandoffState | null;
  history: { senderName: string; visibility: string; content: string }[];
  userInput: string;
  explicitMentionIds: string[];
  mcpServers: McpCatalogRecord[];
  planner?: StructuredTeamTurnPlanner;
  responseLanguage?: RuntimeLanguage;
}) {
  const plan = await planTeamTurn(input);
  return {
    mode: plan.mode,
    speakers: plan.speakers,
    reason: plan.reason,
    activeTask: plan.activeTask,
    nextPhase: plan.nextPhase,
    decision: plan.decision,
  } satisfies NaturalTeamSpeakerSelection;
}

export async function planTeamExecution(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  members: AgentRecord[];
  profile: UserProfile;
  context: TeamContext;
  handoff: TeamHandoffState | null;
  history: { senderName: string; visibility: string; content: string }[];
  userInput: string;
  explicitMentionIds: string[];
  mcpServers: McpCatalogRecord[];
  planner?: StructuredTeamTurnPlanner;
  responseLanguage?: RuntimeLanguage;
}) {
  const plan = await planTeamTurn(input);
  if (plan.intent !== "execute" || plan.workItems.length === 0) {
    return null;
  }
  return {
    reason: plan.reason,
    activeTask: plan.activeTask,
    nextPhase: plan.nextPhase,
    decision: plan.decision,
    workItems: plan.workItems,
  } satisfies TeamExecutionPlan;
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
  onDeepAgentToolInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  onUpdate?: (event: {
    phase: "started" | "streaming" | "completed" | "failed";
    owner: AgentRecord;
    summary: string;
    content: string;
  }) => void | Promise<void>;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  additionalTools?: StructuredToolInterface[];
  responseLanguage?: RuntimeLanguage;
}) {
  const responseLanguage = input.responseLanguage ?? "zh";
  const systemPrompt = byLanguage(responseLanguage, {
    zh: [
      `你是 ${input.team.name} 群聊中的成员 ${input.workItem.owner.name}。`,
      `你的角色：${input.workItem.owner.role}。`,
      `你的能力：${input.workItem.owner.capabilities.join("、") || "未设置"}。`,
      "当前已经进入执行模式，请真正完成分配给你的工作，而不是只讨论。",
      "你可以使用已经注入的文件、搜索、命令和 MCP 工具。",
      "如果只是读取或修改当前 workspace 内的本地文件，请优先使用 Workspace 工具，不要优先使用同名的 MCP 文件工具。",
      "请只在当前 workspace 内工作。",
      "如果任务无法执行，请明确说明阻塞原因。",
      "",
      "本次 work item：",
      `- 摘要：${input.workItem.summary}`,
      `- 读取范围：${formatList(input.workItem.readTargets, responseLanguage)}`,
      `- 写入范围：${formatList(input.workItem.writeTargets, responseLanguage)}`,
      `- 并行：${input.workItem.canRunInParallel ? "可并行" : "需要串行"}`,
      "",
      "群组上下文：",
      buildContextText(input.team, input.context, responseLanguage),
      "",
      "本轮其他执行结果：",
      input.previousOutputs.length > 0 ? input.previousOutputs.join("\n\n") : "暂无",
    ],
    en: [
      `You are ${input.workItem.owner.name}, a member in ${input.team.name}.`,
      `Your role: ${input.workItem.owner.role}.`,
      `Your capabilities: ${formatList(input.workItem.owner.capabilities, responseLanguage)}.`,
      "This turn is in execution mode. Complete your assigned work instead of discussing only.",
      "You can use injected file, search, command, and MCP tools.",
      "When the task only needs local workspace files, prefer Workspace tools over similarly named MCP file tools.",
      "Only work inside the current workspace.",
      "If the task cannot proceed, clearly explain the blocker.",
      "",
      "Current work item:",
      `- Summary: ${input.workItem.summary}`,
      `- Read scope: ${formatList(input.workItem.readTargets, responseLanguage)}`,
      `- Write scope: ${formatList(input.workItem.writeTargets, responseLanguage)}`,
      `- Parallelism: ${input.workItem.canRunInParallel ? "parallel allowed" : "sequential required"}`,
      "",
      "Group context:",
      buildContextText(input.team, input.context, responseLanguage),
      "",
      "Other outputs from this turn:",
      input.previousOutputs.length > 0 ? input.previousOutputs.join("\n\n") : "none",
    ],
  }).join("\n");

  const message = byLanguage(responseLanguage, {
    zh: [
      `用户原始请求：${input.userInput}`,
      `你需要执行的任务：${input.workItem.summary}`,
      "请直接执行，并在完成后用自然群聊口吻汇报：做了什么、结果是什么、如果改了文件请简要提及。",
    ],
    en: [
      `Original user request: ${input.userInput}`,
      `Task to execute: ${input.workItem.summary}`,
      "Execute directly, then report in natural group-chat style: what you did, what result you got, and briefly mention changed files.",
    ],
  }).join("\n");

  await input.onUpdate?.({
    phase: "started",
    owner: input.workItem.owner,
    summary: input.workItem.summary,
    content: byLanguage(responseLanguage, {
      zh: `${input.workItem.owner.name}：我开始处理 ${input.workItem.summary}。`,
      en: `${input.workItem.owner.name}: I’m starting ${input.workItem.summary}.`,
    }),
  });
  let announcedStreaming = false;
  try {
    const result = await invokeWorkerText({
      name: input.workItem.owner.name,
      provider: input.provider,
      workspacePath: input.workspacePath,
      systemPrompt,
      message,
      threadId: `${input.conversationId}:${input.runId}:${input.workItem.owner.id}:execution`,
      memoryPaths: ["/.team-aligned/memory/MEMORY.md"],
      mcpServers: input.mcpServers,
      mcpConnections: input.mcpConnections,
      onMcpInvocation: input.onMcpInvocation,
      onDeepAgentToolInvocation: input.onDeepAgentToolInvocation,
      onTextStream: async (aggregatedText, deltaText) => {
        await input.onTextStream?.(aggregatedText, deltaText);
        if (!announcedStreaming && deltaText.trim().length > 0) {
          announcedStreaming = true;
          await input.onUpdate?.({
            phase: "streaming",
            owner: input.workItem.owner,
            summary: input.workItem.summary,
            content: byLanguage(responseLanguage, {
              zh: `${input.workItem.owner.name}：我正在处理，先同步一版中间结果。`,
              en: `${input.workItem.owner.name}: I’m working on it and sharing an interim update.`,
            }),
          });
        }
      },
      responseLanguage,
      additionalTools: input.additionalTools,
    });
    await input.onUpdate?.({
      phase: "completed",
      owner: input.workItem.owner,
      summary: input.workItem.summary,
      content: byLanguage(responseLanguage, {
        zh: `${input.workItem.owner.name}：这部分已经处理完成。`,
        en: `${input.workItem.owner.name}: This part is completed.`,
      }),
    });
    return result;
  } catch (error) {
    const normalizedError = normalizeProviderErrorMessage(error, {
      id: input.provider.id,
      label: input.provider.label,
      baseUrl: input.provider.baseUrl,
      defaultModel: input.provider.defaultModel,
    }, responseLanguage);
    await input.onUpdate?.({
      phase: "failed",
      owner: input.workItem.owner,
      summary: input.workItem.summary,
      content:
        normalizedError
          ? byLanguage(responseLanguage, {
              zh: `${input.workItem.owner.name}：我处理 ${input.workItem.summary} 时遇到问题：${normalizedError}`,
              en: `${input.workItem.owner.name}: I hit an issue while handling ${input.workItem.summary}: ${normalizedError}`,
            })
          : byLanguage(responseLanguage, {
              zh: `${input.workItem.owner.name}：我处理 ${input.workItem.summary} 时遇到未知问题。`,
              en: `${input.workItem.owner.name}: I hit an unknown issue while handling ${input.workItem.summary}.`,
            }),
    });
    throw new Error(normalizedError);
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
  onDeepAgentToolInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  additionalTools?: StructuredToolInterface[];
  responseLanguage?: RuntimeLanguage;
}) {
  const responseLanguage = input.responseLanguage ?? "zh";
  const previousText =
    input.previousTurnMessages.length > 0
      ? input.previousTurnMessages
          .map((message) => `${message.speaker.name}：${message.content}`)
          .join("\n")
      : byLanguage(responseLanguage, {
          zh: "本轮还没有其他 Agent 发言。",
          en: "No other agent has spoken in this turn yet.",
        });
  const systemPrompt = byLanguage(responseLanguage, {
    zh: [
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
      "",
      "群组上下文：",
      buildContextText(input.team, input.context, responseLanguage),
      "",
      "当前群成员：",
      buildNaturalRoster(input.members, responseLanguage),
      "",
      `当前可用 MCP 服务：${formatList(input.mcpServers.map((server) => server.name), responseLanguage)}`,
      "",
      "用户资料：",
      `- 姓名：${input.profile.name}`,
      `- 简介：${input.profile.bio || "未设置"}`,
    ],
    en: [
      `You are ${input.speaker.name}, a member in ${input.team.name}.`,
      `Your role: ${input.speaker.role}.`,
      `Your capabilities: ${formatList(input.speaker.capabilities, responseLanguage)}.`,
      "You are speaking in a real group chat, not writing a report or manager summary.",
      "Speak naturally like a human teammate: concise and concrete.",
      "",
      "Hard rules:",
      "- If your point repeats others or adds no value, output [SKIP] only",
      "- Do not speak just for the sake of speaking",
      "- Keep it short unless user requests detailed analysis",
      "- You may @ other agents only when you truly need their follow-up",
      input.isFinalSpeaker ? "- You are the final speaker of this round; try to provide a stage conclusion or next step" : "",
      "",
      "Group context:",
      buildContextText(input.team, input.context, responseLanguage),
      "",
      "Current members:",
      buildNaturalRoster(input.members, responseLanguage),
      "",
      `Available MCP servers: ${formatList(input.mcpServers.map((server) => server.name), responseLanguage)}`,
      "",
      "User profile:",
      `- Name: ${input.profile.name}`,
      `- Bio: ${input.profile.bio || "not set"}`,
    ],
  })
    .filter(Boolean)
    .join("\n");

  const message = byLanguage(responseLanguage, {
    zh: [
      `用户消息：${input.userInput}`,
      "",
      "本轮已有发言：",
      previousText,
      "",
      "请直接输出你要发到群里的那条自然语言消息。",
    ],
    en: [
      `User message: ${input.userInput}`,
      "",
      "Messages already sent in this round:",
      previousText,
      "",
      "Output only the natural-language message you want to send to the group.",
    ],
  }).join("\n");

  const content = compact(
    await invokeWorkerText({
      name: input.speaker.name,
      provider: input.provider,
      workspacePath: input.workspacePath,
      systemPrompt,
      message,
      threadId: `${input.conversationId}:${input.runId}:${input.speaker.id}:chat:${input.roundIndex}`,
      memoryPaths: ["/.team-aligned/memory/MEMORY.md"],
      mcpServers: input.mcpServers,
      mcpConnections: input.mcpConnections,
      onMcpInvocation: input.onMcpInvocation,
      onDeepAgentToolInvocation: input.onDeepAgentToolInvocation,
      onTextStream: input.onTextStream,
      responseLanguage,
      additionalTools: input.additionalTools,
    }),
  );

  if (!content || content === "[SKIP]") {
    return null;
  }

  const mentionIds = resolveTeamMessageMentions(content, input.members, input.profile).filter(
    (id) => id !== input.speaker.id,
  );

  return {
    speaker: input.speaker,
    kind: mentionIds.length > 0 ? "handoff" : input.isFinalSpeaker ? "result" : "reply",
    content,
    mentions: mentionIds,
    roundIndex: input.roundIndex,
  } satisfies NaturalTeamAgentMessage;
}
