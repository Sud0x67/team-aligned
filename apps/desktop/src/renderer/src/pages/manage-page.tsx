import { useMemo, useState } from "react";
import {
  Bot,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AgentRecord, TeamRecord } from "@shared";
import { createTranslator } from "../i18n";
import { useAppStore } from "../store/use-app-store";
import { AgentCard, TeamCard, TabButton } from "../components/manage/manage-cards";
import {
  AgentFormModal,
  SelectionModal,
  TeamFormModal,
  type AgentFormState,
  type TeamFormState,
} from "../components/manage/manage-modals";

type ActiveTab = "agents" | "groups";

const defaultAgentForm: AgentFormState = {
  name: "",
  role: "",
  description: "",
  capabilities: "",
  workspacePath: "",
  avatarPath: null as string | null,
};

const defaultTeamForm: TeamFormState = {
  name: "",
  description: "",
  objective: "",
  memberIds: [] as string[],
  workspacePath: "",
  avatarPath: null as string | null,
};

export function ManagePage() {
  const navigate = useNavigate();
  const {
    agents,
    teams,
    conversations,
    runs,
    skillCatalog,
    mcpCatalog,
    mcpConnections,
    settings,
    createAgent,
    createTeam,
    updateAgent,
    openWorkspace,
    updateAgentSkills,
    updateAgentMcps,
    updateTeamMcps,
  } = useAppStore();
  const t = createTranslator(settings.language);

  const [activeTab, setActiveTab] = useState<ActiveTab>("agents");
  const [search, setSearch] = useState("");
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRecord | null>(null);
  const [editingAgentSkills, setEditingAgentSkills] = useState<AgentRecord | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [editingAgentMcps, setEditingAgentMcps] = useState<AgentRecord | null>(null);
  const [editingTeamMcps, setEditingTeamMcps] = useState<TeamRecord | null>(null);
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
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

  const installedSkills = useMemo(
    () => skillCatalog.filter((skill) => skill.installed),
    [skillCatalog],
  );
  const connectedMcps = useMemo(() => {
    const connectedIds = new Set(
      mcpConnections
        .filter((connection) => connection.enabled && connection.status === "connected")
        .map((connection) => connection.serverId),
    );
    return mcpCatalog.filter((server) => connectedIds.has(server.id));
  }, [mcpCatalog, mcpConnections]);

  const openConversation = (input: { kind: "agent" | "team"; targetId: string }) => {
    const conversation = conversations.find(
      (item) => item.kind === input.kind && item.targetId === input.targetId,
    );
    navigate("/", {
      state: conversation ? { conversationId: conversation.id } : undefined,
    });
  };

  const submitAgent = async () => {
    if (!agentForm.name.trim() || !agentForm.role.trim()) return;
    const payload = {
      name: agentForm.name.trim(),
      role: agentForm.role.trim(),
      description: agentForm.description.trim() || t.chat("noDescriptionYet"),
      capabilities: agentForm.capabilities
        .split(/[，,、\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
      workspacePath: agentForm.workspacePath.trim() || undefined,
      avatarPath: agentForm.avatarPath,
    };

    if (editingAgent) {
      await updateAgent({
        agentId: editingAgent.id,
        ...payload,
      });
    } else {
      await createAgent(payload);
    }

    setEditingAgent(null);
    setAgentForm(defaultAgentForm);
    setShowAgentForm(false);
  };

  const openCreateAgentForm = () => {
    setEditingAgent(null);
    setAgentForm(defaultAgentForm);
    setShowAgentForm(true);
  };

  const openEditAgentForm = (agent: AgentRecord) => {
    setEditingAgent(agent);
    setAgentForm({
      name: agent.name,
      role: agent.role,
      description: agent.description,
      capabilities: agent.capabilities.join(", "),
      workspacePath: agent.workspacePath,
      avatarPath: agent.avatarPath,
    });
    setShowAgentForm(true);
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

  const openSkillEditor = (agent: AgentRecord) => {
    setEditingAgentSkills(agent);
    setSelectedSkillIds(
      agent.skillWhitelist.filter((skillId) => installedSkills.some((skill) => skill.id === skillId)),
    );
  };

  const submitAgentSkills = async () => {
    if (!editingAgentSkills) return;
    await updateAgentSkills({
      agentId: editingAgentSkills.id,
      skillIds: selectedSkillIds,
    });
    setEditingAgentSkills(null);
    setSelectedSkillIds([]);
  };

  const openAgentMcpEditor = (agent: AgentRecord) => {
    setEditingAgentMcps(agent);
    setSelectedMcpIds(
      agent.mcpWhitelist.filter((serverId) => connectedMcps.some((server) => server.id === serverId)),
    );
  };

  const openTeamMcpEditor = (team: TeamRecord) => {
    setEditingTeamMcps(team);
    setSelectedMcpIds(
      team.mcpWhitelist.filter((serverId) => connectedMcps.some((server) => server.id === serverId)),
    );
  };

  const submitAgentMcps = async () => {
    if (!editingAgentMcps) return;
    await updateAgentMcps({
      agentId: editingAgentMcps.id,
      serverIds: selectedMcpIds,
    });
    setEditingAgentMcps(null);
    setSelectedMcpIds([]);
  };

  const submitTeamMcps = async () => {
    if (!editingTeamMcps) return;
    await updateTeamMcps({
      teamId: editingTeamMcps.id,
      serverIds: selectedMcpIds,
    });
    setEditingTeamMcps(null);
    setSelectedMcpIds([]);
  };

  const toggleSelectedId = (id: string) => {
    setSelectedMcpIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleSelectedSkillId = (id: string) => {
    setSelectedSkillIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
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
                onClick={openCreateAgentForm}
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
              {visibleAgents.map((agent) => {
                const whitelistedSkills = installedSkills.filter((skill) =>
                  agent.skillWhitelist.includes(skill.id),
                );
                const whitelistedMcps = connectedMcps.filter((server) =>
                  agent.mcpWhitelist.includes(server.id),
                );

                return (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    whitelistedSkills={whitelistedSkills}
                    whitelistedMcps={whitelistedMcps}
                    completedRunCount={completedRunsByActor.get(agent.id) ?? 0}
                    language={settings.language}
                    labels={{
                      skillWhitelist: t.manage("skillWhitelist"),
                      mcpWhitelist: t.manage("mcpWhitelist"),
                      configureSkills:
                        installedSkills.length > 0 ? t.manage("configureSkills") : t.manage("openExtensions"),
                      configureMcps:
                        connectedMcps.length > 0 ? t.manage("configureMcps") : t.manage("openExtensions"),
                      openExtensions: t.manage("openExtensions"),
                      noAgentSkills:
                        installedSkills.length > 0 ? t.manage("noAgentSkills") : t.manage("noSkillsInstalled"),
                      noSkillsInstalled: t.manage("noSkillsInstalled"),
                      noAgentMcps:
                        connectedMcps.length > 0 ? t.manage("noAgentMcps") : t.manage("noMcpsConnected"),
                      noMcpsConnected: t.manage("noMcpsConnected"),
                      completedTasks: t.manage("completedTasks"),
                      tasksUnit: t.manage("tasksUnit"),
                      edit: t.manage("editAgent"),
                    }}
                    onEdit={() => openEditAgentForm(agent)}
                    onConfigureSkills={() =>
                      installedSkills.length > 0 ? openSkillEditor(agent) : navigate("/extensions")
                    }
                    onConfigureMcps={() =>
                      connectedMcps.length > 0 ? openAgentMcpEditor(agent) : navigate("/extensions")
                    }
                    onOpenWorkspace={() => openWorkspace(agent.workspacePath)}
                  />
                );
              })}
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
                const whitelistedMcps = connectedMcps.filter((server) => team.mcpWhitelist.includes(server.id));
                return (
                  <TeamCard
                    key={team.id}
                    team={team}
                    members={members}
                    whitelistedMcps={whitelistedMcps}
                    labels={{
                      members: t.common("members"),
                      mcpWhitelist: t.manage("mcpWhitelist"),
                      configureMcps:
                        connectedMcps.length > 0 ? t.manage("configureMcps") : t.manage("openExtensions"),
                      noAgentMcps:
                        connectedMcps.length > 0 ? t.manage("noAgentMcps") : t.manage("noMcpsConnected"),
                      manageAction: t.manage("manageAction"),
                      startConversationAction: t.manage("startConversationAction"),
                    }}
                    onConfigureMcps={() =>
                      connectedMcps.length > 0 ? openTeamMcpEditor(team) : navigate("/extensions")
                    }
                    onOpenWorkspace={() => openWorkspace(team.workspacePath)}
                    onOpenConversation={() => openConversation({ kind: "team", targetId: team.id })}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <AgentFormModal
        open={showAgentForm}
        form={agentForm}
        title={editingAgent ? t.manage("editAgent") : t.manage("createNewAgent")}
        submitLabel={editingAgent ? t.manage("saveAgent") : t.manage("create")}
        labels={{
          createNewAgent: t.manage("createNewAgent"),
          avatar: t.manage("avatar"),
          changeAvatar: t.common("changeAvatar"),
          uploadAvatar: t.common("uploadAvatar"),
          removeAvatar: t.common("removeAvatar"),
          name: t.manage("name"),
          role: t.manage("role"),
          descriptionField: t.manage("descriptionField"),
          capabilities: t.manage("capabilities"),
          workspacePath: t.manage("workspacePath"),
          browseDirectory: t.extensions("browseDirectory"),
          cancel: t.manage("cancel"),
          create: t.manage("create"),
        }}
        onChange={setAgentForm}
        onClose={() => {
          setEditingAgent(null);
          setShowAgentForm(false);
          setAgentForm(defaultAgentForm);
        }}
        onSubmit={() => void submitAgent()}
      />

      <TeamFormModal
        open={showTeamForm}
        form={teamForm}
        agents={agents}
        labels={{
          createNewGroup: t.manage("createNewGroup"),
          avatar: t.manage("avatar"),
          changeAvatar: t.common("changeAvatar"),
          uploadAvatar: t.common("uploadAvatar"),
          removeAvatar: t.common("removeAvatar"),
          teamName: t.manage("teamName"),
          descriptionField: t.manage("descriptionField"),
          teamObjective: t.manage("teamObjective"),
          chooseMembers: t.manage("chooseMembers"),
          workspacePath: t.manage("workspacePath"),
          browseDirectory: t.extensions("browseDirectory"),
          cancel: t.manage("cancel"),
          create: t.manage("create"),
        }}
        onChange={setTeamForm}
        onClose={() => {
          setShowTeamForm(false);
          setTeamForm(defaultTeamForm);
        }}
        onSubmit={() => void submitTeam()}
      />

      <SelectionModal
        open={Boolean(editingAgentSkills)}
        title={
          editingAgentSkills
            ? `${editingAgentSkills.name} · ${t.manage("skillWhitelist")}`
            : t.manage("skillWhitelist")
        }
        subtitle={t.manage("configureSkills")}
        items={installedSkills.map((skill) => ({
          id: skill.id,
          name: settings.language === "zh" ? skill.displayName || skill.name : skill.name,
          description: skill.description,
        }))}
        selectedIds={selectedSkillIds}
        emptyLabel={t.manage("noSkillsInstalled")}
        cancelLabel={t.manage("cancel")}
        confirmLabel={t.manage("saveSkills")}
        onToggle={toggleSelectedSkillId}
        onClose={() => {
          setEditingAgentSkills(null);
          setSelectedSkillIds([]);
        }}
        onSubmit={() => void submitAgentSkills()}
      />

      <SelectionModal
        open={Boolean(editingAgentMcps)}
        title={
          editingAgentMcps
            ? `${editingAgentMcps.name} · ${t.manage("mcpWhitelist")}`
            : t.manage("mcpWhitelist")
        }
        subtitle={t.manage("configureMcps")}
        items={connectedMcps.map((server) => ({
          id: server.id,
          name: server.name,
          description: server.description,
        }))}
        selectedIds={selectedMcpIds}
        emptyLabel={t.manage("noMcpsConnected")}
        cancelLabel={t.manage("cancel")}
        confirmLabel={t.manage("saveMcps")}
        onToggle={toggleSelectedId}
        onClose={() => {
          setEditingAgentMcps(null);
          setSelectedMcpIds([]);
        }}
        onSubmit={() => void submitAgentMcps()}
      />

      <SelectionModal
        open={Boolean(editingTeamMcps)}
        title={
          editingTeamMcps
            ? `${editingTeamMcps.name} · ${t.manage("mcpWhitelist")}`
            : t.manage("mcpWhitelist")
        }
        subtitle={t.manage("configureMcps")}
        items={connectedMcps.map((server) => ({
          id: server.id,
          name: server.name,
          description: server.description,
        }))}
        selectedIds={selectedMcpIds}
        emptyLabel={t.manage("noMcpsConnected")}
        cancelLabel={t.manage("cancel")}
        confirmLabel={t.manage("saveMcps")}
        onToggle={toggleSelectedId}
        onClose={() => {
          setEditingTeamMcps(null);
          setSelectedMcpIds([]);
        }}
        onSubmit={() => void submitTeamMcps()}
      />
    </div>
  );
}
