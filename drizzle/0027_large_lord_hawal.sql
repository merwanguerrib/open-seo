CREATE TABLE `content_article_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`date` text NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`ctr` real DEFAULT 0 NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `content_articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_article_metrics_article_date_idx` ON `content_article_metrics` (`article_id`,`date`);--> statement-breakpoint
CREATE TABLE `content_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`pillar_article_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_clusters_project_idx` ON `content_clusters` (`project_id`);--> statement-breakpoint
CREATE TABLE `content_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`cadence_per_week` integer DEFAULT 3 NOT NULL,
	`review_window_hours` integer DEFAULT 72 NOT NULL,
	`auto_publish` integer DEFAULT true NOT NULL,
	`min_search_volume` integer DEFAULT 50 NOT NULL,
	`max_difficulty` integer DEFAULT 40 NOT NULL,
	`blog_url_pattern` text,
	`last_planned_at` text,
	`next_run_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_plans_project_idx` ON `content_plans` (`project_id`);--> statement-breakpoint
CREATE INDEX `content_plans_next_run_idx` ON `content_plans` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `content_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cluster_id` text,
	`keyword` text NOT NULL,
	`source` text NOT NULL,
	`role` text DEFAULT 'satellite' NOT NULL,
	`search_volume` integer,
	`difficulty` integer,
	`status` text DEFAULT 'suggested' NOT NULL,
	`scheduled_for` text,
	`article_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_topics_project_status_idx` ON `content_topics` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `content_topics_scheduled_idx` ON `content_topics` (`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_topics_project_keyword_idx` ON `content_topics` (`project_id`,`keyword`);--> statement-breakpoint
ALTER TABLE `content_articles` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_articles` ADD `cluster_id` text;--> statement-breakpoint
ALTER TABLE `content_articles` ADD `auto_publish_at` text;--> statement-breakpoint
ALTER TABLE `content_articles` ADD `live_url` text;--> statement-breakpoint
ALTER TABLE `content_articles` ADD `last_repaired_at` text;--> statement-breakpoint
CREATE INDEX `content_articles_auto_publish_idx` ON `content_articles` (`auto_publish_at`);--> statement-breakpoint
CREATE INDEX `content_articles_cluster_idx` ON `content_articles` (`cluster_id`);