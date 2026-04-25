import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Bot, Edit3, Hash, Search, Trash2, UserX } from "lucide-react";
import type { ConversationRecord } from "@shared";
import { createTranslator } from "../../i18n";
import { useAppStore } from "../../store/use-app-store";
import { AvatarBadge } from "../avatar-badge";

export function ChatConversationList({
  conversations,
  activeConversationId,
  onSelectConversation,
  onEditTarget,
  onDeleteConversation,
  onDeleteTarget,
  search,
  onSearchChange,
}: {
  conversations: ConversationRecord[];
  activeConversationId: string;
  onSelectConversation: (conversationId: string) => void;
  onEditTarget: (conversation: ConversationRecord) => void;
  onDeleteConversation: (conversation: ConversationRecord) => void;
  onDeleteTarget: (conversation: ConversationRecord) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const language = useAppStore((state) => state.settings.language);
  const agents = useAppStore((state) => state.agents);
  const teams = useAppStore((state) => state.teams);
  const t = createTranslator(language);
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const [contextMenu, setContextMenu] = useState<{
    conversation: ConversationRecord;
    x: number;
    y: number;
  } | null>(null);

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

  const openContextMenu = (event: MouseEvent, conversation: ConversationRecord) => {
    event.preventDefault();
    onSelectConversation(conversation.id);
    setContextMenu({
      conversation,
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 160),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--card)]">
      <div className="border-b border-[var(--border)] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t.common("searchConversations")}
            className="w-full rounded-lg bg-[var(--muted)] py-2 pl-9 pr-3 text-[13px] text-[var(--foreground)] outline-none ring-0 placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_22%,transparent)]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {conversations.map((conversation) => {
          const active = conversation.id === activeConversationId;
          const target =
            conversation.kind === "agent"
              ? agentMap.get(conversation.targetId)
              : teamMap.get(conversation.targetId);
          return (
            <button
              key={conversation.id}
              onClick={() => onSelectConversation(conversation.id)}
              onContextMenu={(event) => openContextMenu(event, conversation)}
              className={`w-full rounded-xl px-3 py-3 text-left transition ${
                active
                  ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                  : "hover:bg-[var(--muted)]"
              }`}
            >
              <div className="flex items-start gap-3">
                {target ? (
                  <AvatarBadge
                    src={target.avatarPath}
                    fallback={target.avatar}
                    alt={target.name}
                    className="h-10 w-10 shrink-0 rounded-xl"
                    style={
                      conversation.kind === "agent"
                        ? { backgroundColor: target.avatarColor }
                        : {
                            backgroundColor: `${target.avatarColor}20`,
                            color: target.avatarColor,
                          }
                    }
                    textClassName={
                      conversation.kind === "agent"
                        ? "text-sm font-semibold text-white"
                        : "text-sm font-semibold"
                    }
                  />
                ) : (
                  <div
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                      conversation.kind === "agent"
                        ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)]"
                        : "bg-[color-mix(in_srgb,#06b6d4_12%,transparent)] text-[#06b6d4]"
                    }`}
                  >
                    {conversation.kind === "agent" ? (
                      <Bot className="h-5 w-5" />
                    ) : (
                      <Hash className="h-5 w-5" />
                    )}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--text)]">
                        {conversation.title}
                      </p>
                    </div>
                    {conversation.unread > 0 && !active ? (
                      <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[var(--primary)] px-2 text-xs font-semibold text-white">
                        {conversation.unread}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--muted-foreground)]">
                        {new Date(conversation.lastActivityAt).toLocaleTimeString(
                          language === "zh" ? "zh-CN" : "en-US",
                          {
                          hour: "2-digit",
                          minute: "2-digit",
                          },
                        )}
                      </span>
                    )}
                  </div>

                  <p className="mt-2 line-clamp-2 text-[12px] leading-6 text-[var(--muted-foreground)]">
                    {conversation.lastMessage}
                  </p>
                </div>
              </div>
            </button>
          );
        })}

        {conversations.length === 0 ? (
          <div className="mx-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted-text)]">
            {t.common("noMatchConversations")}
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <div
          className="fixed z-50 w-52 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              onEditTarget(contextMenu.conversation);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <Edit3 className="h-4 w-4 text-[var(--muted-foreground)]" />
            {t.chat("contextMenuEdit")}
          </button>
          <button
            type="button"
            onClick={() => {
              onDeleteConversation(contextMenu.conversation);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <Trash2 className="h-4 w-4 text-[var(--muted-foreground)]" />
            {t.chat("contextMenuDeleteConversation")}
          </button>
          <div className="my-1 h-px bg-[var(--border)]" />
          <button
            type="button"
            onClick={() => {
              onDeleteTarget(contextMenu.conversation);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--danger)] transition hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]"
          >
            <UserX className="h-4 w-4" />
            {contextMenu.conversation.kind === "agent"
              ? t.chat("contextMenuDeleteAgent")
              : t.chat("contextMenuDeleteTeam")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
