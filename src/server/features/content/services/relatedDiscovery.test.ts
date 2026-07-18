import { describe, expect, it, vi } from "vitest";

// relatedDiscovery.ts imports topicDiscovery.ts, which imports the
// ContentPlanRepository/ContentRepository, which eagerly import "@/db" ->
// the cloudflare:workers `env` binding at module load time. That binding
// only exists inside a Workers runtime, so it must be stubbed for this test
// file to import the module at all (same pattern as competitorDiscovery.test.ts).
vi.mock("cloudflare:workers", () => ({ env: {} }));

const mocks = vi.hoisted(() => ({
  listKeywords: vi.fn(),
  insertSuggestedKeywords: vi.fn(),
  related: vi.fn(),
}));

vi.mock(
  "@/server/features/content/repositories/ContentStrategyRepository",
  () => ({
    ContentStrategyRepository: {
      listKeywords: mocks.listKeywords,
      insertSuggestedKeywords: mocks.insertSuggestedKeywords,
    },
  }),
);
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({
    keywords: { related: mocks.related },
  }),
}));

describe("discoverRelatedKeywords", () => {
  it("suggests related keywords clustered under the covered keyword they came from", async () => {
    mocks.listKeywords.mockResolvedValue([
      {
        id: "kw-1",
        normalizedKeyword: "best running shoes",
        keyword: "best running shoes",
        status: "covered",
        searchVolume: 1000,
      },
    ]);
    mocks.related.mockResolvedValue([
      {
        keyword_data: {
          keyword: "trail running shoes",
          keyword_info: { search_volume: 300 },
          keyword_properties: { keyword_difficulty: 20 },
        },
      },
    ]);

    const { discoverRelatedKeywords } = await import("./relatedDiscovery");
    const result = await discoverRelatedKeywords({
      projectId: "p1",
      billingCustomer: {
        userId: "u1",
        userEmail: "u@x.com",
        organizationId: "org1",
        projectId: "p1",
      },
      locationCode: 2840,
      languageCode: "en",
      plan: { minSearchVolume: 10, maxDifficulty: 60 },
    });

    expect(mocks.insertSuggestedKeywords).toHaveBeenCalledWith([
      expect.objectContaining({
        keyword: "trail running shoes",
        source: "related",
        role: "satellite",
        clusterName: "best running shoes",
      }),
    ]);
    expect(result.suggested).toBe(1);
  });

  it("returns zero suggestions when there is no covered content yet", async () => {
    mocks.listKeywords.mockResolvedValue([]);
    const { discoverRelatedKeywords } = await import("./relatedDiscovery");
    const result = await discoverRelatedKeywords({
      projectId: "p1",
      billingCustomer: {
        userId: "u1",
        userEmail: "u@x.com",
        organizationId: "org1",
        projectId: "p1",
      },
      locationCode: 2840,
      languageCode: "en",
      plan: { minSearchVolume: 10, maxDifficulty: 60 },
    });
    expect(result).toEqual({ suggested: 0 });
    expect(mocks.insertSuggestedKeywords).not.toHaveBeenCalled();
  });
});
