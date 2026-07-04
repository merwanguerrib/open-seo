import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";

// ============================================================================
// Content tables — SEO article generation (phase 1) and the headless API.
// See docs/superpowers/specs/2026-07-04-content-articles-design.md
// ============================================================================

// One row per generated article. Created as `queued` before the
// ArticleGenerationWorkflow starts; the workflow moves it to `generating`
// then `draft` (or `failed`). `draft ↔ published` is a user action.
export const contentArticles = sqliteTable(
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
      enum: ["queued", "generating", "draft", "published", "failed"],
    })
      .notNull()
      .default("queued"),
    slug: text("slug").notNull(),
    title: text("title"),
    metaDescription: text("meta_description"),
    // E-E-A-T byline, editable in the editor.
    author: text("author"),
    // Full article body (markdown).
    markdown: text("markdown"),
    // JSON: { intent, angle, outline, entities, questions, usage }
    brief: text("brief"),
    // JSON: [{ question, answer }] — FAQ section + FAQPage JSON-LD.
    faq: text("faq"),
    // JSON: SERP URLs used for grounding.
    sourceUrls: text("source_urls"),
    workflowRunId: text("workflow_run_id"),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    publishedAt: text("published_at"),
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
  ],
);

// Bearer keys for the public headless content API. Only the SHA-256 hash is
// stored; the plaintext key is shown once at creation.
export const contentApiKeys = sqliteTable(
  "content_api_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    label: text("label").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("content_api_keys_key_hash_idx").on(table.keyHash),
    index("content_api_keys_project_idx").on(table.projectId),
  ],
);
