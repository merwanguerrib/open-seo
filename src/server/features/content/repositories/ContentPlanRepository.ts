/**
 * Data access for the autopilot tables: content_plans, content_clusters,
 * content_topics, and content_article_metrics.
 */
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contentArticleMetrics,
  contentClusters,
  contentPlans,
  contentTopics,
} from "@/db/schema";

export type ContentPlanRow = typeof contentPlans.$inferSelect;
export type ContentClusterRow = typeof contentClusters.$inferSelect;
export type ContentTopicRow = typeof contentTopics.$inferSelect;
export type ContentArticleMetricRow =
  typeof contentArticleMetrics.$inferSelect;

const touchUpdatedAt = { updatedAt: sql`(current_timestamp)` };

// ─── Plans ───────────────────────────────────────────────────────────────────

async function getPlan(projectId: string): Promise<ContentPlanRow | null> {
  const rows = await db
    .select()
    .from(contentPlans)
    .where(eq(contentPlans.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

/** Creates the plan row on first access so the settings UI always has one. */
async function getOrCreatePlan(projectId: string): Promise<ContentPlanRow> {
  const existing = await getPlan(projectId);
  if (existing) return existing;
  await db
    .insert(contentPlans)
    .values({ id: crypto.randomUUID(), projectId })
    .onConflictDoNothing();
  const created = await getPlan(projectId);
  if (!created) throw new Error("Failed to create content plan");
  return created;
}

async function updatePlan(
  projectId: string,
  data: Partial<{
    enabled: boolean;
    cadencePerWeek: number;
    reviewWindowHours: number;
    autoPublish: boolean;
    minSearchVolume: number;
    maxDifficulty: number;
    blogUrlPattern: string | null;
    lastPlannedAt: string;
    nextRunAt: string | null;
  }>,
): Promise<void> {
  await db
    .update(contentPlans)
    .set({ ...data, ...touchUpdatedAt })
    .where(eq(contentPlans.projectId, projectId));
}

/** Enabled plans whose next run is due (for the cron). */
async function getDuePlans(nowIso: string): Promise<ContentPlanRow[]> {
  return db
    .select()
    .from(contentPlans)
    .where(
      and(
        eq(contentPlans.enabled, true),
        lte(contentPlans.nextRunAt, nowIso),
      ),
    );
}

// ─── Clusters ──────────────────────────────────────────────────────────────

async function createCluster(data: {
  projectId: string;
  name: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(contentClusters).values({ id, ...data });
  return id;
}

async function listClusters(projectId: string): Promise<ContentClusterRow[]> {
  return db
    .select()
    .from(contentClusters)
    .where(eq(contentClusters.projectId, projectId))
    .orderBy(asc(contentClusters.createdAt));
}

async function setClusterPillar(
  clusterId: string,
  pillarArticleId: string,
): Promise<void> {
  await db
    .update(contentClusters)
    .set({ pillarArticleId })
    .where(eq(contentClusters.id, clusterId));
}

// ─── Topics ────────────────────────────────────────────────────────────────

/** Inserts discovered topics. The unique (project, keyword) index is a safety
 *  net; callers should dedupe against getExistingKeywords first. */
async function insertTopics(
  topics: Array<{
    projectId: string;
    clusterId: string | null;
    keyword: string;
    source: "gsc" | "expansion";
    role: "pillar" | "satellite";
    searchVolume: number | null;
    difficulty: number | null;
  }>,
): Promise<void> {
  for (const topic of topics) {
    await db
      .insert(contentTopics)
      .values({ id: crypto.randomUUID(), ...topic })
      .onConflictDoNothing();
  }
}

async function listTopics(
  projectId: string,
  statuses?: ContentTopicRow["status"][],
): Promise<ContentTopicRow[]> {
  const where =
    statuses && statuses.length > 0
      ? and(
          eq(contentTopics.projectId, projectId),
          inArray(contentTopics.status, statuses),
        )
      : eq(contentTopics.projectId, projectId);
  return db
    .select()
    .from(contentTopics)
    .where(where)
    .orderBy(desc(contentTopics.searchVolume));
}

async function getExistingKeywords(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ keyword: contentTopics.keyword })
    .from(contentTopics)
    .where(eq(contentTopics.projectId, projectId));
  return new Set(rows.map((row) => row.keyword.toLowerCase()));
}

/** The N highest-volume suggested topics, oldest-scheduled first, for scheduling. */
async function getSuggestedTopics(
  projectId: string,
  limit: number,
): Promise<ContentTopicRow[]> {
  return db
    .select()
    .from(contentTopics)
    .where(
      and(
        eq(contentTopics.projectId, projectId),
        eq(contentTopics.status, "suggested"),
      ),
    )
    .orderBy(desc(contentTopics.searchVolume))
    .limit(limit);
}

/** Scheduled topics whose slot is due (for the cron to generate). */
async function getDueScheduledTopics(
  projectId: string,
  todayIso: string,
): Promise<ContentTopicRow[]> {
  return db
    .select()
    .from(contentTopics)
    .where(
      and(
        eq(contentTopics.projectId, projectId),
        eq(contentTopics.status, "scheduled"),
        lte(contentTopics.scheduledFor, todayIso),
      ),
    )
    .orderBy(asc(contentTopics.scheduledFor));
}

async function scheduleTopic(
  topicId: string,
  scheduledFor: string,
): Promise<void> {
  await db
    .update(contentTopics)
    .set({ status: "scheduled", scheduledFor, ...touchUpdatedAt })
    .where(eq(contentTopics.id, topicId));
}

async function updateTopicStatus(
  topicId: string,
  status: ContentTopicRow["status"],
  articleId?: string,
): Promise<void> {
  await db
    .update(contentTopics)
    .set({
      status,
      ...(articleId !== undefined && { articleId }),
      ...touchUpdatedAt,
    })
    .where(eq(contentTopics.id, topicId));
}

async function getTopic(
  topicId: string,
  projectId: string,
): Promise<ContentTopicRow | null> {
  const rows = await db
    .select()
    .from(contentTopics)
    .where(
      and(eq(contentTopics.id, topicId), eq(contentTopics.projectId, projectId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ─── Article metrics (phase 3) ───────────────────────────────────────────────

/** Upserts a daily GSC snapshot for an article (idempotent per article/date). */
async function upsertArticleMetric(data: {
  articleId: string;
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}): Promise<void> {
  await db
    .insert(contentArticleMetrics)
    .values({ id: crypto.randomUUID(), ...data })
    .onConflictDoUpdate({
      target: [contentArticleMetrics.articleId, contentArticleMetrics.date],
      set: {
        clicks: data.clicks,
        impressions: data.impressions,
        ctr: data.ctr,
        position: data.position,
      },
    });
}

async function listArticleMetrics(
  articleId: string,
): Promise<ContentArticleMetricRow[]> {
  return db
    .select()
    .from(contentArticleMetrics)
    .where(eq(contentArticleMetrics.articleId, articleId))
    .orderBy(asc(contentArticleMetrics.date));
}

export const ContentPlanRepository = {
  getPlan,
  getOrCreatePlan,
  updatePlan,
  getDuePlans,
  createCluster,
  listClusters,
  setClusterPillar,
  insertTopics,
  listTopics,
  getExistingKeywords,
  getSuggestedTopics,
  getDueScheduledTopics,
  scheduleTopic,
  updateTopicStatus,
  getTopic,
  upsertArticleMetric,
  listArticleMetrics,
};
