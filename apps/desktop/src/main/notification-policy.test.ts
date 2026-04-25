import test from "node:test";
import assert from "node:assert/strict";
import type { AppSettings, NotificationRecord } from "@teamaligned/shared";
import { evaluateNotificationDispatch } from "./notification-policy.ts";

const settings: AppSettings = {
  theme: "light",
  language: "zh",
  notifyAgentComplete: true,
  notifyMention: true,
  notifyGroup: true,
  activeProviderId: "qwen",
  onboardingCompleted: true,
};

function makeNotification(): NotificationRecord {
  return {
    id: "n1",
    type: "agent_message",
    title: "Agent 有新消息",
    body: "请查看最新回复",
    read: false,
    createdAt: Date.now(),
    relatedConversationId: "conv-1",
    relatedRunId: "run-1",
  };
}

test("allows system notification only when background + enabled + supported", () => {
  const decision = evaluateNotificationDispatch({
    channel: "agent_message",
    notification: makeNotification(),
    settings,
    isNotificationSupported: true,
    windowVisible: false,
  });
  assert.deepEqual(decision, { allowed: true, reason: "allowed" });
});

test("blocks system notification when app is foreground", () => {
  const decision = evaluateNotificationDispatch({
    channel: "group_message",
    notification: makeNotification(),
    settings,
    isNotificationSupported: true,
    windowVisible: true,
  });
  assert.deepEqual(decision, { allowed: false, reason: "foreground" });
});

test("blocks system notification when channel setting is disabled", () => {
  const decision = evaluateNotificationDispatch({
    channel: "mention",
    notification: makeNotification(),
    settings: { ...settings, notifyMention: false },
    isNotificationSupported: true,
    windowVisible: false,
  });
  assert.deepEqual(decision, { allowed: false, reason: "disabled_setting" });
});

test("blocks system notification when missing related conversation id", () => {
  const notification = makeNotification();
  notification.relatedConversationId = null;
  const decision = evaluateNotificationDispatch({
    channel: "agent_message",
    notification,
    settings,
    isNotificationSupported: true,
    windowVisible: false,
  });
  assert.deepEqual(decision, { allowed: false, reason: "missing_conversation" });
});
