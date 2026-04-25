ALTER TABLE `agents` ADD `name` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `role` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `status` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `workspace_path` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `avatar_path` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `model_id` text;--> statement-breakpoint
CREATE INDEX `idx_agents_name` ON `agents` (`name`);--> statement-breakpoint
CREATE INDEX `idx_agents_status` ON `agents` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agents_workspace_path` ON `agents` (`workspace_path`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `type` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `title` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `body` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `read` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `related_conversation_id` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `related_run_id` text;--> statement-breakpoint
CREATE INDEX `idx_notifications_read_created_at` ON `notifications` (`read`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_related_run` ON `notifications` (`related_run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_related_conversation` ON `notifications` (`related_conversation_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `providers` ADD `label` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `base_url` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `default_model` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `supports_tool_calling` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `supports_streaming` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `is_active` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_providers_active` ON `providers` (`is_active`);--> statement-breakpoint
ALTER TABLE `runs` ADD `artifact_path` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `transcript_path` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `workspace_transcript_path` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `memory_path` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `name` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `workspace_path` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `avatar_path` text;--> statement-breakpoint
CREATE INDEX `idx_teams_name` ON `teams` (`name`);--> statement-breakpoint
CREATE INDEX `idx_teams_workspace_path` ON `teams` (`workspace_path`);
