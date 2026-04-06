import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const settingsEntries = sqliteTable("settings_entries", {
  key: text("key").primaryKey().notNull(),
  value: text("value").notNull(),
});

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey().notNull(),
  payload: text("payload").notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey().notNull(),
  payload: text("payload").notNull(),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey().notNull(),
  payload: text("payload").notNull(),
});

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey().notNull(),
    kind: text("kind"),
    targetId: text("target_id"),
    title: text("title"),
    unread: integer("unread").default(0).notNull(),
    lastMessage: text("last_message"),
    lastActivityAt: integer("last_activity_at").notNull(),
    activeSkill: text("active_skill"),
    pinnedMcp: text("pinned_mcp"),
    showInternalMessages: integer("show_internal_messages").default(0).notNull(),
    payload: text("payload").notNull(),
  },
  (table) => ({
    lastActivityIdx: index("idx_conversations_last_activity_at").on(table.lastActivityAt),
    targetIdx: index("idx_conversations_target").on(table.kind, table.targetId),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey().notNull(),
    conversationId: text("conversation_id").notNull(),
    senderId: text("sender_id"),
    senderName: text("sender_name"),
    senderKind: text("sender_kind"),
    messageType: text("message_type"),
    visibility: text("visibility"),
    content: text("content"),
    mentionsJson: text("mentions_json"),
    createdAt: integer("created_at").notNull(),
    runId: text("run_id"),
    hasAttachments: integer("has_attachments").default(0).notNull(),
    payload: text("payload").notNull(),
  },
  (table) => ({
    conversationCreatedIdx: index("idx_messages_conversation_created_at").on(
      table.conversationId,
      table.createdAt,
    ),
    runIdx: index("idx_messages_run_id").on(table.runId),
    senderKindIdx: index("idx_messages_sender_kind").on(table.senderKind, table.createdAt),
  }),
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey().notNull(),
    conversationId: text("conversation_id").notNull(),
    title: text("title"),
    kind: text("kind"),
    status: text("status"),
    actorId: text("actor_id"),
    stepIndex: integer("step_index").default(0).notNull(),
    totalSteps: integer("total_steps").default(0).notNull(),
    createdAt: integer("created_at"),
    updatedAt: integer("updated_at").notNull(),
    lastError: text("last_error"),
    payload: text("payload").notNull(),
  },
  (table) => ({
    conversationUpdatedIdx: index("idx_runs_conversation_updated_at").on(
      table.conversationId,
      table.updatedAt,
    ),
    statusIdx: index("idx_runs_status").on(table.status, table.updatedAt),
  }),
);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey().notNull(),
  createdAt: integer("created_at").notNull(),
  payload: text("payload").notNull(),
});

export const extensions = sqliteTable("extensions", {
  id: text("id").primaryKey().notNull(),
  payload: text("payload").notNull(),
});

export const skillCatalog = sqliteTable("skill_catalog", {
  id: text("id").primaryKey().notNull(),
  payload: text("payload").notNull(),
});

export const mcpCatalog = sqliteTable("mcp_catalog", {
  id: text("id").primaryKey().notNull(),
  payload: text("payload").notNull(),
});

export const mcpConnections = sqliteTable("mcp_connections", {
  serverId: text("server_id").primaryKey().notNull(),
  payload: text("payload").notNull(),
});

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey().notNull(),
    conversationId: text("conversation_id").notNull(),
    messageId: text("message_id"),
    runId: text("run_id"),
    name: text("name").notNull(),
    path: text("path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: integer("created_at").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => ({
    conversationCreatedIdx: index("idx_attachments_conversation_created_at").on(
      table.conversationId,
      table.createdAt,
    ),
    messageIdx: index("idx_attachments_message_id").on(table.messageId),
    runIdx: index("idx_attachments_run_id").on(table.runId),
  }),
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey().notNull(),
    conversationId: text("conversation_id").notNull(),
    runId: text("run_id"),
    artifactKind: text("artifact_kind").notNull(),
    title: text("title").notNull(),
    path: text("path").notNull(),
    workspacePath: text("workspace_path").notNull(),
    createdAt: integer("created_at").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => ({
    conversationCreatedIdx: index("idx_artifacts_conversation_created_at").on(
      table.conversationId,
      table.createdAt,
    ),
    runIdx: index("idx_artifacts_run_id").on(table.runId),
  }),
);

export const toolInvocations = sqliteTable(
  "tool_invocations",
  {
    id: text("id").primaryKey().notNull(),
    conversationId: text("conversation_id").notNull(),
    runId: text("run_id"),
    serverId: text("server_id").notNull(),
    serverName: text("server_name").notNull(),
    toolName: text("tool_name").notNull(),
    status: text("status").notNull(),
    inputJson: text("input_json").notNull(),
    outputText: text("output_text"),
    errorText: text("error_text"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
    payload: text("payload").notNull(),
  },
  (table) => ({
    runIdx: index("idx_tool_invocations_run_id").on(table.runId, table.createdAt),
    serverToolIdx: index("idx_tool_invocations_server_tool").on(
      table.serverId,
      table.toolName,
      table.createdAt,
    ),
  }),
);

export const runSteps = sqliteTable(
  "run_steps",
  {
    id: text("id").primaryKey().notNull(),
    runId: text("run_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    stepIndex: integer("step_index").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    errorText: text("error_text"),
    payload: text("payload").notNull(),
  },
  (table) => ({
    runIdx: index("idx_run_steps_run_id").on(table.runId, table.stepIndex),
  }),
);
