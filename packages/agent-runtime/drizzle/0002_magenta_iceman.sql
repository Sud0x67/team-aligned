CREATE TABLE `prompt_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`alias` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prompt_aliases_alias` ON `prompt_aliases` (`alias`);--> statement-breakpoint
CREATE INDEX `idx_prompt_aliases_enabled` ON `prompt_aliases` (`enabled`,`updated_at`);