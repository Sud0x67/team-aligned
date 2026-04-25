import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { AppStorage } from "./storage.ts";

function createTempRoot() {
  return mkdtempSync(join(tmpdir(), "teamaligned-storage-"));
}

test("init seeds starter agents and teams for a brand-new workspace", () => {
  const root = createTempRoot();
  try {
    const storage = new AppStorage(root);
    storage.init();
    const snapshot = storage.getSnapshot();
    assert.ok(snapshot.agents.length >= 5);
    assert.ok(snapshot.teams.length >= 2);
    assert.ok(snapshot.conversations.length >= 2);
    assert.ok(snapshot.conversations.some((conversation) => conversation.id === "conv-team-product"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init backfills starter agents and teams when only settings exist", () => {
  const root = createTempRoot();
  try {
    const storage = new AppStorage(root);
    storage.setSettings({ language: "en" });
    storage.init();
    const snapshot = storage.getSnapshot();
    assert.ok(snapshot.agents.length >= 5);
    assert.ok(snapshot.teams.length >= 2);
    assert.ok(snapshot.conversations.some((conversation) => conversation.title === "Product Squad"));
    assert.ok(snapshot.messages["conv-agent-nova"]?.some((message) => message.senderName === "You"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init ignores legacy app-state migration files and keeps runtime rooted in app.db/settings.json", () => {
  const root = createTempRoot();
  const legacyPath = join(root, "app-state.json");
  try {
    writeFileSync(
      legacyPath,
      JSON.stringify({
        agents: [
          {
            id: "legacy-agent",
            name: "Legacy",
            role: "legacy",
            status: "online",
            color: "#000000",
            workspacePath: "/tmp/legacy-agent",
            avatarPath: null,
            modelId: "qwen",
            skillWhitelist: [],
            mcpWhitelist: [],
          },
        ],
      }),
      "utf8",
    );
    const storage = new AppStorage(root);
    storage.init();
    const snapshot = storage.getSnapshot();
    assert.equal(snapshot.agents.some((agent) => agent.id === "legacy-agent"), false);
    assert.equal(existsSync(legacyPath), true);
    assert.equal(existsSync(`${legacyPath}.migrated`), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("schema creates structured columns directly without runtime column patching", () => {
  const root = createTempRoot();
  const dbPath = join(root, "app.db");
  try {
    const storage = new AppStorage(root);
    storage.init();

    const db = new DatabaseSync(dbPath);
    const columns = db
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    assert.ok(columnNames.has("kind"));
    assert.ok(columnNames.has("target_id"));
    assert.ok(columnNames.has("active_skill"));
    assert.ok(columnNames.has("show_internal_messages"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init removes stale group objective schema and payload fields", () => {
  const root = createTempRoot();
  const dbPath = join(root, "app.db");
  try {
    const db = new DatabaseSync(dbPath);
    const workspacePath = join(root, "workspaces", "teams", "team-legacy");
    const payload = {
      id: "team-legacy",
      name: "Legacy Team",
      description: "Legacy description",
      avatar: "L",
      avatarPath: null,
      avatarColor: "#7c3aed",
      objective: "Legacy fixed goal",
      workspacePath,
      memberIds: [],
      mcpWhitelist: [],
      context: {
        objective: "Legacy fixed goal",
        phase: "执行中",
        constraints: [],
        activeTasks: [],
        recentDecisions: [],
        pinnedArtifacts: [],
        workspaceSummary: "",
      },
    };
    db.exec(`
      CREATE TABLE teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        objective TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        avatar_path TEXT,
        payload TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO teams (id, name, objective, workspace_path, avatar_path, payload) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(payload.id, payload.name, payload.objective, workspacePath, null, JSON.stringify(payload));
    db.close();

    const storage = new AppStorage(root);
    storage.init();

    const dbAfter = new DatabaseSync(dbPath);
    const columns = dbAfter.prepare("PRAGMA table_info(teams)").all() as Array<{ name: string }>;
    dbAfter.close();

    const snapshot = storage.getSnapshot();
    const team = snapshot.teams.find((item) => item.id === "team-legacy");
    assert.equal(columns.some((column) => column.name === "objective"), false);
    assert.equal(JSON.stringify(team).includes("Legacy fixed goal"), false);
    assert.equal(JSON.stringify(team).includes("mcpWhitelist"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("constructor throws clear error for incompatible legacy sqlite schema", () => {
  const root = createTempRoot();
  const dbPath = join(root, "app.db");
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
    `);
    db.close();
    assert.throws(
      () => {
        new AppStorage(root);
      },
      /不兼容数据库 schema：providers 缺少字段/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clearConversationHistory removes conversation-scoped history and resets transcripts", () => {
  const root = createTempRoot();
  try {
    const storage = new AppStorage(root);
    storage.init();
    const conversationId = "conv-agent-nova";
    const runId = "run-clear-history-test";

    storage.createRun({
      id: runId,
      conversationId,
      title: "Test run",
      kind: "agent_task",
      status: "completed",
      actorId: "agent-nova",
      stepIndex: 2,
      totalSteps: 2,
      metadata: null,
    });
    storage.initializeRunSteps({
      runId,
      conversationId,
      labels: ["step-1", "step-2"],
    });
    storage.createToolInvocation({
      id: "tool-clear-history-test",
      conversationId,
      runId,
      serverId: "local",
      serverName: "Local",
      toolName: "read_text_file",
      status: "completed",
      inputJson: "{}",
      metadata: null,
    });
    storage.recordArtifact({
      conversationId,
      runId,
      artifactKind: "agent_output",
      title: "artifact",
      path: "/tmp/artifact.md",
      workspacePath: "/tmp",
      metadata: null,
    });
    storage.addMessage({
      conversationId,
      senderId: "user",
      senderName: "You",
      senderKind: "user",
      messageType: "user",
      visibility: "public",
      content: "with attachment",
      mentions: [],
      runId: null,
      metadata: {
        attachments: [
          {
            name: "image.png",
            path: "/tmp/image.png",
            mimeType: "image/png",
            sizeBytes: 123,
          },
        ],
      },
      createdAt: Date.now(),
    });
    storage.createNotification({
      type: "agent_message",
      title: "test",
      body: "test",
      relatedConversationId: conversationId,
      relatedRunId: runId,
    });

    const transcriptPaths = storage.getConversationTranscriptPaths(conversationId);
    assert.ok(existsSync(transcriptPaths.globalTranscriptPath));
    assert.ok(transcriptPaths.workspaceTranscriptPath && existsSync(transcriptPaths.workspaceTranscriptPath));

    const removed = storage.clearConversationHistory(conversationId);
    assert.ok(removed.removedMessages > 0);
    assert.ok(removed.removedRuns > 0);
    assert.ok(removed.removedRunSteps > 0);
    assert.ok(removed.removedToolInvocations > 0);
    assert.ok(removed.removedArtifacts > 0);
    assert.ok(removed.removedAttachments > 0);
    assert.ok(removed.removedNotifications > 0);

    const snapshot = storage.getSnapshot();
    assert.equal(snapshot.messages[conversationId]?.length ?? 0, 0);
    assert.equal(snapshot.runs.filter((run) => run.conversationId === conversationId).length, 0);
    assert.equal(snapshot.runSteps.filter((step) => step.conversationId === conversationId).length, 0);
    assert.equal(snapshot.toolInvocations.filter((inv) => inv.conversationId === conversationId).length, 0);
    assert.equal(snapshot.artifacts.filter((artifact) => artifact.conversationId === conversationId).length, 0);
    assert.equal(snapshot.attachments.filter((attachment) => attachment.conversationId === conversationId).length, 0);
    assert.equal(snapshot.notifications.filter((notice) => notice.relatedConversationId === conversationId).length, 0);

    const conversation = snapshot.conversations.find((item) => item.id === conversationId);
    assert.equal(conversation?.unread, 0);
    assert.equal(conversation?.lastMessage, "");

    assert.equal(readFileSync(transcriptPaths.globalTranscriptPath, "utf8"), "");
    if (transcriptPaths.workspaceTranscriptPath) {
      assert.equal(readFileSync(transcriptPaths.workspaceTranscriptPath, "utf8"), "");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleteAgent removes agent conversation data and detaches team members", () => {
  const root = createTempRoot();
  try {
    const storage = new AppStorage(root);
    storage.init();

    const runId = "run-delete-agent-test";
    storage.createRun({
      id: runId,
      conversationId: "conv-agent-nova",
      title: "Delete test run",
      kind: "agent_task",
      status: "completed",
      actorId: "agent-nova",
      stepIndex: 1,
      totalSteps: 1,
      metadata: null,
    });
    storage.createNotification({
      type: "agent_message",
      title: "delete-test",
      body: "delete-test",
      relatedConversationId: "conv-agent-nova",
      relatedRunId: runId,
    });

    const removed = storage.deleteAgent("agent-nova");
    assert.equal(removed, true);

    const snapshot = storage.getSnapshot();
    assert.equal(snapshot.agents.some((agent) => agent.id === "agent-nova"), false);
    assert.equal(snapshot.conversations.some((conversation) => conversation.id === "conv-agent-nova"), false);
    assert.equal((snapshot.messages["conv-agent-nova"] ?? []).length, 0);
    assert.equal(snapshot.runs.some((run) => run.conversationId === "conv-agent-nova"), false);
    assert.equal(snapshot.notifications.some((notice) => notice.relatedConversationId === "conv-agent-nova"), false);
    const researchTeam = snapshot.teams.find((team) => team.id === "team-research");
    assert.equal(researchTeam?.memberIds.includes("agent-nova"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleteTeam removes group conversation data", () => {
  const root = createTempRoot();
  try {
    const storage = new AppStorage(root);
    storage.init();

    const runId = "run-delete-team-test";
    storage.createRun({
      id: runId,
      conversationId: "conv-team-product",
      title: "Delete team run",
      kind: "team_task",
      status: "completed",
      actorId: "team-product",
      stepIndex: 1,
      totalSteps: 1,
      metadata: null,
    });

    const removed = storage.deleteTeam("team-product");
    assert.equal(removed, true);

    const snapshot = storage.getSnapshot();
    assert.equal(snapshot.teams.some((team) => team.id === "team-product"), false);
    assert.equal(snapshot.conversations.some((conversation) => conversation.id === "conv-team-product"), false);
    assert.equal((snapshot.messages["conv-team-product"] ?? []).length, 0);
    assert.equal(snapshot.runs.some((run) => run.conversationId === "conv-team-product"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleteConversation removes chat history without deleting its target", () => {
  const root = createTempRoot();
  try {
    const storage = new AppStorage(root);
    storage.init();

    const removed = storage.deleteConversation("conv-agent-nova");
    assert.equal(removed, true);

    let snapshot = storage.getSnapshot();
    assert.equal(snapshot.agents.some((agent) => agent.id === "agent-nova"), true);
    assert.equal(snapshot.conversations.some((conversation) => conversation.id === "conv-agent-nova"), false);
    assert.equal((snapshot.messages["conv-agent-nova"] ?? []).length, 0);

    const conversation = storage.ensureConversation({ kind: "agent", targetId: "agent-nova" });
    assert.equal(conversation.id, "conv-agent-nova");
    snapshot = storage.getSnapshot();
    assert.equal(snapshot.conversations.some((item) => item.id === "conv-agent-nova"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateTeam edits group metadata without touching member agents", () => {
  const root = createTempRoot();
  try {
    const storage = new AppStorage(root);
    storage.init();

    storage.updateTeam({
      teamId: "team-product",
      name: "Renamed Squad",
      description: "Updated description",
      memberIds: ["agent-coder", "agent-designer"],
      avatarPath: null,
    });

    const snapshot = storage.getSnapshot();
    const team = snapshot.teams.find((item) => item.id === "team-product");
    assert.equal(team?.name, "Renamed Squad");
    assert.deepEqual(team?.memberIds, ["agent-coder", "agent-designer"]);
    assert.equal(snapshot.agents.some((agent) => agent.id === "agent-planner"), true);
    const conversation = snapshot.conversations.find((item) => item.id === "conv-team-product");
    assert.equal(conversation?.title, "Renamed Squad");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
