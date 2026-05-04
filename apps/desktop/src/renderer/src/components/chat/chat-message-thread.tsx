import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Bot,
  CheckCircle2,
  Copy,
  ImagePlus,
  Paperclip,
  PencilLine,
  Redo2,
  ShieldAlert,
  StopCircle,
  X,
} from "lucide-react";
import type {
  AgentRecord,
  AttachmentAssetRecord,
  MessageRecord,
  RunRecord,
  TeamRecord,
  ToolApprovalDecision,
  UserProfile,
} from "@shared";
import { createTranslator } from "../../i18n";
import { resolveAssetSrc } from "../../lib/asset-src";
import { useAppStore } from "../../store/use-app-store";
import { AvatarBadge } from "../avatar-badge";
import { ChatMarkdownContent } from "./chat-markdown";
import { getConversationVisibleMessages } from "./chat-utils";

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function messageTone(message: MessageRecord) {
  if (message.visibility === "internal") {
    return "border-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] text-[var(--foreground)]";
  }
  if (message.visibility === "system") {
    return "border-[color-mix(in_srgb,var(--primary)_18%,transparent)] bg-[var(--accent)] text-[var(--foreground)]";
  }
  return "border-transparent bg-[var(--muted)] text-[var(--foreground)]";
}

function getAttachments(message: MessageRecord): AttachmentAssetRecord[] {
  const attachments = message.metadata?.attachments;
  return Array.isArray(attachments) ? (attachments as AttachmentAssetRecord[]) : [];
}

function isImageAttachment(attachment: AttachmentAssetRecord) {
  return attachment.mimeType.startsWith("image/");
}

function buildAvatarProps(
  message: MessageRecord,
  input: {
    language: "zh" | "en";
    profile: UserProfile;
    agentMap: Map<string, AgentRecord>;
    teamMap: Map<string, TeamRecord>;
  },
) {
  if (message.senderKind === "user") {
    const youLabel = input.language === "en" ? "You" : "你";
    return {
      src: input.profile.avatarPath,
      fallback: input.profile.name.slice(0, 1) || youLabel,
      alt: input.profile.name || youLabel,
      style: { backgroundColor: "var(--primary)" },
      textClassName: "text-xs font-semibold text-white",
    };
  }

  if (message.senderKind === "agent") {
    const agent = input.agentMap.get(message.senderId);
    if (agent) {
      return {
        src: agent.avatarPath,
        fallback: agent.avatar,
        alt: agent.name,
        style: { backgroundColor: agent.avatarColor },
        textClassName: "text-xs font-semibold text-white",
      };
    }

    const team = input.teamMap.get(message.senderId);
    if (team) {
      return {
        src: team.avatarPath,
        fallback: team.avatar,
        alt: team.name,
        style: { backgroundColor: `${team.avatarColor}20`, color: team.avatarColor },
        textClassName: "text-xs font-semibold",
      };
    }

    return {
      src: null,
      fallback: message.senderName.slice(0, 1) || "A",
      alt: message.senderName,
      style: { backgroundColor: "var(--primary)" },
      textClassName: "text-xs font-semibold text-white",
    };
  }

  return null;
}

function resolveMentionLabel(
  mention: string,
  input: {
    language: "zh" | "en";
    profile: UserProfile;
    agentMap: Map<string, AgentRecord>;
    teamMap: Map<string, TeamRecord>;
  },
) {
  if (mention === "user") {
    return input.profile.name || (input.language === "en" ? "You" : "你");
  }

  const agent = input.agentMap.get(mention);
  if (agent) {
    return agent.name;
  }

  const team = input.teamMap.get(mention);
  if (team) {
    return team.name;
  }

  return mention.replace(/^agent-/, "");
}

function isMessageSelectable(message: MessageRecord) {
  return message.visibility === "public";
}

function isToolApprovalMessage(message: MessageRecord) {
  return message.metadata?.cardType === "tool_approval";
}

function getOneLineArgsPreview(message: MessageRecord) {
  const argsPreview = message.metadata?.argsPreview;
  if (typeof argsPreview !== "string" || argsPreview.trim() === "{}") {
    return null;
  }
  return argsPreview.replace(/\s+/g, " ").trim();
}

