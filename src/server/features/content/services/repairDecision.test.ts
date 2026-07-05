import { describe, expect, it } from "vitest";
import { decideRepairAction } from "./repairDecision";

const now = new Date("2026-07-05T00:00:00Z");

function point(overrides: Partial<{
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}>) {
  return {
    date: "2026-07-01",
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: 0,
    ...overrides,
  };
}

describe("decideRepairAction", () => {
  it("returns none with no metrics", () => {
    expect(
      decideRepairAction({ publishedAt: null, now, metrics: [] }),
    ).toBe("none");
  });

  it("archives old articles with near-zero impressions", () => {
    expect(
      decideRepairAction({
        publishedAt: "2026-04-01T00:00:00Z",
        now,
        metrics: [point({ impressions: 1, position: 80 })],
      }),
    ).toBe("archive");
  });

  it("rewrites the title on high impressions + low CTR", () => {
    expect(
      decideRepairAction({
        publishedAt: "2026-06-20T00:00:00Z",
        now,
        metrics: [point({ impressions: 500, clicks: 3, ctr: 0.006, position: 6 })],
      }),
    ).toBe("title_rewrite");
  });

  it("refreshes on position decay over time", () => {
    expect(
      decideRepairAction({
        publishedAt: "2026-06-01T00:00:00Z",
        now,
        metrics: [
          point({ date: "2026-06-10", impressions: 50, position: 5 }),
          point({ date: "2026-07-01", impressions: 50, position: 12 }),
        ],
      }),
    ).toBe("refresh");
  });

  it("suggests internal links for a page-2 article with demand", () => {
    expect(
      decideRepairAction({
        publishedAt: "2026-06-20T00:00:00Z",
        now,
        metrics: [point({ impressions: 200, clicks: 8, ctr: 0.04, position: 14 })],
      }),
    ).toBe("internal_links");
  });

  it("returns none for a healthy article", () => {
    expect(
      decideRepairAction({
        publishedAt: "2026-06-20T00:00:00Z",
        now,
        metrics: [point({ impressions: 300, clicks: 60, ctr: 0.2, position: 3 })],
      }),
    ).toBe("none");
  });
});
