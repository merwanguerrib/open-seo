import { describe, it, expect } from "vitest";
import { computeStructuralClusters } from "./structuralClusters";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const node = (id: string, url: string, title: string) => ({
  id,
  url,
  title,
  statusCode: 200,
  wordCount: 100,
  internalLinkCount: 0,
  isIndexable: true,
  h1Count: 1,
  externalLinkCount: 0,
  canonicalUrl: null,
});
const edge = (from: string, to: string) => ({
  from,
  to,
  anchorText: null,
  isBroken: false,
});

// Two dense triangles with no links between them → 2 Louvain communities.
const payload: AuditGraphPayload = {
  nodes: [
    node("b1", "https://s.com/blog/one", "Blog post one"),
    node("b2", "https://s.com/blog/two", "Blog post two"),
    node("b3", "https://s.com/blog/three", "Blog post three"),
    node("s1", "https://s.com/shop/red", "Shop item red"),
    node("s2", "https://s.com/shop/blue", "Shop item blue"),
    node("s3", "https://s.com/shop/green", "Shop item green"),
  ],
  edges: [
    edge("b1", "b2"), edge("b2", "b3"), edge("b3", "b1"),
    edge("s1", "s2"), edge("s2", "s3"), edge("s3", "s1"),
  ],
  meta: { auditId: "x", startUrl: "https://s.com/blog/one", pagesCrawled: 6, generatedAt: "t" },
};

describe("computeStructuralClusters", () => {
  const graph = buildGraphologyGraph(payload);
  const { pagerank } = computeGraphMetrics(graph, "b1");
  const { clusters, colorByNodeId } = computeStructuralClusters(
    payload,
    graph,
    pagerank,
  );

  it("finds the two disconnected communities", () => {
    expect(clusters).toHaveLength(2);
    const memberships = clusters
      .map((c) => [...c.nodeIds].sort().join(","))
      .sort();
    expect(memberships).toEqual(["b1,b2,b3", "s1,s2,s3"]);
  });

  it("names clusters from the most frequent title/URL term", () => {
    const names = clusters.map((c) => c.name).sort();
    expect(names).toEqual(["blog", "shop"]);
  });

  it("picks the max-pagerank node as pivot and colors every node", () => {
    for (const cluster of clusters) {
      expect(cluster.nodeIds).toContain(cluster.pivotNodeId);
      const maxPr = Math.max(...cluster.nodeIds.map((id) => pagerank[id] ?? 0));
      expect(pagerank[cluster.pivotNodeId]).toBe(maxPr);
    }
    expect(colorByNodeId.size).toBe(6);
  });

  it("handles an edgeless graph with a single cluster", () => {
    const lonely: AuditGraphPayload = {
      ...payload,
      nodes: payload.nodes.slice(0, 2),
      edges: [],
    };
    const g = buildGraphologyGraph(lonely);
    const result = computeStructuralClusters(lonely, g, {});
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].nodeIds.sort()).toEqual(["b1", "b2"]);
  });
});
