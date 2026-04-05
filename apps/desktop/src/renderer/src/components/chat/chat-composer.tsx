import { useMemo, useState } from "react";
import { AtSign, Command, Paperclip, Send, Sparkles } from "lucide-react";
import type { ConversationKind } from "@shared";
import { commandSuggestions, parseSlashCommand } from "@shared";
import { createTranslator } from "../../i18n";
import { useAppStore } from "../../store/use-app-store";

function highlightHint(input: string, t: ReturnType<typeof createTranslator>) {
  const parsed = parseSlashCommand(input);
  if (!parsed) return null;

  switch (parsed.name) {
    case "skills":
      return `${t.chat("hintsPrefix")} ${t.chat("skillsHint")}`;
    case "command":
      return `${t.chat("hintsPrefix")} ${t.chat("commandHint")}`;
    case "mcp":
      return `${t.chat("hintsPrefix")} ${t.chat("mcpHint")}`;
    case "pause":
      return `${t.chat("hintsPrefix")} ${t.chat("pauseHint")}`;
    case "resume":
      return `${t.chat("hintsPrefix")} ${t.chat("resumeHint")}`;
    case "cancel":
      return `${t.chat("hintsPrefix")} ${t.chat("cancelHint")}`;
    default:
      return null;
  }
}

export function ChatComposer({
  conversationKind,
  suggestions,
  activeSkill,
  pinnedMcp,
  onSend,
}: {
  conversationKind: ConversationKind;
  suggestions: typeof commandSuggestions;
  activeSkill: string | null;
  pinnedMcp: string | null;
  onSend: (input: string) => Promise<void>;
}) {
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const hint = useMemo(() => highlightHint(input, t), [input, t]);

  const submit = async () => {
    const value = input.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await onSend(value);
      setInput("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {suggestions.map((item) => (
          <button
            key={item.name}
            onClick={() => setInput(item.name)}
            className="rounded-full bg-[var(--muted)] px-3 py-1 text-[11px] font-medium text-[var(--foreground)] transition hover:bg-[var(--accent)] hover:text-[var(--primary)]"
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-sm">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={3}
          placeholder={
            conversationKind === "team"
              ? t.chat("messagesHint")
              : t.chat("directMessageHint")
          }
          className="min-h-[104px] w-full resize-none border-0 bg-transparent py-1 text-[14px] leading-7 text-[var(--foreground)] outline-0 placeholder:text-[var(--muted-foreground)]"
        />

        {hint ? (
          <div className="mt-1.5 rounded-xl bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] px-3 py-1.5 text-sm text-[var(--primary)]">
            {hint}
          </div>
        ) : null}

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-[color-mix(in_srgb,var(--border)_78%,transparent)] pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
            <button
              type="button"
              className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              onClick={() => setInput((current) => `${current}${current ? " " : ""}/command `)}
            >
              <Command className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              onClick={() => setInput((current) => `${current}${current ? " " : ""}@`)}
            >
              <AtSign className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <Paperclip className="h-5 w-5" />
            </button>

            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1">
                <Sparkles className="h-3.5 w-3.5" />
                {activeSkill ? `${t.chat("skillLabel")} ${activeSkill}` : t.chat("defaultSkill")}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1">
                {pinnedMcp ? `MCP ${pinnedMcp}` : t.chat("mcpAvailable")}
              </span>
            </div>
          </div>

          <button
            onClick={() => void submit()}
            disabled={!input.trim() || sending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
