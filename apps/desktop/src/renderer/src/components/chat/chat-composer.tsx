import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AtSign, FileText, Hash, Paperclip, Send, SmilePlus, Square, X } from "lucide-react";
import type {
  AttachmentAssetRecord,
  WorkspaceFileSuggestion,
  WorkspaceReferencePreview,
} from "@shared";
import { resolveAssetSrc } from "../../lib/asset-src";
import { createTranslator } from "../../i18n";
import { useAppStore } from "../../store/use-app-store";

type SlashSuggestion = {
  name: string;
  description: string;
  kind?: "command" | "skill" | "prompt" | "file";
};

export type ComposerPrefill = {
  revision: number;
  input: string;
  attachments: AttachmentAssetRecord[];
};

const maxAttachmentCount = 8;
const maxAttachmentBytes = 20 * 1024 * 1024;
const minTextareaHeight = 88;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const emojiChoices = [
  "😀",
  "😄",
  "😊",
  "🙂",
  "😉",
  "😍",
  "🤔",
  "🫡",
  "😮",
  "😂",
  "😭",
  "😅",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🙏",
  "💪",
  "👌",
  "🤝",
  "❤️",
  "🔥",
  "✨",
  "🎉",
  "🚀",
  "✅",
  "❌",
  "⚠️",
  "📌",
  "📎",
];

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatWorkspaceReference(path: string) {
  return /\s/.test(path) ? `#[${path}] ` : `#${path} `;
}

