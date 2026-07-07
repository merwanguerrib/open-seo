import { describe, expect, it } from "vitest";
import { buildSerpContext } from "./serpContext";

describe("buildSerpContext", () => {
  it("collects organic results, PAA questions, and AI overview text", () => {
    const context = buildSerpContext([
      {
        type: "organic",
        url: "https://a.com/x",
        title: "A",
        description: "desc a",
        domain: "a.com",
      },
      {
        type: "people_also_ask",
        items: [
          { type: "people_also_ask_element", title: "What is X?" },
          { type: "people_also_ask_element", title: "How does X work?" },
        ],
      },
      {
        type: "ai_overview",
        items: [{ type: "ai_overview_element", text: "X is a thing." }],
      },
      { type: "organic", url: "https://b.com/y", title: "B" },
    ]);

    expect(context.topOrganic).toEqual([
      {
        url: "https://a.com/x",
        title: "A",
        description: "desc a",
        domain: "a.com",
      },
      { url: "https://b.com/y", title: "B", description: null, domain: null },
    ]);
    expect(context.paaQuestions).toEqual(["What is X?", "How does X work?"]);
    expect(context.aiOverview).toBe("X is a thing.");
  });

  it("caps organic results at 10 and handles missing blocks", () => {
    const organic = Array.from({ length: 15 }, (_, i) => ({
      type: "organic",
      url: `https://site${i}.com`,
    }));
    const context = buildSerpContext(organic);
    expect(context.topOrganic).toHaveLength(10);
    expect(context.paaQuestions).toEqual([]);
    expect(context.aiOverview).toBeNull();
  });
});
