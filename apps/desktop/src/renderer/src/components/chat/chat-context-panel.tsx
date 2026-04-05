import { Bot, Clock3, FolderOpen, Users } from "lucide-react";
import type { AgentRecord, ConversationRecord, MessageRecord, RunRecord, TeamRecord } from "@shared";
import { getTeamContextSummary } from "./chat-utils";
import { StatChip } from "./chat-primitives";

export function ChatContextPanel({
  conversation,
  team,
  agent,
  run,
  messages,
  internalVisible,
  onPause,
  onResume,
  onCancel,
}: {
  conversation: ConversationRecord | null;
  team: TeamRecord | null;
  agent: AgentRecord | null;
  run: RunRecord | null;
  messages: MessageRecord[];
  internalVisible: boolean;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  if (!conversation) {
    return (
      <div className="card flex h-full items-center justify-center px-5 py-8 text-center text-[var(--muted-text)]">
        选择一个会话后，这里会展示上下文、成员和运行状态。
      </div>
    );
  }

  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-4">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted-text)]">上下文</p>
        <h3 className="mt-1 text-lg font-semibold">
          {conversation.kind === "team" ? "群组协作面板" : "单聊协作面板"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-text)]">
          {conversation.kind === "team"
            ? "群聊会显示共享上下文、成员和内部消息切换。"
            : "单聊会聚焦当前 Agent、技能、命令和运行控制。"}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {conversation.kind === "team" && team ? (
          <>
            <div className="rounded-[26px] border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--primary)]" />
                <p className="text-sm font-semibold">群组上下文</p>
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-text)]">
                {getTeamContextSummary(team.context)}
              </p>
              <div className="mt-4 space-y-2 text-sm text-[var(--text)]">
                <p><span className="text-[var(--muted-text)]">目标：</span>{team.context.objective}</p>
                <p><span className="text-[var(--muted-text)]">阶段：</span>{team.context.phase}</p>
                <p><span className="text-[var(--muted-text)]">工作目录：</span>{team.workspacePath}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatChip label="成员" value={`${team.memberIds.length} 位`} />
              <StatChip label="消息" value={`${messages.length} 条`} />
            </div>

            <div className="rounded-[26px] border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-[var(--primary)]" />
                <p className="text-sm font-semibold">共享任务</p>
              </div>
              <div className="mt-3 space-y-2">
                {team.context.activeTasks.slice(0, 4).map((task) => (
                  <div key={task} className="rounded-2xl bg-[var(--panel-muted)] px-3 py-2 text-sm">
                    {task}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[26px] border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-[var(--primary)]" />
                <p className="text-sm font-semibold">内部消息</p>
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-text)]">
                {internalVisible ? "当前已显示群组内部协作消息。" : "当前只显示公开群聊消息。"}
              </p>
            </div>
          </>
        ) : null}

        {conversation.kind === "agent" && agent ? (
          <>
            <div className="rounded-[26px] border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-[var(--primary)]" />
                <p className="text-sm font-semibold">当前 Agent</p>
              </div>
              <div className="mt-3 space-y-2 text-sm text-[var(--text)]">
                <p><span className="text-[var(--muted-text)]">名称：</span>{agent.name}</p>
                <p><span className="text-[var(--muted-text)]">角色：</span>{agent.role}</p>
                <p><span className="text-[var(--muted-text)]">状态：</span>{agent.status}</p>
                <p><span className="text-[var(--muted-text)]">工作目录：</span>{agent.workspacePath}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatChip label="能力" value={`${agent.capabilities.length} 项`} />
              <StatChip label="运行" value={run ? run.status : "空闲"} />
            </div>

            <div className="rounded-[26px] border border-[var(--border)] bg-[var(--panel)] p-4">
              <p className="text-sm font-semibold">对话中关键消息</p>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-text)]">
                当前消息总数：{messages.length}。你可以通过 `/skills`、`/command`、`/mcp` 让这个 Agent 切换能力或执行本地任务。
              </p>
            </div>
          </>
        ) : null}

        {run ? (
          <div className="rounded-[26px] border border-dashed border-[color-mix(in_srgb,var(--primary)_20%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] p-4">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-[var(--primary)]" />
              <p className="text-sm font-semibold">运行控制</p>
            </div>
            <p className="mt-2 text-sm leading-7 text-[var(--muted-text)]">
              {run.title} · {run.kind} · {run.status}
            </p>
            <p className="mt-2 text-xs text-[var(--muted-text)]">
              步骤 {run.stepIndex} / {run.totalSteps}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="button-secondary" onClick={() => void onPause()}>
                暂停
              </button>
              <button className="button-secondary" onClick={() => void onResume()}>
                恢复
              </button>
              <button className="button-secondary" onClick={() => void onCancel()}>
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
