import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const timestampColumn = (name: string) => text(name);

export const contentArticles = pgTable(
  "content_articles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull().default(2840),
    languageCode: text("language_code").notNull().default("en"),
    status: text("status", {
      enum: [
        "queued",
        "generating",
        "draft",
        "published",
        "failed",
        "archived",
      ],
    })
      .notNull()
      .default("queued"),
    slug: text("slug").notNull(),
    title: text("title"),
    metaDescription: text("meta_description"),
    author: text("author"),
    markdown: text("markdown"),
    brief: text("brief"),
    faq: text("faq"),
    sourceUrls: text("source_urls"),
    workflowRunId: text("workflow_run_id"),
    error: text("error"),
    source: text("source", { enum: ["manual", "autopilot"] })
      .notNull()
      .default("manual"),
    clusterId: text("cluster_id"),
    autoPublishAt: timestampColumn("auto_publish_at"),
    liveUrl: text("live_url"),
    lastRepairedAt: timestampColumn("last_repaired_at"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
    publishedAt: timestampColumn("published_at"),
  },
  (table) => [
    uniqueIndex("content_articles_project_slug_idx").on(
      table.projectId,
      table.slug,
    ),
    index("content_articles_project_status_idx").on(
      table.projectId,
      table.status,
    ),
    index("content_articles_auto_publish_idx").on(table.autoPublishAt),
    index("content_articles_cluster_idx").on(table.clusterId),
  ],
);

export const contentPlans = pgTable(
  "content_plans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    cadencePerWeek: integer("cadence_per_week").notNull().default(3),
    reviewWindowHours: integer("review_window_hours").notNull().default(72),
    autoPublish: boolean("auto_publish").notNull().default(true),
    minSearchVolume: integer("min_search_volume").notNull().default(50),
    maxDifficulty: integer("max_difficulty").notNull().default(40),
    blogUrlPattern: text("blog_url_pattern"),
    lastPlannedAt: timestampColumn("last_planned_at"),
    nextRunAt: timestampColumn("next_run_at"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("content_plans_project_idx").on(table.projectId),
    index("content_plans_next_run_idx").on(table.enabled, table.nextRunAt),
  ],
);

export const contentDocuments = pgTable(
  "content_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "master_plan",
        "editorial_guidelines",
        "agent_instructions",
        "quality_rubric",
        "reference",
      ],
    }).notNull(),
    name: text("name").notNull(),
    format: text("format", { enum: ["markdown", "json", "text"] }).notNull(),
    content: text("content").notNull(),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("content_documents_project_kind_name_idx").on(
      table.projectId,
      table.kind,
      table.name,
    ),
    index("content_documents_project_idx").on(table.projectId),
  ],
);

export const contentKeywords = pgTable(
  "content_keywords",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    normalizedKeyword: text("normalized_keyword").notNull(),
    source: text("source", {
      enum: ["manual", "file", "master_plan", "competitor", "related"],
    }).notNull(),
    sourceName: text("source_name"),
    status: text("status", {
      enum: ["planned", "covered", "ignored", "suggested"],
    })
      .notNull()
      .default("planned"),
    role: text("role", {
      enum: ["pillar", "satellite", "standalone"],
    })
      .notNull()
      .default("standalone"),
    clusterName: text("cluster_name"),
    targetUrl: text("target_url"),
    title: text("title"),
    intent: text("intent"),
    priority: text("priority"),
    searchVolume: integer("search_volume"),
    difficulty: integer("difficulty"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("content_keywords_project_normalized_idx").on(
      table.projectId,
      table.normalizedKeyword,
    ),
    index("content_keywords_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);

export const contentAssets = pgTable(
  "content_assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contentKeywordId: text("content_keyword_id").references(
      () => contentKeywords.id,
      { onDelete: "set null" },
    ),
    url: text("url").notNull(),
    contentType: text("content_type", {
      enum: ["blog", "pillar", "product", "other"],
    }).notNull(),
    state: text("state", { enum: ["planned", "existing"] })
      .notNull()
      .default("planned"),
    source: text("source", {
      enum: ["audit", "manual", "master_plan"],
    }).notNull(),
    title: text("title"),
    metaDescription: text("meta_description"),
    statusCode: integer("status_code"),
    wordCount: integer("word_count"),
    h1Count: integer("h1_count"),
    internalLinkCount: integer("internal_link_count"),
    crawlDepth: integer("crawl_depth"),
    hasStructuredData: boolean("has_structured_data"),
    isIndexable: boolean("is_indexable"),
    lastAnalyzedAt: timestampColumn("last_analyzed_at"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("content_assets_project_url_idx").on(
      table.projectId,
      table.url,
    ),
    index("content_assets_project_type_idx").on(
      table.projectId,
      table.contentType,
    ),
    index("content_assets_keyword_idx").on(table.contentKeywordId),
  ],
);

export const contentClusters = pgTable(
  "content_clusters",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pillarArticleId: text("pillar_article_id"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
  },
  (table) => [index("content_clusters_project_idx").on(table.projectId)],
);

export const contentTopics = pgTable(
  "content_topics",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id"),
    contentKeywordId: text("content_keyword_id").references(
      () => contentKeywords.id,
      { onDelete: "set null" },
    ),
    keyword: text("keyword").notNull(),
    source: text("source", {
      enum: ["gsc", "expansion", "keyword", "master_plan"],
    }).notNull(),
    role: text("role", { enum: ["pillar", "satellite"] })
      .notNull()
      .default("satellite"),
    searchVolume: integer("search_volume"),
    difficulty: integer("difficulty"),
    status: text("status", {
      enum: ["suggested", "scheduled", "generating", "generated", "dismissed"],
    })
      .notNull()
      .default("suggested"),
    scheduledFor: text("scheduled_for"),
    articleId: text("article_id"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    index("content_topics_project_status_idx").on(
      table.projectId,
      table.status,
    ),
    index("content_topics_scheduled_idx").on(table.scheduledFor),
    index("content_topics_keyword_source_idx").on(table.contentKeywordId),
    uniqueIndex("content_topics_project_keyword_idx").on(
      table.projectId,
      table.keyword,
    ),
  ],
);

export const contentArticleMetrics = pgTable(
  "content_article_metrics",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => contentArticles.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr: real("ctr").notNull().default(0),
    position: real("position").notNull().default(0),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("content_article_metrics_article_date_idx").on(
      table.articleId,
      table.date,
    ),
  ],
);

export const contentApiKeys = pgTable(
  "content_api_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    label: text("label").notNull(),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    lastUsedAt: timestampColumn("last_used_at"),
    revokedAt: timestampColumn("revoked_at"),
  },
  (table) => [
    uniqueIndex("content_api_keys_key_hash_idx").on(table.keyHash),
    index("content_api_keys_project_idx").on(table.projectId),
  ],
);
