import type { BillingCustomerContext } from "@/server/billing/subscription";
import { ContentPlanRepository } from "@/server/features/content/repositories/ContentPlanRepository";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import {
  GscNotConnectedError,
  GscService,
} from "@/server/features/gsc/services/GscService";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { isRecord } from "@/server/lib/dataforseo/envelope";

// Bound cost and noise: a handful of expansion seeds, a page of suggestions
// each, and a ceiling on how many topics one discovery run queues.
const MAX_EXPANSION_SEEDS = 3;
const SUGGESTIONS_PER_SEED = 30;
const MAX_TOPICS_PER_RUN = 40;
// GSC queries ranking in this band are "almost winnable" — proven demand, not
// yet on page 1.
const GSC_OPPORTUNITY_MIN_POSITION = 8;
const GSC_OPPORTUNITY_MAX_POSITION = 20;
const GSC_OPPORTUNITY_MIN_IMPRESSIONS = 10;

type DiscoveryPlan = {
  minSearchVolume: number;
  maxDifficulty: number;
};

type DiscoveredTopic = {
  clusterId: string | null;
  keyword: string;
  source: "gsc" | "expansion";
  role: "pillar" | "satellite";
  searchVolume: number | null;
  difficulty: number | null;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** Extract keyword + volume + difficulty from a DataForSEO Labs suggestion item. */
function readSuggestion(raw: unknown): {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
} | null {
  if (!isRecord(raw)) return null;
  const keyword = typeof raw.keyword === "string" ? raw.keyword.trim() : "";
  if (!keyword) return null;
  const keywordInfo = isRecord(raw.keyword_info) ? raw.keyword_info : {};
  const keywordProps = isRecord(raw.keyword_properties)
    ? raw.keyword_properties
    : {};
  return {
    keyword,
    searchVolume: asNumber(keywordInfo.search_volume),
    difficulty:
      asNumber(keywordProps.keyword_difficulty) ??
      asNumber(keywordInfo.keyword_difficulty),
  };
}

/** Queries the site already ranks for on page 2-3 — the fastest wins. */
async function discoverGscOpportunities(
  projectId: string,
): Promise<{ topics: DiscoveredTopic[]; seeds: string[] }> {
  try {
    const performance = await GscService.getPerformance({
      projectId,
      dimensions: ["query"],
      dateRange: "last_3_months",
      rowLimit: 200,
    });

    const topics: DiscoveredTopic[] = [];
    const seeds: string[] = [];
    for (const row of performance.rows) {
      const keyword = row.keys?.[0];
      if (!keyword) continue;
      // Highest-click queries make the best expansion seeds.
      if (seeds.length < MAX_EXPANSION_SEEDS && row.clicks > 0) {
        seeds.push(keyword);
      }
      if (
        row.position >= GSC_OPPORTUNITY_MIN_POSITION &&
        row.position <= GSC_OPPORTUNITY_MAX_POSITION &&
        row.impressions >= GSC_OPPORTUNITY_MIN_IMPRESSIONS
      ) {
        topics.push({
          clusterId: null,
          keyword,
          source: "gsc",
          role: "satellite",
          // GSC doesn't report search volume; impressions already prove demand.
          searchVolume: null,
          difficulty: null,
        });
      }
    }
    return { topics, seeds };
  } catch (error) {
    if (error instanceof GscNotConnectedError) return { topics: [], seeds: [] };
    throw error;
  }
}

/** Expand each seed into a topic cluster: seed = pillar, suggestions = satellites. */
async function discoverExpansionTopics(input: {
  projectId: string;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
  plan: DiscoveryPlan;
  seeds: string[];
}): Promise<DiscoveredTopic[]> {
  if (input.seeds.length === 0) return [];
  const client = createDataforseoClient(input.billingCustomer);
  const topics: DiscoveredTopic[] = [];

  for (const seed of input.seeds.slice(0, MAX_EXPANSION_SEEDS)) {
    let items: unknown[];
    try {
      items = await client.keywords.suggestions({
        keyword: seed,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        limit: SUGGESTIONS_PER_SEED,
        creditFeature: "content",
      });
    } catch (error) {
      console.error(
        `[topic-discovery] suggestions failed for "${seed}":`,
        error,
      );
      continue;
    }

    // One cluster per seed; the seed is its pillar.
    const clusterId = await ContentPlanRepository.createCluster({
      projectId: input.projectId,
      name: seed,
    });
    topics.push({
      clusterId,
      keyword: seed,
      source: "expansion",
      role: "pillar",
      searchVolume: null,
      difficulty: null,
    });

    for (const raw of items) {
      const suggestion = readSuggestion(raw);
      if (!suggestion) continue;
      if (suggestion.keyword.toLowerCase() === seed.toLowerCase()) continue;
      // Apply the winnability floors.
      if (
        suggestion.searchVolume != null &&
        suggestion.searchVolume < input.plan.minSearchVolume
      ) {
        continue;
      }
      if (
        suggestion.difficulty != null &&
        suggestion.difficulty > input.plan.maxDifficulty
      ) {
        continue;
      }
      topics.push({
        clusterId,
        keyword: suggestion.keyword,
        source: "expansion",
        role: "satellite",
        searchVolume: suggestion.searchVolume,
        difficulty: suggestion.difficulty,
      });
    }
  }

  return topics;
}

/**
 * Discover winnable topics for a project and queue new ones. Combines GSC
 * page-2/3 opportunities with keyword expansion around the site's best
 * queries, filtered by the plan's volume/difficulty floors and deduped
 * against already-queued topics and existing articles.
 */
export async function discoverTopics(input: {
  projectId: string;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
  plan: DiscoveryPlan;
  /** Extra seeds (e.g. saved keywords) used when GSC has no click data. */
  fallbackSeeds?: string[];
}): Promise<{ discovered: number }> {
  const { topics: gscTopics, seeds: gscSeeds } = await discoverGscOpportunities(
    input.projectId,
  );

  const seeds = (
    gscSeeds.length > 0 ? gscSeeds : (input.fallbackSeeds ?? [])
  ).slice(0, MAX_EXPANSION_SEEDS);

  const expansionTopics = await discoverExpansionTopics({
    projectId: input.projectId,
    billingCustomer: input.billingCustomer,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    plan: input.plan,
    seeds,
  });

  // Dedupe against already-queued topics, existing article slugs' keywords,
  // and within this batch.
  const existingTopicKeywords = await ContentPlanRepository.getExistingKeywords(
    input.projectId,
  );
  const existingArticles = await ContentRepository.listArticlesForProject(
    input.projectId,
  );
  const taken = new Set<string>(existingTopicKeywords);
  for (const article of existingArticles) {
    taken.add(article.keyword.toLowerCase());
  }

  const fresh: DiscoveredTopic[] = [];
  for (const topic of [...gscTopics, ...expansionTopics]) {
    const key = topic.keyword.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    fresh.push(topic);
    if (fresh.length >= MAX_TOPICS_PER_RUN) break;
  }

  if (fresh.length > 0) {
    await ContentPlanRepository.insertTopics(
      fresh.map((topic) => ({ projectId: input.projectId, ...topic })),
    );
  }

  return { discovered: fresh.length };
}
