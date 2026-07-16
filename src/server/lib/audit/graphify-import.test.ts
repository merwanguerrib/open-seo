import { describe, it, expect } from "vitest";
import {
  graphifyGraphJsonSchema,
  mapGraphifyClustersToPages,
} from "./graphify-import";

const pages = [
  { id: "p-home", url: "https://s.com/" },
  { id: "p-about", url: "https://s.com/about" },
  { id: "p-blog", url: "https://s.com/blog/post" },
];

describe("graphifyGraphJsonSchema", () => {
  it("accepts a minimal graph.json and rejects garbage", () => {
    expect(
      graphifyGraphJsonSchema.safeParse({
        nodes: [{ id: "concept-1", community: 0, source: "pages/index.md" }],
      }).success,
    ).toBe(true);
    expect(graphifyGraphJsonSchema.safeParse({ nodes: "nope" }).success).toBe(
      false,
    );
    expect(graphifyGraphJsonSchema.safeParse(null).success).toBe(false);
  });
});

describe("mapGraphifyClustersToPages", () => {
  it("assigns each page its majority community, using labels when present", () => {
    const rows = mapGraphifyClustersToPages({
      graphJson: {
        nodes: [
          { id: "a", community: 0, source: "pages/index.md" },
          { id: "b", community: 0, source: "graphify-input/pages/index.md" },
          { id: "c", community: 1, source: "pages/index.md" },
          {
            id: "d",
            community: 1,
            sources: ["pages/about.md", "pages/blog-post.md"],
          },
          { id: "no-community", source: "pages/about.md" },
          { id: "no-source", community: 0 },
          { id: "unknown-file", community: 0, source: "pages/nope.md" },
        ],
        community_labels: { "1": "Company info" },
      },
      pages,
    });
    const byPage = new Map(rows.map((r) => [r.pageId, r.clusterLabel]));
    expect(byPage.get("p-home")).toBe("Cluster 0"); // 2 votes for 0 vs 1 for 1
    expect(byPage.get("p-about")).toBe("Company info");
    expect(byPage.get("p-blog")).toBe("Company info");
    expect(rows).toHaveLength(3);
  });

  it("returns an empty list when nothing matches", () => {
    const rows = mapGraphifyClustersToPages({
      graphJson: { nodes: [{ id: "x", community: 2, source: "other.md" }] },
      pages,
    });
    expect(rows).toEqual([]);
  });
});
