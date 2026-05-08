import { readFileSync } from "node:fs";
import { createDeepAgent } from "deepagents";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { Command, MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import type {
  AgentRecord,
  AttachmentAssetRecord,
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
  extractHitlRequest,
  extractStreamReasoningText,
  isProviderTimeoutError,
  normalizeProviderErrorMessage,
  normalizeMessageContent,
  type ToolApprovalInterruptHandler,
  type ToolApprovalInterruptOn,
} from "./deep-agent.ts";
import type { RuntimeToolInvocationEvent, ToolExecutionPolicy } from "./agent-tools.ts";
import { runDeepAgentStreamWithInterrupts } from "./deep-agent-streaming.ts";
import { buildMcpLangChainTools, type McpInvocationEvent } from "./mcp-tools.ts";
import { byLanguage, formatList, type RuntimeLanguage } from "./runtime-language.ts";
import { getRuntimeTimeouts } from "./runtime-timeouts.ts";
import {
  createWorkspaceFilesystemBackend,
  deepAgentMemoryFilePath,
} from "./deep-agent-filesystem.ts";

export const TEAM_MEMBER_LIMIT = 5;
export const MAX_AGENT_MESSAGES_PER_TURN = 10;
export const MAX_AGENT_WORK_ITEMS = 5;
export const MAX_TEAM_TURN_MESSAGES = 50;
export const MAX_TEAM_SUBROUNDS = 5;
export const MAX_PARALLEL_TEAM_EXECUTIONS = 5;
export type NaturalTeamMode = "focused" | "multi_voice" | "collaboration";

type RuntimeErrorReporter = (
  source: string,
  error: unknown,
  metadata?: Record<string, unknown>,
) => void | Promise<void>;

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

type StructuredTeamTurnOrchestrator = {
  invoke(input: string): Promise<unknown> | unknown;
};

type WorkerUserContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

function getTeamOrchestratorTimeoutMs() {
  return getRuntimeTimeouts().teamOrchestratorMs;
}

function getTeamWorkerTimeoutMs() {
  return getRuntimeTimeouts().teamWorkerMs;
}

function getTeamWorkerStreamIdleTimeoutMs() {
  return getRuntimeTimeouts().teamWorkerStreamIdleMs;
}

async function withRuntimeTimeout<T>(promise: Promise<T> | T, timeoutMs: number, label: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(label));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function withTeamOrchestratorTimeout<T>(promise: Promise<T> | T) {
  return withRuntimeTimeout(promise, getTeamOrchestratorTimeoutMs(), "Team turn orchestrator timed out");
}

function buildAttachmentImageDataUrl(attachment: AttachmentAssetRecord) {
  const data = readFileSync(attachment.path).toString("base64");
  return `data:${attachment.mimeType};base64,${data}`;
}

function buildWorkerUserContent(
  message: string,
  attachments: AttachmentAssetRecord[],
  responseLanguage: RuntimeLanguage,
): WorkerUserContent {
  const imageAttachments = attachments.filter((attachment) => attachment.mimeType.startsWith("image/"));
  if (imageAttachments.length === 0) {
    return message;
  }

  const content: Exclude<WorkerUserContent, string> = [
    {
      type: "text",
      text: [
        message,
        "",
        byLanguage(responseLanguage, {
          zh: "请理解并结合下面上传的图片内容进行群聊回复。若图片无法读取，请明确说明。",
          en: "Please use the uploaded image content in the group reply. If any image cannot be read, state that clearly.",
        }),
      ].join("\n"),
    },
  ];

  for (const attachment of imageAttachments) {
    try {
      content.push({
        type: "image_url",
        image_url: { url: buildAttachmentImageDataUrl(attachment) },
      });
    } catch {
      content.push({
        type: "text",
        text: byLanguage(responseLanguage, {
          zh: `图片 ${attachment.name} 读取失败，路径：${attachment.path}`,
          en: `Failed to read image ${attachment.name}. Path: ${attachment.path}`,
        }),
      });
    }
  }

  return content;
}

function shouldUseWorkerToolsForNaturalChat(input: {
  userInput: string;
  attachments?: AttachmentAssetRecord[];
}) {
  if ((input.attachments?.length ?? 0) > 0) {
    return true;
  }
  return /web[_\s-]?(fetch|search)|https?:\/\/|网页|网站|联网|搜索|检索|抓取|打开链接|读取文件|查看文件|写文件|创建文件|修改文件|#\S+/.test(
    input.userInput,
  );
}

