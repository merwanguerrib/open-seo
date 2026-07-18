import { describe, expect, it, vi } from "vitest";
import { tallyCompetitorDomains } from "./competitorDiscovery";

// competitorDiscovery.ts imports the KeywordResearch/RankTracking/
// ContentStrategy repositories, which eagerly import "@/db" -> the
// cloudflare:workers `env` binding at module load time. That binding only
// exists inside a Workers runtime, so it must be stubbed for this test file
// to import the module at all (same pattern as RankTrackingService.test.ts).
vi.mock("cloudflare:workers", () => ({ env: {} }));

describe("tallyCompetitorDomains", () => {
  it("ranks domains by how many keyword-competitor-sets they appear in", () => {
    const result = tallyCompetitorDomains(
      [
        ["a.com", "b.com", "c.com"],
        ["a.com", "b.com"],
        ["a.com"],
      ],
      null,
    );
    expect(result).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("counts a domain once per set even if repeated within it", () => {
    const result = tallyCompetitorDomains(
      [
        ["a.com", "a.com", "b.com"],
        ["a.com"],
      ],
      null,
    );
    expect(result).toEqual(["a.com", "b.com"]);
  });

  it("excludes the project's own domain", () => {
    const result = tallyCompetitorDomains(
      [["a.com", "self.com"], ["self.com"]],
      "self.com",
    );
    expect(result).toEqual(["a.com"]);
  });
});
