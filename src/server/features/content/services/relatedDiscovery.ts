import type { BillingCustomerContext } from "@/server/billing/subscription";
import { ContentStrategyRepository } from "@/server/features/content/repositories/ContentStrategyRepository";
import { normalizeKeyword } from "@/server/features/content/services/contentStrategyParsing";
import { readSuggestion } from "@/server/features/content/services/topicDiscovery";
import { createDataforseoClient } from "@/server/lib/dataforseo";

const MAX_COVERED_SEEDS = 15;
const RELATED_PER_SEED = 20;

/** Discovers cluster-expansion keywords around content the project already
 *  has covered. Landed as `status: "suggested"`, clustered under the
 *  covered keyword they expand — so an imported suggestion joins the
 *  existing content's cluster and gets internal-linked at generation time. */
export async function discoverRelatedKeywords(input: {
  projectId: string;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
  plan: { minSearchVolume: number; maxDifficulty: number };
}): Promise<{ suggested: number }> {
  const allKeywords = await ContentStrategyRepository.listKeywords(
    input.projectId,
  );
  const coveredSeeds = allKeywords
    .filter((keyword) => keyword.status === "covered")
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, MAX_COVERED_SEEDS);
  if (coveredSeeds.length === 0) return { suggested: 0 };

  const client = createDataforseoClient(input.billingCustomer);
  const existingKeywords = new Set(
    allKeywords.map((keyword) => keyword.normalizedKeyword),
  );

  const rows: Parameters<
    typeof ContentStrategyRepository.insertSuggestedKeywords
  >[0] = [];

  for (const seed of coveredSeeds) {
    try {
      const items = await client.keywords.related({
        keyword: seed.keyword,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        limit: RELATED_PER_SEED,
        creditFeature: "content",
      });
      for (const item of items) {
        const suggestion = readSuggestion(
          (item as { keyword_data?: unknown }).keyword_data,
        );
        if (!suggestion) continue;
        const normalizedKeyword = normalizeKeyword(suggestion.keyword);
        if (existingKeywords.has(normalizedKeyword)) continue;
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
        existingKeywords.add(normalizedKeyword);
        rows.push({
          projectId: input.projectId,
          keyword: suggestion.keyword,
          normalizedKeyword,
          source: "related",
          sourceName: `related:${seed.keyword}`,
          role: "satellite",
          clusterName: seed.keyword,
          searchVolume: suggestion.searchVolume,
          difficulty: suggestion.difficulty,
        });
      }
    } catch (error) {
      console.error(
        `[related-discovery] related keywords failed for "${seed.keyword}":`,
        error,
      );
    }
  }

  if (rows.length === 0) return { suggested: 0 };
  await ContentStrategyRepository.insertSuggestedKeywords(rows);
  return { suggested: rows.length };
}
