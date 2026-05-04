import test from "node:test";
import assert from "node:assert/strict";
import type { AgentRecord, ProviderConfig, TeamContext, TeamRecord, UserProfile } from "@teamaligned/shared";
import {
  buildNextHandoffState,
  buildExecutionBatches,
  MAX_PARALLEL_TEAM_EXECUTIONS,
  normalizeTeamHandoffState,
  orchestrateTeamTurn,
  resolveMentionedMembers,
  resolveTeamMessageMentions,
  selectNaturalTeamSpeakers,
  type TeamHandoffState,
  type TeamExecutionWorkItem,
} from "./team-runtime.ts";

function makeAgent(id: string, role: string, name = id): AgentRecord {
  return {
    id,
    name,
    role,
    avatar: id.slice(0, 1).toUpperCase(),
    avatarPath: null,
    avatarColor: "#7c3aed",
    status: "online",
    description: `${role} agent`,
    capabilities: [role],
    skillWhitelist: [],
    mcpWhitelist: [],
    workspacePath: "/tmp",
    modelId: "qwen3.6-plus",
  };
}

function makeWorkItem(
  id: string,
  owner: AgentRecord,
  input?: Partial<Omit<TeamExecutionWorkItem, "id" | "owner">>,
): TeamExecutionWorkItem {
  return {
    id,
    owner,
    summary: `${owner.name} work`,
    kickoffMessage: `${owner.name} starts`,
    readTargets: input?.readTargets ?? [],
    writeTargets: input?.writeTargets ?? [],
    dependsOnAgentIds: input?.dependsOnAgentIds ?? [],
    canRunInParallel: input?.canRunInParallel ?? true,
  };
}

test("buildExecutionBatches keeps non-conflicting parallel work in one batch", () => {
  const coder = makeAgent("agent-coder", "coder");
  const designer = makeAgent("agent-designer", "designer");

  const batches = buildExecutionBatches([
    makeWorkItem("work-1", coder, { writeTargets: ["src/app.tsx"] }),
    makeWorkItem("work-2", designer, { writeTargets: ["src/styles.css"] }),
  ]);

  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.length, 2);
});

test("buildExecutionBatches respects dependency order", () => {
  const designer = makeAgent("agent-designer", "designer");
  const coder = makeAgent("agent-coder", "coder");

  const batches = buildExecutionBatches([
    makeWorkItem("work-1", designer, { writeTargets: ["docs/wireframe.md"] }),
    makeWorkItem("work-2", coder, {
      readTargets: ["docs/wireframe.md"],
      writeTargets: ["src/app.tsx"],
      dependsOnAgentIds: [designer.id],
    }),
  ]);

  assert.equal(batches.length, 2);
  assert.deepEqual(
    batches.map((batch) => batch.map((item) => item.owner.id)),
    [[designer.id], [coder.id]],
  );
});

test("buildExecutionBatches separates write conflicts", () => {
  const coderA = makeAgent("agent-coder-a", "coder");
  const coderB = makeAgent("agent-coder-b", "coder");

  const batches = buildExecutionBatches([
    makeWorkItem("work-1", coderA, { writeTargets: ["src/main.ts"] }),
    makeWorkItem("work-2", coderB, { writeTargets: ["src/main.ts"] }),
  ]);

  assert.equal(batches.length, 2);
});

test("buildExecutionBatches separates items that explicitly disallow parallel", () => {
  const planner = makeAgent("agent-planner", "planner");
  const tester = makeAgent("agent-tester", "tester");

  const batches = buildExecutionBatches([
    makeWorkItem("work-1", planner, { canRunInParallel: false }),
    makeWorkItem("work-2", tester, { canRunInParallel: true }),
  ]);

  assert.equal(batches.length, 2);
});

test("buildExecutionBatches caps concurrent work by MAX_PARALLEL_TEAM_EXECUTIONS", () => {
  const agents = Array.from({ length: MAX_PARALLEL_TEAM_EXECUTIONS + 1 }, (_, index) =>
    makeAgent(`agent-${index + 1}`, "worker"),
  );
  const items = agents.map((agent, index) =>
    makeWorkItem(`work-${index + 1}`, agent, { writeTargets: [`tmp/${index + 1}.txt`] }),
  );

  const batches = buildExecutionBatches(items);

  assert.equal(batches[0]?.length, MAX_PARALLEL_TEAM_EXECUTIONS);
  assert.equal(batches.length, 2);
  assert.equal(batches[1]?.length, 1);
});