async function invokeDirectTeamChatText(input: {
  provider: ProviderConfig;
  systemPrompt: string;
  message: string;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  onReasoningStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  onRuntimeError?: RuntimeErrorReporter;
  runtimeMetadata?: Record<string, unknown>;
}) {
  const model = createProviderModel(input.provider);
  const messages = [
    { role: "system" as const, content: input.systemPrompt },
    { role: "user" as const, content: input.message },
  ];
  if (input.provider.supportsStreaming) {
    const startedAt = Date.now();
    try {
      const stream = await model.stream(messages);
      let aggregatedText = "";
      let aggregatedReasoning = "";
      for await (const chunk of stream) {
        const reasoningDelta = extractStreamReasoningText(chunk);
        if (reasoningDelta) {
          aggregatedReasoning = `${aggregatedReasoning}${reasoningDelta}`;
          await input.onReasoningStream?.(aggregatedReasoning, reasoningDelta);
        }
        const deltaText = normalizeMessageContent(
          chunk && typeof chunk === "object" && "content" in chunk ? chunk.content : chunk,
        );
        if (!deltaText) continue;
        aggregatedText = `${aggregatedText}${deltaText}`;
        await input.onTextStream?.(aggregatedText, deltaText);
      }
      if (aggregatedText.trim()) {
        return aggregatedText.trim();
      }
    } catch (error) {
      await input.onRuntimeError?.("team-chat:direct-stream", error, {
        ...(input.runtimeMetadata ?? {}),
        phase: "stream",
        elapsedMs: Date.now() - startedAt,
      });
    }
  }
  return extractAgentText(await model.invoke(messages));
}

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

export function shouldApplyTeamHandoffContinuity(userInput: string) {
  const normalized = userInput.toLowerCase();
  return /继续|接着|上面|上一步|上一轮|刚才|前面|这个|这部分|它|接棒|handoff|continue|previous|last turn|same task|that part|this part/.test(
    normalized,
  );
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
    if (
      input.activeAgentId &&
      input.activeAgentId === agent.id &&
      shouldApplyTeamHandoffContinuity(input.userInput)
    ) {
      score += 4;
    }
    return { agent, score };
  });

  const take =
    mode === "collaboration"
      ? Math.min(TEAM_MEMBER_LIMIT, input.members.length)
      : mode === "multi_voice"
        ? Math.min(4, input.members.length)
        : 1;
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

