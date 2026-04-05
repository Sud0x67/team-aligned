import { useMemo, useState } from "react";
import { ChevronRight, FolderOpen } from "lucide-react";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";
import { Badge } from "../components/pages/badge";
import { EmptyState } from "../components/pages/empty-state";
import { PageShell } from "../components/pages/page-shell";
import { SectionCard } from "../components/pages/section-card";

type ActiveTab = "agents" | "teams";

const defaultAgentForm = {
  name: "",
  role: "",
  description: "",
  capabilities: "",
  workspacePath: "",
};

const defaultTeamForm = {
  name: "",
  description: "",
  objective: "",
  memberIds: [] as string[],
  workspacePath: "",
};

export function ManagePage() {
  const { agents, teams, createAgent, createTeam, openWorkspace, settings, stats } =
    useAppStore();
  const t = createTranslator(settings.language);
  const [tab, setTab] = useState<ActiveTab>("agents");
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [agentForm, setAgentForm] = useState(defaultAgentForm);
  const [teamForm, setTeamForm] = useState(defaultTeamForm);

  const agentStatusLabel: Record<string, string> = {
    online: t.manage("active"),
    busy: t.dashboard("busy"),
    offline: t.dashboard("offline"),
  };

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")),
    [agents],
  );
  const sortedTeams = useMemo(
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
    });
    setAgentForm(defaultAgentForm);
    setShowAgentForm(false);
    setTab("agents");
  };

  const submitTeam = async () => {
    if (!teamForm.name.trim() || teamForm.memberIds.length === 0) return;
    await createTeam({
      name: teamForm.name.trim(),
      description: teamForm.description.trim() || t.chat("noDescriptionYet"),
      objective: teamForm.objective.trim() || t.chat("objectiveNotSet"),
      memberIds: teamForm.memberIds,
      workspacePath: teamForm.workspacePath.trim() || undefined,
    });
    setTeamForm(defaultTeamForm);
    setShowTeamForm(false);
    setTab("teams");
  };

  return (
    <PageShell title={t.manage("title")} description={t.manage("description")}>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-4">
          <SectionCard title={t.manage("resourceOverview")} subtitle={t.manage("resourceOverviewDesc")}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[22px] bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t.manage("agents")}
                </p>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{stats.totalAgents}</p>
              </div>
              <div className="rounded-[22px] bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t.manage("teams")}
                </p>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{stats.totalTeams}</p>
              </div>
              <div className="rounded-[22px] bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t.manage("active")}
                </p>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{stats.activeAgents}</p>
              </div>
              <div className="rounded-[22px] bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t.manage("running")}
                </p>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{stats.runningRuns}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title={t.manage("manageContent")}
            subtitle={t.manage("manageContentDesc")}
            actions={
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                <button
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    tab === "agents" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                  }`}
                  onClick={() => setTab("agents")}
                >
                  {t.manage("agents")}
                </button>
                <button
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    tab === "teams" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                  }`}
                  onClick={() => setTab("teams")}
                >
                  {t.manage("teams")}
                </button>
              </div>
            }
          >
            {tab === "agents" ? (
              sortedAgents.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {sortedAgents.map((agent) => (
                    <article
                      key={agent.id}
                      className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-slate-950">{agent.name}</h3>
                          <p className="mt-1 text-sm text-slate-500">{agent.role}</p>
                        </div>
                        <Badge tone={agent.status === "online" ? "emerald" : agent.status === "busy" ? "amber" : "slate"}>
                          {agentStatusLabel[agent.status]}
                        </Badge>
                      </div>
                      <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">{agent.description}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {agent.capabilities.slice(0, 4).map((item) => (
                          <Badge key={item}>{item}</Badge>
                        ))}
                      </div>
                      <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          <FolderOpen className="h-4 w-4" />
                          <span className="truncate">{agent.workspacePath}</span>
                        </div>
                        <button
                          onClick={() => openWorkspace(agent.workspacePath)}
                          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-950 transition hover:translate-x-0.5"
                        >
                          {t.manage("openWorkspace")}
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={t.manage("emptyAgentTitle")}
                  description={t.manage("emptyAgentDesc")}
                  action={
                    <button
                      onClick={() => setShowAgentForm(true)}
                      className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
                    >
                      {t.manage("emptyAgentAction")}
                    </button>
                  }
                />
              )
            ) : sortedTeams.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sortedTeams.map((team) => (
                  <article
                    key={team.id}
                    className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-slate-950">{team.name}</h3>
                        <p className="mt-1 text-sm text-slate-500">{team.description}</p>
                      </div>
                      <Badge tone="cyan">{team.memberIds.length} {t.common("members")}</Badge>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-600">
                      <span className="font-medium text-slate-900">{t.chat("objectiveLabel")}</span>
                      {team.objective}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {team.memberIds.slice(0, 4).map((memberId) => {
                        const member = agents.find((item) => item.id === memberId);
                        return member ? <Badge key={member.id}>{member.name}</Badge> : null;
                      })}
                    </div>
                    <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                      <div className="flex items-center gap-2 text-sm text-slate-700">
                        <FolderOpen className="h-4 w-4" />
                        <span className="truncate">{team.workspacePath}</span>
                      </div>
                      <button
                        onClick={() => openWorkspace(team.workspacePath)}
                        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-950 transition hover:translate-x-0.5"
                      >
                        {t.manage("openGroupWorkspace")}
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title={t.manage("emptyTeamTitle")}
                description={t.manage("emptyTeamDesc")}
                action={
                  <button
                    onClick={() => setShowTeamForm(true)}
                    className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
                  >
                    {t.manage("emptyTeamAction")}
                  </button>
                }
              />
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title={t.manage("agentSectionTitle")} subtitle={t.manage("agentSectionDesc")}>
            {showAgentForm ? (
              <div className="space-y-3">
                <input
                  value={agentForm.name}
                  onChange={(event) => setAgentForm({ ...agentForm, name: event.target.value })}
                  placeholder={t.manage("name")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-slate-400"
                />
                <input
                  value={agentForm.role}
                  onChange={(event) => setAgentForm({ ...agentForm, role: event.target.value })}
                  placeholder={t.manage("role")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
                <textarea
                  value={agentForm.description}
                  onChange={(event) => setAgentForm({ ...agentForm, description: event.target.value })}
                  placeholder={t.manage("descriptionField")}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
                <textarea
                  value={agentForm.capabilities}
                  onChange={(event) => setAgentForm({ ...agentForm, capabilities: event.target.value })}
                  placeholder={t.manage("capabilities")}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
                <input
                  value={agentForm.workspacePath}
                  onChange={(event) => setAgentForm({ ...agentForm, workspacePath: event.target.value })}
                  placeholder={t.manage("workspacePath")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
                <div className="flex gap-3">
                  <button
                    onClick={submitAgent}
                    className="flex-1 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white"
                  >
                    {t.manage("create")}
                  </button>
                  <button
                    onClick={() => setShowAgentForm(false)}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                  >
                    {t.manage("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <EmptyState
                title={t.manage("clickToCreate")}
                description={t.manage("createAgentHint")}
                action={
                  <button
                    onClick={() => setShowAgentForm(true)}
                    className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
                  >
                    {t.manage("openForm")}
                  </button>
                }
              />
            )}
          </SectionCard>

          <SectionCard title={t.manage("teamSectionTitle")} subtitle={t.manage("teamSectionDesc")}>
            {showTeamForm ? (
              <div className="space-y-3">
                <input
                  value={teamForm.name}
                  onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })}
                  placeholder={t.manage("teamName")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
                <input
                  value={teamForm.objective}
                  onChange={(event) => setTeamForm({ ...teamForm, objective: event.target.value })}
                  placeholder={t.manage("teamObjective")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
                <textarea
                  value={teamForm.description}
                  onChange={(event) => setTeamForm({ ...teamForm, description: event.target.value })}
                  placeholder={t.manage("descriptionField")}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
                <input
                  value={teamForm.workspacePath}
                  onChange={(event) => setTeamForm({ ...teamForm, workspacePath: event.target.value })}
                  placeholder={t.manage("workspacePath")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t.manage("chooseMembers")}
                  </p>
                  <div className="grid gap-2">
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
                          className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${
                            selected
                              ? "border-slate-900 bg-slate-950 text-white"
                              : "border-slate-200 bg-white text-slate-700"
                          }`}
                        >
                          <span>{agent.name}</span>
                          <span className="text-xs">{agent.role}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={submitTeam}
                    className="flex-1 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white"
                  >
                    {t.manage("create")}
                  </button>
                  <button
                    onClick={() => setShowTeamForm(false)}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                  >
                    {t.manage("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <EmptyState
                title={t.manage("clickToCreate")}
                description={t.manage("createTeamHint")}
                action={
                  <button
                    onClick={() => setShowTeamForm(true)}
                    className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
                  >
                    {t.manage("openForm")}
                  </button>
                }
              />
            )}
          </SectionCard>

          <SectionCard title={t.manage("currentSettingsHint")} subtitle={t.manage("currentSettingsHintDesc")}>
            <div className="space-y-2 text-sm text-slate-600">
              <p>
                {t.manage("language")}: {settings.language === "zh" ? t.settings("languageZh") : t.settings("languageEn")}
              </p>
              <p>
                {t.manage("provider")}: {settings.activeProviderId.toUpperCase()}
              </p>
              <p>
                {t.manage("completedToday")}: {stats.completedToday} {settings.language === "zh" ? t.common("items") : ""}
              </p>
            </div>
          </SectionCard>
        </div>
      </div>
    </PageShell>
  );
}
