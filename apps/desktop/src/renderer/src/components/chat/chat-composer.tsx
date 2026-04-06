import { useEffect, useId, useMemo, useState } from "react";
import { AtSign, Command, Paperclip, Send, X } from "lucide-react";
import type { AttachmentAssetRecord } from "@shared";
import { resolveAssetSrc } from "../../lib/asset-src";
import { createTranslator } from "../../i18n";
import { useAppStore } from "../../store/use-app-store";

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function ChatComposer({
  conversationId,
  onSend,
  mentionCandidates,
}: {
  conversationId: string;
  onSend: (payload: { input: string; attachments: AttachmentAssetRecord[] }) => Promise<void>;
  mentionCandidates: Array<{ id: string; name: string; role: string }>;
}) {
  const language = useAppStore((state) => state.settings.language);
  const commandSuggestions = useAppStore((state) => state.commandSuggestions);
  const t = createTranslator(language);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentAssetRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const fileInputId = useId();

  const activeToken = useMemo(() => {
    const match = input.match(/(?:^|\s)([@/][^\s]*)$/);
    return match ? match[1] : null;
  }, [input]);

  const suggestionState = useMemo(() => {
    if (!activeToken) return null;

    if (activeToken.startsWith("/")) {
      const query = activeToken.slice(1).toLowerCase();
      const items = commandSuggestions.filter((item) =>
        item.name.slice(1).toLowerCase().includes(query),
      );
      return {
        type: "command" as const,
        items: items.map((item) => ({
          key: item.name,
          title: item.name,
          subtitle: item.description,
          value: `${item.name} `,
        })),
      };
    }

    if (activeToken.startsWith("@")) {
      const query = activeToken.slice(1).toLowerCase();
      const items = mentionCandidates.filter((item) =>
        item.name.toLowerCase().includes(query),
      );
      return {
        type: "mention" as const,
        items: items.map((item) => ({
          key: item.id,
          title: `@${item.name}`,
          subtitle: item.role,
          value: `@${item.name} `,
        })),
      };
    }

    return null;
  }, [activeToken, commandSuggestions, mentionCandidates]);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [suggestionState?.type, suggestionState?.items.length]);

  const applySuggestion = (value: string) => {
    if (!activeToken) return;
    setInput((current) => current.replace(/(?:^|\s)([@/][^\s]*)$/, (match, token: string) => match.replace(token, value)));
  };

  const submit = async () => {
    const value = input.trim();
    if ((!value && attachments.length === 0) || sending || uploading) return;
    setSending(true);
    try {
      await onSend({ input: value, attachments });
      setInput("");
      setAttachments([]);
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
            if (suggestionState && suggestionState.items.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSuggestionIndex((current) =>
                  (current + 1) % suggestionState.items.length,
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSuggestionIndex((current) =>
                  (current - 1 + suggestionState.items.length) % suggestionState.items.length,
                );
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                applySuggestion(suggestionState.items[activeSuggestionIndex]?.value ?? "");
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setActiveSuggestionIndex(0);
                setInput((current) => `${current} `);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={3}
          placeholder={t.chat("directMessageHint")}
          className="min-h-[104px] w-full resize-none border-0 bg-transparent py-1 text-[14px] leading-7 text-[var(--foreground)] outline-0 placeholder:text-[var(--muted-foreground)]"
        />

        {suggestionState && suggestionState.items.length > 0 ? (
          <div className="mt-3 rounded-[18px] border border-[var(--border)] bg-[var(--background)] p-2">
            <div className="space-y-1">
              {suggestionState.items.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => applySuggestion(item.value)}
                  className={`flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-2 text-left transition ${
                    index === activeSuggestionIndex
                      ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                      : "hover:bg-[var(--muted)]"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--foreground)]">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-6 text-[var(--muted-foreground)]">{item.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
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
            <label
              htmlFor={fileInputId}
              className="shrink-0 cursor-pointer rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <Paperclip className="h-5 w-5" />
            </label>
            <input
              id={fileInputId}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length === 0) return;
                setUploading(true);
                void Promise.all(
                  files.map(async (file) => {
                    const dataUrl = await fileToDataUrl(file);
                    return window.teamaligned.saveAttachmentAsset({
                      conversationId,
                      dataUrl,
                      fileName: file.name,
                    });
                  }),
                )
                  .then((assets) => {
                    setAttachments((current) => [...current, ...assets]);
                  })
                  .finally(() => {
                    setUploading(false);
                    event.target.value = "";
                  });
              }}
            />
          </div>

          <button
            onClick={() => void submit()}
            disabled={(!input.trim() && attachments.length === 0) || sending || uploading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {attachments.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <span
                key={attachment.path}
                className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)]"
              >
                {attachment.mimeType.startsWith("image/") ? (
                  <img
                    src={resolveAssetSrc(attachment.path) ?? undefined}
                    alt={attachment.name}
                    className="h-10 w-10 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                )}
                <span className="truncate">{attachment.name}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.path !== attachment.path),
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
    </div>
  );
}
