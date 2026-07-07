import { describe, it, expect } from "vitest";
import { deriveCategory, computeCategories, CATEGORY_PALETTE } from "./pageCategories";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

describe("deriveCategory", () => {
  it("uses the first path segment", () => {
    expect(deriveCategory("https://s.com/blog/post-1")).toBe("blog");
    expect(deriveCategory("https://s.com/guides/x/y")).toBe("guides");
    expect(deriveCategory("https://s.com/about")).toBe("about");
  });
  it("returns (root) for the home page and malformed URLs", () => {
    expect(deriveCategory("https://s.com/")).toBe("(root)");
    expect(deriveCategory("not a url")).toBe("(root)");
  });
});

describe("computeCategories", () => {
  const node = (id: string, url: string) => ({
    id, url, title: id, statusCode: 200, wordCount: 0, internalLinkCount: 0,
    isIndexable: true, h1Count: 0, externalLinkCount: 0, canonicalUrl: null,
  });
  const payload = {
    nodes: [
      node("h", "https://s.com/"),
      node("b1", "https://s.com/blog/a"),
      node("b2", "https://s.com/blog/b"),
      node("g1", "https://s.com/guides/a"),
    ],
    edges: [],
    meta: { auditId: "a", startUrl: "https://s.com/", pagesCrawled: 4, generatedAt: "t" },
  } as AuditGraphPayload;

  it("counts categories and sorts by count desc then name", () => {
    const { legend } = computeCategories(payload);
    expect(legend.map((e) => [e.category, e.count])).toEqual([
      ["blog", 2],
      ["(root)", 1],
      ["guides", 1],
    ]);
  });
  it("assigns palette colors by legend order and maps every node", () => {
    const { legend, colorByNodeId } = computeCategories(payload);
    expect(legend[0].color).toBe(CATEGORY_PALETTE[0]);
    expect(colorByNodeId.get("b1")).toBe(CATEGORY_PALETTE[0]); // blog is first
    expect(colorByNodeId.size).toBe(4);
  });
});
