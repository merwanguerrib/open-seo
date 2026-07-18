CREATE TABLE `content_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`content_keyword_id` text,
	`url` text NOT NULL,
	`content_type` text NOT NULL,
	`state` text DEFAULT 'planned' NOT NULL,
	`source` text NOT NULL,
	`title` text,
	`meta_description` text,
	`status_code` integer,
	`word_count` integer,
	`h1_count` integer,
	`internal_link_count` integer,
	`crawl_depth` integer,
	`has_structured_data` integer,
	`is_indexable` integer,
	`last_analyzed_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_keyword_id`) REFERENCES `content_keywords`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_assets_project_url_idx` ON `content_assets` (`project_id`,`url`);--> statement-breakpoint
CREATE INDEX `content_assets_project_type_idx` ON `content_assets` (`project_id`,`content_type`);--> statement-breakpoint
CREATE INDEX `content_assets_keyword_idx` ON `content_assets` (`content_keyword_id`);--> statement-breakpoint
CREATE TABLE `content_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_documents_project_kind_name_idx` ON `content_documents` (`project_id`,`kind`,`name`);--> statement-breakpoint
CREATE INDEX `content_documents_project_idx` ON `content_documents` (`project_id`);--> statement-breakpoint
CREATE TABLE `content_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`keyword` text NOT NULL,
	`normalized_keyword` text NOT NULL,
	`source` text NOT NULL,
	`source_name` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`role` text DEFAULT 'standalone' NOT NULL,
	`cluster_name` text,
	`target_url` text,
	`title` text,
	`intent` text,
	`priority` text,
	`search_volume` integer,
	`difficulty` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_keywords_project_normalized_idx` ON `content_keywords` (`project_id`,`normalized_keyword`);--> statement-breakpoint
CREATE INDEX `content_keywords_project_status_idx` ON `content_keywords` (`project_id`,`status`);--> statement-breakpoint
ALTER TABLE `content_topics` ADD `content_keyword_id` text REFERENCES content_keywords(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `content_topics_keyword_source_idx` ON `content_topics` (`content_keyword_id`);
