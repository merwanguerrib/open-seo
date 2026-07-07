CREATE TABLE `audit_page_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`page_id` text NOT NULL,
	`cluster_label` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `audit_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_page_clusters_audit_id_idx` ON `audit_page_clusters` (`audit_id`);