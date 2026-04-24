import test from "node:test";
import assert from "node:assert/strict";
import type { AgentRecord, ProviderConfig, TeamContext, TeamRecord, UserProfile } from "@teamaligned/shared";
import {
  buildNextHandoffState,
  buildExecutionBatches,
  MAX_PARALLEL_TEAM_EXECUTIONS,
  normalizeTeamHandoffState,
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
    objective: "协作完成任务",
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
    objective: "协作完成任务",
    workspacePath: "/tmp",
    memberIds: members.map((item) => item.id),
    mcpWhitelist: [],
    context,
  };
  const profile: UserProfile = {
    name: "User",
    role: "PM",
    team: "TeamAligned",
    email: "user@example.com",
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
  });

  assert.deepEqual(
    result.speakers.map((item) => item.id),
    ["agent-designer", "agent-coder"],
  );
  assert.equal(result.mode, "multi_voice");
});

test("normalizeTeamHandoffState filters invalid ids and keeps only current team members", () => {
  const members = [
    makeAgent("agent-coder", "coder", "Coder"),
    makeAgent("agent-designer", "designer", "Designer"),
  ];
  const context: TeamContext = {
    objective: "协作",
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
