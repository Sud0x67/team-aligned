import type { AppLanguage, AppSnapshot, ConversationKind, MessageRecord, RunRecord } from "@shared";
import type { TeamContext } from "@shared";

export function getConversationKindLabel(kind: ConversationKind, language: AppLanguage = "en") {
  if (kind === "agent") {
    return language === "en" ? "Direct chat" : "单聊";
  }
  return language === "en" ? "Team chat" : "群聊";
}

export function getLatestActiveRun(runs: RunRecord[], conversationId: string) {
  return [...runs]
    .filter(
      (run) =>
        run.conversationId === conversationId &&
        ["queued", "running", "pausing", "resuming"].includes(run.status),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

export function getTeamContextSummary(teamContext: TeamContext) {
  return [
    teamContext.phase,
    teamContext.activeTasks[0] ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function getConversationVisibleMessages(
  messages: MessageRecord[],
  showInternalMessages: boolean,
) {
  return messages.filter((message) => {
    if (message.visibility === "system") return false;
    if (message.visibility === "public") return true;
    return showInternalMessages;
  });
}

export function buildActiveConversationLabel(snapshot: AppSnapshot, language: AppLanguage = "en") {
  return snapshot.conversations.length > 0
    ? snapshot.conversations[0].title
    : language === "en"
      ? "Conversation"
      : "对话";
}
