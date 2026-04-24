import type { AppSettings, NotificationRecord } from "@teamaligned/shared";

export type RuntimeNotificationChannel = "agent_message" | "mention" | "group_message" | null;

export type NotificationDispatchContext = {
  channel: RuntimeNotificationChannel;
  notification: NotificationRecord;
  settings: AppSettings;
  isNotificationSupported: boolean;
  windowVisible: boolean;
};

export type NotificationDispatchDecision = {
  allowed: boolean;
  reason:
    | "missing_channel"
    | "unsupported"
    | "missing_conversation"
    | "foreground"
    | "disabled_setting"
    | "allowed";
};

export function evaluateNotificationDispatch(
  input: NotificationDispatchContext,
): NotificationDispatchDecision {
  if (!input.channel) {
    return { allowed: false, reason: "missing_channel" };
  }

  if (!input.isNotificationSupported) {
    return { allowed: false, reason: "unsupported" };
  }

  if (!input.notification.relatedConversationId) {
    return { allowed: false, reason: "missing_conversation" };
  }

  if (input.windowVisible) {
    return { allowed: false, reason: "foreground" };
  }

  if (
    (input.channel === "agent_message" && !input.settings.notifyAgentComplete) ||
    (input.channel === "mention" && !input.settings.notifyMention) ||
    (input.channel === "group_message" && !input.settings.notifyGroup)
  ) {
    return { allowed: false, reason: "disabled_setting" };
  }

  return { allowed: true, reason: "allowed" };
}
