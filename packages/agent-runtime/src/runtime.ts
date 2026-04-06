import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import { parseSlashCommand } from "@teamaligned/shared";
import type {
  AgentRecord,
  AppSnapshot,
  ConversationRecord,
  MessageVisibility,
  ProviderConfig,
  RunControlPayload,
  RunRecord,
  RunStatus,
  SendInputPayload,
  TeamContext,
  TeamRecord,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
} from "@teamaligned/shared";
import { AppStorage } from "./storage.ts";
import { invokeSingleChatDeepAgent, validateProviderForSingleChat } from "./deep-agent.ts";
import {
  type TeamSpecialistOutput,
  type TeamFinalResponse,
  planTeamConversation,
  runSpecialistAssignment,
  summarizeTeamConversation,
} from "./team-runtime.ts";

type RunStep = {
  label: string;
  delayMs?: number;
  execute: () => Promise<void> | void;
};

type ActiveRunController = {
  runId: string;
  conversationId: string;
  steps: RunStep[];
  timer: NodeJS.Timeout | null;
  busy: boolean;
  childProcess: ReturnType<typeof spawn> | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimOutput(text: string, max = 2400) {
  const value = text.trim();
  return value.length <= max ? value : `${value.slice(0, max)}\n...`;
}

function trimHeadline(text: string, max = 120) {
  const value = text.trim().replace(/\s+/g, " ");
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function extractAgentMentions(input: string, agents: AgentRecord[]) {
  const matches = [...input.matchAll(/@([\w\u4e00-\u9fa5-]+)/g)].map((item) => item[1]);
  const mentioned = agents.filter((agent) =>
    matches.some((match) => agent.name.toLowerCase() === match.toLowerCase()),
  );
  return mentioned;
}

function chooseManager(team: TeamRecord, agents: AgentRecord[]) {
  const members = agents.filter((agent) => team.memberIds.includes(agent.id));
  return (
    members.find((agent) => agent.role.includes("经理") || agent.name === "Planner") ??
    members[0]
  );
}

function chooseSpecialists(team: TeamRecord, agents: AgentRecord[], input: string) {
  const members = agents.filter((agent) => team.memberIds.includes(agent.id));
  const manager = chooseManager(team, agents);
  const explicit = extractAgentMentions(input, members).filter((agent) => agent.id !== manager?.id);

  if (explicit.length > 0) {
    return explicit;
  }

  return members.filter((agent) => agent.id !== manager?.id).slice(0, 2);
}

export class TeamalignedRuntime extends EventEmitter {
  private readonly storage: AppStorage;
  private readonly activeRuns = new Map<string, ActiveRunController>();
  private readonly singleChatSessions = new Map<
    string,
    {
      signature: string;
      agent: ReturnType<typeof import("deepagents").createDeepAgent>;
      initialized: boolean;
    }
  >();

  constructor(private readonly dataDir: string) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.storage = new AppStorage(dataDir);
  }

  async init() {
    this.storage.init();
    this.recoverInterruptedRuns();
    this.emitSnapshot();
  }

  getSnapshot(): AppSnapshot {
    return this.storage.getSnapshot();
  }

  async sendInput(payload: SendInputPayload) {
    const snapshot = this.storage.getSnapshot();
    const conversation = snapshot.conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) {
      return this.getSnapshot();
    }

    this.storage.resetUnread(payload.conversationId);

    const command = parseSlashCommand(payload.input);
    if (command) {
      this.storage.addMessage({
        conversationId: payload.conversationId,
        senderId: "user",
        senderName: "你",
        senderKind: "user",
        messageType: "command",
        visibility: "public",
        content: command.raw,
        mentions: [],
        runId: null,
        metadata: { command: command.name, args: command.args },
        createdAt: Date.now(),
      });
      await this.handleSlashCommand(conversation, command.name, command.args);
      this.emitSnapshot();
      return this.getSnapshot();
    }

    this.storage.addMessage({
      conversationId: payload.conversationId,
      senderId: "user",
      senderName: "你",
      senderKind: "user",
      messageType: "user",
      visibility: "public",
      content: payload.input,
      mentions: extractAgentMentions(payload.input, snapshot.agents).map((agent) => agent.id),
      runId: null,
      metadata: null,
      createdAt: Date.now(),
    });

    if (conversation.kind === "agent") {
      await this.startAgentRun(conversation, payload.input);
    } else {
      await this.startTeamRun(conversation, payload.input);
    }

    this.emitSnapshot();
    return this.getSnapshot();
  }

  async controlRun(payload: RunControlPayload) {
    const latest = this.storage
      .listRuns()
      .find(
        (run) =>
          run.conversationId === payload.conversationId &&
          !["completed", "failed", "cancelled"].includes(run.status),
      );

    if (!latest) {
      this.addSystemMessage(payload.conversationId, "当前会话没有可控制的任务。");
      this.emitSnapshot();
      return this.getSnapshot();
    }

    const controller = this.activeRuns.get(latest.id);

    if (payload.action === "pause") {
      if (latest.status === "paused" || latest.status === "pausing") {
        return this.getSnapshot();
      }

      if (controller && !controller.busy) {
        if (controller.timer) clearTimeout(controller.timer);
        controller.timer = null;
        this.storage.updateRun(latest.id, { status: "paused" });
        this.addRunMessage(payload.conversationId, latest.id, "任务已暂停，可稍后继续。", "system");
      } else {
        this.storage.updateRun(latest.id, { status: "pausing" });
        this.addRunMessage(
          payload.conversationId,
          latest.id,
          "已收到暂停请求，将在当前步骤结束后暂停。",
          "system",
        );
      }
    }

    if (payload.action === "resume") {
      if (latest.status !== "paused") {
        return this.getSnapshot();
      }

      this.storage.updateRun(latest.id, { status: "resuming" });
      this.addRunMessage(payload.conversationId, latest.id, "任务正在恢复执行。", "system");
      if (controller) {
        this.scheduleNext(controller, 300);
      }
    }

    if (payload.action === "cancel") {
      if (controller?.timer) clearTimeout(controller.timer);
      if (controller?.childProcess) controller.childProcess.kill("SIGTERM");
      this.activeRuns.delete(latest.id);
      this.storage.updateRun(latest.id, { status: "cancelled" });
      this.addRunMessage(payload.conversationId, latest.id, "任务已取消。", "system");
    }

    this.emitSnapshot();
    return this.getSnapshot();
  }

  async createAgent(payload: Parameters<AppStorage["createAgent"]>[0]) {
    this.storage.createAgent(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async createTeam(payload: Parameters<AppStorage["createTeam"]>[0]) {
    this.storage.createTeam(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async toggleExtension(extensionId: string) {
    this.storage.toggleExtension(extensionId);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateSettings(payload: UpdateSettingsInput) {
    this.storage.setSettings(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateProfile(payload: UpdateProfileInput) {
    this.storage.setProfile(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateProvider(payload: UpdateProviderInput) {
    this.storage.updateProvider(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async markNotificationsRead() {
    this.storage.markNotificationsRead();
    this.emitSnapshot();
    return this.getSnapshot();
  }

  private async handleSlashCommand(
    conversation: ConversationRecord,
    commandName: string,
    args: string[],
  ) {
    if (commandName === "skills") {
      const skills = this.storage
        .listExtensions()
        .filter((extension) => extension.type === "skill" && extension.installed);
      const currentMeta = conversation.meta;

      if (args.length === 0) {
        this.addSystemMessage(
          conversation.id,
          `当前可用技能：${skills.map((skill) => skill.name).join("、")}\n当前激活技能：${
            currentMeta.activeSkill ?? "默认"
          }`,
        );
        return;
      }

      const selectedSkill = args.filter((item) => item !== "use").join(" ");
      const match = skills.find((skill) => skill.name.toLowerCase() === selectedSkill.toLowerCase());
      const meta = { ...currentMeta, activeSkill: match?.name ?? selectedSkill };
      this.storage.updateConversationMeta(conversation.id, meta);
      this.addSystemMessage(
        conversation.id,
        `已为当前会话切换技能：${meta.activeSkill ?? "默认"}。后续回复会优先参考该技能。`,
      );
      return;
    }

    if (commandName === "mcp") {
      const installed = this.storage
        .listExtensions()
        .filter((extension) => extension.type === "mcp" && extension.installed);

      if (args.length === 0) {
        this.addSystemMessage(
          conversation.id,
          `当前可用 MCP：${installed.map((item) => item.name).join("、") || "暂无"}。`,
        );
        return;
      }

      const selected = args.join(" ");
      this.addSystemMessage(
        conversation.id,
        `已模拟调用 MCP：${selected}。\n在完整版本中，这里会进入真实 MCP tool 调用链路。`,
      );
      return;
    }

    if (commandName === "command") {
      const shellCommand = args.join(" ").trim();
      if (!shellCommand) {
        this.addSystemMessage(conversation.id, "用法：/command <你要执行的命令>");
        return;
      }
      await this.startShellCommandRun(conversation, shellCommand);
      return;
    }

    if (commandName === "pause" || commandName === "resume" || commandName === "cancel") {
      await this.controlRun({
        conversationId: conversation.id,
        action: commandName as RunControlPayload["action"],
      });
    }
  }

  private async startAgentRun(conversation: ConversationRecord, input: string) {
    const snapshot = this.storage.getSnapshot();
    const agent = snapshot.agents.find((item) => item.id === conversation.targetId);
    if (!agent) return;
    const provider = this.resolveActiveProvider(snapshot);
    const providerIssue = validateProviderForSingleChat(provider);
    if (providerIssue) {
      this.addSystemMessage(conversation.id, providerIssue);
      return;
    }

    const workspacePath = agent.workspacePath;
    const runId = `run-${nanoid(8)}`;
    const activeSkill = conversation.meta.activeSkill;
    const steps: RunStep[] = [
      {
        label: "准备上下文",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            `${agent.name} 正在准备上下文，并将使用 ${provider?.label} / ${provider?.defaultModel} 处理这次请求。`,
            "system",
          );
        },
      },
      {
        label: "检查技能与上下文",
        delayMs: 300,
        execute: () => {
          const skillText = activeSkill ? `当前会话激活技能：${activeSkill}。` : "当前使用默认技能栈。";
          this.addRunMessage(
            conversation.id,
            runId,
            `${agent.name} 已读取上下文。\n${skillText}`,
            "system",
          );
        },
      },
      {
        label: "调用真实模型",
        execute: async () => {
          const response = await invokeSingleChatDeepAgent({
            sessions: this.singleChatSessions,
            conversationId: conversation.id,
            provider: provider!,
            agent,
            profile: snapshot.profile,
            activeSkill,
            workspacePath,
            history: this.storage.listMessages(conversation.id),
            latestInput: input,
          });

          if (this.storage.getRun(runId)?.status === "cancelled") {
            return;
          }

          const artifactPath = this.writeAgentArtifact(workspacePath, runId, agent, input, response, activeSkill);
          const memoryPath = this.appendMemory(
            workspacePath,
            "memory/MEMORY.md",
            `- ${this.formatTimestamp()} | 任务：${trimHeadline(input)} | 输出：${trimHeadline(response)}`,
          );
          this.storage.addMessage({
            conversationId: conversation.id,
            senderId: agent.id,
            senderName: agent.name,
            senderKind: "agent",
            messageType: "agent",
            visibility: "public",
            content: response,
            mentions: ["user"],
            runId,
            metadata: { skill: activeSkill },
            createdAt: Date.now(),
          });
          this.addRunMessage(
            conversation.id,
            runId,
            `结果已写入产物：${artifactPath}\n记忆文件已更新：${memoryPath}`,
            "system",
          );
          this.storage.createNotification({
            type: "run_complete",
            title: `${agent.name} 已完成当前任务`,
            body: "可以在消息线程中查看结果。",
            relatedConversationId: conversation.id,
            relatedRunId: runId,
          });
        },
      },
    ];

    this.beginRun({
      runId,
      conversationId: conversation.id,
      title: `${agent.name} 处理请求`,
      kind: "agent_task",
      actorId: agent.id,
      steps,
    });
  }

  private async startTeamRun(conversation: ConversationRecord, input: string) {
    const snapshot = this.storage.getSnapshot();
    const team = snapshot.teams.find((item) => item.id === conversation.targetId);
    if (!team) return;

    const manager = chooseManager(team, snapshot.agents);
    const availableSpecialists = chooseSpecialists(team, snapshot.agents, input);
    const explicitMentions = extractAgentMentions(input, snapshot.agents).map((agent) => agent.id);
    if (!manager) return;
    const provider = this.resolveActiveProvider(snapshot);
    const providerIssue = validateProviderForSingleChat(provider);
    if (providerIssue) {
      this.addSystemMessage(conversation.id, providerIssue);
      return;
    }

    const runId = `run-${nanoid(8)}`;
    let updatedContext: TeamContext = {
      ...team.context,
      activeTasks: Array.from(
        new Set([`${input.slice(0, 24)}${input.length > 24 ? "..." : ""}`, ...team.context.activeTasks]),
      ).slice(0, 5),
    };
    this.storage.updateTeamContext(team.id, updatedContext);
    const workspacePath = team.workspacePath;
    const specialistOutputs: TeamSpecialistOutput[] = [];
    let plan: Awaited<ReturnType<typeof planTeamConversation>> | null = null;
    let finalResponse: TeamFinalResponse | null = null;

    const steps: RunStep[] = [
      {
        label: "同步群组上下文",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            `${manager.name} 正在读取群组上下文，并检查是否需要协调 specialist。`,
            "system",
          );
        },
      },
      {
        label: "manager 规划",
        execute: async () => {
          plan = await planTeamConversation({
            provider: provider!,
            profile: snapshot.profile,
            team: {
              ...team,
              context: updatedContext,
            },
            manager,
            specialists: availableSpecialists,
            context: updatedContext,
            history: this.storage.listMessages(conversation.id).map((message) => ({
              senderName: message.senderName,
              visibility: message.visibility,
              content: message.content,
            })),
            userInput: input,
            explicitMentionIds: explicitMentions,
          });

          updatedContext = {
            ...updatedContext,
            phase: plan.nextPhase || updatedContext.phase,
            activeTasks: plan.activeTask
              ? Array.from(new Set([plan.activeTask, ...updatedContext.activeTasks])).slice(0, 5)
              : updatedContext.activeTasks,
            recentDecisions: plan.decision
              ? Array.from(new Set([plan.decision, ...updatedContext.recentDecisions])).slice(0, 5)
              : updatedContext.recentDecisions,
          };
          this.storage.updateTeamContext(team.id, updatedContext);

          if (plan.strategy === "manager_direct") {
            this.addRunMessage(
              conversation.id,
              runId,
              `${manager.name} 将直接处理本轮请求，不调度 specialist。`,
              "system",
            );
            return;
          }

          if (plan.kickoffReply) {
            this.storage.addMessage({
              conversationId: conversation.id,
              senderId: manager.id,
              senderName: manager.name,
              senderKind: "agent",
              messageType: "agent",
              visibility: "public",
              content: plan.kickoffReply,
              mentions: ["user"],
              runId,
              metadata: {
                phase: updatedContext.phase,
                strategy: plan.strategy,
              },
              createdAt: Date.now(),
            });
          }

          if (plan.strategy === "specialist_question") {
            this.addRunMessage(
              conversation.id,
              runId,
              `${plan.speaker.name} 需要先向用户确认一项关键信息。`,
              "system",
            );
            return;
          }

          this.addRunMessage(
            conversation.id,
            runId,
            `${manager.name} 已分派 ${plan.assignments
              .map((assignment) => assignment.specialist.name)
              .join("、")} 参与协作。`,
            "system",
          );
        },
      },
      {
        label: "specialist 协作",
        execute: async () => {
          if (!plan || plan.strategy === "manager_direct" || plan.assignments.length === 0) {
            return;
          }

          for (const assignment of plan.assignments) {
            const specialist = assignment.specialist;

            this.storage.addMessage({
              conversationId: conversation.id,
              senderId: manager.id,
              senderName: manager.name,
              senderKind: "agent",
              messageType: "agent",
              visibility: "internal",
              content: `@${specialist.name} 我把这个子任务交给你：${assignment.task}`,
              mentions: [specialist.id],
              runId,
              metadata: {
                internal: true,
                fromManager: true,
                task: assignment.task,
              },
              createdAt: Date.now(),
            });

            const output = await runSpecialistAssignment({
              provider: provider!,
              profile: snapshot.profile,
              team: {
                ...team,
                context: updatedContext,
              },
              manager,
              assignment,
              context: updatedContext,
              userInput: input,
              workspacePath,
              conversationId: conversation.id,
              runId,
            });
            specialistOutputs.push(output);

            this.storage.addMessage({
              conversationId: conversation.id,
              senderId: output.specialist.id,
              senderName: output.specialist.name,
              senderKind: "agent",
              messageType: output.userContactMode === "specialist_direct" ? "notification" : "agent",
              visibility: output.userContactMode === "specialist_direct" ? "public" : output.visibility,
              content:
                output.userContactMode === "specialist_direct"
                  ? `@你 ${output.userQuestionDraft || output.content}`
                  : output.content,
              mentions:
                output.userContactMode === "specialist_direct" || output.visibility === "public"
                  ? ["user"]
                  : [],
              runId,
              metadata: {
                teamId: team.id,
                task: output.task,
                reason: output.reason,
                visibility: output.userContactMode === "specialist_direct" ? "public" : output.visibility,
                userContactMode: output.userContactMode,
                directFromSpecialist: output.userContactMode === "specialist_direct",
                managerRelayCandidate: output.userContactMode === "manager_relay",
              },
              createdAt: Date.now(),
            });
          }
        },
      },
      {
        label: "经理汇总",
        execute: async () => {
          if (!plan) {
            return;
          }

          if (plan.strategy === "manager_direct") {
            finalResponse = {
              speaker: manager,
              content:
                plan.directReply || `${manager.name}：我已经收到你的请求，会先给出一个清晰的处理建议。`,
              summary: trimHeadline(plan.intentSummary || input),
            };
          } else if (plan.strategy === "specialist_question") {
            const directQuestion =
              specialistOutputs.find((output) => output.userContactMode === "specialist_direct")
                ?.userQuestionDraft ||
              specialistOutputs.find((output) => output.userContactMode === "manager_relay")
                ?.userQuestionDraft ||
              plan.userQuestion ||
              "为了继续推进，我还需要你补充一项关键信息。";
            finalResponse = {
              speaker: plan.questionMode === "specialist_direct" ? plan.speaker : manager,
              content:
                plan.questionMode === "specialist_direct"
                  ? `@你 ${directQuestion}`
                  : `${manager.name}：我先替 ${plan.speaker.name} 确认一个关键信息：${directQuestion}`,
              summary: trimHeadline(directQuestion || input),
            };
            updatedContext = {
              ...updatedContext,
              phase: plan.nextPhase || "等待用户确认",
              recentDecisions: Array.from(
                new Set([
                  trimHeadline(`${plan.speaker.name} 需要用户确认关键输入`),
                  ...updatedContext.recentDecisions,
                ]),
              ).slice(0, 5),
            };
            this.storage.updateTeamContext(team.id, updatedContext);
          } else {
            finalResponse = await summarizeTeamConversation({
              provider: provider!,
              profile: snapshot.profile,
              team: {
                ...team,
                context: updatedContext,
              },
              manager,
              context: updatedContext,
              userInput: input,
              intentSummary: plan.intentSummary,
              specialistOutputs,
              workspacePath,
              conversationId: conversation.id,
              runId,
            });
          }

          const specialistAlreadySpoke =
            plan.strategy === "specialist_question" &&
            specialistOutputs.some((output) => output.userContactMode === "specialist_direct");

          if (!specialistAlreadySpoke) {
            this.storage.addMessage({
              conversationId: conversation.id,
              senderId: finalResponse.speaker.id,
              senderName: finalResponse.speaker.name,
              senderKind: "agent",
              messageType:
                plan.strategy === "specialist_question" && finalResponse.speaker.id !== manager.id
                  ? "notification"
                  : "agent",
              visibility: "public",
              content: finalResponse.content,
              mentions: ["user"],
              runId,
              metadata: {
                summary: plan.strategy === "collaborate",
                strategy: plan.strategy,
                specialistCount: specialistOutputs.length,
                userContactMode: plan.questionMode,
                relayedByManager:
                  plan.strategy === "specialist_question" && plan.questionMode === "manager_relay",
                directFromSpecialist:
                  plan.strategy === "specialist_question" &&
                  plan.questionMode === "specialist_direct" &&
                  finalResponse.speaker.id !== manager.id,
              },
              createdAt: Date.now(),
            });
          }

          this.storage.createNotification({
            type: "mention",
            title: `${finalResponse.speaker.name} 在群组中 @ 了你`,
            body: `${team.name} 中有新的阶段总结。`,
            relatedConversationId: conversation.id,
            relatedRunId: runId,
          });
        },
      },
      {
        label: "落盘产物",
        execute: () => {
          const effectiveFinalResponse =
            finalResponse ??
            ({
              speaker: manager,
              content: plan?.directReply ?? `${manager.name} 已完成当前群组处理。`,
              summary: trimHeadline(plan?.intentSummary || input),
            } satisfies TeamFinalResponse);
          const effectiveSpecialists =
            specialistOutputs.length > 0
              ? specialistOutputs.map((item) => item.specialist)
              : plan?.assignments.map((assignment) => assignment.specialist) ?? [];
          const specialistSummary =
            effectiveSpecialists.map((agent) => agent.name).join("、") || "无";
          const artifactPath = this.writeTeamArtifact(
            workspacePath,
            runId,
            team,
            manager,
            effectiveSpecialists,
            input,
            updatedContext,
            specialistOutputs,
            effectiveFinalResponse,
          );
          const sharedMemoryPath = this.appendMemory(
            workspacePath,
            "shared-memory.md",
            `- ${this.formatTimestamp()} | 任务：${trimHeadline(input)} | 协作：${specialistSummary} | 输出：${trimHeadline(
              effectiveFinalResponse.content,
            )}`,
          );
          this.addRunMessage(
            conversation.id,
            runId,
            `群组协作产物已写入：${artifactPath}\n共享记忆已更新：${sharedMemoryPath}`,
            "system",
          );
        },
      },
    ];

    this.beginRun({
      runId,
      conversationId: conversation.id,
      title: `${team.name} 群组协作`,
      kind: "team_task",
      actorId: manager.id,
      steps,
    });
  }

  private async startShellCommandRun(conversation: ConversationRecord, shellCommand: string) {
    const snapshot = this.storage.getSnapshot();
    const workspacePath = this.getWorkspaceForConversation(conversation, snapshot.agents, snapshot.teams);
    const actorId =
      conversation.kind === "agent"
        ? conversation.targetId
        : chooseManager(snapshot.teams.find((item) => item.id === conversation.targetId)!, snapshot.agents)?.id ??
          "system";

    const runId = `run-${nanoid(8)}`;
    const steps: RunStep[] = [
      {
        label: "准备命令",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            `准备在 workspace 执行命令：${shellCommand}`,
            "system",
          );
        },
      },
      {
        label: "执行命令",
        execute: async () => {
          const artifactPath = await this.executeShellCommand(
            runId,
            conversation.id,
            shellCommand,
            workspacePath,
          );
          this.addRunMessage(
            conversation.id,
            runId,
            `命令结果已写入产物：${artifactPath}`,
            "system",
          );
        },
      },
      {
        label: "整理结果",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            "命令执行完成，结果已经回写到会话中。",
            "system",
          );
        },
      },
    ];

    this.beginRun({
      runId,
      conversationId: conversation.id,
      title: `/command ${shellCommand}`,
      kind: "shell_command",
      actorId,
      steps,
    });
  }

  private beginRun(input: {
    runId: string;
    conversationId: string;
    title: string;
    kind: RunRecord["kind"];
    actorId: string;
    steps: RunStep[];
  }) {
    this.storage.createRun({
      id: input.runId,
      conversationId: input.conversationId,
      title: input.title,
      kind: input.kind,
      status: "running",
      actorId: input.actorId,
      stepIndex: 0,
      totalSteps: input.steps.length,
      metadata: { title: input.title },
    });

    const controller: ActiveRunController = {
      runId: input.runId,
      conversationId: input.conversationId,
      steps: input.steps,
      timer: null,
      busy: false,
      childProcess: null,
    };

    this.activeRuns.set(input.runId, controller);
    this.addRunMessage(input.conversationId, input.runId, `已开始任务：${input.title}`, "system");
    this.scheduleNext(controller, 240);
  }

  private scheduleNext(controller: ActiveRunController, delayMs = 800) {
    if (controller.timer) clearTimeout(controller.timer);
    controller.timer = setTimeout(() => {
      void this.advanceRun(controller.runId);
    }, delayMs);
  }

  private async advanceRun(runId: string) {
    const controller = this.activeRuns.get(runId);
    const run = this.storage.getRun(runId);
    if (!controller || !run) return;

    if (["paused", "cancelled", "completed", "failed"].includes(run.status)) {
      return;
    }

    if (run.status === "resuming") {
      this.storage.updateRun(runId, { status: "running" });
    }

    if (run.status === "pausing") {
      this.storage.updateRun(runId, { status: "paused" });
      this.addRunMessage(run.conversationId, runId, "任务已暂停。", "system");
      this.emitSnapshot();
      return;
    }

    const step = controller.steps[run.stepIndex];
    if (!step) {
      this.storage.updateRun(runId, { status: "completed" });
      this.addRunMessage(run.conversationId, runId, "任务已完成。", "system");
      this.storage.createNotification({
        type: "run_complete",
        title: "任务已完成",
        body: run.title,
        relatedConversationId: run.conversationId,
        relatedRunId: runId,
      });
      this.activeRuns.delete(runId);
      this.emitSnapshot();
      return;
    }

    controller.busy = true;
    try {
      await step.execute();
      this.storage.updateRun(runId, { stepIndex: run.stepIndex + 1 });
      controller.busy = false;

      const latest = this.storage.getRun(runId);
      if (!latest) return;

      if (["cancelled", "failed", "completed"].includes(latest.status)) {
        this.emitSnapshot();
        return;
      }

      if (latest.status === "pausing") {
        this.storage.updateRun(runId, { status: "paused" });
        this.addRunMessage(latest.conversationId, runId, "任务已暂停。", "system");
        this.emitSnapshot();
        return;
      }

      this.scheduleNext(controller, step.delayMs ?? 900);
    } catch (error) {
      controller.busy = false;
      this.storage.updateRun(runId, {
        status: "failed",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.addRunMessage(
        run.conversationId,
        runId,
        `任务执行失败：${error instanceof Error ? error.message : String(error)}`,
        "system",
      );
      this.storage.createNotification({
        type: "run_failed",
        title: "任务执行失败",
        body: run.title,
        relatedConversationId: run.conversationId,
        relatedRunId: runId,
      });
      this.activeRuns.delete(runId);
      this.emitSnapshot();
      return;
    }

    this.emitSnapshot();
  }

  private async executeShellCommand(
    runId: string,
    conversationId: string,
    shellCommand: string,
    workspacePath: string,
  ): Promise<string> {
    await sleep(300);
    const artifactPath = this.getArtifactPath(workspacePath, `command-${runId}.md`);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(shellCommand, {
        cwd: workspacePath,
        shell: true,
        env: process.env,
      });

      const controller = this.activeRuns.get(runId);
      if (controller) {
        controller.childProcess = child;
      }

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        const normalizedStdout = trimOutput(stdout || "命令没有输出。");
        const normalizedStderr = trimOutput(stderr);
        this.writeTextFile(
          artifactPath,
          `# 命令执行结果\n\n- 命令：\`${shellCommand}\`\n- 工作目录：\`${workspacePath}\`\n- 退出码：${code ?? 0}\n\n## 标准输出\n\n\`\`\`\n${normalizedStdout}\n\`\`\`\n${normalizedStderr ? `\n## 标准错误\n\n\`\`\`\n${normalizedStderr}\n\`\`\`\n` : ""}`,
        );

        this.storage.addMessage({
          conversationId,
          senderId: "system",
          senderName: "System",
          senderKind: "system",
          messageType: "run",
          visibility: "system",
          content: `命令：${shellCommand}\n工作目录：${workspacePath}\n退出码：${code ?? 0}\n\n输出：\n${normalizedStdout}${
            normalizedStderr ? `\n\n错误输出：\n${normalizedStderr}` : ""
          }`,
          mentions: [],
          runId,
          metadata: { code, shellCommand, workspacePath },
          createdAt: Date.now(),
        });

        const runtimeController = this.activeRuns.get(runId);
        if (runtimeController) {
          runtimeController.childProcess = null;
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`命令退出码为 ${code ?? 1}`));
        }
      });
    });

    return artifactPath;
  }
  private addSystemMessage(conversationId: string, content: string) {
    this.storage.addMessage({
      conversationId,
      senderId: "system",
      senderName: "System",
      senderKind: "system",
      messageType: "system",
      visibility: "system",
      content,
      mentions: [],
      runId: null,
      metadata: null,
      createdAt: Date.now(),
    });
  }

  private addRunMessage(
    conversationId: string,
    runId: string,
    content: string,
    visibility: MessageVisibility,
  ) {
    this.storage.addMessage({
      conversationId,
      senderId: "system",
      senderName: "System",
      senderKind: "system",
      messageType: "run",
      visibility,
      content,
      mentions: [],
      runId,
      metadata: null,
      createdAt: Date.now(),
    });
  }

  private getArtifactDir(workspacePath: string) {
    return join(workspacePath, "artifacts");
  }

  private getArtifactPath(workspacePath: string, fileName: string) {
    return join(this.getArtifactDir(workspacePath), fileName);
  }

  private ensureWorkspaceFolders(workspacePath: string) {
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(this.getArtifactDir(workspacePath), { recursive: true });
    mkdirSync(join(workspacePath, "memory"), { recursive: true });
    mkdirSync(join(workspacePath, "sessions"), { recursive: true });
  }

  private writeTextFile(filePath: string, content: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  }

  private appendMemory(workspacePath: string, relativePath: string, line: string) {
    this.ensureWorkspaceFolders(workspacePath);
    const filePath = join(workspacePath, relativePath);
    const title = relativePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "memory";
    const header = existsSync(filePath) ? "" : `# ${title}\n\n`;
    if (header) {
      this.writeTextFile(filePath, header);
    }
    appendFileSync(filePath, `${line}\n`, "utf8");
    return filePath;
  }

  private writeAgentArtifact(
    workspacePath: string,
    runId: string,
    agent: AgentRecord,
    input: string,
    response: string,
    activeSkill: string | null,
  ) {
    this.ensureWorkspaceFolders(workspacePath);
    const artifactPath = this.getArtifactPath(workspacePath, `agent-${runId}.md`);
    this.writeTextFile(
      artifactPath,
      [
        "# Agent 任务产物",
        "",
        `- Agent：${agent.name}`,
        `- 角色：${agent.role}`,
        `- 技能：${activeSkill ?? "默认"}`,
        `- 输入：${input}`,
        "",
        "## 回复",
        "",
        response,
        "",
      ].join("\n"),
    );
    return artifactPath;
  }

  private writeTeamArtifact(
    workspacePath: string,
    runId: string,
    team: TeamRecord,
    manager: AgentRecord,
    specialists: AgentRecord[],
    input: string,
    context: TeamContext,
    specialistOutputs: TeamSpecialistOutput[],
    finalResponse: TeamFinalResponse,
  ) {
    this.ensureWorkspaceFolders(workspacePath);
    const artifactPath = this.getArtifactPath(workspacePath, `team-${runId}.md`);
    this.writeTextFile(
      artifactPath,
      [
        "# Team 协作产物",
        "",
        `- 群组：${team.name}`,
        `- 经理：${manager.name}`,
        `- 协作者：${specialists.map((agent) => agent.name).join("、") || "无"}`,
        `- 输入：${input}`,
        `- 阶段：${context.phase}`,
        "",
        "## 群组上下文",
        "",
        `- 目标：${team.objective}`,
        `- 当前任务：${context.activeTasks.join("、") || "暂无"}`,
        "",
        "## Specialist 协作",
        "",
        specialistOutputs.length > 0
          ? specialistOutputs
              .map(
                (item) =>
                  `### ${item.specialist.name}\n\n- 任务：${item.task}\n- 可见性：${item.userContactMode === "specialist_direct" ? "public" : item.visibility}\n- 用户交互方式：${item.userContactMode}\n${
                    item.userQuestionDraft ? `- 问题草案：${item.userQuestionDraft}\n` : ""
                  }- 输出：${item.content}\n`,
              )
              .join("\n")
          : "本轮没有 specialist 协作。",
        "",
        "## 最终回复",
        "",
        `- 发言人：${finalResponse.speaker.name}`,
        "",
        finalResponse.content,
        "",
      ].join("\n"),
    );
    return artifactPath;
  }

  private formatTimestamp() {
    return new Date().toISOString();
  }

  private getWorkspaceForConversation(
    conversation: ConversationRecord,
    agents: AgentRecord[],
    teams: TeamRecord[],
  ) {
    if (conversation.kind === "agent") {
      return agents.find((agent) => agent.id === conversation.targetId)?.workspacePath ?? this.dataDir;
    }

    return teams.find((team) => team.id === conversation.targetId)?.workspacePath ?? this.dataDir;
  }

  private resolveActiveProvider(snapshot: AppSnapshot): ProviderConfig | null {
    return (
      snapshot.providers.find((provider) => provider.id === snapshot.settings.activeProviderId) ??
      snapshot.providers.find((provider) => provider.isActive) ??
      null
    );
  }

  private recoverInterruptedRuns() {
    for (const run of this.storage.listRuns()) {
      if (["running", "pausing", "resuming"].includes(run.status)) {
        this.storage.updateRun(run.id, { status: "paused" as RunStatus });
        this.addRunMessage(
          run.conversationId,
          run.id,
          "应用重新启动后，任务已恢复为暂停状态。",
          "system",
        );
      }
    }
  }

  private emitSnapshot() {
    this.emit("snapshot", this.getSnapshot());
  }
}