export function ChatComposer({
  conversationId,
  onSend,
  mentionCandidates,
  slashSuggestions,
  busy,
  onCancel,
  prefill,
  className,
}: {
  conversationId: string;
  onSend: (payload: { input: string; attachments: AttachmentAssetRecord[] }) => Promise<void>;
  mentionCandidates: Array<{ id: string; name: string; role: string }>;
  slashSuggestions: SlashSuggestion[];
  busy: boolean;
  onCancel: () => Promise<void>;
  prefill: ComposerPrefill | null;
  className?: string;
}) {
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentAssetRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "error" | "info";
    message: string;
  } | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [workspaceFileSuggestions, setWorkspaceFileSuggestions] = useState<WorkspaceFileSuggestion[]>(
    [],
  );
  const [workspaceReferencePreview, setWorkspaceReferencePreview] = useState<WorkspaceReferencePreview[]>(
    [],
  );
  const [loadingWorkspaceReferencePreview, setLoadingWorkspaceReferencePreview] = useState(false);
  const [loadingWorkspaceFileSuggestions, setLoadingWorkspaceFileSuggestions] = useState(false);
  const [textareaMaxHeight, setTextareaMaxHeight] = useState(220);
  const [suggestionPanelStyle, setSuggestionPanelStyle] = useState<{
    left: number;
    width: number;
    bottom: number;
    maxHeight: number;
  } | null>(null);
  const fileInputId = useId();
  const emojiPanelRef = useRef<HTMLDivElement | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeToken = useMemo(() => {
    const match = input.match(/(?:^|\s)([@/#][^\s]*)$/);
    return match ? match[1] : null;
  }, [input]);

  useEffect(() => {
    if (!activeToken || !activeToken.startsWith("#")) {
      setWorkspaceFileSuggestions([]);
      setLoadingWorkspaceFileSuggestions(false);
      return;
    }

    const query = activeToken.slice(1).replace(/^\[/, "").trim();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingWorkspaceFileSuggestions(true);
      window.teamaligned
        .searchWorkspaceFiles({ conversationId, query, limit: 24 })
        .then((items) => {
          if (cancelled) return;
          setWorkspaceFileSuggestions(items);
        })
        .catch(() => {
          if (cancelled) return;
          setWorkspaceFileSuggestions([]);
        })
        .finally(() => {
          if (cancelled) return;
          setLoadingWorkspaceFileSuggestions(false);
        });
    }, 90);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeToken, conversationId]);

  useEffect(() => {
    if (!input.includes("#")) {
      setWorkspaceReferencePreview([]);
      setLoadingWorkspaceReferencePreview(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingWorkspaceReferencePreview(true);
      window.teamaligned
        .previewWorkspaceReferences({ conversationId, content: input })
        .then((items) => {
          if (cancelled) return;
          setWorkspaceReferencePreview(items);
        })
        .catch(() => {
          if (cancelled) return;
          setWorkspaceReferencePreview([]);
        })
        .finally(() => {
          if (cancelled) return;
          setLoadingWorkspaceReferencePreview(false);
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [conversationId, input]);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.input);
    setAttachments(prefill.attachments);
    setFeedback(null);
    setEmojiOpen(false);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.selectionStart = textarea.value.length;
      textarea.selectionEnd = textarea.value.length;
    });
  }, [prefill]);

  const suggestionState = useMemo(() => {
    if (!activeToken) return null;

    if (activeToken.startsWith("/")) {
      const query = activeToken.slice(1).toLowerCase();
      const items = slashSuggestions.filter((item) =>
        item.name.slice(1).toLowerCase().includes(query),
      );
      return {
        type: "command" as const,
        items: items.map((item) => ({
          key: item.name,
          title: item.name,
          subtitle: item.description,
          value: `${item.name} `,
          kind: item.kind ?? "command",
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
          kind: "mention" as const,
        })),
      };
    }

    if (activeToken.startsWith("#")) {
      return {
        type: "file" as const,
        items: workspaceFileSuggestions.map((item) => ({
          key: item.absolutePath,
          title: `#${item.path}`,
          subtitle: item.absolutePath,
          value: formatWorkspaceReference(item.path),
          kind: "file" as const,
        })),
      };
    }

    return null;
  }, [activeToken, mentionCandidates, slashSuggestions, workspaceFileSuggestions]);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [suggestionState?.type, suggestionState?.items.length]);

  useEffect(() => {
    if (!emojiOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!emojiPanelRef.current?.contains(event.target as Node)) {
        setEmojiOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [emojiOpen]);

  useEffect(() => {
    const root = composerRootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextMax = clamp(Math.round(entry.contentRect.height * 0.55), 120, 340);
      setTextareaMaxHeight(nextMax);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = clamp(textarea.scrollHeight, minTextareaHeight, textareaMaxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > textareaMaxHeight ? "auto" : "hidden";
  }, [input, textareaMaxHeight]);

  const applySuggestion = (value: string) => {
    if (!activeToken) return;
    setFeedback(null);
    setInput((current) =>
      current.replace(/(?:^|\s)([@/#][^\s]*)$/, (match, token: string) => match.replace(token, value)),
    );
  };

  const getSuggestionKindLabel = (kind: "command" | "skill" | "prompt" | "mention" | "file") => {
    if (kind === "skill") return "Skill";
    if (kind === "prompt") return "Prompt";
    if (kind === "mention") return "@";
    if (kind === "file") return t.chat("workspaceFile");
    return language === "zh" ? "内置" : "Built-in";
  };

  const removeWorkspaceReference = (token: string) => {
    setInput((current) =>
      current
        .replace(new RegExp(`(^|\\s)#\\[${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?=\\s|$)`, "g"), "$1")
        .replace(new RegExp(`(^|\\s)#${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "g"), "$1")
        .replace(/\s{2,}/g, " ")
        .trimStart(),
    );
  };

  const submit = async () => {
    const value = input.trim();
    if (busy || (!value && attachments.length === 0) || sending || uploading) {
      if (busy) {
        setFeedback({
          tone: "info",
          message: t.chat("awaitingReply"),
        });
      }
      return;
    }
    setSending(true);
    setFeedback(null);
    try {
      await onSend({ input: value, attachments });
      setInput("");
      setAttachments([]);
      setFeedback(null);
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t.chat("sendFailed"),
      });
    } finally {
      setSending(false);
    }
  };

  const showMentionButton = mentionCandidates.length > 0;
  const interactionLocked = busy || uploading;
  const showFileSuggestionsPanel =
    !busy &&
    !!suggestionState &&
    (suggestionState.items.length > 0 ||
      (activeToken?.startsWith("#") &&
        (loadingWorkspaceFileSuggestions || activeToken.slice(1).trim().length > 0)));

  useEffect(() => {
    if (!showFileSuggestionsPanel) {
      setSuggestionPanelStyle(null);
      return;
    }

    const updatePanelPosition = () => {
      const root = composerRootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      setSuggestionPanelStyle({
        left: rect.left,
        width: rect.width,
        bottom: Math.max(12, window.innerHeight - rect.top + 8),
        maxHeight: clamp(Math.round(rect.top - 24), 96, 288),
      });
    };

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && composerRootRef.current) {
      observer = new ResizeObserver(updatePanelPosition);
      observer.observe(composerRootRef.current);
    }

    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      observer?.disconnect();
    };
  }, [showFileSuggestionsPanel, suggestionState?.items.length]);

  const uploadFiles = async (files: File[], successMessage: string) => {
    if (files.length === 0) return;
    const remainingSlots = Math.max(0, maxAttachmentCount - attachments.length);
    if (remainingSlots === 0) {
      setFeedback({
        tone: "error",
        message: t.chat("attachmentUploadTooMany").replace("{{count}}", String(maxAttachmentCount)),
      });
      return;
    }

    const sizeAcceptedFiles = files.filter((file) => file.size <= maxAttachmentBytes);
    const acceptedFiles = sizeAcceptedFiles.slice(0, remainingSlots);
    const rejectedBySize = files.length - sizeAcceptedFiles.length;
    const rejectedByCount = sizeAcceptedFiles.length - acceptedFiles.length;

    if (acceptedFiles.length === 0) {
      setFeedback({
        tone: "error",
        message:
          rejectedBySize > 0
            ? t
                .chat("attachmentUploadTooLarge")
                .replace("{{size}}", formatFileSize(maxAttachmentBytes))
            : t.chat("attachmentUploadFailed"),
      });
      return;
    }

    setUploading(true);
    setFeedback({
      tone: "info",
      message: t.chat("attachmentsUploading"),
    });

    try {
      const results = await Promise.allSettled(
        acceptedFiles.map(async (file) => {
          const dataUrl = await fileToDataUrl(file);
          return window.teamaligned.saveAttachmentAsset({
            conversationId,
            dataUrl,
            fileName: file.name || `clipboard-image-${Date.now()}.png`,
          });
        }),
      );

      const succeeded = results
        .filter(
          (result): result is PromiseFulfilledResult<AttachmentAssetRecord> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value);
      const failedCount = results.length - succeeded.length;
      const firstFailureReason = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) =>
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason ?? ""),
        )
        .find((message) => message.trim().length > 0);
      const skippedCount = failedCount + rejectedBySize + rejectedByCount;

      if (succeeded.length > 0) {
        setAttachments((current) => [...current, ...succeeded]);
      }

      if (skippedCount > 0) {
        setFeedback({
          tone: "error",
          message:
            succeeded.length === 0
              ? firstFailureReason
                ? t.chat("attachmentUploadFailedWithReason").replace("{{reason}}", firstFailureReason)
                : t.chat("attachmentUploadFailed")
              : `${t.chat("attachmentUploadPartial")} ${succeeded.length} / ${files.length}`,
        });
        return;
      }

      setFeedback({
        tone: "info",
        message: `${successMessage} ${succeeded.length} ${t.common("items")}`,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      ref={composerRootRef}
      className={`relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] rounded-[18px] border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-sm ${className ?? ""}`}
    >
        {showFileSuggestionsPanel && suggestionPanelStyle ? (
          <div
            className="fixed z-[80] rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-2 shadow-2xl"
            style={{
              left: `${suggestionPanelStyle.left}px`,
              width: `${suggestionPanelStyle.width}px`,
              bottom: `${suggestionPanelStyle.bottom}px`,
            }}
          >
            <div
              className="overflow-y-auto overscroll-contain pr-1"
              style={{ maxHeight: `${suggestionPanelStyle.maxHeight}px` }}
            >
              <div className="space-y-1">
                {suggestionState.items.map((item, index) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => applySuggestion(item.value)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                      index === activeSuggestionIndex
                        ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                        : "hover:bg-[var(--muted)]"
                    }`}
                  >
                    <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                      {getSuggestionKindLabel(item.kind)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{item.title}</p>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{item.subtitle}</p>
                    </div>
                  </button>
                ))}
              </div>
              {activeToken?.startsWith("#") && !loadingWorkspaceFileSuggestions && suggestionState?.items.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                  {t.chat("workspaceNoFiles")}
                </p>
              ) : null}
              {activeToken?.startsWith("#") && loadingWorkspaceFileSuggestions ? (
                <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                  {t.chat("workspaceSearching")}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => {
              if (busy) {
                return;
              }
              setInput(event.target.value);
              if (feedback?.tone === "error") {
                setFeedback(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }

              if (busy) {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  setFeedback({
                    tone: "info",
                    message: t.chat("awaitingReply"),
                  });
                }
                return;
              }

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
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            readOnly={busy}
            onPaste={(event) => {
              if (busy) {
                event.preventDefault();
                setFeedback({
                  tone: "info",
                  message: t.chat("awaitingReply"),
                });
                return;
              }
              const imageFiles = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item, index) => item.getAsFile() ?? new File([], `clipboard-image-${index + 1}.png`))
                .filter((file): file is File => file.size > 0);

              if (imageFiles.length === 0) {
                return;
              }

              event.preventDefault();
              void uploadFiles(imageFiles, t.chat("pastedImagesReady"));
            }}
            rows={3}
            placeholder={busy ? t.chat("awaitingReplyPlaceholder") : t.chat("directMessageHint")}
            className="w-full resize-none border-0 bg-transparent py-1 text-[14px] leading-7 text-[var(--foreground)] outline-0 placeholder:text-[var(--muted-foreground)]"
          />

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

          {workspaceReferencePreview.length > 0 || loadingWorkspaceReferencePreview ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-[var(--muted-foreground)]">{t.chat("workspaceReferencePreview")}</p>
              <div className="flex flex-wrap gap-2">
                {workspaceReferencePreview.map((reference) => {
                  const resolved = reference.status === "resolved";
                  return (
                    <span
                      key={`${reference.token}-${reference.status}`}
                      className={`inline-flex max-w-full items-center gap-2 rounded-2xl border px-3 py-2 text-xs ${
                        resolved
                          ? "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
                          : "border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]"
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {resolved ? `#${reference.path}` : `#${reference.token}`}
                      </span>
                      {!resolved ? (
                        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] px-1.5 py-0.5 text-[10px]">
                          {t.chat("workspaceUnresolved")}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-full p-0.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                        onClick={() => removeWorkspaceReference(reference.token)}
                        aria-label={t.chat("workspaceRemoveReference")}
                        title={t.chat("workspaceRemoveReference")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  );
                })}
                {loadingWorkspaceReferencePreview ? (
                  <span className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    {t.chat("workspaceResolving")}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {feedback ? (
            <div
              className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${
                feedback.tone === "error"
                  ? "border-[color-mix(in_srgb,var(--danger)_20%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] text-[var(--danger)]"
                  : "border-[color-mix(in_srgb,var(--primary)_16%,transparent)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] text-[var(--muted-foreground)]"
              }`}
            >
              {feedback.message}
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex h-[52px] items-center justify-between gap-3 border-t border-[color-mix(in_srgb,var(--border)_78%,transparent)] pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
            {showMentionButton ? (
              <button
                type="button"
                className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                disabled={interactionLocked}
                onClick={() => setInput((current) => `${current}${current ? " " : ""}@`)}
              >
                <AtSign className="h-5 w-5" />
              </button>
            ) : null}
            <button
              type="button"
              className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              disabled={interactionLocked}
              onClick={() => setInput((current) => `${current}${current ? " " : ""}#`)}
              aria-label={t.chat("workspaceFile")}
              title={t.chat("workspaceFile")}
            >
              <Hash className="h-5 w-5" />
            </button>
            <div ref={emojiPanelRef} className="relative">
              <button
                type="button"
                className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                aria-label={t.chat("emoji")}
                title={t.chat("emoji")}
                disabled={interactionLocked}
                onClick={() => setEmojiOpen((current) => !current)}
              >
                <SmilePlus className="h-5 w-5" />
              </button>

              {emojiOpen ? (
                <div className="absolute bottom-11 left-0 z-20 w-[220px] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl">
                  <div className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">
                    {t.chat("emojiPickerTitle")}
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {emojiChoices.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="grid h-8 w-8 place-items-center rounded-xl text-lg transition hover:bg-[var(--muted)]"
                        onClick={() => {
                          setInput((current) => `${current}${emoji}`);
                          setEmojiOpen(false);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <label
              htmlFor={fileInputId}
              className={`shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition ${
                interactionLocked
                  ? "cursor-not-allowed opacity-40"
                  : "cursor-pointer hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
              aria-label={t.chat("attachment")}
              title={t.chat("attachment")}
            >
              <Paperclip className="h-5 w-5" />
            </label>
            <input
              id={fileInputId}
              type="file"
              multiple
              className="hidden"
              disabled={interactionLocked}
              onChange={(event) => {
                if (interactionLocked) {
                  event.target.value = "";
                  return;
                }
                const files = Array.from(event.target.files ?? []);
                if (files.length === 0) return;
                void uploadFiles(files, t.chat("attachmentsReady"))
                  .finally(() => {
                    event.target.value = "";
                  });
              }}
            />
          </div>

          {busy ? (
            <button
              type="button"
              onClick={() => void onCancel()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white transition hover:opacity-90"
              aria-label={t.chat("cancel")}
              title={t.chat("cancel")}
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={() => void submit()}
              disabled={(!input.trim() && attachments.length === 0) || sending || uploading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
    </div>
  );
}
