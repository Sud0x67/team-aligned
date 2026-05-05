export type ConversationSelectionReason = "initial" | "missing-active" | "route-request";

export type ConversationSelectionResult = {
  conversationId: string;
  reason: ConversationSelectionReason;
};

export type ConversationSelectionInput = {
  activeConversationId: string;
  conversationIds: string[];
  handledRequestedConversationId: string | null;
  initialSelectionDone: boolean;
  requestedConversationId: string;
};

export function resolveNextConversationSelection({
  activeConversationId,
  conversationIds,
  handledRequestedConversationId,
  initialSelectionDone,
  requestedConversationId,
}: ConversationSelectionInput): ConversationSelectionResult | null {
  const requestedId = requestedConversationId.trim();

  if (
    requestedId &&
    requestedId !== handledRequestedConversationId &&
    conversationIds.includes(requestedId)
  ) {
    return { conversationId: requestedId, reason: "route-request" };
  }

  if (activeConversationId) {
    if (conversationIds.includes(activeConversationId)) {
      return null;
    }
    return { conversationId: conversationIds[0] ?? "", reason: "missing-active" };
  }

  if (conversationIds.length > 0 && !initialSelectionDone && !requestedId) {
    return { conversationId: conversationIds[0], reason: "initial" };
  }

  return null;
}
