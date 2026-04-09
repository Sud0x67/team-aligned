import type { ReactNode } from "react";
import {
  Blocks,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  Puzzle,
  Zap,
} from "lucide-react";
import type { AgentRecord, SkillCatalogRecord, McpCatalogRecord, TeamRecord } from "@shared";
import { AvatarBadge } from "../avatar-badge";

export function AgentAvatar({ agent }: { agent: AgentRecord }) {
  return (
    <AvatarBadge
      src={agent.avatarPath}
      fallback={agent.avatar}
      alt={agent.name}
      className="h-11 w-11 rounded-xl"
      style={{ backgroundColor: agent.avatarColor }}
      textClassName="text-sm font-semibold text-white"
    />
  );
}

export function GroupAvatar({ team }: { team: TeamRecord }) {
  return (
    <AvatarBadge
      src={team.avatarPath}
      fallback={team.avatar || team.name.slice(0, 1).toUpperCase()}
      alt={team.name}
      className="h-11 w-11 shrink-0 rounded-xl"
      style={{
        backgroundColor: `${team.avatarColor}20`,
        color: team.avatarColor,
      }}
      textClassName="text-sm font-semibold"
    />
  );
}

export function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function AgentCard({
  agent,
  whitelistedSkills,
  whitelistedMcps,
  completedRunCount,
  language,
  labels,
  onEdit,
  onConfigureSkills,
  onConfigureMcps,
  onOpenWorkspace,
}: {
  agent: AgentRecord;
  whitelistedSkills: SkillCatalogRecord[];
  whitelistedMcps: McpCatalogRecord[];
  completedRunCount: number;
  language: "zh" | "en";
  labels: {
    skillWhitelist: string;
    mcpWhitelist: string;
    configureSkills: string;
    configureMcps: string;
    openExtensions: string;
    noAgentSkills: string;
    noSkillsInstalled: string;
    noAgentMcps: string;
    noMcpsConnected: string;
    completedTasks: string;
    tasksUnit: string;
    edit: string;
  };
  onEdit: () => void;
  onConfigureSkills: () => void;
  onConfigureMcps: () => void;
  onOpenWorkspace: () => void;
}) {
  return (
    <div className="group rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-colors hover:border-[color-mix(in_srgb,var(--primary)_30%,transparent)]">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={agent} />
          <div>
            <h4 className="text-[15px] font-semibold text-[var(--foreground)]">{agent.name}</h4>
            <p className="text-[12px] text-[var(--muted-foreground)]">{agent.role}</p>
          </div>
        </div>
        <button
          type="button"
          title={labels.edit}
          onClick={onEdit}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <MoreHorizontal className="h-4 w-4 text-[var(--muted-foreground)]" />
        </button>
      </div>

      <p className="mb-4 text-[13px] leading-6 text-[var(--muted-foreground)]">{agent.description}</p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {agent.capabilities.slice(0, 3).map((capability) => (
          <span
            key={capability}
            className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]"
          >
            {capability}
          </span>
        ))}
        {agent.capabilities.length > 3 ? (
          <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
            +{agent.capabilities.length - 3}
          </span>
        ) : null}
      </div>

      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--foreground)]">
            <Puzzle className="h-3.5 w-3.5 text-[var(--primary)]" />
            {labels.skillWhitelist}
          </div>
          <button
            onClick={onConfigureSkills}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
          >
            {labels.configureSkills}
          </button>
        </div>
        {whitelistedSkills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {whitelistedSkills.slice(0, 3).map((skill) => (
              <span
                key={skill.id}
                className="rounded-md bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[11px] text-[var(--primary)]"
              >
                {language === "zh" ? skill.displayName || skill.name : skill.name}
              </span>
            ))}
            {whitelistedSkills.length > 3 ? (
              <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
                +{whitelistedSkills.length - 3}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-[12px] text-[var(--muted-foreground)]">
            {labels.noAgentSkills}
          </p>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--foreground)]">
            <Blocks className="h-3.5 w-3.5 text-[var(--primary)]" />
            {labels.mcpWhitelist}
          </div>
          <button
            onClick={onConfigureMcps}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
          >
            {labels.configureMcps}
          </button>
        </div>
        {whitelistedMcps.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {whitelistedMcps.slice(0, 3).map((server) => (
              <span
                key={server.id}
                className="rounded-md bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[11px] text-[var(--primary)]"
              >
                {server.name}
              </span>
            ))}
            {whitelistedMcps.length > 3 ? (
              <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
                +{whitelistedMcps.length - 3}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-[12px] text-[var(--muted-foreground)]">{labels.noAgentMcps}</p>
        )}
      </div>

      <button
        onClick={onOpenWorkspace}
        className="mb-4 flex w-full items-center gap-1.5 rounded-lg text-left text-[12px] text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{agent.workspacePath}</span>
      </button>

      <div className="flex items-center border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--muted-foreground)]">
          <Zap className="h-3.5 w-3.5" />
          {labels.completedTasks} {completedRunCount} {labels.tasksUnit}
        </div>
      </div>
    </div>
  );
}

