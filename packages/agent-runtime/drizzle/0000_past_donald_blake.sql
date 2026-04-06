CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`run_id` text,
	`artifact_kind` text NOT NULL,
	`title` text NOT NULL,
	`path` text NOT NULL,
	`workspace_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_conversation_created_at` ON `artifacts` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_run_id` ON `artifacts` (`run_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`run_id` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_conversation_created_at` ON `attachments` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_attachments_message_id` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_attachments_run_id` ON `attachments` (`run_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text,
	`target_id` text,
	`title` text,
	`unread` integer DEFAULT 0 NOT NULL,
	`last_message` text,
	`last_activity_at` integer NOT NULL,
	`active_skill` text,
	`pinned_mcp` text,
	`show_internal_messages` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_last_activity_at` ON `conversations` (`last_activity_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_target` ON `conversations` (`kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_connections` (
	`server_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sender_id` text,
	`sender_name` text,
	`sender_kind` text,
	`message_type` text,
	`visibility` text,
	`content` text,
	`mentions_json` text,
	`created_at` integer NOT NULL,
	`run_id` text,
	`has_attachments` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_created_at` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_messages_run_id` ON `messages` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_sender_kind` ON `messages` (`sender_kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`error_text` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_run_steps_run_id` ON `run_steps` (`run_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`title` text,
	`kind` text,
	`status` text,
	`actor_id` text,
	`step_index` integer DEFAULT 0 NOT NULL,
	`total_steps` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer NOT NULL,
	`last_error` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_runs_conversation_updated_at` ON `runs` (`conversation_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_status` ON `runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `settings_entries` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skill_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`run_id` text,
	`server_id` text NOT NULL,
	`server_name` text NOT NULL,
	`tool_name` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`output_text` text,
	`error_text` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tool_invocations_run_id` ON `tool_invocations` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tool_invocations_server_tool` ON `tool_invocations` (`server_id`,`tool_name`,`created_at`);