test("resolveMentionedMembers matches by name/id/agent-id, keeps order, and reports unresolved tokens", () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
    makeAgent("tester", "tester", "Tester"),
  ];

  const resolution = resolveMentionedMembers(
    "@Coder 请看下 @agent-designer，随后 ＠tester。还有 @coder 和 @Unknown",
    members,
  );

  assert.deepEqual(resolution.matchedIds, ["agent-coder", "agent-designer", "tester"]);
  assert.deepEqual(resolution.unresolvedTokens, ["Unknown"]);
  assert.deepEqual(
    resolution.matchedMembers.map((item) => item.name),
    ["Coder", "Designer", "Tester"],
  );
});

test("resolveTeamMessageMentions includes @user style mention and explicit agent mention", () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
  ];

  const mentions = resolveTeamMessageMentions("@你 我先做骨架，@Designer 帮忙补样式。", members, {
    name: "姜北海",
  });
  assert.deepEqual(mentions, ["agent-designer", "user"]);
});

test("resolveTeamMessageMentions recognizes profile name mention", () => {
  const members = [makeAgent("agent-coder", "coder", "Coder")];
  const mentions = resolveTeamMessageMentions("@姜北海 这是第一版输出。", members, {
    name: "姜北海",
  });
  assert.deepEqual(mentions, ["user"]);
});

test("selectNaturalTeamSpeakers keeps explicit mention order and bypasses handoff override", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
    makeAgent("agent-tester", "tester", "Tester"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await selectNaturalTeamSpeakers({
    provider,
    team,
    members,
    profile,
    context,
    handoff: {
      activeAgentId: "agent-coder",
      lastSpeakerId: "agent-coder",
      nextAgentIds: ["agent-coder"],
      reason: "上一轮接棒",
      revision: 1,
      updatedAt: Date.now(),
    },
    history: [],
    userInput: "@Designer 然后 @Coder",
    explicitMentionIds: ["agent-designer", "agent-coder"],
    mcpServers: [],
    orchestrator: {
      invoke: async () => ({
        intent: "chat",
        mode: "multi_voice",
        speakerIds: ["agent-coder"],
        reason: "orchestrator response",
        activeTask: "",
        nextPhase: "",
        decision: "",
        workItems: [],
      }),
    },
  });

  assert.deepEqual(
    result.speakers.map((item) => item.id),
    ["agent-designer", "agent-coder"],
  );
  assert.equal(result.mode, "multi_voice");
});

test("selectNaturalTeamSpeakers treats normal no-mention input as a fresh focused turn", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await selectNaturalTeamSpeakers({
    provider,
    team,
    members,
    profile,
    context,
    handoff: {
      activeAgentId: "agent-coder",
      lastSpeakerId: "agent-coder",
      nextAgentIds: ["agent-coder"],
      reason: "上一轮接棒",
      revision: 1,
      updatedAt: Date.now(),
    },
    history: [],
    userInput: "请根据这句话判断谁最适合回应：我们需要一个发布前检查清单。",
    explicitMentionIds: [],
    mcpServers: [],
    orchestrator: {
      invoke: async () => ({
        intent: "chat",
        mode: "focused",
        speakerIds: ["agent-designer", "agent-coder"],
        reason: "orchestrator response",
        activeTask: "",
        nextPhase: "",
        decision: "",
        workItems: [],
      }),
    },
  });

  assert.deepEqual(
    result.speakers.map((item) => item.id),
    ["agent-designer"],
  );
});

