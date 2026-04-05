import { useMemo } from "react";
import { Bot, Hash, Search } from "lucide-react";
import type { ConversationRecord } from "@shared";
import { createTranslator } from "../../i18n";
import { useAppStore } from "../../store/use-app-store";
import { AvatarBadge } from "../avatar-badge";

export function ChatConversationList({
  conversations,
  activeConversationId,
  onSelectConversation,
  search,
  onSearchChange,
}: {
  conversations: ConversationRecord[];
  activeConversationId: string;
  onSelectConversation: (conversationId: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const language = useAppStore((state) => state.settings.language);
  const agents = useAppStore((state) => state.agents);
  const teams = useAppStore((state) => state.teams);
  const t = createTranslator(language);
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

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
                    {conversation.unread > 0 ? (
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
    </div>
  );
}