export function TeamCard({
  team,
  members,
  whitelistedMcps,
  labels,
  onConfigureMcps,
  onOpenWorkspace,
  onOpenConversation,
}: {
  team: TeamRecord;
  members: AgentRecord[];
  whitelistedMcps: McpCatalogRecord[];
  labels: {
    members: string;
    mcpWhitelist: string;
    configureMcps: string;
    noAgentMcps: string;
    manageAction: string;
    startConversationAction: string;
  };
  onConfigureMcps: () => void;
  onOpenWorkspace: () => void;
  onOpenConversation: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-colors hover:border-[color-mix(in_srgb,var(--primary)_30%,transparent)]">
      <div className="mb-3 flex items-center gap-3">
        <GroupAvatar team={team} />
        <div>
          <h4 className="text-[15px] font-semibold text-[var(--foreground)]">{team.name}</h4>
          <p className="text-[12px] text-[var(--muted-foreground)]">
            {members.length} {labels.members}
          </p>
        </div>
      </div>

      <p className="mb-4 text-[13px] leading-6 text-[var(--muted-foreground)]">{team.description}</p>

      <button
        onClick={onOpenWorkspace}
        className="mb-4 flex w-full items-center gap-1.5 rounded-lg text-left text-[12px] text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{team.workspacePath}</span>
      </button>

      <div className="mb-4 flex items-center gap-1">
        <div className="flex -space-x-2">
          {members.slice(0, 4).map((member) => (
            <AvatarBadge
              key={member.id}
              src={member.avatarPath}
              fallback={member.avatar}
              alt={member.name}
              className="h-8 w-8 rounded-full border-2 border-[var(--card)]"
              style={{ backgroundColor: member.avatarColor }}
              textClassName="text-[11px] font-semibold text-white"
            />
          ))}
          {members.length > 4 ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--card)] bg-[var(--muted)] text-[11px] text-[var(--muted-foreground)]">
              +{members.length - 4}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--foreground)]">
            <Blocks className="h-3.5 w-3.5 text-[var(--primary)]" />
            {labels.mcpWhitelist}
          </div>
          <button
            onClick={onConfigureMcps}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--primary)] transition hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
          >
            {labels.configureMcps}
          </button>
        </div>
        {whitelistedMcps.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {whitelistedMcps.slice(0, 3).map((server) => (
              <span
                key={server.id}
                className="rounded-md bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[11px] text-[var(--primary)]"
              >
                {server.name}
              </span>
            ))}
            {whitelistedMcps.length > 3 ? (
              <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
                +{whitelistedMcps.length - 3}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-[12px] text-[var(--muted-foreground)]">{labels.noAgentMcps}</p>
        )}
      </div>

      <div className="flex gap-2 border-t border-[var(--border)] pt-3">
        <button
          onClick={onOpenWorkspace}
          className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
        >
          {labels.manageAction}
        </button>
        <button
          onClick={onOpenConversation}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-3 py-2 text-[13px] text-[var(--primary)] transition hover:bg-[color-mix(in_srgb,var(--primary)_18%,transparent)]"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {labels.startConversationAction}
        </button>
      </div>
    </div>
  );
}
