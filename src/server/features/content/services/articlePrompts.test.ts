import { describe, expect, it } from "vitest";
import {
  buildArticlePrompt,
  buildBriefPrompt,
  type ArticleBrief,
} from "./articlePrompts";

const serpContext = {
  topOrganic: [
    {
      url: "https://a.com/guide",
      title: "The Guide",
      description: "A guide.",
      domain: "a.com",
    },
  ],
  paaQuestions: ["What is X?"],
  aiOverview: "X is a tool.",
};

const competitors = [
  { url: "https://a.com/guide", text: "Competitor content ".repeat(1000) },
];

describe("buildBriefPrompt", () => {
  it("includes keyword, SERP results, PAA, and AI overview", () => {
    const prompt = buildBriefPrompt({
      keyword: "project tools",
      languageCode: "fr",
      serpContext,
      competitors,
    });
    expect(prompt).toContain('"project tools"');
    expect(prompt).toContain("language: fr");
    expect(prompt).toContain("https://a.com/guide");
    expect(prompt).toContain("What is X?");
    expect(prompt).toContain("X is a tool.");
  });

  it("truncates long competitor text", () => {
    const prompt = buildBriefPrompt({
      keyword: "k",
      languageCode: "en",
      serpContext,
      competitors,
    });
    expect(prompt.length).toBeLessThan(12_000);
  });
});

describe("buildArticlePrompt", () => {
  const brief: ArticleBrief = {
    intent: "commercial",
    angle: "Hands-on comparison",
    outline: [{ heading: "Why it matters", subheadings: ["For teams"] }],
    entities: ["pricing", "integrations"],
    questions: ["What is X?"],
  };

  it("carries the brief and the hard requirements", () => {
    const prompt = buildArticlePrompt({
      keyword: "project tools",
      languageCode: "en",
      brief,
      competitors,
      siteDomain: "example.com",
    });
    expect(prompt).toContain("Angle: Hands-on comparison");
    expect(prompt).toContain("- Why it matters (For teams)");
    expect(prompt).toContain("40-60 word paragraph");
    expect(prompt).toContain("never invent URLs");
    expect(prompt).toContain("FAQ");
    expect(prompt).toContain("example.com");
  });

  it("omits the site line without a domain", () => {
    const prompt = buildArticlePrompt({
      keyword: "k",
      languageCode: "en",
      brief,
      competitors,
      siteDomain: null,
    });
    expect(prompt).not.toContain("published on");
  });
});