function extractWorkspacePathMentions(value: string) {
  const paths: string[] = [];
  const seen = new Set<string>();
  const pattern =
    /(?:^|[\s`"'“”‘’([{（,，;；:：])((?!https?:\/\/)(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)(?=$|[\s`"'“”‘’)\]}）,，;；。.!?！？])/g;
  for (const match of value.matchAll(pattern)) {
    const path = normalizeTargetPath(match[1] ?? "");
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function findNamedMembersInText(userInput: string, members: AgentRecord[]) {
  const normalized = userInput.toLowerCase();
  return members
    .map((agent) => {
      const candidates = [
        agent.name,
        agent.id,
        agent.id.replace(/^agent-/, ""),
      ]
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length >= 2);
      const index = candidates.reduce((current, candidate) => {
        const found = normalized.indexOf(candidate);
        return found >= 0 && (current < 0 || found < current) ? found : current;
      }, -1);
      return { agent, index };
    })
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.agent);
}

function getRequiredExecutionOwnerIds(input: {
  userInput: string;
  members: AgentRecord[];
  explicitMentionIds: string[];
}) {
  return Array.from(
    new Set([
      ...input.explicitMentionIds,
      ...findNamedMembersInText(input.userInput, input.members).map((agent) => agent.id),
    ]),
  );
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

function hasExplicitFileOutputIntent(userInput: string) {
  const normalized = userInput.toLowerCase();
  return (
    /进入执行模式|执行模式/.test(normalized) ||
    /(创建|新建|生成|写入|保存|导出|修改|更新|落地|实现|搭建|制作|编写|写代码|create|write|save|export|update|modify|implement|build|edit).{0,24}(文件|目录|页面|网页|组件|应用|代码|workspace|path|file|folder|directory|page|component|app|code|src\/|docs\/|\.[a-z0-9]{1,8}\b)/i.test(
      normalized,
    ) ||
    /(\.[a-z0-9]{1,8}\b|src\/|docs\/).{0,24}(创建|新建|生成|写入|保存|导出|修改|更新|create|write|save|export|update|modify|edit)/i.test(
      normalized,
    )
  );
}

function isToolAssistedAnswerIntent(userInput: string) {
  const normalized = userInput.toLowerCase();
  if (hasExplicitFileOutputIntent(normalized)) return false;
  return /web[_\s-]?(fetch|search)|https?:\/\/|网页|网址|链接|url|搜索|检索|查询|抓取|浏览|打开网页|查一下|搜一下|fetch|search|browse|lookup|look up|source|sources|citation/.test(
    normalized,
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
  onMcpConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
  approvalPolicy?: ToolExecutionPolicy;
  interruptOn?: ToolApprovalInterruptOn;
  checkpointer?: MemorySaver;
  additionalTools?: StructuredToolInterface[];
}) {
  const tools = buildMcpLangChainTools({
    servers: input.mcpServers ?? [],
    connectionsById: new Map((input.mcpConnections ?? []).map((connection) => [connection.serverId, connection])),
    workspacePath: input.workspacePath,
    onInvocation: input.onMcpInvocation,
    onConnectionUpdated: input.onMcpConnectionUpdated,
    approvalPolicy: input.approvalPolicy,
  });
  return createDeepAgent({
    name: input.name,
    model: createProviderModel(input.provider),
    systemPrompt: input.systemPrompt,
    tools: [...(input.additionalTools ?? []), ...tools],
    backend: createWorkspaceFilesystemBackend(input.workspacePath, {
      reservedReadAllowlist: [deepAgentMemoryFilePath],
    }),
    checkpointer: input.checkpointer ?? new MemorySaver(),
    memory: input.memoryPaths ?? [],
    interruptOn: input.interruptOn,
  });
}

async function invokeWorkerText(input: {
  name: string;
  provider: ProviderConfig;
  workspacePath: string;
  systemPrompt: string;
  message: string;
  attachments?: AttachmentAssetRecord[];
  threadId: string;
  memoryPaths?: string[];
  mcpServers?: McpCatalogRecord[];
  mcpConnections?: McpConnectionRecord[];
  onMcpInvocation?: (event: McpInvocationEvent) => void | Promise<void>;
  onMcpConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
  onDeepAgentToolInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  approvalPolicy?: ToolExecutionPolicy;
  interruptOn?: ToolApprovalInterruptOn;
  checkpointer?: MemorySaver;
  onToolApprovalInterrupt?: ToolApprovalInterruptHandler;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  onReasoningStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  onRuntimeError?: RuntimeErrorReporter;
  runtimeMetadata?: Record<string, unknown>;
  additionalTools?: StructuredToolInterface[];
  runtimeToolSummary?: string;
  responseLanguage?: RuntimeLanguage;
}) {
  const worker = createEphemeralWorker(input);
  const responseLanguage = input.responseLanguage ?? "zh";
  const messages = [
    {
      role: "user" as const,
      content: buildWorkerUserContent(input.message, input.attachments ?? [], responseLanguage),
    },
  ];

  if (
    ((input.provider.supportsStreaming && (input.onTextStream || input.onReasoningStream)) ||
      input.onDeepAgentToolInvocation) &&
    typeof (worker as { streamEvents?: unknown }).streamEvents === "function"
  ) {
    const streamStartedAt = Date.now();
    try {
      const result = await runDeepAgentStreamWithInterrupts({
        runner: worker as {
          streamEvents: (
            input: unknown,
            options?: Record<string, unknown>,
          ) => Promise<AsyncIterable<Record<string, unknown>>> | AsyncIterable<Record<string, unknown>>;
        },
        initialInput: { messages },
        threadId: input.threadId,
        extractHitlRequest,
        extractTextDelta: extractStreamText,
        extractReasoningDelta: extractStreamReasoningText,
        onToolApprovalInterrupt: input.onToolApprovalInterrupt,
        onToolInvocation: input.onDeepAgentToolInvocation,
        onTextStream: input.onTextStream,
        onReasoningStream: input.onReasoningStream,
        shouldStreamText: input.provider.supportsStreaming && Boolean(input.onTextStream),
        shouldStreamReasoning: input.provider.supportsStreaming && Boolean(input.onReasoningStream),
        nextEventTimeoutMs: getTeamWorkerStreamIdleTimeoutMs(),
        nextEventTimeoutMessage: "Team worker stream stalled",
      });

      const finalText = extractAgentText(result.finalOutput) || result.streamedText.trim();
      if (finalText) {
        return finalText;
      }
    } catch (error) {
      await input.onRuntimeError?.("team-worker:stream-events", error, {
        ...(input.runtimeMetadata ?? {}),
        phase: "stream",
        threadId: input.threadId,
        timeoutMs: getTeamWorkerStreamIdleTimeoutMs(),
        timedOut: isProviderTimeoutError(error),
        elapsedMs: Date.now() - streamStartedAt,
      });
      if (isProviderTimeoutError(error)) {
        throw error;
      }
      // Fallback to non-streaming invoke below after logging the stream failure.
    }
  }

  let invocationInput: unknown = { messages };
  let result: unknown = null;
  while (true) {
    result = await withRuntimeTimeout(
      (worker as {
        invoke: (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;
      }).invoke(invocationInput, { configurable: { thread_id: input.threadId } }),
      getTeamWorkerTimeoutMs(),
      "Team worker timed out",
    );
    const interruptRequest = extractHitlRequest(result);
    if (!interruptRequest) break;
    if (!input.onToolApprovalInterrupt) {
      throw new Error("Tool approval interrupt was not handled.");
    }
    invocationInput = new Command({
      resume: await input.onToolApprovalInterrupt(interruptRequest),
    });
  }
  return (
    extractAgentText(result) ||
    normalizeMessageContent(result) ||
    byLanguage(responseLanguage, {
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

function createTeamOrchestrator(input: { provider: ProviderConfig }): StructuredTeamTurnOrchestrator {
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
  const normalizedInput = input.userInput.toLowerCase();
  const prefersParallel = /并行|同时|simultaneous|in parallel|parallel/.test(normalizedInput);
  const prefersSequential =
    !prefersParallel &&
    /(先.*(再|然后)|完成后|结束后|基于.*结果|依赖|等待|after|then|once)/.test(normalizedInput);
  const namedOwners = findNamedMembersInText(input.userInput, input.members);
  const baseOwners = namedOwners.length > 0 ? namedOwners : fallback.speakers;
  let owners = Array.from(
    new Map(baseOwners.map((owner) => [owner.id, owner])).values(),
  ).slice(0, MAX_PARALLEL_TEAM_EXECUTIONS);
  if (prefersSequential && owners.length < Math.min(2, input.members.length)) {
    const existing = new Set(owners.map((owner) => owner.id));
    owners = [
      ...owners,
      ...input.members.filter((member) => !existing.has(member.id)),
    ].slice(0, Math.min(2, input.members.length));
  }

  const pathMentions = extractWorkspacePathMentions(input.userInput);
  const workItems = owners.map((owner, index) => {
    const previousOwner = owners[index - 1] ?? null;
    let readTargets: string[] = [];
    let writeTargets: string[] = [];
    if (pathMentions.length > 0) {
      if (prefersSequential && owners.length > 1) {
        if (index === 0) {
          writeTargets = pathMentions[0] ? [pathMentions[0]] : [];
        } else if (index === 1) {
          readTargets = pathMentions[0] ? [pathMentions[0]] : [];
          writeTargets = pathMentions[1] ? [pathMentions[1]] : [];
        } else {
          writeTargets = pathMentions[index] ? [pathMentions[index]] : [];
        }
      } else {
        writeTargets = pathMentions[index] ? [pathMentions[index]] : [];
      }
    }

    const targetSummary = [
      readTargets.length > 0
        ? byLanguage(input.responseLanguage, {
            zh: `读取 ${formatList(readTargets, input.responseLanguage)}`,
            en: `read ${formatList(readTargets, input.responseLanguage)}`,
          })
        : "",
      writeTargets.length > 0
        ? byLanguage(input.responseLanguage, {
            zh: `产出 ${formatList(writeTargets, input.responseLanguage)}`,
            en: `write ${formatList(writeTargets, input.responseLanguage)}`,
          })
        : "",
    ]
      .filter(Boolean)
      .join(byLanguage(input.responseLanguage, { zh: "，", en: ", " }));

    return {
      id: `work-${index + 1}`,
      owner,
      summary: byLanguage(input.responseLanguage, {
        zh: `处理“${compact(input.userInput)}”中与 ${owner.role} 相关的部分${targetSummary ? `，${targetSummary}` : ""}`,
        en: `Handle the part of "${compact(input.userInput)}" related to ${owner.role}${targetSummary ? `, ${targetSummary}` : ""}`,
      }),
      kickoffMessage:
        index === 0
          ? byLanguage(input.responseLanguage, { zh: "我先开始处理这个部分。", en: "I'll start with this part first." })
          : prefersSequential
            ? byLanguage(input.responseLanguage, { zh: "我会等前置部分完成后继续接棒。", en: "I'll wait for prerequisites to finish, then continue." })
            : byLanguage(input.responseLanguage, { zh: "我这边也同步处理一部分。", en: "I'll handle another part in parallel." }),
      readTargets,
      writeTargets,
      dependsOnAgentIds: prefersSequential && previousOwner ? [previousOwner.id] : [],
      canRunInParallel: prefersParallel || !prefersSequential,
    };
  });

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
  requiredOwnerIds: string[];
  members: AgentRecord[];
  userInput: string;
  responseLanguage: RuntimeLanguage;
}) {
  const requiredOwnerIds = Array.from(new Set(input.requiredOwnerIds));

  const memberMap = new Map(input.members.map((agent) => [agent.id, agent]));
  const fallbackByOwnerId = new Map(input.fallbackWorkItems.map((item) => [item.owner.id, item]));
  const allowedOwnerIds = requiredOwnerIds.length > 0 ? new Set(requiredOwnerIds) : null;
  const scopedWorkItems = allowedOwnerIds
    ? input.workItems.filter((item) => allowedOwnerIds.has(item.owner.id))
    : input.workItems;
  const workItems = (scopedWorkItems.length > 0 ? scopedWorkItems : input.workItems).map((item, index) => ({
    ...item,
    id: `work-${index + 1}`,
  }));
  const ownerCounts = new Map<string, number>();
  for (const item of workItems) {
    ownerCounts.set(item.owner.id, (ownerCounts.get(item.owner.id) ?? 0) + 1);
  }

  for (const agentId of requiredOwnerIds) {
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
          activeAgentId: shouldApplyTeamHandoffContinuity(input.userInput)
            ? (input.activeAgentId ?? null)
            : null,
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

export async function orchestrateTeamTurn(input: {
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
  orchestrator?: StructuredTeamTurnOrchestrator;
  responseLanguage?: RuntimeLanguage;
}) {
  const responseLanguage = input.responseLanguage ?? "zh";
  const cappedMembers = input.members.slice(0, TEAM_MEMBER_LIMIT);
  const shouldContinueHandoff = shouldApplyTeamHandoffContinuity(input.userInput);
  const effectiveHandoff = shouldContinueHandoff ? input.handoff : null;
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
    activeAgentId: effectiveHandoff?.activeAgentId ?? null,
    userInput: input.userInput,
    responseLanguage,
  });
  const forceChatForToolAssistedAnswer = isToolAssistedAnswerIntent(input.userInput);

  try {
    const orchestrator = input.orchestrator ?? createTeamOrchestrator({ provider: input.provider });
    const rawResult = await withTeamOrchestratorTimeout(
      orchestrator.invoke(
        byLanguage(responseLanguage, {
          zh: [
            "你是 teamaligned 群聊中的不可见 system orchestrator。",
            "你的任务是做群聊意图识别与回合编排：判断是 chat 还是 execute，并给出 mode / speakerIds / workItems。",
            "系统支持并行和串行执行，但必须避免文件冲突和无意义并行。执行模式必须可落地。",
            `群组最多激活 ${TEAM_MEMBER_LIMIT} 个 Agent，同时最多 ${MAX_PARALLEL_TEAM_EXECUTIONS} 个 work item 并行执行。`,
            "",
            "意图识别规则：",
            "- 明确要实现、修改、创建、修复、落地、写代码 => intent=execute",
            "- 调用 web_fetch/web_search/MCP/工具来搜索、抓取、查询、总结、回答，但没有明确要求创建/修改/保存文件 => intent=chat",
            "- 不要因为用户说“调用工具”就进入 execute；工具辅助问答仍然是 chat",
            "- 讨论、评审、问答、澄清 => intent=chat",
            "",
            "mode 规则（无论 chat/execute 都要给出）：",
            "- focused: 1-2 个 Agent",
            "- multi_voice: 2-4 个 Agent",
            "- collaboration: 3-5 个 Agent",
            "- 如果用户显式 @，这些 Agent 必须出现在 speakerIds 或 work item owner 中",
            "- 如果用户没有显式 @ 且只是普通问答/判断，优先 focused 且只选择 1 个最相关 Agent",
            "- 只有用户表达继续、接着、上面、刚才、previous、continue 等延续语义时，才沿用上一轮 handoff",
            "",
            "execute 规则：",
            "- work item 应尽量让不同角色处理不同文件或不同分工",
            "- 如果任务依赖另一个 Agent 的输出，请填写 dependsOnAgentIds",
            "- 如果两个任务可能修改相同文件，请把 canRunInParallel 设为 false",
            "- writeTargets 和 readTargets 尽量使用 workspace 相对路径",
            "- 不要虚构 writeTargets；只有用户明确给出路径或明确要求保存/生成/修改文件时才填写 writeTargets",
            "- 如果用户明确点名某些 Agent 执行，workItems 只能包含这些被点名的 Agent，除非用户明确要求其他 Agent 参与执行",
            "- 不要创建纯协调/总结 work item；协调信息放在 reason/decision，不要增加额外的协调型执行项",
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
            "- Searching, fetching, browsing, querying, summarizing, or answering with web_fetch/web_search/MCP/tools without an explicit file create/modify/save request => intent=chat",
            "- Do not choose execute just because the user asked to call a tool; tool-assisted Q&A is still chat",
            "- Discussion/review/Q&A/clarification => intent=chat",
            "",
            "Mode rules (always required):",
            "- focused: 1-2 agents",
            "- multi_voice: 2-4 agents",
            "- collaboration: 3-5 agents",
            "- If users explicitly @ mention agents, those agents must appear in speakerIds or work item owners",
            "- If there is no explicit @ and this is a normal Q&A/judgment, prefer focused with exactly 1 best-matching agent",
            "- Only continue the previous handoff when the user says continue/previous/that part/this part or an equivalent follow-up phrase",
            "",
            "Execution rules:",
            "- Work items should let different roles own different files or responsibilities",
            "- If a task depends on another agent's output, include dependsOnAgentIds",
            "- If two tasks might touch the same file, set canRunInParallel=false",
            "- Prefer workspace-relative paths for writeTargets/readTargets",
            "- Do not invent writeTargets; fill writeTargets only when the user explicitly provides a path or asks to save/generate/modify files",
            "- If the user names specific agents for execution, workItems must only contain those named agents unless the user explicitly asks others to participate",
            "- Do not create coordination-only work items; put coordination in reason/decision instead of adding an extra orchestration work item",
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
      ),
    );
    const result = teamTurnPlanSchema.parse(rawResult);
    const orchestratorIntent =
      forceChatForToolAssistedAnswer
        ? "chat"
        : result.intent === "chat" && fallback.intent === "execute" && input.explicitMentionIds.length > 0
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
            activeAgentId: effectiveHandoff?.activeAgentId ?? null,
          });
    let speakers = clampSpeakersForMode({
      mode,
      speakers: preferredSpeakers,
      members: cappedMembers,
    });
    if (orchestratorIntent === "chat" && input.explicitMentionIds.length === 0 && mode === "focused") {
      speakers = speakers.slice(0, 1);
    }

    const mappedWorkItems = mapExecutionWorkItems({
      rawWorkItems: result.workItems ?? [],
      members: cappedMembers,
      responseLanguage,
    });

    if (orchestratorIntent === "execute") {
      const candidateWorkItems = mappedWorkItems.length > 0 ? mappedWorkItems : fallback.workItems;
      const requiredOwnerIds = getRequiredExecutionOwnerIds({
        userInput: input.userInput,
        members: cappedMembers,
        explicitMentionIds: input.explicitMentionIds,
      });
      const workItems = ensureExplicitExecutionWorkItems({
        workItems: candidateWorkItems,
        fallbackWorkItems: fallback.workItems,
        explicitMentionIds: input.explicitMentionIds,
        requiredOwnerIds,
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
      const executeSpeakers = (
        input.explicitMentionIds.length > 0
          ? ensureExplicitSpeakers({
              explicitMentionIds: input.explicitMentionIds,
              speakers: workOwners.length > 0 ? workOwners : speakers,
              members: cappedMembers,
            })
          : workOwners.length > 0
            ? workOwners
            : speakers
      ).slice(0, TEAM_MEMBER_LIMIT);

      return {
        intent: "execute",
        mode,
        speakers: executeSpeakers,
        reason: orchestratorIntent !== result.intent ? fallback.reason : compact(result.reason) || fallback.reason,
        activeTask:
          orchestratorIntent !== result.intent
            ? fallback.activeTask
            : compact(result.activeTask) || compact(input.userInput),
        nextPhase:
          orchestratorIntent !== result.intent
            ? fallback.nextPhase
            : compact(result.nextPhase) ||
              byLanguage(responseLanguage, { zh: "执行中", en: "Executing" }),
        decision: orchestratorIntent !== result.intent ? fallback.decision : compact(result.decision),
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
  orchestrator?: StructuredTeamTurnOrchestrator;
  responseLanguage?: RuntimeLanguage;
}) {
  const plan = await orchestrateTeamTurn(input);
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
  orchestrator?: StructuredTeamTurnOrchestrator;
  responseLanguage?: RuntimeLanguage;
}) {
  const plan = await orchestrateTeamTurn(input);
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
  attachments?: AttachmentAssetRecord[];
  workspacePath: string;
  conversationId: string;
  runId: string;
  previousOutputs: string[];
  mcpServers: McpCatalogRecord[];
  mcpConnections: McpConnectionRecord[];
  onMcpInvocation?: (event: McpInvocationEvent) => void | Promise<void>;
  onMcpConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
  onDeepAgentToolInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  approvalPolicy?: ToolExecutionPolicy;
  interruptOn?: ToolApprovalInterruptOn;
  checkpointer?: MemorySaver;
  onToolApprovalInterrupt?: ToolApprovalInterruptHandler;
  onUpdate?: (event: {
    phase: "started" | "streaming" | "completed" | "failed";
    owner: AgentRecord;
    summary: string;
    content: string;
  }) => void | Promise<void>;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  onReasoningStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  onRuntimeError?: RuntimeErrorReporter;
  additionalTools?: StructuredToolInterface[];
  runtimeToolSummary?: string;
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
      input.runtimeToolSummary ? `可用运行时能力：\n${input.runtimeToolSummary}` : "",
      "如果只是读取或修改当前 workspace 内的本地文件，请优先使用 Workspace 工具，不要优先使用同名的 MCP 文件工具。",
      "请只在当前 workspace 内工作。",
      "使用 DeepAgent 内置 read_file/write_file/edit_file 时，请使用 workspace 相对路径或 /file 虚拟路径，不要把完整 workspace 绝对路径拼进文件名。",
      ".teamaligned 是 TeamAligned 系统保留目录，不要读取、搜索、写入或编辑其中的文件；用户产物请放在 workspace 根目录或普通子目录。",
      "如果 write_file 返回文件已存在，这不是最终答案：除非用户明确要求覆盖，请换一个描述性新文件名重试；如果需要覆盖，请先 read_file 再 edit_file。",
      "如果本次任务是创建 writeTargets 中的新文件，且 readTargets 为空，不要先读取或列出目标文件/父目录；直接调用写入工具创建文件。",
      "不要读取你正要创建的新文件，除非它明确出现在读取范围里。",
      "如果任务无法执行，请明确说明阻塞原因。",
      "",
      "本次 work item：",
      `- 摘要：${input.workItem.summary}`,
      `- 读取范围：${formatList(input.workItem.readTargets, responseLanguage)}`,
      `- 写入范围：${formatList(input.workItem.writeTargets, responseLanguage)}`,
      `- 并行：${input.workItem.canRunInParallel ? "可并行" : "需要串行"}`,
      input.workItem.writeTargets.length > 0 && input.workItem.readTargets.length === 0
        ? `- 执行顺序：第一步直接写入 ${formatList(input.workItem.writeTargets, responseLanguage)}，不要先读取或扫描目录。`
        : "",
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
      input.runtimeToolSummary ? `Available runtime capabilities:\n${input.runtimeToolSummary}` : "",
      "When the task only needs local workspace files, prefer Workspace tools over similarly named MCP file tools.",
      "Only work inside the current workspace.",
      "When using DeepAgent built-in read_file/write_file/edit_file, use workspace-relative paths or /file virtual paths. Do not include the full workspace absolute path in filenames.",
      ".teamaligned is the TeamAligned system-reserved directory. Do not read, search, write, or edit files there; place user artifacts in the workspace root or normal subdirectories.",
      "If write_file says the file already exists, that is not a final answer: unless the user explicitly asked to overwrite, retry with a descriptive new filename; if overwriting is intended, read_file first and then edit_file.",
      "If this task creates new writeTargets and readTargets is empty, do not read or list the target file/parent directory first; call a write tool directly to create the file.",
      "Do not read a file you are about to create unless it is explicitly listed in the read scope.",
      "If the task cannot proceed, clearly explain the blocker.",
      "",
      "Current work item:",
      `- Summary: ${input.workItem.summary}`,
      `- Read scope: ${formatList(input.workItem.readTargets, responseLanguage)}`,
      `- Write scope: ${formatList(input.workItem.writeTargets, responseLanguage)}`,
      `- Parallelism: ${input.workItem.canRunInParallel ? "parallel allowed" : "sequential required"}`,
      input.workItem.writeTargets.length > 0 && input.workItem.readTargets.length === 0
        ? `- Execution order: first write ${formatList(input.workItem.writeTargets, responseLanguage)} directly; do not read or scan directories first.`
        : "",
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
      input.workItem.writeTargets.length > 0 && input.workItem.readTargets.length === 0
        ? `重要：这个任务是创建新文件。你的第一步必须直接调用写入工具创建 ${formatList(input.workItem.writeTargets, responseLanguage)}，不要先读取、列目录或检查这些目标是否存在。`
        : "",
      "请直接执行，并在完成后用自然群聊口吻汇报：做了什么、结果是什么、如果改了文件请简要提及。",
    ],
    en: [
      `Original user request: ${input.userInput}`,
      `Task to execute: ${input.workItem.summary}`,
      input.workItem.writeTargets.length > 0 && input.workItem.readTargets.length === 0
        ? `Important: this task creates new files. Your first step must directly call a write tool to create ${formatList(input.workItem.writeTargets, responseLanguage)}. Do not read, list, or check those targets first.`
        : "",
      "Execute directly, then report in natural group-chat style: what you did, what result you got, and briefly mention changed files.",
    ],
  })
    .filter(Boolean)
    .join("\n");

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
      attachments: input.attachments,
      threadId: `${input.conversationId}:${input.runId}:${input.workItem.owner.id}:execution`,
      memoryPaths: [],
      mcpServers: input.mcpServers,
      mcpConnections: input.mcpConnections,
      onMcpInvocation: input.onMcpInvocation,
      onMcpConnectionUpdated: input.onMcpConnectionUpdated,
      onDeepAgentToolInvocation: input.onDeepAgentToolInvocation,
      approvalPolicy: input.approvalPolicy,
      interruptOn: input.interruptOn,
      checkpointer: input.checkpointer,
      onToolApprovalInterrupt: input.onToolApprovalInterrupt,
      onReasoningStream: input.onReasoningStream,
      onRuntimeError: input.onRuntimeError,
      runtimeMetadata: {
        conversationId: input.conversationId,
        runId: input.runId,
        agentId: input.workItem.owner.id,
        agentName: input.workItem.owner.name,
        workItemId: input.workItem.id,
        phase: "execution",
      },
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
  attachments?: AttachmentAssetRecord[];
  roundIndex: number;
  previousTurnMessages: NaturalTeamAgentMessage[];
  workspacePath: string;
  conversationId: string;
  runId: string;
  isFinalSpeaker: boolean;
  mcpServers: McpCatalogRecord[];
  mcpConnections: McpConnectionRecord[];
  onMcpInvocation?: (event: McpInvocationEvent) => void | Promise<void>;
  onMcpConnectionUpdated?: (connection: McpConnectionRecord) => void | Promise<void>;
  onDeepAgentToolInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
  approvalPolicy?: ToolExecutionPolicy;
  interruptOn?: ToolApprovalInterruptOn;
  checkpointer?: MemorySaver;
  onToolApprovalInterrupt?: ToolApprovalInterruptHandler;
  onTextStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  onReasoningStream?: (aggregatedText: string, deltaText: string) => void | Promise<void>;
  onRuntimeError?: RuntimeErrorReporter;
  additionalTools?: StructuredToolInterface[];
  runtimeToolSummary?: string;
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
      input.runtimeToolSummary ? `可用运行时能力：\n${input.runtimeToolSummary}` : "",
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
      input.runtimeToolSummary ? `Available runtime capabilities:\n${input.runtimeToolSummary}` : "",
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

  const needsWorkerTools = shouldUseWorkerToolsForNaturalChat({
    userInput: input.userInput,
    attachments: input.attachments,
  });
  const content = compact(
    needsWorkerTools
      ? await invokeWorkerText({
          name: input.speaker.name,
          provider: input.provider,
          workspacePath: input.workspacePath,
          systemPrompt,
          message,
          attachments: input.attachments,
          threadId: `${input.conversationId}:${input.runId}:${input.speaker.id}:chat:${input.roundIndex}`,
          memoryPaths: [deepAgentMemoryFilePath],
          mcpServers: input.mcpServers,
          mcpConnections: input.mcpConnections,
          onMcpInvocation: input.onMcpInvocation,
          onMcpConnectionUpdated: input.onMcpConnectionUpdated,
          onDeepAgentToolInvocation: input.onDeepAgentToolInvocation,
          approvalPolicy: input.approvalPolicy,
          interruptOn: input.interruptOn,
          checkpointer: input.checkpointer,
          onToolApprovalInterrupt: input.onToolApprovalInterrupt,
          onTextStream: input.onTextStream,
          onReasoningStream: input.onReasoningStream,
          onRuntimeError: input.onRuntimeError,
          runtimeMetadata: {
            conversationId: input.conversationId,
            runId: input.runId,
            agentId: input.speaker.id,
            agentName: input.speaker.name,
            phase: "team-chat",
            roundIndex: input.roundIndex,
          },
          responseLanguage,
          additionalTools: input.additionalTools,
        })
      : await invokeDirectTeamChatText({
          provider: input.provider,
          systemPrompt,
          message,
          onTextStream: input.onTextStream,
          onReasoningStream: input.onReasoningStream,
          onRuntimeError: input.onRuntimeError,
          runtimeMetadata: {
            conversationId: input.conversationId,
            runId: input.runId,
            agentId: input.speaker.id,
            agentName: input.speaker.name,
            phase: "team-chat-direct",
            roundIndex: input.roundIndex,
          },
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
