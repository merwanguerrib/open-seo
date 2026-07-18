import { describe, expect, it } from "vitest";
import {
  assessContentHealth,
  extractMasterPlanEntries,
  normalizeContentUrl,
  parseKeywordInput,
} from "./contentStrategyParsing";

describe("parseKeywordInput", () => {
  it("accepts line lists and first-column CSV while deduplicating", () => {
    expect(
      parseKeywordInput(
        [
          "keyword,volume",
          "Assistant pédagogique IA,100",
          "assistant pédagogique ia,100",
          "# ignored",
          "séquence pédagogique\t250",
        ].join("\n"),
      ),
    ).toEqual(["Assistant pédagogique IA", "séquence pédagogique"]);
  });
});

describe("extractMasterPlanEntries", () => {
  it("normalizes pillars, spokes, product pages, and target URLs", () => {
    const entries = extractMasterPlanEntries(
      {
        site: "https://example.com",
        pillars: [
          {
            id: "programming",
            layer: 1,
            hub_url: "/guide/programmation-annuelle/",
            hub_title: "Programmation annuelle",
            primary_keyword: "programmation cycle 2",
            priority: "P0",
            primary_kd: 3,
            spokes: [
              {
                url: "/blog/programmation-maths-cycle-2/",
                kw: "programmation maths cycle 2",
                priority: "P1",
                vol: 590,
              },
            ],
          },
        ],
        category_pages_layer_2: [
          {
            layer: 2,
            url: "/assistant-pedagogique-ia/",
            keyword: "assistant pédagogique ia",
          },
        ],
      },
      null,
    );

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "programmation cycle 2",
          role: "pillar",
          clusterName: "programming",
          targetUrl: "https://example.com/guide/programmation-annuelle",
          contentType: "pillar",
          priority: "P0",
          difficulty: 3,
        }),
        expect.objectContaining({
          keyword: "programmation maths cycle 2",
          role: "satellite",
          clusterName: "programming",
          targetUrl: "https://example.com/blog/programmation-maths-cycle-2",
          contentType: "blog",
          searchVolume: 590,
        }),
        expect.objectContaining({
          keyword: "assistant pédagogique ia",
          role: "standalone",
          targetUrl: "https://example.com/assistant-pedagogique-ia",
          contentType: "product",
        }),
      ]),
    );
  });

  it("merges a root seed with its richer pillar definition", () => {
    const entries = extractMasterPlanEntries(
      {
        site: "https://example.com",
        seed_keyword: "séquence pédagogique",
        pillar: {
          keyword: "séquence pédagogique",
          url: "/guide/sequence-pedagogique/",
          title: "Le guide",
        },
      },
      null,
    );
    expect(entries).toEqual([
      expect.objectContaining({
        keyword: "séquence pédagogique",
        role: "pillar",
        targetUrl: "https://example.com/guide/sequence-pedagogique",
        title: "Le guide",
      }),
    ]);
  });
});

describe("normalizeContentUrl", () => {
  it("resolves relative paths and removes fragments and trailing slashes", () => {
    expect(
      normalizeContentUrl("/blog/example/#section", "https://example.com"),
    ).toBe("https://example.com/blog/example");
  });

  it("does not turn an empty line into the site homepage", () => {
    expect(normalizeContentUrl("  ", "https://example.com")).toBeNull();
  });
});

describe("assessContentHealth", () => {
  it("flags critical indexability and editorial quality issues", () => {
    expect(
      assessContentHealth({
        state: "existing",
        contentType: "pillar",
        statusCode: 200,
        title: "Guide",
        metaDescription: null,
        wordCount: 400,
        h1Count: 2,
        internalLinkCount: 0,
        crawlDepth: 5,
        hasStructuredData: false,
        isIndexable: false,
        lastAnalyzedAt: "2026-07-16T00:00:00.000Z",
      }),
    ).toEqual({
      status: "critical",
      issues: [
        "Not indexable",
        "Missing meta description",
        "2 H1 headings",
        "Thin content (400 words)",
        "No internal links",
        "Deep page (5)",
        "No structured data",
      ],
    });
  });

  it("keeps planned URLs distinct from unanalyzed existing URLs", () => {
    const common = {
      contentType: "blog" as const,
      statusCode: null,
      title: null,
      metaDescription: null,
      wordCount: null,
      h1Count: null,
      internalLinkCount: null,
      crawlDepth: null,
      hasStructuredData: null,
      isIndexable: null,
      lastAnalyzedAt: null,
    };
    expect(assessContentHealth({ ...common, state: "planned" }).status).toBe(
      "planned",
    );
    expect(assessContentHealth({ ...common, state: "existing" }).status).toBe(
      "unknown",
    );
  });
});
