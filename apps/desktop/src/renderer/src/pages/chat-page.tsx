import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  isTeamAlignedAssistantAgentId,
  type AttachmentAssetRecord,
  type ConversationRecord,
  type MessageRecord,
} from "@shared";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";
import { AvatarBadge } from "../components/avatar-badge";
import { ChatConversationList } from "../components/chat/chat-conversation-list";
import { ChatComposer } from "../components/chat/chat-composer";
import { ChatConversationSidebar } from "../components/chat/chat-conversation-sidebar";
import { ChatMessageThread } from "../components/chat/chat-message-thread";
import { getLatestActiveRun } from "../components/chat/chat-utils";
import { ResizeHandle } from "../components/layout/resize-handle";

const conversationPaneWidthStorageKey = "chat.layout.conversationPaneWidth";
const composerPaneHeightStorageKey = "chat.layout.composerPaneHeight.v2";
const conversationSidebarWidthStorageKey = "chat.layout.conversationSidebarWidth";
const composerPaneMinHeight = 144;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readStoredNumber(key: string, fallback: number, min: number, max: number) {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

export function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    profile,
    conversations,
    messages,
    runs,
    agents,
    teams,
    promptAliases,
    skillCatalog,
    mcpCatalog,
    commandSuggestions,
    loadConversationData,
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
  const [conversationPaneWidth, setConversationPaneWidth] = useState(() =>
    readStoredNumber(conversationPaneWidthStorageKey, 300, 200, 520),
  );
  const [composerPaneHeight, setComposerPaneHeight] = useState(() =>
    readStoredNumber(composerPaneHeightStorageKey, 196, composerPaneMinHeight, 520),
  );
  const [conversationSidebarWidth, setConversationSidebarWidth] = useState(() =>
    readStoredNumber(conversationSidebarWidthStorageKey, 304, 256, 520),
  );
  const [conversationExportState, setConversationExportState] = useState<{
    status: "idle" | "exporting" | "success" | "error";
    message: string | null;
  }>({ status: "idle", message: null });
  const [retryingLastMessage, setRetryingLastMessage] = useState(false);
  const [messageAndComposerPaneHeight, setMessageAndComposerPaneHeight] = useState(0);

  const messageAndComposerPaneRef = useRef<HTMLDivElement | null>(null);
  const conversationWidthResizeStartRef = useRef<number | null>(null);
  const composerHeightResizeStartRef = useRef<number | null>(null);
  const conversationSidebarWidthResizeStartRef = useRef<number | null>(null);

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
      (conversation) => {
        if (query.length === 0) return true;
        const conversationMessages = messages[conversation.id] ?? [];
        return (
          conversation.title.toLowerCase().includes(query) ||
          conversation.lastMessage.toLowerCase().includes(query) ||
          conversationMessages.some(
            (message) =>
              message.visibility === "public" &&
              `${message.senderName} ${message.content}`.toLowerCase().includes(query),
          )
        );
      },
    );
  }, [conversations, messages, search]);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const activeMessages = useMemo(
    () => (activeConversation ? messages[activeConversation.id] ?? [] : []),
    [activeConversation, messages],
  );
  const activeConversationMessagesLoaded = activeConversation
    ? Object.prototype.hasOwnProperty.call(messages, activeConversation.id)
    : false;

  useEffect(() => {
    if (!activeConversation || activeConversationMessagesLoaded) return;
    void loadConversationData(activeConversation.id);
  }, [activeConversation, activeConversationMessagesLoaded, loadConversationData]);

  useEffect(() => {
    if (!activeConversation || activeConversation.unread <= 0) return;
    void markConversationRead(activeConversation.id);
  }, [activeConversation, markConversationRead]);

  useEffect(() => {
    window.localStorage.setItem(conversationPaneWidthStorageKey, String(conversationPaneWidth));
  }, [conversationPaneWidth]);

  useEffect(() => {
    window.localStorage.setItem(composerPaneHeightStorageKey, String(composerPaneHeight));
  }, [composerPaneHeight]);

  useEffect(() => {
    window.localStorage.setItem(
      conversationSidebarWidthStorageKey,
      String(conversationSidebarWidth),
    );
  }, [conversationSidebarWidth]);

  useEffect(() => {
    setConversationExportState({ status: "idle", message: null });
    setRetryingLastMessage(false);
  }, [activeConversationId]);

  useEffect(() => {
    const pane = messageAndComposerPaneRef.current;
    if (!pane || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setMessageAndComposerPaneHeight(entry.contentRect.height);
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [activeConversationId]);

  const composerPaneMaxHeight = useMemo(() => {
    if (messageAndComposerPaneHeight <= 0) return 560;
    return Math.max(composerPaneMinHeight, Math.round(messageAndComposerPaneHeight * 0.62));
  }, [messageAndComposerPaneHeight]);

  const effectiveComposerPaneHeight = useMemo(
    () => clamp(composerPaneHeight, composerPaneMinHeight, composerPaneMaxHeight),
    [composerPaneHeight, composerPaneMaxHeight],
  );

  useEffect(() => {
    if (effectiveComposerPaneHeight === composerPaneHeight) return;
    setComposerPaneHeight(effectiveComposerPaneHeight);
  }, [composerPaneHeight, effectiveComposerPaneHeight]);

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
  const isTeamConversation = activeConversation?.kind === "team";
  const showInternal = activeConversation ? internalVisible[activeConversation.id] ?? false : false;

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

  const localizedCommandSuggestions = useMemo(
    () =>
      commandSuggestions.map((item) => ({
        ...item,
        description:
          item.name === "/skills"
            ? t.command("/skills")
            : item.name === "/mcp"
              ? t.command("/mcp")
              : t.command("/clear"),
      })),
    [commandSuggestions, t],
  );

  const availableSlashSuggestions = useMemo(() => {
    if (!activeConversation) return localizedCommandSuggestions;
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

    return [...localizedCommandSuggestions, ...skillSuggestions, ...promptSuggestions];
  }, [activeConversation, agents, localizedCommandSuggestions, promptAliases, settings.language, skillCatalog]);

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

  const retryableUserMessage = useMemo(() => {
    if (!activeConversation || activeConversation.kind !== "agent") return null;
    return (
      [...activeMessages]
        .reverse()
        .find(
          (message) =>
            message.senderKind === "user" &&
            message.visibility === "public" &&
            message.messageType === "user",
        ) ?? null
    );
  }, [activeConversation, activeMessages]);

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
    if (conversation.kind === "agent" && isTeamAlignedAssistantAgentId(conversation.targetId)) {
      window.alert(t.chat("assistantBuiltinCannotEdit"));
      return;
    }
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
    if (conversation.kind === "agent" && isTeamAlignedAssistantAgentId(conversation.targetId)) {
      window.alert(t.chat("assistantBuiltinCannotDelete"));
      return;
    }
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

  const getMessageAttachments = (message: MessageRecord | null): AttachmentAssetRecord[] => {
    const attachments = message?.metadata?.attachments;
    return Array.isArray(attachments) ? (attachments as AttachmentAssetRecord[]) : [];
  };

  const getRetryInput = (message: MessageRecord) => {
    const rawInput = message.metadata?.rawInput;
    if (typeof rawInput === "string") {
      return rawInput;
    }

    const attachments = getMessageAttachments(message);
    const content = message.content.trim();
    if (
      attachments.length > 0 &&
      (content.startsWith("已上传附件：") || content.startsWith("Uploaded attachments:"))
    ) {
      return "";
    }
    return message.content;
  };

  const handleRetryLastMessage = async () => {
    if (!activeConversation || isConversationBusy || !retryableUserMessage || retryingLastMessage) {
      return;
    }

    setRetryingLastMessage(true);
    try {
      await sendInput({
        conversationId: activeConversation.id,
        input: getRetryInput(retryableUserMessage),
        attachments: getMessageAttachments(retryableUserMessage),
      });
    } catch (error) {
      window.alert(
        error instanceof Error && error.message.trim().length > 0
          ? `${t.chat("retryLastMessageFailed")} ${error.message}`
          : t.chat("retryLastMessageFailed"),
      );
    } finally {
      setRetryingLastMessage(false);
    }
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

  const handleConversationPaneResize = (delta: number) => {
    if (conversationWidthResizeStartRef.current === null) return;
    setConversationPaneWidth(clamp(conversationWidthResizeStartRef.current + delta, 200, 520));
  };

  const handleConversationSidebarResize = (delta: number) => {
    if (conversationSidebarWidthResizeStartRef.current === null) return;
    setConversationSidebarWidth(
      clamp(conversationSidebarWidthResizeStartRef.current - delta, 256, 520),
    );
  };

  const handleComposerPaneResize = (delta: number) => {
    if (composerHeightResizeStartRef.current === null) return;
    setComposerPaneHeight(
      clamp(
        composerHeightResizeStartRef.current - delta,
        composerPaneMinHeight,
        composerPaneMaxHeight,
      ),
    );
  };

  return (
    <div className="flex h-full min-h-0 bg-[var(--background)]">
      <aside
        className="shrink-0 border-r border-[var(--border)] bg-[var(--card)]"
        style={{ width: `${conversationPaneWidth}px` }}
      >
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

      <ResizeHandle
        axis="x"
        className="hidden shrink-0 bg-[var(--card)] lg:block"
        onResizeStart={() => {
          conversationWidthResizeStartRef.current = conversationPaneWidth;
        }}
        onResize={handleConversationPaneResize}
        onResizeEnd={() => {
          conversationWidthResizeStartRef.current = null;
        }}
        ariaLabel={settings.language === "zh" ? "拖动调整会话列表宽度" : "Resize conversation list"}
      />

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

            <div
              ref={messageAndComposerPaneRef}
              className="min-h-0 flex-1 overflow-hidden"
              style={{
                display: "grid",
                gridTemplateRows: `minmax(0,1fr) 8px ${effectiveComposerPaneHeight}px`,
              }}
            >
              <div className="min-h-0 overflow-hidden">
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

              <ResizeHandle
                axis="y"
                className="shrink-0 bg-[var(--card)]"
                onResizeStart={() => {
                  composerHeightResizeStartRef.current = effectiveComposerPaneHeight;
                }}
                onResize={handleComposerPaneResize}
                onResizeEnd={() => {
                  composerHeightResizeStartRef.current = null;
                }}
                ariaLabel={settings.language === "zh" ? "拖动调整输入区域高度" : "Resize composer"}
              />

              <div className="min-h-0 overflow-hidden border-t border-[var(--border)] bg-[var(--card)] px-5 pb-4 pt-3">
                <ChatComposer
                  conversationId={activeConversation.id}
                  onSend={handleSend}
                  mentionCandidates={mentionCandidates}
                  slashSuggestions={availableSlashSuggestions}
                  busy={isConversationBusy}
                  onCancel={handleCancel}
                  className="h-full"
                />
              </div>
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

      {activeConversation && conversationInfoExpanded ? (
        <ResizeHandle
          axis="x"
          className="hidden shrink-0 bg-[var(--card)] lg:block"
          onResizeStart={() => {
            conversationSidebarWidthResizeStartRef.current = conversationSidebarWidth;
          }}
          onResize={handleConversationSidebarResize}
          onResizeEnd={() => {
            conversationSidebarWidthResizeStartRef.current = null;
          }}
          ariaLabel={settings.language === "zh" ? "拖动调整信息栏宽度" : "Resize conversation info"}
        />
      ) : null}

      {activeConversation ? (
        <ChatConversationSidebar
          expanded={conversationInfoExpanded}
          expandedWidth={conversationSidebarWidth}
          onExpandedChange={setConversationInfoExpanded}
          conversationKind={activeConversation.kind}
          tokenUsage={conversationTokenUsage}
          workspacePath={activeWorkspacePath}
          activeSkillLabel={activeSkillLabel}
          pinnedMcpLabel={pinnedMcpLabel}
          onOpenWorkspace={(workspacePath) => void openWorkspace(workspacePath)}
          onExportConversation={handleExportConversation}
          exportState={conversationExportState}
          canRetryLastMessage={Boolean(retryableUserMessage) && !isConversationBusy}
          retryingLastMessage={retryingLastMessage}
          onRetryLastMessage={handleRetryLastMessage}
        />
      ) : null}
    </div>
  );
}
