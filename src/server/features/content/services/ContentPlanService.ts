import type { BillingCustomerContext } from "@/server/billing/subscription";
import { ContentPlanRepository } from "@/server/features/content/repositories/ContentPlanRepository";
import type {
  ContentPlanRow,
  ContentTopicRow,
} from "@/server/features/content/repositories/ContentPlanRepository";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { discoverTopics } from "@/server/features/content/services/topicDiscovery";
import { ContentService } from "@/server/features/content/services/ContentService";
import { KeywordResearchRepository } from "@/server/features/keywords/repositories/KeywordResearchRepository";
import { AppError } from "@/server/lib/errors";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Keep the calendar filled this many weeks ahead.
const WEEKS_AHEAD = 2;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function planToView(plan: ContentPlanRow) {
  return {
    enabled: plan.enabled,
    cadencePerWeek: plan.cadencePerWeek,
    reviewWindowHours: plan.reviewWindowHours,
    autoPublish: plan.autoPublish,
    minSearchVolume: plan.minSearchVolume,
    maxDifficulty: plan.maxDifficulty,
    blogUrlPattern: plan.blogUrlPattern,
    lastPlannedAt: plan.lastPlannedAt,
    nextRunAt: plan.nextRunAt,
  };
}

async function getPlan(projectId: string) {
  const plan = await ContentPlanRepository.getOrCreatePlan(projectId);
  return planToView(plan);
}

async function updatePlan(input: {
  projectId: string;
  enabled?: boolean;
  cadencePerWeek?: number;
  reviewWindowHours?: number;
  autoPublish?: boolean;
  minSearchVolume?: number;
  maxDifficulty?: number;
  blogUrlPattern?: string | null;
}) {
  await ContentPlanRepository.getOrCreatePlan(input.projectId);
  const { projectId, enabled, ...rest } = input;

  // Enabling arms the cron: give it a next-run so it's picked up promptly.
  const nextRunAt = enabled === true ? new Date().toISOString() : undefined;

  await ContentPlanRepository.updatePlan(projectId, {
    ...rest,
    ...(enabled !== undefined && { enabled }),
    ...(nextRunAt !== undefined && { nextRunAt }),
  });
  return getPlan(projectId);
}

/** Runs topic discovery on demand (also used by the cron). */
async function runDiscovery(input: {
  projectId: string;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
}) {
  const plan = await ContentPlanRepository.getOrCreatePlan(input.projectId);

  // Seed expansion when GSC has no click data (not connected / token
  // revoked): the project's top saved keywords, falling back to existing
  // article keywords.
  const savedSeeds = await KeywordResearchRepository.listTopSavedKeywordStrings(
    input.projectId,
    3,
  );
  const fallbackSeeds =
    savedSeeds.length > 0
      ? savedSeeds
      : (await ContentRepository.listArticlesForProject(input.projectId))
          .slice(0, 3)
          .map((article) => article.keyword);

  const result = await discoverTopics({
    projectId: input.projectId,
    billingCustomer: input.billingCustomer,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    plan: {
      minSearchVolume: plan.minSearchVolume,
      maxDifficulty: plan.maxDifficulty,
    },
    fallbackSeeds,
  });

  await ContentPlanRepository.updatePlan(input.projectId, {
    lastPlannedAt: new Date().toISOString(),
  });
  return result;
}

/**
 * Assign calendar slots to suggested topics so the calendar stays filled
 * `WEEKS_AHEAD` weeks out at the plan's cadence. Spacing is even across the
 * week (7 / cadence days). Returns how many topics were scheduled.
 */
