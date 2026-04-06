import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AgentRecord, TeamRecord } from "@shared";
import { createTranslator } from "../i18n";
import { useAppStore } from "../store/use-app-store";
import { AvatarBadge } from "../components/avatar-badge";
import { AvatarPicker } from "../components/avatar-picker";

type ActiveTab = "agents" | "groups";

const defaultAgentForm = {
  name: "",
  role: "",
  description: "",
  capabilities: "",
  workspacePath: "",
  avatarPath: null as string | null,
};

const defaultTeamForm = {
  name: "",
  description: "",
  objective: "",
  memberIds: [] as string[],
  workspacePath: "",
  avatarPath: null as string | null,
};

function AgentAvatar({ agent }: { agent: AgentRecord }) {
  return (
    <div className="relative">
      <AvatarBadge
        src={agent.avatarPath}
        fallback={agent.avatar}
        alt={agent.name}
        className="h-11 w-11 rounded-xl"
        style={{ backgroundColor: agent.avatarColor }}
        textClassName="text-sm font-semibold text-white"
      />
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--card)] ${
          agent.status === "online"
            ? "bg-emerald-500"
            : agent.status === "busy"
              ? "bg-amber-500"
              : "bg-[color-mix(in_srgb,var(--muted-foreground)_60%,transparent)]"
        }`}
      />
    </div>
  );
}

function GroupAvatar({ team }: { team: TeamRecord }) {
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

function TabButton({
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

export function ManagePage() {
  const navigate = useNavigate();
  const { agents, teams, runs, settings, createAgent, createTeam, openWorkspace } = useAppStore();
  const t = createTranslator(settings.language);

  const [activeTab, setActiveTab] = useState<ActiveTab>("agents");
  const [search, setSearch] = useState("");
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [agentForm, setAgentForm] = useState(defaultAgentForm);
  const [teamForm, setTeamForm] = useState(defaultTeamForm);

  const completedRunsByActor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      if (run.status === "completed") {
        counts.set(run.actorId, (counts.get(run.actorId) ?? 0) + 1);
      }
    }
    return counts;
  }, [runs]);

  const visibleAgents = useMemo(
    () =>
      [...agents]
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
        .filter(
          (agent) =>
            agent.name.toLowerCase().includes(search.trim().toLowerCase()) ||
            agent.role.toLowerCase().includes(search.trim().toLowerCase()),
        ),
    [agents, search],
  );

  const visibleTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")),
    [teams],
  );

  const submitAgent = async () => {
    if (!agentForm.name.trim() || !agentForm.role.trim()) return;
    await createAgent({
      name: agentForm.name.trim(),
      role: agentForm.role.trim(),
      description: agentForm.description.trim() || t.chat("noDescriptionYet"),
      capabilities: agentForm.capabilities
        .split(/[，,、\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
      workspacePath: agentForm.workspacePath.trim() || undefined,
      avatarPath: agentForm.avatarPath,
    });
    setAgentForm(defaultAgentForm);
    setShowAgentForm(false);
  };

  const submitTeam = async () => {
    if (!teamForm.name.trim() || teamForm.memberIds.length === 0) return;
    await createTeam({
      name: teamForm.name.trim(),
      description: teamForm.description.trim() || t.chat("noDescriptionYet"),
      objective: teamForm.objective.trim() || t.chat("objectiveNotSet"),
      memberIds: teamForm.memberIds,
      workspacePath: teamForm.workspacePath.trim() || undefined,
      avatarPath: teamForm.avatarPath,
    });
    setTeamForm(defaultTeamForm);
    setShowTeamForm(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)]">
      <div className="flex items-center gap-1 px-6 pb-0 pt-5">
        <TabButton
          active={activeTab === "agents"}
          icon={<Bot className="h-4 w-4" />}
          label={t.manage("agentsTab")}
          onClick={() => setActiveTab("agents")}
        />
        <TabButton
          active={activeTab === "groups"}
          icon={<Users className="h-4 w-4" />}
          label={t.manage("groupsTab")}
          onClick={() => setActiveTab("groups")}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "agents" ? (
          <div className="space-y-5 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-[20px] font-medium text-[var(--foreground)]">
                  {t.manage("agentsTab")}
                </h1>
                <p className="mt-1 text-[14px] text-[var(--muted-foreground)]">
                  {t.manage("agentsSubtitle")}
                </p>
              </div>
              <button
                onClick={() => setShowAgentForm(true)}
                className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                {t.manage("createAgent")}
              </button>
            </div>

            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                placeholder={t.manage("searchAgentsPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-4 text-[14px] text-[var(--foreground)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_35%,transparent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_16%,transparent)]"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {visibleAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="group rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-colors hover:border-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                >
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <AgentAvatar agent={agent} />
                      <div>
                        <h4 className="text-[15px] font-semibold text-[var(--foreground)]">{agent.name}</h4>
                        <p className="text-[12px] text-[var(--muted-foreground)]">{agent.role}</p>
                      </div>
                    </div>
                    <button className="rounded-lg p-1.5 opacity-0 transition-all hover:bg-[var(--muted)] group-hover:opacity-100">
                      <MoreHorizontal className="h-4 w-4 text-[var(--muted-foreground)]" />
                    </button>
                  </div>

                  <p className="mb-4 text-[13px] leading-6 text-[var(--muted-foreground)]">
                    {agent.description}
                  </p>

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

                  <button
                    onClick={() => openWorkspace(agent.workspacePath)}
                    className="mb-4 flex w-full items-center gap-1.5 rounded-lg text-left text-[12px] text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{agent.workspacePath}</span>
                  </button>

                  <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
                    <div className="flex items-center gap-1.5 text-[12px] text-[var(--muted-foreground)]">
                      <Zap className="h-3.5 w-3.5" />
                      {t.manage("completedTasks")} {completedRunsByActor.get(agent.id) ?? 0}{" "}
                      {t.manage("tasksUnit")}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        agent.status === "online"
                          ? "bg-emerald-500/10 text-emerald-500"
                          : agent.status === "busy"
                            ? "bg-amber-500/10 text-amber-500"
                            : "bg-[color-mix(in_srgb,var(--muted-foreground)_12%,transparent)] text-[var(--muted-foreground)]"
                      }`}
                    >
                      {agent.status === "online"
                        ? t.dashboard("online")
                        : agent.status === "busy"
                          ? t.dashboard("busy")
                          : t.dashboard("offline")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-[20px] font-medium text-[var(--foreground)]">
                  {t.manage("groupsTab")}
                </h1>
                <p className="mt-1 text-[14px] text-[var(--muted-foreground)]">
                  {t.manage("groupsSubtitle")}
                </p>
              </div>
              <button
                onClick={() => setShowTeamForm(true)}
                className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                {t.manage("createTeam")}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {visibleTeams.map((team) => {
                const members = agents.filter((agent) => team.memberIds.includes(agent.id));
                return (
                  <div
                    key={team.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-colors hover:border-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <GroupAvatar team={team} />
                      <div>
                        <h4 className="text-[15px] font-semibold text-[var(--foreground)]">{team.name}</h4>
                        <p className="text-[12px] text-[var(--muted-foreground)]">
                          {members.length} {t.common("members")}
                        </p>
                      </div>
                    </div>

                    <p className="mb-4 text-[13px] leading-6 text-[var(--muted-foreground)]">
                      {team.description}
                    </p>

                    <button
                      onClick={() => openWorkspace(team.workspacePath)}
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

                    <div className="flex gap-2 border-t border-[var(--border)] pt-3">
                      <button
                        onClick={() => openWorkspace(team.workspacePath)}
                        className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                      >
                        {t.manage("manageAction")}
                      </button>
                      <button
                        onClick={() => navigate("/")}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-3 py-2 text-[13px] text-[var(--primary)] transition hover:bg-[color-mix(in_srgb,var(--primary)_18%,transparent)]"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        {t.manage("startConversationAction")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showAgentForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-[18px] font-semibold text-[var(--foreground)]">
                {t.manage("createNewAgent")}
              </h2>
              <button
                onClick={() => {
                  setShowAgentForm(false);
                  setAgentForm(defaultAgentForm);
                }}
                className="rounded-lg p-1.5 hover:bg-[var(--muted)]"
              >
                <X className="h-5 w-5 text-[var(--muted-foreground)]" />
              </button>
            </div>

            <div className="space-y-4">
              <AvatarPicker
                label={t.manage("avatar")}
                value={agentForm.avatarPath}
                fallback={agentForm.name.slice(0, 1).toUpperCase() || "A"}
                color="var(--primary)"
                uploadLabel={
                  agentForm.avatarPath ? t.common("changeAvatar") : t.common("uploadAvatar")
                }
                removeLabel={t.common("removeAvatar")}
                onChange={(avatarPath) => setAgentForm((current) => ({ ...current, avatarPath }))}
              />
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("name")}</label>
                <input
                  value={agentForm.name}
                  onChange={(event) => setAgentForm({ ...agentForm, name: event.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("role")}</label>
                <input
                  value={agentForm.role}
                  onChange={(event) => setAgentForm({ ...agentForm, role: event.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("descriptionField")}</label>
                <textarea
                  value={agentForm.description}
                  onChange={(event) => setAgentForm({ ...agentForm, description: event.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("capabilities")}</label>
                <input
                  value={agentForm.capabilities}
                  onChange={(event) => setAgentForm({ ...agentForm, capabilities: event.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("workspacePath")}</label>
                <input
                  value={agentForm.workspacePath}
                  onChange={(event) => setAgentForm({ ...agentForm, workspacePath: event.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAgentForm(false);
                  setAgentForm(defaultAgentForm);
                }}
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
              >
                {t.manage("cancel")}
              </button>
              <button
                onClick={() => void submitAgent()}
                className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] text-white transition hover:opacity-90"
              >
                {t.manage("create")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showTeamForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-[18px] font-semibold text-[var(--foreground)]">
                {t.manage("createNewGroup")}
              </h2>
              <button
                onClick={() => {
                  setShowTeamForm(false);
                  setTeamForm(defaultTeamForm);
                }}
                className="rounded-lg p-1.5 hover:bg-[var(--muted)]"
              >
                <X className="h-5 w-5 text-[var(--muted-foreground)]" />
              </button>
            </div>

            <div className="space-y-4">
              <AvatarPicker
                label={t.manage("avatar")}
                value={teamForm.avatarPath}
                fallback={teamForm.name.slice(0, 1).toUpperCase() || "G"}
                color="var(--primary)"
                uploadLabel={
                  teamForm.avatarPath ? t.common("changeAvatar") : t.common("uploadAvatar")
                }
                removeLabel={t.common("removeAvatar")}
                onChange={(avatarPath) => setTeamForm((current) => ({ ...current, avatarPath }))}
              />
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("teamName")}</label>
                <input
                  value={teamForm.name}
                  onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("descriptionField")}</label>
                <input
                  value={teamForm.description}
                  onChange={(event) => setTeamForm({ ...teamForm, description: event.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("teamObjective")}</label>
                <input
                  value={teamForm.objective}
                  onChange={(event) => setTeamForm({ ...teamForm, objective: event.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("chooseMembers")}</label>
                <div className="grid grid-cols-2 gap-2">
                  {agents.map((agent) => {
                    const selected = teamForm.memberIds.includes(agent.id);
                    return (
                      <button
                        key={agent.id}
                        onClick={() =>
                          setTeamForm((current) => ({
                            ...current,
                            memberIds: selected
                              ? current.memberIds.filter((id) => id !== agent.id)
                              : [...current.memberIds, agent.id],
                          }))
                        }
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors ${
                          selected
                            ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
                            : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"
                        }`}
                      >
                        <AvatarBadge
                          src={agent.avatarPath}
                          fallback={agent.avatar}
                          alt={agent.name}
                          className="h-7 w-7 shrink-0 rounded-md"
                          style={{ backgroundColor: agent.avatarColor }}
                          textClassName="text-[11px] font-semibold text-white"
                        />
                        <span className="truncate">{agent.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--muted-foreground)]">{t.manage("workspacePath")}</label>
                <input
                  value={teamForm.workspacePath}
                  onChange={(event) => setTeamForm({ ...teamForm, workspacePath: event.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-[14px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowTeamForm(false);
                  setTeamForm(defaultTeamForm);
                }}
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
              >
                {t.manage("cancel")}
              </button>
              <button
                onClick={() => void submitTeam()}
                className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] text-white transition hover:opacity-90"
              >
                {t.manage("create")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
