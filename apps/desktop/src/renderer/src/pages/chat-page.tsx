import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { AttachmentAssetRecord, ConversationRecord } from "@shared";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";
import { AvatarBadge } from "../components/avatar-badge";
import { ChatConversationList } from "../components/chat/chat-conversation-list";
import { ChatComposer } from "../components/chat/chat-composer";
import { ChatConversationSidebar } from "../components/chat/chat-conversation-sidebar";
import { ChatMessageThread } from "../components/chat/chat-message-thread";
import { getLatestActiveRun } from "../components/chat/chat-utils";

export function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    profile,
    conversations,
    messages,
    runs,
    toolInvocations,
    agents,
    teams,
    promptAliases,
    skillCatalog,
    mcpCatalog,
    commandSuggestions,
    sendInput,
    controlRun,
    deleteAgent,
    deleteTeam,
    deleteConversation,
    markConversationRead,
    exportConversationData,
    openWorkspace,
    settings,
  } = useAppStore();
  const t = createTranslator(settings.language);
  const requestedConversationId =
    ((location.state as { conversationId?: string } | null)?.conversationId ?? "").trim();

  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [internalVisible, setInternalVisible] = useState<Record<string, boolean>>({});
  const [conversationInfoExpanded, setConversationInfoExpanded] = useState(false);
  const [conversationExportState, setConversationExportState] = useState<{
    status: "idle" | "exporting" | "success" | "error";
    message: string | null;
  }>({ status: "idle", message: null });

  useEffect(() => {
    if (!requestedConversationId) return;
    if (!conversations.some((item) => item.id === requestedConversationId)) return;
    setActiveConversationId(requestedConversationId);
  }, [requestedConversationId, conversations]);

  useEffect(() => {
    if (!activeConversationId && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversationId, conversations]);

  useEffect(() => {
    if (!activeConversationId || conversations.some((item) => item.id === activeConversationId)) {
      return;
    }
    setActiveConversationId(conversations[0]?.id ?? "");
  }, [activeConversationId, conversations]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter(
      (conversation) =>
        query.length === 0 ||
        conversation.title.toLowerCase().includes(query) ||
        conversation.lastMessage.toLowerCase().includes(query),
    );
  }, [conversations, search]);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const activeMessages = useMemo(
    () => (activeConversation ? messages[activeConversation.id] ?? [] : []),
    [activeConversation, messages],
  );

  useEffect(() => {
    if (!activeConversation || activeConversation.unread <= 0) return;
    void markConversationRead(activeConversation.id);
  }, [activeConversation, markConversationRead]);

  useEffect(() => {
    setConversationExportState({ status: "idle", message: null });
  }, [activeConversationId]);

  const activeRun = activeConversation ? getLatestActiveRun(runs, activeConversation.id) : null;
  const isConversationBusy = Boolean(activeRun);
  const hasStreamingMessage = useMemo(() => {
    if (!activeRun) return false;
    return activeMessages.some(
      (message) =>
        message.visibility === "public" &&
        message.senderKind === "agent" &&
        message.metadata?.streaming === true &&
        (message.runId === activeRun.id || message.createdAt >= activeRun.createdAt),
    );
  }, [activeMessages, activeRun]);
  const latestConversationRun = useMemo(() => {
    if (!activeConversation) return null;
    return [...runs]
      .filter((run) => run.conversationId === activeConversation.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }, [activeConversation, runs]);
  const isTeamConversation = activeConversation?.kind === "team";
  const showInternal = activeConversation ? internalVisible[activeConversation.id] ?? false : false;
  const detailRun = activeRun ?? latestConversationRun;

  const conversationToolInvocations = useMemo(() => {
    if (!activeConversation) return [];
    return toolInvocations.filter(
      (invocation) => invocation.conversationId === activeConversation.id,
    );
  }, [activeConversation, toolInvocations]);

  const pendingSystemMessage = useMemo(() => {
    if (!activeRun) return null;
    if (hasStreamingMessage) return null;

    const runMessages = activeMessages.filter((message) => message.runId === activeRun.id);
    const latestSystem = [...runMessages]
      .filter((message) => message.visibility === "system")
      .sort((left, right) => right.createdAt - left.createdAt)[0];

    if (!latestSystem) {
      return t.chat("thinking");
    }

    const latestVisibleAgent = [...runMessages]
      .filter((message) => message.visibility === "public" && message.senderKind === "agent")
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    const latestStreamingAgent = [...runMessages]
      .filter(
        (message) =>
          message.visibility === "public" &&
          message.senderKind === "agent" &&
          message.metadata?.streaming === true,
      )
      .sort((left, right) => right.createdAt - left.createdAt)[0];

    const isRunActive = !["completed", "failed", "cancelled"].includes(activeRun.status);
    if (!isRunActive) {
      return null;
    }

    if (latestStreamingAgent) {
      return null;
    }

    if (!latestVisibleAgent) {
      return latestSystem.content;
    }

    const latestSystemStage =
      typeof latestSystem.metadata?.stage === "string" ? latestSystem.metadata.stage : null;
    const shouldKeepShowing = latestSystemStage
      ? [
          "handoff",
          "selection",
          "execution",
          "execution_waiting",
          "execution_batch",
          "execution_progress",
          "tool_start",
          "tool_success",
          "tool_error",
        ].includes(latestSystemStage)
      : true;
    if (shouldKeepShowing && latestSystem.createdAt >= latestVisibleAgent.createdAt) {
      return latestSystem.content;
    }

    return null;
  }, [activeMessages, activeRun, hasStreamingMessage, t]);

  const pendingSystemUpdates = useMemo(() => {
    if (!activeRun || activeConversation?.kind !== "team") {
      return [];
    }

    const isRunActive = !["completed", "failed", "cancelled"].includes(activeRun.status);
    if (!isRunActive) {
      return [];
    }

    const updates = activeMessages
      .filter(
        (message) =>
          message.runId === activeRun.id &&
          message.visibility === "system" &&
          message.metadata?.teamUpdate === true,
      )
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((message) => message.content.trim())
      .filter((content) => content.length > 0);

    const deduped: string[] = [];
    for (const content of updates) {
      if (deduped.at(-1) === content) continue;
      deduped.push(content);
    }

    const tail = deduped.slice(-4);
    if (!pendingSystemMessage) {
      return tail;
    }

    const normalizedPending = pendingSystemMessage.trim();
    return tail.filter((item, index) => !(item === normalizedPending && index === tail.length - 1));
  }, [activeConversation?.kind, activeMessages, activeRun, pendingSystemMessage]);

  const conversationTokenUsage = useMemo(() => {
    if (!activeConversation) {
      return { total: 0, tracked: false };
    }

    const runsInConversation = runs.filter((run) => run.conversationId === activeConversation.id);
    const trackedTotal = runsInConversation.reduce((sum, run) => {
      const total =
        typeof run.metadata?.totalTokens === "number"
          ? run.metadata.totalTokens
          : typeof run.metadata?.tokenUsage === "number"
            ? run.metadata.tokenUsage
            : null;
      return sum + (total ?? 0);
    }, 0);

    if (trackedTotal > 0) {
      return { total: trackedTotal, tracked: true };
    }

    const estimatedTotal = activeMessages
      .filter((message) => message.visibility !== "internal")
      .reduce((sum, message) => sum + Math.max(1, Math.ceil(message.content.length / 4)), 0);

    return { total: estimatedTotal, tracked: false };
  }, [activeConversation, activeMessages, runs]);

  const mentionCandidates = useMemo(() => {
    if (!activeConversation) return [];
    if (activeConversation.kind === "agent") return [];

    const team = teams.find((item) => item.id === activeConversation.targetId);
    if (!team) return [];
    return agents
      .filter((agent) => team.memberIds.includes(agent.id))
      .map((agent) => ({ id: agent.id, name: agent.name, role: agent.role }));
  }, [activeConversation, agents, teams]);

  const activeSkillLabel = useMemo(() => {
    const activeSkillId = activeConversation?.meta.activeSkill;
    if (!activeSkillId) return null;
    const skill = skillCatalog.find((item) => item.id === activeSkillId);
    if (!skill) return activeSkillId;
    return settings.language === "zh" ? skill.displayName || skill.name : skill.name;
  }, [activeConversation?.meta.activeSkill, settings.language, skillCatalog]);

  const availableSlashSuggestions = useMemo(() => {
    if (!activeConversation) return commandSuggestions;
    const installedSkills = skillCatalog.filter((skill) => skill.installed);
    const availableSkills =
      activeConversation.kind === "agent"
        ? (() => {
            const agent = agents.find((item) => item.id === activeConversation.targetId);
            return agent
              ? installedSkills.filter((skill) => agent.skillWhitelist.includes(skill.id))
              : installedSkills;
          })()
        : installedSkills;

    const skillSuggestions = availableSkills.map((skill) => ({
      name: `/${skill.slug}`,
      description:
        settings.language === "zh"
          ? `临时使用 Skill：${skill.displayName || skill.name}`
          : `Use skill once: ${skill.name}`,
      kind: "skill" as const,
    }));
    const promptSuggestions = promptAliases
      .filter((prompt) => prompt.enabled)
      .map((prompt) => ({
        name: `/${prompt.alias}`,
        description: prompt.description || prompt.name,
        kind: "prompt" as const,
      }));

    return [...commandSuggestions, ...skillSuggestions, ...promptSuggestions];
  }, [activeConversation, agents, commandSuggestions, promptAliases, settings.language, skillCatalog]);

  const pinnedMcpLabel = useMemo(() => {
    const pinnedMcpId = activeConversation?.meta.pinnedMcp;
    if (!pinnedMcpId) return null;
    return mcpCatalog.find((item) => item.id === pinnedMcpId)?.name ?? pinnedMcpId;
  }, [activeConversation?.meta.pinnedMcp, mcpCatalog]);

  const activeTarget = useMemo(() => {
    if (!activeConversation) return null;
    return activeConversation.kind === "agent"
      ? agents.find((agent) => agent.id === activeConversation.targetId) ?? null
      : teams.find((team) => team.id === activeConversation.targetId) ?? null;
  }, [activeConversation, agents, teams]);

  const activeWorkspacePath = activeTarget?.workspacePath ?? null;

  const pendingActor = useMemo(() => {
    if (!activeConversation) return null;

    if (activeConversation.kind === "team" && activeRun) {
      const runMessages = activeMessages.filter((message) => message.runId === activeRun.id);
      const latestTeamUpdate = [...runMessages]
        .filter((message) => message.visibility === "system" && message.metadata?.teamUpdate === true)
        .sort((left, right) => right.createdAt - left.createdAt)[0];
      const updateActorId =
        typeof latestTeamUpdate?.metadata?.actorId === "string" ? latestTeamUpdate.metadata.actorId : null;
      if (updateActorId) {
        const updateActor = agents.find((agent) => agent.id === updateActorId);
        if (updateActor) {
          return {
            name: updateActor.name,
            avatarPath: updateActor.avatarPath,
            avatar: updateActor.avatar,
            avatarColor: updateActor.avatarColor,
          };
        }
      }

      const latestUserMessage = [...activeMessages]
        .reverse()
        .find((message) => message.senderKind === "user" && message.visibility === "public");
      const firstMentionedAgentId = latestUserMessage?.mentions.find((mention) => mention !== "user");
      if (firstMentionedAgentId) {
        const mentionedAgent = agents.find((agent) => agent.id === firstMentionedAgentId);
        if (mentionedAgent) {
          return {
            name: mentionedAgent.name,
            avatarPath: mentionedAgent.avatarPath,
            avatar: mentionedAgent.avatar,
            avatarColor: mentionedAgent.avatarColor,
          };
        }
      }
    }

    if (activeTarget) {
      return {
        name: activeTarget.name,
        avatarPath: activeTarget.avatarPath,
        avatar: activeTarget.avatar,
        avatarColor: activeTarget.avatarColor,
      };
    }
    return null;
  }, [activeConversation, activeMessages, activeRun, activeTarget, agents]);

  const handleSend = async (payload: { input: string; attachments: AttachmentAssetRecord[] }) => {
    if (!activeConversation) return;
    await sendInput({
      conversationId: activeConversation.id,
      input: payload.input,
      attachments: payload.attachments,
    });
  };

  const handleSelectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    const conversation = conversations.find((item) => item.id === conversationId);
    if (conversation && conversation.unread > 0) {
      void markConversationRead(conversationId);
    }
  };

  const getNextConversationId = (conversationId: string) =>
    conversations.find((conversation) => conversation.id !== conversationId)?.id ?? "";

  const handleEditConversationTarget = (conversation: ConversationRecord) => {
    navigate("/manage", {
      state: {
        editKind: conversation.kind,
        targetId: conversation.targetId,
      },
    });
  };

  const handleDeleteConversation = async (conversation: ConversationRecord) => {
    const confirmed = window.confirm(
      t.chat("deleteConversationConfirm").replace("{{title}}", conversation.title),
    );
    if (!confirmed) return;

    try {
      await deleteConversation(conversation.id);
      if (activeConversationId === conversation.id) {
        setActiveConversationId(getNextConversationId(conversation.id));
      }
    } catch (error) {
      window.alert(
        t.chat("deleteFailedPrefix") +
          (error instanceof Error ? error.message : t.chat("deleteFailedFallback")),
      );
    }
  };

  const handleDeleteConversationTarget = async (conversation: ConversationRecord) => {
    const confirmMessage =
      conversation.kind === "agent"
        ? t.chat("deleteAgentFromChatConfirm")
        : t.chat("deleteTeamFromChatConfirm");
    const confirmed = window.confirm(confirmMessage.replace("{{title}}", conversation.title));
    if (!confirmed) return;

    try {
      if (conversation.kind === "agent") {
        await deleteAgent(conversation.targetId);
      } else {
        await deleteTeam(conversation.targetId);
      }
      if (activeConversationId === conversation.id) {
        setActiveConversationId(getNextConversationId(conversation.id));
      }
    } catch (error) {
      window.alert(
        t.chat("deleteFailedPrefix") +
          (error instanceof Error ? error.message : t.chat("deleteFailedFallback")),
      );
    }
  };

  const handleCancel = async () => {
    if (!activeConversation) return;
    await controlRun({ conversationId: activeConversation.id, action: "cancel" });
  };

  const handleExportConversation = async () => {
    if (!activeConversation || conversationExportState.status === "exporting") return;
    setConversationExportState({ status: "exporting", message: null });
    try {
      const result = await exportConversationData(activeConversation.id);
      setConversationExportState({
        status: "success",
        message: `${t.chat("conversationExported")} ${result.filePath}`,
      });
    } catch (error) {
      setConversationExportState({
        status: "error",
        message:
          error instanceof Error && error.message.trim().length > 0
            ? `${t.chat("conversationExportFailed")} ${error.message}`
            : t.chat("conversationExportFailed"),
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-[var(--background)]">
      <aside className="w-[300px] shrink-0 border-r border-[var(--border)] bg-[var(--card)]">
        <div className="h-full min-h-0">
          <ChatConversationList
            conversations={filteredConversations}
            activeConversationId={activeConversationId}
            onSelectConversation={handleSelectConversation}
            onEditTarget={handleEditConversationTarget}
            onDeleteConversation={(conversation) => void handleDeleteConversation(conversation)}
            onDeleteTarget={(conversation) => void handleDeleteConversationTarget(conversation)}
            search={search}
            onSearchChange={setSearch}
          />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {activeConversation ? (
          <>
            <div className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-5">
              <div className="flex min-w-0 items-center gap-3">
                {activeTarget ? (
                  <AvatarBadge
                    src={activeTarget.avatarPath}
                    fallback={activeTarget.avatar}
                    alt={activeTarget.name}
                    className="h-10 w-10 shrink-0 rounded-xl"
                    style={
                      activeConversation.kind === "agent"
                        ? { backgroundColor: activeTarget.avatarColor }
                        : {
                            backgroundColor: `${activeTarget.avatarColor}20`,
                            color: activeTarget.avatarColor,
                          }
                    }
                    textClassName={
                      activeConversation.kind === "agent"
                        ? "text-sm font-semibold text-white"
                        : "text-sm font-semibold"
                    }
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                    {activeConversation.title}
                  </p>
                  {activeSkillLabel || pinnedMcpLabel ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {activeSkillLabel ? (
                        <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--primary)]">
                          {t.chat("currentSkillLabel")} {activeSkillLabel}
                        </span>
                      ) : null}
                      {pinnedMcpLabel ? (
                        <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                          {t.chat("currentMcpLabel")} {pinnedMcpLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isTeamConversation ? (
                  <button
                    onClick={() =>
                      setInternalVisible((current) => ({
                        ...current,
                        [activeConversation.id]: !showInternal,
                      }))
                    }
                    className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                      showInternal
                        ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    }`}
                  >
                    {showInternal ? t.chat("teamContextVisible") : t.chat("teamContext")}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatMessageThread
                conversationId={activeConversation.id}
                messages={activeMessages}
                run={activeRun}
                showInternalMessages={showInternal}
                pendingSystemMessage={pendingSystemMessage}
                pendingSystemUpdates={pendingSystemUpdates}
                pendingActor={pendingActor}
                showMentions={activeConversation.kind === "team"}
                profile={profile}
                agents={agents}
                teams={teams}
              />
            </div>

            <div className="border-t border-[var(--border)] bg-[var(--card)] px-5 pb-4 pt-3">
              <ChatComposer
                conversationId={activeConversation.id}
                onSend={handleSend}
                mentionCandidates={mentionCandidates}
                slashSuggestions={availableSlashSuggestions}
                busy={isConversationBusy}
                onCancel={handleCancel}
              />
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center px-6 py-10 text-center text-[var(--muted-foreground)]">
            <div>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)]">
                <Sparkles className="h-8 w-8" />
              </div>
              <h3 className="mt-4 text-xl font-semibold text-[var(--foreground)]">
                {t.chat("emptyTitle")}
              </h3>
              <p className="mt-2 text-sm leading-7">{t.chat("emptyDescription")}</p>
            </div>
          </div>
        )}
      </section>

      {activeConversation ? (
        <ChatConversationSidebar
          expanded={conversationInfoExpanded}
          onExpandedChange={setConversationInfoExpanded}
          conversationKind={activeConversation.kind}
          tokenUsage={conversationTokenUsage}
          workspacePath={activeWorkspacePath}
          activeSkillLabel={activeSkillLabel}
          pinnedMcpLabel={pinnedMcpLabel}
          run={detailRun}
          toolInvocations={conversationToolInvocations}
          onOpenWorkspace={(workspacePath) => void openWorkspace(workspacePath)}
          onExportConversation={handleExportConversation}
          exportState={conversationExportState}
        />
      ) : null}
    </div>
  );
}
