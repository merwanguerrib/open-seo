import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listKeywords: vi.fn(),
  upsertKeywords: vi.fn(),
  markKeywordsPlanned: vi.fn(),
  markKeywordsIgnored: vi.fn(),
  getExistingKeywords: vi.fn(),
  getOrCreateCluster: vi.fn(),
  insertTopics: vi.fn(),
}));

vi.mock(
  "@/server/features/content/repositories/ContentStrategyRepository",
  () => ({
    ContentStrategyRepository: {
      listKeywords: mocks.listKeywords,
      upsertKeywords: mocks.upsertKeywords,
      markKeywordsPlanned: mocks.markKeywordsPlanned,
      markKeywordsIgnored: mocks.markKeywordsIgnored,
    },
  }),
);
vi.mock("@/server/features/content/repositories/ContentPlanRepository", () => ({
  ContentPlanRepository: {
    getExistingKeywords: mocks.getExistingKeywords,
    getOrCreateCluster: mocks.getOrCreateCluster,
    insertTopics: mocks.insertTopics,
  },
}));

describe("launchFromKeywords", () => {
  it("makes the highest-volume keyword the pillar when launching multiple", async () => {
    mocks.listKeywords.mockResolvedValue([]);
    mocks.getExistingKeywords.mockResolvedValue(new Set());
    mocks.getOrCreateCluster.mockResolvedValue("cluster-1");
    mocks.upsertKeywords.mockImplementation(async (rows) =>
      rows.map((row: Record<string, unknown>, i: number) => ({
        id: `kw-${i}`,
        ...row,
      })),
    );

    const { launchFromKeywords } = await import("./contentStrategyImports");
    const result = await launchFromKeywords({
      projectId: "p1",
      sourceName: "Saved Keywords",
      keywords: [
        { keyword: "low volume kw", searchVolume: 10 },
        { keyword: "high volume kw", searchVolume: 500 },
      ],
    });

    expect(mocks.upsertKeywords).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "high volume kw",
          role: "pillar",
          clusterName: "high volume kw",
        }),
        expect.objectContaining({
          keyword: "low volume kw",
          role: "satellite",
          clusterName: "high volume kw",
        }),
      ]),
    );
    expect(result.imported).toBe(2);
  });

  it("uses role standalone for a single launched keyword", async () => {
    mocks.listKeywords.mockResolvedValue([]);
    mocks.getExistingKeywords.mockResolvedValue(new Set());
    mocks.upsertKeywords.mockImplementation(async (rows) =>
      rows.map((row: Record<string, unknown>, i: number) => ({
        id: `kw-${i}`,
        ...row,
      })),
    );

    const { launchFromKeywords } = await import("./contentStrategyImports");
    await launchFromKeywords({
      projectId: "p1",
      sourceName: "Rank Tracking",
      keywords: [{ keyword: "solo keyword", searchVolume: 100 }],
    });

    expect(mocks.upsertKeywords).toHaveBeenCalledWith([
      expect.objectContaining({
        keyword: "solo keyword",
        role: "standalone",
        clusterName: null,
        sourceName: "Rank Tracking",
      }),
    ]);
  });
});
