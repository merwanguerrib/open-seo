import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentAssets, contentDocuments, contentKeywords } from "@/db/schema";

export type ContentDocumentRow = typeof contentDocuments.$inferSelect;
export type ContentKeywordRow = typeof contentKeywords.$inferSelect;
export type ContentAssetRow = typeof contentAssets.$inferSelect;

const touchUpdatedAt = { updatedAt: sql`(current_timestamp)` };

async function upsertDocument(data: {
  projectId: string;
  kind: ContentDocumentRow["kind"];
  name: string;
  format: ContentDocumentRow["format"];
  content: string;
}): Promise<void> {
  await db
    .insert(contentDocuments)
    .values({ id: crypto.randomUUID(), ...data })
    .onConflictDoUpdate({
      target: [
        contentDocuments.projectId,
        contentDocuments.kind,
        contentDocuments.name,
      ],
      set: {
        format: data.format,
        content: data.content,
        ...touchUpdatedAt,
      },
    });
}

async function listDocuments(projectId: string): Promise<ContentDocumentRow[]> {
  return db
    .select()
    .from(contentDocuments)
    .where(eq(contentDocuments.projectId, projectId))
    .orderBy(asc(contentDocuments.kind), asc(contentDocuments.name));
}

async function deleteDocument(
  documentId: string,
  projectId: string,
): Promise<void> {
  await db
    .delete(contentDocuments)
    .where(
      and(
        eq(contentDocuments.id, documentId),
        eq(contentDocuments.projectId, projectId),
      ),
    );
}

async function upsertKeywords(
  rows: Array<{
    projectId: string;
    keyword: string;
    normalizedKeyword: string;
    source: ContentKeywordRow["source"];
    sourceName: string | null;
    role: ContentKeywordRow["role"];
    clusterName: string | null;
    targetUrl: string | null;
    title: string | null;
    intent: string | null;
    priority: string | null;
    searchVolume: number | null;
    difficulty: number | null;
  }>,
): Promise<ContentKeywordRow[]> {
  for (const row of rows) {
    await db
      .insert(contentKeywords)
      .values({ id: crypto.randomUUID(), ...row })
      .onConflictDoUpdate({
        target: [contentKeywords.projectId, contentKeywords.normalizedKeyword],
        set: {
          keyword: row.keyword,
          source: row.source,
          sourceName: row.sourceName,
          role: row.role,
          clusterName: row.clusterName,
          targetUrl: row.targetUrl,
          title: row.title,
          intent: row.intent,
          priority: row.priority,
          searchVolume: row.searchVolume,
          difficulty: row.difficulty,
          ...touchUpdatedAt,
        },
      });
  }

  if (rows.length === 0) return [];
  const first = rows[0];
  return db
    .select()
    .from(contentKeywords)
    .where(
      and(
        eq(contentKeywords.projectId, first.projectId),
        inArray(
          contentKeywords.normalizedKeyword,
          rows.map((row) => row.normalizedKeyword),
        ),
      ),
    );
}

/** Insert-only: discovery suggestions must never downgrade an existing
 *  keyword's status (e.g. a row already "planned" or "covered" stays as-is
 *  if rediscovered — onConflictDoNothing is the guard). */
async function insertSuggestedKeywords(
  rows: Array<{
    projectId: string;
    keyword: string;
    normalizedKeyword: string;
    source: "competitor" | "related";
    sourceName: string;
    role: ContentKeywordRow["role"];
    clusterName: string | null;
    searchVolume: number | null;
    difficulty: number | null;
  }>,
): Promise<void> {
  for (const row of rows) {
    await db
      .insert(contentKeywords)
      .values({
        id: crypto.randomUUID(),
        projectId: row.projectId,
        keyword: row.keyword,
        normalizedKeyword: row.normalizedKeyword,
        source: row.source,
        sourceName: row.sourceName,
        status: "suggested",
        role: row.role,
        clusterName: row.clusterName,
        targetUrl: null,
        title: null,
        intent: null,
        priority: null,
        searchVolume: row.searchVolume,
        difficulty: row.difficulty,
      })
      .onConflictDoNothing();
  }
}

async function listKeywords(projectId: string): Promise<ContentKeywordRow[]> {
  return db
    .select()
    .from(contentKeywords)
    .where(eq(contentKeywords.projectId, projectId))
    .orderBy(
      asc(contentKeywords.status),
      asc(contentKeywords.priority),
      desc(contentKeywords.searchVolume),
      asc(contentKeywords.keyword),
    );
}

