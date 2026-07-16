import { describe, it, expect } from "vitest";
import { computeSemanticClusters } from "./semanticClusters";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const node = (id: string, semanticCluster: string | null) => ({
  id,
  url: `https://s.com/${id}`,
  title: id,
  statusCode: 200,
  wordCount: 10,
  internalLinkCount: 0,
  isIndexable: true,
  h1Count: 1,
  externalLinkCount: 0,
  canonicalUrl: null,
  semanticCluster,
});

describe("computeSemanticClusters", () => {
  it("builds a legend sorted by size with unclustered pages grouped last", () => {
    const payload = {
      nodes: [
        node("a", "Docs"),
        node("b", "Docs"),
        node("c", "Blog"),
        node("d", null),
      ],
      edges: [],
      meta: {
        auditId: "x",
        startUrl: "https://s.com/a",
        pagesCrawled: 4,
        generatedAt: "t",
      },
    } as AuditGraphPayload;
    const { legend, colorByNodeId } = computeSemanticClusters(payload);
    expect(legend.map((e) => e.category)).toEqual([
      "Docs",
      "Blog",
      "(unclustered)",
    ]);
    expect(legend.map((e) => e.count)).toEqual([2, 1, 1]);
    expect(colorByNodeId.get("a")).toBe(colorByNodeId.get("b"));
    expect(colorByNodeId.get("a")).not.toBe(colorByNodeId.get("c"));
    expect(colorByNodeId.size).toBe(4);
  });

  it("returns an empty legend when no node has a semantic cluster", () => {
    const payload = {
      nodes: [node("a", null)],
      edges: [],
      meta: {
        auditId: "x",
        startUrl: "https://s.com/a",
        pagesCrawled: 1,
        generatedAt: "t",
      },
    } as AuditGraphPayload;
    expect(computeSemanticClusters(payload).legend).toEqual([]);
  });
});