test("selectNaturalTeamSpeakers keeps handoff continuity for explicit follow-up wording", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await selectNaturalTeamSpeakers({
    provider,
    team,
    members,
    profile,
    context,
    handoff: {
      activeAgentId: "agent-coder",
      lastSpeakerId: "agent-coder",
      nextAgentIds: ["agent-coder"],
      reason: "上一轮接棒",
      revision: 1,
      updatedAt: Date.now(),
    },
    history: [],
    userInput: "继续这个任务，补一个实现说明。",
    explicitMentionIds: [],
    mcpServers: [],
    orchestrator: {
      invoke: async () => ({
        intent: "chat",
        mode: "focused",
        speakerIds: ["agent-designer"],
        reason: "orchestrator response",
        activeTask: "",
        nextPhase: "",
        decision: "",
        workItems: [],
      }),
    },
  });

  assert.deepEqual(
    result.speakers.map((item) => item.id),
    ["agent-coder"],
  );
});

test("orchestrateTeamTurn uses orchestrator intent for execute path", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
    makeAgent("agent-tester", "tester", "Tester"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await orchestrateTeamTurn({
    provider,
    team,
    members,
    profile,
    context,
    handoff: null,
    history: [],
    userInput: "请你们直接落地第一版页面",
    explicitMentionIds: [],
    mcpServers: [],
    orchestrator: {
      invoke: async () => ({
        intent: "execute",
        mode: "collaboration",
        speakerIds: ["agent-coder", "agent-designer", "agent-tester"],
        reason: "进入执行模式",
        activeTask: "落地第一版页面",
        nextPhase: "执行中",
        decision: "并行推进",
        workItems: [
          {
            ownerAgentId: "agent-designer",
            summary: "先出结构与样式方案",
            kickoffMessage: "我先处理页面结构。",
            readTargets: [],
            writeTargets: ["src/styles.css"],
            dependsOnAgentIds: [],
            canRunInParallel: true,
          },
          {
            ownerAgentId: "agent-coder",
            summary: "实现页面骨架",
            kickoffMessage: "我来实现页面骨架。",
            readTargets: ["src/styles.css"],
            writeTargets: ["src/app.tsx"],
            dependsOnAgentIds: ["agent-designer"],
            canRunInParallel: false,
          },
        ],
      }),
    },
  });

  assert.equal(result.intent, "execute");
  assert.equal(result.mode, "collaboration");
  assert.equal(result.workItems.length, 2);
  assert.deepEqual(
    result.workItems.map((item) => item.owner.id),
    ["agent-designer", "agent-coder"],
  );
});

test("orchestrateTeamTurn limits execution owners to agents named by the user", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
    makeAgent("agent-planner", "planner", "Planner"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await orchestrateTeamTurn({
    provider,
    team,
    members,
    profile,
    context,
    handoff: null,
    history: [],
    userInput:
      "请进入执行模式：Designer 创建 docs/replay-wireframe.md；Coder 创建 src/replay-static-page.html。这两个文件互不依赖，可以并行执行。",
    explicitMentionIds: [],
    mcpServers: [],
    orchestrator: {
      invoke: async () => ({
        intent: "execute",
        mode: "collaboration",
        speakerIds: ["agent-designer", "agent-coder", "agent-planner"],
        reason: "execute",
        activeTask: "并行执行",
        nextPhase: "执行中",
        decision: "Planner 协调，Designer/Coder 执行",
        workItems: [
          {
            ownerAgentId: "agent-designer",
            summary: "创建线框文档",
            kickoffMessage: "我创建文档。",
            readTargets: [],
            writeTargets: ["docs/replay-wireframe.md"],
            dependsOnAgentIds: [],
            canRunInParallel: true,
          },
          {
            ownerAgentId: "agent-coder",
            summary: "创建静态页面",
            kickoffMessage: "我创建页面。",
            readTargets: [],
            writeTargets: ["src/replay-static-page.html"],
            dependsOnAgentIds: [],
            canRunInParallel: true,
          },
          {
            ownerAgentId: "agent-planner",
            summary: "协调执行",
            kickoffMessage: "我来协调。",
            readTargets: [],
            writeTargets: [],
            dependsOnAgentIds: [],
            canRunInParallel: true,
          },
        ],
      }),
    },
  });

  assert.equal(result.intent, "execute");
  assert.deepEqual(
    result.workItems.map((item) => item.owner.id),
    ["agent-designer", "agent-coder"],
  );
  assert.deepEqual(
    result.speakers.map((item) => item.id),
    ["agent-designer", "agent-coder"],
  );
});

