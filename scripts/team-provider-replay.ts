import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";
import { TeamalignedRuntime } from "@teamaligned/agent-runtime";
import type {
  AgentRecord,
  AppSnapshot,
  AttachmentAssetRecord,
  MessageRecord,
  ProviderConfig,
  RunRecord,
  TeamRecord,
  ToolInvocationRecord,
} from "@teamaligned/shared";

const terminalRunStatuses = new Set(["completed", "failed", "cancelled"]);
const defaultTimeoutMs = Number(process.env.TA_REPLAY_TIMEOUT_MS ?? 180_000);
const tinyRedPngDataUrl = createSolidRedPngDataUrl();

type ScenarioResult = {
  name: string;
  ok: boolean;
  details: string[];
  runStatus?: RunRecord["status"];
  durationMs?: number;
};

type ScenarioData = {
  before: AppSnapshot;
  after: AppSnapshot;
  newMessages: MessageRecord[];
  newRuns: RunRecord[];
  newToolInvocations: ToolInvocationRecord[];
  team: TeamRecord;
};

type DirectScenarioData = Omit<ScenarioData, "team"> & {
  agent: AgentRecord;
};

type ScenarioInput = Parameters<typeof runScenario>[0];
type ReplayScenarioInput = Omit<ScenarioInput, "runtime" | "conversationId" | "teamId" | "attachments"> & {
  withImageAttachment?: boolean;
};

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createSolidRedPngDataUrl() {
  const width = 32;
  const height = 32;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLength = 1 + width * 4;
  const pixels = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    pixels[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 255;
    }
  }

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function readProviderFromEnv(): ProviderConfig | null {
  const raw = process.env.TA_REPLAY_PROVIDER_JSON;
  if (!raw) return null;
  const provider = JSON.parse(raw) as ProviderConfig;
  return provider.apiKey?.trim() ? provider : null;
}

function readActiveProviderFromDb(rootDir: string): ProviderConfig | null {
  const dbPath = join(rootDir, "app.db");
  if (!existsSync(dbPath)) return null;

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const activeProviderId = (
      db
        .prepare("SELECT value FROM settings_entries WHERE key = ?")
        .get("settings.activeProviderId") as { value?: string } | undefined
    )?.value;
    const rows = db.prepare("SELECT id, is_active, payload FROM providers").all() as Array<{
      id: string;
      is_active: number;
      payload: string;
    }>;
    const selected =
      rows.find((row) => row.id === activeProviderId) ??
      rows.find((row) => row.is_active === 1) ??
      null;
    if (!selected) return null;
    const provider = JSON.parse(selected.payload) as ProviderConfig;
    return provider.apiKey?.trim() ? provider : null;
  } finally {
    db.close();
  }
}

