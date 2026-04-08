import { useEffect, useMemo, useRef } from "react";
import { Bot, Paperclip, ShieldAlert } from "lucide-react";
import type { AgentRecord, AttachmentAssetRecord, MessageRecord, RunRecord, UserProfile } from "@shared";
import { createTranslator } from "../../i18n";
import { resolveAssetSrc } from "../../lib/asset-src";
import { useAppStore } from "../../store/use-app-store";
import { AvatarBadge } from "../avatar-badge";
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
    profile: UserProfile;
    agentMap: Map<string, AgentRecord>;
  },
) {
  if (message.senderKind === "user") {
    return {
      src: input.profile.avatarPath,
      fallback: input.profile.name.slice(0, 1) || "你",
      alt: input.profile.name || "你",
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

export function ChatMessageThread({
  conversationId,
  messages,
  run,
  showInternalMessages,
  pendingSystemMessage,
  showMentions,
  profile,
  agents,
}: {
  conversationId: string;
  messages: MessageRecord[];
  run: RunRecord | null;
  showInternalMessages: boolean;
  pendingSystemMessage: string | null;
  showMentions: boolean;
  profile: UserProfile;
  agents: AgentRecord[];
}) {
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);
  const visibleMessages = getConversationVisibleMessages(messages, showInternalMessages);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const lastRunIdRef = useRef<string | null>(null);
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const updateShouldStickToBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceToBottom <= 80;
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    const anchor = bottomAnchorRef.current;
    if (!container || !anchor) return;

    if (!shouldStickToBottomRef.current) return;
    anchor.scrollIntoView({ block: "end" });
  }, [visibleMessages, pendingSystemMessage, run?.id, run?.stepIndex, run?.status]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={updateShouldStickToBottom}
        className="min-h-0 flex-1 overflow-y-auto bg-[var(--background)] px-5 py-4"
      >
        <div className="space-y-4">
          {visibleMessages.map((message) => {
            const isUser = message.senderKind === "user";
            const isInternal = message.visibility === "internal";
            const isNotification = message.messageType === "notification";
            const isCommandCard = message.metadata?.cardType === "command_result";
            const isStreaming = message.metadata?.streaming === true;
            const attachments = getAttachments(message);
            const avatar = buildAvatarProps(message, { profile, agentMap });

            return (
              <div
                key={message.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
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
                  <div
                    className={[
                      "min-w-0",
                      isUser ? "items-end" : "",
                    ].join(" ")}
                  >
                  {!isUser ? (
                    <div className="mb-1.5 flex items-center gap-1.5 pl-0.5 text-[11px]">
                      <span className="truncate font-medium text-[var(--foreground)]">
                        {message.senderName}
                      </span>
                      <span className="text-[var(--muted-foreground)]">·</span>
                      <span className="text-[var(--muted-foreground)]">
                        {formatTime(message.createdAt)}
                      </span>
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
                            查看完整结果
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
                    <p className="whitespace-pre-wrap">{message.content}</p>
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
                          @{mention}
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

          {pendingSystemMessage ? (
            <div className="flex justify-start">
              <div className="max-w-[68%]">
                <span className="mb-1 block text-[11px] text-[var(--muted-foreground)]">
                  {t.chat("systemThinking")}
                </span>
                <div className="rounded-2xl rounded-tl-md border border-[color-mix(in_srgb,var(--primary)_18%,transparent)] bg-[var(--accent)] px-4 py-3 text-[14px] leading-7 text-[var(--accent-foreground)] shadow-sm">
                  <div className="mb-2 flex items-center gap-2 text-xs text-[var(--primary)]">
                    <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]" />
                    <span className="inline-flex gap-1">
                      <span className="animate-pulse">{t.chat("thinking")}</span>
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{pendingSystemMessage}</p>
                </div>
              </div>
            </div>
          ) : null}

          <div ref={bottomAnchorRef} />
        </div>
      </div>
    </div>
  );
}
