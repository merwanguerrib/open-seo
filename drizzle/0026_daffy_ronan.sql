CREATE TABLE `audit_page_links` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`from_page_id` text NOT NULL,
	`to_url` text NOT NULL,
	`to_page_id` text,
	`anchor_text` text,
	`is_broken` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_page_id`) REFERENCES `audit_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_page_id`) REFERENCES `audit_pages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_page_links_audit_id_idx` ON `audit_page_links` (`audit_id`);--> statement-breakpoint
CREATE INDEX `audit_page_links_from_page_id_idx` ON `audit_page_links` (`from_page_id`);--> statement-breakpoint
CREATE INDEX `audit_page_links_to_page_id_idx` ON `audit_page_links` (`to_page_id`);--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `content_r2_key` text;