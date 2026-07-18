import type { BillingCustomerContext } from "@/server/billing/subscription";
import { KeywordResearchRepository } from "@/server/features/keywords/repositories/KeywordResearchRepository";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { ContentStrategyRepository } from "@/server/features/content/repositories/ContentStrategyRepository";
import { normalizeKeyword } from "@/server/features/content/services/contentStrategyParsing";
import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { normalizeDomainInput } from "@/server/lib/domainUtils";

const MAX_SEED_KEYWORDS = 20;
const MAX_COMPETITOR_DOMAINS = 5;
const RANKED_KEYWORDS_PER_DOMAIN = 50;

/** Ranks domains by how many of the input keyword-competitor sets they
 *  appear in (deduped per set, so one keyword can't inflate a domain's
 *  count on its own). */
export function tallyCompetitorDomains(
  competitorSets: string[][],
  excludeDomain: string | null,
): string[] {
  const counts = new Map<string, number>();
  for (const domains of competitorSets) {
    for (const domain of new Set(domains)) {
      if (excludeDomain && domain === excludeDomain) continue;
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([domain]) => domain);
}

/** Discovers content-gap keywords from the project's most frequent SERP
 *  competitors. Landed as `status: "suggested"` — a human reviews before
 *  they're queued as topics. On-demand only (button-triggered), not cron. */
export async function discoverCompetitorKeywords(input: {
  projectId: string;
  projectDomain: string | null;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
  plan: { minSearchVolume: number; maxDifficulty: number };
}): Promise<{ suggested: number }> {
  const [savedSeeds, trackedSeeds] = await Promise.all([
    KeywordResearchRepository.listTopSavedKeywordStrings(
      input.projectId,
      MAX_SEED_KEYWORDS,
    ),
    RankTrackingRepository.listTopTrackedKeywordStrings(
      input.projectId,
      MAX_SEED_KEYWORDS,
    ),
  ]);
  const seeds = [...new Set([...savedSeeds, ...trackedSeeds])].slice(
    0,
    MAX_SEED_KEYWORDS,
  );
  if (seeds.length === 0) return { suggested: 0 };

  const client = createDataforseoClient(input.billingCustomer);

  let selfDomain: string | null = null;
  if (input.projectDomain) {
    try {
      selfDomain = normalizeDomainInput(input.projectDomain, false);
    } catch {
      selfDomain = null;
    }
  }

  let competitorItems: Array<{ domain?: string | null }>;
  try {
    competitorItems = await client.labs.serpCompetitors({
      keywords: seeds,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      itemTypes: ["organic", "local_pack"],
      limit: 50,
      creditFeature: "content",
    });
  } catch (error) {
    console.error("[competitor-discovery] serpCompetitors failed:", error);
    return { suggested: 0 };
  }

  const domains = tallyCompetitorDomains(
    [
      competitorItems
        .map((item) => item.domain)
        .filter((domain): domain is string => Boolean(domain)),
    ],
    selfDomain,
  ).slice(0, MAX_COMPETITOR_DOMAINS);
  if (domains.length === 0) return { suggested: 0 };

  const existingKeywords = new Set(
    (await ContentStrategyRepository.listKeywords(input.projectId)).map(
      (keyword) => keyword.normalizedKeyword,
    ),
  );

  const rows: Parameters<
    typeof ContentStrategyRepository.insertSuggestedKeywords
  >[0] = [];

  for (const domain of domains) {
    try {
      const response = await client.domain.rankedKeywords({
        target: domain,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        limit: RANKED_KEYWORDS_PER_DOMAIN,
        creditFeature: "content",
      });
      for (const item of response.items) {
        const mapped = mapKeywordItem(item);
        if (!mapped) continue;
        const normalizedKeyword = normalizeKeyword(mapped.keyword);
        if (existingKeywords.has(normalizedKeyword)) continue;
        if (
          mapped.searchVolume != null &&
          mapped.searchVolume < input.plan.minSearchVolume
        ) {
          continue;
        }
        if (
          mapped.keywordDifficulty != null &&
          mapped.keywordDifficulty > input.plan.maxDifficulty
        ) {
          continue;
        }
        existingKeywords.add(normalizedKeyword);
        rows.push({
          projectId: input.projectId,
          keyword: mapped.keyword,
          normalizedKeyword,
          source: "competitor",
          sourceName: `competitor:${domain}`,
          role: "standalone",
          clusterName: null,
          searchVolume: mapped.searchVolume,
          difficulty: mapped.keywordDifficulty,
        });
      }
    } catch (error) {
      console.error(
        `[competitor-discovery] rankedKeywords failed for ${domain}:`,
        error,
      );
    }
  }

  if (rows.length === 0) return { suggested: 0 };
  await ContentStrategyRepository.insertSuggestedKeywords(rows);
  return { suggested: rows.length };
}