function ToolApprovalDock({
  messages,
  language,
  onResolve,
}: {
  messages: MessageRecord[];
  language: "zh" | "en";
  onResolve: (approvalId: string, decision: ToolApprovalDecision) => void;
}) {
  const t = createTranslator(language);
  const pendingApprovals = messages
    .filter(
      (message) => isToolApprovalMessage(message) && message.metadata?.approvalStatus === "pending",
    )
    .sort((left, right) => left.createdAt - right.createdAt);
  const approval = pendingApprovals.at(-1);

  if (!approval) {
    return null;
  }

  const toolName = [
    String(approval.metadata?.serverName ?? "").trim(),
    String(approval.metadata?.toolName ?? "").trim(),
  ]
    .filter(Boolean)
    .join(".");
  const argsPreview = getOneLineArgsPreview(approval);
  const hiddenCount = Math.max(0, pendingApprovals.length - 1);

  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_94%,var(--background)_6%)] px-5 py-2">
      <div className="flex min-h-12 items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--primary)_24%,transparent)] bg-[color-mix(in_srgb,var(--primary)_7%,var(--card)_93%)] px-3 py-2 shadow-sm">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--primary)]">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="shrink-0 text-sm font-semibold text-[var(--foreground)]">
              {t.chat("toolApprovalTitle")}
            </p>
            {toolName ? (
              <span className="truncate rounded-full bg-[var(--card)] px-2 py-0.5 text-xs font-medium text-[var(--muted-foreground)]">
                {toolName}
              </span>
            ) : null}
            <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
              {String(approval.metadata?.operation ?? "")} · {String(approval.metadata?.riskLevel ?? "")}
            </span>
            {hiddenCount > 0 ? (
              <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                {language === "en" ? `+${hiddenCount} more` : `另有 ${hiddenCount} 个`}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
            {argsPreview ?? approval.content}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--primary)_22%,transparent)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold text-[var(--primary)] transition hover:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
            onClick={() =>
              onResolve(String(approval.metadata?.approvalId ?? ""), "approved")
            }
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t.chat("toolApprovalAllow")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
            onClick={() =>
              onResolve(String(approval.metadata?.approvalId ?? ""), "approved_for_conversation")
            }
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t.chat("toolApprovalAllowForConversation")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--muted)]"
            onClick={() =>
              onResolve(String(approval.metadata?.approvalId ?? ""), "denied")
            }
          >
            <X className="h-3.5 w-3.5" />
            {t.chat("toolApprovalDeny")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatMessageThread({
  conversationId,
  messages,
  run,
  showInternalMessages,
  pendingSystemMessage,
  pendingSystemUpdates,
  pendingReasoningText,
  runElapsedLabel,
  pendingActor,
  showMentions,
  profile,
  agents,
  teams,
  selectedMessageIds,
  selectedMessagesExportState,
  isConversationBusy,
  onCopyMessage,
  onToggleMessageSelection,
  onClearMessageSelection,
  onExportSelectedMessages,
  onEditUserMessage,
  onRetryUserMessage,
}: {
  conversationId: string;
  messages: MessageRecord[];
  run: RunRecord | null;
  showInternalMessages: boolean;
  pendingSystemMessage: string | null;
  pendingSystemUpdates: string[];
  pendingReasoningText: string | null;
  runElapsedLabel: string | null;
  pendingActor: {
    name: string;
    avatarPath: string | null;
    avatar: string;
    avatarColor: string;
  } | null;
  showMentions: boolean;
  profile: UserProfile;
  agents: AgentRecord[];
  teams: TeamRecord[];
  selectedMessageIds: string[];
  selectedMessagesExportState: {
    status: "idle" | "exporting" | "success" | "error";
    message: string | null;
  };
  isConversationBusy: boolean;
  onCopyMessage: (message: MessageRecord) => Promise<void> | void;
  onToggleMessageSelection: (message: MessageRecord) => void;
  onClearMessageSelection: () => void;
  onExportSelectedMessages: () => Promise<void> | void;
  onEditUserMessage: (message: MessageRecord, options: { stopActiveRun: boolean }) => Promise<void> | void;
  onRetryUserMessage: (message: MessageRecord) => Promise<void> | void;
}) {
  const language = useAppStore((state) => state.settings.language);
  const resolveToolExecutionApproval = useAppStore((state) => state.resolveToolExecutionApproval);
  const authorizeMcp = useAppStore((state) => state.authorizeMcp);
  const t = createTranslator(language);
  const visibleMessages = getConversationVisibleMessages(messages, showInternalMessages);
  const threadMessages = useMemo(
    () => visibleMessages.filter((message) => !isToolApprovalMessage(message)),
    [visibleMessages],
  );
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const lastRunIdRef = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    message: MessageRecord;
    x: number;
    y: number;
  } | null>(null);
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const selectedMessageSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds]);
  const selectedMessageCount = selectedMessageIds.length;
  const hasStreamingVisibleMessage = useMemo(() => {
    return threadMessages.some(
      (message) =>
        message.visibility === "public" &&
        message.senderKind === "agent" &&
        message.metadata?.streaming === true &&
        (!run || message.runId === run.id),
    );
  }, [run, threadMessages]);
  const visiblePendingUpdates = useMemo(() => {
    const compacted = pendingSystemUpdates.map((item) => item.trim()).filter((item) => item.length > 0);
    if (!pendingSystemMessage) {
      return compacted;
    }
    const normalizedPending = pendingSystemMessage.trim();
    return compacted.filter(
      (item, index) => !(item === normalizedPending && index === compacted.length - 1),
    );
  }, [pendingSystemMessage, pendingSystemUpdates]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeMenu);
    };
  }, [contextMenu]);

  const updateShouldStickToBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceToBottom <= 80;
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    const anchor = bottomAnchorRef.current;
    if (!container || !anchor) return;

    if (!shouldStickToBottomRef.current) return;
    anchor.scrollIntoView({ block: "end" });
  }, [threadMessages, pendingSystemMessage, run?.id, run?.stepIndex, run?.status]);

  useEffect(() => {
    if (lastRunIdRef.current === run?.id) return;
    lastRunIdRef.current = run?.id ?? null;
    shouldStickToBottomRef.current = true;
  }, [run?.id]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
  }, [conversationId]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
  }, [showInternalMessages]);

  const openContextMenu = (event: MouseEvent, message: MessageRecord) => {
    event.preventDefault();
    setContextMenu({
      message,
      x: Math.min(event.clientX, window.innerWidth - 260),
      y: Math.min(event.clientY, window.innerHeight - 240),
    });
  };

  const contextMessage = contextMenu?.message ?? null;
  const contextMessageSelectable = contextMessage ? isMessageSelectable(contextMessage) : false;
  const contextMessageSelected = contextMessage ? selectedMessageSet.has(contextMessage.id) : false;
  const contextMessageIsUser = contextMessage?.senderKind === "user" && contextMessage.visibility === "public";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={updateShouldStickToBottom}
        className="min-h-0 flex-1 overflow-y-auto bg-[var(--background)] px-5 py-4"
      >
        <div className="space-y-4">
          {selectedMessageCount > 0 ? (
            <div className="sticky top-0 z-20 rounded-2xl border border-[color-mix(in_srgb,var(--primary)_18%,transparent)] bg-[color-mix(in_srgb,var(--card)_92%,var(--primary)_8%)] px-4 py-3 shadow-sm backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--primary)]">
                  {t.chat("selectedMessagesLabel").replace("{{count}}", String(selectedMessageCount))}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void onExportSelectedMessages()}
                  disabled={selectedMessagesExportState.status === "exporting"}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  {selectedMessagesExportState.status === "exporting"
                    ? t.chat("exportingSelectedMessages")
                    : t.chat("exportSelectedMessages")}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  onClick={onClearMessageSelection}
                >
                  <X className="h-3.5 w-3.5" />
                  {t.chat("clearSelection")}
                </button>
              </div>
              {selectedMessagesExportState.message ? (
                <p
                  className={`mt-2 text-xs ${
                    selectedMessagesExportState.status === "error"
                      ? "text-[var(--danger)]"
                      : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {selectedMessagesExportState.message}
                </p>
              ) : null}
            </div>
          ) : null}

          {threadMessages.map((message) => {
            const isUser = message.senderKind === "user";
            const isInternal = message.visibility === "internal";
            const isNotification = message.messageType === "notification";
            const isCommandCard = message.metadata?.cardType === "command_result";
            const isMcpOAuthCard = message.metadata?.cardType === "mcp_oauth";
            const isStreaming = message.metadata?.streaming === true;
            const attachments = getAttachments(message);
            const avatar = buildAvatarProps(message, { language, profile, agentMap, teamMap });
            const selected = selectedMessageSet.has(message.id);

            return (
              <div
                key={message.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                onContextMenu={(event) => openContextMenu(event, message)}
              >
                <div className={`flex max-w-[72%] items-start gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
                  {avatar ? (
                    <AvatarBadge
                      src={avatar.src}
                      fallback={avatar.fallback}
                      alt={avatar.alt}
                      className="mt-0.5 h-8 w-8 shrink-0 rounded-full"
                      style={avatar.style}
                      textClassName={avatar.textClassName}
                    />
                  ) : null}
                  <div className={["min-w-0", isUser ? "items-end" : ""].join(" ")}>
                    {!isUser ? (
                      <div className="mb-1.5 flex items-center gap-1.5 pl-0.5 text-[11px]">
                        <span className="truncate font-medium text-[var(--foreground)]">
                          {message.senderName}
                        </span>
                        <span className="text-[var(--muted-foreground)]">·</span>
                        <span className="text-[var(--muted-foreground)]">{formatTime(message.createdAt)}</span>
                      </div>
                    ) : null}

                    <div
                      className={[
                        "rounded-2xl border px-4 py-2.5 text-[14px] leading-7 shadow-sm",
                        isUser
                          ? "rounded-tr-md border-transparent bg-[var(--primary)] text-white"
                          : isNotification
                            ? "rounded-tl-md border-[color-mix(in_srgb,var(--primary)_18%,transparent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                            : "rounded-tl-md",
                        !isUser && !isNotification ? messageTone(message) : "",
                        selected
                          ? "ring-2 ring-[color-mix(in_srgb,var(--primary)_35%,transparent)] ring-offset-1 ring-offset-[var(--background)]"
                          : "",
                      ].join(" ")}
                    >
                      {isCommandCard ? (
                        <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-sm text-[var(--foreground)]">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold">{String(message.metadata?.shellCommand ?? "command")}</p>
                            <span className="text-xs text-[var(--muted-foreground)]">
                              exit {String(message.metadata?.code ?? 0)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-6 text-[var(--muted-foreground)]">
                            {String(message.metadata?.workspacePath ?? "")}
                          </p>
                          {typeof message.metadata?.artifactPath === "string" ? (
                            <a
                              href={resolveAssetSrc(String(message.metadata.artifactPath)) ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex text-xs font-medium text-[var(--primary)] hover:underline"
                            >
                              {t.chat("commandResultViewFull")}
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                      {isNotification ? (
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--primary)]">
                          <Bot className="h-3.5 w-3.5" />
                          {message.metadata?.directFromSpecialist
                            ? `${t.chat("notificationLabel")} · ${t.chat("specialistDirectQuestion")}`
                            : message.metadata?.relayedByManager
                              ? `${t.chat("notificationLabel")} · ${t.chat("managerRelayQuestion")}`
                              : t.chat("notificationLabel")}
                        </div>
                      ) : null}
                      {isMcpOAuthCard ? (
                        <div className="space-y-3">
                          <div className="flex items-start gap-2">
                            <ShieldAlert className="mt-1 h-4 w-4 shrink-0 text-[var(--primary)]" />
                            <div>
                              <p className="font-semibold">{t.chat("mcpOAuthTitle")}</p>
                              <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                                {message.content}
                              </p>
                            </div>
                          </div>
                          {typeof message.metadata?.serverId === "string" ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                              onClick={() => void authorizeMcp(String(message.metadata?.serverId))}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {t.chat("mcpOAuthAuthorize")}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {!isCommandCard && !isMcpOAuthCard ? (
                        <ChatMarkdownContent content={message.content} inverted={isUser} />
                      ) : null}
                      {isStreaming ? (
                        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]" />
                          {t.chat("generating")}
                        </div>
                      ) : null}
                    </div>

                    {attachments.length > 0 ? (
                      <div className="mt-2 flex flex-col gap-2">
                        {attachments.map((attachment) => (
                          <a
                            key={attachment.path}
                            href={resolveAssetSrc(attachment.path) ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="max-w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-sm text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                          >
                            <div className="flex items-center gap-2">
                              <Paperclip className="h-4 w-4 shrink-0" />
                              <span className="truncate">{attachment.name}</span>
                              <span className="ml-auto shrink-0 text-xs text-[var(--muted-foreground)]">
                                {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
                              </span>
                            </div>
                            {isImageAttachment(attachment) ? (
                              <img
                                src={resolveAssetSrc(attachment.path) ?? undefined}
                                alt={attachment.name}
                                className="mt-3 max-h-48 rounded-xl border border-[var(--border)] object-cover"
                              />
                            ) : null}
                          </a>
                        ))}
                      </div>
                    ) : null}

                    {showMentions && message.mentions.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {message.mentions.map((mention) => (
                          <span
                            key={mention}
                            className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--primary)]"
                          >
                            @{resolveMentionLabel(mention, { language, profile, agentMap, teamMap })}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {isInternal ? (
                      <div className="mt-2 flex items-center gap-2 text-xs text-[var(--warning)]">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        {t.chat("internalMessage")}
                      </div>
                    ) : null}

                    {isUser ? (
                      <span className="mt-1.5 block pr-0.5 text-right text-[11px] text-[var(--muted-foreground)]">
                        {formatTime(message.createdAt)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}

          {(pendingSystemMessage || pendingReasoningText) && !hasStreamingVisibleMessage ? (
            <div className="flex justify-start">
              <div className="flex max-w-[72%] items-start gap-2.5">
                {pendingActor ? (
                  <AvatarBadge
                    src={pendingActor.avatarPath}
                    fallback={pendingActor.avatar}
                    alt={pendingActor.name}
                    className="mt-0.5 h-8 w-8 shrink-0 rounded-full"
                    style={{ backgroundColor: pendingActor.avatarColor }}
                    textClassName="text-xs font-semibold text-white"
                  />
                ) : null}
                <div className="min-w-0">
                  <div className="mb-1.5 flex items-center gap-1.5 pl-0.5 text-[11px]">
                    <span className="truncate font-medium text-[var(--foreground)]">
                      {pendingActor?.name ?? t.chat("systemThinking")}
                    </span>
                    <span className="text-[var(--muted-foreground)]">·</span>
                    <span className="text-[var(--muted-foreground)]">{t.chat("systemThinking")}</span>
                    {runElapsedLabel ? (
                      <>
                        <span className="text-[var(--muted-foreground)]">·</span>
                        <span className="text-[var(--muted-foreground)]">{runElapsedLabel}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="rounded-2xl rounded-tl-md border border-transparent bg-[var(--muted)] px-4 py-3 text-[14px] leading-7 text-[var(--foreground)] shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                      <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]" />
                      <span className="animate-pulse">{t.chat("thinking")}</span>
                    </div>
                    {pendingSystemMessage ? <ChatMarkdownContent content={pendingSystemMessage} /> : null}
                    {pendingReasoningText ? (
                      <div className="mt-2 rounded-xl border border-[color-mix(in_srgb,var(--primary)_18%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3 py-2">
                        <p className="mb-1 text-[11px] font-semibold text-[var(--primary)]">
                          {language === "en" ? "Model thinking" : "模型思考"}
                        </p>
                        <ChatMarkdownContent content={pendingReasoningText} />
                      </div>
                    ) : null}
                    {visiblePendingUpdates.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        {visiblePendingUpdates.map((line, index) => (
                          <p key={`${line}-${index}`} className="text-xs leading-6 text-[var(--muted-foreground)]">
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div ref={bottomAnchorRef} />
        </div>
      </div>

      <ToolApprovalDock
        messages={visibleMessages}
        language={language}
        onResolve={(approvalId, decision) => {
          if (!approvalId) return;
          void resolveToolExecutionApproval({ approvalId, decision });
        }}
      />

      {contextMessage ? (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-2xl"
          style={{ left: contextMenu?.x ?? 0, top: contextMenu?.y ?? 0 }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              void onCopyMessage(contextMessage);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <Copy className="h-4 w-4 text-[var(--muted-foreground)]" />
            {t.chat("contextMenuCopyMessage")}
          </button>

          {contextMessageIsUser ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void onEditUserMessage(contextMessage, { stopActiveRun: isConversationBusy });
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
              >
                {isConversationBusy ? (
                  <StopCircle className="h-4 w-4 text-[var(--muted-foreground)]" />
                ) : (
                  <PencilLine className="h-4 w-4 text-[var(--muted-foreground)]" />
                )}
                {isConversationBusy ? t.chat("contextMenuStopAndEditMessage") : t.chat("contextMenuEditMessage")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void onRetryUserMessage(contextMessage);
                  setContextMenu(null);
                }}
                disabled={isConversationBusy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <Redo2 className="h-4 w-4 text-[var(--muted-foreground)]" />
                {t.chat("contextMenuRetryMessage")}
              </button>
              <div className="my-1 h-px bg-[var(--border)]" />
            </>
          ) : null}

          {contextMessageSelectable ? (
            <button
              type="button"
              onClick={() => {
                onToggleMessageSelection(contextMessage);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
            >
              <ImagePlus className="h-4 w-4 text-[var(--muted-foreground)]" />
              {contextMessageSelected ? t.chat("contextMenuUnselectMessage") : t.chat("contextMenuSelectMessage")}
            </button>
          ) : null}

          {selectedMessageCount > 0 ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void onExportSelectedMessages();
                  setContextMenu(null);
                }}
                disabled={selectedMessagesExportState.status === "exporting"}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <ImagePlus className="h-4 w-4 text-[var(--muted-foreground)]" />
                {selectedMessagesExportState.status === "exporting"
                  ? t.chat("exportingSelectedMessages")
                  : t.chat("exportSelectedMessages")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearMessageSelection();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <X className="h-4 w-4" />
                {t.chat("clearSelection")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