function redactProvider(provider: ProviderConfig) {
  return {
    id: provider.id,
    label: provider.label,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    supportsToolCalling: provider.supportsToolCalling,
    supportsStreaming: provider.supportsStreaming,
    isActive: provider.isActive,
    apiKey: provider.apiKey ? "<redacted>" : "",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTeamConversation(snapshot: AppSnapshot) {
  const team = snapshot.teams.find((item) => item.id === "team-product") ?? snapshot.teams[0];
  if (!team) {
    throw new Error("No default group is available for replay.");
  }
  const conversation = snapshot.conversations.find(
    (item) => item.kind === "team" && item.targetId === team.id,
  );
  if (!conversation) {
    throw new Error(`No conversation found for group ${team.name}.`);
  }
  return { team, conversation };
}

function getDirectReplayAgent(snapshot: AppSnapshot) {
  const agent = snapshot.agents.find((item) => item.id === "agent-coder") ?? snapshot.agents[0];
  if (!agent) {
    throw new Error("No default Agent is available for replay.");
  }
  return agent;
}

function getDirectAgentConversation(snapshot: AppSnapshot) {
  const agent = getDirectReplayAgent(snapshot);
  const conversation = snapshot.conversations.find(
    (item) => item.kind === "agent" && item.targetId === agent.id,
  );
  if (!conversation) {
    throw new Error(`No conversation found for Agent ${agent.name}.`);
  }
  return { agent, conversation };
}

function getConversationMessages(snapshot: AppSnapshot, conversationId: string) {
  return snapshot.messages[conversationId] ?? [];
}

function getNewMessages(
  before: AppSnapshot,
  after: AppSnapshot,
  conversationId: string,
) {
  const beforeIds = new Set(getConversationMessages(before, conversationId).map((message) => message.id));
  return getConversationMessages(after, conversationId).filter((message) => !beforeIds.has(message.id));
}

function getNewRuns(before: AppSnapshot, after: AppSnapshot, conversationId: string) {
  const beforeIds = new Set(before.runs.map((run) => run.id));
  return after.runs.filter((run) => run.conversationId === conversationId && !beforeIds.has(run.id));
}

function getNewToolInvocations(before: AppSnapshot, after: AppSnapshot, conversationId: string) {
  const beforeIds = new Set(before.toolInvocations.map((item) => item.id));
  return after.toolInvocations.filter(
    (item) => item.conversationId === conversationId && !beforeIds.has(item.id),
  );
}

function latestRun(snapshot: AppSnapshot, conversationId: string) {
  return snapshot.runs.find((run) => run.conversationId === conversationId) ?? null;
}

async function waitForLatestRun(
  runtime: TeamalignedRuntime,
  conversationId: string,
  previousRunIds: Set<string>,
  timeoutMs = defaultTimeoutMs,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = runtime.getConversationSnapshot(conversationId);
    const run = snapshot.runs.find(
      (item) => item.conversationId === conversationId && !previousRunIds.has(item.id),
    );
    if (run && terminalRunStatuses.has(run.status)) {
      return run;
    }
    await sleep(500);
  }
  const current = latestRun(runtime.getConversationSnapshot(conversationId), conversationId);
  throw new Error(`Timed out waiting for run completion. Latest status: ${current?.status ?? "none"}`);
}

function hasTeamUpdate(messages: MessageRecord[], stage: string) {
  return messages.some(
    (message) =>
      message.metadata?.teamUpdate === true &&
      message.metadata?.stage === stage,
  );
}

function hasAgentMessage(messages: MessageRecord[], senderName: string) {
  return messages.some(
    (message) =>
      message.visibility === "public" &&
      message.senderKind === "agent" &&
      message.senderName === senderName &&
      message.messageType === "agent",
  );
}

function visibleAgentSenders(messages: MessageRecord[]) {
  return Array.from(
    new Set(
      messages
        .filter(
          (message) =>
            message.visibility === "public" &&
            message.senderKind === "agent" &&
            message.messageType === "agent",
        )
        .map((message) => message.senderName),
    ),
  );
}

async function runScenario(input: {
  runtime: TeamalignedRuntime;
  conversationId: string;
  teamId: string;
  name: string;
  userInput: string;
  attachments?: AttachmentAssetRecord[];
  cancelAfterMs?: number;
  timeoutMs?: number;
  validate: (data: ScenarioData) => string[];
}) {
  const startedAt = Date.now();
  const before = input.runtime.getConversationSnapshot(input.conversationId);
  const previousRunIds = new Set(before.runs.map((run) => run.id));

  const sendPromise = input.runtime.sendInput({
    conversationId: input.conversationId,
    input: input.userInput,
    attachments: input.attachments,
  });
  if (input.cancelAfterMs !== undefined) {
    setTimeout(() => {
      void input.runtime.controlRun({ conversationId: input.conversationId, action: "cancel" });
    }, input.cancelAfterMs);
  }
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    sendPromise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        void input.runtime.controlRun({ conversationId: input.conversationId, action: "cancel" });
        reject(new Error(`Scenario timed out after ${timeoutMs}ms: ${input.name}`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });

  let run: RunRecord | null = null;
  if (!input.userInput.trim().startsWith("/clear")) {
    run = await waitForLatestRun(input.runtime, input.conversationId, previousRunIds);
  } else {
    await sleep(500);
  }

  const after = input.runtime.getConversationSnapshot(input.conversationId);
  const team = after.teams.find((item) => item.id === input.teamId);
  if (!team) throw new Error(`Team disappeared during replay: ${input.teamId}`);

  const details = input.validate({
    before,
    after,
    newMessages: getNewMessages(before, after, input.conversationId),
    newRuns: getNewRuns(before, after, input.conversationId),
    newToolInvocations: getNewToolInvocations(before, after, input.conversationId),
    team,
  });

  return {
    name: input.name,
    ok: details.length === 0,
    details,
    runStatus: run?.status,
    durationMs: Date.now() - startedAt,
  } satisfies ScenarioResult;
}

async function runDirectScenario(input: {
  runtime: TeamalignedRuntime;
  conversationId: string;
  agentId: string;
  name: string;
  userInput: string;
  attachments?: AttachmentAssetRecord[];
  cancelAfterMs?: number;
  timeoutMs?: number;
  validate: (data: DirectScenarioData) => string[];
}) {
  const startedAt = Date.now();
  const before = input.runtime.getConversationSnapshot(input.conversationId);
  const previousRunIds = new Set(before.runs.map((run) => run.id));

  const sendPromise = input.runtime.sendInput({
    conversationId: input.conversationId,
    input: input.userInput,
    attachments: input.attachments,
  });
  if (input.cancelAfterMs !== undefined) {
    setTimeout(() => {
      void input.runtime.controlRun({ conversationId: input.conversationId, action: "cancel" });
    }, input.cancelAfterMs);
  }
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    sendPromise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        void input.runtime.controlRun({ conversationId: input.conversationId, action: "cancel" });
        reject(new Error(`Scenario timed out after ${timeoutMs}ms: ${input.name}`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });

  let run: RunRecord | null = null;
  if (!input.userInput.trim().startsWith("/clear")) {
    run = await waitForLatestRun(input.runtime, input.conversationId, previousRunIds);
  } else {
    await sleep(500);
  }

  const after = input.runtime.getConversationSnapshot(input.conversationId);
  const agent = after.agents.find((item) => item.id === input.agentId);
  if (!agent) throw new Error(`Agent disappeared during replay: ${input.agentId}`);

  const details = input.validate({
    before,
    after,
    newMessages: getNewMessages(before, after, input.conversationId),
    newRuns: getNewRuns(before, after, input.conversationId),
    newToolInvocations: getNewToolInvocations(before, after, input.conversationId),
    agent,
  });

  return {
    name: input.name,
    ok: details.length === 0,
    details,
    runStatus: run?.status,
    durationMs: Date.now() - startedAt,
  } satisfies ScenarioResult;
}

function assertRunCompleted(data: ScenarioData) {
  const run = data.newRuns[0];
  return run?.status === "completed" ? [] : [`expected completed run, got ${run?.status ?? "none"}`];
}

function assertDirectRunCompleted(data: DirectScenarioData) {
  const run = data.newRuns[0];
  return run?.status === "completed" ? [] : [`expected completed run, got ${run?.status ?? "none"}`];
}

function printResult(result: ScenarioResult) {
  const mark = result.ok ? "PASS" : "FAIL";
  const status = result.runStatus ? ` (${result.runStatus})` : "";
  const duration = result.durationMs === undefined ? "" : ` ${Math.round(result.durationMs / 1000)}s`;
  console.log(`${mark} ${result.name}${status}${duration}`);
  for (const detail of result.details) {
    console.log(`  - ${detail}`);
  }
}

async function main() {
  const provider =
    readProviderFromEnv() ??
    readActiveProviderFromDb(process.env.TEAMALIGNED_REAL_ROOT ?? join(homedir(), ".teamaligned"));
  if (!provider) {
    console.error(
      "SKIP: no active Provider with API key found. Configure TeamAligned or set TA_REPLAY_PROVIDER_JSON.",
    );
    process.exitCode = 2;
    return;
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "teamaligned-provider-replay-"));

  console.log("TeamAligned real Provider replay");
  console.log(`Temp root: ${tempRoot}`);
  console.log(`Provider: ${JSON.stringify(redactProvider(provider))}`);

  const results: ScenarioResult[] = [];
  const onlyScenarios = new Set(
    (process.env.TA_REPLAY_ONLY ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  const createScenarioRuntime = async (scenarioName: string) => {
    const scenarioRoot = join(
      tempRoot,
      scenarioName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    );
    mkdirSync(scenarioRoot, { recursive: true });
    const runtime = new TeamalignedRuntime(scenarioRoot);
    await runtime.init();
    await runtime.updateSettings({ language: "zh", onboardingCompleted: true });
    await runtime.updateProvider({ ...provider, isActive: true });

    const snapshot = runtime.getSnapshot();
    const { team, conversation } = getTeamConversation(snapshot);
    return { runtime, team, conversation, scenarioRoot };
  };
  const createDirectScenarioRuntime = async (scenarioName: string) => {
    const scenarioRoot = join(
      tempRoot,
      scenarioName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    );
    mkdirSync(scenarioRoot, { recursive: true });
    const runtime = new TeamalignedRuntime(scenarioRoot);
    await runtime.init();
    await runtime.updateSettings({ language: "zh", onboardingCompleted: true });
    await runtime.updateProvider({ ...provider, isActive: true });

    const snapshot = runtime.getSnapshot();
    const agent = getDirectReplayAgent(snapshot);
    const existingConversation = snapshot.conversations.find(
      (item) => item.kind === "agent" && item.targetId === agent.id,
    );
    const ensuredConversation =
      existingConversation ??
      (
        await runtime.ensureConversation({
          kind: "agent",
          targetId: agent.id,
        })
      ).snapshot.conversations.find((item) => item.kind === "agent" && item.targetId === agent.id);
    if (!ensuredConversation) {
      throw new Error(`No conversation found for Agent ${agent.name}.`);
    }
    const { conversation } = getDirectAgentConversation(
      existingConversation ? snapshot : runtime.getConversationSnapshot(ensuredConversation.id),
    );
    return { runtime, agent, conversation, scenarioRoot };
  };

  const recordScenario = async (input: ReplayScenarioInput) => {
    if (onlyScenarios.size > 0 && !onlyScenarios.has(input.name.toLowerCase())) {
      return null;
    }
    console.log("");
    console.log(`START ${input.name}`);
    const startedAt = Date.now();
    try {
      const { withImageAttachment, ...scenarioInput } = input;
      const { runtime, team, conversation, scenarioRoot } = await createScenarioRuntime(input.name);
      const attachments = withImageAttachment
        ? [
            await runtime.saveAttachmentAsset({
              conversationId: conversation.id,
              dataUrl: tinyRedPngDataUrl,
              fileName: "red-dot.png",
            }),
          ]
        : undefined;
      console.log(`  Conversation: ${conversation.title} (${conversation.id})`);
      console.log(`  Scenario root: ${scenarioRoot}`);
      const result = await runScenario({
        ...scenarioInput,
        runtime,
        conversationId: conversation.id,
        teamId: team.id,
        attachments,
      });
      results.push(result);
      printResult(result);
      return result;
    } catch (error) {
      const result = {
        name: input.name,
        ok: false,
        details: [error instanceof Error ? error.message : String(error)],
        durationMs: Date.now() - startedAt,
      } satisfies ScenarioResult;
      results.push(result);
      printResult(result);
      return result;
    }
  };

  const recordDirectScenario = async (
    input: Omit<Parameters<typeof runDirectScenario>[0], "runtime" | "conversationId" | "agentId" | "attachments"> & {
      withImageAttachment?: boolean;
    },
  ) => {
    if (onlyScenarios.size > 0 && !onlyScenarios.has(input.name.toLowerCase())) {
      return null;
    }
    console.log("");
    console.log(`START ${input.name}`);
    const startedAt = Date.now();
    try {
      const { withImageAttachment, ...scenarioInput } = input;
      const { runtime, agent, conversation, scenarioRoot } = await createDirectScenarioRuntime(input.name);
      const attachments = withImageAttachment
        ? [
            await runtime.saveAttachmentAsset({
              conversationId: conversation.id,
              dataUrl: tinyRedPngDataUrl,
              fileName: "red-dot.png",
            }),
          ]
        : undefined;
      console.log(`  Conversation: ${conversation.title} (${conversation.id})`);
      console.log(`  Scenario root: ${scenarioRoot}`);
      const result = await runDirectScenario({
        ...scenarioInput,
        runtime,
        conversationId: conversation.id,
        agentId: agent.id,
        attachments,
      });
      results.push(result);
      printResult(result);
      return result;
    } catch (error) {
      const result = {
        name: input.name,
        ok: false,
        details: [error instanceof Error ? error.message : String(error)],
        durationMs: Date.now() - startedAt,
      } satisfies ScenarioResult;
      results.push(result);
      printResult(result);
      return result;
    }
  };

  const recordDirectRetryScenario = async () => {
    const name = "direct retry repeated message";
    if (onlyScenarios.size > 0 && !onlyScenarios.has(name.toLowerCase())) {
      return null;
    }
    console.log("");
    console.log(`START ${name}`);
    const startedAt = Date.now();
    try {
      const { runtime, agent, conversation, scenarioRoot } = await createDirectScenarioRuntime(name);
      console.log(`  Conversation: ${conversation.title} (${conversation.id})`);
      console.log(`  Scenario root: ${scenarioRoot}`);
      const inputText = "请只用一句话回复：RETRY-OK。";
      const first = await runDirectScenario({
        runtime,
        conversationId: conversation.id,
        agentId: agent.id,
        name: `${name} / first`,
        userInput: inputText,
        validate: (data) => [
          ...assertDirectRunCompleted(data),
          ...(hasAgentMessage(data.newMessages, data.agent.name) ? [] : ["first reply missing"]),
        ],
      });
      const second = await runDirectScenario({
        runtime,
        conversationId: conversation.id,
        agentId: agent.id,
        name: `${name} / retry`,
        userInput: inputText,
        validate: (data) => [
          ...assertDirectRunCompleted(data),
          ...(hasAgentMessage(data.newMessages, data.agent.name) ? [] : ["retry reply missing"]),
        ],
      });
      const after = runtime.getConversationSnapshot(conversation.id);
      const agentReplies = getConversationMessages(after, conversation.id).filter(
        (message) => message.senderKind === "agent" && message.senderName === agent.name,
      );
      const details = [
        ...first.details.map((detail) => `first: ${detail}`),
        ...second.details.map((detail) => `retry: ${detail}`),
        ...(agentReplies.length >= 2 ? [] : [`expected at least 2 agent replies, got ${agentReplies.length}`]),
      ];
      const result = {
        name,
        ok: details.length === 0,
        details,
        runStatus: second.runStatus,
        durationMs: Date.now() - startedAt,
      } satisfies ScenarioResult;
      results.push(result);
      printResult(result);
      return result;
    } catch (error) {
      const result = {
        name,
        ok: false,
        details: [error instanceof Error ? error.message : String(error)],
        durationMs: Date.now() - startedAt,
      } satisfies ScenarioResult;
      results.push(result);
      printResult(result);
      return result;
    }
  };

  await recordDirectScenario({
    name: "direct streaming markdown",
    userInput:
      "请输出一段较长 Markdown：包含二级标题、3 条列表、一个 TypeScript 多行代码块，最后写一句简短总结。",
    validate: (data) => {
      const run = data.newRuns[0];
      const agentMessage = data.newMessages.find(
        (message) => message.senderKind === "agent" && message.senderName === data.agent.name,
      );
      return [
        ...assertDirectRunCompleted(data),
        ...(!provider.supportsStreaming || typeof run?.metadata?.streamMessageId === "string"
          ? []
          : ["streaming message id missing"]),
        ...(agentMessage?.content.includes("```") ? [] : ["markdown code fence missing"]),
        ...((agentMessage?.content.length ?? 0) >= 160 ? [] : ["markdown response was too short"]),
      ];
    },
  });

  await recordDirectScenario({
    name: "direct image attachment",
    userInput: "请看这张图片，只回答主色是什么。",
    withImageAttachment: true,
    validate: (data) => [
      ...assertDirectRunCompleted(data),
      ...(data.newMessages.some((message) => /红|red/i.test(message.content)) ? [] : ["reply did not mention red"]),
    ],
  });

  await recordDirectRetryScenario();

  await recordDirectScenario({
    name: "direct cancel",
    userInput: "请写一篇很长的分析，尽量分多段展开。",
    cancelAfterMs: 250,
    validate: (data) => {
      const run = data.newRuns[0];
      return [
        ...(run?.status === "cancelled" ? [] : [`expected cancelled run, got ${run?.status ?? "none"}`]),
        ...(data.newMessages.some((message) => /取消|cancel/i.test(message.content))
          ? []
          : ["cancel feedback message missing"]),
      ];
    },
  });

  await recordDirectScenario({
    name: "direct clear resets context",
    userInput: "/clear",
    validate: (data) => {
      const conversationId = data.before.conversations.find(
        (item) => item.kind === "agent" && item.targetId === data.agent.id,
      )?.id;
      const messagesAfterClear = conversationId
        ? getConversationMessages(data.after, conversationId)
        : [];
      return [
        ...(messagesAfterClear.length <= 1
          ? []
          : [`expected only clear feedback after /clear, got ${messagesAfterClear.length} messages`]),
        ...(data.after.runs.length === 0 ? [] : [`expected 0 runs after /clear, got ${data.after.runs.length}`]),
      ];
    },
  });

  await recordScenario({
      name: "@ specified Agent",
      userInput: "@Coder 用一句话确认你收到了，只需要 Coder 回复。",
      validate: (data) => [
        ...assertRunCompleted(data),
        ...(!hasAgentMessage(data.newMessages, "Coder") ? ["Coder did not produce a public reply"] : []),
        ...(visibleAgentSenders(data.newMessages).filter((name) => name !== "Coder").length > 0
          ? [`unexpected extra agent speakers: ${visibleAgentSenders(data.newMessages).join(", ")}`]
          : []),
        ...(!hasTeamUpdate(data.newMessages, "selection") ? ["selection process message missing"] : []),
      ],
    });

  await recordScenario({
      name: "semantic speaker selection without @",
      userInput: "请根据这句话判断谁最适合回应：我们需要一个发布前检查清单。",
      validate: (data) => [
        ...assertRunCompleted(data),
        ...(visibleAgentSenders(data.newMessages).length === 0
          ? ["no Agent produced a public reply"]
          : []),
        ...(!hasTeamUpdate(data.newMessages, "selection") ? ["selection process message missing"] : []),
      ],
    });

  await recordScenario({
      name: "multi-round handoff",
      userInput:
        "@Designer 先用一句话给一个页面结构建议，并明确 @Coder 接棒补一句实现建议。Coder 被 @ 后请继续回答一句。",
      validate: (data) => [
        ...assertRunCompleted(data),
        ...(!hasAgentMessage(data.newMessages, "Designer") ? ["Designer did not reply"] : []),
        ...(!hasAgentMessage(data.newMessages, "Coder") ? ["Coder did not reply after handoff"] : []),
        ...(!hasTeamUpdate(data.newMessages, "handoff") ? ["handoff process message missing"] : []),
      ],
    });

  await recordScenario({
      name: "parallel execution",
      userInput:
        "请进入执行模式：Designer 创建 docs/replay-wireframe.md 写 3 条页面结构建议；Coder 创建 src/replay-static-page.html 写一个极简静态页面。这两个文件互不依赖，可以并行执行。",
      validate: (data) => [
        ...assertRunCompleted(data),
        ...(!hasTeamUpdate(data.newMessages, "execution_batch") ? ["parallel batch process message missing"] : []),
        ...(data.newToolInvocations.some(
          (item) =>
            item.toolName === "write_file" ||
            item.toolName === "write_text_file" ||
            item.toolName === "workspace_write_text_file",
        )
          ? []
          : ["write_text_file was not invoked"]),
      ],
    });

  await recordScenario({
      name: "dependency waiting",
      userInput:
        "请进入执行模式：Designer 必须先创建 docs/replay-design-brief.md；Coder 必须等待 Designer 完成后读取这个文件，再创建 src/replay-implementation-notes.md。",
      validate: (data) => [
        ...assertRunCompleted(data),
        ...(!hasTeamUpdate(data.newMessages, "execution_waiting") ? ["dependency waiting process message missing"] : []),
        ...(data.newToolInvocations.some(
          (item) =>
            item.toolName === "read_file" ||
            item.toolName === "read_text_file" ||
            item.toolName === "workspace_read_text_file",
        )
          ? []
          : ["read_text_file was not invoked"]),
        ...(data.newToolInvocations.some(
          (item) =>
            item.toolName === "write_file" ||
            item.toolName === "write_text_file" ||
            item.toolName === "workspace_write_text_file",
        )
          ? []
          : ["write_text_file was not invoked"]),
        ...(data.newToolInvocations.some((item) => item.status === "failed")
          ? [`tool invocation failed: ${data.newToolInvocations
              .filter((item) => item.status === "failed")
              .map((item) => item.toolName)
              .join(", ")}`]
          : []),
      ],
    });

  await recordScenario({
      name: "image attachment",
      userInput: "@Designer 请看这张图片，判断主色是什么，只回答一个颜色词。",
      withImageAttachment: true,
      validate: (data) => [
        ...assertRunCompleted(data),
        ...(!hasAgentMessage(data.newMessages, "Designer") ? ["Designer did not respond to image"] : []),
        ...(data.newMessages.some((message) => /红|red/i.test(message.content)) ? [] : ["reply did not mention red"]),
      ],
    });

  await recordScenario({
      name: "web tool invocation",
      userInput:
        "@Coder 请调用 web_fetch 抓取 https://example.com ，然后用一句话总结网页标题或主旨，并保留来源链接。",
      validate: (data) => [
        ...assertRunCompleted(data),
        ...(data.newToolInvocations.some((item) => item.toolName === "web_fetch" || item.toolName === "web_search")
          ? []
          : ["web_fetch/web_search was not invoked"]),
        ...(!hasTeamUpdate(data.newMessages, "tool_start") ? ["web tool start process message missing"] : []),
      ],
    });

  await recordScenario({
      name: "cancel running group turn",
      userInput: "请大家先不要急着回答，准备一个较长的群聊计划。",
      cancelAfterMs: 250,
      validate: (data) => {
        const run = data.newRuns[0];
        return [
          ...(run?.status === "cancelled" ? [] : [`expected cancelled run, got ${run?.status ?? "none"}`]),
          ...(data.team.context.handoff?.activeAgentId === null ? [] : ["handoff active agent was not reset"]),
          ...(data.newMessages.some((message) => /取消|cancel/i.test(message.content))
            ? []
            : ["cancel feedback message missing"]),
        ];
      },
    });

  await recordScenario({
      name: "/clear resets group context",
      userInput: "/clear",
      validate: (data) => {
        const conversationId = data.before.conversations.find(
          (item) => item.kind === "team" && item.targetId === data.team.id,
        )?.id;
        const messagesAfterClear = conversationId
          ? getConversationMessages(data.after, conversationId)
          : [];
        return [
          ...(messagesAfterClear.length <= 1
            ? []
            : [`expected only clear feedback after /clear, got ${messagesAfterClear.length} messages`]),
          ...(data.after.runs.length === 0 ? [] : [`expected 0 runs after /clear, got ${data.after.runs.length}`]),
          ...(data.team.context.handoff?.activeAgentId === null ? [] : ["handoff active agent was not cleared"]),
        ];
      },
    });

  console.log("");
  console.log("Summary");
  for (const result of results) {
    printResult(result);
  }

  const reportPath = join(tempRoot, "provider-replay-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        provider: redactProvider(provider),
        tempRoot,
        isolation: "one runtime and one conversation per scenario; retry scenario reuses one direct conversation intentionally",
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log("");
  console.log(`Report: ${reportPath}`);

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
