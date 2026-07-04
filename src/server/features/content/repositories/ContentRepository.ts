/**
 * Data access layer for content tables (content_articles, content_api_keys).
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentApiKeys, contentArticles } from "@/db/schema";

export type ContentArticleRow = typeof contentArticles.$inferSelect;
export type ContentApiKeyRow = typeof contentApiKeys.$inferSelect;

export type ContentArticleStatus = ContentArticleRow["status"];

const touchUpdatedAt = { updatedAt: sql`(current_timestamp)` };

async function createArticle(data: {
  id: string;
  projectId: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  slug: string;
  workflowRunId: string;
}) {
  await db.insert(contentArticles).values({ ...data, status: "queued" });
}

async function getArticleForProject(articleId: string, projectId: string) {
  const rows = await db
    .select()
    .from(contentArticles)
    .where(
      and(
        eq(contentArticles.id, articleId),
        eq(contentArticles.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listArticlesForProject(projectId: string) {
  return db
    .select()
    .from(contentArticles)
    .where(eq(contentArticles.projectId, projectId))
    .orderBy(desc(contentArticles.createdAt));
}

async function listSlugsForProject(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: contentArticles.slug })
    .from(contentArticles)
    .where(eq(contentArticles.projectId, projectId));
  return new Set(rows.map((row) => row.slug));
}

/** Workflow-side update; keyed by workflowRunId so a stale retry can't clobber a newer run. */
async function updateArticleFromWorkflow(
  articleId: string,
  workflowRunId: string,
  data: Partial<{
    status: ContentArticleStatus;
    slug: string;
    title: string;
    metaDescription: string;
    markdown: string;
    brief: string;
    faq: string;
    sourceUrls: string;
    error: string | null;
  }>,
) {
  await db
    .update(contentArticles)
    .set({ ...data, ...touchUpdatedAt })
    .where(
      and(
        eq(contentArticles.id, articleId),
        eq(contentArticles.workflowRunId, workflowRunId),
      ),
    );
}

/** User-side edits from the editor (title/meta/slug/markdown/author/faq). */
async function updateArticleForProject(
  articleId: string,
  projectId: string,
  data: Partial<{
    title: string;
    metaDescription: string;
    author: string | null;
    slug: string;
    markdown: string;
    faq: string;
  }>,
) {
  await db
    .update(contentArticles)
    .set({ ...data, ...touchUpdatedAt })
    .where(
      and(
        eq(contentArticles.id, articleId),
        eq(contentArticles.projectId, projectId),
      ),
    );
}

async function setArticleStatusForProject(
  articleId: string,
  projectId: string,
  status: "draft" | "published",
) {
  await db
    .update(contentArticles)
    .set({
      status,
      ...touchUpdatedAt,
      publishedAt:
        status === "published" ? sql`(current_timestamp)` : sql`NULL`,
    })
    .where(
      and(
        eq(contentArticles.id, articleId),
        eq(contentArticles.projectId, projectId),
      ),
    );
}

/** Rearms a failed article for a fresh workflow run. */
async function resetArticleForRetry(
  articleId: string,
  projectId: string,
  workflowRunId: string,
) {
  await db
    .update(contentArticles)
    .set({ status: "queued", error: null, workflowRunId, ...touchUpdatedAt })
    .where(
      and(
        eq(contentArticles.id, articleId),
        eq(contentArticles.projectId, projectId),
      ),
    );
}

async function deleteArticleForProject(articleId: string, projectId: string) {
  await db
    .delete(contentArticles)
    .where(
      and(
        eq(contentArticles.id, articleId),
        eq(contentArticles.projectId, projectId),
      ),
    );
}

// ─── Headless API queries ────────────────────────────────────────────────────

async function listPublishedArticles(projectId: string, limit: number) {
  return db
    .select()
    .from(contentArticles)
    .where(
      and(
        eq(contentArticles.projectId, projectId),
        eq(contentArticles.status, "published"),
      ),
    )
    .orderBy(desc(contentArticles.publishedAt))
    .limit(limit);
}

async function getPublishedArticleBySlug(projectId: string, slug: string) {
  const rows = await db
    .select()
    .from(contentArticles)
    .where(
      and(
        eq(contentArticles.projectId, projectId),
        eq(contentArticles.slug, slug),
        eq(contentArticles.status, "published"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ─── API keys ────────────────────────────────────────────────────────────────

async function createApiKey(data: {
  id: string;
  projectId: string;
  keyHash: string;
  label: string;
}) {
  await db.insert(contentApiKeys).values(data);
}

async function listApiKeysForProject(projectId: string) {
  return db
    .select({
      id: contentApiKeys.id,
      label: contentApiKeys.label,
      createdAt: contentApiKeys.createdAt,
      lastUsedAt: contentApiKeys.lastUsedAt,
      revokedAt: contentApiKeys.revokedAt,
    })
    .from(contentApiKeys)
    .where(eq(contentApiKeys.projectId, projectId))
    .orderBy(desc(contentApiKeys.createdAt));
}

async function revokeApiKeyForProject(keyId: string, projectId: string) {
  await db
    .update(contentApiKeys)
    .set({ revokedAt: sql`(current_timestamp)` })
    .where(
      and(
        eq(contentApiKeys.id, keyId),
        eq(contentApiKeys.projectId, projectId),
      ),
    );
}

/** Resolves an active (non-revoked) key by hash and stamps last_used_at. */
async function resolveActiveApiKeyByHash(keyHash: string) {
  const rows = await db
    .select()
    .from(contentApiKeys)
    .where(
      and(eq(contentApiKeys.keyHash, keyHash), isNull(contentApiKeys.revokedAt)),
    )
    .limit(1);
  const key = rows[0];
  if (!key) return null;

  await db
    .update(contentApiKeys)
    .set({ lastUsedAt: sql`(current_timestamp)` })
    .where(eq(contentApiKeys.id, key.id));

  return key;
}

export const ContentRepository = {
  createArticle,
  getArticleForProject,
  listArticlesForProject,
  listSlugsForProject,
  updateArticleFromWorkflow,
  updateArticleForProject,
  setArticleStatusForProject,
  resetArticleForRetry,
  deleteArticleForProject,
  listPublishedArticles,
  getPublishedArticleBySlug,
  createApiKey,
  listApiKeysForProject,
  revokeApiKeyForProject,
  resolveActiveApiKeyByHash,
};