async function getKeywordForProject(
  projectId: string,
  normalizedKeyword: string,
): Promise<ContentKeywordRow | null> {
  const rows = await db
    .select()
    .from(contentKeywords)
    .where(
      and(
        eq(contentKeywords.projectId, projectId),
        eq(contentKeywords.normalizedKeyword, normalizedKeyword),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getKeywordById(
  keywordId: string,
  projectId: string,
): Promise<ContentKeywordRow | null> {
  const rows = await db
    .select()
    .from(contentKeywords)
    .where(
      and(
        eq(contentKeywords.id, keywordId),
        eq(contentKeywords.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listKeywordSeeds(
  projectId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ keyword: contentKeywords.keyword })
    .from(contentKeywords)
    .where(
      and(
        eq(contentKeywords.projectId, projectId),
        eq(contentKeywords.status, "planned"),
      ),
    )
    .orderBy(asc(contentKeywords.priority), desc(contentKeywords.searchVolume))
    .limit(limit);
  return rows.map((row) => row.keyword);
}

async function markKeywordsCovered(keywordIds: string[]): Promise<void> {
  if (keywordIds.length === 0) return;
  await db
    .update(contentKeywords)
    .set({ status: "covered", ...touchUpdatedAt })
    .where(inArray(contentKeywords.id, keywordIds));
}

async function markKeywordsPlanned(
  keywordIds: string[],
  projectId: string,
): Promise<void> {
  if (keywordIds.length === 0) return;
  await db
    .update(contentKeywords)
    .set({ status: "planned", ...touchUpdatedAt })
    .where(
      and(
        inArray(contentKeywords.id, keywordIds),
        eq(contentKeywords.projectId, projectId),
      ),
    );
}

async function markKeywordsIgnored(
  keywordIds: string[],
  projectId: string,
): Promise<void> {
  if (keywordIds.length === 0) return;
  await db
    .update(contentKeywords)
    .set({ status: "ignored", ...touchUpdatedAt })
    .where(
      and(
        inArray(contentKeywords.id, keywordIds),
        eq(contentKeywords.projectId, projectId),
      ),
    );
}

async function upsertAssets(
  rows: Array<{
    projectId: string;
    contentKeywordId: string | null;
    url: string;
    contentType: ContentAssetRow["contentType"];
    state: ContentAssetRow["state"];
    source: ContentAssetRow["source"];
    title: string | null;
    metaDescription: string | null;
    statusCode: number | null;
    wordCount: number | null;
    h1Count: number | null;
    internalLinkCount: number | null;
    crawlDepth: number | null;
    hasStructuredData: boolean | null;
    isIndexable: boolean | null;
    lastAnalyzedAt: string | null;
  }>,
): Promise<void> {
  for (const row of rows) {
    await db
      .insert(contentAssets)
      .values({ id: crypto.randomUUID(), ...row })
      .onConflictDoUpdate({
        target: [contentAssets.projectId, contentAssets.url],
        set: {
          contentKeywordId: row.contentKeywordId,
          contentType: row.contentType,
          state: row.state,
          source: row.source,
          title: row.title,
          metaDescription: row.metaDescription,
          statusCode: row.statusCode,
          wordCount: row.wordCount,
          h1Count: row.h1Count,
          internalLinkCount: row.internalLinkCount,
          crawlDepth: row.crawlDepth,
          hasStructuredData: row.hasStructuredData,
          isIndexable: row.isIndexable,
          lastAnalyzedAt: row.lastAnalyzedAt,
          ...touchUpdatedAt,
        },
      });
  }
}

async function listAssets(projectId: string): Promise<ContentAssetRow[]> {
  return db
    .select()
    .from(contentAssets)
    .where(eq(contentAssets.projectId, projectId))
    .orderBy(
      asc(contentAssets.contentType),
      asc(contentAssets.state),
      asc(contentAssets.url),
    );
}

export const ContentStrategyRepository = {
  upsertDocument,
  listDocuments,
  deleteDocument,
  upsertKeywords,
  insertSuggestedKeywords,
  listKeywords,
  getKeywordForProject,
  getKeywordById,
  listKeywordSeeds,
  markKeywordsCovered,
  markKeywordsPlanned,
  markKeywordsIgnored,
  upsertAssets,
  listAssets,
};