async function scheduleTopics(
  projectId: string,
): Promise<{ scheduled: number }> {
  const plan = await ContentPlanRepository.getOrCreatePlan(projectId);
  const cadence = Math.max(1, plan.cadencePerWeek);
  const targetScheduled = cadence * WEEKS_AHEAD;

  const scheduledTopics = await ContentPlanRepository.listTopics(projectId, [
    "scheduled",
  ]);
  const need = targetScheduled - scheduledTopics.length;
  if (need <= 0) return { scheduled: 0 };

  const suggested = await ContentPlanRepository.getSuggestedTopics(
    projectId,
    need,
  );
  if (suggested.length === 0) return { scheduled: 0 };

  const spacingDays = Math.max(1, Math.round(7 / cadence));

  // Start the day after the latest slot already on the calendar (or today).
  const latestSlot = scheduledTopics
    .map((topic) => topic.scheduledFor)
    .filter((slot): slot is string => Boolean(slot))
    .toSorted()
    .at(-1);
  let cursor = latestSlot
    ? new Date(`${latestSlot}T00:00:00Z`)
    : new Date(Date.now() - MS_PER_DAY);

  let scheduled = 0;
  for (const topic of suggested) {
    cursor = new Date(cursor.getTime() + spacingDays * MS_PER_DAY);
    await ContentPlanRepository.scheduleTopic(topic.id, toDateOnly(cursor));
    scheduled += 1;
  }
  return { scheduled };
}

async function listCalendar(projectId: string) {
  const topics = await ContentPlanRepository.listTopics(projectId);
  const clusters = await ContentPlanRepository.listClusters(projectId);
  const clusterName = new Map(clusters.map((c) => [c.id, c.name]));
  return {
    clusters: clusters.map((cluster) => ({
      id: cluster.id,
      name: cluster.name,
      pillarArticleId: cluster.pillarArticleId,
    })),
    topics: topics.map((topic) => ({
      id: topic.id,
      keyword: topic.keyword,
      source: topic.source,
      role: topic.role,
      status: topic.status,
      searchVolume: topic.searchVolume,
      difficulty: topic.difficulty,
      scheduledFor: topic.scheduledFor,
      articleId: topic.articleId,
      clusterName: topic.clusterId
        ? (clusterName.get(topic.clusterId) ?? null)
        : null,
    })),
  };
}

async function dismissTopic(topicId: string, projectId: string) {
  const topic = await ContentPlanRepository.getTopic(topicId, projectId);
  if (!topic) throw new AppError("NOT_FOUND");
  await ContentPlanRepository.updateTopicStatus(topicId, "dismissed");
}

/** Generate a scheduled/suggested topic immediately (manual "Generate now"). */
async function generateTopicNow(input: {
  topicId: string;
  projectId: string;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
}) {
  const topic = await ContentPlanRepository.getTopic(
    input.topicId,
    input.projectId,
  );
  if (!topic) throw new AppError("NOT_FOUND");
  if (topic.status === "generated" || topic.status === "generating") {
    throw new AppError("INTERNAL_ERROR", "Topic already generated");
  }
  const plan = await ContentPlanRepository.getOrCreatePlan(input.projectId);
  return generateFromTopic({
    topic,
    plan,
    projectId: input.projectId,
    billingCustomer: input.billingCustomer,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
}

/** Shared topic → article generation, used by the manual action and the cron. */
async function generateFromTopic(input: {
  topic: ContentTopicRow;
  plan: ContentPlanRow;
  projectId: string;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
}) {
  const { topic, plan } = input;
  const autoPublishAt =
    plan.autoPublish && plan.reviewWindowHours >= 0
      ? new Date(
          Date.now() + plan.reviewWindowHours * 60 * 60 * 1000,
        ).toISOString()
      : null;

  const { articleId } = await ContentService.generateArticle({
    billingCustomer: input.billingCustomer,
    projectId: input.projectId,
    keyword: topic.keyword,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    source: "autopilot",
    clusterId: topic.clusterId,
    blogUrlPattern: plan.blogUrlPattern,
    autoPublishAt,
  });

  await ContentPlanRepository.updateTopicStatus(
    topic.id,
    "generating",
    articleId,
  );

  // The pillar topic's article becomes the cluster's pillar.
  if (topic.role === "pillar" && topic.clusterId) {
    await ContentPlanRepository.setClusterPillar(topic.clusterId, articleId);
  }

  return { articleId };
}

export const ContentPlanService = {
  getPlan,
  updatePlan,
  runDiscovery,
  scheduleTopics,
  listCalendar,
  dismissTopic,
  generateTopicNow,
  generateFromTopic,
};