test("orchestrateTeamTurn enforces explicit mentions in speaker selection", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
    makeAgent("agent-tester", "tester", "Tester"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await orchestrateTeamTurn({
    provider,
    team,
    members,
    profile,
    context,
    handoff: null,
    history: [],
    userInput: "@Designer 你先说",
    explicitMentionIds: ["agent-designer"],
    mcpServers: [],
    orchestrator: {
      invoke: async () => ({
        intent: "chat",
        mode: "focused",
        speakerIds: ["agent-coder"],
        reason: "chat turn",
        activeTask: "",
        nextPhase: "",
        decision: "",
        workItems: [],
      }),
    },
  });

  assert.equal(result.intent, "chat");
  assert.equal(result.speakers[0]?.id, "agent-designer");
});

test("orchestrateTeamTurn keeps explicit mentions as execution owners when orchestrator omits them", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await orchestrateTeamTurn({
    provider,
    team,
    members,
    profile,
    context,
    handoff: null,
    history: [],
    userInput: "@Coder 请实现第一版页面",
    explicitMentionIds: ["agent-coder"],
    mcpServers: [],
    orchestrator: {
      invoke: async () => ({
        intent: "execute",
        mode: "focused",
        speakerIds: ["agent-designer"],
        reason: "execute",
        activeTask: "实现页面",
        nextPhase: "执行中",
        decision: "Designer 先做",
        workItems: [
          {
            ownerAgentId: "agent-designer",
            summary: "补页面结构",
            kickoffMessage: "我先处理结构。",
            readTargets: [],
            writeTargets: ["src/app.tsx"],
            dependsOnAgentIds: [],
            canRunInParallel: true,
          },
        ],
      }),
    },
  });

  assert.equal(result.intent, "execute");
  assert.equal(result.speakers[0]?.id, "agent-coder");
  assert.ok(result.workItems.some((item) => item.owner.id === "agent-coder"));
});

test("orchestrateTeamTurn upgrades explicit execution mentions when orchestrator returns chat", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await orchestrateTeamTurn({
    provider,
    team,
    members,
    profile,
    context,
    handoff: null,
    history: [],
    userInput: "@Coder 请直接创建一个静态页面",
    explicitMentionIds: ["agent-coder"],
    mcpServers: [],
    orchestrator: {
      invoke: async () => ({
        intent: "chat",
        mode: "focused",
        speakerIds: ["agent-designer"],
        reason: "chat",
        activeTask: "",
        nextPhase: "",
        decision: "",
        workItems: [],
      }),
    },
  });

  assert.equal(result.intent, "execute");
  assert.equal(result.speakers[0]?.id, "agent-coder");
  assert.equal(result.workItems[0]?.owner.id, "agent-coder");
});

test("orchestrateTeamTurn keeps explicit web fetch summaries in chat mode", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await orchestrateTeamTurn({
    provider,
    team,
    members,
    profile,
    context,
    handoff: null,
    history: [],
    userInput:
      "@Coder 请调用 web_fetch 抓取 https://example.com ，然后用一句话总结网页标题或主旨，并保留来源链接。",
    explicitMentionIds: ["agent-coder"],
    mcpServers: [],
    orchestrator: {
      invoke: async () => ({
        intent: "execute",
        mode: "focused",
        speakerIds: ["agent-coder"],
        reason: "fetch and write a summary",
        activeTask: "web_fetch summary",
        nextPhase: "执行中",
        decision: "write the summary",
        workItems: [
          {
            ownerAgentId: "agent-coder",
            summary: "Fetch example.com and write a summary",
            kickoffMessage: "I will fetch the page.",
            readTargets: [],
            writeTargets: ["output/web-fetch-summary.md"],
            dependsOnAgentIds: [],
            canRunInParallel: true,
          },
        ],
      }),
    },
  });

  assert.equal(result.intent, "chat");
  assert.equal(result.speakers[0]?.id, "agent-coder");
  assert.deepEqual(result.workItems, []);
});

