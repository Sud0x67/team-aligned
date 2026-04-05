import { Activity, Bot, FolderOpen, MessageSquareText, Users } from "lucide-react";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";
import { Badge } from "../components/pages/badge";
import { PageShell } from "../components/pages/page-shell";
import { SectionCard } from "../components/pages/section-card";
import { StatCard } from "../components/pages/stat-card";

export function DashboardPage() {
  const { stats, agents, teams, conversations, runs, notifications, settings } = useAppStore();
  const t = createTranslator(settings.language);

  return (
    <PageShell title={t.dashboard("title")} description={t.dashboard("description")}>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t.dashboard("activeAgents")} value={String(stats.activeAgents)} hint={`/ ${stats.totalAgents}`} />
            <StatCard label={t.dashboard("teams")} value={String(stats.totalTeams)} />
            <StatCard label={t.dashboard("running")} value={String(stats.runningRuns)} />
            <StatCard label={t.dashboard("completedToday")} value={String(stats.completedToday)} />
          </div>

          <SectionCard title={t.dashboard("recentStatus")} subtitle={t.dashboard("recentStatusDesc")}>
            <div className="space-y-3">
              {notifications.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-start gap-3 rounded-[22px] bg-slate-50 p-4">
                  <div className="mt-0.5 rounded-2xl bg-white p-2 shadow-sm">
                    <Activity className="h-4 w-4 text-slate-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-950">{item.title}</p>
                      <Badge tone={item.read ? "slate" : "rose"}>{item.read ? t.dashboard("read") : t.dashboard("unread")}</Badge>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={t.dashboard("conversationOverview")} subtitle={t.dashboard("conversationOverviewDesc")}>
            <div className="grid gap-4 md:grid-cols-2">
              {conversations.map((conversation) => (
                <article key={conversation.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">{conversation.title}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {conversation.kind === "agent" ? t.dashboard("conversationKindAgent") : t.dashboard("conversationKindTeam")}
                      </p>
                    </div>
                    <Badge tone={conversation.unread > 0 ? "amber" : "slate"}>
                      {conversation.unread} {t.dashboard("unread")}
                    </Badge>
                  </div>
                  <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600">{conversation.lastMessage}</p>
                </article>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title={t.dashboard("resourceSummary")} subtitle={t.dashboard("resourceSummaryDesc")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[22px] bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <Bot className="h-4 w-4" />
                  <span className="text-sm font-medium">{t.dashboard("bot")}</span>
                </div>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{agents.length}</p>
              </div>
              <div className="rounded-[22px] bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <Users className="h-4 w-4" />
                  <span className="text-sm font-medium">{t.dashboard("team")}</span>
                </div>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{teams.length}</p>
              </div>
              <div className="rounded-[22px] bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <MessageSquareText className="h-4 w-4" />
                  <span className="text-sm font-medium">{t.dashboard("conversations")}</span>
                </div>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{conversations.length}</p>
              </div>
              <div className="rounded-[22px] bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <FolderOpen className="h-4 w-4" />
                  <span className="text-sm font-medium">{t.dashboard("runs")}</span>
                </div>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{runs.length}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title={t.dashboard("agentStatus")} subtitle={t.dashboard("agentStatusDesc")}>
            <div className="space-y-3">
              {agents.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between rounded-[22px] bg-slate-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{agent.name}</p>
                    <p className="text-sm text-slate-500">{agent.role}</p>
                  </div>
                  <Badge tone={agent.status === "online" ? "emerald" : agent.status === "busy" ? "amber" : "slate"}>
                    {agent.status === "online" ? t.dashboard("online") : agent.status === "busy" ? t.dashboard("busy") : t.dashboard("offline")}
                  </Badge>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </PageShell>
  );
}
