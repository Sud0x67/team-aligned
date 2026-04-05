import { Bot, ShieldAlert } from "lucide-react";
import type { MessageRecord, RunRecord } from "@shared";
import { createTranslator } from "../../i18n";
import { useAppStore } from "../../store/use-app-store";
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

export function ChatMessageThread({
  messages,
  run,
  showInternalMessages,
}: {
  messages: MessageRecord[];
  run: RunRecord | null;
  showInternalMessages: boolean;
}) {
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);
  const visibleMessages = getConversationVisibleMessages(messages, showInternalMessages);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--background)] px-5 py-4">
        <div className="space-y-4">
          {visibleMessages.map((message) => {
            const isUser = message.senderKind === "user";
            const isInternal = message.visibility === "internal";
            const isNotification = message.messageType === "notification";

            return (
              <div
                key={message.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={[
                    "max-w-[68%]",
                    isUser ? "items-end" : "",
                  ].join(" ")}
                >
                  {!isUser ? (
                    <span className="mb-1 block text-[11px] text-[var(--muted-foreground)]">
                      {message.senderName} · {formatTime(message.createdAt)}
                    </span>
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
                    {isNotification ? (
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--primary)]">
                        <Bot className="h-3.5 w-3.5" />
                        {t.chat("notificationLabel")}
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>

                  {message.mentions.length > 0 ? (
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
                    <span className="mt-1 block text-right text-[11px] text-[var(--muted-foreground)]">
                      {formatTime(message.createdAt)}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}

          {run ? (
            <div className="rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--primary)_20%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-[var(--primary)]" />
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {t.chat("currentRun")}：{run.title}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--card)] px-3 py-1 text-xs font-semibold text-[var(--primary)]">
                  {run.status}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                {t.chat("currentStep")} {run.stepIndex} / {run.totalSteps} · {run.kind}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
