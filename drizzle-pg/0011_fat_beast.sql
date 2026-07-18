CREATE TABLE "content_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"last_used_at" text,
	"revoked_at" text
);
--> statement-breakpoint
CREATE TABLE "content_article_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"date" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" real DEFAULT 0 NOT NULL,
	"position" real DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer DEFAULT 2840 NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"slug" text NOT NULL,
	"title" text,
	"meta_description" text,
	"author" text,
	"markdown" text,
	"brief" text,
	"faq" text,
	"source_urls" text,
	"workflow_run_id" text,
	"error" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"cluster_id" text,
	"auto_publish_at" text,
	"live_url" text,
	"last_repaired_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"published_at" text
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"content_keyword_id" text,
	"url" text NOT NULL,
	"content_type" text NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"source" text NOT NULL,
	"title" text,
	"meta_description" text,
	"status_code" integer,
	"word_count" integer,
	"h1_count" integer,
	"internal_link_count" integer,
	"crawl_depth" integer,
	"has_structured_data" boolean,
	"is_indexable" boolean,
	"last_analyzed_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"pillar_article_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"content" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"keyword" text NOT NULL,
	"normalized_keyword" text NOT NULL,
	"source" text NOT NULL,
	"source_name" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"role" text DEFAULT 'standalone' NOT NULL,
	"cluster_name" text,
	"target_url" text,
	"title" text,
	"intent" text,
	"priority" text,
	"search_volume" integer,
	"difficulty" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"cadence_per_week" integer DEFAULT 3 NOT NULL,
	"review_window_hours" integer DEFAULT 72 NOT NULL,
	"auto_publish" boolean DEFAULT true NOT NULL,
	"min_search_volume" integer DEFAULT 50 NOT NULL,
	"max_difficulty" integer DEFAULT 40 NOT NULL,
	"blog_url_pattern" text,
	"last_planned_at" text,
	"next_run_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cluster_id" text,
	"content_keyword_id" text,
	"keyword" text NOT NULL,
	"source" text NOT NULL,
	"role" text DEFAULT 'satellite' NOT NULL,
	"search_volume" integer,
	"difficulty" integer,
	"status" text DEFAULT 'suggested' NOT NULL,
	"scheduled_for" text,
	"article_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_api_keys" ADD CONSTRAINT "content_api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_article_metrics" ADD CONSTRAINT "content_article_metrics_article_id_content_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."content_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_articles" ADD CONSTRAINT "content_articles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_content_keyword_id_content_keywords_id_fk" FOREIGN KEY ("content_keyword_id") REFERENCES "public"."content_keywords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_clusters" ADD CONSTRAINT "content_clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_keywords" ADD CONSTRAINT "content_keywords_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_topics" ADD CONSTRAINT "content_topics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_topics" ADD CONSTRAINT "content_topics_content_keyword_id_content_keywords_id_fk" FOREIGN KEY ("content_keyword_id") REFERENCES "public"."content_keywords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_api_keys_key_hash_idx" ON "content_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "content_api_keys_project_idx" ON "content_api_keys" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_article_metrics_article_date_idx" ON "content_article_metrics" USING btree ("article_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "content_articles_project_slug_idx" ON "content_articles" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "content_articles_project_status_idx" ON "content_articles" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "content_articles_auto_publish_idx" ON "content_articles" USING btree ("auto_publish_at");--> statement-breakpoint
CREATE INDEX "content_articles_cluster_idx" ON "content_articles" USING btree ("cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_assets_project_url_idx" ON "content_assets" USING btree ("project_id","url");--> statement-breakpoint
CREATE INDEX "content_assets_project_type_idx" ON "content_assets" USING btree ("project_id","content_type");--> statement-breakpoint
CREATE INDEX "content_assets_keyword_idx" ON "content_assets" USING btree ("content_keyword_id");--> statement-breakpoint
CREATE INDEX "content_clusters_project_idx" ON "content_clusters" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_documents_project_kind_name_idx" ON "content_documents" USING btree ("project_id","kind","name");--> statement-breakpoint
CREATE INDEX "content_documents_project_idx" ON "content_documents" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_keywords_project_normalized_idx" ON "content_keywords" USING btree ("project_id","normalized_keyword");--> statement-breakpoint
CREATE INDEX "content_keywords_project_status_idx" ON "content_keywords" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "content_plans_project_idx" ON "content_plans" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "content_plans_next_run_idx" ON "content_plans" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "content_topics_project_status_idx" ON "content_topics" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "content_topics_scheduled_idx" ON "content_topics" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "content_topics_keyword_source_idx" ON "content_topics" USING btree ("content_keyword_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_topics_project_keyword_idx" ON "content_topics" USING btree ("project_id","keyword");