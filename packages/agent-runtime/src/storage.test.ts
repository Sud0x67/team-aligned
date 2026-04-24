import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
