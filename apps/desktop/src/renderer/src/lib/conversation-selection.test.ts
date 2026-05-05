import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveNextConversationSelection } from "./conversation-selection.ts";

describe("resolveNextConversationSelection", () => {
  it("keeps the current conversation when another conversation updates and moves first", () => {
    const next = resolveNextConversationSelection({
      activeConversationId: "designer",
      conversationIds: ["coder", "designer", "nova"],
      handledRequestedConversationId: null,
      initialSelectionDone: true,
      requestedConversationId: "",
    });

    assert.equal(next, null);
  });

  it("honors an explicit route request once", () => {
    const first = resolveNextConversationSelection({
      activeConversationId: "designer",
      conversationIds: ["coder", "designer"],
      handledRequestedConversationId: null,
      initialSelectionDone: true,
      requestedConversationId: "coder",
    });

    assert.deepEqual(first, { conversationId: "coder", reason: "route-request" });

    const second = resolveNextConversationSelection({
      activeConversationId: "designer",
      conversationIds: ["coder", "designer"],
      handledRequestedConversationId: "coder",
      initialSelectionDone: true,
      requestedConversationId: "coder",
    });

    assert.equal(second, null);
  });

  it("selects the first conversation only for the first empty selection", () => {
    const first = resolveNextConversationSelection({
      activeConversationId: "",
      conversationIds: ["coder", "designer"],
      handledRequestedConversationId: null,
      initialSelectionDone: false,
      requestedConversationId: "",
    });

    assert.deepEqual(first, { conversationId: "coder", reason: "initial" });

    const later = resolveNextConversationSelection({
      activeConversationId: "",
      conversationIds: ["designer", "coder"],
      handledRequestedConversationId: null,
      initialSelectionDone: true,
      requestedConversationId: "",
    });

    assert.equal(later, null);
  });

  it("falls back only when the active conversation disappears", () => {
    const next = resolveNextConversationSelection({
      activeConversationId: "deleted",
      conversationIds: ["coder", "designer"],
      handledRequestedConversationId: null,
      initialSelectionDone: true,
      requestedConversationId: "",
    });

    assert.deepEqual(next, { conversationId: "coder", reason: "missing-active" });
  });
});
