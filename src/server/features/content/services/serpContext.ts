import type { SerpLiveItem } from "@/server/lib/dataforseo/serp";
import { isRecord } from "@/server/lib/dataforseo/envelope";

/**
 * Grounding context distilled from a live SERP: the organic results the
 * article must beat, the People Also Ask questions worth answering, and the
 * AI Overview text (what Google's own answer engine says) when present.
 */
export type SerpContext = {
  topOrganic: Array<{
    url: string;
    title: string | null;
    description: string | null;
    domain: string | null;
  }>;
  paaQuestions: string[];
  aiOverview: string | null;
};

const MAX_ORGANIC_RESULTS = 10;

function extractNestedStrings(
  value: unknown,
  field: "title" | "text",
): string[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  const out: string[] = [];
  for (const item of value.items) {
    if (!isRecord(item)) continue;
    const text = item[field];
    if (typeof text === "string" && text.trim()) out.push(text.trim());
  }
  return out;
}

export function buildSerpContext(items: SerpLiveItem[]): SerpContext {
  const topOrganic: SerpContext["topOrganic"] = [];
  const paaQuestions: string[] = [];
  const aiOverviewChunks: string[] = [];

  for (const item of items) {
    if (item.type === "organic" && item.url) {
      if (topOrganic.length < MAX_ORGANIC_RESULTS) {
        topOrganic.push({
          url: item.url,
          title: item.title ?? null,
          description: item.description ?? null,
          domain: item.domain ?? null,
        });
      }
      continue;
    }
    if (item.type === "people_also_ask") {
      paaQuestions.push(...extractNestedStrings(item, "title"));
      continue;
    }
    if (item.type === "ai_overview") {
      aiOverviewChunks.push(...extractNestedStrings(item, "text"));
    }
  }

  return {
    topOrganic,
    paaQuestions,
    aiOverview: aiOverviewChunks.length ? aiOverviewChunks.join("\n\n") : null,
  };
}
