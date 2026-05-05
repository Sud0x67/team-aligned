import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TeamalignedRuntime } from "./runtime.ts";
import type { ToolExecutionPolicy, ToolExecutionPolicyDecision } from "./agent-tools.ts";
import type { ToolApprovalInterruptHandler, ToolApprovalInterruptOn } from "./deep-agent.ts";

function createTempRoot() {
  return mkdtempSync(join(tmpdir(), "teamaligned-tool-approval-"));
}

test("denying a pending tool approval resolves the policy and clears the pending dock item", async () => {
  const root = createTempRoot();
  try {
    const runtime = new TeamalignedRuntime(root);
    const runtimeInternals = runtime as unknown as {
      storage: {
        init: () => void;
        resetUnread: (conversationId: string) => void;
        createRun: (input: {
          id: string;
          conversationId: string;
          title: string;
          kind: "agent";
          status: "running";
          actorId: string;
          stepIndex: number;
          totalSteps: number;
          metadata: Record<string, unknown>;
        }) => void;
      };
      createToolExecutionPolicy: (input: {
        conversationId: string;
        runId: string;
        actorName: string;
        responseLanguage: "zh" | "en";
      }) => ToolExecutionPolicy;
    };

    runtimeInternals.storage.init();
    const conversationId = runtime.getSnapshot().conversations[0]?.id;
    assert.ok(conversationId);
    runtimeInternals.storage.resetUnread(conversationId);

    const runId = "run-tool-approval-denied";
    runtimeInternals.storage.createRun({
      id: runId,
      conversationId,
      title: "Approval denial",
      kind: "agent",
      status: "running",
      actorId: "agent-coder",
      stepIndex: 0,
      totalSteps: 1,
      metadata: { responseLanguage: "zh" },
    });

    const policy = runtimeInternals.createToolExecutionPolicy({
      conversationId,
      runId,
      actorName: "Coder",
      responseLanguage: "zh",
    });

    const decisionPromise = Promise.resolve(
      policy({
        serverId: "workspace",
        serverName: "Workspace",
        toolName: "run_command",
        operation: "command",
        riskLevel: "high",
        args: { command: "rm -rf /tmp/example" },
        description: "Run command outside workspace.",
        workspaceScoped: false,
      }),
    );

    const pendingMessage = runtime
      .getSnapshot()
      .messages[conversationId]?.find((message) => message.metadata?.cardType === "tool_approval");
    assert.ok(pendingMessage);
    assert.equal(pendingMessage.metadata?.approvalStatus, "pending");

    const pendingSnapshot = runtime.getSnapshot();
    const pendingConversation = pendingSnapshot.conversations.find((item) => item.id === conversationId);
    assert.equal(pendingConversation?.unread, 1);
    assert.match(pendingConversation?.lastMessage ?? "", /需要你确认/);
    assert.equal(
      pendingSnapshot.notifications.some(
        (notification) =>
          notification.relatedConversationId === conversationId &&
          notification.relatedRunId === runId &&
          notification.title === "需要确认工具执行",
      ),
      true,
    );

    await runtime.resolveToolExecutionApproval({
      approvalId: String(pendingMessage.metadata?.approvalId),
      decision: "denied",
    });

    const decision = (await decisionPromise) as ToolExecutionPolicyDecision;
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.match(decision.reason, /用户拒绝/);
    }

    const resolvedMessage = runtime
      .getSnapshot()
      .messages[conversationId]?.find((message) => message.id === pendingMessage.id);
    assert.equal(resolvedMessage?.metadata?.approvalStatus, "denied");
    assert.match(resolvedMessage?.content ?? "", /已拒绝/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool approval interrupts use the existing approval card and reject back to the model", async () => {
  const root = createTempRoot();
  try {
    const runtime = new TeamalignedRuntime(root);
    const runtimeInternals = runtime as unknown as {
      storage: {
        init: () => void;
        createRun: (input: {
          id: string;
          conversationId: string;
          title: string;
          kind: "agent";
          status: "running";
          actorId: string;
          stepIndex: number;
          totalSteps: number;
          metadata: Record<string, unknown>;
        }) => void;
      };
      createToolApprovalInterruptRuntime: (input: {
        conversationId: string;
        runId: string;
        actorName: string;
        responseLanguage: "zh" | "en";
        mcpServers: [];
        mcpConnections: [];
      }) => {
        interruptOn: ToolApprovalInterruptOn;
        handler: ToolApprovalInterruptHandler;
      };
    };

    runtimeInternals.storage.init();
    const conversationId = runtime.getSnapshot().conversations[0]?.id;
    assert.ok(conversationId);
    const runId = "run-hitl-denied";
    runtimeInternals.storage.createRun({
      id: runId,
      conversationId,
      title: "HITL denial",
      kind: "agent",
      status: "running",
      actorId: "agent-coder",
      stepIndex: 0,
      totalSteps: 1,
      metadata: { responseLanguage: "zh" },
    });

    const approvalRuntime = runtimeInternals.createToolApprovalInterruptRuntime({
      conversationId,
      runId,
      actorName: "Coder",
      responseLanguage: "zh",
      mcpServers: [],
      mcpConnections: [],
    });

    assert.ok(approvalRuntime.interruptOn.workspace_run_command);
    assert.equal("workspace_write_text_file" in approvalRuntime.interruptOn, false);

    const responsePromise = approvalRuntime.handler({
      actionRequests: [
        {
          name: "workspace_run_command",
          args: { command: "npm test" },
          description: "Run test command.",
        },
      ],
      reviewConfigs: [
        {
          actionName: "workspace_run_command",
          allowedDecisions: ["approve", "reject"],
        },
      ],
    });

    const pendingMessage = runtime
      .getSnapshot()
      .messages[conversationId]?.find((message) => message.metadata?.cardType === "tool_approval");
    assert.ok(pendingMessage);
    assert.equal(pendingMessage.metadata?.approvalStatus, "pending");

    await runtime.resolveToolExecutionApproval({
      approvalId: String(pendingMessage.metadata?.approvalId),
      decision: "denied",
    });

    const response = await responsePromise;
    assert.equal(response.decisions.length, 1);
    assert.equal(response.decisions[0]?.type, "reject");
    if (response.decisions[0]?.type === "reject") {
      assert.match(response.decisions[0].message ?? "", /不要再次自动请求同一个权限/);
    }

    const notificationCount = runtime
      .getSnapshot()
      .notifications.filter((notification) => notification.relatedRunId === runId).length;
    const secondResponse = await approvalRuntime.handler({
      actionRequests: [
        {
          name: "workspace_run_command",
          args: { command: "npm test" },
        },
      ],
      reviewConfigs: [
        {
          actionName: "workspace_run_command",
          allowedDecisions: ["approve", "reject"],
        },
      ],
    });
    assert.equal(secondResponse.decisions[0]?.type, "reject");
    assert.equal(
      runtime.getSnapshot().notifications.filter((notification) => notification.relatedRunId === runId).length,
      notificationCount,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("approved command interrupts allow the matching tool call once without a second approval", async () => {
  const root = createTempRoot();
  try {
    const runtime = new TeamalignedRuntime(root);
    const runtimeInternals = runtime as unknown as {
      storage: {
        init: () => void;
        createRun: (input: {
          id: string;
          conversationId: string;
          title: string;
          kind: "agent";
          status: "running";
          actorId: string;
          stepIndex: number;
          totalSteps: number;
          metadata: Record<string, unknown>;
        }) => void;
      };
      createToolApprovalInterruptRuntime: (input: {
        conversationId: string;
        runId: string;
        actorName: string;
        responseLanguage: "zh" | "en";
        mcpServers: [];
        mcpConnections: [];
      }) => {
        interruptOn: ToolApprovalInterruptOn;
        handler: ToolApprovalInterruptHandler;
      };
      createToolExecutionPolicy: (input: {
        conversationId: string;
        runId: string;
        actorName: string;
        responseLanguage: "zh" | "en";
      }) => ToolExecutionPolicy;
    };

    runtimeInternals.storage.init();
    const conversationId = runtime.getSnapshot().conversations[0]?.id;
    assert.ok(conversationId);
    const runId = "run-hitl-approved-command";
    runtimeInternals.storage.createRun({
      id: runId,
      conversationId,
      title: "HITL command approval",
      kind: "agent",
      status: "running",
      actorId: "agent-coder",
      stepIndex: 0,
      totalSteps: 1,
      metadata: { responseLanguage: "zh" },
    });

    const approvalRuntime = runtimeInternals.createToolApprovalInterruptRuntime({
      conversationId,
      runId,
      actorName: "Coder",
      responseLanguage: "zh",
      mcpServers: [],
      mcpConnections: [],
    });

    const responsePromise = approvalRuntime.handler({
      actionRequests: [
        {
          name: "workspace_run_command",
          args: { command: "echo hello" },
          description: "Run a harmless command.",
        },
      ],
      reviewConfigs: [
        {
          actionName: "workspace_run_command",
          allowedDecisions: ["approve", "reject"],
        },
      ],
    });

    const pendingMessage = runtime
      .getSnapshot()
      .messages[conversationId]?.find((message) => message.metadata?.cardType === "tool_approval");
    assert.ok(pendingMessage);
    await runtime.resolveToolExecutionApproval({
      approvalId: String(pendingMessage.metadata?.approvalId),
      decision: "approved",
    });

    const hitlResponse = await responsePromise;
    assert.equal(hitlResponse.decisions[0]?.type, "approve");

    const policy = runtimeInternals.createToolExecutionPolicy({
      conversationId,
      runId,
      actorName: "Coder",
      responseLanguage: "zh",
    });
    const decision = await policy({
      serverId: "local-shell",
      serverName: "Workspace Shell",
      toolName: "run_workspace_command",
      operation: "command",
      riskLevel: "high",
      args: { command: "echo hello" },
      description: "Run a shell command in the current workspace.",
      workspaceScoped: true,
    });

    assert.equal(decision.allow, true);
    assert.equal(
      runtime
        .getSnapshot()
        .messages[conversationId]?.filter(
          (message) => message.metadata?.cardType === "tool_approval",
        ).length,
      1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remembered command approvals do not bypass different shell commands", async () => {
  const root = createTempRoot();
  try {
    const runtime = new TeamalignedRuntime(root);
    const runtimeInternals = runtime as unknown as {
      storage: {
        init: () => void;
        createRun: (input: {
          id: string;
          conversationId: string;
          title: string;
          kind: "agent";
          status: "running";
          actorId: string;
          stepIndex: number;
          totalSteps: number;
          metadata: Record<string, unknown>;
        }) => void;
      };
      createToolExecutionPolicy: (input: {
        conversationId: string;
        runId: string;
        actorName: string;
        responseLanguage: "zh" | "en";
      }) => ToolExecutionPolicy;
    };

    runtimeInternals.storage.init();
    const conversationId = runtime.getSnapshot().conversations[0]?.id;
    assert.ok(conversationId);
    const runId = "run-command-approval-scope";
    runtimeInternals.storage.createRun({
      id: runId,
      conversationId,
      title: "Command approval scope",
      kind: "agent",
      status: "running",
      actorId: "agent-coder",
      stepIndex: 0,
      totalSteps: 1,
      metadata: { responseLanguage: "zh" },
    });

    const policy = runtimeInternals.createToolExecutionPolicy({
      conversationId,
      runId,
      actorName: "Coder",
      responseLanguage: "zh",
    });
    const createCommandRequest = (command: string) => ({
      serverId: "local-shell",
      serverName: "Workspace Shell",
      toolName: "run_workspace_command",
      operation: "command" as const,
      riskLevel: "high" as const,
      args: { command },
      description: "Run a shell command in the current workspace.",
      workspaceScoped: true,
    });

    const firstDecisionPromise = policy(createCommandRequest("echo hello"));
    const firstApproval = runtime
      .getSnapshot()
      .messages[conversationId]?.find(
        (message) => message.metadata?.cardType === "tool_approval" && message.metadata?.approvalStatus === "pending",
      );
    assert.ok(firstApproval);
    await runtime.resolveToolExecutionApproval({
      approvalId: String(firstApproval.metadata?.approvalId),
      decision: "approved_for_conversation",
    });
    assert.equal((await firstDecisionPromise).allow, true);

    const rememberedDecision = await policy(createCommandRequest("echo hello"));
    assert.equal(rememberedDecision.allow, true);

    const secondDecisionPromise = policy(createCommandRequest("which draw.io || which drawio"));
    const secondApproval = runtime
      .getSnapshot()
      .messages[conversationId]?.find(
        (message) =>
          message.id !== firstApproval.id &&
          message.metadata?.cardType === "tool_approval" &&
          message.metadata?.approvalStatus === "pending",
      );
    assert.ok(secondApproval);
    assert.match(String(secondApproval.metadata?.argsPreview ?? ""), /draw\.io|drawio/);
    await runtime.resolveToolExecutionApproval({
      approvalId: String(secondApproval.metadata?.approvalId),
      decision: "denied",
    });
    const deniedDecision = await secondDecisionPromise;
    assert.equal(deniedDecision.allow, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
