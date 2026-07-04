CREATE TABLE `content_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_api_keys_key_hash_idx` ON `content_api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `content_api_keys_project_idx` ON `content_api_keys` (`project_id`);--> statement-breakpoint
CREATE TABLE `content_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`keyword` text NOT NULL,
	`location_code` integer DEFAULT 2840 NOT NULL,
	`language_code` text DEFAULT 'en' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`slug` text NOT NULL,
	`title` text,
	`meta_description` text,
	`author` text,
	`markdown` text,
	`brief` text,
	`faq` text,
	`source_urls` text,
	`workflow_run_id` text,
	`error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`published_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_articles_project_slug_idx` ON `content_articles` (`project_id`,`slug`);--> statement-breakpoint
CREATE INDEX `content_articles_project_status_idx` ON `content_articles` (`project_id`,`status`);