test("orchestrateTeamTurn falls back safely when orchestrator fails", async () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
    makeAgent("agent-tester", "tester", "Tester"),
  ];
  const provider: ProviderConfig = {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://example.com",
    apiKey: "dummy",
    defaultModel: "qwen3.6-plus",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true,
  };
  const context: TeamContext = {
    phase: "讨论中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
  };
  const team: TeamRecord = {
    id: "team-1",
    name: "产品开发组",
    description: "",
    avatar: "产",
    avatarPath: null,
    avatarColor: "#7c3aed",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    context,
  };
  const profile: UserProfile = {
    name: "User",
    bio: "",
    avatarPath: null,
  };

  const result = await orchestrateTeamTurn({
    provider,
    team,
    members,
    profile,
    context,
    handoff: null,
    history: [],
    userInput: "hello 大家报个数",
    explicitMentionIds: [],
    mcpServers: [],
    orchestrator: {
      invoke: async () => {
        throw new Error("orchestrator unavailable");
      },
    },
  });

  assert.equal(result.intent, "chat");
  assert.equal(result.mode, "collaboration");
  assert.equal(result.speakers.length, 3);
});

test("orchestrateTeamTurn falls back quickly when orchestrator times out", async () => {
  const previousTimeout = process.env.TA_TEAM_ORCHESTRATOR_TIMEOUT_MS;
  process.env.TA_TEAM_ORCHESTRATOR_TIMEOUT_MS = "5";
  try {
    const members = [
      makeAgent("agent-coder", "coder", "Coder"),
      makeAgent("agent-designer", "designer", "Designer"),
    ];
    const provider: ProviderConfig = {
      id: "qwen",
      label: "Qwen",
      baseUrl: "https://example.com",
      apiKey: "dummy",
      defaultModel: "qwen3.6-plus",
      supportsToolCalling: true,
      supportsStreaming: true,
      isActive: true,
    };
    const context: TeamContext = {
      phase: "讨论中",
      constraints: [],
      activeTasks: [],
      recentDecisions: [],
      pinnedArtifacts: [],
      workspaceSummary: "",
    };
    const team: TeamRecord = {
      id: "team-1",
      name: "产品开发组",
      description: "",
      avatar: "产",
      avatarPath: null,
      avatarColor: "#7c3aed",
      workspacePath: "/tmp",
      memberIds: members.map((item) => item.id),
      context,
    };
    const profile: UserProfile = {
      name: "User",
      bio: "",
      avatarPath: null,
    };

    const result = await orchestrateTeamTurn({
      provider,
      team,
      members,
      profile,
      context,
      handoff: null,
      history: [],
      userInput: "@Coder 请调用 web_fetch 抓取 https://example.com 并总结。",
      explicitMentionIds: ["agent-coder"],
      mcpServers: [],
      orchestrator: {
        invoke: () => new Promise(() => {}),
      },
    });

    assert.equal(result.intent, "chat");
    assert.equal(result.speakers[0]?.id, "agent-coder");
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.TA_TEAM_ORCHESTRATOR_TIMEOUT_MS;
    } else {
      process.env.TA_TEAM_ORCHESTRATOR_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("orchestrateTeamTurn fallback preserves named sequential owners and file targets", async () => {
  const previousTimeout = process.env.TA_TEAM_ORCHESTRATOR_TIMEOUT_MS;
  process.env.TA_TEAM_ORCHESTRATOR_TIMEOUT_MS = "5";
  try {
    const members = [
      makeAgent("agent-coder", "coder", "Coder"),
      makeAgent("agent-designer", "designer", "Designer"),
      makeAgent("agent-planner", "planner", "Planner"),
    ];
    const provider: ProviderConfig = {
      id: "qwen",
      label: "Qwen",
      baseUrl: "https://example.com",
      apiKey: "dummy",
      defaultModel: "qwen3.6-plus",
      supportsToolCalling: true,
      supportsStreaming: true,
      isActive: true,
    };
    const context: TeamContext = {
      phase: "讨论中",
      constraints: [],
      activeTasks: [],
      recentDecisions: [],
      pinnedArtifacts: [],
      workspaceSummary: "",
    };
    const team: TeamRecord = {
      id: "team-1",
      name: "产品开发组",
      description: "",
      avatar: "产",
      avatarPath: null,
      avatarColor: "#7c3aed",
      workspacePath: "/tmp",
      memberIds: members.map((item) => item.id),
      context,
    };
    const profile: UserProfile = {
      name: "User",
      bio: "",
      avatarPath: null,
    };

    const result = await orchestrateTeamTurn({
      provider,
      team,
      members,
      profile,
      context,
      handoff: null,
      history: [],
      userInput:
        "请进入执行模式：Designer 必须先创建 docs/replay-design-brief.md；Coder 必须等待 Designer 完成后读取这个文件，再创建 src/replay-implementation-notes.md。",
      explicitMentionIds: [],
      mcpServers: [],
      orchestrator: {
        invoke: () => new Promise(() => {}),
      },
    });

    assert.equal(result.intent, "execute");
    assert.deepEqual(
      result.workItems.map((item) => item.owner.id),
      ["agent-designer", "agent-coder"],
    );
    assert.deepEqual(result.workItems[0]?.writeTargets, ["docs/replay-design-brief.md"]);
    assert.deepEqual(result.workItems[1]?.readTargets, ["docs/replay-design-brief.md"]);
    assert.deepEqual(result.workItems[1]?.writeTargets, ["src/replay-implementation-notes.md"]);
    assert.deepEqual(result.workItems[1]?.dependsOnAgentIds, ["agent-designer"]);
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.TA_TEAM_ORCHESTRATOR_TIMEOUT_MS;
    } else {
      process.env.TA_TEAM_ORCHESTRATOR_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("normalizeTeamHandoffState filters invalid ids and keeps only current team members", () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
  ];
  const context: TeamContext = {
    phase: "执行中",
    constraints: [],
    activeTasks: [],
    recentDecisions: [],
    pinnedArtifacts: [],
    workspaceSummary: "",
    handoff: {
      activeAgentId: "agent-coder",
      lastSpeakerId: "agent-removed",
      nextAgentIds: ["agent-designer", "agent-removed"],
      reason: "handoff",
      revision: 3,
      updatedAt: 123,
    },
  };

  const normalized = normalizeTeamHandoffState(context, members);
  assert.equal(normalized.activeAgentId, "agent-coder");
  assert.equal(normalized.lastSpeakerId, null);
  assert.deepEqual(normalized.nextAgentIds, ["agent-designer"]);
  assert.equal(normalized.revision, 3);
});

test("buildNextHandoffState maintains stable multi-round handoff transitions", () => {
  const coder = makeAgent("agent-coder", "coder", "Coder");
  const designer = makeAgent("agent-designer", "designer", "Designer");
  const tester = makeAgent("agent-tester", "tester", "Tester");
  const members = [coder, designer, tester];

  const initial: TeamHandoffState = {
    activeAgentId: coder.id,
    lastSpeakerId: null,
    nextAgentIds: [],
    reason: "start",
    revision: 0,
    updatedAt: Date.now(),
  };

  const round1 = buildNextHandoffState({
    current: initial,
    members,
    turnMessages: [
      {
        speaker: coder,
        kind: "handoff",
        content: "@Designer 你先给线框，我随后实现。",
        mentions: [designer.id],
        roundIndex: 0,
      },
    ],
    defaultSpeakerId: coder.id,
    reason: "round1",
  });

  assert.equal(round1.activeAgentId, designer.id);
  assert.equal(round1.lastSpeakerId, coder.id);
  assert.deepEqual(round1.nextAgentIds, [designer.id]);
  assert.equal(round1.revision, 1);

  const round2 = buildNextHandoffState({
    current: round1,
    members,
    turnMessages: [
      {
        speaker: designer,
        kind: "handoff",
        content: "@Tester 帮我检查一遍可读性。",
        mentions: [tester.id],
        roundIndex: 1,
      },
    ],
    defaultSpeakerId: designer.id,
    reason: "round2",
  });

  assert.equal(round2.activeAgentId, tester.id);
  assert.equal(round2.lastSpeakerId, designer.id);
  assert.deepEqual(round2.nextAgentIds, [tester.id]);
  assert.equal(round2.revision, 2);
});
