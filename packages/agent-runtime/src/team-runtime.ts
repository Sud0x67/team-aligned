import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import type {
  AgentRecord,
  MessageVisibility,
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

type UserContactMode = "none" | "manager_relay" | "specialist_direct";

const teamPlanSchema = z.object({
  strategy: z.enum(["manager_direct", "specialist_question", "collaborate"]),
  intentSummary: z.string().default(""),
  directReply: z.string().default(""),
  kickoffReply: z.string().default(""),
  speakerSpecialistId: z.string().default(""),
  userQuestion: z.string().default(""),
  questionMode: z.enum(["manager_relay", "specialist_direct"]).default("manager_relay"),
  questionReason: z.string().default(""),
  assignments: z
    .array(
      z.object({
        specialistId: z.string(),
        task: z.string(),
        reason: z.string().default(""),
      }),
    )
    .max(3)
    .default([]),
  nextPhase: z.string().default(""),
  activeTask: z.string().default(""),
  decision: z.string().default(""),
});

type TeamPlan = {
  strategy: "manager_direct" | "specialist_question" | "collaborate";
  intentSummary: string;
  directReply: string;
  kickoffReply: string;
  speakerSpecialistId: string;
  userQuestion: string;
  questionMode: UserContactMode;
  questionReason: string;
  assignments: Array<{
    specialistId: string;
    task: string;
    reason: string;
  }>;
  nextPhase: string;
  activeTask: string;
  decision: string;
};

export type TeamAssignment = {
  specialist: AgentRecord;
  task: string;
  reason: string;
  visibility: MessageVisibility;
  userContactMode: UserContactMode;
  questionReason: string;
};

export type TeamExecutionPlan = {
  strategy: "manager_direct" | "specialist_question" | "collaborate";
  intentSummary: string;
  directReply: string;
  kickoffReply: string;
  userQuestion: string;
  questionMode: UserContactMode;
  questionReason: string;
  nextPhase: string;
  activeTask: string;
  decision: string;
  assignments: TeamAssignment[];
  speaker: AgentRecord;
};

export type TeamSpecialistOutput = {
  specialist: AgentRecord;
  task: string;
  reason: string;
  visibility: MessageVisibility;
  content: string;
  userQuestionDraft: string;
  userContactMode: UserContactMode;
};

export type TeamFinalResponse = {
  speaker: AgentRecord;
  content: string;
  summary: string;
};

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

function buildSpecialistRoster(specialists: AgentRecord[]) {
  if (specialists.length === 0) {
    return "当前没有可调度的 specialist。";
  }

  return specialists
    .map(
      (agent) =>
        `- id=${agent.id} | name=${agent.name} | role=${agent.role} | capabilities=${agent.capabilities.join("、") || "未设置"}`,
    )
    .join("\n");
}

function selectPublicHistory(history: { senderName: string; visibility: string; content: string }[]) {
  return history
    .filter((message) => message.visibility === "public")
    .slice(-8)
    .map((message) => `${message.senderName}：${compact(message.content)}`);
}

function fallbackDirectReply(manager: AgentRecord, input: string) {
  return `${manager.name}：我已经收到你的请求“${input}”。我会先给出可执行建议，并在需要时继续协调团队成员。`;
}

function fallbackKickoffReply(manager: AgentRecord, assignments: TeamAssignment[]) {
  const names = assignments.map((item) => item.specialist.name).join("、");
  return `${manager.name}：我先拉上 ${names || "团队成员"} 一起看这个问题，稍后给你一个整合后的结论。`;
}

function fallbackSpecialistKickoff(manager: AgentRecord, specialist: AgentRecord) {
  return `${manager.name}：这个问题需要 ${specialist.name} 先和你确认一个关键信息，确认后我们再继续推进。`;
}

function fallbackManagerRelayKickoff(manager: AgentRecord, specialist: AgentRecord) {
  return `${manager.name}：我先替 ${specialist.name} 确认一个关键信息，确认后我们再继续推进。`;
}

function sanitizePlan(input: {
  plan: TeamPlan;
  manager: AgentRecord;
  specialists: AgentRecord[];
  explicitMentions: Set<string>;
  userInput: string;
}) {
  const { plan, manager, specialists, explicitMentions, userInput } = input;
  const specialistMap = new Map(specialists.map((agent) => [agent.id, agent]));
  const assignments: TeamAssignment[] = [];

  for (const item of plan.assignments) {
    const specialist = specialistMap.get(item.specialistId);
    if (!specialist) continue;
    if (assignments.some((assignment) => assignment.specialist.id === specialist.id)) continue;

    assignments.push({
      specialist,
      task: compact(item.task) || `请从 ${specialist.role} 的角度处理这条请求：${userInput}`,
      reason: compact(item.reason),
      visibility: (explicitMentions.has(specialist.id) ? "public" : "internal") as MessageVisibility,
      userContactMode: "none" as UserContactMode,
      questionReason: "",
    });
  }

  if (plan.strategy === "collaborate" && assignments.length === 0) {
    assignments.push(
      ...specialists.slice(0, 2).map((specialist) => ({
        specialist,
        task: `请从 ${specialist.role} 的角度处理这条请求：${userInput}`,
        reason: "未提供有效分派，使用默认协作策略。",
        visibility: (explicitMentions.has(specialist.id) ? "public" : "internal") as MessageVisibility,
        userContactMode: "none" as UserContactMode,
        questionReason: "",
      })),
    );
  }

  const strategy =
    (plan.strategy ?? "manager_direct") === "collaborate" && assignments.length === 0
      ? "manager_direct"
      : (plan.strategy ?? "manager_direct");
  const requestedQuestionMode =
    plan.questionMode === "specialist_direct" ? "specialist_direct" : "manager_relay";

  const speaker =
    strategy === "specialist_question"
      ? specialistMap.get(plan.speakerSpecialistId) ?? assignments[0]?.specialist ?? specialists[0] ?? manager
      : manager;

  const canDirectSpecialistQuestion =
    strategy === "specialist_question" &&
    speaker.id !== manager.id &&
    requestedQuestionMode === "specialist_direct" &&
    (explicitMentions.has(speaker.id) || assignments.length <= 1);
  const questionMode: UserContactMode =
    strategy === "specialist_question"
      ? canDirectSpecialistQuestion
        ? "specialist_direct"
        : "manager_relay"
      : "none";
  const questionReason =
    compact(plan.questionReason ?? "") ||
    (questionMode === "specialist_direct"
      ? "manager 授权 specialist 直接向用户确认关键输入。"
      : questionMode === "manager_relay"
        ? "由 manager 统一向用户确认，避免主线程被多个 specialist 同时打断。"
        : "");

  if (strategy === "specialist_question" && speaker.id !== manager.id) {
    const existing = assignments.find((assignment) => assignment.specialist.id === speaker.id);
    if (existing) {
      existing.userContactMode = questionMode;
      existing.visibility = questionMode === "specialist_direct" ? "public" : "internal";
      existing.questionReason = questionReason;
    } else {
      assignments.unshift({
        specialist: speaker,
        task:
          compact(plan.userQuestion) ||
          "请直接向用户确认继续推进所需的关键信息。",
        reason: "manager 判断当前需要由 specialist 提供一条待确认问题。",
        visibility: questionMode === "specialist_direct" ? "public" : "internal",
        userContactMode: questionMode,
        questionReason,
      });
    }
  }

  return {
    strategy,
    intentSummary: compact(plan.intentSummary ?? ""),
    directReply: compact(plan.directReply ?? ""),
    kickoffReply:
      compact(plan.kickoffReply ?? "") ||
      (strategy === "specialist_question" && speaker.id !== manager.id
        ? questionMode === "specialist_direct"
          ? fallbackSpecialistKickoff(manager, speaker)
          : fallbackManagerRelayKickoff(manager, speaker)
        : strategy === "collaborate"
          ? fallbackKickoffReply(manager, assignments)
          : ""),
    userQuestion: compact(plan.userQuestion ?? ""),
    questionMode,
    questionReason,
    nextPhase: compact(plan.nextPhase ?? ""),
    activeTask: compact(plan.activeTask ?? ""),
    decision: compact(plan.decision ?? ""),
    assignments,
    speaker,
  } satisfies TeamExecutionPlan;
}

function createEphemeralWorker(input: {
  name: string;
  provider: ProviderConfig;
  workspacePath: string;
  systemPrompt: string;
  memoryPaths?: string[];
}) {
  return createDeepAgent({
    name: input.name,
    model: createProviderModel(input.provider),
    systemPrompt: input.systemPrompt,
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

export async function planTeamConversation(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  manager: AgentRecord;
  specialists: AgentRecord[];
  profile: UserProfile;
  context: TeamContext;
  history: { senderName: string; visibility: string; content: string }[];
  userInput: string;
  explicitMentionIds: string[];
}) {
  const model = createProviderModel(input.provider).withStructuredOutput(teamPlanSchema);
  const prompt = [
    `你是群组 ${input.team.name} 的 manager，名字是 ${input.manager.name}，角色是 ${input.manager.role}。`,
    "你的工作是决定这条用户消息应该直接回复、交给 specialist 提问，还是进入多人协作。",
    "请严格基于当前候选 specialist 做决策，不要编造不存在的成员。",
    "如果信息不足且最好由某位专家直接向用户确认，请选择 specialist_question。",
    "如果 manager 自己就能回答，请选择 manager_direct。",
    "如果需要多人协作，请选择 collaborate。",
    "",
    "当前用户资料：",
    `- 姓名：${input.profile.name}`,
    `- 角色：${input.profile.role || "未设置"}`,
    `- 团队：${input.profile.team || "未设置"}`,
    "",
    "群组上下文：",
    buildContextText(input.team, input.context),
    "",
    "候选 specialist：",
    buildSpecialistRoster(input.specialists),
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
    "- strategy 只能是 manager_direct / specialist_question / collaborate",
    "- 如果是 collaborate，请给出 assignments",
    "- 如果是 specialist_question，请尽量给出 speakerSpecialistId、userQuestion 和 kickoffReply",
    "- assignments.specialistId 必须来自候选 specialist 的 id",
    "- directReply / kickoffReply / userQuestion 都应尽量简洁，贴近群聊口吻",
    "- 决策应尽量使用与用户相同的语言",
  ].join("\n");

  const rawPlan = teamPlanSchema.parse(await model.invoke(prompt));
  const plan: TeamPlan = {
    strategy: rawPlan.strategy ?? "manager_direct",
    intentSummary: rawPlan.intentSummary ?? "",
    directReply: rawPlan.directReply ?? "",
    kickoffReply: rawPlan.kickoffReply ?? "",
    speakerSpecialistId: rawPlan.speakerSpecialistId ?? "",
    userQuestion: rawPlan.userQuestion ?? "",
    questionMode: rawPlan.questionMode ?? "manager_relay",
    questionReason: rawPlan.questionReason ?? "",
    assignments: rawPlan.assignments ?? [],
    nextPhase: rawPlan.nextPhase ?? "",
    activeTask: rawPlan.activeTask ?? "",
    decision: rawPlan.decision ?? "",
  };
  return sanitizePlan({
    plan,
    manager: input.manager,
    specialists: input.specialists,
    explicitMentions: new Set(input.explicitMentionIds),
    userInput: input.userInput,
  });
}

export async function runSpecialistAssignment(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  manager: AgentRecord;
  assignment: TeamAssignment;
  profile: UserProfile;
  context: TeamContext;
  userInput: string;
  workspacePath: string;
  conversationId: string;
  runId: string;
}) {
  const { assignment } = input;
  if (assignment.userContactMode === "manager_relay" || assignment.userContactMode === "specialist_direct") {
    const questionSchema = z.object({
      internalNote: z.string().default(""),
      userQuestionDraft: z.string().default(""),
    });
    const questionModel = createProviderModel(input.provider).withStructuredOutput(questionSchema);
    const result = questionSchema.parse(
      await questionModel.invoke([
        `你是群组 ${input.team.name} 中的 specialist：${assignment.specialist.name}。`,
        `你的角色：${assignment.specialist.role}。`,
        `群组的 manager 是 ${input.manager.name}。`,
        `当前用户：${input.profile.name} / ${input.profile.role || "未设置"}。`,
        `当前任务：${assignment.task}`,
        `用户原始请求：${input.userInput}`,
        assignment.reason ? `分配原因：${assignment.reason}` : "",
        `用户交互方式：${assignment.userContactMode}`,
        `交互原因：${assignment.questionReason}`,
        "",
        "请输出两部分：",
        "- internalNote：给 manager 的内部说明，解释为什么需要确认",
        "- userQuestionDraft：要确认的那一句问题",
        "",
        assignment.userContactMode === "specialist_direct"
          ? "因为本次已授权你直接向用户确认，所以 userQuestionDraft 必须是你会直接发给用户的单句问题。"
          : "因为本次由 manager 代为确认，所以 userQuestionDraft 必须是可由 manager 转述的单句问题。",
        "两段都应简洁、具体、使用与用户一致的语言，不要输出多余前后缀。",
      ].join("\n")),
    );

    return {
      specialist: assignment.specialist,
      task: assignment.task,
      reason: assignment.reason,
      visibility: assignment.visibility,
      content:
        compact(result.internalNote) ||
        `建议向用户确认：${compact(result.userQuestionDraft) || assignment.task}`,
      userQuestionDraft: compact(result.userQuestionDraft) || assignment.task,
      userContactMode: assignment.userContactMode,
    } satisfies TeamSpecialistOutput;
  }

  const specialistPrompt = [
    `你是群组 ${input.team.name} 中的 specialist：${assignment.specialist.name}。`,
    `你的角色：${assignment.specialist.role}。`,
    `群组的 manager 是 ${input.manager.name}。`,
    "你正在 teamaligned 的本地群组运行时中协作，请像一个资深专业成员一样给出可执行反馈。",
    "默认你是在给 manager 回报，不要直接对用户下结论，也不要自称是 manager。",
    "如果任务信息不足，可以明确指出缺口，但先给出你目前能判断的内容。",
    "回复尽量简洁、具体、可执行，优先使用与用户相同的语言。",
    "",
    "群组上下文：",
    buildContextText(input.team, input.context),
    "",
    `当前用户：${input.profile.name} / ${input.profile.role || "未设置"}`,
    `当前任务：${assignment.task}`,
  ].join("\n");

  const workerMessage = [
    `用户原始请求：${input.userInput}`,
    `manager 分配给你的子任务：${assignment.task}`,
    assignment.reason ? `分配原因：${assignment.reason}` : "",
    "请从你的角色出发给出阶段性建议、风险和下一步动作。",
  ]
    .filter(Boolean)
    .join("\n");

  const content = await invokeWorkerText({
    name: assignment.specialist.name,
    provider: input.provider,
    workspacePath: input.workspacePath,
    systemPrompt: specialistPrompt,
    message: workerMessage,
    threadId: `${input.conversationId}:${input.runId}:${assignment.specialist.id}`,
    memoryPaths: ["/memory/MEMORY.md"],
  });

  return {
    specialist: assignment.specialist,
    task: assignment.task,
    reason: assignment.reason,
    visibility: assignment.visibility,
    content,
    userQuestionDraft: "",
    userContactMode: "none",
  } satisfies TeamSpecialistOutput;
}

export async function summarizeTeamConversation(input: {
  provider: ProviderConfig;
  team: TeamRecord;
  manager: AgentRecord;
  profile: UserProfile;
  context: TeamContext;
  userInput: string;
  intentSummary: string;
  specialistOutputs: TeamSpecialistOutput[];
  workspacePath: string;
  conversationId: string;
  runId: string;
}) {
  const summaryPrompt = [
    `你是群组 ${input.team.name} 的 manager：${input.manager.name}。`,
    "你要把多位 specialist 的内部反馈整理成一条面向用户的自然群聊回复。",
    "保持像真实团队负责人一样沟通：简洁、清晰、可信、可执行。",
    "不要原样转抄内部过程；可以适度总结不同 specialist 的观点。",
    "如果存在明显风险或待确认项，请在回复里直接说清楚。",
    "请优先使用与用户相同的语言。",
    "",
    "群组上下文：",
    buildContextText(input.team, input.context),
    "",
    `当前用户：${input.profile.name} / ${input.profile.role || "未设置"}`,
  ].join("\n");

  const message = [
    `用户原始请求：${input.userInput}`,
    input.intentSummary ? `本轮意图摘要：${input.intentSummary}` : "",
    "specialist 内部反馈：",
    ...input.specialistOutputs.map(
      (item, index) =>
        `${index + 1}. ${item.specialist.name}（${item.specialist.role}）\n任务：${item.task}\n反馈：${item.content}`,
    ),
    "",
    "请输出一条发给用户的最终回复，尽量包含：当前判断、建议动作、下一步。",
  ]
    .filter(Boolean)
    .join("\n");

  const content = await invokeWorkerText({
    name: input.manager.name,
    provider: input.provider,
    workspacePath: input.workspacePath,
    systemPrompt: summaryPrompt,
    message,
    threadId: `${input.conversationId}:${input.runId}:manager-summary`,
    memoryPaths: ["/memory/MEMORY.md"],
  });

  return {
    speaker: input.manager,
    content,
    summary: compact(content),
  } satisfies TeamFinalResponse;
}
