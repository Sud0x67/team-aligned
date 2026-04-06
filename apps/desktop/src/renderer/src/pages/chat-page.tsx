import { useEffect, useMemo, useState } from "react";
import { Bot, Hash, Sparkles } from "lucide-react";
import type { AttachmentAssetRecord } from "@shared";
import { useAppStore } from "../store/use-app-store";
import { createTranslator } from "../i18n";
import { ChatConversationList } from "../components/chat/chat-conversation-list";
import { ChatComposer } from "../components/chat/chat-composer";
import { ChatMessageThread } from "../components/chat/chat-message-thread";
import { ChatRunDetails } from "../components/chat/chat-run-details";
import { getLatestActiveRun } from "../components/chat/chat-utils";

export function ChatPage() {
  const {
    conversations,
    messages,
    runs,
    attachments,
    artifacts,
    toolInvocations,
    runSteps,
    sendInput,
    controlRun,
    settings,
  } = useAppStore();
  const t = createTranslator(settings.language);

  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [internalVisible, setInternalVisible] = useState<Record<string, boolean>>({});

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
      (conversation) =>
        query.length === 0 ||
        conversation.title.toLowerCase().includes(query) ||
        conversation.lastMessage.toLowerCase().includes(query),
    );
  }, [conversations, search]);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const activeMessages = activeConversation ? messages[activeConversation.id] ?? [] : [];
  const activeRun = activeConversation ? getLatestActiveRun(runs, activeConversation.id) : null;
  const latestConversationRun = useMemo(() => {
    if (!activeConversation) return null;
    return [...runs]
      .filter((run) => run.conversationId === activeConversation.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }, [activeConversation, runs]);
  const isTeamConversation = activeConversation?.kind === "team";
  const showInternal = activeConversation ? internalVisible[activeConversation.id] ?? false : false;
  const detailRun = activeRun ?? latestConversationRun;
  const detailRunId = detailRun?.id ?? null;

  const conversationRunSteps = useMemo(() => {
    if (!activeConversation || !detailRunId) return [];
    return runSteps.filter((step) => step.conversationId === activeConversation.id && step.runId === detailRunId);
  }, [activeConversation, detailRunId, runSteps]);

  const conversationArtifacts = useMemo(() => {
    if (!activeConversation) return [];
    return artifacts.filter(
      (artifact) =>
        artifact.conversationId === activeConversation.id &&
        (!detailRunId || artifact.runId === detailRunId),
    );
  }, [activeConversation, artifacts, detailRunId]);

  const conversationAttachments = useMemo(() => {
    if (!activeConversation) return [];
    return attachments.filter((attachment) => attachment.conversationId === activeConversation.id);
  }, [activeConversation, attachments]);

  const conversationToolInvocations = useMemo(() => {
    if (!activeConversation) return [];
    return toolInvocations.filter(
      (invocation) =>
        invocation.conversationId === activeConversation.id &&
        (!detailRunId || invocation.runId === detailRunId),
    );
  }, [activeConversation, detailRunId, toolInvocations]);

  const handleSend = async (payload: { input: string; attachments: AttachmentAssetRecord[] }) => {
    if (!activeConversation) return;
    await sendInput({
      conversationId: activeConversation.id,
      input: payload.input,
      attachments: payload.attachments,
    });
  };

  const handlePause = async () => {
    if (!activeConversation) return;
    await controlRun({ conversationId: activeConversation.id, action: "pause" });
  };

  const handleResume = async () => {
    if (!activeConversation) return;
    await controlRun({ conversationId: activeConversation.id, action: "resume" });
  };

  const handleCancel = async () => {
    if (!activeConversation) return;
    await controlRun({ conversationId: activeConversation.id, action: "cancel" });
  };

  return (
    <div className="flex h-full min-h-0 bg-[var(--background)]">
      <aside className="w-[300px] shrink-0 border-r border-[var(--border)] bg-[var(--card)]">
        <div className="h-full min-h-0">
          <ChatConversationList
            conversations={filteredConversations}
            activeConversationId={activeConversationId}
            onSelectConversation={setActiveConversationId}
            search={search}
            onSearchChange={setSearch}
          />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {activeConversation ? (
          <>
            <div className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    activeConversation.kind === "agent"
                      ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)]"
                      : "bg-[color-mix(in_srgb,#06b6d4_12%,transparent)] text-[#06b6d4]"
                  }`}
                >
                  {activeConversation.kind === "agent" ? (
                    <Bot className="h-4 w-4" />
                  ) : (
                    <Hash className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                    {activeConversation.title}
                  </p>
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
                ) : (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-600">
                    {t.chat("online")}
                  </span>
                )}

                <span className="rounded-full bg-[var(--muted)] px-3 py-1.5 text-[11px] text-[var(--muted-foreground)]">
                  {settings.activeProviderId === "openai" ? t.chat("providerOpenAI") : t.chat("providerQwen")}
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatMessageThread
                messages={activeMessages}
                run={activeRun}
                showInternalMessages={showInternal}
              />
            </div>

            <div className="border-t border-[var(--border)] bg-[var(--card)] px-5 pb-4 pt-3">
              <ChatRunDetails
                run={detailRun}
                runSteps={conversationRunSteps}
                artifacts={conversationArtifacts}
                attachments={conversationAttachments}
                toolInvocations={conversationToolInvocations}
              />

              {activeRun ? (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button className="button-secondary !px-4 !py-2 text-sm" onClick={handlePause}>
                    {t.chat("pause")}
                  </button>
                  <button className="button-secondary !px-4 !py-2 text-sm" onClick={handleResume}>
                    {t.chat("resume")}
                  </button>
                  <button className="button-secondary !px-4 !py-2 text-sm" onClick={handleCancel}>
                    {t.chat("cancel")}
                  </button>
                </div>
              ) : null}

              <ChatComposer
                conversationId={activeConversation.id}
                onSend={handleSend}
              />
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
    </div>
  );
}
