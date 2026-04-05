import { useState } from "react";
import { AtSign, Command, Paperclip, Send } from "lucide-react";
import { createTranslator } from "../../i18n";
import { useAppStore } from "../../store/use-app-store";

export function ChatComposer({
  onSend,
}: {
  onSend: (input: string) => Promise<void>;
}) {
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

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
          placeholder={t.chat("directMessageHint")}
          className="min-h-[104px] w-full resize-none border-0 bg-transparent py-1 text-[14px] leading-7 text-[var(--foreground)] outline-0 placeholder:text-[var(--muted-foreground)]"
        />

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
  );
}
